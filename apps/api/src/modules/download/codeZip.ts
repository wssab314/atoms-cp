import { posix } from 'node:path';

export interface CodeZipFile {
  path: string;
  content: string;
}

const deniedParts = new Set(['node_modules', 'dist', '.git']);
const crcTable = new Uint32Array(256).map((_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  }
  return crc >>> 0;
});

export function normalizeDownloadPath(path: string): string | undefined {
  if (!path || path.includes('\0') || path.startsWith('/') || /^[a-z]:/i.test(path)) {
    return undefined;
  }

  const normalized = posix.normalize(path.replace(/\\/g, '/'));

  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    return undefined;
  }

  const parts = normalized.split('/');

  if (parts.some((part) => deniedParts.has(part) || part === '.env' || part.startsWith('.env.'))) {
    return undefined;
  }

  return normalized;
}

export function filterDownloadFiles(files: CodeZipFile[]): CodeZipFile[] {
  const seen = new Set<string>();
  const safeFiles: CodeZipFile[] = [];

  for (const file of files) {
    const path = normalizeDownloadPath(file.path);

    if (!path || seen.has(path)) {
      continue;
    }

    seen.add(path);
    safeFiles.push({ path, content: file.content });
  }

  return safeFiles.sort((left, right) => left.path.localeCompare(right.path));
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function dosTime(date = new Date()): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

function localHeader(input: {
  name: Buffer;
  content: Buffer;
  crc: number;
  modified: { time: number; date: number };
}): Buffer {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(input.modified.time, 10);
  header.writeUInt16LE(input.modified.date, 12);
  header.writeUInt32LE(input.crc, 14);
  header.writeUInt32LE(input.content.length, 18);
  header.writeUInt32LE(input.content.length, 22);
  header.writeUInt16LE(input.name.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, input.name, input.content]);
}

function centralHeader(input: {
  name: Buffer;
  content: Buffer;
  crc: number;
  offset: number;
  modified: { time: number; date: number };
}): Buffer {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(input.modified.time, 12);
  header.writeUInt16LE(input.modified.date, 14);
  header.writeUInt32LE(input.crc, 16);
  header.writeUInt32LE(input.content.length, 20);
  header.writeUInt32LE(input.content.length, 24);
  header.writeUInt16LE(input.name.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(input.offset, 42);
  return Buffer.concat([header, input.name]);
}

function endOfCentralDirectory(input: {
  fileCount: number;
  centralSize: number;
  centralOffset: number;
}): Buffer {
  const header = Buffer.alloc(22);
  header.writeUInt32LE(0x06054b50, 0);
  header.writeUInt16LE(0, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(input.fileCount, 8);
  header.writeUInt16LE(input.fileCount, 10);
  header.writeUInt32LE(input.centralSize, 12);
  header.writeUInt32LE(input.centralOffset, 16);
  header.writeUInt16LE(0, 20);
  return header;
}

export function createCodeZip(files: CodeZipFile[]): Buffer {
  const safeFiles = filterDownloadFiles(files);
  const modified = dosTime();
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const file of safeFiles) {
    const name = Buffer.from(file.path, 'utf8');
    const content = Buffer.from(file.content, 'utf8');
    const crc = crc32(content);
    const local = localHeader({ name, content, crc, modified });
    localParts.push(local);
    centralParts.push(centralHeader({ name, content, crc, offset, modified }));
    offset += local.length;
  }

  const centralOffset = offset;
  const central = Buffer.concat(centralParts);
  const end = endOfCentralDirectory({
    fileCount: safeFiles.length,
    centralSize: central.length,
    centralOffset
  });

  return Buffer.concat([...localParts, central, end]);
}

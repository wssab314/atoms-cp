import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2']
]);

const hopByHopHeaders = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
]);

export function shouldProxyRequest(pathname) {
  return pathname === '/api'
    || pathname.startsWith('/api/')
    || pathname === '/preview'
    || pathname.startsWith('/preview/');
}

function isInsideRoot(rootDir, filePath) {
  return filePath === rootDir || filePath.startsWith(`${rootDir}${sep}`);
}

function getRequestPath(url) {
  try {
    return decodeURIComponent(new URL(url ?? '/', 'http://localhost').pathname);
  } catch {
    return '/';
  }
}

function resolveRequestFile(rootDir, pathname) {
  const cleanPath = pathname.replace(/^\/+/, '');
  const filePath = resolve(rootDir, cleanPath);

  if (!isInsideRoot(rootDir, filePath)) {
    return undefined;
  }

  return filePath;
}

async function fileExists(filePath) {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile();
  } catch {
    return false;
  }
}

function setCommonHeaders(response, filePath) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader('Content-Type', contentTypes.get(extname(filePath)) ?? 'application/octet-stream');

  if (filePath.includes(`${sep}assets${sep}`)) {
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } else {
    response.setHeader('Cache-Control', 'no-cache');
  }
}

async function sendFile(response, filePath) {
  setCommonHeaders(response, filePath);
  response.statusCode = 200;
  createReadStream(filePath).pipe(response);
}

function filterHeaders(headers, targetHost) {
  const filtered = {};

  for (const [name, value] of Object.entries(headers)) {
    if (hopByHopHeaders.has(name.toLowerCase())) {
      continue;
    }

    filtered[name] = value;
  }

  filtered.host = targetHost;
  return filtered;
}

function writeProxyError(response) {
  if (response.headersSent) {
    response.destroy();
    return;
  }

  response.statusCode = 502;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify({ error: 'API proxy unavailable' }));
}

function proxyRequestToApi(request, response, apiProxyOrigin) {
  const target = new URL(request.url ?? '/', apiProxyOrigin);
  const client = target.protocol === 'https:' ? httpsRequest : httpRequest;
  const proxy = client({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port,
    method: request.method,
    path: `${target.pathname}${target.search}`,
    headers: filterHeaders(request.headers, target.host)
  }, (proxyResponse) => {
    response.statusCode = proxyResponse.statusCode ?? 502;

    for (const [name, value] of Object.entries(proxyResponse.headers)) {
      if (!value || hopByHopHeaders.has(name.toLowerCase())) {
        continue;
      }

      response.setHeader(name, value);
    }

    proxyResponse.pipe(response);
  });

  proxy.on('error', () => {
    writeProxyError(response);
  });
  request.pipe(proxy);
}

export function createWebStaticServer(input = {}) {
  const rootDir = resolve(input.rootDir ?? join(process.cwd(), 'apps/web/dist'));
  const indexFile = join(rootDir, 'index.html');
  const apiProxyOrigin = input.apiProxyOrigin?.replace(/\/$/, '');

  return createServer(async (request, response) => {
    const pathname = getRequestPath(request.url);

    if (apiProxyOrigin && shouldProxyRequest(pathname)) {
      proxyRequestToApi(request, response, apiProxyOrigin);
      return;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.statusCode = 405;
      response.end('Method not allowed');
      return;
    }

    const requestedFile = resolveRequestFile(rootDir, pathname);

    if (requestedFile && await fileExists(requestedFile)) {
      if (request.method === 'HEAD') {
        setCommonHeaders(response, requestedFile);
        response.statusCode = 200;
        response.end();
        return;
      }

      await sendFile(response, requestedFile);
      return;
    }

    if (pathname.startsWith('/assets/')) {
      response.statusCode = 404;
      response.end('Not found');
      return;
    }

    if (request.method === 'HEAD') {
      setCommonHeaders(response, indexFile);
      response.statusCode = 200;
      response.end();
      return;
    }

    try {
      response.statusCode = 200;
      setCommonHeaders(response, indexFile);
      response.end(await readFile(indexFile));
    } catch {
      response.statusCode = 503;
      response.end('Web assets are not available');
    }
  });
}

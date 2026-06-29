export interface DirectTextPatchRequest {
  source: string;
  aiId: string;
  text: string;
}

export function applyDirectTextPatch(input: DirectTextPatchRequest): string {
  const patternSource = `(<([A-Za-z][\\w.:-]*)(?=[^>]*\\bdata-ai-id="${escapeRegex(input.aiId)}")[^>]*>)([\\s\\S]*?)(</\\2>)`;
  const pattern = new RegExp(patternSource);
  const matches = Array.from(input.source.matchAll(new RegExp(patternSource, 'g')));

  if (matches.length !== 1) {
    throw new Error(`Unable to apply direct text patch for ${input.aiId}`);
  }

  const tagName = matches[0]?.[2]?.toLowerCase();

  if (!tagName || !isTextEditableTag(tagName)) {
    throw new Error(`Unable to apply direct text patch for ${input.aiId}`);
  }

  return input.source.replace(pattern, (_match, opening: string, _tagName: string, _currentText: string, closing: string) => {
    return `${opening}{${JSON.stringify(input.text)}}${closing}`;
  });
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isTextEditableTag(tagName: string): boolean {
  return /^(h[1-6]|p|span|strong|em|small|button|a|li|label|figcaption)$/.test(tagName);
}

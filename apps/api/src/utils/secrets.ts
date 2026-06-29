const DEFAULT_SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{12,}/g,
  /gh[pousr]_[A-Za-z0-9_]{20,}/g,
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g
];

export function maskSecrets(input: string, knownSecrets: string[] = []): string {
  const withKnownSecretsMasked = knownSecrets
    .filter((secret) => secret.length >= 6)
    .reduce((current, secret) => current.split(secret).join('[masked-secret]'), input);

  return DEFAULT_SECRET_PATTERNS.reduce(
    (current, pattern) => current.replace(pattern, '[masked-secret]'),
    withKnownSecretsMasked
  );
}

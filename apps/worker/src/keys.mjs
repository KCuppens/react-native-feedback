// Plain JS so the project-creation CLI (scripts/create-project.mjs) can run it under Node
// as is, sharing the exact slug and key formats with the Worker. Types: keys.d.mts.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export const SLUG_MAX = 48;

export function randomToken(length) {
  // Rejection sampling keeps the distribution uniform over the alphabet.
  const out = [];
  while (out.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (byte < 248 && out.length < length) out.push(ALPHABET[byte % 62]);
    }
  }
  return out.join('');
}

export function generateProjectKeys() {
  return {
    publicKey: `pk_${randomToken(24)}`,
    signingSecret: `fbs_${randomToken(40)}`,
    secretKey: `sk_${randomToken(40)}`,
  };
}

export function slugify(name) {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, SLUG_MAX) || 'project'
  );
}

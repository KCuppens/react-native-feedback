#!/usr/bin/env node
// Create a project without the dashboard.
//   npm run project:create -- --name "1% Better" [--slug one-better] [--remote] [--env production]
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const name = opt('name');
if (!name) {
  console.error('Usage: npm run project:create -- --name "My App" [--slug my-app] [--remote] [--env production]');
  process.exit(1);
}
const slug = (opt('slug') ?? name)
  .toLowerCase()
  .normalize('NFKD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 48) || 'project';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const token = (n) => {
  let out = '';
  while (out.length < n) for (const b of randomBytes(n * 2)) if (b < 248 && out.length < n) out += ALPHABET[b % 62];
  return out;
};
const keys = { publicKey: `pk_${token(24)}`, signingSecret: `fbs_${token(40)}`, secretKey: `sk_${token(40)}` };
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
// Same defaults the dashboard writes (packages/core DEFAULT_PROJECT_SETTINGS).
const settings = JSON.stringify({
  autoApprove: false,
  inAppAdmin: false,
  publicBoard: false,
  allowAnonymous: true,
  allowAttachments: true,
  allowComments: true,
  allowDownvotes: true,
  roadmapEnabled: true,
  notifySubmitter: true,
  adminEmail: null,
});
const sql = `INSERT INTO projects (id, slug, name, public_key, signing_secret, secret_key_hash, settings, created_at) VALUES (${[
  q(randomUUID()),
  q(slug),
  q(name),
  q(keys.publicKey),
  q(keys.signingSecret),
  q(createHash('sha256').update(keys.secretKey).digest('hex')),
  q(settings),
  Date.now(),
].join(', ')});`;

const env = opt('env');
const database = env === 'production' ? 'feedback' : 'feedback-dev';
const wranglerArgs = ['wrangler', 'd1', 'execute', database, args.includes('--remote') ? '--remote' : '--local', '--command', sql];
if (env) wranglerArgs.push('--env', env);
execFileSync('npx', wranglerArgs, { stdio: 'inherit' });

console.log(`
Project "${name}" created (slug: ${slug}).

  Public key      ${keys.publicKey}      -> <FeedbackBoard projectKey=...>
  Signing secret  ${keys.signingSecret}  -> your server, for signFeedbackUser()
  Admin API key   ${keys.secretKey}  -> Authorization: Bearer ... (shown once)
`);

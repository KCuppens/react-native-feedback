// Runs the feedback service locally for the E2E suite: the built dashboard and public board,
// a fresh local D1 and R2 on every start, a known admin password, and no email or queue.
import { execSync, spawn } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Shared with the specs and playwright.config.ts.
const config = JSON.parse(readFileSync(new URL('./e2e.config.json', import.meta.url), 'utf8'));
const E2E_PORT = Number(process.env.E2E_PORT ?? config.port);
const E2E_PASSWORD = config.password;

const root = fileURLToPath(new URL('..', import.meta.url));
const worker = fileURLToPath(new URL('../apps/worker/', import.meta.url));
const state = fileURLToPath(new URL('./.state/', import.meta.url));
const env = { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' };

if (!process.env.E2E_SKIP_BUILD) execSync('npm run build:web', { cwd: root, stdio: 'inherit', env });
rmSync(state, { recursive: true, force: true });
execSync(`npx wrangler d1 migrations apply feedback-dev --local --persist-to "${state}"`, { cwd: worker, stdio: 'inherit', env });

const dev = spawn(
  'npx',
  [
    'wrangler',
    'dev',
    '--port',
    String(E2E_PORT),
    '--persist-to',
    state,
    '--var',
    `ADMIN_PASSWORD:${E2E_PASSWORD}`,
    '--var',
    'SESSION_SECRET:e2e-session-secret-that-is-long-enough-000',
    // The public project lookup is cached per isolate; tests change settings and read them back.
    '--var',
    'PROJECT_CACHE_SECONDS:0',
  ],
  { cwd: worker, stdio: 'inherit', env },
);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => dev.kill(signal));
dev.on('exit', (code) => process.exit(code ?? 0));

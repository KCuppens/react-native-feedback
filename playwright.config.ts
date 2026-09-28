import { defineConfig, devices } from '@playwright/test';

import config from './e2e/e2e.config.json';

const port = Number(process.env.E2E_PORT ?? config.port);

/**
 * End-to-end tests of the dashboard and the public board against a local worker
 * (wrangler dev with a fresh local D1 on every run, no email, no queue).
 * Run with `npm run e2e`.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'node e2e/serve.mjs',
    url: `http://localhost:${port}/v1/health`,
    timeout: 240_000,
    reuseExistingServer: false,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});

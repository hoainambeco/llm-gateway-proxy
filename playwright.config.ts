import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from '@playwright/test';
import { PW_RUN_DIR } from './test/playwright/seed-data';

// Fixed run directory so config evaluation in multiple workers cannot disagree.
// The seed script owns clearing it; deleting it here could race a running server.
const runDir = PW_RUN_DIR;
fs.mkdirSync(runDir, { recursive: true });

export default defineConfig({
  testDir: './test/playwright',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  globalTeardown: './test/playwright/global-teardown.ts',
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:8046',
    // The seed timestamps are UTC. Pin the browser clock so `datetime-local`
    // values parsed with `new Date(...)` land on the same instants regardless
    // of the host timezone.
    timezoneId: 'UTC',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run test:playwright:server',
    url: 'http://127.0.0.1:8046/',
    reuseExistingServer: false,
    timeout: 180000,
    env: {
      PORT: '8046',
      HOST: '127.0.0.1',
      NODE_ENV: 'production',
      SQLITE_DB_PATH: path.join(runDir, 'test.sqlite'),
      ACCOUNTS_FILE: path.join(runDir, 'accounts.json'),
      ROUTING_CONFIG_PATH: path.join(runDir, 'routing.json'),
      DATA_DIR: runDir,
    },
  },
});

/**
 * Boots the built server against the isolated Playwright run directory.
 *
 * The seed script's environment changes die with its process, so this wrapper
 * forces the same four data paths for the child. Ambient `DATA_DIR` or
 * `SQLITE_DB_PATH` values never reach the server: running this script directly
 * must not touch the developer's real data.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { PW_RUN_DIR } from './seed-data';

process.env.DATA_DIR = PW_RUN_DIR;
process.env.SQLITE_DB_PATH = path.join(PW_RUN_DIR, 'test.sqlite');
process.env.ACCOUNTS_FILE = path.join(PW_RUN_DIR, 'accounts.json');
process.env.ROUTING_CONFIG_PATH = path.join(PW_RUN_DIR, 'routing.json');

const child = spawn(process.execPath, [path.join(process.cwd(), 'dist/main.js')], {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => child.kill(signal));
}

child.on('error', (error) => {
  console.error('Failed to start the Playwright server', error);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

import path from 'node:path';

/**
 * The one directory the Playwright suite may write to. It is a fixed path so the
 * config, seed script, server wrapper, and teardown all agree, and so a direct
 * `npm run test:playwright:server` cannot touch the real data locations.
 */
export const PW_RUN_DIR = path.join(process.cwd(), 'test/.tmp/pw');

export const PW_ADMIN_KEY = `sk-ag-${'a'.repeat(48)}`;
export const PW_CLIENT_KEY = `sk-ag-${'b'.repeat(48)}`;
export const PW_ADMIN_KEY_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
export const PW_CLIENT_KEY_ID = 'bbbbbbbb-2222-4222-8222-222222222222';
export const T0 = 1790812800000; // 2026-10-01T00:00:00Z

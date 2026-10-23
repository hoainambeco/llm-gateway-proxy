import { applyTempEnv, freePort } from './temp-env';
import { seedAdminKey, TEST_ADMIN_KEY, TEST_CLIENT_KEY } from './seed';

export interface TestServerHandle {
  baseUrl: string;
  port: number;
  adminKey: string;
  clientKey: string;
  close(): Promise<void>;
}

export async function startTestServer(
  options: { accounts?: unknown[]; seedKeys?: boolean } = {},
): Promise<TestServerHandle> {
  const temp = applyTempEnv('agp-e2e-');
  const port = await freePort();
  if (options.accounts) {
    const fs = await import('node:fs');
    fs.writeFileSync(process.env.ACCOUNTS_FILE!, JSON.stringify(options.accounts));
  }
  if (options.seedKeys !== false) {
    await seedAdminKey(process.env.SQLITE_DB_PATH!, TEST_ADMIN_KEY, 'admin');
    await seedAdminKey(process.env.SQLITE_DB_PATH!, TEST_CLIENT_KEY, 'client');
  }

  const { bootstrapNestServer, stopNestServer } = await import('../../../src/server/main');
  const { DEFAULT_APP_CONFIG } = await import('../../../src/modules/config/types');
  const started = await bootstrapNestServer({
    ...DEFAULT_APP_CONFIG.proxy,
    enabled: true,
    port,
    api_key: '',
    auto_start: true,
  });

  if (started.success === false) throw new Error(`server failed to start: ${started.message}`);

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    port,
    adminKey: TEST_ADMIN_KEY,
    clientKey: TEST_CLIENT_KEY,
    async close() {
      await stopNestServer();
      temp.restore();
    },
  };
}

export async function apiFetch(
  baseUrl: string,
  path: string,
  init: { method?: string; token?: string | null; body?: unknown } = {},
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {};
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${baseUrl}${path}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

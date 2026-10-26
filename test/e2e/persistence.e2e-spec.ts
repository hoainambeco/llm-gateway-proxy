import { apiFetch, startTestServer } from './helpers/server';

describe('persistence across restarts', () => {
  it('persists created API keys in SQLite database across server restarts', async () => {
    const server = await startTestServer();
    try {
      // 1. Create a client key via API
      const createRes = await apiFetch(server.baseUrl, '/internal/api-keys', {
        token: server.adminKey,
        body: { name: 'persisted-test-key', role: 'client' },
      });
      expect(createRes.status).toBe(201);
      const newKey = createRes.body.data.key;
      expect(typeof newKey).toBe('string');

      // 2. Validate key is active
      const validBefore = await apiFetch(
        server.baseUrl,
        '/internal/auth/validate',
        {
          body: { key: newKey },
        },
      );
      expect(validBefore.status).toBe(200);
      expect(validBefore.body.valid).toBe(true);

      // 3. Stop NestJS server (keeping temp files & SQLite DB intact)
      const { stopNestServer, bootstrapNestServer } =
        await import('../../src/server/main');
      const { DEFAULT_APP_CONFIG } =
        await import('../../src/modules/config/types');
      const { freePort } = await import('./helpers/temp-env');

      await stopNestServer();

      // 4. Start NestJS server again in the same environment
      const newPort = await freePort();
      const restartResult = await bootstrapNestServer({
        ...DEFAULT_APP_CONFIG.proxy,
        enabled: true,
        port: newPort,
        api_key: '',
        auto_start: true,
      });
      expect(restartResult.success).toBe(true);

      const restartedUrl = `http://127.0.0.1:${newPort}`;
      const validAfter = await apiFetch(
        restartedUrl,
        '/internal/auth/validate',
        {
          body: { key: newKey },
        },
      );
      expect(validAfter.status).toBe(200);
      expect(validAfter.body.valid).toBe(true);
    } finally {
      await server.close();
    }
  });
});

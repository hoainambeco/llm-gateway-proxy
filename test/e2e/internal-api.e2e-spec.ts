import { apiFetch, startTestServer } from './helpers/server';
import { insertTrafficLogs } from './helpers/seed';

describe('internal api', () => {
  let server: Awaited<ReturnType<typeof startTestServer>>;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  describe('internal audit API filters', () => {
    beforeAll(async () => {
      await insertTrafficLogs(process.env.SQLITE_DB_PATH!, [
        {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          timestamp: 1790812800000, // 2026-10-01T00:00:00Z
          apiKeyId: '11111111-1111-4111-8111-111111111111',
        },
        {
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          timestamp: 1790816400000, // 2026-10-01T01:00:00Z
          apiKeyId: '22222222-2222-4222-8222-222222222222',
        },
      ]);
    });

    it('filters audit rows by api key and time range', async () => {
      const byKey = await apiFetch(
        server.baseUrl,
        '/internal/audit/requests?apiKeyId=22222222-2222-4222-8222-222222222222',
        { token: server.adminKey },
      );
      expect(byKey.status).toBe(200);
      expect(byKey.body.data.map((r: any) => r.requestId)).toEqual([
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      ]);

      const byTime = await apiFetch(
        server.baseUrl,
        '/internal/audit/requests?from=1790812800000&to=1790812800000',
        { token: server.adminKey },
      );
      expect(byTime.status).toBe(200);
      expect(byTime.body.data.map((r: any) => r.requestId)).toEqual([
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      ]);
    });

    it('returns empty for an inverted range and rejects a malformed key id', async () => {
      const inverted = await apiFetch(
        server.baseUrl,
        '/internal/audit/requests?from=1790816400000&to=1790812800000',
        { token: server.adminKey },
      );
      expect(inverted.status).toBe(200);
      expect(inverted.body.data).toEqual([]);

      const malformed = await apiFetch(
        server.baseUrl,
        '/internal/audit/requests?apiKeyId=not-a-uuid',
        { token: server.adminKey },
      );
      expect(malformed.status).toBe(400);
    });
  });

  describe('internal accounts API', () => {
    it('updates the display name', async () => {
      const created = await apiFetch(server.baseUrl, '/internal/accounts', {
        token: server.adminKey,
        body: { provider: 'google', email: 'patch-me@test.local' },
      });
      const res = await apiFetch(
        server.baseUrl,
        `/internal/accounts/${created.body.data.id}`,
        {
          method: 'PATCH',
          token: server.adminKey,
          body: { name: 'Renamed' },
        },
      );
      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Renamed');
      expect(res.body.data.is_active).toBe(true);
    });

    it('rejects unknown fields and unknown ids', async () => {
      const bad = await apiFetch(
        server.baseUrl,
        '/internal/accounts/00000000-0000-4000-8000-000000000000',
        {
          method: 'PATCH',
          token: server.adminKey,
          body: { email: 'nope@test.local' },
        },
      );
      expect(bad.status).toBe(400);
      const missing = await apiFetch(
        server.baseUrl,
        '/internal/accounts/11111111-1111-4111-8111-111111111111',
        {
          method: 'PATCH',
          token: server.adminKey,
          body: { name: 'x' },
        },
      );
      expect(missing.status).toBe(404);
    });

    // Endpoint-level smoke test: with every account disabled the proxy refuses the
    // request. Selection-level proof (a token-bearing account is skipped while an
    // enabled one is still chosen) lives in the network-free unit spec
    // `account-lease.disabled-accounts.spec.ts`.
    it('returns 503 when every account is disabled', async () => {
      await apiFetch(server.baseUrl, '/internal/accounts', {
        token: server.adminKey,
        body: { provider: 'google', email: 'only@test.local' },
      });
      const list = await apiFetch(server.baseUrl, '/internal/accounts', {
        token: server.adminKey,
      });
      for (const account of list.body.data) {
        await apiFetch(server.baseUrl, `/internal/accounts/${account.id}`, {
          method: 'PATCH',
          token: server.adminKey,
          body: { is_active: false },
        });
      }
      const res = await apiFetch(server.baseUrl, '/v1/chat/completions', {
        token: server.clientKey,
        body: {
          model: 'gemini-2.5-pro',
          messages: [{ role: 'user', content: 'hi' }],
        },
      });
      expect(res.status).toBe(503);
    });

    it('keeps disabled accounts visible in the overview and can re-enable one', async () => {
      const list = await apiFetch(server.baseUrl, '/internal/accounts', {
        token: server.adminKey,
      });
      expect(list.status).toBe(200);
      expect(list.body.total).toBeGreaterThan(0);
      expect(list.body.data.every((a: any) => a.is_active === false)).toBe(true);

      const status = await apiFetch(server.baseUrl, '/internal/system/status', {
        token: server.adminKey,
      });
      expect(status.body.accounts.total).toBeGreaterThan(0);
      expect(status.body.accounts.active).toBe(0);

      const target = list.body.data[0];
      const enabled = await apiFetch(
        server.baseUrl,
        `/internal/accounts/${target.id}`,
        { method: 'PATCH', token: server.adminKey, body: { is_active: true } },
      );
      expect(enabled.status).toBe(200);
      expect(enabled.body.data.is_active).toBe(true);

      const rechecked = await apiFetch(server.baseUrl, '/internal/system/status', {
        token: server.adminKey,
      });
      expect(rechecked.body.accounts.active).toBe(1);
    });

    it('still creates and deletes accounts', async () => {
      const created = await apiFetch(server.baseUrl, '/internal/accounts', {
        token: server.adminKey,
        body: { provider: 'google', email: 'delete-me@test.local' },
      });
      expect(created.status).toBe(201);
      const deleted = await apiFetch(
        server.baseUrl,
        `/internal/accounts/${created.body.data.id}`,
        { method: 'DELETE', token: server.adminKey },
      );
      expect(deleted.status).toBe(200);
      const list = await apiFetch(server.baseUrl, '/internal/accounts', {
        token: server.adminKey,
      });
      expect(list.body.data.some((a: any) => a.id === created.body.data.id)).toBe(false);
    });
  });
});

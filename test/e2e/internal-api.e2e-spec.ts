import { apiFetch, startTestServer } from './helpers/server';

describe('internal accounts API', () => {
  let server: Awaited<ReturnType<typeof startTestServer>>;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

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

  it('does not select a disabled account for model requests', async () => {
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

  it('keeps disabled accounts visible in the overview', async () => {
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

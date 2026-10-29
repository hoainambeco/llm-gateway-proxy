import { apiFetch, startTestServer } from './helpers/server';

describe('admin surface', () => {
  let server: Awaited<ReturnType<typeof startTestServer>>;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  it('returns system status for an admin key', async () => {
    const res = await apiFetch(server.baseUrl, '/internal/system/status', {
      token: server.adminKey,
    });

    expect(res.status).toBe(200);
    expect(res.body.port).toBe(server.port);
  });

  it('rejects internal APIs without a token', async () => {
    const res = await apiFetch(server.baseUrl, '/internal/system/status');
    expect(res.status).toBe(401);
  });

  it('rejects a client-role key on the admin surface', async () => {
    const res = await apiFetch(server.baseUrl, '/internal/system/status', {
      token: server.clientKey,
    });
    expect(res.status).toBe(401);
  });

  it('requires an admin key for graphql', async () => {
    const res = await apiFetch(server.baseUrl, '/graphql', {
      body: { query: '{ __typename }' },
    });
    expect(res.status).toBe(401);
  });

  it('allows an admin key for graphql', async () => {
    const res = await apiFetch(server.baseUrl, '/graphql', {
      token: server.adminKey,
      body: { query: '{ __typename }' },
    });
    expect(res.status).toBe(200);
    expect(res.body.data.__typename).toBe('Query');
  });

  it('rejects a client-role key for graphql', async () => {
    const res = await apiFetch(server.baseUrl, '/graphql', {
      token: server.clientKey,
      body: { query: '{ __typename }' },
    });
    expect(res.status).toBe(401);
  });

  it('rejects an unauthenticated GET graphql request', async () => {
    const res = await apiFetch(
      server.baseUrl,
      `/graphql?query=${encodeURIComponent('{ __typename }')}`,
    );
    expect(res.status).toBe(401);
  });

  it('rejects a percent-encoded graphql path without a token', async () => {
    const res = await apiFetch(server.baseUrl, '/%67raphql', {
      body: { query: '{ __typename }' },
    });
    expect(res.status).toBe(401);
  });

  describe('auth validation endpoint (POST /internal/auth/validate)', () => {
    it('validates an admin key and returns role admin (TC-AUTH-004)', async () => {
      const res = await apiFetch(server.baseUrl, '/internal/auth/validate', {
        method: 'POST',
        token: server.adminKey,
      });
      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(true);
      expect(res.body.role).toBe('admin');
    });

    it('validates a client key and returns role client (TC-AUTH-006)', async () => {
      const res = await apiFetch(server.baseUrl, '/internal/auth/validate', {
        method: 'POST',
        token: server.clientKey,
      });
      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(true);
      expect(res.body.role).toBe('client');
    });

    it('returns valid: false for an invalid token (TC-AUTH-005)', async () => {
      const res = await apiFetch(server.baseUrl, '/internal/auth/validate', {
        method: 'POST',
        token: 'sk-ag-invalid-key-token-12345',
      });
      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(false);
      expect(res.body.error).toContain('Invalid API key');
    });

    it('rejects unauthenticated request to /internal/accounts (TC-AUTH-004)', async () => {
      const res = await apiFetch(server.baseUrl, '/internal/accounts');
      expect(res.status).toBe(401);
    });
  });
});

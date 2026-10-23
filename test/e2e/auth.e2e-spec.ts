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
});

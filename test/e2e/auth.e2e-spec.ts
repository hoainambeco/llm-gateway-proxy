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
});

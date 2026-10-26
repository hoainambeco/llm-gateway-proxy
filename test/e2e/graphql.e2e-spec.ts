import { apiFetch, startTestServer } from './helpers/server';

describe('GraphQL endpoint', () => {
  let server: Awaited<ReturnType<typeof startTestServer>>;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await apiFetch(server.baseUrl, '/graphql', {
      body: {
        query: '{ __typename }',
      },
    });
    expect(res.status).toBe(401);
  });

  it('rejects non-admin client keys with 401', async () => {
    const res = await apiFetch(server.baseUrl, '/graphql', {
      token: server.clientKey,
      body: {
        query: '{ __typename }',
      },
    });
    expect(res.status).toBe(401);
  });

  it('allows admin key and answers queries', async () => {
    const res = await apiFetch(server.baseUrl, '/graphql', {
      token: server.adminKey,
      body: {
        query: `
          query Q($filter: TokenStatsFilterInput!) {
            tokenUsageStats(filter: $filter) {
              summary {
                totalTokens
              }
            }
          }
        `,
        variables: {
          filter: {
            range: 'CUSTOM',
            from: 1790812800000,
            to: 1790899200000,
          },
        },
      },
    });

    expect(res.status).toBe(200);
    expect(res.body.data?.tokenUsageStats?.summary).toBeDefined();
    expect(typeof res.body.data.tokenUsageStats.summary.totalTokens).toBe('number');
  });
});

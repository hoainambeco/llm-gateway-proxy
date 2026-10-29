import nock from 'nock';
import { apiFetch, startTestServer } from './helpers/server';

describe('Full Operational Lifecycle Workflow (E2E)', () => {
  let server: Awaited<ReturnType<typeof startTestServer>>;

  beforeAll(async () => {
    nock.disableNetConnect();
    nock.enableNetConnect(/(127\.0\.0\.1|localhost)/);
    server = await startTestServer({ accounts: [] });
  });

  afterAll(async () => {
    await server.close();
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('executes full operational lifecycle: create key -> add account -> route -> proxy inference -> audit record -> graphql analytics -> disable key', async () => {
    // -------------------------------------------------------------
    // Step 1: Create a client API Key via /internal/api-keys
    // -------------------------------------------------------------
    const createKeyRes = await apiFetch(server.baseUrl, '/internal/api-keys', {
      method: 'POST',
      token: server.adminKey,
      body: {
        name: 'Deep Lifecycle Client Key',
        role: 'client',
      },
    });

    expect(createKeyRes.status).toBe(201);
    expect(createKeyRes.body.success).toBe(true);
    const clientKey = createKeyRes.body.data.key;
    const clientKeyId = createKeyRes.body.data.id;
    expect(clientKey).toMatch(/^sk-ag-[a-f0-9]{48}$/);

    // Verify key preview is masked in list query
    const listKeysRes = await apiFetch(server.baseUrl, '/internal/api-keys', {
      token: server.adminKey,
    });
    expect(listKeysRes.status).toBe(200);
    const createdKeyEntry = listKeysRes.body.data.find((k: any) => k.id === clientKeyId);
    expect(createdKeyEntry).toBeDefined();
    expect(createdKeyEntry.key).toMatch(/^sk-ag-[a-f0-9]{2}\.\.\.[a-f0-9]{4}$/);

    // -------------------------------------------------------------
    // Step 2: Add an OpenAI Upstream Account via /internal/accounts
    // -------------------------------------------------------------
    const createAccountRes = await apiFetch(server.baseUrl, '/internal/accounts', {
      method: 'POST',
      token: server.adminKey,
      body: {
        provider: 'openai',
        email: 'lifecycle-test@openai.local',
        api_key: 'sk-test-lifecycle-openai-secret',
      },
    });

    expect(createAccountRes.status).toBe(201);
    const accountId = createAccountRes.body.data.id;
    expect(accountId).toBeDefined();

    // -------------------------------------------------------------
    // Step 3: Configure Routing Rules via /internal/routing
    // -------------------------------------------------------------
    const updateRoutingRes = await apiFetch(server.baseUrl, '/internal/routing', {
      method: 'POST',
      token: server.adminKey,
      body: {
        rules: [
          {
            pattern: '^(gpt-4o|o1|o3)',
            pipeline: ['openai_api'],
            description: 'Direct OpenAI pipeline for lifecycle test',
          },
        ],
        default_pipeline: ['openai_api'],
      },
    });
    expect([200, 201]).toContain(updateRoutingRes.status);

    // -------------------------------------------------------------
    // Step 4: Mock Upstream and Issue Proxy Request with Client Key
    // -------------------------------------------------------------
    const mockUpstreamScope = nock('https://api.openai.com')
      .post('/v1/chat/completions')
      .reply(200, {
        id: 'chatcmpl-lifecycle-99',
        object: 'chat.completion',
        created: 1790812800,
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'Lifecycle verification complete. System is fully operational.',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 15,
          completion_tokens: 25,
          total_tokens: 40,
        },
      });

    const proxyRes = await apiFetch(server.baseUrl, '/v1/chat/completions', {
      token: clientKey,
      body: {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Run complete operational lifecycle check.' }],
      },
    });

    expect(proxyRes.status).toBe(200);
    expect(proxyRes.body.choices[0].message.content).toBe(
      'Lifecycle verification complete. System is fully operational.',
    );
    expect(proxyRes.body.usage.total_tokens).toBe(40);
    expect(mockUpstreamScope.isDone()).toBe(true);

    // -------------------------------------------------------------
    // Step 5: Verify SQLite Audit Log Recorded the Inference
    // -------------------------------------------------------------
    const auditRes = await apiFetch(
      server.baseUrl,
      `/internal/audit/requests?apiKeyId=${clientKeyId}`,
      { token: server.adminKey },
    );

    expect(auditRes.status).toBe(200);
    expect(auditRes.body.total).toBeGreaterThanOrEqual(1);
    const auditEntry = auditRes.body.data[0];
    expect(auditEntry.model).toBe('gpt-4o');
    expect(auditEntry.totalTokens).toBe(40);
    expect(auditEntry.promptTokens).toBe(15);
    expect(auditEntry.completionTokens).toBe(25);
    expect(auditEntry.status).toBe(200);

    // -------------------------------------------------------------
    // Step 6: Verify GraphQL Token Analytics Returns Accurate Usage
    // -------------------------------------------------------------
    const graphqlQuery = `
      query GetTokenUsage($apiKeyId: String!) {
        tokenUsageStats(filter: { range: TWENTY_FOUR_HOURS, apiKeyId: $apiKeyId }) {
          summary {
            totalTokens
            promptTokens
            completionTokens
            totalRequests
            successfulRequests
          }
          byModel {
            model
            totalTokens
          }
        }
      }
    `;

    const gqlRes = await apiFetch(server.baseUrl, '/graphql', {
      token: server.adminKey,
      body: {
        query: graphqlQuery,
        variables: { apiKeyId: clientKeyId },
      },
    });

    expect(gqlRes.status).toBe(200);
    expect(gqlRes.body.data).toBeDefined();
    const stats = gqlRes.body.data.tokenUsageStats;
    expect(stats.summary.totalTokens).toBe(40);
    expect(stats.summary.promptTokens).toBe(15);
    expect(stats.summary.completionTokens).toBe(25);
    expect(stats.summary.successfulRequests).toBe(1);
    expect(stats.byModel.some((m: any) => m.model === 'gpt-4o')).toBe(true);

    // -------------------------------------------------------------
    // Step 7: Deactivate Key and Verify Immediate Rejection
    // -------------------------------------------------------------
    const toggleRes = await apiFetch(server.baseUrl, `/internal/api-keys/${clientKeyId}`, {
      method: 'PATCH',
      token: server.adminKey,
      body: { isActive: false },
    });
    expect(toggleRes.status).toBe(200);
    expect(toggleRes.body.data.isActive).toBe(false);

    // Proxy request must now be rejected immediately
    const disabledProxyRes = await apiFetch(server.baseUrl, '/v1/chat/completions', {
      token: clientKey,
      body: {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Should fail' }],
      },
    });
    expect(disabledProxyRes.status).toBe(401);
    expect(disabledProxyRes.body.error.message).toContain('disabled');

    // -------------------------------------------------------------
    // Step 8: Delete Key and Clean Up
    // -------------------------------------------------------------
    const deleteKeyRes = await apiFetch(server.baseUrl, `/internal/api-keys/${clientKeyId}`, {
      method: 'DELETE',
      token: server.adminKey,
    });
    expect(deleteKeyRes.status).toBe(200);

    const checkDeletedRes = await apiFetch(server.baseUrl, `/internal/api-keys/${clientKeyId}`, {
      token: server.adminKey,
    });
    expect(checkDeletedRes.status).toBe(404);
  });
});

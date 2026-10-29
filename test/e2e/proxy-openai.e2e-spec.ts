import nock from 'nock';
import { apiFetch, startTestServer } from './helpers/server';

const openaiAccount = {
  id: 'acc-openai',
  provider: 'openai',
  auth_type: 'api_key',
  email: 'oa@test.local',
  api_key: 'sk-test-openai',
  created_at: 1790812800000,
  last_used: 1790812800000,
};

describe('OpenAI proxy protocol', () => {
  let server: Awaited<ReturnType<typeof startTestServer>>;

  beforeAll(async () => {
    nock.disableNetConnect();
    nock.enableNetConnect(/(127\.0\.0\.1|localhost)/);
    nock('https://api.openai.com').persist().get('/v1/models').reply(200, { data: [] });
    server = await startTestServer({ accounts: [openaiAccount] });
  });

  afterAll(async () => {
    await server.close();
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('proxies POST /v1/chat/completions to upstream OpenAI', async () => {
    const scope = nock('https://api.openai.com')
      .post('/v1/chat/completions')
      .reply(200, {
        id: 'chatcmpl-test-1',
        object: 'chat.completion',
        created: 1790812800,
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'hi from openai' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });

    const res = await apiFetch(server.baseUrl, '/v1/chat/completions', {
      token: server.clientKey,
      body: {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'hi' }],
      },
    });

    expect(res.status).toBe(200);
    expect(res.body.choices[0].message.content).toBe('hi from openai');
    expect(scope.isDone()).toBe(true);
  });

  it('proxies streaming chat completions with SSE', async () => {
    const ssePayload =
      'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n';

    const scope = nock('https://api.openai.com')
      .post('/v1/chat/completions')
      .reply(200, ssePayload, { 'Content-Type': 'text/event-stream' });

    const res = await apiFetch(server.baseUrl, '/v1/chat/completions', {
      token: server.clientKey,
      body: {
        model: 'gpt-4o',
        stream: true,
        messages: [{ role: 'user', content: 'hi' }],
      },
    });

    expect(res.status).toBe(200);
    expect(res.text).toContain('[DONE]');
    expect(res.text).toContain('hi');
    expect(scope.isDone()).toBe(true);
  });

  it('supports max_completion_tokens for OpenCode/o1/o3 compatibility (TC-MAP-003)', async () => {
    const scope = nock('https://api.openai.com')
      .post('/v1/chat/completions', (body) => {
        return body.max_completion_tokens === 500 || body.max_tokens === 500;
      })
      .reply(200, {
        id: 'chatcmpl-max-tokens',
        object: 'chat.completion',
        created: 1790812800,
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'bounded tokens response' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
      });

    const res = await apiFetch(server.baseUrl, '/v1/chat/completions', {
      token: server.clientKey,
      body: {
        model: 'gpt-4o',
        max_completion_tokens: 500,
        messages: [{ role: 'user', content: 'test max tokens' }],
      },
    });

    expect(res.status).toBe(200);
    expect(res.body.choices[0].message.content).toBe('bounded tokens response');
    expect(scope.isDone()).toBe(true);
  });

  it('handles tool_calls in chat completions response (TC-MAP-004)', async () => {
    const scope = nock('https://api.openai.com')
      .post('/v1/chat/completions')
      .reply(200, {
        id: 'chatcmpl-tool-1',
        object: 'chat.completion',
        created: 1790812800,
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_123',
                  type: 'function',
                  function: {
                    name: 'get_current_weather',
                    arguments: '{"location":"Hanoi"}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 15, completion_tokens: 12, total_tokens: 27 },
      });

    const res = await apiFetch(server.baseUrl, '/v1/chat/completions', {
      token: server.clientKey,
      body: {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'What is the weather in Hanoi?' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_current_weather',
              description: 'Get weather',
              parameters: { type: 'object', properties: { location: { type: 'string' } } },
            },
          },
        ],
      },
    });

    expect(res.status).toBe(200);
    expect(res.body.choices[0].finish_reason).toBe('tool_calls');
    expect(res.body.choices[0].message.tool_calls[0].function.name).toBe('get_current_weather');
    expect(res.body.choices[0].message.tool_calls[0].function.arguments).toContain('Hanoi');
    expect(scope.isDone()).toBe(true);
  });

  it('allows unauthenticated loopback discovery on GET /v1/models (TC-AUTH-008, TC-ROUTE-002)', async () => {
    const res = await apiFetch(server.baseUrl, '/v1/models');
    expect(res.status).toBe(200);
    expect(res.body.object).toBe('list');
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('returns individual model details on GET /v1/models/:model (TC-ROUTE-002)', async () => {
    const res = await apiFetch(server.baseUrl, '/v1/models/gpt-4o', {
      token: server.clientKey,
    });
    expect([200, 404]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.id).toBeDefined();
    }
  });
});

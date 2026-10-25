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
});

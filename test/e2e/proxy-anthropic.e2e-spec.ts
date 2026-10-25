import nock from 'nock';
import { apiFetch, startTestServer } from './helpers/server';

const anthropicAccount = {
  id: 'acc-anthropic',
  provider: 'anthropic',
  auth_type: 'api_key',
  email: 'an@test.local',
  api_key: 'sk-test-anthropic',
  created_at: 1790812800000,
  last_used: 1790812800000,
};

describe('Anthropic proxy protocol', () => {
  let server: Awaited<ReturnType<typeof startTestServer>>;

  beforeAll(async () => {
    nock.disableNetConnect();
    nock.enableNetConnect(/(127\.0\.0\.1|localhost)/);
    nock('https://api.anthropic.com')
      .persist()
      .get('/v1/models')
      .reply(200, { data: [] });
    server = await startTestServer({ accounts: [anthropicAccount] });
  });

  afterAll(async () => {
    await server.close();
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('proxies POST /v1/messages to upstream Anthropic', async () => {
    const scope = nock('https://api.anthropic.com')
      .post('/v1/messages')
      .reply(200, {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'hi from anthropic' }],
        model: 'claude-sonnet-4',
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
      });

    const res = await apiFetch(server.baseUrl, '/v1/messages', {
      headers: { 'x-api-key': server.clientKey },
      body: {
        model: 'claude-sonnet-4',
        max_tokens: 8,
        messages: [{ role: 'user', content: 'hi' }],
      },
    });

    expect(res.status).toBe(200);
    expect(res.body.content[0].text).toBe('hi from anthropic');
    expect(res.body.model).toBe('claude-sonnet-4');
    expect(scope.isDone()).toBe(true);
  });

  it('proxies streaming messages with SSE', async () => {
    const ssePayload =
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1"}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n';

    const scope = nock('https://api.anthropic.com')
      .post('/v1/messages')
      .reply(200, ssePayload, { 'Content-Type': 'text/event-stream' });

    const res = await apiFetch(server.baseUrl, '/v1/messages', {
      headers: { 'x-api-key': server.clientKey },
      body: {
        model: 'claude-sonnet-4',
        stream: true,
        max_tokens: 8,
        messages: [{ role: 'user', content: 'hi' }],
      },
    });

    expect(res.status).toBe(200);
    expect(res.text).toContain('message_start');
    expect(scope.isDone()).toBe(true);
  });
});

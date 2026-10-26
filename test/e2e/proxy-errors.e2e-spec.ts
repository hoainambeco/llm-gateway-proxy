import nock from 'nock';
import { apiFetch, startTestServer } from './helpers/server';

describe('proxy error handling', () => {
  let emptyServer: Awaited<ReturnType<typeof startTestServer>>;

  beforeAll(async () => {
    nock.disableNetConnect();
    nock.enableNetConnect(/(127\.0\.0\.1|localhost)/);
    emptyServer = await startTestServer({ accounts: [] });
  });

  afterAll(async () => {
    await emptyServer.close();
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('returns 401 when API key is missing across all model surfaces', async () => {
    const openaiRes = await apiFetch(emptyServer.baseUrl, '/v1/chat/completions', {
      body: { model: 'gemini-2.5-flash', messages: [{ role: 'user', content: 'hi' }] },
    });
    expect(openaiRes.status).toBe(401);
    expect(openaiRes.body.error).toBeDefined();

    const anthropicRes = await apiFetch(emptyServer.baseUrl, '/v1/messages', {
      body: { model: 'claude-sonnet-4', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] },
    });
    expect(anthropicRes.status).toBe(401);
    expect(anthropicRes.body.error).toBeDefined();

    const geminiRes = await apiFetch(
      emptyServer.baseUrl,
      '/v1beta/models/gemini-2.5-flash:generateContent',
      {
        body: { contents: [{ role: 'user', parts: [{ text: 'hi' }] }] },
      },
    );
    expect(geminiRes.status).toBe(401);
    expect(geminiRes.body.error).toBeDefined();
  });

  it('returns 503 or 400 when no accounts are available for the requested model', async () => {
    const res = await apiFetch(emptyServer.baseUrl, '/v1/chat/completions', {
      token: emptyServer.clientKey,
      body: { model: 'gemini-2.5-flash', messages: [{ role: 'user', content: 'hi' }] },
    });
    // With 0 accounts loaded, server rejects with unavailable error (503 / 400 / 500)
    expect([400, 500, 503]).toContain(res.status);
    expect(res.body.error).toBeDefined();
  });
});

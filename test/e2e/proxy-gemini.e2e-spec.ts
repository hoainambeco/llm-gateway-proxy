import nock from 'nock';
import { apiFetch, startTestServer } from './helpers/server';
import { GoogleAPIService } from '../../src/modules/cloud-account/services/GoogleAPIService';

const googleAccount = {
  id: 'acc-google',
  provider: 'google',
  auth_type: 'oauth',
  email: 'g@test.local',
  project_id: 'test-project',
  token: {
    access_token: 'test-google-token',
    refresh_token: 'test-refresh',
    expires_in: 3600,
    expiry_timestamp: 4102444800,
    token_type: 'Bearer',
    project_id: 'test-project',
  },
  created_at: 1790812800000,
  last_used: 1790812800000,
};

describe('Gemini proxy protocol', () => {
  let server: Awaited<ReturnType<typeof startTestServer>>;

  beforeAll(async () => {
    jest.spyOn(GoogleAPIService, 'fetchQuota').mockResolvedValue({
      models: {},
      subscription_tier: 'PAID',
    });

    nock.disableNetConnect();
    nock.enableNetConnect(/(127\.0\.0\.1|localhost)/);

    server = await startTestServer({ accounts: [googleAccount] });
  });

  afterAll(async () => {
    await server.close();
    nock.cleanAll();
    nock.enableNetConnect();
    jest.restoreAllMocks();
  });

  it('proxies POST /v1beta/models/:model:generateContent', async () => {
    const mockReply = {
      candidates: [
        {
          content: { parts: [{ text: 'hi from gemini' }], role: 'model' },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: {
        promptTokenCount: 1,
        candidatesTokenCount: 1,
        totalTokenCount: 2,
      },
    };

    nock('https://generativelanguage.googleapis.com')
      .post('/v1beta/models/gemini-2.5-flash:generateContent')
      .optionally()
      .reply(200, mockReply);

    nock('https://cloudcode-pa.googleapis.com')
      .post('/v1internal:generateContent')
      .optionally()
      .reply(200, mockReply);

    const res = await apiFetch(
      server.baseUrl,
      '/v1beta/models/gemini-2.5-flash:generateContent',
      {
        token: server.clientKey,
        body: {
          contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
        },
      },
    );

    expect(res.status).toBe(200);
    expect(res.body.candidates[0].content.parts[0].text).toBe('hi from gemini');
  });
});

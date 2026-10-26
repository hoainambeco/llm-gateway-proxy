import axios from 'axios';
import {
  GoogleAPIService,
  OAuthTokenRefreshError,
  GoogleUserInfoHttpError,
  extractOAuthErrorCode,
  isClientMismatchError,
} from './GoogleAPIService';
import { OAuthClientRegistryService } from './OAuthClientRegistryService';

describe('GoogleAPIService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.ANTIGRAVITY_OAUTH_CLIENT_ID = 'test-client-id';
    process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET = 'test-client-secret';
    OAuthClientRegistryService.resetStateForTesting();
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
    OAuthClientRegistryService.resetStateForTesting();
  });

  describe('extractOAuthErrorCode & isClientMismatchError', () => {
    it('extracts error code from JSON response', () => {
      expect(extractOAuthErrorCode('{"error": "invalid_grant"}')).toBe('invalid_grant');
      expect(extractOAuthErrorCode('{"error": "INVALID_CLIENT"}')).toBe('invalid_client');
    });

    it('falls back to substring search when JSON is not valid', () => {
      expect(extractOAuthErrorCode('some unauthorized_client error message')).toBe('unauthorized_client');
      expect(extractOAuthErrorCode('plain text with no match')).toBeNull();
    });

    it('identifies client mismatch errors correctly', () => {
      expect(isClientMismatchError('{"error": "invalid_client"}')).toBe(true);
      expect(isClientMismatchError('{"error": "unauthorized_client"}')).toBe(true);
      expect(isClientMismatchError('{"error": "deleted_client"}')).toBe(true);
      expect(isClientMismatchError('{"error": "invalid_grant"}')).toBe(false);
      expect(isClientMismatchError('some random error')).toBe(false);
    });
  });

  describe('Error Classes', () => {
    it('OAuthTokenRefreshError initializes with status, clientKey, code, and description', () => {
      const err = new OAuthTokenRefreshError('invalid_grant', 400, 'client-a', 'Bad token');
      expect(err.name).toBe('OAuthTokenRefreshError');
      expect(err.code).toBe('invalid_grant');
      expect(err.status).toBe(400);
      expect(err.clientKey).toBe('client-a');
      expect(err.description).toBe('Bad token');
      expect(err.message).toContain('Token refresh failed for OAuth client [client-a]: invalid_grant');
    });

    it('GoogleUserInfoHttpError holds HTTP status', () => {
      const err = new GoogleUserInfoHttpError(401);
      expect(err.name).toBe('GoogleUserInfoHttpError');
      expect(err.status).toBe(401);
      expect(err.message).toBe('Failed to fetch user info: HTTP 401');
    });
  });

  describe('getAuthUrl', () => {
    it('builds a valid Google OAuth URL with state registered', () => {
      const url = GoogleAPIService.getAuthUrl('antigravity_enterprise');
      const parsed = new URL(url);

      expect(parsed.origin).toBe('https://accounts.google.com');
      expect(parsed.searchParams.get('client_id')).toBe('test-client-id');
      expect(parsed.searchParams.get('access_type')).toBe('offline');
      expect(parsed.searchParams.get('prompt')).toBe('consent');
      expect(parsed.searchParams.get('state')).toBeTruthy();
    });
  });

  describe('exchangeCode', () => {
    it('successfully exchanges code for tokens', async () => {
      jest.spyOn(axios, 'request').mockResolvedValueOnce({
        status: 200,
        data: {
          access_token: 'acc-token-123',
          refresh_token: 'ref-token-456',
          expires_in: 3600,
          token_type: 'Bearer',
        },
      } as any);

      const tokens = await GoogleAPIService.exchangeCode('valid-auth-code');
      expect(tokens.access_token).toBe('acc-token-123');
      expect(tokens.refresh_token).toBe('ref-token-456');
      expect(tokens.expires_in).toBe(3600);
    });

    it('falls back to next client if first candidate returns client mismatch error', async () => {
      process.env.ANTIGRAVITY_OAUTH_CLIENTS = 'client2|id2|sec2|Client 2';
      OAuthClientRegistryService.resetStateForTesting();

      jest.spyOn(axios, 'request')
        .mockResolvedValueOnce({
          status: 400,
          data: { error: 'invalid_client' },
        } as any)
        .mockResolvedValueOnce({
          status: 200,
          data: {
            access_token: 'fallback-token',
            expires_in: 3600,
            token_type: 'Bearer',
          },
        } as any);

      const tokens = await GoogleAPIService.exchangeCode('test-code');
      expect(tokens.access_token).toBe('fallback-token');
      expect(tokens.oauth_client_key).toBe('client2');
    });

    it('throws error when exchange fails with non-mismatch error', async () => {
      jest.spyOn(axios, 'request').mockResolvedValueOnce({
        status: 400,
        data: { error: 'invalid_grant' },
      } as any);

      await expect(GoogleAPIService.exchangeCode('bad-code')).rejects.toThrow(
        /Token exchange failed for client/,
      );
    });
  });

  describe('refreshAccessToken', () => {
    it('refreshes token successfully on 200 response', async () => {
      jest.spyOn(axios, 'request').mockResolvedValueOnce({
        status: 200,
        data: {
          access_token: 'refreshed-access-token',
          expires_in: 3600,
          token_type: 'Bearer',
        },
      } as any);

      const result = await GoogleAPIService.refreshAccessToken('valid-refresh-token');
      expect(result.access_token).toBe('refreshed-access-token');
      expect(result.expires_in).toBe(3600);
    });

    it('retries once on invalid_grant before throwing OAuthTokenRefreshError', async () => {
      const axiosSpy = jest.spyOn(axios, 'request').mockResolvedValue({
        status: 400,
        data: { error: 'invalid_grant', error_description: 'Token has been expired or revoked' },
      } as any);

      await expect(
        GoogleAPIService.refreshAccessToken('revoked-refresh-token'),
      ).rejects.toThrow(OAuthTokenRefreshError);

      // 2 attempts for the client
      expect(axiosSpy).toHaveBeenCalledTimes(2);
    });

    it('falls back to next client on client mismatch error', async () => {
      process.env.ANTIGRAVITY_OAUTH_CLIENTS = 'second_client|sec_id|sec_secret|Second';
      OAuthClientRegistryService.resetStateForTesting();

      jest.spyOn(axios, 'request')
        .mockResolvedValueOnce({
          status: 400,
          data: { error: 'invalid_client' },
        } as any)
        .mockResolvedValueOnce({
          status: 200,
          data: {
            access_token: 'second-client-token',
            expires_in: 3600,
            token_type: 'Bearer',
          },
        } as any);

      const result = await GoogleAPIService.refreshAccessToken('rt-multi');
      expect(result.access_token).toBe('second-client-token');
      expect(result.oauth_client_key).toBe('second_client');
    });
  });

  describe('getUserInfo', () => {
    it('returns parsed user info on 200 response', async () => {
      jest.spyOn(axios, 'request').mockResolvedValueOnce({
        status: 200,
        data: {
          id: 'google-user-123',
          email: 'developer@example.com',
          name: 'Google Dev',
          picture: 'https://avatar.google.com/dev.png',
        },
      } as any);

      const info = await GoogleAPIService.getUserInfo('mock-access-token');
      expect(info.id).toBe('google-user-123');
      expect(info.email).toBe('developer@example.com');
      expect(info.name).toBe('Google Dev');
    });

    it('throws GoogleUserInfoHttpError on non-200 HTTP response', async () => {
      jest.spyOn(axios, 'request').mockResolvedValueOnce({
        status: 401,
        data: { error: 'unauthorized' },
      } as any);

      await expect(GoogleAPIService.getUserInfo('bad-token')).rejects.toThrow(
        GoogleUserInfoHttpError,
      );
    });

    it('throws error when user info JSON is malformed', async () => {
      jest.spyOn(axios, 'request').mockResolvedValueOnce({
        status: 200,
        data: 'not a valid user info object',
      } as any);

      await expect(GoogleAPIService.getUserInfo('token-malformed')).rejects.toThrow(
        'Received malformed user info from Google APIs',
      );
    });
  });

  describe('fetchProjectContext & fetchProjectId', () => {
    it('fetches project context and falls back through endpoints if first fails', async () => {
      jest.spyOn(axios, 'request')
        .mockResolvedValueOnce({
          status: 500,
          data: 'Internal Server Error',
        } as any)
        .mockResolvedValueOnce({
          status: 200,
          data: {
            cloudaicompanionProject: 'gcp-project-alpha',
            paidTier: { name: 'TIER_PRO' },
          },
        } as any);

      const context = await GoogleAPIService.fetchProjectContext('valid-token');
      expect(context.projectId).toBe('gcp-project-alpha');
      expect(context.subscriptionTier).toBe('TIER_PRO');
    });

    it('fetches project ID via fetchProjectId', async () => {
      jest.spyOn(GoogleAPIService, 'fetchProjectContext').mockResolvedValueOnce({
        projectId: 'gcp-project-alpha',
        subscriptionTier: 'TIER_PRO',
      });

      const projectId = await GoogleAPIService.fetchProjectId('valid-token');
      expect(projectId).toBe('gcp-project-alpha');
    });

    it('throws error if all project endpoints fail', async () => {
      jest.spyOn(axios, 'request').mockResolvedValue({
        status: 403,
        data: 'Forbidden project',
      } as any);

      await expect(GoogleAPIService.fetchProjectContext('token-forbidden')).rejects.toThrow();
    });
  });

  describe('fetchAICredits', () => {
    it('returns credits and expiry date on 200 response', async () => {
      jest.spyOn(axios, 'request').mockResolvedValueOnce({
        status: 200,
        data: {
          paidTier: {
            availableCredits: [{ creditAmount: 500 }],
          },
        },
      } as any);

      const credits = await GoogleAPIService.fetchAICredits('token-credits');
      expect(credits).toEqual({
        credits: 500,
        expiryDate: '',
      });
    });

    it('throws UNAUTHORIZED on 401 response', async () => {
      jest.spyOn(axios, 'request').mockResolvedValueOnce({
        status: 401,
        data: 'Unauthorized',
      } as any);

      await expect(GoogleAPIService.fetchAICredits('expired-token')).rejects.toThrow('UNAUTHORIZED');
    });

    it('returns null on general failure', async () => {
      jest.spyOn(axios, 'request').mockResolvedValueOnce({
        status: 500,
        data: 'Error',
      } as any);

      const result = await GoogleAPIService.fetchAICredits('token-error');
      expect(result).toBeNull();
    });
  });

  describe('fetchQuota', () => {
    it('fetches quota and quota summary successfully', async () => {
      // Mock fetchProjectContext
      jest.spyOn(GoogleAPIService, 'fetchProjectContext').mockResolvedValueOnce({
        projectId: 'proj-123',
        subscriptionTier: 'ENTERPRISE',
      });

      // Mock fetchAvailableModels and retrieveUserQuotaSummary
      jest.spyOn(axios, 'request')
        .mockResolvedValueOnce({
          status: 200,
          data: {
            models: {
              'gemini-2.5-pro': {
                quotaInfo: {
                  remainingFraction: 0.8,
                  resetTime: '2026-01-01T00:00:00Z',
                },
              },
            },
            deprecatedModelIds: {
              'gemini-1.5-pro': { newModelId: 'gemini-2.5-pro' },
            },
          },
        } as any)
        .mockResolvedValueOnce({
          status: 200,
          data: {
            groups: [
              {
                displayName: 'gemini-group',
                buckets: [
                  {
                    bucketId: 'b1',
                    remainingFraction: 0.9,
                  },
                ],
              },
            ],
          },
        } as any);

      const quota = await GoogleAPIService.fetchQuota('token-quota');
      expect(quota.subscription_tier).toBe('ENTERPRISE');
      expect(quota.models['gemini-2.5-pro']).toBeDefined();
      expect(quota.model_forwarding_rules?.['gemini-1.5-pro']).toBe('gemini-2.5-pro');
      expect(quota.quota_groups).toBeDefined();
    });

    it('retries without project ID when Quota API returns 403 with project ID', async () => {
      jest.spyOn(GoogleAPIService, 'fetchProjectContext').mockResolvedValueOnce({
        projectId: 'blocked-proj',
      });

      // First call with project returns 403, retry without project succeeds
      jest.spyOn(axios, 'request')
        .mockResolvedValueOnce({
          status: 403,
          data: 'Forbidden project',
        } as any)
        .mockResolvedValueOnce({
          status: 200,
          data: {
            models: {
              'gemini-2.5-flash': {
                quotaInfo: { remainingFraction: 1.0 },
              },
            },
          },
        } as any)
        .mockResolvedValueOnce({
          status: 200,
          data: {},
        } as any);

      const quota = await GoogleAPIService.fetchQuota('token-proj-retry');
      expect(quota.models['gemini-2.5-flash']).toBeDefined();
    });

    it('throws UNAUTHORIZED or FORBIDDEN immediately without retrying all endpoints', async () => {
      jest.spyOn(GoogleAPIService, 'fetchProjectContext').mockResolvedValueOnce({});

      // 401 returns immediately
      jest.spyOn(axios, 'request').mockResolvedValueOnce({
        status: 401,
        data: 'Unauthorized',
      } as any);

      await expect(GoogleAPIService.fetchQuota('unauthorized-token')).rejects.toThrow('UNAUTHORIZED');

      // 403 without project returns FORBIDDEN
      jest.spyOn(axios, 'request').mockResolvedValueOnce({
        status: 403,
        data: 'Forbidden',
      } as any);

      await expect(GoogleAPIService.fetchQuota('forbidden-token')).rejects.toThrow('FORBIDDEN');
    });
  });

  describe('Proxy URL Parsing in getAxiosOptions', () => {
    it('configures axios proxy option when proxyUrl is supplied', async () => {
      const axiosSpy = jest.spyOn(axios, 'request').mockResolvedValueOnce({
        status: 200,
        data: {
          access_token: 'tok-proxied',
          expires_in: 3600,
          token_type: 'Bearer',
        },
      } as any);

      await GoogleAPIService.refreshAccessToken(
        'rt-proxy',
        'http://admin:secret@127.0.0.1:8080',
      );

      expect(axiosSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          proxy: {
            host: '127.0.0.1',
            port: 8080,
            protocol: 'http',
            auth: {
              username: 'admin',
              password: 'secret',
            },
          },
        }),
      );
    });

    it('throws error for unsupported proxy protocol', async () => {
      await expect(
        GoogleAPIService.refreshAccessToken('rt-ftp', 'ftp://127.0.0.1:21'),
      ).rejects.toThrow('Unsupported HTTP proxy protocol: ftp:');
    });
  });
});

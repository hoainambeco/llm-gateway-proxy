import {
  CloudAccountRefreshService,
  CloudAccountRefreshBlockedError,
  createCloudAccountRefreshRequest,
  isRetryableInvalidGrantRefreshError,
  CLOUD_ACCOUNT_REAUTH_REQUIRED_REASON,
} from './CloudAccountRefreshService';
import { CloudAccountHealthService, evictAccountFromActiveLeaseCache, syncAccountOAuthHealthToActiveLeaseCache } from './CloudAccountHealthService';
import { GoogleAPIService, OAuthTokenRefreshError } from './GoogleAPIService';

jest.mock('./CloudAccountHealthService', () => ({
  CloudAccountHealthService: {
    getHealth: jest.fn(),
    mutateHealth: jest.fn(),
    resetStateForTesting: jest.fn(),
  },
  evictAccountFromActiveLeaseCache: jest.fn(),
  syncAccountOAuthHealthToActiveLeaseCache: jest.fn(),
}));

jest.mock('@/server/main', () => ({
  reloadNestServerAccountLeaseCache: jest.fn(),
}));

describe('CloudAccountRefreshService', () => {
  beforeEach(() => {
    CloudAccountRefreshService.resetStateForTesting();
    jest.clearAllMocks();
  });

  describe('createCloudAccountRefreshRequest', () => {
    it('constructs request object from cloud account', () => {
      const acct = {
        id: 'acc-123',
        proxy_url: 'http://proxy.local:8080',
        token: {
          refresh_token: 'refresh-xyz',
          oauth_client_key: 'custom-key',
        },
        health: {
          oauth: { refresh_blocked: false },
        },
      };

      const controller = new AbortController();
      const req = createCloudAccountRefreshRequest(acct as any, controller.signal);

      expect(req).toEqual({
        accountId: 'acc-123',
        refreshToken: 'refresh-xyz',
        proxyUrl: 'http://proxy.local:8080',
        oauthClientKey: 'custom-key',
        health: acct.health,
        signal: controller.signal,
      });
    });
  });

  describe('isRetryableInvalidGrantRefreshError', () => {
    it('returns true for OAuthTokenRefreshError with invalid_grant', () => {
      const err = new OAuthTokenRefreshError('invalid_grant', 400, 'client-key', 'expired');
      expect(isRetryableInvalidGrantRefreshError(err)).toBe(true);
    });

    it('returns false for other errors', () => {
      expect(isRetryableInvalidGrantRefreshError(new OAuthTokenRefreshError('invalid_client', 400, 'client-key'))).toBe(false);
      expect(isRetryableInvalidGrantRefreshError(new Error('general error'))).toBe(false);
      expect(isRetryableInvalidGrantRefreshError(null)).toBe(false);
    });
  });

  describe('refreshAccessToken', () => {
    it('throws CloudAccountRefreshBlockedError immediately if account refresh is already blocked', async () => {
      (CloudAccountHealthService.getHealth as jest.Mock).mockResolvedValueOnce({
        oauth: { refresh_blocked: true },
      });
      const spy = jest.spyOn(GoogleAPIService, 'refreshAccessToken');

      await expect(
        CloudAccountRefreshService.refreshAccessToken({
          accountId: 'acc-blocked',
          refreshToken: 'rt-1',
        }),
      ).rejects.toThrow(CloudAccountRefreshBlockedError);

      expect(spy).not.toHaveBeenCalled();
    });

    it('refreshes token successfully and clears existing oauth health', async () => {
      (CloudAccountHealthService.getHealth as jest.Mock).mockResolvedValueOnce({
        oauth: { refresh_blocked: false, invalid_grant_count: 1 },
      });
      jest.spyOn(GoogleAPIService, 'refreshAccessToken').mockResolvedValueOnce({
        access_token: 'new-access-token',
        expires_in: 3600,
        token_type: 'Bearer',
      });
      (CloudAccountHealthService.mutateHealth as jest.Mock).mockImplementationOnce(async (_id, mutator) => {
        return mutator({
          oauth: { refresh_blocked: false, invalid_grant_count: 1 },
          validation: { status: 'requires_action', reason: 'VALIDATION_REQUIRED' },
        });
      });

      const result = await CloudAccountRefreshService.refreshAccessToken({
        accountId: 'acc-recover',
        refreshToken: 'rt-1',
        proxyUrl: 'http://proxy.test',
        oauthClientKey: 'key-1',
      });

      expect(result.access_token).toBe('new-access-token');
      expect(GoogleAPIService.refreshAccessToken).toHaveBeenCalledWith(
        'rt-1',
        'http://proxy.test',
        'key-1',
      );
      expect(CloudAccountHealthService.mutateHealth).toHaveBeenCalledWith('acc-recover', expect.any(Function));
      expect(syncAccountOAuthHealthToActiveLeaseCache).toHaveBeenCalledWith('acc-recover', undefined);
    });

    it('refreshes token successfully passing AbortSignal when provided', async () => {
      (CloudAccountHealthService.getHealth as jest.Mock).mockResolvedValueOnce(undefined);
      jest.spyOn(GoogleAPIService, 'refreshAccessToken').mockResolvedValueOnce({
        access_token: 'new-token-with-signal',
        expires_in: 3600,
        token_type: 'Bearer',
      });

      const controller = new AbortController();
      const result = await CloudAccountRefreshService.refreshAccessToken({
        accountId: 'acc-signal',
        refreshToken: 'rt-signal',
        signal: controller.signal,
      });

      expect(result.access_token).toBe('new-token-with-signal');
      expect(GoogleAPIService.refreshAccessToken).toHaveBeenCalledWith(
        'rt-signal',
        undefined,
        undefined,
        controller.signal,
      );
    });

    it('rethrows unexpected non-invalid_grant errors without updating health', async () => {
      (CloudAccountHealthService.getHealth as jest.Mock).mockResolvedValueOnce(undefined);
      const networkError = new Error('Network timeout');
      jest.spyOn(GoogleAPIService, 'refreshAccessToken').mockRejectedValueOnce(networkError);

      await expect(
        CloudAccountRefreshService.refreshAccessToken({
          accountId: 'acc-net-err',
          refreshToken: 'rt-net',
        }),
      ).rejects.toThrow('Network timeout');

      expect(CloudAccountHealthService.mutateHealth).not.toHaveBeenCalled();
    });

    it('first invalid_grant failure: increments failure count and rethrows original error', async () => {
      (CloudAccountHealthService.getHealth as jest.Mock).mockResolvedValueOnce(undefined);
      const grantError = new OAuthTokenRefreshError('invalid_grant', 400, 'client-key', 'token expired');
      jest.spyOn(GoogleAPIService, 'refreshAccessToken').mockRejectedValueOnce(grantError);

      (CloudAccountHealthService.mutateHealth as jest.Mock).mockImplementationOnce(async (_id, mutator) => {
        return mutator(undefined);
      });

      await expect(
        CloudAccountRefreshService.refreshAccessToken({
          accountId: 'acc-grant-1',
          refreshToken: 'rt-fail-1',
        }),
      ).rejects.toThrow(grantError);

      expect(CloudAccountHealthService.mutateHealth).toHaveBeenCalledWith('acc-grant-1', expect.any(Function));
      expect(syncAccountOAuthHealthToActiveLeaseCache).toHaveBeenCalledWith(
        'acc-grant-1',
        expect.objectContaining({
          refresh_blocked: false,
          invalid_grant_count: 1,
          reason: 'invalid_grant',
        }),
      );
      expect(evictAccountFromActiveLeaseCache).not.toHaveBeenCalled();
    });

    it('second invalid_grant failure: blocks refresh, evicts from cache, throws CloudAccountRefreshBlockedError', async () => {
      (CloudAccountHealthService.getHealth as jest.Mock).mockResolvedValueOnce({
        oauth: { refresh_blocked: false, invalid_grant_count: 1 },
      });
      const grantError = new OAuthTokenRefreshError('invalid_grant', 400, 'client-key', 'revoked');
      jest.spyOn(GoogleAPIService, 'refreshAccessToken').mockRejectedValueOnce(grantError);

      (CloudAccountHealthService.mutateHealth as jest.Mock).mockImplementationOnce(async (_id, mutator) => {
        return mutator({ oauth: { refresh_blocked: false, invalid_grant_count: 1 } });
      });

      await expect(
        CloudAccountRefreshService.refreshAccessToken({
          accountId: 'acc-grant-2',
          refreshToken: 'rt-fail-2',
        }),
      ).rejects.toThrow(CloudAccountRefreshBlockedError);

      expect(evictAccountFromActiveLeaseCache).toHaveBeenCalledWith('acc-grant-2');
    });
  });

  describe('clearFailureState', () => {
    it('clears oauth failure state and triggers reload of lease cache', async () => {
      (CloudAccountHealthService.getHealth as jest.Mock).mockResolvedValueOnce({
        oauth: { refresh_blocked: true, invalid_grant_count: 2 },
      });
      const { reloadNestServerAccountLeaseCache } = await import('@/server/main');

      await CloudAccountRefreshService.clearFailureState('acc-clear');

      expect(CloudAccountHealthService.mutateHealth).toHaveBeenCalledWith('acc-clear', expect.any(Function));
      expect(reloadNestServerAccountLeaseCache).toHaveBeenCalled();
    });

    it('does not mutate health if health.oauth was not set, but still reloads cache', async () => {
      (CloudAccountHealthService.getHealth as jest.Mock).mockResolvedValueOnce(undefined);
      const { reloadNestServerAccountLeaseCache } = await import('@/server/main');

      await CloudAccountRefreshService.clearFailureState('acc-no-health');

      expect(CloudAccountHealthService.mutateHealth).not.toHaveBeenCalled();
      expect(reloadNestServerAccountLeaseCache).toHaveBeenCalled();
    });
  });

  describe('CLOUD_ACCOUNT_REAUTH_REQUIRED_REASON', () => {
    it('defines standard constant string', () => {
      expect(CLOUD_ACCOUNT_REAUTH_REQUIRED_REASON).toContain('invalid_grant');
    });
  });
});

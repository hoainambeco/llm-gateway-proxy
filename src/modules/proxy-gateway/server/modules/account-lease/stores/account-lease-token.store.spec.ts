import { AccountLeaseTokenCache } from './account-lease-token.store';
import type { CloudAccount } from '@/modules/cloud-account/types';
import type { AccountLeaseTokenData } from '../interfaces/account-lease-token-types';

describe('AccountLeaseTokenCache', () => {
  let tokenCacheMap: Map<string, AccountLeaseTokenData>;
  let mockAccountStore: { getAccounts: jest.Mock };
  let mockApplyQuotaSnapshot: jest.Mock;
  let mockLogger: { error: jest.Mock; log: jest.Mock };
  let cache: AccountLeaseTokenCache;

  const validAccount: CloudAccount = {
    id: 'acc-1',
    provider: 'google',
    email: 'acc1@test.com',
    token: {
      access_token: 'access-1',
      refresh_token: 'refresh-1',
      token_type: 'Bearer',
      expires_in: 3600,
      expiry_timestamp: 1700000000, // seconds
      project_id: 'my-proj',
      session_id: 'existing-sess-123',
    },
    created_at: 1000,
    last_used: 1000,
  };

  beforeEach(() => {
    tokenCacheMap = new Map();
    mockAccountStore = {
      getAccounts: jest.fn().mockResolvedValue([validAccount]),
    };
    mockApplyQuotaSnapshot = jest.fn();
    mockLogger = {
      error: jest.fn(),
      log: jest.fn(),
    };

    cache = new AccountLeaseTokenCache({
      accountStore: mockAccountStore as any,
      getTokenCache: () => tokenCacheMap,
      applyQuotaSnapshot: mockApplyQuotaSnapshot,
      logger: mockLogger,
    });
  });

  describe('loadAccounts and loadAccountsOrThrow', () => {
    it('loads valid accounts into tokenCache and logs count', async () => {
      const count = await cache.loadAccounts();
      expect(count).toBe(1);
      expect(tokenCacheMap.size).toBe(1);
      expect(tokenCacheMap.get('acc-1')?.email).toBe('acc1@test.com');
      expect(mockLogger.log).toHaveBeenCalledWith('Account lease loaded 1 cloud accounts into cache');
    });

    it('handles store error gracefully in loadAccounts and returns 0', async () => {
      mockAccountStore.getAccounts.mockRejectedValue(new Error('Store read error'));

      const count = await cache.loadAccounts();
      expect(count).toBe(0);
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('re-throws store error in loadAccountsOrThrow after logging', async () => {
      const error = new Error('Database locked');
      mockAccountStore.getAccounts.mockRejectedValue(error);

      await expect(cache.loadAccountsOrThrow()).rejects.toThrow('Database locked');
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('mapAccountToTokenData', () => {
    it('returns null if account has no token or refresh is blocked', () => {
      expect(cache.mapAccountToTokenData({ id: 'no-token' } as CloudAccount)).toBeNull();

      const blockedAccount: CloudAccount = {
        ...validAccount,
        health: { oauth: { refresh_blocked: true } },
      };
      expect(cache.mapAccountToTokenData(blockedAccount)).toBeNull();
    });

    it('converts millisecond expiry timestamp to seconds', () => {
      const msExpiry = 1700000000 * 1000; // millisecond timestamp (> 1e12)
      const accountWithMs: CloudAccount = {
        ...validAccount,
        token: {
          ...validAccount.token!,
          expiry_timestamp: msExpiry,
        },
      };

      const mapped = cache.mapAccountToTokenData(accountWithMs);
      expect(mapped?.expiry_timestamp).toBe(1700000000);
    });

    it('handles non-numeric or missing expiry timestamp by returning 0', () => {
      const accountNoExpiry: CloudAccount = {
        ...validAccount,
        token: {
          ...validAccount.token!,
          expiry_timestamp: undefined,
        },
      };

      const mapped = cache.mapAccountToTokenData(accountNoExpiry);
      expect(mapped?.expiry_timestamp).toBe(0);
    });

    it('generates random session_id if none was provided in token', () => {
      const accountNoSession: CloudAccount = {
        ...validAccount,
        token: {
          ...validAccount.token!,
          session_id: undefined,
        },
      };

      const mapped = cache.mapAccountToTokenData(accountNoSession);
      expect(mapped?.session_id).toBeDefined();
      expect(mapped?.session_id).toMatch(/^-\d+$/); // negative bigint string
    });

    it('applies quota snapshot and registers dynamic model specs if quota models exist', () => {
      const accountWithQuota: CloudAccount = {
        ...validAccount,
        quota: {
          models: {
            'gemini-3.7-flash': {
              percentage: 0.8,
              resetTime: '2026-02-01T00:00:00Z',
            },
          },
        },
      };

      const mapped = cache.mapAccountToTokenData(accountWithQuota);
      expect(mapped).not.toBeNull();
      expect(mockApplyQuotaSnapshot).toHaveBeenCalled();
      expect(mapped?.model_quotas).toBeDefined();
    });
  });
});

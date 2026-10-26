import {
  RedisAccountLeaseTokenStore,
  REDIS_TOKEN_KEY_PREFIX,
} from './redis-account-lease-token.store';
import { FakeRedis } from '../../../../../../../test/helpers/fake-redis';
import type { AccountLeaseTokenData } from '../interfaces/account-lease-token-types';

describe('RedisAccountLeaseTokenStore', () => {
  let fakeRedis: FakeRedis;
  let mockAccountStore: any;
  let store: RedisAccountLeaseTokenStore;

  const sampleTokenData: AccountLeaseTokenData = {
    account_id: 'acc-1',
    email: 'user1@example.com',
    access_token: 'at-1',
    refresh_token: 'rt-1',
    token_type: 'Bearer',
    expires_in: 3600,
    expiry_timestamp: Math.floor(Date.now() / 1000) + 3600,
    model_quotas: {},
    model_limits: {},
    model_reset_times: {},
    model_forwarding_rules: {},
  };

  beforeEach(() => {
    fakeRedis = new FakeRedis();
    mockAccountStore = {
      getAccounts: jest.fn().mockResolvedValue([
        {
          id: 'acc-1',
          email: 'user1@example.com',
          token: {
            access_token: 'at-1',
            refresh_token: 'rt-1',
            expiry_timestamp: Math.floor(Date.now() / 1000) + 3600,
          },
        },
      ]),
    };
    store = new RedisAccountLeaseTokenStore({
      accountStore: mockAccountStore,
      redisClient: fakeRedis as any,
    });
  });

  it('saves and retrieves token data with TTL', async () => {
    await store.saveTokenData(sampleTokenData);

    const retrieved = await store.getTokenData('acc-1');
    expect(retrieved).toEqual(sampleTokenData);
  });

  it('returns null for missing or invalid JSON token data', async () => {
    expect(await store.getTokenData('non-existent')).toBeNull();

    await fakeRedis.set(`${REDIS_TOKEN_KEY_PREFIX}corrupt`, 'invalid-json');
    expect(await store.getTokenData('corrupt')).toBeNull();
  });

  it('removes token data upon request', async () => {
    await store.saveTokenData(sampleTokenData);
    expect(await store.getTokenData('acc-1')).not.toBeNull();

    await store.removeTokenData('acc-1');
    expect(await store.getTokenData('acc-1')).toBeNull();
  });

  it('loads accounts from store into Redis', async () => {
    const count = await store.loadAccounts();
    expect(count).toBe(1);

    const fromRedis = await store.getTokenData('acc-1');
    expect(fromRedis?.account_id).toBe('acc-1');
    expect(fromRedis?.access_token).toBe('at-1');
  });

  it('handles loadAccounts error gracefully returning 0', async () => {
    mockAccountStore.getAccounts.mockRejectedValueOnce(new Error('DB failure'));
    const count = await store.loadAccounts();
    expect(count).toBe(0);
  });

  it('operates safely as no-op when Redis is unavailable', async () => {
    const noRedisStore = new RedisAccountLeaseTokenStore({
      accountStore: mockAccountStore,
      redisClient: undefined,
    });

    expect(await noRedisStore.getTokenData('acc-1')).toBeNull();
    await expect(noRedisStore.saveTokenData(sampleTokenData)).resolves.not.toThrow();
    await expect(noRedisStore.removeTokenData('acc-1')).resolves.not.toThrow();
  });
});

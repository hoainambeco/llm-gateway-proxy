import type { Redis } from 'ioredis';
import type { CloudAccount } from '@/modules/cloud-account/types';
import type { AccountLeaseAccountStore } from '../interfaces/account-lease-adapters';
import type { AccountLeaseTokenData } from '../interfaces/account-lease-token-types';
import { AccountLeaseTokenCache } from './account-lease-token.store';
import { getRedisClient } from '@/shared/persistence/redis-client';
import { logger } from '@/shared/logging/logger';

export const REDIS_TOKEN_KEY_PREFIX = 'ag:lease-token:';

export interface RedisAccountLeaseTokenStoreOptions {
  accountStore: AccountLeaseAccountStore;
  getTokenCache?: () => Map<string, AccountLeaseTokenData>;
  applyQuotaSnapshot?: (snapshot: any) => void;
  redisClient?: Redis;
}

export class RedisAccountLeaseTokenStore {
  private readonly localCache: AccountLeaseTokenCache;
  private readonly customRedis?: Redis;

  constructor(private readonly options: RedisAccountLeaseTokenStoreOptions) {
    this.customRedis = options.redisClient;
    this.localCache = new AccountLeaseTokenCache({
      accountStore: options.accountStore,
      getTokenCache: options.getTokenCache ?? (() => new Map()),
      applyQuotaSnapshot: options.applyQuotaSnapshot ?? (() => {}),
      logger: {
        error: (msg, err) => logger.error(msg, err),
        log: (msg) => logger.info(msg),
      },
    });
  }

  private async getRedis(): Promise<Redis | null> {
    return this.customRedis ?? (await getRedisClient());
  }

  mapAccountToTokenData(account: CloudAccount): AccountLeaseTokenData | null {
    return this.localCache.mapAccountToTokenData(account);
  }

  async loadAccounts(): Promise<number> {
    try {
      return await this.loadAccountsOrThrow();
    } catch {
      return 0;
    }
  }

  async loadAccountsOrThrow(): Promise<number> {
    const accounts = await this.options.accountStore.getAccounts();
    const redis = await this.getRedis();
    let count = 0;

    for (const account of accounts) {
      const tokenData = this.mapAccountToTokenData(account);
      if (tokenData) {
        count++;
        if (redis) {
          await this.saveTokenData(tokenData);
        }
      }
    }

    return count;
  }

  async getTokenData(accountId: string): Promise<AccountLeaseTokenData | null> {
    const redis = await this.getRedis();
    if (!redis) {
      return null;
    }
    const raw = await redis.get(`${REDIS_TOKEN_KEY_PREFIX}${accountId}`);
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as AccountLeaseTokenData;
    } catch {
      return null;
    }
  }

  async saveTokenData(tokenData: AccountLeaseTokenData): Promise<void> {
    const redis = await this.getRedis();
    if (!redis) {
      return;
    }
    const key = `${REDIS_TOKEN_KEY_PREFIX}${tokenData.account_id}`;
    const serialized = JSON.stringify(tokenData);
    const ttlSeconds = Math.max(0, tokenData.expiry_timestamp - Math.floor(Date.now() / 1000));
    if (ttlSeconds > 0) {
      await redis.set(key, serialized, 'EX', ttlSeconds);
    } else {
      await redis.set(key, serialized);
    }
  }

  async removeTokenData(accountId: string): Promise<void> {
    const redis = await this.getRedis();
    if (redis) {
      await redis.del(`${REDIS_TOKEN_KEY_PREFIX}${accountId}`);
    }
  }
}

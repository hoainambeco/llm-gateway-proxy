import type { Redis } from 'ioredis';
import { logger } from '@/shared/logging/logger';

let redisInstance: Redis | null = null;

/**
 * Returns a shared Redis client if REDIS_URL is configured, or null otherwise.
 * Dynamic import ensures ioredis is only loaded when opt-in multi-node state sharing is active.
 */
export async function getRedisClient(): Promise<Redis | null> {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) {
    return null;
  }

  if (redisInstance) {
    return redisInstance;
  }

  try {
    const { default: RedisClass } = await import('ioredis');
    redisInstance = new RedisClass(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableReadyCheck: false,
    });
    return redisInstance;
  } catch (error) {
    logger.error('[RedisClient] Failed to initialize Redis client:', error);
    return null;
  }
}

/**
 * Gracefully disconnects the shared Redis client if connected.
 */
export async function closeRedisClient(): Promise<void> {
  if (redisInstance) {
    const client = redisInstance;
    redisInstance = null;
    try {
      await client.quit();
    } catch {
      client.disconnect();
    }
  }
}

export function setRedisClientForTesting(client: any): void {
  redisInstance = client;
}

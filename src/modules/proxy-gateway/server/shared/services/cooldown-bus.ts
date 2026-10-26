import type { Redis } from 'ioredis';
import { logger } from '@/shared/logging/logger';
import { getRedisClient } from '@/shared/persistence/redis-client';

export const REDIS_COOLDOWN_CHANNEL = 'ag:cooldown';
export const COOLDOWN_BUS_TOKEN = 'COOLDOWN_BUS';

export interface CooldownPayload {
  accountId: string;
  untilMs: number;
  model?: string;
  sourceNodeId?: string;
}

export interface CooldownBus {
  publishCooldown(accountId: string, untilMs: number, model?: string): Promise<void>;
  subscribe(handler: (accountId: string, untilMs: number, model?: string) => void): () => void;
}

export class NoopCooldownBus implements CooldownBus {
  async publishCooldown(_accountId?: string, _untilMs?: number, _model?: string): Promise<void> {}

  subscribe(_handler?: (accountId: string, untilMs: number, model?: string) => void): () => void {
    return () => {};
  }
}

export class RedisCooldownBus implements CooldownBus {
  private readonly subscribers = new Set<
    (accountId: string, untilMs: number, model?: string) => void
  >();
  private isSubscribed = false;
  private subscriptionPromise: Promise<void> | null = null;

  constructor(
    private readonly publisher?: Redis,
    private readonly subscriber?: Redis,
    private readonly nodeId: string = Math.random().toString(36).slice(2),
  ) {}

  async init(): Promise<void> {
    this.ensureSubscription();
    if (this.subscriptionPromise) {
      await this.subscriptionPromise;
    }
  }

  async publishCooldown(accountId: string, untilMs: number, model?: string): Promise<void> {
    try {
      const pub = this.publisher ?? (await getRedisClient());
      if (!pub) {
        return;
      }

      const payload: CooldownPayload = {
        accountId,
        untilMs,
        model,
        sourceNodeId: this.nodeId,
      };
      await pub.publish(REDIS_COOLDOWN_CHANNEL, JSON.stringify(payload));
    } catch (err) {
      logger.warn('[CooldownBus] Failed to publish cooldown to Redis:', err);
    }
  }

  subscribe(handler: (accountId: string, untilMs: number, model?: string) => void): () => void {
    this.subscribers.add(handler);
    this.ensureSubscription();

    return () => {
      this.subscribers.delete(handler);
    };
  }

  private ensureSubscription(): void {
    if (this.isSubscribed) {
      return;
    }
    this.isSubscribed = true;

    this.subscriptionPromise = (async () => {
      try {
        const sub = this.subscriber ?? (await getRedisClient());
        if (!sub) {
          return;
        }

        sub.on('message', (channel: string, message: string) => {
          if (channel !== REDIS_COOLDOWN_CHANNEL) {
            return;
          }
          try {
            const payload = JSON.parse(message) as CooldownPayload;
            if (payload.sourceNodeId === this.nodeId) {
              return; // ignore self-broadcast
            }
            for (const handler of this.subscribers) {
              handler(payload.accountId, payload.untilMs, payload.model);
            }
          } catch {
            // ignore malformed payloads
          }
        });

        await sub.subscribe(REDIS_COOLDOWN_CHANNEL);
      } catch (err) {
        logger.warn('[CooldownBus] Failed to subscribe to Redis channel:', err);
      }
    })();
  }
}

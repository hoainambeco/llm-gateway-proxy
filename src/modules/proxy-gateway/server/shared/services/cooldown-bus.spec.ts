import {
  NoopCooldownBus,
  RedisCooldownBus,
} from './cooldown-bus';
import { FakeRedis } from '../../../../../../test/helpers/fake-redis';

describe('CooldownBus', () => {
  describe('NoopCooldownBus', () => {
    it('satisfies CooldownBus interface as a no-op', async () => {
      const bus = new NoopCooldownBus();
      let called = false;
      const unsubscribe = bus.subscribe(() => {
        called = true;
      });

      await expect(bus.publishCooldown('acc-1', 12345)).resolves.not.toThrow();
      expect(called).toBe(false);
      expect(() => unsubscribe()).not.toThrow();
    });
  });

  describe('RedisCooldownBus', () => {
    let pubRedis: FakeRedis;
    let subRedis: FakeRedis;

    beforeEach(() => {
      pubRedis = new FakeRedis();
      subRedis = new FakeRedis();
    });

    afterEach(() => {
      pubRedis.disconnect();
      subRedis.disconnect();
    });

    it('publishes cooldown event to Redis and notifies subscribers across nodes', async () => {
      const nodeA = new RedisCooldownBus(pubRedis as any, pubRedis as any, 'node-a');
      const nodeB = new RedisCooldownBus(subRedis as any, subRedis as any, 'node-b');

      const received: Array<{ accountId: string; untilMs: number; model?: string }> = [];
      nodeB.subscribe((accountId, untilMs, model) => {
        received.push({ accountId, untilMs, model });
      });

      await nodeA.publishCooldown('acc-alpha', 50000, 'gemini-2.5-pro');

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({
        accountId: 'acc-alpha',
        untilMs: 50000,
        model: 'gemini-2.5-pro',
      });
    });

    it('ignores self-broadcast messages matching nodeId', async () => {
      const singleNode = new RedisCooldownBus(pubRedis as any, pubRedis as any, 'node-self');

      let received = false;
      singleNode.subscribe(() => {
        received = true;
      });

      await singleNode.publishCooldown('acc-self', 99999);
      expect(received).toBe(false);
    });

    it('unsubscribes handler cleanly', async () => {
      const nodeA = new RedisCooldownBus(pubRedis as any, pubRedis as any, 'node-a');
      const nodeB = new RedisCooldownBus(subRedis as any, subRedis as any, 'node-b');

      let callCount = 0;
      const unsubscribe = nodeB.subscribe(() => {
        callCount++;
      });

      await nodeA.publishCooldown('acc-1', 1000);
      expect(callCount).toBe(1);

      unsubscribe();
      await nodeA.publishCooldown('acc-2', 2000);
      expect(callCount).toBe(1);
    });

    it('handles publish error gracefully without throwing', async () => {
      jest.spyOn(pubRedis, 'publish').mockRejectedValueOnce(new Error('Redis connection severed'));
      const bus = new RedisCooldownBus(pubRedis as any, subRedis as any, 'node-err');

      await expect(bus.publishCooldown('acc-fail', 1000)).resolves.not.toThrow();
    });
  });
});

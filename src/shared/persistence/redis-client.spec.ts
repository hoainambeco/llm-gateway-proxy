import {
  getRedisClient,
  closeRedisClient,
  setRedisClientForTesting,
} from './redis-client';
import { FakeRedis } from '../../../test/helpers/fake-redis';

describe('redis-client', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.REDIS_URL;
    setRedisClientForTesting(null);
  });

  afterEach(async () => {
    await closeRedisClient();
    process.env = originalEnv;
    setRedisClientForTesting(null);
  });

  it('returns null when REDIS_URL is not set', async () => {
    const client = await getRedisClient();
    expect(client).toBeNull();
  });

  it('initializes and caches Redis instance when REDIS_URL is provided', async () => {
    process.env.REDIS_URL = 'redis://127.0.0.1:6379';

    const client1 = await getRedisClient();
    expect(client1).not.toBeNull();

    const client2 = await getRedisClient();
    expect(client2).toBe(client1);
  });

  it('closes active Redis client gracefully', async () => {
    const fake = new FakeRedis();
    const quitSpy = jest.spyOn(fake, 'quit');
    setRedisClientForTesting(fake as any);

    await closeRedisClient();
    expect(quitSpy).toHaveBeenCalled();

    // Calling close again is safe
    await closeRedisClient();
  });

  it('handles quit failure by calling disconnect', async () => {
    const fake = new FakeRedis();
    jest.spyOn(fake, 'quit').mockRejectedValueOnce(new Error('Quit failed'));
    const disconnectSpy = jest.spyOn(fake, 'disconnect');
    setRedisClientForTesting(fake as any);

    await closeRedisClient();
    expect(disconnectSpy).toHaveBeenCalled();
  });
});

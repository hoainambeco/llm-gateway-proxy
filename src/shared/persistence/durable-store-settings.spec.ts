import {
  isDurableStoreTestEnvironment,
  readPositiveIntegerEnv,
} from './durable-store-settings';

describe('durable-store-settings', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('isDurableStoreTestEnvironment', () => {
    it('returns true when NODE_ENV is test', () => {
      process.env.NODE_ENV = 'test';
      delete process.env.VITEST;
      expect(isDurableStoreTestEnvironment()).toBe(true);
    });

    it('returns true when VITEST is true', () => {
      process.env.NODE_ENV = 'production';
      process.env.VITEST = 'true';
      expect(isDurableStoreTestEnvironment()).toBe(true);
    });

    it('returns false when neither test nor vitest', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.VITEST;
      expect(isDurableStoreTestEnvironment()).toBe(false);
    });
  });

  describe('readPositiveIntegerEnv', () => {
    it('returns fallback when env var is not set', () => {
      delete process.env.MY_NUM;
      expect(readPositiveIntegerEnv('MY_NUM', 42)).toBe(42);
    });

    it('parses valid positive integer', () => {
      process.env.MY_NUM = '100';
      expect(readPositiveIntegerEnv('MY_NUM', 42)).toBe(100);
    });

    it('returns fallback for zero, negative, non-integer, or garbage strings', () => {
      process.env.MY_NUM = '0';
      expect(readPositiveIntegerEnv('MY_NUM', 42)).toBe(42);

      process.env.MY_NUM = '-5';
      expect(readPositiveIntegerEnv('MY_NUM', 42)).toBe(42);

      process.env.MY_NUM = '3.14';
      expect(readPositiveIntegerEnv('MY_NUM', 42)).toBe(42);

      process.env.MY_NUM = 'abc';
      expect(readPositiveIntegerEnv('MY_NUM', 42)).toBe(42);
    });
  });
});

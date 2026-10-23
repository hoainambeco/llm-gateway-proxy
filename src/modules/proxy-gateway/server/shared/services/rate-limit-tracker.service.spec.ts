import { RateLimitReason, RateLimitTrackerService } from './rate-limit-tracker.service';

describe('RateLimitTrackerService', () => {
  const FIXED_NOW = new Date('2026-01-15T12:00:00.000Z');

  let service: RateLimitTrackerService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(FIXED_NOW);
    service = new RateLimitTrackerService();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('is rate limited before the lockout expires and releases it afterwards', () => {
    const resetAt = new Date(FIXED_NOW.getTime() + 60_000).toISOString();

    expect(
      service.setLockoutUntilIso('account-1', resetAt, RateLimitReason.RateLimitExceeded),
    ).toBe(true);

    expect(service.isRateLimited('account-1')).toBe(true);
    expect(service.getRemainingWaitSec('account-1')).toBe(60);

    jest.advanceTimersByTime(30_000);

    expect(service.isRateLimited('account-1')).toBe(true);
    expect(service.getRemainingWaitSec('account-1')).toBe(30);

    jest.advanceTimersByTime(30_001);

    expect(service.isRateLimited('account-1')).toBe(false);
    expect(service.getRemainingWaitSec('account-1')).toBe(0);
  });

  it('scopes a model lockout to that model', () => {
    const resetAt = new Date(FIXED_NOW.getTime() + 45_000).toISOString();

    expect(
      service.setLockoutUntilIso(
        'account-1',
        resetAt,
        RateLimitReason.QuotaExhausted,
        'gemini-3-flash',
      ),
    ).toBe(true);

    expect(service.isRateLimited('account-1', 'gemini-3-flash')).toBe(true);
    expect(service.isRateLimited('account-1')).toBe(false);

    jest.advanceTimersByTime(45_001);

    expect(service.isRateLimited('account-1', 'gemini-3-flash')).toBe(false);
  });

  it('rejects an invalid ISO timestamp without creating a lockout', () => {
    expect(
      service.setLockoutUntilIso('account-1', 'not-a-date', RateLimitReason.RateLimitExceeded),
    ).toBe(false);
    expect(service.isRateLimited('account-1')).toBe(false);
  });
});

import {
  RateLimitReason,
  RateLimitTrackerService,
} from '../../../shared/services/rate-limit-tracker.service';
import type { AccountLeaseQuotaRefreshOutcome } from './account-lease-quota-refresh.policy';
import {
  AccountLeaseLimitPolicy,
  type AccountLeaseUpstreamErrorParams,
} from './account-lease-limit.policy';

const BASE_TIME = Date.parse('2026-01-01T00:00:00.000Z');
const FUTURE_RESET = '2030-06-01T00:00:00.000Z';

interface Harness {
  policy: AccountLeaseLimitPolicy;
  tracker: RateLimitTrackerService;
  logger: { warn: jest.Mock };
  refresh: jest.Mock;
  setPreciseLockout: jest.Mock;
}

function makeHarness(
  overrides: {
    refreshOutcome?: AccountLeaseQuotaRefreshOutcome;
    resolveAccountId?: (id: string) => string | null;
  } = {},
): Harness {
  const tracker = new RateLimitTrackerService();
  const logger = { warn: jest.fn() };
  const refresh = jest.fn().mockResolvedValue(overrides.refreshOutcome ?? 'recovered');
  const setPreciseLockout = jest.fn().mockReturnValue(false);
  const policy = new AccountLeaseLimitPolicy({
    rateLimitCooldownMs: 60_000,
    forbiddenCooldownMs: 300_000,
    resolveAccountId: overrides.resolveAccountId ?? ((id) => (id === 'user@test.local' ? 'acc-1' : null)),
    getCircuitBreakerBackoffSteps: () => [60, 300, 1800, 7200],
    refreshRealtimeQuotaAndReconcileLimit: refresh,
    setPreciseLockoutFromCachedQuota: setPreciseLockout,
    logger,
    rateLimitTracker: tracker,
  });
  return { policy, tracker, logger, refresh, setPreciseLockout };
}

function upstreamError(
  overrides: Partial<AccountLeaseUpstreamErrorParams> = {},
): AccountLeaseUpstreamErrorParams {
  return { accountIdOrEmail: 'user@test.local', ...overrides };
}

afterEach(() => {
  jest.useRealTimers();
});

describe('AccountLeaseLimitPolicy cooldowns', () => {
  it('applies a rate-limit cooldown for the configured window', () => {
    jest.useFakeTimers({ now: new Date(BASE_TIME) });
    const { policy, logger } = makeHarness();

    policy.markAsRateLimited('user@test.local');

    expect(policy.getAccountCooldowns().get('acc-1')).toBe(BASE_TIME + 60_000);
    expect(policy.isRateLimited('user@test.local')).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'Applied rate limited cooldown: source=user@test.local, accountId=acc-1, until=2026-01-01T00:01:00.000Z',
      ),
    );

    jest.setSystemTime(BASE_TIME + 60_001);

    expect(policy.isRateLimited('user@test.local')).toBe(false);
  });

  it('applies the longer forbidden cooldown for forbidden errors', () => {
    jest.useFakeTimers({ now: new Date(BASE_TIME) });
    const { policy, logger } = makeHarness();

    policy.markAsForbidden('user@test.local');

    expect(policy.getAccountCooldowns().get('acc-1')).toBe(BASE_TIME + 300_000);
    expect(policy.isRateLimited('user@test.local')).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Applied forbidden cooldown: source=user@test.local, accountId=acc-1'),
    );
  });

  it('falls back to the raw identifier when the account cannot be resolved', () => {
    const { policy } = makeHarness();

    policy.markAsRateLimited('unknown@external');

    expect(policy.getAccountCooldowns().has('unknown@external')).toBe(true);
  });

  it('exposes the shared tracker instance it was constructed with', () => {
    const { policy, tracker } = makeHarness();

    expect(policy.getRateLimitTracker()).toBe(tracker);
    expect(policy.getAccountCooldowns()).toBeInstanceOf(Map);
  });

  it('clears cooldowns and tracker lockouts via clearAllRateLimits', () => {
    const { policy, tracker } = makeHarness();
    policy.markAsRateLimited('user@test.local');
    tracker.setLockoutUntilIso('acc-1', FUTURE_RESET, RateLimitReason.ServerError);

    policy.clearAllRateLimits();

    expect(policy.getAccountCooldowns().size).toBe(0);
    expect(tracker.isRateLimited('acc-1')).toBe(false);
  });
});

describe('AccountLeaseLimitPolicy.clearRecoveredQuotaLocks', () => {
  it('clears model-family lockouts while the account cooldown remains when not recovered', () => {
    const { policy, tracker } = makeHarness();
    tracker.setLockoutUntilIso(
      'acc-1',
      FUTURE_RESET,
      RateLimitReason.QuotaExhausted,
      'gemini-3.5-flash',
    );
    policy.markAsRateLimited('user@test.local');

    policy.clearRecoveredQuotaLocks('acc-1', ['gemini-3.5-flash'], false);

    expect(tracker.isRateLimited('acc-1', 'gemini-3.5-flash')).toBe(false);
    expect(policy.isRateLimited('user@test.local')).toBe(true);
  });

  it('also drops the account cooldown and tracker state when the account recovered', () => {
    const { policy, tracker } = makeHarness();
    tracker.setLockoutUntilIso(
      'acc-1',
      FUTURE_RESET,
      RateLimitReason.QuotaExhausted,
      'gemini-3.5-flash',
    );
    tracker.setLockoutUntilIso('acc-1', FUTURE_RESET, RateLimitReason.ServerError);
    policy.markAsRateLimited('user@test.local');

    policy.clearRecoveredQuotaLocks('acc-1', ['gemini-3.5-flash'], true);

    expect(tracker.isRateLimited('acc-1', 'gemini-3.5-flash')).toBe(false);
    expect(tracker.isRateLimited('acc-1')).toBe(false);
    expect(policy.isRateLimited('user@test.local')).toBe(false);
  });
});

describe('AccountLeaseLimitPolicy.markModelSuccess', () => {
  it('clears both the model lockout and the account lockout, normalizing models/ ids', () => {
    const { policy, tracker } = makeHarness();
    tracker.setLockoutUntilIso(
      'acc-1',
      FUTURE_RESET,
      RateLimitReason.QuotaExhausted,
      'gemini-3.5-flash',
    );
    tracker.setLockoutUntilIso('acc-1', FUTURE_RESET, RateLimitReason.ServerError);
    expect(tracker.isRateLimited('acc-1', 'gemini-3.5-flash')).toBe(true);

    policy.markModelSuccess('user@test.local', 'models/gemini-3.5-flash');

    expect(tracker.isRateLimited('acc-1', 'gemini-3.5-flash')).toBe(false);
    expect(tracker.isRateLimited('acc-1')).toBe(false);
  });
});

describe('AccountLeaseLimitPolicy.markFromUpstreamError', () => {
  it('honors an explicit retry-after window without invoking the quota refresh path', async () => {
    const { policy, tracker, refresh, logger } = makeHarness();

    await policy.markFromUpstreamError(
      upstreamError({ status: 429, retryAfter: '30', model: 'models/gemini-3.5-flash' }),
    );

    expect(refresh).not.toHaveBeenCalled();
    expect(tracker.isRateLimited('acc-1')).toBe(true);
    expect(tracker.getRemainingWaitSeconds('acc-1')).toBe(30);
    expect(logger.warn).toHaveBeenCalledWith(
      'Recorded upstream limit for account acc-1: reason=unknown, wait=30s, model=gemini-3.5-flash',
    );
  });

  it('classifies a per-minute 429 as a rate limit and records a model-scoped lockout', async () => {
    const { policy, tracker, refresh, logger } = makeHarness();

    await policy.markFromUpstreamError(
      upstreamError({
        status: 429,
        body: 'Requests per minute exceeded for this model',
        model: 'models/gemini-3.5-flash',
      }),
    );

    expect(refresh).not.toHaveBeenCalled();
    expect(tracker.isRateLimited('acc-1', 'gemini-3.5-flash')).toBe(true);
    expect(tracker.getRemainingWaitSeconds('acc-1', 'gemini-3.5-flash')).toBe(5);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('treats a generic resource-exhausted 429 as a rate limit with a 30s lockout', async () => {
    const { policy, tracker, refresh } = makeHarness();

    await policy.markFromUpstreamError(
      upstreamError({
        status: 429,
        body: 'The resource has been exhausted',
        model: 'gemini-3.5-flash',
      }),
    );

    expect(refresh).not.toHaveBeenCalled();
    expect(tracker.getRemainingWaitSeconds('acc-1', 'gemini-3.5-flash')).toBe(30);
  });

  it('classifies a model_capacity 429 without entering the quota refresh path', async () => {
    const { policy, tracker, refresh } = makeHarness();

    await policy.markFromUpstreamError(
      upstreamError({ status: 429, body: 'model_capacity_exhausted', model: 'gemini-3.5-flash' }),
    );

    expect(refresh).not.toHaveBeenCalled();
    expect(tracker.isRateLimited('acc-1')).toBe(true);
    expect(tracker.getRemainingWaitSeconds('acc-1')).toBe(60);
  });

  it('attempts a precise lockout for a quota 429 and stops when the refresh recovers', async () => {
    const { policy, tracker, refresh, setPreciseLockout } = makeHarness({
      refreshOutcome: 'recovered',
    });

    await policy.markFromUpstreamError(
      upstreamError({ status: 429, body: 'quota exceeded', model: 'gemini-3.5-flash' }),
    );

    expect(refresh).toHaveBeenCalledWith('acc-1', RateLimitReason.QuotaExhausted, 'gemini-3.5-flash');
    expect(setPreciseLockout).not.toHaveBeenCalled();
    expect(tracker.isRateLimited('acc-1', 'gemini-3.5-flash')).toBe(false);
  });

  it('accepts a lockout established from the cached quota when the refresh is unavailable', async () => {
    const { policy, tracker, refresh, setPreciseLockout } = makeHarness({
      refreshOutcome: 'unavailable',
    });
    setPreciseLockout.mockReturnValue(true);

    await policy.markFromUpstreamError(
      upstreamError({ status: 429, body: 'quota exceeded', model: 'gemini-3.5-flash' }),
    );

    expect(refresh).toHaveBeenCalledWith('acc-1', RateLimitReason.QuotaExhausted, 'gemini-3.5-flash');
    expect(setPreciseLockout).toHaveBeenCalledWith(
      'acc-1',
      RateLimitReason.QuotaExhausted,
      'gemini-3.5-flash',
    );
    expect(tracker.isRateLimited('acc-1', 'gemini-3.5-flash')).toBe(false);
  });

  it('falls back to circuit-breaker backoff when refresh and cached lockout both fail', async () => {
    const { policy, tracker, refresh, setPreciseLockout, logger } = makeHarness({
      refreshOutcome: 'unavailable',
    });
    setPreciseLockout.mockReturnValue(false);

    await policy.markFromUpstreamError(
      upstreamError({ status: 429, body: 'quota exceeded', model: 'gemini-3.5-flash' }),
    );

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(setPreciseLockout).toHaveBeenCalledTimes(1);
    expect(tracker.getRemainingWaitSeconds('acc-1', 'gemini-3.5-flash')).toBe(60);
    expect(logger.warn).toHaveBeenCalledWith(
      'Recorded upstream limit for account acc-1: reason=quota_exhausted, wait=60s, model=gemini-3.5-flash',
    );
  });

  it('routes an unknown-reason 429 through the precise lockout attempt', async () => {
    const { policy, refresh, setPreciseLockout } = makeHarness({ refreshOutcome: 'locked' });

    await policy.markFromUpstreamError(
      upstreamError({ status: 429, body: undefined, model: 'gemini-3.5-flash' }),
    );

    expect(refresh).toHaveBeenCalledWith('acc-1', RateLimitReason.Unknown, 'gemini-3.5-flash');
    expect(setPreciseLockout).not.toHaveBeenCalled();
  });

  it('tracks 5xx responses as server errors with an 8s lockout', async () => {
    const { policy, tracker, refresh, logger } = makeHarness();

    await policy.markFromUpstreamError(
      upstreamError({ status: 503, body: 'service exploded' }),
    );

    expect(refresh).not.toHaveBeenCalled();
    expect(tracker.isRateLimited('acc-1')).toBe(true);
    expect(tracker.getRemainingWaitSeconds('acc-1')).toBe(8);
    expect(logger.warn).toHaveBeenCalledWith(
      'Recorded upstream limit for account acc-1: reason=server_error, wait=8s, model=n/a',
    );
  });

  it('tracks 404 responses with a 5s server-error lockout', async () => {
    const { policy, tracker } = makeHarness();

    await policy.markFromUpstreamError(upstreamError({ status: 404 }));

    expect(tracker.getRemainingWaitSeconds('acc-1')).toBe(5);
  });

  it('ignores statuses the tracker does not treat as rate signals', async () => {
    const { policy, tracker, logger } = makeHarness();

    await policy.markFromUpstreamError(
      upstreamError({ status: 400, body: 'bad request' }),
    );

    expect(tracker.isRateLimited('acc-1')).toBe(false);
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe('AccountLeaseLimitPolicy.markImageRateLimitFast', () => {
  it('returns true for a 429 carrying an explicit quota signal without a retry window', () => {
    const { policy, tracker } = makeHarness();

    const result = policy.markImageRateLimitFast(
      upstreamError({ status: 429, body: 'quota exceeded', model: 'models/gemini-3-pro-image' }),
    );

    expect(result).toBe(true);
    expect(tracker.isRateLimited('acc-1', 'models/gemini-3-pro-image')).toBe(true);
  });

  it('returns true for a 429 with an unrecognized body', () => {
    const { policy } = makeHarness();

    expect(
      policy.markImageRateLimitFast(upstreamError({ status: 429, body: 'try again later' })),
    ).toBe(true);
  });

  it('returns false when an explicit retry window is present', () => {
    const { policy } = makeHarness();

    expect(
      policy.markImageRateLimitFast(upstreamError({ status: 429, retryAfter: '10' })),
    ).toBe(false);
  });

  it('returns false for a plain rate-limit 429', () => {
    const { policy } = makeHarness();

    expect(
      policy.markImageRateLimitFast(upstreamError({ status: 429, body: 'rate limit hit' })),
    ).toBe(false);
  });

  it('returns false for non-429 statuses while still recording the limit', () => {
    const { policy, tracker } = makeHarness();

    const result = policy.markImageRateLimitFast(upstreamError({ status: 500 }));

    expect(result).toBe(false);
    expect(tracker.isRateLimited('acc-1')).toBe(true);
  });
});

describe('AccountLeaseLimitPolicy.reconcileImageRateLimit', () => {
  it('does not consult the cached quota when the refresh already produced a lockout', async () => {
    const { policy, refresh, setPreciseLockout } = makeHarness({ refreshOutcome: 'locked' });

    await policy.reconcileImageRateLimit(
      upstreamError({ status: 429, body: 'quota exceeded', model: 'gemini-3-pro-image' }),
    );

    expect(refresh).toHaveBeenCalledWith(
      'acc-1',
      RateLimitReason.QuotaExhausted,
      'gemini-3-pro-image',
    );
    expect(setPreciseLockout).not.toHaveBeenCalled();
  });

  it('falls back to the cached quota lockout when the refresh is unavailable', async () => {
    const { policy, refresh, setPreciseLockout } = makeHarness({ refreshOutcome: 'unavailable' });

    await policy.reconcileImageRateLimit(
      upstreamError({ status: 429, body: 'quota exceeded', model: 'gemini-3-pro-image' }),
    );

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(setPreciseLockout).toHaveBeenCalledWith(
      'acc-1',
      RateLimitReason.QuotaExhausted,
      'gemini-3-pro-image',
    );
  });
});

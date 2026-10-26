import type { CloudQuotaData } from '@/modules/cloud-account/types';
import { getDynamicModelSpecs } from '../../../../antigravity/ModelSpecs';
import { getDynamicForwardingTarget } from '../../../../antigravity/ModelMapping';
import { RateLimitReason } from '../../../shared/services/rate-limit-tracker.service';
import type {
  AccountLeaseAccountStore,
  AccountLeaseUpstream,
} from '../interfaces/account-lease-adapters';
import type { AccountLeaseTokenData } from '../interfaces/account-lease-token-types';
import { AccountLeaseQuotaRefreshPolicy } from './account-lease-quota-refresh.policy';

const FUTURE_RESET = '2030-06-01T00:00:00.000Z';

function makeToken(overrides: Partial<AccountLeaseTokenData> = {}): AccountLeaseTokenData {
  return {
    email: 'user@test.local',
    account_id: 'acc-1',
    access_token: 'access-1',
    refresh_token: 'refresh-1',
    token_type: 'Bearer',
    expires_in: 3600,
    expiry_timestamp: 2_000_000,
    model_quotas: {},
    model_limits: {},
    model_reset_times: {},
    model_forwarding_rules: {},
    ...overrides,
  };
}

interface Harness {
  policy: AccountLeaseQuotaRefreshPolicy;
  cache: Map<string, AccountLeaseTokenData>;
  logger: { warn: jest.Mock };
  upstream: { fetchQuota: jest.Mock };
  accountStore: { updateQuota: jest.Mock };
  setLockoutUntilIso: jest.Mock;
  clearRecoveredQuotaLocks: jest.Mock;
}

function makeHarness(token?: AccountLeaseTokenData): Harness {
  const cache = new Map<string, AccountLeaseTokenData>();
  if (token) {
    cache.set('acc-1', token);
  }
  const logger = { warn: jest.fn() };
  const upstream = { fetchQuota: jest.fn() };
  const accountStore = { updateQuota: jest.fn().mockResolvedValue(undefined) };
  const setLockoutUntilIso = jest.fn().mockReturnValue(true);
  const clearRecoveredQuotaLocks = jest.fn();
  const policy = new AccountLeaseQuotaRefreshPolicy({
    accountStore: accountStore as unknown as AccountLeaseAccountStore,
    upstream: upstream as unknown as AccountLeaseUpstream,
    getTokenCache: () => cache,
    setLockoutUntilIso,
    clearRecoveredQuotaLocks,
    logger,
  });
  return {
    policy,
    cache,
    logger,
    upstream,
    accountStore,
    setLockoutUntilIso,
    clearRecoveredQuotaLocks,
  };
}

describe('AccountLeaseQuotaRefreshPolicy.refreshRealtimeQuotaAndReconcileLimit', () => {
  it('reports unavailable when no token is cached for the account', async () => {
    const { policy, upstream } = makeHarness();

    await expect(
      policy.refreshRealtimeQuotaAndReconcileLimit('acc-1', RateLimitReason.QuotaExhausted),
    ).resolves.toBe('unavailable');
    expect(upstream.fetchQuota).not.toHaveBeenCalled();
  });

  it('reports unavailable and warns when the upstream quota fetch fails', async () => {
    const { policy, upstream, logger } = makeHarness(makeToken());
    upstream.fetchQuota.mockRejectedValue(new Error('quota endpoint down'));

    await expect(
      policy.refreshRealtimeQuotaAndReconcileLimit('acc-1', RateLimitReason.QuotaExhausted),
    ).resolves.toBe('unavailable');
    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to refresh realtime quota for account acc-1',
      expect.any(Error),
    );
  });

  it('recovers the account when the live quota shows every family above zero', async () => {
    const { policy, cache, upstream, accountStore, setLockoutUntilIso, clearRecoveredQuotaLocks } =
      makeHarness(makeToken());
    const quota: CloudQuotaData = {
      models: {
        'models/gemini-3.5-flash-low': {
          percentage: 40,
          resetTime: '2026-01-01T01:00:00Z',
          max_output_tokens: 4096,
        },
        'models/gemini-3.1-pro-high': {
          percentage: 90,
          resetTime: '2026-01-01T00:30:00Z',
        },
      },
    };
    upstream.fetchQuota.mockResolvedValue(quota);

    const outcome = await policy.refreshRealtimeQuotaAndReconcileLimit(
      'acc-1',
      RateLimitReason.QuotaExhausted,
      'models/gemini-3.5-flash',
    );

    expect(outcome).toBe('recovered');
    expect(accountStore.updateQuota).toHaveBeenCalledWith('acc-1', quota);
    expect(setLockoutUntilIso).not.toHaveBeenCalled();
    expect(clearRecoveredQuotaLocks).toHaveBeenCalledWith(
      'acc-1',
      ['gemini-3.5-flash-low', 'gemini-3.1-pro-high', 'gemini-3.5-flash'],
      true,
    );
    const cached = cache.get('acc-1');
    expect(cached?.quota).toBe(quota);
    expect(cached?.model_quotas).toEqual({
      'gemini-3.5-flash-low': 40,
      'gemini-3.1-pro-high': 90,
    });
    expect(cached?.model_limits).toEqual({ 'gemini-3.5-flash-low': 4096 });
    expect(cached?.model_reset_times).toEqual({
      'gemini-3.5-flash-low': '2026-01-01T01:00:00Z',
      'gemini-3.1-pro-high': '2026-01-01T00:30:00Z',
    });
    expect(getDynamicModelSpecs().has('models/gemini-3.5-flash-low')).toBe(true);
  });

  it('locks the requested family until its earliest reset when its quota is zero', async () => {
    const { policy, upstream, setLockoutUntilIso, clearRecoveredQuotaLocks } = makeHarness(
      makeToken(),
    );
    upstream.fetchQuota.mockResolvedValue({
      models: {
        'models/gemini-3.5-flash-low': {
          percentage: 0,
          resetTime: '2026-01-01T02:00:00Z',
        },
        'models/gemini-3.1-pro-high': {
          percentage: 90,
          resetTime: '2026-01-01T00:30:00Z',
        },
      },
    } satisfies CloudQuotaData);

    const outcome = await policy.refreshRealtimeQuotaAndReconcileLimit(
      'acc-1',
      RateLimitReason.QuotaExhausted,
      'models/gemini-3.5-flash-low',
    );

    expect(outcome).toBe('locked');
    expect(setLockoutUntilIso).toHaveBeenCalledWith(
      'acc-1',
      '2026-01-01T02:00:00Z',
      RateLimitReason.QuotaExhausted,
      'gemini-3.5-flash-low',
    );
    expect(clearRecoveredQuotaLocks).toHaveBeenCalledWith(
      'acc-1',
      ['gemini-3.1-pro-high'],
      false,
    );
  });

  it('reports unavailable when the precise lockout could not be established', async () => {
    const { policy, upstream, setLockoutUntilIso } = makeHarness(makeToken());
    setLockoutUntilIso.mockReturnValue(false);
    upstream.fetchQuota.mockResolvedValue({
      models: {
        'models/gemini-3.5-flash-low': {
          percentage: 0,
          resetTime: '2026-01-01T02:00:00Z',
        },
      },
    } satisfies CloudQuotaData);

    await expect(
      policy.refreshRealtimeQuotaAndReconcileLimit(
        'acc-1',
        RateLimitReason.QuotaExhausted,
        'gemini-3.5-flash-low',
      ),
    ).resolves.toBe('unavailable');
    expect(setLockoutUntilIso).toHaveBeenCalledTimes(1);
  });

  it('reports unavailable when the requested family is at zero with no reset time', async () => {
    const { policy, upstream, setLockoutUntilIso, clearRecoveredQuotaLocks } = makeHarness(
      makeToken(),
    );
    upstream.fetchQuota.mockResolvedValue({
      models: {
        'models/gemini-3.5-flash-low': { percentage: 0, resetTime: ' ' },
      },
    } satisfies CloudQuotaData);

    await expect(
      policy.refreshRealtimeQuotaAndReconcileLimit(
        'acc-1',
        RateLimitReason.QuotaExhausted,
        'gemini-3.5-flash-low',
      ),
    ).resolves.toBe('unavailable');
    expect(setLockoutUntilIso).not.toHaveBeenCalled();
    expect(clearRecoveredQuotaLocks).not.toHaveBeenCalled();
  });

  it('reports unavailable when the requested model family is absent from the snapshot', async () => {
    const { policy, upstream, setLockoutUntilIso } = makeHarness(makeToken());
    upstream.fetchQuota.mockResolvedValue({
      models: {
        'models/gemini-3.5-flash-low': {
          percentage: 80,
          resetTime: '2026-01-01T01:00:00Z',
        },
      },
    } satisfies CloudQuotaData);

    await expect(
      policy.refreshRealtimeQuotaAndReconcileLimit(
        'acc-1',
        RateLimitReason.QuotaExhausted,
        'claude-sonnet-4-6',
      ),
    ).resolves.toBe('unavailable');
    expect(setLockoutUntilIso).not.toHaveBeenCalled();
  });

  it('recovers the whole account when no model is requested and every family has quota', async () => {
    const { policy, upstream, setLockoutUntilIso } = makeHarness(makeToken());
    upstream.fetchQuota.mockResolvedValue({
      models: {
        'models/gemini-3.5-flash-low': {
          percentage: 80,
          resetTime: '2026-01-01T01:00:00Z',
        },
      },
    } satisfies CloudQuotaData);

    await expect(
      policy.refreshRealtimeQuotaAndReconcileLimit('acc-1', RateLimitReason.QuotaExhausted),
    ).resolves.toBe('recovered');
    expect(setLockoutUntilIso).not.toHaveBeenCalled();
  });

  it('locks account-wide until the earliest reset when no model is requested', async () => {
    const { policy, upstream, setLockoutUntilIso } = makeHarness(makeToken());
    upstream.fetchQuota.mockResolvedValue({
      models: {
        'models/gemini-3.5-flash-low': {
          percentage: 0,
          resetTime: '2026-01-01T02:00:00Z',
        },
        'models/gemini-3.1-pro-high': {
          percentage: 90,
          resetTime: '2026-01-01T00:30:00Z',
        },
      },
    } satisfies CloudQuotaData);

    await expect(
      policy.refreshRealtimeQuotaAndReconcileLimit('acc-1', RateLimitReason.QuotaExhausted),
    ).resolves.toBe('locked');
    expect(setLockoutUntilIso).toHaveBeenCalledWith(
      'acc-1',
      '2026-01-01T00:30:00Z',
      RateLimitReason.QuotaExhausted,
    );
  });

  it('reports unavailable account-wide when no reset time exists at all', async () => {
    const { policy, upstream, setLockoutUntilIso } = makeHarness(makeToken());
    upstream.fetchQuota.mockResolvedValue({
      models: { 'models/gemini-3.5-flash-low': { percentage: 0, resetTime: ' ' } },
    } satisfies CloudQuotaData);

    await expect(
      policy.refreshRealtimeQuotaAndReconcileLimit('acc-1', RateLimitReason.QuotaExhausted),
    ).resolves.toBe('unavailable');
    expect(setLockoutUntilIso).not.toHaveBeenCalled();
  });

  it('releases forwarded legacy models when their forwarding target recovered', async () => {
    const { policy, upstream, clearRecoveredQuotaLocks } = makeHarness(makeToken());
    upstream.fetchQuota.mockResolvedValue({
      models: {
        'models/gemini-3.5-flash-low': {
          percentage: 50,
          resetTime: '2026-01-01T01:00:00Z',
        },
      },
      model_forwarding_rules: {
        'models/qrf-legacy-flash': 'models/gemini-3.5-flash-low',
      },
    } satisfies CloudQuotaData);

    const outcome = await policy.refreshRealtimeQuotaAndReconcileLimit(
      'acc-1',
      RateLimitReason.QuotaExhausted,
      'qrf-legacy-flash',
    );

    expect(outcome).toBe('recovered');
    expect(clearRecoveredQuotaLocks).toHaveBeenCalledWith(
      'acc-1',
      ['gemini-3.5-flash-low', 'qrf-legacy-flash'],
      true,
    );
    expect(getDynamicForwardingTarget('qrf-legacy-flash')).toBe('gemini-3.5-flash-low');
  });

  it('fails closed for older snapshots carrying reset metadata without percentages', async () => {
    const { policy, upstream, setLockoutUntilIso } = makeHarness(makeToken());
    upstream.fetchQuota.mockResolvedValue({
      models: {
        'models/old-reset-model': { percentage: NaN, resetTime: '2026-01-01T04:00:00Z' },
      },
    } satisfies CloudQuotaData);

    const outcome = await policy.refreshRealtimeQuotaAndReconcileLimit(
      'acc-1',
      RateLimitReason.QuotaExhausted,
      'old-reset-model',
    );

    expect(outcome).toBe('locked');
    expect(setLockoutUntilIso).toHaveBeenCalledWith(
      'acc-1',
      '2026-01-01T04:00:00Z',
      RateLimitReason.QuotaExhausted,
      'old-reset-model',
    );
  });
});

describe('AccountLeaseQuotaRefreshPolicy.setPreciseLockoutFromCachedQuota', () => {
  it('returns false when no token is cached', () => {
    const { policy } = makeHarness();

    expect(
      policy.setPreciseLockoutFromCachedQuota('acc-1', RateLimitReason.QuotaExhausted),
    ).toBe(false);
  });

  it('locks a zero-quota family until the earliest of its reset times', () => {
    const { policy, setLockoutUntilIso } = makeHarness(
      makeToken({
        model_quotas: { 'gemini-3.5-flash-low': 0, 'gemini-3.5-flash-high': 0 },
        model_reset_times: {
          'gemini-3.5-flash-low': '2026-01-01T05:00:00Z',
          'gemini-3.5-flash-high': '2026-01-01T04:00:00Z',
        },
      }),
    );
    setLockoutUntilIso.mockReturnValue(true);

    expect(
      policy.setPreciseLockoutFromCachedQuota(
        'acc-1',
        RateLimitReason.QuotaExhausted,
        'gemini-3.5-flash-low',
      ),
    ).toBe(true);
    expect(setLockoutUntilIso).toHaveBeenCalledWith(
      'acc-1',
      '2026-01-01T04:00:00Z',
      RateLimitReason.QuotaExhausted,
      'gemini-3.5-flash-low',
    );
  });

  it('propagates a failed lockout attempt', () => {
    const { policy, setLockoutUntilIso } = makeHarness(
      makeToken({
        model_quotas: { 'gemini-3.5-flash-low': 0 },
        model_reset_times: { 'gemini-3.5-flash-low': FUTURE_RESET },
      }),
    );
    setLockoutUntilIso.mockReturnValue(false);

    expect(
      policy.setPreciseLockoutFromCachedQuota(
        'acc-1',
        RateLimitReason.QuotaExhausted,
        'gemini-3.5-flash-low',
      ),
    ).toBe(false);
  });

  it('returns false for a family that still has quota', () => {
    const { policy, setLockoutUntilIso } = makeHarness(
      makeToken({
        model_quotas: { 'gemini-3.5-flash-low': 55 },
        model_reset_times: { 'gemini-3.5-flash-low': FUTURE_RESET },
      }),
    );

    expect(
      policy.setPreciseLockoutFromCachedQuota(
        'acc-1',
        RateLimitReason.QuotaExhausted,
        'gemini-3.5-flash-low',
      ),
    ).toBe(false);
    expect(setLockoutUntilIso).not.toHaveBeenCalled();
  });

  it('returns false for a family missing from the cached snapshot', () => {
    const { policy, setLockoutUntilIso } = makeHarness(
      makeToken({
        model_quotas: { 'gemini-3.5-flash-low': 0 },
        model_reset_times: { 'gemini-3.5-flash-low': FUTURE_RESET },
      }),
    );

    expect(
      policy.setPreciseLockoutFromCachedQuota(
        'acc-1',
        RateLimitReason.QuotaExhausted,
        'claude-sonnet-4-6',
      ),
    ).toBe(false);
    expect(setLockoutUntilIso).not.toHaveBeenCalled();
  });

  it('resolves the family through a cached forwarding rule', () => {
    const { policy, setLockoutUntilIso } = makeHarness(
      makeToken({
        model_quotas: { 'gemini-3.5-flash-low': 0 },
        model_reset_times: { 'gemini-3.5-flash-low': '2026-01-01T05:00:00Z' },
        model_forwarding_rules: { 'qrf-alt-flash': 'gemini-3.5-flash-low' },
      }),
    );

    expect(
      policy.setPreciseLockoutFromCachedQuota(
        'acc-1',
        RateLimitReason.QuotaExhausted,
        'qrf-alt-flash',
      ),
    ).toBe(true);
    expect(setLockoutUntilIso).toHaveBeenCalledWith(
      'acc-1',
      '2026-01-01T05:00:00Z',
      RateLimitReason.QuotaExhausted,
      'qrf-alt-flash',
    );
  });

  it('terminates on cyclic forwarding rules and reports no lockout', () => {
    const { policy, setLockoutUntilIso } = makeHarness(
      makeToken({
        model_forwarding_rules: {
          'qrf-cyc-a': 'qrf-cyc-b',
          'qrf-cyc-b': 'qrf-cyc-a',
        },
      }),
    );

    expect(
      policy.setPreciseLockoutFromCachedQuota(
        'acc-1',
        RateLimitReason.QuotaExhausted,
        'qrf-cyc-a',
      ),
    ).toBe(false);
    expect(setLockoutUntilIso).not.toHaveBeenCalled();
  });

  it('uses the earliest cached reset time when no model is given', () => {
    const { policy, setLockoutUntilIso } = makeHarness(
      makeToken({
        model_quotas: { 'model-b': 0 },
        model_reset_times: {
          'model-b': '2026-01-01T07:00:00Z',
          'model-a': '2026-01-01T06:00:00Z',
        },
      }),
    );

    expect(policy.setPreciseLockoutFromCachedQuota('acc-1', RateLimitReason.QuotaExhausted)).toBe(
      true,
    );
    expect(setLockoutUntilIso).toHaveBeenCalledWith(
      'acc-1',
      '2026-01-01T06:00:00Z',
      RateLimitReason.QuotaExhausted,
      undefined,
    );
  });

  it('returns false when the cached snapshot has no usable reset time', () => {
    const { policy, setLockoutUntilIso } = makeHarness(
      makeToken({ model_quotas: {}, model_reset_times: { 'model-a': '   ' } }),
    );

    expect(policy.setPreciseLockoutFromCachedQuota('acc-1', RateLimitReason.QuotaExhausted)).toBe(
      false,
    );
    expect(setLockoutUntilIso).not.toHaveBeenCalled();
  });

  it('ignores whitespace-only reset metadata for a model family', () => {
    const { policy, setLockoutUntilIso } = makeHarness(
      makeToken({
        model_quotas: { 'x-model': 0 },
        model_reset_times: { 'x-model': '  ' },
      }),
    );

    expect(
      policy.setPreciseLockoutFromCachedQuota(
        'acc-1',
        RateLimitReason.QuotaExhausted,
        'x-model',
      ),
    ).toBe(false);
    expect(setLockoutUntilIso).not.toHaveBeenCalled();
  });
});

describe('AccountLeaseQuotaRefreshPolicy.syncAccountQuota', () => {
  it('returns false when no token is cached', async () => {
    const { policy } = makeHarness();

    await expect(policy.syncAccountQuota('acc-1')).resolves.toBe(false);
  });

  it('persists the live quota, updates the cache and applies forwarding rules', async () => {
    const { policy, cache, upstream, accountStore } = makeHarness(makeToken());
    const quota: CloudQuotaData = {
      models: {
        'models/qrf-sync-model': {
          percentage: 75,
          resetTime: '2026-01-01T01:00:00Z',
        },
      },
      model_forwarding_rules: { 'models/qrf-dyn-old': 'models/qrf-dyn-new' },
    };
    upstream.fetchQuota.mockResolvedValue(quota);

    await expect(policy.syncAccountQuota('acc-1')).resolves.toBe(true);

    expect(accountStore.updateQuota).toHaveBeenCalledWith('acc-1', quota);
    const cached = cache.get('acc-1');
    expect(cached?.model_quotas).toEqual({ 'qrf-sync-model': 75 });
    expect(cached?.model_reset_times).toEqual({ 'qrf-sync-model': '2026-01-01T01:00:00Z' });
    expect(cached?.model_forwarding_rules).toEqual({ 'qrf-dyn-old': 'qrf-dyn-new' });
    expect(getDynamicForwardingTarget('qrf-dyn-old')).toBe('qrf-dyn-new');
    expect(getDynamicModelSpecs().has('models/qrf-sync-model')).toBe(true);
  });

  it('returns false and warns when the upstream quota fetch fails', async () => {
    const { policy, upstream, logger } = makeHarness(makeToken());
    upstream.fetchQuota.mockRejectedValue(new Error('boom'));

    await expect(policy.syncAccountQuota('acc-1')).resolves.toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to sync quota for account acc-1',
      expect.any(Error),
    );
  });
});

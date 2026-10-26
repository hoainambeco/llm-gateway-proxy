import type { CloudQuotaData } from '@/modules/cloud-account/types';
import {
  buildAccountLeaseQuotaSnapshot,
  findEarliestQuotaResetTime,
} from './account-lease-quota.policy';

describe('buildAccountLeaseQuotaSnapshot', () => {
  it('returns an empty snapshot for undefined input', () => {
    expect(buildAccountLeaseQuotaSnapshot(undefined)).toEqual({
      modelQuotas: {},
      modelLimits: {},
      modelResetTimes: {},
      modelForwardingRules: {},
    });
  });

  it('returns an empty snapshot for a quota with no models and no groups', () => {
    expect(buildAccountLeaseQuotaSnapshot({ models: {} })).toEqual({
      modelQuotas: {},
      modelLimits: {},
      modelResetTimes: {},
      modelForwardingRules: {},
    });
  });

  it('normalizes models/-prefixed ids and floors percentage, limits and reset times', () => {
    const quota: CloudQuotaData = {
      models: {
        'models/gemini-3.5-flash-low': {
          percentage: 80.9,
          resetTime: '2026-01-02T00:00:00Z',
          max_output_tokens: 4095.7,
        },
        '  gemini-3.1-pro-high  ': {
          percentage: 55.1,
          resetTime: '2026-01-03T00:00:00Z',
          max_tokens: 2048,
        },
      },
    };

    const snapshot = buildAccountLeaseQuotaSnapshot(quota);

    expect(snapshot.modelQuotas).toEqual({
      'gemini-3.5-flash-low': 80,
      'gemini-3.1-pro-high': 55,
    });
    expect(snapshot.modelLimits).toEqual({
      'gemini-3.5-flash-low': 4095,
      'gemini-3.1-pro-high': 2048,
    });
    expect(snapshot.modelResetTimes).toEqual({
      'gemini-3.5-flash-low': '2026-01-02T00:00:00Z',
      'gemini-3.1-pro-high': '2026-01-03T00:00:00Z',
    });
  });

  it('skips entries with invalid ids, non-finite percentages, invalid limits and blank reset times', () => {
    const quota = {
      models: {
        'models/': { percentage: 90, resetTime: '2026-01-01T00:00:00Z' },
        '   ': { percentage: 90, resetTime: '2026-01-01T00:00:00Z' },
        'valid-model': { percentage: NaN, resetTime: '2026-01-01T00:00:00Z' },
        'bad-limit': {
          percentage: 50,
          resetTime: '2026-01-01T00:00:00Z',
          max_output_tokens: 0,
        },
        'blank-reset': { percentage: 50, resetTime: '   ' },
        'non-string-reset': { percentage: 50, resetTime: undefined },
      },
    } as unknown as CloudQuotaData;

    const snapshot = buildAccountLeaseQuotaSnapshot(quota);

    expect(snapshot.modelQuotas).toEqual({
      'bad-limit': 50,
      'blank-reset': 50,
      'non-string-reset': 50,
    });
    // max_output_tokens: 0 is explicitly present (not nullish), fails the >0 check and does
    // not fall back to max_tokens.
    expect(snapshot.modelLimits).toEqual({});
    expect(snapshot.modelResetTimes).toEqual({
      'valid-model': '2026-01-01T00:00:00Z',
      'bad-limit': '2026-01-01T00:00:00Z',
    });
  });

  it('applies the lowest third-party quota bucket as a floor on claude/gpt models only', () => {
    const quota: CloudQuotaData = {
      models: {
        'claude-sonnet-4-6': {
          percentage: 70,
          resetTime: '2026-01-03T00:00:00Z',
        },
        'gpt-oss-120b': {
          percentage: 60,
          resetTime: '2026-01-04T00:00:00Z',
        },
        'gemini-3.5-flash-low': {
          percentage: 90,
          resetTime: '2026-01-02T00:00:00Z',
        },
      },
      quota_groups: [
        {
          display_name: 'Claude Pro',
          buckets: [
            {
              bucket_id: 'claude-sonnet-w1',
              window: '7d',
              remaining_fraction: 0.459,
              reset_time: '2026-01-01T12:00:00Z',
            },
            {
              bucket_id: 'claude-opus-w1',
              window: '7d',
              remaining_fraction: 0.129,
              reset_time: '2026-01-01T06:00:00Z',
            },
          ],
        },
      ],
    };

    const snapshot = buildAccountLeaseQuotaSnapshot(quota);

    // Floor = floor(0.129 * 100) = 12 with the earlier reset time of the two lowest buckets.
    expect(snapshot.modelQuotas['claude-sonnet-4-6']).toBe(12);
    expect(snapshot.modelQuotas['gpt-oss-120b']).toBe(12);
    expect(snapshot.modelResetTimes['claude-sonnet-4-6']).toBe('2026-01-01T06:00:00Z');
    expect(snapshot.modelResetTimes['gpt-oss-120b']).toBe('2026-01-01T06:00:00Z');
    // Non-third-party model keeps its own quota.
    expect(snapshot.modelQuotas['gemini-3.5-flash-low']).toBe(90);
    expect(snapshot.modelResetTimes['gemini-3.5-flash-low']).toBe('2026-01-02T00:00:00Z');
  });

  it('breaks a percentage tie by choosing the bucket with the earlier reset time', () => {
    const quota: CloudQuotaData = {
      models: { 'claude-opus-4-6': { percentage: 40, resetTime: '2026-02-01T00:00:00Z' } },
      quota_groups: [
        {
          display_name: 'Claude Opus',
          buckets: [
            {
              bucket_id: 'opus-a',
              window: '1d',
              remaining_fraction: 0.2,
              reset_time: '2026-01-05T00:00:00Z',
            },
            {
              bucket_id: 'opus-b',
              window: '7d',
              remaining_fraction: 0.2,
              reset_time: '2026-01-01T00:00:00Z',
            },
          ],
        },
      ],
    };

    const snapshot = buildAccountLeaseQuotaSnapshot(quota);

    expect(snapshot.modelQuotas['claude-opus-4-6']).toBe(20);
    expect(snapshot.modelResetTimes['claude-opus-4-6']).toBe('2026-01-01T00:00:00Z');
  });

  it('matches third-party buckets by bucket text when the group name does not match', () => {
    const quota: CloudQuotaData = {
      models: { 'gpt-oss-120b': { percentage: 99, resetTime: '2026-02-01T00:00:00Z' } },
      quota_groups: [
        {
          display_name: 'AI Models',
          buckets: [
            {
              bucket_id: 'gpt-5-hourly',
              window: 'hour',
              remaining_fraction: 0.5,
              reset_time: '2026-01-01T08:00:00Z',
            },
          ],
        },
      ],
    };

    const snapshot = buildAccountLeaseQuotaSnapshot(quota);

    expect(snapshot.modelQuotas['gpt-oss-120b']).toBe(50);
    expect(snapshot.modelResetTimes['gpt-oss-120b']).toBe('2026-01-01T08:00:00Z');
  });

  it('ignores groups and buckets without any third-party signal', () => {
    const quota: CloudQuotaData = {
      models: { 'claude-sonnet-4-6': { percentage: 70, resetTime: '2026-01-03T00:00:00Z' } },
      quota_groups: [
        {
          display_name: 'General',
          buckets: [
            {
              bucket_id: 'weekly-quota',
              window: '7d',
              remaining_fraction: 0.1,
              reset_time: '2026-01-01T00:00:00Z',
            },
          ],
        },
      ],
    };

    const snapshot = buildAccountLeaseQuotaSnapshot(quota);

    // No third-party floor found → model keeps its own quota and reset time.
    expect(snapshot.modelQuotas['claude-sonnet-4-6']).toBe(70);
    expect(snapshot.modelResetTimes['claude-sonnet-4-6']).toBe('2026-01-03T00:00:00Z');
  });

  it('skips buckets with a non-finite floor and keeps model reset time when the floor has no reset time', () => {
    const quota = {
      models: { 'claude-sonnet-4-6': { percentage: 70, resetTime: '2026-01-03T00:00:00Z' } },
      quota_groups: [
        {
          display_name: 'Claude Pro',
          buckets: [
            {
              bucket_id: 'broken',
              window: '7d',
              remaining_fraction: NaN,
              reset_time: '2026-01-01T00:00:00Z',
            },
            {
              bucket_id: 'no-reset',
              window: '1d',
              remaining_fraction: 0.3,
              reset_time: '',
            },
          ],
        },
      ],
    } as unknown as CloudQuotaData;

    const snapshot = buildAccountLeaseQuotaSnapshot(quota);

    // NaN bucket skipped; floor 30 replaces quota but the empty floor reset time does not
    // overwrite the model's own reset time.
    expect(snapshot.modelQuotas['claude-sonnet-4-6']).toBe(30);
    expect(snapshot.modelResetTimes['claude-sonnet-4-6']).toBe('2026-01-03T00:00:00Z');
  });

  it('does not raise the quota when the third-party floor is higher than the model quota', () => {
    const quota: CloudQuotaData = {
      models: { 'claude-sonnet-4-6': { percentage: 5, resetTime: '2026-01-03T00:00:00Z' } },
      quota_groups: [
        {
          display_name: 'Claude Pro',
          buckets: [
            {
              bucket_id: 'b1',
              window: '7d',
              remaining_fraction: 0.9,
              reset_time: '2026-01-01T00:00:00Z',
            },
          ],
        },
      ],
    };

    const snapshot = buildAccountLeaseQuotaSnapshot(quota);

    expect(snapshot.modelQuotas['claude-sonnet-4-6']).toBe(5);
    expect(snapshot.modelResetTimes['claude-sonnet-4-6']).toBe('2026-01-03T00:00:00Z');
  });

  it('normalizes forwarding rules and drops entries with invalid ids', () => {
    const quota: CloudQuotaData = {
      models: {},
      model_forwarding_rules: {
        'models/old-model': 'models/new-model',
        '': 'target',
        'valid-old': '  ',
      },
    };

    const snapshot = buildAccountLeaseQuotaSnapshot(quota);

    expect(snapshot.modelForwardingRules).toEqual({ 'old-model': 'new-model' });
  });
});

describe('findEarliestQuotaResetTime', () => {
  it('returns the lexicographic minimum of the reset times', () => {
    expect(
      findEarliestQuotaResetTime({
        b: '2026-01-03T00:00:00Z',
        a: '2026-01-01T00:00:00Z',
        c: '2026-01-02T00:00:00Z',
      }),
    ).toBe('2026-01-01T00:00:00Z');
  });

  it('returns null for an empty record', () => {
    expect(findEarliestQuotaResetTime({})).toBeNull();
  });

  it('ignores empty and whitespace-only values', () => {
    expect(findEarliestQuotaResetTime({ a: '', b: '   ' })).toBeNull();
    expect(
      findEarliestQuotaResetTime({ a: '   ', b: '2026-01-02T00:00:00Z' }),
    ).toBe('2026-01-02T00:00:00Z');
  });

  it('prefers a valid ISO value over a later-sorting garbage value', () => {
    expect(
      findEarliestQuotaResetTime({ a: 'not-a-date', b: '2026-01-01T00:00:00Z' }),
    ).toBe('2026-01-01T00:00:00Z');
  });
});

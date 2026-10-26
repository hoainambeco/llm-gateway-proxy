import type { CloudQuotaData } from '@/modules/cloud-account/types';
import type { AccountLeaseTokenData } from '../interfaces/account-lease-token-types';
import { AccountLeaseModelPolicy } from './account-lease-model.policy';

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

function makeHarness(entries: Array<[string, AccountLeaseTokenData]> = []) {
  const cache = new Map<string, AccountLeaseTokenData>(entries);
  const logger = { log: jest.fn() };
  const policy = new AccountLeaseModelPolicy({ getTokenCache: () => cache, logger });
  return { policy, cache, logger };
}

describe('AccountLeaseModelPolicy unrequestable model tracking', () => {
  it('normalizes ids when marking and querying unrequestable models', () => {
    const { policy, logger } = makeHarness();

    policy.markModelUnrequestable('models/GEMINI-3.7-FLASH-LOW');

    expect(policy.isModelUnrequestable('models/gemini-3.7-flash-low')).toBe(true);
    expect(policy.isModelUnrequestable('gemini-3.7-flash-low')).toBe(true);
    expect(policy.isModelUnrequestable('gemini-3.5-flash-low')).toBe(false);
    expect(logger.log).toHaveBeenCalledWith(
      '[Unrequestable-Model] upstream rejected gemini-3.7-flash-low; future requests will use a family sibling when available',
    );
  });

  it('ignores blank ids and duplicate marks', () => {
    const { policy, logger } = makeHarness();

    policy.markModelUnrequestable('models/');
    policy.markModelUnrequestable('   ');
    policy.markModelUnrequestable('gemini-3.7-flash-low');
    policy.markModelUnrequestable('models/gemini-3.7-flash-low');

    expect(logger.log).toHaveBeenCalledTimes(1);
    expect(policy.isModelUnrequestable('   ')).toBe(false);
  });

  it('returns no sibling for models without a tier suffix', () => {
    const { policy } = makeHarness();
    policy.markModelUnrequestable('gemini-2.5-flash');

    expect(policy.resolveUnrequestableSibling('gemini-2.5-flash')).toBeUndefined();
  });

  it('returns no sibling for a model that was never marked', () => {
    const { policy } = makeHarness();

    expect(policy.resolveUnrequestableSibling('gemini-3.7-flash-low')).toBeUndefined();
    expect(policy.resolveUnrequestableSibling('models/')).toBeUndefined();
  });

  it('picks the highest-priority requestable sibling from the leased account own models', () => {
    const { policy } = makeHarness([
      [
        'acc-1',
        makeToken({
          model_quotas: {
            'gemini-3.7-flash-tiered': 50,
            'gemini-3.7-flash-high': 50,
            'gemini-3.7-flash-medium': 50,
          },
        }),
      ],
    ]);
    policy.markModelUnrequestable('gemini-3.7-flash-low');

    expect(policy.resolveUnrequestableSibling('gemini-3.7-flash-low')).toBe(
      'gemini-3.7-flash-tiered',
    );
  });

  it('skips siblings that are themselves unrequestable', () => {
    const { policy } = makeHarness([
      [
        'acc-1',
        makeToken({
          model_quotas: {
            'gemini-3.7-flash-high': 50,
            'gemini-3.7-flash-medium': 50,
          },
        }),
      ],
    ]);
    policy.markModelUnrequestable('gemini-3.7-flash-low');
    policy.markModelUnrequestable('gemini-3.7-flash-high');

    expect(policy.resolveUnrequestableSibling('gemini-3.7-flash-low')).toBe(
      'gemini-3.7-flash-medium',
    );
  });

  it('restricts candidates to the account token when provided but searches all accounts otherwise', () => {
    const { policy } = makeHarness([
      ['acc-1', makeToken({ model_quotas: { 'gemini-3.7-flash-medium': 50 } })],
      ['acc-2', makeToken({ model_quotas: { 'gemini-3.7-flash-high': 50 } })],
    ]);
    policy.markModelUnrequestable('gemini-3.7-flash-low');

    const ownToken = makeToken({ model_quotas: { 'gemini-3.7-flash-medium': 50 } });
    expect(policy.resolveUnrequestableSibling('gemini-3.7-flash-low', ownToken)).toBe(
      'gemini-3.7-flash-medium',
    );
    expect(policy.resolveUnrequestableSibling('gemini-3.7-flash-low')).toBe(
      'gemini-3.7-flash-high',
    );
  });
});

describe('AccountLeaseModelPolicy model discovery', () => {
  it('projects provider display names to public ids in getAllCollectedModels', () => {
    const { policy } = makeHarness([
      [
        'acc-1',
        makeToken({
          quota: {
            models: {
              'models/provider-alpha': {
                percentage: 50,
                resetTime: '2026-01-01T00:00:00Z',
                display_name: 'Gemini 3.7 Flash (Low)',
              },
              'models/provider-beta': {
                percentage: 50,
                resetTime: '2026-01-01T00:00:00Z',
              },
              'models/  ': { percentage: 50, resetTime: '2026-01-01T00:00:00Z' },
            },
          } as CloudQuotaData,
          model_quotas: { 'provider-beta': 50, 'gemini-extra-1': 50 },
        }),
      ],
    ]);

    expect(new Set(policy.getAllCollectedModels())).toEqual(
      new Set(['gemini-3.7-flash-low', 'provider-beta', 'gemini-extra-1']),
    );
  });

  it('keeps physical upstream ids in getAllRawQuotaModels without display-name projection', () => {
    const { policy } = makeHarness([
      [
        'acc-1',
        makeToken({
          quota: {
            models: {
              'models/provider-alpha': {
                percentage: 50,
                resetTime: '2026-01-01T00:00:00Z',
                display_name: 'Gemini 3.7 Flash (Low)',
              },
            },
          } as CloudQuotaData,
          model_quotas: { 'Raw-Model': 50 },
        }),
      ],
    ]);

    expect(new Set(policy.getAllRawQuotaModels())).toEqual(
      new Set(['provider-alpha', 'raw-model']),
    );
  });

  it('unions model_quotas and quota model keys in getAvailableModelsFromToken', () => {
    const { policy } = makeHarness();

    const available = policy.getAvailableModelsFromToken(
      makeToken({
        quota: { models: { 'Models/C_D': { percentage: 1, resetTime: 't' } } } as CloudQuotaData,
        model_quotas: { 'models/A-B': 1 },
      }),
    );

    expect(new Set(available)).toEqual(new Set(['a-b', 'c_d']));
  });
});

describe('AccountLeaseModelPolicy.buildDynamicModelCandidates', () => {
  it('returns null for blank model names', () => {
    const { policy } = makeHarness();

    expect(policy.buildDynamicModelCandidates('')).toBeNull();
    expect(policy.buildDynamicModelCandidates('models/   ')).toBeNull();
  });

  it('orders the gemini pro family with the agent id first', () => {
    const { policy } = makeHarness();

    expect(policy.buildDynamicModelCandidates('gemini-pro-agent')).toEqual([
      'gemini-pro-agent',
      'gemini-3.1-pro-preview',
      'gemini-3-pro-preview',
      'gemini-3.1-pro-high',
      'gemini-3-pro-high',
      'gemini-3.1-pro-low',
      'gemini-3-pro-low',
    ]);
  });

  it('keeps the preview fallback chain ahead of the request for older pro snapshots', () => {
    const { policy } = makeHarness();

    expect(policy.buildDynamicModelCandidates('gemini-3.1-pro-high')).toEqual([
      'gemini-3.1-pro-preview',
      'gemini-3.1-pro',
      'gemini-3.1-pro-high',
      'gemini-pro-agent',
      'gemini-3-pro-preview',
      'gemini-3-pro-high',
      'gemini-3.1-pro-low',
      'gemini-3-pro-low',
    ]);
  });

  it('appends the shared pro fallback chain for other pro family members', () => {
    const { policy } = makeHarness();

    expect(policy.buildDynamicModelCandidates('gemini-3-pro')).toEqual([
      'gemini-3-pro',
      'gemini-pro-agent',
      'gemini-3.1-pro-preview',
      'gemini-3-pro-preview',
      'gemini-3.1-pro-high',
      'gemini-3-pro-high',
      'gemini-3.1-pro-low',
      'gemini-3-pro-low',
    ]);
  });

  it('offers the sibling image family ids', () => {
    const { policy } = makeHarness();

    expect(policy.buildDynamicModelCandidates('gemini-3-pro-image')).toEqual([
      'gemini-3-pro-image',
      'gemini-3.1-pro-image',
    ]);
    expect(policy.buildDynamicModelCandidates('gemini-3-flash-image')).toEqual([
      'gemini-3-flash-image',
      'gemini-3.1-flash-image',
    ]);
  });

  it('offers the un-suffixed id for thinking models and tier variants for plain models', () => {
    const { policy } = makeHarness();

    expect(policy.buildDynamicModelCandidates('gemini-2.5-flash-thinking')).toEqual([
      'gemini-2.5-flash-thinking',
      'gemini-2.5-flash',
      'gemini-2.5-flash-thinking-tiered',
      'gemini-2.5-flash-thinking-high',
      'gemini-2.5-flash-thinking-medium',
      'gemini-2.5-flash-thinking-low',
    ]);
    expect(policy.buildDynamicModelCandidates('gemini-2.5-pro')).toEqual([
      'gemini-2.5-pro',
      'gemini-2.5-pro-thinking',
      'gemini-2.5-pro-tiered',
      'gemini-2.5-pro-high',
      'gemini-2.5-pro-medium',
      'gemini-2.5-pro-low',
    ]);
  });

  it('expands tier-suffixed models to their base and sibling tiers', () => {
    const { policy } = makeHarness();

    expect(policy.buildDynamicModelCandidates('models/gemini-3.7-flash-low')).toEqual([
      'gemini-3.7-flash-low',
      'gemini-3.7-flash-low-thinking',
      'gemini-3.7-flash',
      'gemini-3.7-flash-tiered',
      'gemini-3.7-flash-high',
      'gemini-3.7-flash-medium',
    ]);
  });

  it('strips a -thinking base when expanding tier variants', () => {
    const { policy } = makeHarness();

    expect(policy.buildDynamicModelCandidates('gemini-x-thinking-high')).toEqual([
      'gemini-x-thinking-high',
      'gemini-x-thinking-high-thinking',
      'gemini-x-thinking',
      'gemini-x-thinking-tiered',
      'gemini-x-thinking-medium',
      'gemini-x-thinking-low',
      'gemini-x',
    ]);
  });
});

describe('AccountLeaseModelPolicy.resolveDynamicModelForAccount', () => {
  it('returns the mapped model untouched for an unknown account', () => {
    const { policy, logger } = makeHarness();

    expect(policy.resolveDynamicModelForAccount('missing', 'models/gemini-3.5-flash')).toBe(
      'models/gemini-3.5-flash',
    );
    expect(logger.log).not.toHaveBeenCalled();
  });

  it('returns the mapped model when the account advertises no models', () => {
    const { policy } = makeHarness([['acc-1', makeToken()]]);

    expect(policy.resolveDynamicModelForAccount('acc-1', 'gemini-3.5-flash')).toBe(
      'gemini-3.5-flash',
    );
  });

  it('rewrites an upstream-rejected preset to the highest-priority family sibling', () => {
    const { policy, logger } = makeHarness([
      [
        'acc-1',
        makeToken({
          model_quotas: {
            'gemini-3.7-flash-tiered': 50,
            'gemini-3.7-flash-medium': 50,
          },
        }),
      ],
    ]);
    policy.markModelUnrequestable('gemini-3.7-flash-low');

    const resolved = policy.resolveDynamicModelForAccount(
      'acc-1',
      'models/gemini-3.7-flash-low',
    );

    expect(resolved).toBe('gemini-3.7-flash-tiered');
    expect(logger.log).toHaveBeenCalledWith(
      '[Unrequestable-Model-Rewrite] account=acc-1 models/gemini-3.7-flash-low -> gemini-3.7-flash-tiered',
    );
  });

  it('routes through a forwarding rule when the target is advertised', () => {
    const { policy, logger } = makeHarness([
      [
        'acc-1',
        makeToken({
          model_quotas: { 'gemini-3.5-flash-low': 50 },
          model_forwarding_rules: {
            'models/gemini-old-name': 'models/gemini-3.5-flash-low',
          },
        }),
      ],
    ]);

    const resolved = policy.resolveDynamicModelForAccount(
      'acc-1',
      'models/gemini-old-name',
    );

    expect(resolved).toBe('gemini-3.5-flash-low');
    expect(logger.log).toHaveBeenCalledWith(
      '[Dynamic-Model-Rewrite] account=acc-1 models/gemini-old-name -> gemini-3.5-flash-low',
    );
  });

  it('keeps the mapped model when the forwarding target is not advertised', () => {
    const { policy } = makeHarness([
      [
        'acc-1',
        makeToken({
          model_quotas: { 'gemini-3.5-flash-low': 50 },
          model_forwarding_rules: { 'gemini-old-name': 'gemini-ghost' },
        }),
      ],
    ]);

    expect(policy.resolveDynamicModelForAccount('acc-1', 'gemini-old-name')).toBe(
      'gemini-old-name',
    );
  });

  it('resolves a public preset id to the physical quota id advertising that display name', () => {
    const { policy, logger } = makeHarness([
      [
        'acc-1',
        makeToken({
          quota: {
            models: {
              'gemini-3.7-flash': {
                percentage: 60,
                resetTime: '2026-01-01T00:00:00Z',
                display_name: 'Gemini 3.7 Flash (Medium)',
              },
            },
          } as CloudQuotaData,
          model_quotas: { 'gemini-3.7-flash': 60 },
        }),
      ],
    ]);

    const resolved = policy.resolveDynamicModelForAccount(
      'acc-1',
      'gemini-3.7-flash-medium',
    );

    expect(resolved).toBe('gemini-3.7-flash');
    expect(logger.log).toHaveBeenCalledWith(
      '[Dynamic-Model-Rewrite] account=acc-1 gemini-3.7-flash-medium -> gemini-3.7-flash',
    );
  });

  it('falls through dynamic candidates to an advertised family tier', () => {
    const { policy } = makeHarness([
      ['acc-1', makeToken({ model_quotas: { 'gemini-3.7-flash-low': 80 } })],
    ]);

    expect(policy.resolveDynamicModelForAccount('acc-1', 'gemini-3.7-flash-medium')).toBe(
      'gemini-3.7-flash-low',
    );
  });

  it('falls back to the nearest tiered family member when candidates miss', () => {
    const { policy } = makeHarness([
      ['acc-1', makeToken({ model_quotas: { 'gemini-3.5-flash-extra-low': 70 } })],
    ]);

    expect(policy.resolveDynamicModelForAccount('acc-1', 'gemini-3.5-flash-high')).toBe(
      'gemini-3.5-flash-extra-low',
    );
  });

  it('keeps the mapped model when no advertised model can satisfy the request', () => {
    const { policy } = makeHarness([
      ['acc-1', makeToken({ model_quotas: { 'completely-different-model': 10 } })],
    ]);

    expect(policy.resolveDynamicModelForAccount('acc-1', 'gemini-3.7-flash-low')).toBe(
      'gemini-3.7-flash-low',
    );
  });

  it('keeps the mapped model when every advertised sibling is unrequestable', () => {
    const { policy } = makeHarness([
      ['acc-1', makeToken({ model_quotas: { 'gemini-3.5-flash-low': 90 } })],
    ]);
    policy.markModelUnrequestable('gemini-3.5-flash-low');

    expect(policy.resolveDynamicModelForAccount('acc-1', 'gemini-3.5-flash-low')).toBe(
      'gemini-3.5-flash-low',
    );
  });
});

describe('AccountLeaseModelPolicy model availability', () => {
  it('returns unknown for an account that is not in the cache', () => {
    const { policy } = makeHarness();

    expect(policy.getModelAvailabilityForAccount('missing', 'gemini-3.5-flash')).toBe('unknown');
    expect(policy.getExactModelAvailabilityForAccount('missing', 'gemini-3.5-flash')).toBe(
      'unknown',
    );
  });

  it('returns unknown when the account advertises no requestable models', () => {
    const { policy } = makeHarness([['acc-1', makeToken()]]);

    expect(policy.getModelAvailabilityForAccount('acc-1', 'gemini-3.5-flash')).toBe('unknown');
    expect(policy.getExactModelAvailabilityForAccount('acc-1', 'gemini-3.5-flash')).toBe(
      'unknown',
    );
  });

  it('returns unknown when the only advertised model is unrequestable', () => {
    const { policy } = makeHarness([
      ['acc-1', makeToken({ model_quotas: { 'gemini-3.5-flash-low': 90 } })],
    ]);
    policy.markModelUnrequestable('gemini-3.5-flash-low');

    expect(policy.getModelAvailabilityForAccount('acc-1', 'gemini-3.5-flash-low')).toBe(
      'unknown',
    );
    expect(policy.getExactModelAvailabilityForAccount('acc-1', 'gemini-3.5-flash-low')).toBe(
      'unknown',
    );
  });

  it('returns unavailable for a blank mapped model id', () => {
    const { policy } = makeHarness([
      ['acc-1', makeToken({ model_quotas: { 'gemini-3.5-flash-low': 90 } })],
    ]);

    expect(policy.getModelAvailabilityForAccount('acc-1', '   ')).toBe('unavailable');
    expect(policy.getExactModelAvailabilityForAccount('acc-1', 'models/')).toBe('unavailable');
  });

  it('returns available only when a resolvable, safely-rebindable model exists', () => {
    const { policy } = makeHarness([
      ['acc-1', makeToken({ model_quotas: { 'gemini-3.7-flash-low': 80 } })],
    ]);

    expect(policy.getModelAvailabilityForAccount('acc-1', 'gemini-3.7-flash-medium')).toBe(
      'available',
    );
    expect(policy.getModelAvailabilityForAccount('acc-1', 'claude-sonnet-4-6')).toBe(
      'unavailable',
    );
  });

  it('resolves availability through display-name presets', () => {
    const { policy } = makeHarness([
      [
        'acc-1',
        makeToken({
          quota: {
            models: {
              'gemini-3.7-flash': {
                percentage: 60,
                resetTime: '2026-01-01T00:00:00Z',
                display_name: 'Gemini 3.7 Flash (Medium)',
              },
            },
          } as CloudQuotaData,
          model_quotas: { 'gemini-3.7-flash': 60 },
        }),
      ],
    ]);

    expect(policy.getModelAvailabilityForAccount('acc-1', 'gemini-3.7-flash-medium')).toBe(
      'available',
    );
  });

  it('requires an exact id match for getExactModelAvailabilityForAccount', () => {
    const { policy } = makeHarness([
      ['acc-1', makeToken({ model_quotas: { 'gemini-3.5-flash-low': 90 } })],
    ]);

    expect(policy.getExactModelAvailabilityForAccount('acc-1', 'gemini-3.5-flash-low')).toBe(
      'available',
    );
    expect(policy.getExactModelAvailabilityForAccount('acc-1', 'gemini-3.5-flash')).toBe(
      'unavailable',
    );
  });
});

describe('AccountLeaseModelPolicy model limits and thinking budgets', () => {
  it('prefers the provider-declared output cap from the quota payload', () => {
    const { policy } = makeHarness([
      [
        'acc-1',
        makeToken({
          quota: {
            models: {
              'models/gemini-3.5-flash-low': {
                percentage: 50,
                resetTime: '2026-01-01T00:00:00Z',
                max_output_tokens: 4096,
              },
            },
          } as CloudQuotaData,
          model_limits: { 'gemini-3.5-flash-low': 111 },
        }),
      ],
    ]);

    expect(policy.getModelOutputLimitForAccount('acc-1', 'models/gemini-3.5-flash-low')).toBe(
      4096,
    );
  });

  it('accepts the legacy max_tokens field as the provider cap', () => {
    const { policy } = makeHarness([
      [
        'acc-1',
        makeToken({
          quota: {
            models: {
              'models/gemini-3.5-flash-low': {
                percentage: 50,
                resetTime: '2026-01-01T00:00:00Z',
                max_tokens: 2048,
              },
            },
          } as CloudQuotaData,
        }),
      ],
    ]);

    expect(policy.getModelOutputLimitForAccount('acc-1', 'gemini-3.5-flash-low')).toBe(2048);
  });

  it('falls back to the persisted compatibility limit when the provider is silent', () => {
    const { policy } = makeHarness([
      ['acc-1', makeToken({ model_limits: { 'gemini-2.5-pro': 1234 } })],
    ]);

    expect(policy.getModelOutputLimitForAccount('acc-1', 'gemini-2.5-pro')).toBe(1234);
  });

  it('returns undefined for unknown accounts, blank ids and models without any cap', () => {
    const { policy } = makeHarness([
      [
        'acc-1',
        makeToken({
          quota: {
            models: { 'gemini-x': { percentage: 50, resetTime: '2026-01-01T00:00:00Z' } },
          } as CloudQuotaData,
        }),
      ],
    ]);

    expect(policy.getModelOutputLimitForAccount('missing', 'gemini-x')).toBeUndefined();
    expect(policy.getModelOutputLimitForAccount('acc-1', '   ')).toBeUndefined();
    expect(policy.getModelOutputLimitForAccount('acc-1', 'gemini-x')).toBeUndefined();
  });

  it('returns the floored thinking budget declared by the provider', () => {
    const { policy } = makeHarness([
      [
        'acc-1',
        makeToken({
          quota: {
            models: {
              'models/gemini-3.5-flash-low': {
                percentage: 50,
                resetTime: '2026-01-01T00:00:00Z',
                thinking_budget: 1234.9,
              },
            },
          } as CloudQuotaData,
        }),
      ],
    ]);

    expect(policy.getModelThinkingBudgetForAccount('acc-1', 'models/gemini-3.5-flash-low')).toBe(
      1234,
    );
  });

  it('rejects invalid thinking budgets', () => {
    const { policy } = makeHarness([
      [
        'acc-1',
        makeToken({
          quota: {
            models: {
              'gemini-neg': {
                percentage: 50,
                resetTime: '2026-01-01T00:00:00Z',
                thinking_budget: -5,
              },
              'gemini-zero': {
                percentage: 50,
                resetTime: '2026-01-01T00:00:00Z',
                thinking_budget: 0,
              },
              'gemini-bad': { percentage: 50, resetTime: '2026-01-01T00:00:00Z' },
            },
          } as CloudQuotaData,
        }),
      ],
    ]);

    expect(policy.getModelThinkingBudgetForAccount('acc-1', 'gemini-neg')).toBeUndefined();
    expect(policy.getModelThinkingBudgetForAccount('acc-1', 'gemini-zero')).toBe(0);
    expect(policy.getModelThinkingBudgetForAccount('acc-1', 'gemini-bad')).toBeUndefined();
    expect(policy.getModelThinkingBudgetForAccount('acc-1', 'models/')).toBeUndefined();
    expect(policy.getModelThinkingBudgetForAccount('missing', 'gemini-zero')).toBeUndefined();
  });
});

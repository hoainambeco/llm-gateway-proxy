import type { CloudAccount } from '@/modules/cloud-account/types';
import { CloudAccountRefreshBlockedError } from '@/modules/cloud-account/services/CloudAccountRefreshService';
import { OAuthTokenRefreshError } from '@/modules/cloud-account/services/GoogleAPIService';
import type {
  AccountLeaseAccountStore,
  AccountLeaseUpstream,
} from '../interfaces/account-lease-adapters';
import type { AccountLeaseTokenData } from '../interfaces/account-lease-token-types';
import {
  AccountLeaseHydrationPolicy,
  AccountLeaseRefreshRejectedError,
} from './account-lease-hydration.policy';

const NOW = 1_000_000;

function makeToken(overrides: Partial<AccountLeaseTokenData> = {}): AccountLeaseTokenData {
  return {
    email: 'user@test.local',
    account_id: 'acc-1',
    access_token: 'access-1',
    refresh_token: 'refresh-1',
    token_type: 'Bearer',
    expires_in: 3600,
    expiry_timestamp: NOW + 3600,
    model_quotas: {},
    model_limits: {},
    model_reset_times: {},
    model_forwarding_rules: {},
    ...overrides,
  };
}

function makeLogger() {
  return { debug: jest.fn(), error: jest.fn(), log: jest.fn(), warn: jest.fn() };
}

interface Harness {
  policy: AccountLeaseHydrationPolicy;
  cache: Map<string, AccountLeaseTokenData>;
  logger: ReturnType<typeof makeLogger>;
  accountStore: jest.Mocked<Pick<AccountLeaseAccountStore, 'getAccount' | 'updateToken'>>;
  upstream: {
    refreshAccessToken: jest.Mock;
    fetchProjectId: jest.Mock;
    normalizeRefreshedOAuthClientKey: jest.Mock;
    fetchQuota: jest.Mock;
  };
  persistTokenState: (accountId: string, tokenData: AccountLeaseTokenData) => Promise<void>;
}

function makeHarness(
  overrides: {
    persistTokenState?: (accountId: string, tokenData: AccountLeaseTokenData) => Promise<void>;
    account?: CloudAccount | undefined;
  } = {},
): Harness {
  const cache = new Map<string, AccountLeaseTokenData>();
  const logger = makeLogger();
  const accountStore = {
    getAccount: jest.fn().mockResolvedValue(overrides.account),
    updateToken: jest.fn().mockResolvedValue(undefined),
  };
  const upstream = {
    refreshAccessToken: jest.fn(),
    fetchProjectId: jest.fn(),
    normalizeRefreshedOAuthClientKey: jest.fn(),
    fetchQuota: jest.fn(),
  };
  const persistTokenState =
    overrides.persistTokenState ?? jest.fn().mockResolvedValue(undefined);
  const policy = new AccountLeaseHydrationPolicy({
    accountStore: accountStore as unknown as AccountLeaseAccountStore,
    upstream: upstream as unknown as AccountLeaseUpstream,
    getTokenCache: () => cache,
    logger,
    persistTokenState,
  });
  return { policy, cache, logger, accountStore, upstream, persistTokenState };
}

describe('AccountLeaseHydrationPolicy.hydrateSelectedToken', () => {
  it('returns a valid persisted project id without refreshing a fresh token', async () => {
    const { policy, upstream, logger } = makeHarness();
    const tokenData = makeToken({ project_id: 'proj-1' });

    const projectId = await policy.hydrateSelectedToken({
      accountId: 'acc-1',
      tokenData,
      nowSeconds: NOW,
      fallbackProjectId: 'fallback-proj',
    });

    expect(projectId).toBe('proj-1');
    expect(upstream.refreshAccessToken).not.toHaveBeenCalled();
    expect(upstream.fetchProjectId).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('refreshes an expired token through the injected upstream and persists the new state', async () => {
    const { policy, cache, upstream, logger, persistTokenState } = makeHarness();
    const tokenData = makeToken({ expiry_timestamp: NOW - 10, project_id: 'proj-1' });
    cache.set('acc-1', tokenData);
    upstream.refreshAccessToken.mockResolvedValue({
      access_token: 'access-2',
      expires_in: 1800,
      token_type: 'Bearer',
      refresh_token: 'refresh-2',
      id_token: 'id-token-2',
    });
    upstream.normalizeRefreshedOAuthClientKey.mockReturnValue('normalized-key');

    const projectId = await policy.hydrateSelectedToken({
      accountId: 'acc-1',
      tokenData,
      nowSeconds: NOW,
      fallbackProjectId: 'fallback-proj',
    });

    expect(projectId).toBe('proj-1');
    expect(tokenData.access_token).toBe('access-2');
    expect(tokenData.refresh_token).toBe('refresh-2');
    expect(tokenData.id_token).toBe('id-token-2');
    expect(tokenData.expires_in).toBe(1800);
    expect(tokenData.expiry_timestamp).toBe(NOW + 1800);
    expect(tokenData.oauth_client_key).toBe('normalized-key');
    expect(cache.get('acc-1')?.access_token).toBe('access-2');
    expect(logger.log).toHaveBeenCalledWith('Access token refreshed for user@test.local');

    await policy.drainBackgroundPersistence();
    expect(persistTokenState).toHaveBeenCalledWith(
      'acc-1',
      expect.objectContaining({ access_token: 'access-2' }),
    );
  });

  it('passes oauth health to the upstream when the token carries oauth health', async () => {
    const { policy, upstream } = makeHarness();
    const oauthHealth = { refresh_blocked: false, invalid_grant_count: 1 } as const;
    const tokenData = makeToken({
      expiry_timestamp: NOW - 10,
      upstream_proxy_url: 'http://proxy.local:8080',
      oauth_client_key: 'client-1',
      oauth_health: oauthHealth,
    });
    upstream.refreshAccessToken.mockResolvedValue({
      access_token: 'access-2',
      expires_in: 1800,
      token_type: 'Bearer',
    });

    await policy.refreshSelectedTokenIfNeeded('acc-1', tokenData, NOW);

    expect(upstream.refreshAccessToken).toHaveBeenCalledWith(
      'acc-1',
      'refresh-1',
      'http://proxy.local:8080',
      'client-1',
      { oauth: oauthHealth },
    );
  });

  it('adopts a token another request already refreshed instead of calling the upstream', async () => {
    const { policy, cache, upstream, logger } = makeHarness();
    const tokenData = makeToken({ expiry_timestamp: NOW - 10, access_token: 'stale' });
    const fresh = makeToken({
      expiry_timestamp: NOW + 5000,
      access_token: 'fresh-access',
      project_id: 'proj-fresh',
    });
    cache.set('acc-1', fresh);

    await policy.refreshSelectedTokenIfNeeded('acc-1', tokenData, NOW);

    expect(tokenData.access_token).toBe('fresh-access');
    expect(tokenData.project_id).toBe('proj-fresh');
    expect(upstream.refreshAccessToken).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      'Access token already refreshed by another request for user@test.local',
    );
  });

  it('does nothing when the token is not near expiry', async () => {
    const { policy, upstream } = makeHarness();
    const tokenData = makeToken({ expiry_timestamp: NOW + 301, access_token: 'unchanged' });

    await policy.refreshSelectedTokenIfNeeded('acc-1', tokenData, NOW);

    expect(tokenData.access_token).toBe('unchanged');
    expect(upstream.refreshAccessToken).not.toHaveBeenCalled();
  });

  it('throws AccountLeaseRefreshRejectedError and evicts the cache entry on a blocked refresh', async () => {
    const { policy, cache, upstream, logger } = makeHarness();
    const tokenData = makeToken({ expiry_timestamp: NOW - 10 });
    cache.set('acc-1', tokenData);
    upstream.refreshAccessToken.mockRejectedValue(new CloudAccountRefreshBlockedError('acc-1'));

    await expect(
      policy.hydrateSelectedToken({
        accountId: 'acc-1',
        tokenData,
        nowSeconds: NOW,
        fallbackProjectId: 'fallback-proj',
      }),
    ).rejects.toMatchObject({
      name: 'AccountLeaseRefreshRejectedError',
      accountId: 'acc-1',
      reason: 'invalid_grant',
    });
    expect(cache.has('acc-1')).toBe(false);
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to refresh access token for user@test.local',
      expect.any(CloudAccountRefreshBlockedError),
    );
  });

  it('maps an invalid_grant OAuth refresh failure to AccountLeaseRefreshRejectedError without evicting the cache', async () => {
    const { policy, cache, upstream } = makeHarness();
    const tokenData = makeToken({ expiry_timestamp: NOW - 10 });
    cache.set('acc-1', tokenData);
    upstream.refreshAccessToken.mockRejectedValue(
      new OAuthTokenRefreshError('invalid_grant', 400, 'client-1'),
    );

    const error = await policy
      .hydrateSelectedToken({
        accountId: 'acc-1',
        tokenData,
        nowSeconds: NOW,
        fallbackProjectId: 'fallback-proj',
      })
      .then(
        () => null,
        (caught: unknown) => caught,
      );

    expect(error).toBeInstanceOf(AccountLeaseRefreshRejectedError);
    expect((error as AccountLeaseRefreshRejectedError).accountId).toBe('acc-1');
    expect((error as AccountLeaseRefreshRejectedError).reason).toBe('invalid_grant');
    expect(cache.has('acc-1')).toBe(true);
  });

  it('rethrows non-invalid_grant upstream errors unchanged', async () => {
    const { policy, upstream } = makeHarness();
    const tokenData = makeToken({ expiry_timestamp: NOW - 10 });
    const original = new OAuthTokenRefreshError('invalid_client', 401, 'client-1');
    upstream.refreshAccessToken.mockRejectedValue(original);

    await expect(policy.refreshSelectedTokenIfNeeded('acc-1', tokenData, NOW)).rejects.toBe(
      original,
    );
  });

  it('rethrows generic upstream errors unchanged', async () => {
    const { policy, upstream } = makeHarness();
    const tokenData = makeToken({ expiry_timestamp: NOW - 10 });
    const original = new Error('connection reset');
    upstream.refreshAccessToken.mockRejectedValue(original);

    await expect(policy.refreshSelectedTokenIfNeeded('acc-1', tokenData, NOW)).rejects.toBe(
      original,
    );
  });

  it('resolves a missing project id through the upstream and caches it', async () => {
    const { policy, cache, upstream, persistTokenState } = makeHarness();
    const tokenData = makeToken();
    upstream.fetchProjectId.mockResolvedValue('proj-fetched');

    const projectId = await policy.hydrateSelectedToken({
      accountId: 'acc-1',
      tokenData,
      nowSeconds: NOW,
      fallbackProjectId: 'fallback-proj',
    });

    expect(projectId).toBe('proj-fetched');
    expect(upstream.fetchProjectId).toHaveBeenCalledWith('access-1', undefined);
    expect(tokenData.project_id).toBe('proj-fetched');
    expect(cache.get('acc-1')?.project_id).toBe('proj-fetched');

    await policy.drainBackgroundPersistence();
    expect(persistTokenState).toHaveBeenCalledWith(
      'acc-1',
      expect.objectContaining({ project_id: 'proj-fetched' }),
    );
  });

  it('normalizes an unusable persisted project id before resolving a new one', async () => {
    const { policy, upstream, logger } = makeHarness();
    const tokenData = makeToken({ project_id: 'cloud-code-123' });
    upstream.fetchProjectId.mockResolvedValue('proj-new');

    const projectId = await policy.hydrateSelectedToken({
      accountId: 'acc-1',
      tokenData,
      nowSeconds: NOW,
      fallbackProjectId: 'fallback-proj',
    });

    expect(projectId).toBe('proj-new');
    expect(tokenData.project_id).toBe('proj-new');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('falls back to the non-persistent project id and warns when the upstream has none', async () => {
    const { policy, upstream, logger } = makeHarness();
    const tokenData = makeToken();
    upstream.fetchProjectId.mockResolvedValue('projects/unknown');

    const projectId = await policy.hydrateSelectedToken({
      accountId: 'acc-1',
      tokenData,
      nowSeconds: NOW,
      fallbackProjectId: 'fallback-proj',
    });

    expect(projectId).toBe('fallback-proj');
    expect(logger.warn).toHaveBeenCalledWith(
      'Using non-persistent fallback project ID for user@test.local: fallback-proj',
    );
  });

  it('falls back and warns when the project id lookup throws', async () => {
    const { policy, upstream, logger } = makeHarness();
    const tokenData = makeToken();
    upstream.fetchProjectId.mockRejectedValue(new Error('boom'));

    const projectId = await policy.hydrateSelectedToken({
      accountId: 'acc-1',
      tokenData,
      nowSeconds: NOW,
      fallbackProjectId: 'fallback-proj',
    });

    expect(projectId).toBe('fallback-proj');
    expect(logger.warn).toHaveBeenCalledWith(
      'Unable to resolve project ID for user@test.local',
      expect.any(Error),
    );
  });

  it('warns and continues when the upstream returns no project id', async () => {
    const { policy, upstream, logger } = makeHarness();
    const tokenData = makeToken();
    upstream.fetchProjectId.mockResolvedValue(null);

    const projectId = await policy.hydrateSelectedToken({
      accountId: 'acc-1',
      tokenData,
      nowSeconds: NOW,
      fallbackProjectId: 'fallback-proj',
    });

    expect(projectId).toBe('fallback-proj');
    expect(logger.warn).toHaveBeenCalledWith(
      'Project ID unavailable for user@test.local; continuing without project context',
    );
  });

  it('reuses the project id cached by another request without calling the upstream', async () => {
    const { policy, cache, upstream } = makeHarness();
    cache.set('acc-1', makeToken({ project_id: 'proj-cached' }));
    const tokenData = makeToken();

    const projectId = await policy.hydrateSelectedToken({
      accountId: 'acc-1',
      tokenData,
      nowSeconds: NOW,
      fallbackProjectId: 'fallback-proj',
    });

    expect(projectId).toBe('proj-cached');
    expect(tokenData.project_id).toBe('proj-cached');
    expect(upstream.fetchProjectId).not.toHaveBeenCalled();
  });

  it('shares one project id lookup across concurrent hydrations for the same account', async () => {
    const { policy, upstream } = makeHarness();
    upstream.fetchProjectId.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve('proj-shared'), 30),
      ),
    );

    const request = {
      accountId: 'acc-1',
      tokenData: makeToken(),
      nowSeconds: NOW,
      fallbackProjectId: 'fallback-proj',
    };
    const [first, second] = await Promise.all([
      policy.hydrateSelectedToken({ ...request, tokenData: makeToken() }),
      policy.hydrateSelectedToken({ ...request, tokenData: makeToken() }),
    ]);

    expect(first).toBe('proj-shared');
    expect(second).toBe('proj-shared');
    expect(upstream.fetchProjectId).toHaveBeenCalledTimes(1);
  });
});

describe('AccountLeaseHydrationPolicy.persistTokenState', () => {
  const persistedToken: CloudAccount['token'] = {
    access_token: 'old-access',
    refresh_token: 'old-refresh',
    id_token: 'old-id',
    expires_in: 100,
    expiry_timestamp: 10,
    token_type: 'Bearer',
    project_id: 'old-proj',
    oauth_client_key: 'Old-Key',
    session_id: 'old-session',
    upstream_proxy_url: 'http://old-proxy',
  };

  it('merges refreshed fields over the persisted token and preserves omitted ones', async () => {
    const { policy, accountStore } = makeHarness({
      account: { id: 'acc-1', token: persistedToken } as CloudAccount,
    });

    await policy.persistTokenState(
      'acc-1',
      makeToken({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_in: 200,
        expiry_timestamp: 20,
        id_token: undefined,
        project_id: undefined,
        oauth_client_key: undefined,
        session_id: undefined,
        upstream_proxy_url: undefined,
      }),
    );

    expect(accountStore.updateToken).toHaveBeenCalledWith('acc-1', {
      ...persistedToken,
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      expires_in: 200,
      expiry_timestamp: 20,
      id_token: 'old-id',
      project_id: 'old-proj',
      oauth_client_key: 'old-key',
      session_id: 'old-session',
      upstream_proxy_url: 'http://old-proxy',
    });
  });

  it('prefers the in-memory token values over persisted ones when present', async () => {
    const { policy, accountStore } = makeHarness({
      account: { id: 'acc-1', token: persistedToken } as CloudAccount,
    });

    await policy.persistTokenState(
      'acc-1',
      makeToken({
        access_token: 'new-access',
        id_token: 'new-id',
        project_id: 'new-proj',
        oauth_client_key: 'New-Key',
        session_id: 'new-session',
        upstream_proxy_url: 'http://new-proxy',
      }),
    );

    expect(accountStore.updateToken).toHaveBeenCalledWith('acc-1', {
      ...persistedToken,
      access_token: 'new-access',
      refresh_token: 'refresh-1',
      expires_in: 3600,
      expiry_timestamp: NOW + 3600,
      id_token: 'new-id',
      project_id: 'new-proj',
      // In-memory keys are persisted verbatim; only a missing in-memory key falls
      // back to the normalized persisted key.
      oauth_client_key: 'New-Key',
      session_id: 'new-session',
      upstream_proxy_url: 'http://new-proxy',
    });
  });

  it('writes nothing when the persisted account has no token', async () => {
    const { policy, accountStore } = makeHarness({ account: { id: 'acc-1' } as CloudAccount });

    await expect(policy.persistTokenState('acc-1', makeToken())).resolves.toBeUndefined();

    expect(accountStore.updateToken).not.toHaveBeenCalled();
  });

  it('writes nothing when the account is unknown to the store', async () => {
    const { policy, accountStore } = makeHarness({ account: undefined });

    await expect(policy.persistTokenState('acc-1', makeToken())).resolves.toBeUndefined();

    expect(accountStore.updateToken).not.toHaveBeenCalled();
  });
});

describe('AccountLeaseHydrationPolicy background persistence and locks', () => {
  it('logs a persistence failure instead of rejecting the lease path', async () => {
    const { policy, cache, upstream, logger } = makeHarness({
      persistTokenState: async () => {
        throw new Error('disk full');
      },
    });
    const tokenData = makeToken({ expiry_timestamp: NOW - 10, project_id: 'proj-1' });
    cache.set('acc-1', tokenData);
    upstream.refreshAccessToken.mockResolvedValue({
      access_token: 'access-2',
      expires_in: 1800,
      token_type: 'Bearer',
    });

    await policy.refreshSelectedTokenIfNeeded('acc-1', tokenData, NOW);
    await policy.drainBackgroundPersistence();

    expect(logger.error).toHaveBeenCalledWith(
      'Failed to persist token state for acc-1',
      expect.objectContaining({ message: 'disk full' }),
    );
  });

  it('runs persistence through the account store when no persistTokenState option is given', async () => {
    const cache = new Map<string, AccountLeaseTokenData>();
    const logger = makeLogger();
    const accountStore = {
      getAccount: jest.fn().mockResolvedValue({
        id: 'acc-1',
        token: {
          access_token: 'old-access',
          refresh_token: 'old-refresh',
          expires_in: 100,
          expiry_timestamp: 10,
          token_type: 'Bearer',
        },
      } as CloudAccount),
      updateToken: jest.fn().mockResolvedValue(undefined),
    };
    const upstream = {
      refreshAccessToken: jest.fn().mockResolvedValue({
        access_token: 'access-2',
        expires_in: 1800,
        token_type: 'Bearer',
      }),
      fetchProjectId: jest.fn(),
      normalizeRefreshedOAuthClientKey: jest.fn(),
      fetchQuota: jest.fn(),
    };
    const policy = new AccountLeaseHydrationPolicy({
      accountStore: accountStore as unknown as AccountLeaseAccountStore,
      upstream: upstream as unknown as AccountLeaseUpstream,
      getTokenCache: () => cache,
      logger,
    });
    const tokenData = makeToken({ expiry_timestamp: NOW - 10 });
    cache.set('acc-1', tokenData);

    await policy.refreshSelectedTokenIfNeeded('acc-1', tokenData, NOW);
    await policy.drainBackgroundPersistence();

    expect(accountStore.updateToken).toHaveBeenCalledWith(
      'acc-1',
      expect.objectContaining({ access_token: 'access-2' }),
    );
  });

  it('serializes concurrent lock holders and releases the lock afterwards', async () => {
    const { policy } = makeHarness();
    const locks = new Map<string, Promise<number>>();
    const creator = jest.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return 42;
    });

    const [first, second] = await Promise.all([
      policy.runAccountLock(locks, 'acc-1', creator),
      policy.runAccountLock(locks, 'acc-1', creator),
    ]);

    expect(first).toBe(42);
    expect(second).toBe(42);
    expect(creator).toHaveBeenCalledTimes(1);
    expect(locks.size).toBe(0);
  });

  it('releases the lock even when the guarded work rejects', async () => {
    const { policy } = makeHarness();
    const locks = new Map<string, Promise<number>>();

    await expect(
      policy.runAccountLock(locks, 'acc-1', async () => {
        throw new Error('lock failure');
      }),
    ).rejects.toThrow('lock failure');

    expect(locks.size).toBe(0);
    await expect(policy.runAccountLock(locks, 'acc-1', async () => 7)).resolves.toBe(7);
  });

  it('delegates refreshed oauth client key normalization to the upstream', () => {
    const { policy, upstream } = makeHarness();
    upstream.normalizeRefreshedOAuthClientKey.mockReturnValue('from-upstream');

    const result = policy.normalizeRefreshedOauthClientKey(
      { oauth_client_key: 'current', project_id: 'proj' },
      'refreshed',
    );

    expect(result).toBe('from-upstream');
    expect(upstream.normalizeRefreshedOAuthClientKey).toHaveBeenCalledWith(
      { oauth_client_key: 'current', project_id: 'proj' },
      'refreshed',
    );
  });

  it('leaves the token untouched when syncing from an empty cache', () => {
    const { policy } = makeHarness();
    const tokenData = makeToken({ access_token: 'keep-me' });

    policy.syncTokenDataFromCache('missing-account', tokenData);

    expect(tokenData.access_token).toBe('keep-me');
  });

  it('throws a named AccountLeaseRefreshRejectedError with cause support', () => {
    const cause = new Error('root');
    const error = new AccountLeaseRefreshRejectedError('acc-9', 'invalid_grant', { cause });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AccountLeaseRefreshRejectedError');
    expect(error.message).toBe('Account acc-9 refresh rejected: invalid_grant');
    expect(error.cause).toBe(cause);
  });
});

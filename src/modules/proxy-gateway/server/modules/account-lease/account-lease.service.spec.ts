import type { CloudAccount } from '@/modules/cloud-account/types';
import type { AccountLeaseAccountStore, AccountLeaseUpstream } from './interfaces/account-lease-adapters';
import {
  AccountLeaseService,
  ImageAccountUnavailableError,
  ImageQueueAbortedError,
} from './account-lease.service';
import { RateLimitTrackerService } from '../../shared/services/rate-limit-tracker.service';
import { ModelAvailabilityService } from '../../shared/services/model-availability.service';
import { ImageAccountSchedulerService } from './image-account-scheduler.service';
import { ProviderModelDiscoveryService } from '@/modules/proxy-gateway/upstreams/provider-model-discovery.service';
import { setServerConfig } from '@/server/server-config';
import type { ProxyConfig } from '@/modules/config/types';

describe('AccountLeaseService', () => {
  let mockStore: jest.Mocked<AccountLeaseAccountStore>;
  let mockUpstream: jest.Mocked<AccountLeaseUpstream>;
  let rateLimitTracker: RateLimitTrackerService;
  let modelAvailability: jest.Mocked<ModelAvailabilityService>;
  let imageScheduler: ImageAccountSchedulerService;
  let mockDiscovery: jest.Mocked<ProviderModelDiscoveryService>;
  let accounts: CloudAccount[];
  let service: AccountLeaseService;

  function makeAccount(
    id: string,
    email: string,
    provider: CloudAccount['provider'] = 'google',
    extra: Partial<CloudAccount> = {},
  ): CloudAccount {
    const isGoogle = provider === 'google' || !provider;
    return {
      id,
      provider,
      email,
      is_active: true,
      token: isGoogle
        ? {
            access_token: `access-${id}`,
            refresh_token: `refresh-${id}`,
            token_type: 'Bearer',
            expires_in: 3600,
            expiry_timestamp: Math.floor(Date.now() / 1000) + 3600,
            project_id: 'test-project',
          }
        : undefined,
      quota: isGoogle
        ? {
            models: {
              'gemini-2.0-flash': {
                percentage: 0.9,
                resetTime: '2026-01-01T00:00:00Z',
              },
              'gemini-2.5-pro': {
                percentage: 0.8,
                resetTime: '2026-01-01T00:00:00Z',
              },
            },
          }
        : undefined,
      created_at: 1000,
      last_used: 1000,
      health: {},
      ...extra,
    };
  }

  beforeEach(() => {
    setServerConfig({
      image_scheduler: { per_account_concurrency: 2 },
      request_timeout: 5,
    } as unknown as ProxyConfig);

    accounts = [
      makeAccount('acc-1', 'acc1@gmail.com', 'google'),
      makeAccount('acc-2', 'acc2@gmail.com', 'google'),
      makeAccount('acc-anthropic', 'anthropic@corp.com', 'anthropic', {
        auth_type: 'api_key',
        api_key: 'sk-ant-test',
      }),
      makeAccount('acc-openai', 'openai@corp.com', 'openai', {
        auth_type: 'api_key',
        api_key: 'sk-openai-test',
      }),
      makeAccount('acc-copilot', 'copilot@corp.com', 'copilot', {
        auth_type: 'copilot_token',
        copilot_token: 'ghp_test',
      }),
    ];

    mockStore = {
      getAccounts: jest.fn().mockImplementation(async () => accounts.map((a) => ({ ...a }))),
      getAccount: jest.fn().mockImplementation(async (id: string) => accounts.find((a) => a.id === id)),
      updateToken: jest.fn().mockResolvedValue(undefined),
      updateQuota: jest.fn().mockResolvedValue(undefined),
      deleteAccount: jest.fn().mockResolvedValue(true),
      upsertAccount: jest.fn().mockResolvedValue(undefined),
      mutateHealth: jest.fn().mockImplementation(async (_id, mut) => mut({})),
    };

    mockUpstream = {
      fetchQuota: jest.fn().mockResolvedValue({
        models: {
          'gemini-2.0-flash': { percentage: 0.95, resetTime: '2026-01-01T00:00:00Z' },
        },
      }),
      refreshAccessToken: jest.fn().mockResolvedValue({
        access_token: 'refreshed-token',
        expires_in: 3600,
      }),
      fetchProjectId: jest.fn().mockResolvedValue('test-project'),
      normalizeRefreshedOAuthClientKey: jest.fn().mockReturnValue(undefined),
    };

    rateLimitTracker = new RateLimitTrackerService();
    modelAvailability = {
      mark: jest.fn(),
      clearAccount: jest.fn(),
      clearModel: jest.fn(),
      clearModelFamily: jest.fn(),
      clearCapabilityFailures: jest.fn(),
      getSnapshot: jest.fn().mockReturnValue([]),
      getActiveSnapshot: jest.fn().mockReturnValue([]),
    } as unknown as jest.Mocked<ModelAvailabilityService>;

    imageScheduler = new ImageAccountSchedulerService();
    mockDiscovery = {
      discoverProviderModels: jest.fn().mockResolvedValue(
        new Map([['anthropic_api', new Set(['claude-3-7-sonnet'])]]),
      ),
      discoverProviderUsage: jest.fn().mockResolvedValue({
        usedTokens: 1000,
        totalTokens: 100000,
      }),
    } as unknown as jest.Mocked<ProviderModelDiscoveryService>;

    service = new AccountLeaseService(
      mockStore,
      mockUpstream,
      rateLimitTracker,
      modelAvailability,
      imageScheduler,
      mockDiscovery,
    );
  });

  describe('lifecycle & initialization', () => {
    it('onModuleInit loads accounts and initializes timers', async () => {
      await service.onModuleInit();
      expect(service.getAccountCount()).toBe(2); // 2 google accounts carry token
      expect(mockStore.getAccounts).toHaveBeenCalled();

      // Clean up timers
      await service.onModuleDestroy();
    });

    it('reloadAllAccounts and reloadAllAccountsOrThrow reloads accounts and clears sessions', async () => {
      const count = await service.reloadAllAccounts();
      expect(count).toBe(2);

      const count2 = await service.reloadAllAccountsOrThrow();
      expect(count2).toBe(2);
    });
  });

  describe('provider account routing', () => {
    beforeEach(async () => {
      await service.loadAccounts();
    });

    it('getAccountsForProvider filters by provider type and active status', async () => {
      const googleAccs = service.getAccountsForProvider('google');
      expect(googleAccs).toHaveLength(2);

      const anthropicApi = service.getAccountsForProvider('anthropic_api');
      expect(anthropicApi).toHaveLength(1);
      expect(anthropicApi[0].id).toBe('acc-anthropic');

      const openaiApi = service.getAccountsForProvider('openai_api');
      expect(openaiApi).toHaveLength(1);
      expect(openaiApi[0].id).toBe('acc-openai');

      const copilot = service.getAccountsForProvider('copilot');
      expect(copilot).toHaveLength(1);
      expect(copilot[0].id).toBe('acc-copilot');

      // Inactive provider accounts are excluded
      const inactive = accounts.find((a) => a.id === 'acc-openai');
      if (inactive) inactive.is_active = false;
      await service.loadAccounts();
      expect(service.getAccountsForProvider('openai_api')).toHaveLength(0);
    });

    it('getNextAccountForProvider rotates through candidates with round robin and excludes specified IDs', () => {
      const first = service.getNextAccountForProvider('google');
      expect(first?.id).toBe('acc-1');

      const second = service.getNextAccountForProvider('google');
      expect(second?.id).toBe('acc-2');

      const third = service.getNextAccountForProvider('google');
      expect(third?.id).toBe('acc-1');

      // Exclusion
      const excluded = service.getNextAccountForProvider('google', {
        excludeAccountIds: ['acc-1', 'acc-2'],
      });
      expect(excluded).toBeNull();
    });

    it('reportProviderRateLimit sets lockout on the account', () => {
      service.reportProviderRateLimit('acc-anthropic', 'anthropic_api', 30000);
      expect(rateLimitTracker.isRateLimited('acc-anthropic')).toBe(true);

      // Now excluded from candidates
      expect(service.getAccountsForProvider('anthropic_api')).toHaveLength(0);
    });
  });

  describe('account management & overview', () => {
    beforeEach(async () => {
      await service.loadAccounts();
    });

    it('getAccountsOverview returns summary with health and discovered models', async () => {
      await service.refreshDiscoveredProviderModels();
      const overview = await service.getAccountsOverview();

      expect(overview).toHaveLength(5);
      const anthropic = overview.find((a) => a.id === 'acc-anthropic');
      expect(anthropic?.provider_models).toContain('claude-3-7-sonnet');
      expect(anthropic?.is_healthy).toBe(true);
    });

    it('deleteAccountById evicts from memory and delegates to store', async () => {
      const deleted = await service.deleteAccountById('acc-1');
      expect(deleted).toBe(true);
      expect(service.getAccountCount()).toBe(1);
      expect(mockStore.deleteAccount).toHaveBeenCalledWith('acc-1');
    });

    it('syncSingleAccount refreshes quota for specific account', async () => {
      const synced = await service.syncSingleAccount('acc-1');
      expect(synced).toBe(true);
      expect(mockUpstream.fetchQuota).toHaveBeenCalled();

      // Unknown account returns false
      expect(await service.syncSingleAccount('unknown')).toBe(false);
    });

    it('updateAccountOAuthHealth updates health on cached tokenData', () => {
      expect(service.updateAccountOAuthHealth('acc-1', { refresh_blocked: true })).toBe(true);
      expect(service.updateAccountOAuthHealth('unknown', { refresh_blocked: true })).toBe(false);
    });
  });

  describe('rate limiting & availability integration', () => {
    beforeEach(async () => {
      await service.loadAccounts();
    });

    it('manages rate limits and model success', () => {
      service.reportProviderRateLimit('acc-1', 'google', 60000);
      expect(service.isRateLimited('acc-1')).toBe(true);

      expect(service.getRemainingRateLimitWait('acc-1')).toBeGreaterThan(0);
      expect(service.getMinimumRateLimitWaitForPool({ model: 'gemini-2.0-flash' })).toBeGreaterThan(0);

      service.markModelSuccess('acc-1', 'gemini-2.0-flash');
      expect(service.isRateLimited('acc-1', 'gemini-2.0-flash')).toBe(false);

      service.clearAllRateLimits();
      expect(service.isRateLimited('acc-1')).toBe(false);
    });

    it('markValidationRequired mutates health and quarantines account for 10 minutes', async () => {
      await service.markValidationRequired({
        accountId: 'acc-1',
        verificationUrl: 'https://accounts.google.com/verify',
        description: 'Identity verification required',
      });

      expect(mockStore.mutateHealth).toHaveBeenCalledWith('acc-1', expect.any(Function));
    });
  });

  describe('getNextToken (standard lease)', () => {
    beforeEach(async () => {
      await service.loadAccounts();
    });

    it('leases an eligible account for a model', async () => {
      const account = await service.getNextToken({ model: 'gemini-2.0-flash' });
      expect(account).not.toBeNull();
      expect(account?.id).toMatch(/^acc-[12]$/);
    });

    it('respects allowedAccountIds filter', async () => {
      const account = await service.getNextToken({
        model: 'gemini-2.0-flash',
        allowedAccountIds: ['acc-2'],
      });
      expect(account?.id).toBe('acc-2');
    });

    it('returns null when allowedAccountIds excludes all accounts', async () => {
      const account = await service.getNextToken({
        model: 'gemini-2.0-flash',
        allowedAccountIds: ['acc-nonexistent'],
      });
      expect(account).toBeNull();
    });

    it('returns null when no account supports the requested model', async () => {
      const account = await service.getNextToken({ model: 'unsupported-model-xyz' });
      expect(account).toBeNull();
    });

    it('returns null when all eligible accounts are excluded', async () => {
      const account = await service.getNextToken({
        model: 'gemini-2.0-flash',
        excludeAccountIds: ['acc-1', 'acc-2'],
      });
      expect(account).toBeNull();
    });
  });

  describe('getNextImageToken (image scheduler lease)', () => {
    beforeEach(async () => {
      await service.loadAccounts();
    });

    it('leases an account with an ImageAccountPermit', async () => {
      const lease = await service.getNextImageToken({ model: 'gemini-2.0-flash' });
      expect(lease).toBeDefined();
      expect(lease.token.id).toMatch(/^acc-[12]$/);
      expect(lease.permit).toBeDefined();

      lease.permit.release();
    });

    it('throws ImageQueueAbortedError when signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        service.getNextImageToken({
          model: 'gemini-2.0-flash',
          signal: controller.signal,
        }),
      ).rejects.toThrow(ImageQueueAbortedError);
    });

    it('throws ImageAccountUnavailableError when no accounts are available', async () => {
      await expect(
        service.getNextImageToken({
          model: 'gemini-2.0-flash',
          excludeAccountIds: ['acc-1', 'acc-2'],
        }),
      ).rejects.toThrow(ImageAccountUnavailableError);
    });
  });

  describe('model metadata and collection methods', () => {
    beforeEach(async () => {
      await service.loadAccounts();
    });

    it('getAllCollectedModels includes quota models and discovered provider models', async () => {
      await service.refreshDiscoveredProviderModels();
      const models = service.getAllCollectedModels();

      expect(models.has('gemini-2.0-flash')).toBe(true);
      expect(models.has('gemini-2.5-pro')).toBe(true);
      expect(models.has('claude-3-7-sonnet')).toBe(true);
    });

    it('getAllRawQuotaModels returns raw quota models', () => {
      const raw = service.getAllRawQuotaModels();
      expect(raw.has('gemini-2.0-flash')).toBe(true);
    });

    it('resolves dynamic model and limits', () => {
      expect(service.resolveDynamicModelForAccount('acc-1', 'gemini-2.0-flash')).toBe(
        'gemini-2.0-flash',
      );
      expect(service.getModelOutputLimitForAccount('acc-1', 'gemini-2.0-flash')).toBeUndefined();
      expect(service.getModelThinkingBudgetForAccount('acc-1', 'gemini-2.0-flash')).toBeUndefined();
    });
  });
});

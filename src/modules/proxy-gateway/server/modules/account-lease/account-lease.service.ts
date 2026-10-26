import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import type { CloudAccount, CloudAccountHealth } from '@/modules/cloud-account/types';
import type { UpstreamProviderType } from '@/modules/proxy-gateway/routing/routing.types';
import { RateLimitTrackerService, RateLimitReason } from '../../shared/services/rate-limit-tracker.service';
import {
  ACCOUNT_LEASE_ACCOUNT_STORE,
  ACCOUNT_LEASE_UPSTREAM,
  type AccountLeaseAccountStore,
  type AccountLeaseUpstream,
  cloudAccountStoreAdapter,
  googleAccountLeaseUpstreamAdapter,
} from './interfaces/account-lease-adapters';
import { AccountLeaseQuotaRefreshPolicy } from './policies/account-lease-quota-refresh.policy';
import { AccountLeaseTokenCache } from './stores/account-lease-token.store';
import {
  AccountLeaseHydrationPolicy,
  AccountLeaseRefreshRejectedError,
} from './policies/account-lease-hydration.policy';
import { AccountLeaseFulfillmentPolicy } from './policies/account-lease-fulfillment.policy';
import { AccountLeaseSelectionPolicy } from './policies/account-lease-selection.policy';
import { AccountLeaseModelPolicy } from './policies/account-lease-model.policy';
import {
  type AccountLeaseTokenData,
  normalizeModelId,
} from './interfaces/account-lease-token-types';
import {
  AccountLeaseLimitPolicy,
  type AccountLeaseUpstreamErrorParams,
} from './policies/account-lease-limit.policy';
import { AccountLeaseConfigPolicy } from './policies/account-lease-config.policy';
import { normalizeTrustedGoogleValidationUrl } from '@/modules/cloud-account/utils/google-validation-url';
import {
  ModelAvailabilityService,
  proxyModelAvailabilityStore,
} from '../../shared/services/model-availability.service';
import {
  ImageAccountPermit,
  ImageAccountSchedulerService,
} from './image-account-scheduler.service';
import { ProviderModelDiscoveryService } from '@/modules/proxy-gateway/upstreams/provider-model-discovery.service';
import type { ProviderUsageInfo } from '@/modules/proxy-gateway/upstreams/provider-model-discovery.service';
import { getServerConfig } from '@/server/server-config';

export interface GetNextTokenOptions {
  sessionKey?: string;
  excludeAccountIds?: string[];
  allowedAccountIds?: string[];
  model?: string;
}

export interface GetNextImageTokenOptions extends GetNextTokenOptions {
  signal?: AbortSignal;
}

export interface ImageTokenLease {
  permit: ImageAccountPermit;
  token: CloudAccount;
}

export class ImageQueueTimeoutError extends HttpException {
  constructor() {
    super('Image queue wait timed out', HttpStatus.TOO_MANY_REQUESTS);
  }
}

export class ImageAccountUnavailableError extends HttpException {
  constructor() {
    super('No available image accounts', HttpStatus.SERVICE_UNAVAILABLE);
  }
}

export class ImageQueueAbortedError extends Error {
  constructor() {
    super('Image request was aborted');
    this.name = 'AbortError';
  }
}

type TokenData = AccountLeaseTokenData;
type TokenEntry = [string, TokenData];

@Injectable()
export class AccountLeaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AccountLeaseService.name);
  private readonly stickySessionTtlMs = 10 * 60 * 1000;
  private readonly rateLimitCooldownMs = 5 * 60 * 1000;
  private readonly forbiddenCooldownMs = 30 * 60 * 1000;

  private tokens: Map<string, TokenData> = new Map();
  private allAccounts: Map<string, CloudAccount> = new Map();
  private providerRoundRobinIndex: Map<string, number> = new Map();
  private discoveredProviderModels: Map<string, Set<string>> = new Map();
  private discoveredProviderUsage: Map<string, ProviderUsageInfo> = new Map();
  private readonly configPolicy = new AccountLeaseConfigPolicy();
  private readonly quotaRefreshPolicy: AccountLeaseQuotaRefreshPolicy;
  private readonly tokenCache: AccountLeaseTokenCache;
  private readonly selectionPolicy = new AccountLeaseSelectionPolicy();
  private readonly hydrationPolicy: AccountLeaseHydrationPolicy;
  private readonly fulfillmentPolicy: AccountLeaseFulfillmentPolicy;
  private readonly modelPolicy: AccountLeaseModelPolicy;
  private readonly limitPolicy: AccountLeaseLimitPolicy;

  constructor(
    @Optional()
    @Inject(ACCOUNT_LEASE_ACCOUNT_STORE)
    private readonly accountStore: AccountLeaseAccountStore = cloudAccountStoreAdapter,
    @Optional()
    @Inject(ACCOUNT_LEASE_UPSTREAM)
    private readonly upstream: AccountLeaseUpstream = googleAccountLeaseUpstreamAdapter,
    // Under Nest the module provides the singleton and the token wins. The default only
    // applies when the service is constructed directly, which today is tests alone.
    @Optional()
    @Inject(RateLimitTrackerService)
    private readonly rateLimitTrackerService: RateLimitTrackerService = new RateLimitTrackerService(),
    @Optional()
    @Inject(ModelAvailabilityService)
    private readonly modelAvailability: ModelAvailabilityService = proxyModelAvailabilityStore,
    @Optional()
    @Inject(ImageAccountSchedulerService)
    private readonly imageScheduler: ImageAccountSchedulerService = new ImageAccountSchedulerService(),
    @Optional()
    @Inject(ProviderModelDiscoveryService)
    private readonly providerModelDiscovery?: ProviderModelDiscoveryService,
  ) {
    this.quotaRefreshPolicy = new AccountLeaseQuotaRefreshPolicy({
      accountStore: this.accountStore,
      upstream: this.upstream,
      getTokenCache: () => this.tokens,
      setLockoutUntilIso: (accountId, resetTime, reason, model) =>
        this.rateLimitTracker.setLockoutUntilIso(accountId, resetTime, reason, model),
      clearRecoveredQuotaLocks: (accountId, recoveredModels, isAccountRecovered) =>
        this.limitPolicy.clearRecoveredQuotaLocks(accountId, recoveredModels, isAccountRecovered),
      logger: this.logger,
    });
    this.tokenCache = new AccountLeaseTokenCache({
      accountStore: this.accountStore,
      getTokenCache: () => this.tokens,
      applyQuotaSnapshot: (snapshot) => this.quotaRefreshPolicy.applyModelForwardingRules(snapshot),
      logger: this.logger,
    });
    this.hydrationPolicy = new AccountLeaseHydrationPolicy({
      accountStore: this.accountStore,
      upstream: this.upstream,
      getTokenCache: () => this.tokens,
      logger: this.logger,
      persistTokenState: (accountId, tokenData) => this.persistTokenState(accountId, tokenData),
    });
    this.fulfillmentPolicy = new AccountLeaseFulfillmentPolicy({
      hydrationPolicy: this.hydrationPolicy,
      bindSession: (sessionKey, accountId, expiresAt) =>
        this.selectionPolicy.bindSession(sessionKey, accountId, expiresAt),
      stickySessionTtlMs: this.stickySessionTtlMs,
      resolveFallbackProjectId: () => this.configPolicy.resolveFallbackProjectId(),
      logger: this.logger,
    });
    this.modelPolicy = new AccountLeaseModelPolicy({
      getTokenCache: () => this.tokens,
      logger: this.logger,
    });
    this.limitPolicy = new AccountLeaseLimitPolicy({
      rateLimitCooldownMs: this.rateLimitCooldownMs,
      forbiddenCooldownMs: this.forbiddenCooldownMs,
      resolveAccountId: (accountIdOrEmail) => this.resolveAccountId(accountIdOrEmail),
      getCircuitBreakerBackoffSteps: () => this.configPolicy.getCircuitBreakerBackoffSteps(),
      refreshRealtimeQuotaAndReconcileLimit: (accountId, reason, model) =>
        this.quotaRefreshPolicy.refreshRealtimeQuotaAndReconcileLimit(accountId, reason, model),
      setPreciseLockoutFromCachedQuota: (accountId, reason, model) =>
        this.quotaRefreshPolicy.setPreciseLockoutFromCachedQuota(accountId, reason, model),
      logger: this.logger,
      rateLimitTracker: this.rateLimitTrackerService,
    });
  }

  private get accountCooldowns(): Map<string, number> {
    return this.limitPolicy.getAccountCooldowns();
  }

  private get rateLimitTracker(): RateLimitTrackerService {
    return this.limitPolicy.getRateLimitTracker();
  }

  private get shadowComparisonCount(): number {
    return this.selectionPolicy.getShadowComparisonCount();
  }

  private get noGoBlocked(): boolean {
    return this.selectionPolicy.isNoGoBlocked();
  }

  private periodicQuotaSyncTimer?: NodeJS.Timeout;
  private providerModelSyncTimer?: NodeJS.Timeout;

  async onModuleInit() {
    await this.loadAccounts();
    this.restorePersistedLongImageLimits();
    void this.syncAllAccountQuotas();
    void this.refreshDiscoveredProviderModels();
    this.periodicQuotaSyncTimer = setInterval(() => {
      void this.syncAllAccountQuotas();
    }, 60 * 60 * 1000);
    this.periodicQuotaSyncTimer.unref?.();
    this.providerModelSyncTimer = setInterval(() => {
      void this.refreshDiscoveredProviderModels();
    }, 10 * 60 * 1000);
    this.providerModelSyncTimer.unref?.();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.periodicQuotaSyncTimer) {
      clearInterval(this.periodicQuotaSyncTimer);
      this.periodicQuotaSyncTimer = undefined;
    }
    if (this.providerModelSyncTimer) {
      clearInterval(this.providerModelSyncTimer);
      this.providerModelSyncTimer = undefined;
    }
    await this.hydrationPolicy.drainBackgroundPersistence();
  }

  async syncAllAccountQuotas(): Promise<void> {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const accountIds = Array.from(this.tokens.keys()).filter(
      (accountId) => !this.isAccountDisabled(accountId),
    );
    if (accountIds.length === 0) {
      return;
    }

    this.logger.log(
      `[DynamicModelDiscovery] Starting upstream quota & model discovery for ${accountIds.length} account(s)...`,
    );
    for (const accountId of accountIds) {
      const tokenData = this.tokens.get(accountId);
      if (!tokenData) continue;
      try {
        await this.hydrationPolicy.refreshSelectedTokenIfNeeded(accountId, tokenData, nowSeconds);
        const synced = await this.quotaRefreshPolicy.syncAccountQuota(accountId);
        if (synced) {
          this.logger.log(
            `[DynamicModelDiscovery] Successfully discovered models & refreshed quota for ${tokenData.email}`,
          );
        }
      } catch (error) {
        this.logger.warn(
          `[DynamicModelDiscovery] Failed to sync models for ${tokenData.email}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  async loadAccounts(): Promise<number> {
    try {
      const rawAccounts = await this.accountStore.getAccounts();
      this.allAccounts.clear();
      for (const acc of rawAccounts) {
        this.allAccounts.set(acc.id, acc);
      }
      void this.refreshDiscoveredProviderModels();
      return await this.tokenCache.loadAccounts();
    } finally {
      this.syncImageSchedulerAccounts();
    }
  }

  async reloadAllAccounts(): Promise<number> {
    const count = await this.loadAccounts();
    this.resetRateLimitsFromPersistence();
    this.clearAllSessions();
    void this.syncAllAccountQuotas();
    return count;
  }

  async reloadAllAccountsOrThrow(): Promise<number> {
    let count: number;
    try {
      const rawAccounts = await this.accountStore.getAccounts();
      this.allAccounts.clear();
      for (const acc of rawAccounts) {
        this.allAccounts.set(acc.id, acc);
      }
      count = await this.tokenCache.loadAccountsOrThrow();
    } finally {
      this.syncImageSchedulerAccounts();
    }
    this.resetRateLimitsFromPersistence();
    this.clearAllSessions();
    void this.syncAllAccountQuotas();
    return count;
  }

  /**
   * An account disabled through `PATCH /internal/accounts/:id` must never be
   * selected, refreshed, or counted as active. `this.tokens` is built from every
   * account that carries a token, so the `is_active` flag has to be checked
   * against `allAccounts` at each use site.
   */
  private isAccountDisabled(accountId: string): boolean {
    return this.allAccounts.get(accountId)?.is_active === false;
  }

  public getAccountsForProvider(providerType: UpstreamProviderType): CloudAccount[] {
    const accounts = Array.from(this.allAccounts.values());

    return accounts.filter((acc) => {
      if (acc.is_active === false) return false;
      if (this.rateLimitTracker.isRateLimited(acc.id)) return false;

      switch (providerType) {
        case 'google':
          return (
            (acc.provider === 'google' || !acc.provider) &&
            Boolean(acc.token?.access_token || acc.token?.refresh_token)
          );
        case 'anthropic_api':
          return acc.provider === 'anthropic' && Boolean(acc.api_key);
        case 'anthropic_oauth':
          return (
            acc.provider === 'anthropic' &&
            Boolean(acc.token?.access_token || acc.token?.refresh_token)
          );
        case 'anthropic_web':
          return (
            acc.provider === 'anthropic' &&
            Boolean(acc.session_key || acc.auth_type === 'web_session')
          );
        case 'copilot':
          return (
            (acc.provider === 'copilot' || acc.provider === 'openai') &&
            Boolean(acc.github_token || acc.copilot_token || acc.auth_type === 'copilot_token')
          );
        case 'openai_api':
          return acc.provider === 'openai' && Boolean(acc.api_key);
        case 'chatgpt_web':
          return (
            acc.provider === 'openai' &&
            (acc.auth_type === 'web_session' || Boolean(acc.token?.access_token))
          );
        default:
          return false;
      }
    });
  }

  public getNextAccountForProvider(
    providerType: UpstreamProviderType,
    options?: { excludeAccountIds?: string[]; model?: string },
  ): CloudAccount | null {
    const candidates = this.getAccountsForProvider(providerType);
    const excluded = new Set(options?.excludeAccountIds || []);
    const available = candidates.filter((acc) => !excluded.has(acc.id));

    if (available.length === 0) {
      return null;
    }

    const currentIndex = this.providerRoundRobinIndex.get(providerType) || 0;
    const selected = available[currentIndex % available.length];
    this.providerRoundRobinIndex.set(providerType, currentIndex + 1);

    selected.last_used = Date.now();
    return selected;
  }

  public reportProviderRateLimit(
    accountId: string,
    providerType: UpstreamProviderType,
    cooldownMs: number = 60_000,
  ): void {
    const resetTimeIso = new Date(Date.now() + cooldownMs).toISOString();
    this.rateLimitTracker.setLockoutUntilIso(
      accountId,
      resetTimeIso,
      RateLimitReason.RateLimitExceeded,
    );
    this.logger.warn(
      `Account ${accountId} for provider ${providerType} marked as rate-limited until ${resetTimeIso}`,
    );
  }

  clearAllSessions(): void {
    this.selectionPolicy.clearSessions();
  }

  async getAccountsOverview() {
    const rawAccounts = await this.accountStore.getAccounts();
    return rawAccounts.map((account) => {
      const isLocked = this.rateLimitTracker.isRateLimited(account.id);
      const remainingWaitSec = this.rateLimitTracker.getRemainingWaitSec(account.id);
      return {
        id: account.id,
        email: account.email,
        name: account.name ?? null,
        is_active: account.is_active !== false,
        provider: account.provider,
        auth_type: account.auth_type,
        project_id: account.token?.project_id,
        created_at: account.created_at,
        last_used: account.last_used,
        is_healthy: account.health?.oauth?.refresh_blocked !== true,
        is_cooldown: isLocked,
        cooldown_remaining_sec: remainingWaitSec,
        quota: account.quota,
        provider_models: this.getDiscoveredModelsForAccount(account),
        provider_usage: this.discoveredProviderUsage.get(account.id),
      };
    });
  }

  /**
   * Returns the dynamically discovered model IDs for a non-Google account, so the UI can
   * show which models an Anthropic / OpenAI / Copilot account actually serves even though
   * it has no Google-style quota payload.
   */
  private getDiscoveredModelsForAccount(account: CloudAccount): string[] | undefined {
    if (!account.provider || account.provider === 'google') return undefined;
    const key = this.providerKeyForAccount(account);
    const models = this.discoveredProviderModels.get(key);
    if (!models || models.size === 0) return undefined;
    return Array.from(models).sort();
  }

  private providerKeyForAccount(account: CloudAccount): string {
    if (account.provider === 'anthropic') {
      return account.auth_type === 'api_key' ? 'anthropic_api' : 'anthropic_oauth';
    }
    if (account.provider === 'openai') {
      return account.auth_type === 'api_key' ? 'openai_api' : 'chatgpt_web';
    }
    if (account.provider === 'copilot') {
      return 'copilot';
    }
    return account.provider;
  }

  async deleteAccountById(accountId: string): Promise<boolean> {
    this.evictAccount(accountId);
    if (this.accountStore.deleteAccount) {
      return await this.accountStore.deleteAccount(accountId);
    }
    return false;
  }

  async syncSingleAccount(accountId: string): Promise<boolean> {
    const tokenData = this.tokens.get(accountId);
    if (!tokenData) return false;
    const nowSeconds = Math.floor(Date.now() / 1000);
    await this.hydrationPolicy.refreshSelectedTokenIfNeeded(accountId, tokenData, nowSeconds);
    return await this.quotaRefreshPolicy.syncAccountQuota(accountId);
  }

  evictAccount(accountId: string): boolean {
    this.selectionPolicy.clearAccountSessions(accountId);
    const deleted = this.tokens.delete(accountId);
    this.syncImageSchedulerAccounts();
    return deleted;
  }

  updateAccountOAuthHealth(accountId: string, oauthHealth: CloudAccountHealth['oauth']): boolean {
    const tokenData = this.tokens.get(accountId);
    if (!tokenData) {
      return false;
    }
    tokenData.oauth_health = oauthHealth;
    return true;
  }

  clearAllRateLimits(): void {
    this.limitPolicy.clearAllRateLimits();
  }

  private resetRateLimitsFromPersistence(): void {
    this.clearAllRateLimits();
    this.restorePersistedLongImageLimits();
  }

  private restorePersistedLongImageLimits(): void {
    for (const entry of this.modelAvailability.getActiveSnapshot()) {
      this.rateLimitTracker.restorePersistedLongImageLimit(entry);
    }
  }

  recordParityError(): void {
    this.selectionPolicy.recordParityError(this.configPolicy.getSelectionConfig(), this.logger);
  }

  setPreferredAccount(accountId?: string): void {
    this.configPolicy.setPreferredAccount(accountId);
  }

  isRateLimited(accountIdOrEmail: string, model?: string): boolean {
    return this.limitPolicy.isRateLimited(accountIdOrEmail, model);
  }

  markAsRateLimited(accountIdOrEmail: string) {
    this.limitPolicy.markAsRateLimited(accountIdOrEmail);
  }

  markAsForbidden(accountIdOrEmail: string) {
    this.limitPolicy.markAsForbidden(accountIdOrEmail);
  }

  markModelSuccess(accountIdOrEmail: string, model: string): void {
    this.limitPolicy.markModelSuccess(accountIdOrEmail, model);
  }

  getRemainingRateLimitWait(accountIdOrEmail: string, model?: string): number {
    const accountId = this.resolveAccountId(accountIdOrEmail) ?? accountIdOrEmail;
    return this.rateLimitTracker.getRemainingWaitSeconds(
      accountId,
      normalizeModelId(model) ?? model,
    );
  }

  getMinimumRateLimitWaitForPool(options?: { model?: string }): number | undefined {
    const now = Date.now();
    const model = normalizeModelId(options?.model) ?? options?.model;
    const availableAccounts = Array.from(this.tokens.entries()).filter(
      ([, tokenData]) =>
        tokenData.validation_blocked_until_ms === undefined ||
        now >= tokenData.validation_blocked_until_ms,
    );
    const waits = this.selectModelCapableAccounts(availableAccounts, model)
      .map(([accountId]) => this.rateLimitTracker.getRemainingWaitSeconds(accountId, model))
      .filter((waitSeconds) => waitSeconds > 0);
    return waits.length > 0 ? Math.min(...waits) : undefined;
  }

  async markFromUpstreamError(params: AccountLeaseUpstreamErrorParams): Promise<void> {
    await this.limitPolicy.markFromUpstreamError(params);
  }

  markImageRateLimitFast(params: AccountLeaseUpstreamErrorParams): boolean {
    return this.limitPolicy.markImageRateLimitFast(params);
  }

  async reconcileImageRateLimit(params: AccountLeaseUpstreamErrorParams): Promise<void> {
    await this.limitPolicy.reconcileImageRateLimit(params);
  }

  async markValidationRequired(params: {
    accountId: string;
    verificationUrl?: string;
    description?: string;
  }): Promise<void> {
    const now = Date.now();
    const nextProbeAt = now + 10 * 60 * 1000;
    const updateHealth = (health: CloudAccount['health']): CloudAccount['health'] => ({
      ...health,
      validation: {
        status: 'requires_action',
        reason: 'VALIDATION_REQUIRED',
        detected_at_ms: now,
        next_probe_at_ms: nextProbeAt,
        verification_url: normalizeTrustedGoogleValidationUrl(params.verificationUrl),
        description: params.description?.trim().slice(0, 500) || undefined,
      },
    });

    await this.accountStore.mutateHealth(params.accountId, updateHealth);

    const tokenData = this.tokens.get(params.accountId);
    if (tokenData) {
      tokenData.validation_blocked_until_ms = nextProbeAt;
    }
    this.selectionPolicy.clearAccountSessions(params.accountId);
  }

  async getNextToken(options?: GetNextTokenOptions): Promise<CloudAccount | null> {
    try {
      if (this.tokens.size === 0) {
        await this.loadAccounts();
      }
      if (this.tokens.size === 0) {
        return null;
      }

      const now = Date.now();
      const nowSeconds = Math.floor(now / 1000);
      const sessionKey = options?.sessionKey?.trim();
      const model = options?.model;
      const excludedAccountIds = new Set(options?.excludeAccountIds ?? []);
      const allowedAccountIds =
        options?.allowedAccountIds && options.allowedAccountIds.length > 0
          ? new Set(options.allowedAccountIds)
          : null;

      this.rateLimitTracker.cleanupExpired();

      const fullAccountPool = Array.from(this.tokens.entries()).filter(
        ([accountId, tokenData]) => {
          if (this.isAccountDisabled(accountId)) {
            return false;
          }
          if (
            allowedAccountIds &&
            !allowedAccountIds.has(accountId) &&
            !allowedAccountIds.has(tokenData.email)
          ) {
            return false;
          }
          return (
            tokenData.validation_blocked_until_ms === undefined ||
            now >= tokenData.validation_blocked_until_ms
          );
        },
      );

      if (allowedAccountIds && fullAccountPool.length === 0) {
        this.logger.warn(
          `No configured accounts match the allowed account list: ${Array.from(allowedAccountIds).join(', ')}`,
        );
        return null;
      }

      const modelCapableAccountPool = this.selectModelCapableAccounts(fullAccountPool, model);
      if (modelCapableAccountPool.length === 0) {
        if (allowedAccountIds) {
          this.logger.warn(
            `None of the allowed accounts (${Array.from(allowedAccountIds).join(', ')}) advertise requested model: ${model ?? 'unknown'}`,
          );
        } else {
          this.logger.warn(`No account advertises requested model: ${model ?? 'unknown'}`);
        }
        return null;
      }

      const filteredAccountPool = modelCapableAccountPool.filter(
        ([accountId]) => !excludedAccountIds.has(accountId),
      );
      if (filteredAccountPool.length === 0 && excludedAccountIds.size > 0) {
        this.logger.warn('Exclusion filter removed all accounts');
      }

      if (filteredAccountPool.length === 0) {
        this.logger.warn('No eligible account found after exclusion filtering');
        return null;
      }

      let remainingAccountPool = filteredAccountPool;
      for (let attempt = 0; attempt < filteredAccountPool.length; attempt += 1) {
        const selectedTokenEntry = await this.selectionPolicy.selectCandidate({
          allTokens: remainingAccountPool,
          getModelQuota: (accountId, tokenData, requestedModel) => {
            const accountModel = this.modelPolicy.resolveDynamicModelForAccount(
              accountId,
              requestedModel,
            );
            const normalizedModel = normalizeModelId(accountModel);
            return normalizedModel ? tokenData.model_quotas?.[normalizedModel] : undefined;
          },
          sessionKey,
          model,
          now,
          accountCooldowns: this.accountCooldowns,
          rateLimitTracker: this.rateLimitTracker,
          config: this.configPolicy.getSelectionConfig(),
          logger: this.logger,
        });

        if (!selectedTokenEntry) {
          return null;
        }

        const [accountId, tokenData] = selectedTokenEntry;
        try {
          return await this.finalizeSelectedToken(accountId, tokenData, nowSeconds, sessionKey);
        } catch (error) {
          if (!(error instanceof AccountLeaseRefreshRejectedError)) {
            throw error;
          }
          remainingAccountPool = remainingAccountPool.filter(([id]) => id !== accountId);
        }
      }

      return null;
    } catch (error) {
      this.logger.error('Failed to select the next account token', error);
      return null;
    }
  }

  async getNextImageToken(options: GetNextImageTokenOptions = {}): Promise<ImageTokenLease> {
    this.syncImageSchedulerAccounts();
    const timeoutMs = Math.max(1, (getServerConfig()?.request_timeout ?? 120) * 1000);
    const deadline = Date.now() + timeoutMs;

    while (true) {
      this.throwIfImageSelectionAborted(options.signal);
      const busyAccountIds = new Set<string>();

      while (true) {
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) {
          throw new ImageQueueTimeoutError();
        }

        const token = this.getNextToken({
          sessionKey: options.sessionKey,
          model: options.model,
          allowedAccountIds: options.allowedAccountIds,
          excludeAccountIds: [...(options.excludeAccountIds ?? []), ...busyAccountIds],
        });
        const selected = await this.waitForImageSelection(token, remainingMs, options.signal);
        if (selected === null) {
          if (busyAccountIds.size === 0) {
            throw new ImageAccountUnavailableError();
          }
          break;
        }

        const permit = this.imageScheduler.tryAcquire(selected.id);
        if (permit) {
          return { token: selected, permit };
        }
        busyAccountIds.add(selected.id);
      }

      const waitResult = await this.imageScheduler.waitForChange(
        deadline - Date.now(),
        options.signal,
      );
      if (waitResult === 'aborted') {
        throw new ImageQueueAbortedError();
      }
      if (Date.now() >= deadline) {
        throw new ImageQueueTimeoutError();
      }
    }
  }

  private async waitForImageSelection(
    selection: Promise<CloudAccount | null>,
    remainingMs: number,
    signal?: AbortSignal,
  ): Promise<CloudAccount | null> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (value: CloudAccount | null): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve(value);
      };
      const fail = (error: unknown): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        reject(error);
      };
      const onAbort = (): void => fail(new ImageQueueAbortedError());
      const timer = setTimeout(() => fail(new ImageQueueTimeoutError()), remainingMs);
      signal?.addEventListener('abort', onAbort, { once: true });
      void selection.then(finish, fail);
    });
  }

  private throwIfImageSelectionAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new ImageQueueAbortedError();
    }
  }

  private syncImageSchedulerAccounts(): void {
    const enabledAccountIds = Array.from(this.tokens.keys()).filter(
      (accountId) => !this.isAccountDisabled(accountId),
    );
    this.imageScheduler.syncAccounts(enabledAccountIds);
  }

  private selectModelCapableAccounts(allTokens: TokenEntry[], model?: string): TokenEntry[] {
    if (!model) {
      return allTokens;
    }

    const exact: TokenEntry[] = [];
    const compatible: TokenEntry[] = [];
    const unknown: TokenEntry[] = [];
    for (const entry of allTokens) {
      const exactAvailability = this.modelPolicy.getExactModelAvailabilityForAccount(
        entry[0],
        model,
      );
      if (exactAvailability === 'available') {
        exact.push(entry);
        continue;
      }

      const availability = this.modelPolicy.getModelAvailabilityForAccount(entry[0], model);
      if (availability === 'available') {
        compatible.push(entry);
      } else if (availability === 'unknown') {
        unknown.push(entry);
      }
    }

    if (exact.length > 0) {
      return exact;
    }
    if (compatible.length > 0) {
      return compatible;
    }

    return unknown;
  }

  public resetSelectionState(): void {
    this.selectionPolicy.resetSelectionState();
  }

  private async finalizeSelectedToken(
    accountId: string,
    tokenData: TokenData,
    nowSeconds: number,
    sessionKey?: string,
  ): Promise<CloudAccount | null> {
    return this.fulfillmentPolicy.finalizeSelectedToken({
      accountId,
      tokenData,
      nowSeconds,
      sessionKey,
    });
  }

  private async refreshSelectedTokenIfNeeded(
    accountId: string,
    tokenData: TokenData,
    nowSeconds: number,
  ): Promise<void> {
    await this.hydrationPolicy.refreshSelectedTokenIfNeeded(accountId, tokenData, nowSeconds);
  }

  private async refreshSelectedTokenLocked(
    accountId: string,
    tokenData: TokenData,
    nowSeconds: number,
  ): Promise<void> {
    await this.hydrationPolicy.refreshSelectedTokenLocked(accountId, tokenData, nowSeconds);
  }

  private async resolveProjectIdWithLock(
    accountId: string,
    tokenData: TokenData,
  ): Promise<string | undefined> {
    return this.hydrationPolicy.resolveProjectIdWithLock(accountId, tokenData);
  }

  private async runAccountLock<T>(
    locks: Map<string, Promise<T>>,
    accountId: string,
    createPromise: () => Promise<T>,
  ): Promise<T> {
    return this.hydrationPolicy.runAccountLock(locks, accountId, createPromise);
  }

  private syncTokenDataFromCache(accountId: string, tokenData: TokenData): void {
    this.hydrationPolicy.syncTokenDataFromCache(accountId, tokenData);
  }

  private async resolveProjectIdLocked(
    accountId: string,
    tokenData: TokenData,
  ): Promise<string | undefined> {
    return this.hydrationPolicy.resolveProjectIdLocked(accountId, tokenData);
  }

  private resolveAccountId(accountIdOrEmail: string): string | null {
    if (this.tokens.has(accountIdOrEmail)) {
      return accountIdOrEmail;
    }

    for (const [accountId, tokenData] of this.tokens.entries()) {
      if (tokenData.email === accountIdOrEmail) {
        return accountId;
      }
    }

    return null;
  }

  private async persistTokenState(accountId: string, tokenData: TokenData) {
    await this.hydrationPolicy.persistTokenState(accountId, tokenData);
  }

  getAccountCount(): number {
    return this.tokens.size;
  }

  private normalizeRefreshedOauthClientKey(
    currentToken: { oauth_client_key?: string; project_id?: string },
    refreshedClientKey?: string,
  ): string | undefined {
    return this.hydrationPolicy.normalizeRefreshedOauthClientKey(currentToken, refreshedClientKey);
  }

  getAllCollectedModels(): Set<string> {
    const models = this.modelPolicy.getAllCollectedModels();
    this.mergeDiscoveredProviderModels(models);
    return models;
  }

  getAllRawQuotaModels(): Set<string> {
    return this.modelPolicy.getAllRawQuotaModels();
  }

  /**
   * Merges dynamically discovered provider models (Anthropic / OpenAI / Copilot) into
   * the collected catalog so clients can select them even when no Google quota advertises them.
   */
  private mergeDiscoveredProviderModels(target: Set<string>): void {
    for (const models of this.discoveredProviderModels.values()) {
      for (const model of models) {
        target.add(model);
      }
    }
  }

  /**
   * Refreshes the dynamically discovered model catalog for all connected non-Google accounts.
   * Called after accounts are (re)loaded and on a slow background interval.
   */
  async refreshDiscoveredProviderModels(): Promise<void> {
    if (!this.providerModelDiscovery) return;
    const nonGoogle = Array.from(this.allAccounts.values()).filter(
      (acc) => acc.provider && acc.provider !== 'google' && acc.is_active !== false,
    );
    if (nonGoogle.length === 0) {
      this.discoveredProviderModels.clear();
      this.discoveredProviderUsage.clear();
      return;
    }
    try {
      this.discoveredProviderModels =
        await this.providerModelDiscovery.discoverProviderModels(nonGoogle);

      const usagePromises = nonGoogle.map(async (account) => {
        try {
          const usage = await this.providerModelDiscovery!.discoverProviderUsage(account);
          this.discoveredProviderUsage.set(account.id, usage);
        } catch (err) {
          this.logger.warn(
            `Provider usage discovery failed for ${account.provider} account ${account.id}: ${(err as Error).message}`,
          );
        }
      });
      await Promise.all(usagePromises);
    } catch (err) {
      this.logger.warn(`Provider model discovery failed: ${(err as Error).message}`);
    }
  }

  getProviderUsageForAccount(accountId: string): ProviderUsageInfo | undefined {
    return this.discoveredProviderUsage.get(accountId);
  }

  private getAvailableModelsFromToken(tokenData: TokenData): Set<string> {
    return this.modelPolicy.getAvailableModelsFromToken(tokenData);
  }

  private buildDynamicModelCandidates(modelName: string): string[] | null {
    return this.modelPolicy.buildDynamicModelCandidates(modelName);
  }

  resolveDynamicModelForAccount(accountId: string, mappedModel: string): string {
    return this.modelPolicy.resolveDynamicModelForAccount(accountId, mappedModel);
  }

  markModelUnrequestable(modelId: string): void {
    this.modelPolicy.markModelUnrequestable(modelId);
  }

  getModelOutputLimitForAccount(accountId: string, modelName: string): number | undefined {
    return this.modelPolicy.getModelOutputLimitForAccount(accountId, modelName);
  }

  getModelThinkingBudgetForAccount(accountId: string, modelName: string): number | undefined {
    return this.modelPolicy.getModelThinkingBudgetForAccount(accountId, modelName);
  }
}

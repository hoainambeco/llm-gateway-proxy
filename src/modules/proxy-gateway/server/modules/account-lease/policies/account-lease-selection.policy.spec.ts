import {
  AccountLeaseSelectionPolicy,
  type AccountLeaseSelectionConfig,
  type AccountLeaseRateLimitReader,
  type AccountLeaseSelectionRequest,
} from './account-lease-selection.policy';

interface TestToken {
  name: string;
}

describe('AccountLeaseSelectionPolicy', () => {
  let policy: AccountLeaseSelectionPolicy;
  let mockRateLimitTracker: jest.Mocked<AccountLeaseRateLimitReader>;
  let mockLogger: { warn: jest.Mock; error: jest.Mock };

  const defaultConfig: AccountLeaseSelectionConfig = {
    quotaAwareSchedulingEnabled: true,
    parityEnabled: false,
    parityShadowEnabled: false,
    schedulingMode: 'balance',
    maxWaitMs: 3000,
    noGoMismatchRateThreshold: 0.2,
    noGoErrorRateThreshold: 0.3,
  };

  const createRequest = (
    tokens: Array<[string, TestToken]>,
    overrides?: Partial<AccountLeaseSelectionRequest<TestToken>>,
  ): AccountLeaseSelectionRequest<TestToken> => ({
    allTokens: tokens,
    now: 100000,
    accountCooldowns: new Map(),
    rateLimitTracker: mockRateLimitTracker,
    config: { ...defaultConfig },
    logger: mockLogger,
    ...overrides,
  });

  beforeEach(() => {
    policy = new AccountLeaseSelectionPolicy();
    mockRateLimitTracker = {
      isRateLimited: jest.fn().mockReturnValue(false),
      getRemainingWaitSeconds: jest.fn().mockReturnValue(0),
    };
    mockLogger = {
      warn: jest.fn(),
      error: jest.fn(),
    };
  });

  describe('Session binding and state management', () => {
    it('binds session and clears on expiration or manual clear', () => {
      policy.bindSession(undefined, 'acc-1', 100000);
      policy.bindSession('sess-1', 'acc-1', 100050);
      policy.bindSession('sess-2', 'acc-2', 90000); // expired

      // selectCandidate clears expired sessions
      const req = createRequest([['acc-1', { name: 'Token 1' }]]);
      policy.selectCandidate(req);

      // clearAccountSessions removes specific account
      policy.bindSession('sess-3', 'acc-3', 200000);
      policy.clearAccountSessions('acc-3');

      // clearSessions wipes all
      policy.clearSessions();
      expect(policy.isNoGoBlocked()).toBe(false);
    });

    it('resets selection state round robin index', async () => {
      const tokens: Array<[string, TestToken]> = [
        ['acc-1', { name: 'T1' }],
        ['acc-2', { name: 'T2' }],
      ];
      const req = createRequest(tokens);

      const pick1 = await policy.selectCandidate(req);
      const pick2 = await policy.selectCandidate(req);
      expect(pick1?.[0]).toBe('acc-1');
      expect(pick2?.[0]).toBe('acc-2');

      policy.resetSelectionState();
      const pick3 = await policy.selectCandidate(req);
      expect(pick3?.[0]).toBe('acc-1');
    });
  });

  describe('Legacy selection (parity disabled)', () => {
    it('returns null when allTokens is empty or all accounts are on cooldown/rate-limited', async () => {
      const emptyReq = createRequest([]);
      expect(await policy.selectCandidate(emptyReq)).toBeNull();

      const tokens: Array<[string, TestToken]> = [['acc-1', { name: 'T1' }]];
      const cooldownMap = new Map([['acc-1', 200000]]);
      const cooldownReq = createRequest(tokens, { accountCooldowns: cooldownMap, now: 100000 });
      expect(await policy.selectCandidate(cooldownReq)).toBeNull();

      mockRateLimitTracker.isRateLimited.mockReturnValue(true);
      const rateLimitedReq = createRequest(tokens);
      expect(await policy.selectCandidate(rateLimitedReq)).toBeNull();
    });

    it('honors sticky session if active and not on cooldown', async () => {
      policy.bindSession('my-sess', 'acc-2', 200000);
      const tokens: Array<[string, TestToken]> = [
        ['acc-1', { name: 'T1' }],
        ['acc-2', { name: 'T2' }],
      ];
      const req = createRequest(tokens, { sessionKey: 'my-sess', now: 100000 });

      const selected = await policy.selectCandidate(req);
      expect(selected?.[0]).toBe('acc-2');
    });

    it('weights candidate selection based on model quota', async () => {
      const tokens: Array<[string, TestToken]> = [
        ['acc-low', { name: 'Low' }],
        ['acc-mid', { name: 'Mid' }],
        ['acc-high', { name: 'High' }],
      ];

      const getModelQuota = (accountId: string) => {
        if (accountId === 'acc-high') return 80; // weight 3
        if (accountId === 'acc-mid') return 50; // weight 2
        return 10; // weight 1
      };

      const req = createRequest(tokens, {
        model: 'gemini-1.5-pro',
        getModelQuota,
        config: { ...defaultConfig, quotaAwareSchedulingEnabled: true },
      });

      // Total weight: 1 + 2 + 3 = 6 entries:
      // acc-low (1), acc-mid (2), acc-high (3)
      const picks: string[] = [];
      for (let i = 0; i < 6; i++) {
        const picked = await policy.selectCandidate(req);
        if (picked) picks.push(picked[0]);
      }

      expect(picks.filter((id) => id === 'acc-high').length).toBe(3);
      expect(picks.filter((id) => id === 'acc-mid').length).toBe(2);
      expect(picks.filter((id) => id === 'acc-low').length).toBe(1);
    });

    it('retries when rate limit wait is <= 2 seconds', async () => {
      const tokens: Array<[string, TestToken]> = [['acc-wait', { name: 'W' }]];
      let rateLimited = true;
      mockRateLimitTracker.isRateLimited.mockImplementation(() => rateLimited);
      mockRateLimitTracker.getRemainingWaitSeconds.mockReturnValue(0.01); // 10ms wait

      setTimeout(() => {
        rateLimited = false;
      }, 5);

      const req = createRequest(tokens);
      const res = await policy.selectCandidate(req);
      expect(res?.[0]).toBe('acc-wait');
    });
  });

  describe('Parity selection (parity enabled)', () => {
    it('prefers configured preferredAccountId when available', async () => {
      const tokens: Array<[string, TestToken]> = [
        ['acc-1', { name: 'T1' }],
        ['acc-pref', { name: 'Pref' }],
      ];
      const req = createRequest(tokens, {
        config: {
          ...defaultConfig,
          parityEnabled: true,
          preferredAccountId: 'acc-pref',
        },
      });

      const selected = await policy.selectCandidate(req);
      expect(selected?.[0]).toBe('acc-pref');
    });

    it('returns null if preferredAccountId is set but empty list is eligible', async () => {
      const req = createRequest([], {
        config: {
          ...defaultConfig,
          parityEnabled: true,
          preferredAccountId: 'acc-pref',
        },
      });

      expect(await policy.selectCandidate(req)).toBeNull();
    });

    it('uses sticky session in parity mode', async () => {
      policy.bindSession('sess-parity', 'acc-sticky', 200000);
      const tokens: Array<[string, TestToken]> = [
        ['acc-other', { name: 'Other' }],
        ['acc-sticky', { name: 'Sticky' }],
      ];
      const req = createRequest(tokens, {
        sessionKey: 'sess-parity',
        config: {
          ...defaultConfig,
          parityEnabled: true,
        },
      });

      const selected = await policy.selectCandidate(req);
      expect(selected?.[0]).toBe('acc-sticky');
    });

    it('supports cache-first mode with sticky session wait for rate limit', async () => {
      policy.bindSession('sess-cache', 'acc-cached', 200000);
      const tokens: Array<[string, TestToken]> = [
        ['acc-cached', { name: 'Cached' }],
        ['acc-backup', { name: 'Backup' }],
      ];

      // Initially acc-cached is rate limited, remaining wait = 0.01s (10ms)
      let rateLimited = true;
      mockRateLimitTracker.isRateLimited.mockImplementation((id) => (id === 'acc-cached' ? rateLimited : false));
      mockRateLimitTracker.getRemainingWaitSeconds.mockImplementation((id) =>
        id === 'acc-cached' && rateLimited ? 0.01 : 0,
      );

      setTimeout(() => {
        rateLimited = false;
      }, 5);

      const req = createRequest(tokens, {
        sessionKey: 'sess-cache',
        config: {
          ...defaultConfig,
          parityEnabled: true,
          schedulingMode: 'cache-first',
          maxWaitMs: 1000,
        },
      });

      const selected = await policy.selectCandidate(req);
      expect(selected?.[0]).toBe('acc-cached');
    });

    it('falls back to round-robin in cache-first mode if sticky candidate remains unavailable after wait', async () => {
      policy.bindSession('sess-cache-fail', 'acc-cached', 200000);
      const tokens: Array<[string, TestToken]> = [
        ['acc-cached', { name: 'Cached' }],
        ['acc-backup', { name: 'Backup' }],
      ];

      // acc-cached is always rate limited
      mockRateLimitTracker.isRateLimited.mockImplementation((id) => id === 'acc-cached');
      mockRateLimitTracker.getRemainingWaitSeconds.mockImplementation((id) =>
        id === 'acc-cached' ? 0.01 : 0,
      );

      const req = createRequest(tokens, {
        sessionKey: 'sess-cache-fail',
        config: {
          ...defaultConfig,
          parityEnabled: true,
          schedulingMode: 'cache-first',
          maxWaitMs: 1000,
        },
      });

      const selected = await policy.selectCandidate(req);
      expect(selected?.[0]).toBe('acc-backup');
    });
  });

  describe('Parity error tracking and no-go gate', () => {
    it('ignores recordParityError when parity scheduling is not enabled', () => {
      policy.recordParityError(defaultConfig, mockLogger);
      expect(policy.isNoGoBlocked()).toBe(false);
    });

    it('blocks parity scheduling when error rate exceeds threshold', async () => {
      const parityConfig: AccountLeaseSelectionConfig = {
        ...defaultConfig,
        parityEnabled: true,
        noGoErrorRateThreshold: 0.5,
      };

      const tokens: Array<[string, TestToken]> = [['acc-1', { name: 'T1' }]];
      const req = createRequest(tokens, { config: parityConfig });

      // Run 1 successful request to increment parityRequestCount to 1
      await policy.selectCandidate(req);

      // 1 error out of 1 request = 100% error rate > 50% threshold
      policy.recordParityError(parityConfig, mockLogger);

      expect(policy.isNoGoBlocked()).toBe(true);
      expect(policy.isParitySchedulingEnabled(parityConfig)).toBe(false);
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('Shadow comparison execution and mismatch no-go', () => {
    it('executes shadow comparison when parityShadowEnabled is true and parityEnabled is false', async () => {
      const tokens: Array<[string, TestToken]> = [
        ['acc-1', { name: 'T1' }],
        ['acc-2', { name: 'T2' }],
      ];

      const shadowConfig: AccountLeaseSelectionConfig = {
        ...defaultConfig,
        parityEnabled: false,
        parityShadowEnabled: true,
        preferredAccountId: 'acc-2', // will cause parity prediction (acc-2) != legacy prediction (acc-1)
        noGoMismatchRateThreshold: 0.1,
      };

      const req = createRequest(tokens, { config: shadowConfig });

      expect(policy.shouldExecuteShadowComparison(shadowConfig)).toBe(true);
      await policy.selectCandidate(req);

      expect(policy.getShadowComparisonCount()).toBe(1);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Parity shadow mismatch detected: legacy=acc-1, parity=acc-2'),
      );
      expect(policy.isNoGoBlocked()).toBe(true);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Parity no-go triggered by mismatch threshold'),
      );
    });
  });
});

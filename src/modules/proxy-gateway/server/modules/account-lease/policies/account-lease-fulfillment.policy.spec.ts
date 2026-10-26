import { AccountLeaseFulfillmentPolicy } from './account-lease-fulfillment.policy';
import { AccountLeaseRefreshRejectedError } from './account-lease-hydration.policy';
import type { AccountLeaseHydrationPolicy } from './account-lease-hydration.policy';
import type { AccountLeaseTokenData } from '../interfaces/account-lease-token-types';

describe('AccountLeaseFulfillmentPolicy', () => {
  let mockHydrationPolicy: jest.Mocked<Pick<AccountLeaseHydrationPolicy, 'hydrateSelectedToken'>>;
  let mockBindSession: jest.Mock;
  let mockResolveFallbackProjectId: jest.Mock;
  let mockLogger: { error: jest.Mock };
  let policy: AccountLeaseFulfillmentPolicy;

  const sampleTokenData: AccountLeaseTokenData = {
    email: 'test@example.com',
    account_id: 'acc-1',
    access_token: 'acc-123',
    refresh_token: 'ref-456',
    id_token: 'id-789',
    token_type: 'Bearer',
    expires_in: 3600,
    expiry_timestamp: 1700003600,
    project_id: 'proj-origin',
    oauth_client_key: 'oauth-key',
    session_id: 'sess-123',
    upstream_proxy_url: 'http://proxy.local',
    model_quotas: {},
    model_limits: {},
    model_reset_times: {},
    model_forwarding_rules: {},
  };

  beforeEach(() => {
    mockHydrationPolicy = {
      hydrateSelectedToken: jest.fn().mockResolvedValue('proj-effective'),
    };
    mockBindSession = jest.fn();
    mockResolveFallbackProjectId = jest.fn().mockReturnValue('proj-fallback');
    mockLogger = {
      error: jest.fn(),
    };

    policy = new AccountLeaseFulfillmentPolicy({
      hydrationPolicy: mockHydrationPolicy as unknown as AccountLeaseHydrationPolicy,
      bindSession: mockBindSession,
      stickySessionTtlMs: 60000,
      resolveFallbackProjectId: mockResolveFallbackProjectId,
      logger: mockLogger,
    });
  });

  it('finalizes selected token on happy path and binds sticky session', async () => {
    const before = Date.now();
    const result = await policy.finalizeSelectedToken({
      accountId: 'acc-1',
      tokenData: sampleTokenData,
      nowSeconds: 1700000000,
      sessionKey: 'user-session-abc',
    });
    const after = Date.now();

    expect(mockHydrationPolicy.hydrateSelectedToken).toHaveBeenCalledWith({
      accountId: 'acc-1',
      tokenData: sampleTokenData,
      nowSeconds: 1700000000,
      fallbackProjectId: 'proj-fallback',
    });

    expect(mockBindSession).toHaveBeenCalledTimes(1);
    expect(mockBindSession.mock.calls[0][0]).toBe('user-session-abc');
    expect(mockBindSession.mock.calls[0][1]).toBe('acc-1');
    expect(mockBindSession.mock.calls[0][2]).toBeGreaterThanOrEqual(before + 60000);
    expect(mockBindSession.mock.calls[0][2]).toBeLessThanOrEqual(after + 60000);

    expect(result).not.toBeNull();
    expect(result).toEqual({
      id: 'acc-1',
      provider: 'google',
      email: 'test@example.com',
      token: {
        access_token: 'acc-123',
        refresh_token: 'ref-456',
        id_token: 'id-789',
        token_type: 'Bearer',
        expires_in: 3600,
        expiry_timestamp: 1700003600,
        project_id: 'proj-effective',
        oauth_client_key: 'oauth-key',
        session_id: 'sess-123',
        upstream_proxy_url: 'http://proxy.local',
      },
      created_at: expect.any(Number),
      last_used: expect.any(Number),
    });
  });

  it('rethrows AccountLeaseRefreshRejectedError without logging error', async () => {
    const rejectedError = new AccountLeaseRefreshRejectedError('acc-1', 'invalid_grant');
    mockHydrationPolicy.hydrateSelectedToken.mockRejectedValueOnce(rejectedError);

    await expect(
      policy.finalizeSelectedToken({
        accountId: 'acc-1',
        tokenData: sampleTokenData,
        nowSeconds: 1700000000,
      }),
    ).rejects.toThrow(AccountLeaseRefreshRejectedError);

    expect(mockBindSession).not.toHaveBeenCalled();
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it('catches generic errors, logs error, and returns null', async () => {
    const genericError = new Error('Unexpected network failure');
    mockHydrationPolicy.hydrateSelectedToken.mockRejectedValueOnce(genericError);

    const result = await policy.finalizeSelectedToken({
      accountId: 'acc-1',
      tokenData: sampleTokenData,
      nowSeconds: 1700000000,
      sessionKey: 'sess-fail',
    });

    expect(result).toBeNull();
    expect(mockBindSession).not.toHaveBeenCalled();
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Failed to finalize selected account token',
      genericError,
    );
  });
});

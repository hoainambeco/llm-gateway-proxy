import type { CloudAccount } from '@/modules/cloud-account/types';
import type { AccountLeaseAccountStore } from './interfaces/account-lease-adapters';
import { AccountLeaseService } from './account-lease.service';

const MODEL = 'gemini-2.5-pro';

function makeAccount(id: string, email: string, isActive?: boolean): CloudAccount {
  return {
    id,
    provider: 'google',
    email,
    is_active: isActive,
    token: {
      access_token: `access-${id}`,
      refresh_token: `refresh-${id}`,
      expires_in: 3600,
      token_type: 'Bearer',
      expiry_timestamp: Math.floor(Date.now() / 1000) + 3600,
      project_id: 'test-project',
    },
    created_at: 1,
    last_used: 1,
    health: {},
  };
}

function makeStore(accounts: CloudAccount[]): AccountLeaseAccountStore {
  return {
    getAccounts: async () => accounts.map((account) => ({ ...account })),
    getAccount: async (id: string) => accounts.find((account) => account.id === id),
    updateToken: async () => undefined,
    updateQuota: async () => undefined,
    mutateHealth: async (_id, mutation) => mutation({}),
  };
}

function makeService(
  accounts: CloudAccount[],
  overrides: { fetchQuota?: jest.Mock; syncAccounts?: jest.Mock } = {},
) {
  const store = makeStore(accounts);
  const upstream = {
    fetchQuota: overrides.fetchQuota ?? jest.fn().mockResolvedValue({}),
    refreshAccessToken: jest.fn(),
    fetchProjectId: jest.fn(),
  };
  const imageScheduler = {
    syncAccounts: overrides.syncAccounts ?? jest.fn(),
    tryAcquire: jest.fn(),
    waitForChange: jest.fn(),
  };
  const service = new AccountLeaseService(
    store,
    upstream as any,
    undefined as any,
    undefined as any,
    imageScheduler as any,
  );
  return { service, upstream, imageScheduler };
}

describe('AccountLeaseService disabled accounts', () => {
  it('does not select a disabled token-bearing account', async () => {
    const { service } = makeService([makeAccount('acc-disabled', 'off@test.local', false)]);
    await service.loadAccounts();

    await expect(service.getNextToken({ model: MODEL })).resolves.toBeNull();
  });

  it('still selects an enabled token-bearing account', async () => {
    const { service } = makeService([makeAccount('acc-enabled', 'on@test.local', true)]);
    await service.loadAccounts();

    const selected = await service.getNextToken({ model: MODEL });
    expect(selected?.id).toBe('acc-enabled');
  });

  it('selects the enabled account when enabled and disabled accounts are mixed', async () => {
    const { service } = makeService([
      makeAccount('acc-disabled', 'off@test.local', false),
      makeAccount('acc-enabled', 'on@test.local', true),
    ]);
    await service.loadAccounts();

    const selected = await service.getNextToken({ model: MODEL });
    expect(selected?.id).toBe('acc-enabled');
  });

  it('skips disabled accounts during quota sync', async () => {
    const fetchQuota = jest.fn().mockResolvedValue({});
    const { service } = makeService(
      [
        makeAccount('acc-disabled', 'off@test.local', false),
        makeAccount('acc-enabled', 'on@test.local', true),
      ],
      { fetchQuota },
    );
    await service.loadAccounts();

    await service.syncAllAccountQuotas();

    expect(fetchQuota).toHaveBeenCalledTimes(1);
    expect(fetchQuota).toHaveBeenCalledWith('access-acc-enabled', undefined);
  });

  it('only hands enabled accounts to the image scheduler', async () => {
    const syncAccounts = jest.fn();
    const { service } = makeService(
      [
        makeAccount('acc-disabled', 'off@test.local', false),
        makeAccount('acc-enabled', 'on@test.local', true),
      ],
      { syncAccounts },
    );

    await service.loadAccounts();

    expect(syncAccounts).toHaveBeenLastCalledWith(['acc-enabled']);
  });
});

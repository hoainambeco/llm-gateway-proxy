import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { JsonAccountStore } from './json-account.store';
import type { CloudAccount } from '@/modules/cloud-account/types';

describe('JsonAccountStore', () => {
  let tempFilePath: string;
  let store: JsonAccountStore;

  const sampleAccount: CloudAccount = {
    id: 'acc-1',
    provider: 'google',
    email: 'acc1@example.com',
    token: {
      access_token: 'token-1',
      refresh_token: 'refresh-1',
      token_type: 'Bearer',
      expires_in: 3600,
      expiry_timestamp: Date.now() + 3600000,
    },
    created_at: 1000,
    last_used: 1000,
    health: { oauth: { refresh_blocked: false } },
  };

  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    tempFilePath = path.join(
      os.tmpdir(),
      `accounts-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
    );
    store = new JsonAccountStore(tempFilePath);
  });

  afterEach(async () => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    try {
      await fs.unlink(tempFilePath);
    } catch {}
  });

  it('initializes empty file and returns empty array on ENOENT', async () => {
    const accounts = await store.getAccounts();
    expect(accounts).toEqual([]);

    const fileContent = await fs.readFile(tempFilePath, 'utf-8');
    expect(JSON.parse(fileContent)).toEqual([]);
  });

  it('returns empty array when file contains non-array JSON or corrupt data', async () => {
    await fs.writeFile(tempFilePath, JSON.stringify({ not: 'an array' }), 'utf-8');
    expect(await store.getAccounts()).toEqual([]);

    await fs.writeFile(tempFilePath, 'corrupted json {{{', 'utf-8');
    expect(await store.getAccounts()).toEqual([]);
  });

  it('upserts new account and retrieves it', async () => {
    await store.upsertAccount(sampleAccount);

    const accounts = await store.getAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0].id).toBe('acc-1');

    const single = await store.getAccount('acc-1');
    expect(single?.email).toBe('acc1@example.com');

    const missing = await store.getAccount('acc-unknown');
    expect(missing).toBeUndefined();
  });

  it('merges existing account on second upsert, preserving existing fields', async () => {
    await store.upsertAccount(sampleAccount);

    const updateData = {
      ...sampleAccount,
      email: 'newemail@example.com',
      token: {
        ...sampleAccount.token,
        access_token: 'new-access-token',
      },
    };

    await store.upsertAccount(updateData);

    const single = await store.getAccount('acc-1');
    expect(single?.email).toBe('newemail@example.com');
    expect(single?.token.access_token).toBe('new-access-token');
    expect(single?.created_at).toBe(1000); // preserved
  });

  it('updates token for existing account', async () => {
    await store.upsertAccount(sampleAccount);

    await store.updateToken('acc-1', {
      access_token: 'updated-token',
      refresh_token: 'refresh-1',
      token_type: 'Bearer',
      expires_in: 7200,
      expiry_timestamp: Date.now() + 7200000,
    });

    const updated = await store.getAccount('acc-1');
    expect(updated?.token.access_token).toBe('updated-token');
    expect(updated?.token.expires_in).toBe(7200);

    // Updating token for non-existent account does nothing
    await store.updateToken('acc-nonexistent', {
      access_token: 'none',
      refresh_token: 'none',
      token_type: 'Bearer',
      expires_in: 0,
      expiry_timestamp: 0,
    });
  });

  it('updates quota for existing account', async () => {
    await store.upsertAccount(sampleAccount);

    const quota = {
      models: {
        'gemini-2.0-flash': {
          percentage: 0.9,
          resetTime: '2026-01-01T00:00:00Z',
        },
      },
    };

    await store.updateQuota('acc-1', quota);

    const updated = await store.getAccount('acc-1');
    expect(updated?.quota?.models?.['gemini-2.0-flash']?.percentage).toBe(0.9);

    // Updating quota for non-existent account does nothing
    await store.updateQuota('acc-nonexistent', quota);
  });

  it('deletes account and returns true, or false if not found', async () => {
    await store.upsertAccount(sampleAccount);

    const deleted = await store.deleteAccount('acc-1');
    expect(deleted).toBe(true);
    expect(await store.getAccounts()).toHaveLength(0);

    const secondDelete = await store.deleteAccount('acc-1');
    expect(secondDelete).toBe(false);
  });

  it('mutates health of existing account', async () => {
    await store.upsertAccount(sampleAccount);

    const newHealth = await store.mutateHealth('acc-1', (currentHealth) => ({
      ...currentHealth,
      oauth: {
        refresh_blocked: true,
        invalid_grant_count: (currentHealth?.oauth?.invalid_grant_count ?? 0) + 1,
      },
    }));

    expect(newHealth?.oauth?.refresh_blocked).toBe(true);
    expect(newHealth?.oauth?.invalid_grant_count).toBe(1);

    const account = await store.getAccount('acc-1');
    expect(account?.health?.oauth?.refresh_blocked).toBe(true);

    // Mutating non-existent account returns undefined
    const missingHealth = await store.mutateHealth('acc-missing', (h) => h);
    expect(missingHealth).toBeUndefined();
  });
});

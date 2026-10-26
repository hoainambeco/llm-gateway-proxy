import { CloudAccountHealthService, evictAccountFromActiveLeaseCache, syncAccountOAuthHealthToActiveLeaseCache } from './CloudAccountHealthService';
import { jsonAccountStoreInstance } from '@/modules/proxy-gateway/server/modules/account-lease/adapters/json-account.store';
import type { CloudAccount, CloudAccountHealth } from '@/modules/cloud-account/types';

jest.mock('@/server/main', () => ({
  evictNestServerAccountLeaseAccount: jest.fn(),
  updateNestServerAccountLeaseOAuthHealth: jest.fn(),
}));

describe('CloudAccountHealthService', () => {
  const sampleValidationHealth: CloudAccountHealth = {
    validation: {
      status: 'requires_action',
      reason: 'VALIDATION_REQUIRED',
      detected_at_ms: 1000,
      next_probe_at_ms: 2000,
      verification_url: 'https://example.com/verify',
    },
  };

  const sampleOAuthHealth: CloudAccountHealth = {
    oauth: {
      refresh_blocked: true,
      reason: 'invalid_grant',
      invalid_grant_count: 3,
    },
  };

  beforeEach(() => {
    CloudAccountHealthService.resetStateForTesting();
    jest.clearAllMocks();
  });

  describe('getHealth', () => {
    it('returns undefined if account has no health', async () => {
      jest.spyOn(jsonAccountStoreInstance, 'getAccount').mockResolvedValueOnce({
        id: 'acc-1',
        email: 'test@example.com',
      } as CloudAccount);

      const health = await CloudAccountHealthService.getHealth('acc-1');
      expect(health).toBeUndefined();
    });

    it('returns health object if present on account', async () => {
      jest.spyOn(jsonAccountStoreInstance, 'getAccount').mockResolvedValueOnce({
        id: 'acc-2',
        health: sampleValidationHealth,
      } as CloudAccount);

      const health = await CloudAccountHealthService.getHealth('acc-2');
      expect(health).toEqual(sampleValidationHealth);
    });
  });

  describe('mutateHealth', () => {
    it('throws when updating health for a non-existent account', async () => {
      jest.spyOn(jsonAccountStoreInstance, 'getAccount').mockResolvedValueOnce(undefined);

      await expect(
        CloudAccountHealthService.mutateHealth('missing-acc', () => undefined),
      ).rejects.toThrow('Cannot update health for missing account missing-acc');
    });

    it('mutates health and normalizes empty health to undefined', async () => {
      let currentHealth: CloudAccountHealth | undefined = sampleValidationHealth;
      jest.spyOn(jsonAccountStoreInstance, 'getAccount').mockImplementation(async () => ({
        id: 'acc-1',
        health: currentHealth,
      } as CloudAccount));
      jest.spyOn(jsonAccountStoreInstance, 'mutateHealth').mockImplementation(async (_id, mutator) => {
        currentHealth = mutator(currentHealth);
        return currentHealth;
      });

      // Mutate to new valid health
      const updated = await CloudAccountHealthService.mutateHealth('acc-1', () => sampleOAuthHealth);
      expect(updated).toEqual(sampleOAuthHealth);

      // Mutate to empty health -> normalizes to undefined
      const cleared = await CloudAccountHealthService.mutateHealth('acc-1', () => ({} as any));
      expect(cleared).toBeUndefined();
    });

    it('runs afterCommit callback and rolls back when rollbackOnAfterCommitFailure is true', async () => {
      const initialHealth: CloudAccountHealth = sampleValidationHealth;
      let currentHealth: CloudAccountHealth | undefined = initialHealth;

      jest.spyOn(jsonAccountStoreInstance, 'getAccount').mockImplementation(async () => ({
        id: 'acc-1',
        health: currentHealth,
      } as CloudAccount));
      const mutateSpy = jest.spyOn(jsonAccountStoreInstance, 'mutateHealth').mockImplementation(async (_id, mutator) => {
        currentHealth = mutator(currentHealth);
        return currentHealth;
      });

      await expect(
        CloudAccountHealthService.mutateHealth(
          'acc-1',
          () => sampleOAuthHealth,
          {
            afterCommit: async () => {
              throw new Error('afterCommit exploded');
            },
            rollbackOnAfterCommitFailure: true,
          },
        ),
      ).rejects.toThrow('afterCommit exploded');

      // mutateHealth called twice: once with next health, once with rollback
      expect(mutateSpy).toHaveBeenCalledTimes(2);
      expect(currentHealth).toEqual(initialHealth);
    });

    it('does not roll back when rollbackOnAfterCommitFailure is falsy', async () => {
      const initialHealth: CloudAccountHealth = sampleValidationHealth;
      let currentHealth: CloudAccountHealth | undefined = initialHealth;

      jest.spyOn(jsonAccountStoreInstance, 'getAccount').mockImplementation(async () => ({
        id: 'acc-1',
        health: currentHealth,
      } as CloudAccount));
      const mutateSpy = jest.spyOn(jsonAccountStoreInstance, 'mutateHealth').mockImplementation(async (_id, mutator) => {
        currentHealth = mutator(currentHealth);
        return currentHealth;
      });

      await expect(
        CloudAccountHealthService.mutateHealth(
          'acc-1',
          () => sampleOAuthHealth,
          {
            afterCommit: async () => {
              throw new Error('afterCommit exploded');
            },
          },
        ),
      ).rejects.toThrow('afterCommit exploded');

      expect(mutateSpy).toHaveBeenCalledTimes(1);
      expect(currentHealth).toEqual(sampleOAuthHealth);
    });

    it('queues and serializes concurrent mutations on the same account', async () => {
      const callOrder: string[] = [];
      let currentHealth: CloudAccountHealth | undefined;

      jest.spyOn(jsonAccountStoreInstance, 'getAccount').mockImplementation(async () => ({
        id: 'acc-concurrent',
        health: currentHealth,
      } as CloudAccount));
      jest.spyOn(jsonAccountStoreInstance, 'mutateHealth').mockImplementation(async (_id, mutator) => {
        currentHealth = mutator(currentHealth);
        return currentHealth;
      });

      const p1 = CloudAccountHealthService.mutateHealth('acc-concurrent', () => {
        callOrder.push('first');
        return sampleValidationHealth;
      });

      const p2 = CloudAccountHealthService.mutateHealth('acc-concurrent', () => {
        callOrder.push('second');
        return sampleOAuthHealth;
      });

      const [res1, res2] = await Promise.all([p1, p2]);
      expect(callOrder).toEqual(['first', 'second']);
      expect(res1).toEqual(sampleValidationHealth);
      expect(res2).toEqual(sampleOAuthHealth);
    });
  });

  describe('evictAccountFromActiveLeaseCache & syncAccountOAuthHealthToActiveLeaseCache', () => {
    it('calls evictNestServerAccountLeaseAccount on the server main module', async () => {
      const { evictNestServerAccountLeaseAccount } = await import('@/server/main');
      await evictAccountFromActiveLeaseCache('acc-evict');
      expect(evictNestServerAccountLeaseAccount).toHaveBeenCalledWith('acc-evict');
    });

    it('calls updateNestServerAccountLeaseOAuthHealth on the server main module', async () => {
      const { updateNestServerAccountLeaseOAuthHealth } = await import('@/server/main');
      const oauth = { refresh_blocked: true, reason: 'invalid_grant' as const };
      await syncAccountOAuthHealthToActiveLeaseCache('acc-sync', oauth);
      expect(updateNestServerAccountLeaseOAuthHealth).toHaveBeenCalledWith('acc-sync', oauth);
    });
  });
});

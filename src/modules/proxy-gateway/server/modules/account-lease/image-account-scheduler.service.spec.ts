import { ImageAccountSchedulerService, ImageAccountPermit } from './image-account-scheduler.service';
import { setServerConfig } from '@/server/server-config';
import type { ProxyConfig } from '@/modules/config/types';

describe('ImageAccountSchedulerService', () => {
  beforeEach(() => {
    jest.useRealTimers();
    setServerConfig({
      image_scheduler: {
        per_account_concurrency: 2,
      },
    } as unknown as ProxyConfig);
  });

  it('uses default concurrency of 4 when server config is missing or invalid', () => {
    setServerConfig(null as unknown as ProxyConfig);
    const service = new ImageAccountSchedulerService();
    service.syncAccounts(['acc-1']);
    expect(service.getAvailableSlots()).toBe(4);

    setServerConfig({
      image_scheduler: { per_account_concurrency: -5 },
    } as unknown as ProxyConfig);
    const serviceNegative = new ImageAccountSchedulerService();
    serviceNegative.syncAccounts(['acc-1']);
    expect(serviceNegative.getAvailableSlots()).toBe(4);
  });

  describe('permit acquisition and release', () => {
    it('acquires permit up to concurrency limit, then returns null', () => {
      const service = new ImageAccountSchedulerService();
      service.syncAccounts(['acc-1']);

      const permit1 = service.tryAcquire('acc-1');
      expect(permit1).toBeInstanceOf(ImageAccountPermit);
      expect(permit1?.accountId).toBe('acc-1');
      expect(service.getInUseFor('acc-1')).toBe(1);
      expect(service.getAvailableSlots()).toBe(1); // 2 - 1 = 1

      const permit2 = service.tryAcquire('acc-1');
      expect(permit2).not.toBeNull();
      expect(service.getInUseFor('acc-1')).toBe(2);
      expect(service.getAvailableSlots()).toBe(0);

      const permit3 = service.tryAcquire('acc-1');
      expect(permit3).toBeNull();

      // Release first permit
      permit1?.release();
      expect(service.getInUseFor('acc-1')).toBe(1);
      expect(service.getAvailableSlots()).toBe(1);

      // Releasing same permit again is idempotent
      permit1?.release();
      expect(service.getInUseFor('acc-1')).toBe(1);

      permit2?.release();
      expect(service.getInUseFor('acc-1')).toBe(0);
      expect(service.getAvailableSlots()).toBe(2);
    });

    it('returns null for unknown or disabled account', () => {
      const service = new ImageAccountSchedulerService();
      expect(service.tryAcquire('unknown-account')).toBeNull();
      expect(service.getInUseFor('unknown-account')).toBe(0);
    });
  });

  describe('syncAccounts', () => {
    it('adds new accounts, disables removed accounts, and prunes unused disabled accounts', () => {
      const service = new ImageAccountSchedulerService();
      service.syncAccounts(['acc-1', 'acc-2']);

      expect(service.getAvailableSlots()).toBe(4); // 2 + 2

      // Acquire permit on acc-2
      const permit = service.tryAcquire('acc-2');
      expect(service.getInUseFor('acc-2')).toBe(1);

      // Sync without acc-1 and acc-2:
      // acc-1 is unused so it gets deleted immediately.
      // acc-2 is inUse so it stays disabled until permit is released.
      service.syncAccounts([]);
      expect(service.getInUseFor('acc-1')).toBe(0);
      expect(service.getInUseFor('acc-2')).toBe(1);
      expect(service.getAvailableSlots()).toBe(0); // neither is enabled

      // Release acc-2 permit -> pruned
      permit?.release();
      expect(service.getInUseFor('acc-2')).toBe(0);
    });

    it('re-enables previously disabled accounts on sync', () => {
      const service = new ImageAccountSchedulerService();
      service.syncAccounts(['acc-1']);
      const permit = service.tryAcquire('acc-1');

      service.syncAccounts([]); // disabled but retained because inUse = 1
      expect(service.tryAcquire('acc-1')).toBeNull();

      service.syncAccounts(['acc-1']); // re-enabled
      expect(service.getInUseFor('acc-1')).toBe(1);
      expect(service.getAvailableSlots()).toBe(1);

      permit?.release();
    });
  });

  describe('waitForChange', () => {
    it('resolves immediately with elapsed if remainingMs <= 0', async () => {
      const service = new ImageAccountSchedulerService();
      const res = await service.waitForChange(0);
      expect(res).toBe('elapsed');
    });

    it('resolves immediately with aborted if signal is already aborted', async () => {
      const service = new ImageAccountSchedulerService();
      const controller = new AbortController();
      controller.abort();

      const res = await service.waitForChange(1000, controller.signal);
      expect(res).toBe('aborted');
    });

    it('resolves with changed when a permit is released while waiting', async () => {
      const service = new ImageAccountSchedulerService();
      service.syncAccounts(['acc-1']);
      const permit = service.tryAcquire('acc-1');

      const waitPromise = service.waitForChange(1000);
      permit?.release();

      const res = await waitPromise;
      expect(res).toBe('changed');
    });

    it('resolves with changed when syncAccounts alters account states', async () => {
      const service = new ImageAccountSchedulerService();
      const waitPromise = service.waitForChange(1000);

      service.syncAccounts(['acc-new']);

      const res = await waitPromise;
      expect(res).toBe('changed');
    });

    it('resolves with aborted when signal aborts during wait', async () => {
      const service = new ImageAccountSchedulerService();
      const controller = new AbortController();

      const waitPromise = service.waitForChange(1000, controller.signal);
      controller.abort();

      const res = await waitPromise;
      expect(res).toBe('aborted');
    });

    it('resolves with elapsed when timer expires', async () => {
      const service = new ImageAccountSchedulerService();
      const res = await service.waitForChange(50); // 50ms wait
      expect(res).toBe('elapsed');
    });
  });
});

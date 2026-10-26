import {
  ModelAvailabilityService,
  ProxyModelAvailabilityPersistence,
  ProxyModelAvailability,
} from './model-availability.service';

describe('ModelAvailabilityService', () => {
  let mockPersistence: jest.Mocked<ProxyModelAvailabilityPersistence>;
  let persistedData: unknown;

  beforeEach(() => {
    persistedData = [];
    mockPersistence = {
      load: jest.fn(() => persistedData),
      save: jest.fn((entries: ProxyModelAvailability[]) => {
        persistedData = entries;
      }),
    };
  });

  describe('in-memory operation (no persistence adapter)', () => {
    it('handles mark, snapshot, and active snapshot without persistence', () => {
      const service = new ModelAvailabilityService();
      const now = Date.now();

      service.mark('acc-1', 'models/gemini-2.0-flash', 'rate_limited', now + 60000, {
        status: 429,
        message: 'Rate limit exceeded',
        detectedAt: now,
      });

      const snapshot = service.getSnapshot();
      expect(snapshot).toHaveLength(1);
      expect(snapshot[0].accountId).toBe('acc-1');
      expect(snapshot[0].modelId).toBe('gemini-2.0-flash');
      expect(snapshot[0].reason).toBe('rate_limited');
      expect(snapshot[0].status).toBe(429);
      expect(snapshot[0].message).toBe('Rate limit exceeded');

      const active = service.getActiveSnapshot(now);
      expect(active).toHaveLength(1);

      const pastActive = service.getActiveSnapshot(now + 120000);
      expect(pastActive).toHaveLength(0);
    });

    it('ignores mark when accountId or modelId is empty', () => {
      const service = new ModelAvailabilityService();
      service.mark('', 'gemini-1.5-pro', 'rate_limited');
      service.mark('acc-1', '', 'rate_limited');

      expect(service.getSnapshot()).toHaveLength(0);
    });

    it('applies default timeouts for model_not_supported and model_forbidden (20 min)', () => {
      const service = new ModelAvailabilityService();
      const before = Date.now();
      service.mark('acc-1', 'gemini-exp', 'model_not_supported');
      const snap = service.getSnapshot();
      expect(snap).toHaveLength(1);
      // 20 min = 1,200,000 ms
      expect(snap[0].unavailableUntil).toBeGreaterThanOrEqual(before + 20 * 60 * 1000 - 100);
    });

    it('applies default timeouts for quota_exhausted and rate_limited (5 min)', () => {
      const service = new ModelAvailabilityService();
      const before = Date.now();
      service.mark('acc-1', 'gemini-1.5-pro', 'quota_exhausted');
      const snap = service.getSnapshot();
      expect(snap).toHaveLength(1);
      // 5 min = 300,000 ms
      expect(snap[0].unavailableUntil).toBeGreaterThanOrEqual(before + 5 * 60 * 1000 - 100);
      expect(snap[0].unavailableUntil).toBeLessThan(before + 6 * 60 * 1000);
    });

    it('truncates message exceeding MAX_MESSAGE_LENGTH', () => {
      const service = new ModelAvailabilityService();
      const longMessage = 'A'.repeat(600);
      service.mark('acc-1', 'gemini-1.5-pro', 'rate_limited', undefined, {
        message: longMessage,
      });

      const snap = service.getSnapshot();
      expect(snap[0].message).toHaveLength(500);
    });
  });

  describe('clearing entries', () => {
    let service: ModelAvailabilityService;

    beforeEach(() => {
      service = new ModelAvailabilityService(mockPersistence);
    });

    it('clearAccount deletes all entries for account and triggers persist', () => {
      service.mark('acc-1', 'gemini-1.5-pro', 'rate_limited');
      service.mark('acc-1', 'gemini-1.5-flash', 'quota_exhausted');
      service.mark('acc-2', 'gemini-1.5-pro', 'rate_limited');

      service.clearAccount('acc-1');

      const snap = service.getSnapshot();
      expect(snap).toHaveLength(1);
      expect(snap[0].accountId).toBe('acc-2');
      expect(mockPersistence.save).toHaveBeenCalled();
    });

    it('clearModel deletes specific model for account and returns true if changed', () => {
      service.mark('acc-1', 'models/gemini-1.5-pro', 'rate_limited');

      expect(service.clearModel('', 'gemini-1.5-pro')).toBe(false);
      expect(service.clearModel('acc-1', '')).toBe(false);

      const removed = service.clearModel('acc-1', 'gemini-1.5-pro');
      expect(removed).toBe(true);
      expect(service.getSnapshot()).toHaveLength(0);

      const secondAttempt = service.clearModel('acc-1', 'gemini-1.5-pro');
      expect(secondAttempt).toBe(false);
    });

    it('clearModelFamily clears all models in the same quota family', () => {
      service.mark('acc-1', 'gemini-1.5-pro', 'rate_limited');
      service.mark('acc-1', 'gemini-1.5-pro-preview', 'quota_exhausted');
      service.mark('acc-1', 'gemini-2.0-flash', 'rate_limited');

      expect(service.clearModelFamily('', 'gemini-1.5-pro')).toBe(0);
      expect(service.clearModelFamily('acc-1', '')).toBe(0);

      const deletedCount = service.clearModelFamily('acc-1', 'gemini-1.5-pro');
      expect(deletedCount).toBeGreaterThanOrEqual(1);

      const remaining = service.getSnapshot();
      expect(remaining.some((e) => e.modelId === 'gemini-2.0-flash')).toBe(true);
    });

    it('clearCapabilityFailures clears image models with not_supported or forbidden reasons', () => {
      service.mark('acc-1', 'imagen-3.0-generate-002', 'model_not_supported');
      service.mark('acc-1', 'gemini-1.5-pro-image', 'model_forbidden');
      service.mark('acc-1', 'gemini-image-preview', 'rate_limited'); // rate_limited should not be cleared
      service.mark('acc-1', 'gemini-1.5-pro', 'model_not_supported'); // non-image should not be cleared
      service.mark('acc-2', 'imagen-3.0-generate-002', 'model_not_supported'); // different account

      service.clearCapabilityFailures('acc-1');

      const snap = service.getSnapshot();
      expect(snap.find((e) => e.accountId === 'acc-1' && e.modelId === 'imagen-3.0-generate-002')).toBeUndefined();
      expect(snap.find((e) => e.accountId === 'acc-1' && e.modelId === 'gemini-1.5-pro-image')).toBeUndefined();
      expect(snap.find((e) => e.accountId === 'acc-1' && e.modelId === 'gemini-image-preview')).toBeDefined();
      expect(snap.find((e) => e.accountId === 'acc-1' && e.modelId === 'gemini-1.5-pro')).toBeDefined();
      expect(snap.find((e) => e.accountId === 'acc-2' && e.modelId === 'imagen-3.0-generate-002')).toBeDefined();
    });
  });

  describe('snapshot cleanup & retention logic', () => {
    it('evicts entries where unavailableUntil has passed AND detectedAt is older than 10 mins', () => {
      const service = new ModelAvailabilityService(mockPersistence);
      const oldTime = Date.now() - 15 * 60 * 1000;

      service.mark('acc-1', 'gemini-expired', 'rate_limited', oldTime + 1000, {
        detectedAt: oldTime,
      });

      // Both unavailableUntil (oldTime + 1s) and detectedAt (15m ago) are in the past
      const snap = service.getSnapshot();
      expect(snap).toHaveLength(0);
      expect(mockPersistence.save).toHaveBeenCalled();
    });

    it('retains entries if detectedAt is within 10 mins even if unavailableUntil passed', () => {
      const service = new ModelAvailabilityService();
      const now = Date.now();

      service.mark('acc-1', 'gemini-recent', 'rate_limited', now - 1000, {
        detectedAt: now - 5 * 60 * 1000, // 5 min ago
      });

      const snap = service.getSnapshot();
      expect(snap).toHaveLength(1);
      expect(snap[0].modelId).toBe('gemini-recent');
    });
  });

  describe('hydration and persistence resilience', () => {
    it('loads valid entries from persistence on first call', () => {
      const now = Date.now();
      persistedData = [
        {
          accountId: 'acc-hydrated',
          modelId: 'gemini-2.0-flash',
          reason: 'rate_limited',
          unavailableUntil: now + 50000,
          status: 429,
          detectedAt: now,
          message: 'Hydrated reason',
        },
      ];

      const service = new ModelAvailabilityService(mockPersistence);
      const snap = service.getSnapshot();

      expect(snap).toHaveLength(1);
      expect(snap[0].accountId).toBe('acc-hydrated');
      expect(snap[0].modelId).toBe('gemini-2.0-flash');
    });

    it('ignores invalid schema data during hydration without crashing', () => {
      persistedData = { notAnArray: true };

      const service = new ModelAvailabilityService(mockPersistence);
      expect(service.getSnapshot()).toEqual([]);
    });

    it('persists remaining entries if some hydrated entries were evicted', () => {
      const oldTime = Date.now() - 20 * 60 * 1000;
      persistedData = [
        {
          accountId: 'acc-expired',
          modelId: 'gemini-expired',
          reason: 'rate_limited',
          unavailableUntil: oldTime,
          detectedAt: oldTime,
        },
      ];

      const service = new ModelAvailabilityService(mockPersistence);
      service.getSnapshot();
      // Notice save called because entries.size (0) !== parsed.data.length (1)
      expect(mockPersistence.save).toHaveBeenCalledWith([]);
    });

    it('handles persistence.load throwing an error gracefully', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        mockPersistence.load.mockImplementationOnce(() => {
          throw new Error('Disk read error');
        });

        const service = new ModelAvailabilityService(mockPersistence);
        expect(() => service.getSnapshot()).not.toThrow();
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('handles persistence.save throwing an error gracefully', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        mockPersistence.save.mockImplementationOnce(() => {
          throw new Error('Disk write error');
        });

        const service = new ModelAvailabilityService(mockPersistence);
        expect(() => service.mark('acc-1', 'gemini-pro', 'rate_limited')).not.toThrow();
      } finally {
        warnSpy.mockRestore();
      }
    });
  });
});

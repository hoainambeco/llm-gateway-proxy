import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  ModelRouteMissJournalService,
  defaultModelRouteMissJournalOptions,
} from './model-route-miss-journal.service';

describe('ModelRouteMissJournalService', () => {
  let service: ModelRouteMissJournalService;

  beforeEach(() => {
    service = new ModelRouteMissJournalService({
      filePath: undefined, // in-memory
      maxEntries: 10,
      ttlMs: 60000,
    });
  });

  describe('defaultModelRouteMissJournalOptions', () => {
    it('returns options with test environment defaults', () => {
      const opts = defaultModelRouteMissJournalOptions();
      expect(opts.maxEntries).toBeGreaterThan(0);
      expect(opts.ttlMs).toBeGreaterThan(0);
    });
  });

  describe('record and snapshot', () => {
    it('normalizes models/ prefix and records count', () => {
      service.record('models/Gemini-Unsupported-X');
      service.record('gemini-unsupported-x');

      const snapshot = service.getSnapshot();
      expect(snapshot).toHaveLength(1);
      expect(snapshot[0].model).toBe('gemini-unsupported-x');
      expect(snapshot[0].count).toBe(2);
      expect(snapshot[0].lastSeen).toBeGreaterThan(0);
    });

    it('ignores empty model names', () => {
      service.record('');
      service.record('   ');
      service.record('models/');
      expect(service.getSnapshot()).toHaveLength(0);
    });

    it('sorts snapshot by lastSeen descending', async () => {
      service.record('model-first');
      await new Promise((r) => setTimeout(r, 10));
      service.record('model-second');

      const snapshot = service.getSnapshot();
      expect(snapshot).toHaveLength(2);
      expect(snapshot[0].model).toBe('model-second');
      expect(snapshot[1].model).toBe('model-first');
    });

    it('clears all recorded entries', () => {
      service.record('model-a');
      service.record('model-b');
      expect(service.getSnapshot()).toHaveLength(2);

      service.clear();
      expect(service.getSnapshot()).toHaveLength(0);
    });

    it('flushes pending records without error', async () => {
      service.record('model-flushed');
      await expect(service.flush()).resolves.toBeUndefined();
    });
  });

  describe('revival of persisted entries', () => {
    it('revives valid entry and rejects invalid entries from disk', async () => {
      const tempPath = path.join(os.tmpdir(), `test-journal-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
      try {
        const fileService = new ModelRouteMissJournalService({
          filePath: tempPath,
          maxEntries: 10,
          ttlMs: 60000,
        });

        fileService.record('persisted-model');
        await fileService.flush();

        // Load into a new service instance reading the file
        const reloadedService = new ModelRouteMissJournalService({
          filePath: tempPath,
          maxEntries: 10,
          ttlMs: 60000,
        });

        const snapshot = reloadedService.getSnapshot();
        expect(snapshot).toHaveLength(1);
        expect(snapshot[0].model).toBe('persisted-model');

        // Test corrupted entries in file to hit revival failure branches
        const now = Date.now();
        fs.writeFileSync(
          tempPath,
          JSON.stringify({
            version: 1,
            entries: [
              null,
              'not-an-object',
              { key: 'bad-1' }, // missing updatedAt and value
              { key: 'bad-2', updatedAt: now, value: null },
              { key: 'bad-3', updatedAt: now, value: 'not-an-object' },
              { key: 'bad-4', updatedAt: now, value: [] },
              { key: 'bad-5', updatedAt: now, value: { model: 123 } }, // invalid model type
              { key: 'bad-6', updatedAt: now, value: { model: '' } }, // empty model
              { key: 'bad-7', updatedAt: now, value: { model: 'valid-model', count: 0 } }, // invalid count < 1
              { key: 'bad-8', updatedAt: now, value: { model: 'valid-model', count: 'two' } }, // invalid count type
              { key: 'bad-9', updatedAt: now, value: { model: 'valid-model', count: 1, lastSeen: 'now' } }, // invalid lastSeen
              { key: 'bad-10', updatedAt: now, value: { model: 'valid-model', count: 1, lastSeen: Infinity } }, // non-finite
              {
                key: 'restored-model',
                updatedAt: now,
                value: { model: 'restored-model', count: 3, lastSeen: now },
              }, // valid!
            ],
          }),
          'utf-8',
        );

        const corruptedReload = new ModelRouteMissJournalService({
          filePath: tempPath,
          maxEntries: 10,
          ttlMs: 60000,
        });

        const restoredSnap = corruptedReload.getSnapshot();
        expect(restoredSnap).toHaveLength(1);
        expect(restoredSnap[0].model).toBe('restored-model');
      } finally {
        try {
          if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        } catch {}
      }
    });
  });
});

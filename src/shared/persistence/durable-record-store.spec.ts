import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DurableRecordStore } from './durable-record-store';

describe('DurableRecordStore', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'durable-store-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('in-memory operation (no filePath)', () => {
    it('sets, gets, and deletes records', () => {
      const store = new DurableRecordStore<string>({
        maxEntries: 10,
        ttlMs: 60000,
      });

      expect(store.get('key1')).toBeNull();
      store.set('key1', 'val1');
      expect(store.get('key1')).toBe('val1');
      expect(store.size).toBe(1);

      expect(store.delete('key1')).toBe(true);
      expect(store.delete('key1')).toBe(false);
      expect(store.get('key1')).toBeNull();
      expect(store.size).toBe(0);
    });

    it('expires records past ttlMs', () => {
      const store = new DurableRecordStore<string>({
        maxEntries: 10,
        ttlMs: 5000,
      });

      const now = 10000;
      store.set('key1', 'val1', now);

      // get updates updatedAt to now + 2000 = 12000
      expect(store.get('key1', now + 2000)).toBe('val1');

      // Still alive at 16000
      expect(store.get('key1', 16000)).toBe('val1');

      // Expired after 16000 + 5000 = 21000 (at 21001)
      expect(store.get('key1', 21001)).toBeNull();
      expect(store.size).toBe(0);
    });

    it('evicts oldest entries when maxEntries is exceeded', () => {
      const store = new DurableRecordStore<string>({
        maxEntries: 2,
        ttlMs: 60000,
      });

      store.set('k1', 'v1');
      store.set('k2', 'v2');
      store.set('k3', 'v3');

      expect(store.size).toBe(2);
      expect(store.get('k1')).toBeNull();
      expect(store.get('k2')).toBe('v2');
      expect(store.get('k3')).toBe('v3');
    });

    it('updates position on get to refresh least-recently-written status', () => {
      const originalNow = Date.now;
      let currentTime = 1000;
      Date.now = () => currentTime;

      try {
        const store = new DurableRecordStore<string>({
          maxEntries: 2,
          ttlMs: 60000,
        });

        store.set('k1', 'v1'); // at 1000
        currentTime = 2000;
        store.set('k2', 'v2'); // at 2000

        // Access k1 so it moves to newest position
        currentTime = 3000;
        expect(store.get('k1')).toBe('v1');

        // Now adding k3 at 4000 should evict oldest k2, not k1
        currentTime = 4000;
        store.set('k3', 'v3');
        expect(store.get('k2')).toBeNull();
        expect(store.get('k1')).toBe('v1');
        expect(store.get('k3')).toBe('v3');
      } finally {
        Date.now = originalNow;
      }
    });

    it('clears all records', () => {
      const store = new DurableRecordStore<string>({
        maxEntries: 10,
        ttlMs: 60000,
      });

      store.set('a', '1');
      store.set('b', '2');
      store.clear();
      expect(store.size).toBe(0);
      expect(store.entries()).toEqual([]);
    });

    it('returns live non-expired entries', () => {
      const store = new DurableRecordStore<string>({
        maxEntries: 10,
        ttlMs: 5000,
      });

      store.set('fresh', 'val', 10000);
      store.set('old', 'val', 1000);

      const entries = store.entries(12000);
      expect(entries).toHaveLength(1);
      expect(entries[0].key).toBe('fresh');
    });
  });

  describe('file-backed persistence', () => {
    it('persists data to disk and rehydrates on a new store instance', async () => {
      const filePath = path.join(tempDir, 'records.json');

      const store1 = new DurableRecordStore<{ count: number }>({
        filePath,
        maxEntries: 10,
        ttlMs: 60000,
      });

      store1.set('metric1', { count: 42 });
      await store1.flush();

      expect(fs.existsSync(filePath)).toBe(true);

      const store2 = new DurableRecordStore<{ count: number }>({
        filePath,
        maxEntries: 10,
        ttlMs: 60000,
      });

      expect(store2.get('metric1')).toEqual({ count: 42 });
      expect(store2.size).toBe(1);
    });

    it('revives and filters entries with custom revive validator', async () => {
      const filePath = path.join(tempDir, 'revive.json');

      fs.writeFileSync(
        filePath,
        JSON.stringify({
          version: 1,
          entries: [
            { key: 'valid', updatedAt: Date.now(), value: { id: 1, name: 'Alice' } },
            { key: 'invalid', updatedAt: Date.now(), value: { id: 'not-a-number' } },
          ],
        }),
      );

      const store = new DurableRecordStore<{ id: number; name: string }>({
        filePath,
        maxEntries: 10,
        ttlMs: 60000,
        revive: (val: any) => {
          if (typeof val === 'object' && val !== null && typeof val.id === 'number') {
            return val;
          }
          return null;
        },
      });

      expect(store.get('valid')).toEqual({ id: 1, name: 'Alice' });
      expect(store.get('invalid')).toBeNull();
      expect(store.size).toBe(1);
    });

    it('tolerates corrupt or wrong-version file envelopes gracefully', async () => {
      const filePath = path.join(tempDir, 'corrupt.json');
      fs.writeFileSync(filePath, JSON.stringify({ version: 99, entries: [] }));

      const store = new DurableRecordStore<string>({
        filePath,
        maxEntries: 10,
        ttlMs: 60000,
      });

      expect(store.size).toBe(0);
      expect(store.get('any')).toBeNull();
    });

    it('handles write failure gracefully without throwing', async () => {
      // Point file to an uncreatable path (inside an existing non-directory file)
      const blocker = path.join(tempDir, 'blocker');
      fs.writeFileSync(blocker, 'not a dir');
      const badFilePath = path.join(blocker, 'child.json');

      const store = new DurableRecordStore<string>({
        filePath: badFilePath,
        maxEntries: 10,
        ttlMs: 60000,
      });

      store.set('k', 'v');
      // flush should not throw unhandled exception
      await expect(store.flush()).resolves.toBeUndefined();
    });
  });
});

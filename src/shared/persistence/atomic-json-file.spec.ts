import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  readJsonFileSync,
  writeFileAtomic,
  writeFileAtomicSync,
  writeJsonFileAtomic,
} from './atomic-json-file';

describe('atomic-json-file (real filesystem, temp directory)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-json-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('writeJsonFileAtomic / readJsonFileSync round trip', () => {
    it('writes an object and reads it back intact', async () => {
      const filePath = path.join(tempDir, 'state.json');
      const value = {
        accounts: ['a', 'b'],
        meta: { version: 2, nested: { enabled: true } },
      };

      await writeJsonFileAtomic(filePath, value);

      expect(readJsonFileSync(filePath)).toEqual(value);
      // A `.tmp` sibling never survives a successful write.
      expect(fs.readdirSync(tempDir)).toEqual(['state.json']);
    });

    it('overwrites an existing file with new content', async () => {
      const filePath = path.join(tempDir, 'state.json');

      await writeJsonFileAtomic(filePath, { version: 1 });
      await writeJsonFileAtomic(filePath, { version: 2, extra: 'data' });

      expect(readJsonFileSync(filePath)).toEqual({ version: 2, extra: 'data' });
    });

    it('throws on a non-serializable value instead of leaving a half-written file', async () => {
      const filePath = path.join(tempDir, 'circular.json');

      await expect(
        writeJsonFileAtomic(filePath, { toJSON: () => undefined } as unknown as object),
      ).rejects.toThrow(TypeError);
      expect(fs.existsSync(filePath)).toBe(false);
    });
  });

  describe('readJsonFileSync fallbacks', () => {
    it('returns null for a missing file instead of throwing', () => {
      expect(readJsonFileSync(path.join(tempDir, 'does-not-exist.json'))).toBeNull();
    });

    it('returns null for a corrupted JSON file instead of throwing', () => {
      const filePath = path.join(tempDir, 'corrupt.json');
      fs.writeFileSync(filePath, '{ "half": "truncated', 'utf-8');

      expect(readJsonFileSync(filePath)).toBeNull();
    });

    it('returns null for a directory path instead of throwing', () => {
      expect(readJsonFileSync(tempDir)).toBeNull();
    });
  });

  describe('plain content writers', () => {
    it('writes plaintext via writeFileAtomic', async () => {
      const filePath = path.join(tempDir, 'plain.txt');

      await writeFileAtomic(filePath, 'hello atomic world');

      expect(fs.readFileSync(filePath, 'utf-8')).toBe('hello atomic world');
      expect(fs.readdirSync(tempDir)).toEqual(['plain.txt']);
    });

    it('writes binary content via writeFileAtomic', async () => {
      const filePath = path.join(tempDir, 'blob.bin');
      const payload = Buffer.from([0, 1, 2, 254, 255]);

      await writeFileAtomic(filePath, payload);

      expect(fs.readFileSync(filePath)).toEqual(payload);
    });

    it('writes plaintext via writeFileAtomicSync', () => {
      const filePath = path.join(tempDir, 'sync.txt');

      writeFileAtomicSync(filePath, 'sync content');

      expect(fs.readFileSync(filePath, 'utf-8')).toBe('sync content');
      expect(fs.readdirSync(tempDir)).toEqual(['sync.txt']);
    });

    it('creates missing parent directories', async () => {
      const filePath = path.join(tempDir, 'nested', 'deep', 'file.json');

      await writeJsonFileAtomic(filePath, { ok: true });

      expect(readJsonFileSync(filePath)).toEqual({ ok: true });
    });

    it('cleans up temporary file and closes descriptor when writeFileAtomicSync encounters an error', () => {
      const filePath = path.join(tempDir, 'fail-sync.txt');
      const fsyncSpy = jest.spyOn(fs, 'fsyncSync').mockImplementationOnce(() => {
        throw new Error('Simulated fsync failure');
      });

      expect(() => writeFileAtomicSync(filePath, 'sync fail')).toThrow('Simulated fsync failure');
      fsyncSpy.mockRestore();

      // No temp files or target files left behind
      expect(fs.readdirSync(tempDir)).toEqual([]);
    });

    it('cleans up temporary file when renameSync throws in writeFileAtomicSync', () => {
      const filePath = path.join(tempDir, 'fail-rename.txt');
      const renameSpy = jest.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
        throw new Error('Simulated rename failure');
      });

      expect(() => writeFileAtomicSync(filePath, 'rename fail')).toThrow('Simulated rename failure');
      renameSpy.mockRestore();

      expect(fs.readdirSync(tempDir)).toEqual([]);
    });

    it('cleans up temporary file when writeFileAtomic encounters an error', async () => {
      const filePath = path.join(tempDir, 'fail-async.txt');
      const renameSpy = jest.spyOn(fs.promises, 'rename').mockImplementationOnce(() => {
        return Promise.reject(new Error('Simulated async rename failure'));
      });

      await expect(writeFileAtomic(filePath, 'async fail')).rejects.toThrow('Simulated async rename failure');
      renameSpy.mockRestore();

      expect(fs.readdirSync(tempDir)).toEqual([]);
    });
  });
});

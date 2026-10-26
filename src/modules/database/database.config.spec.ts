import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  getDatabasePath,
  createTypeOrmOptions,
} from './database.config';

describe('database.config', () => {
  const originalEnv = process.env;
  let tempDir: string;

  beforeEach(() => {
    process.env = { ...originalEnv };
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-config-test-'));
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('getDatabasePath', () => {
    it('uses SQLITE_DB_PATH when set and creates parent dir if needed', () => {
      const customPath = path.join(tempDir, 'nested/subdir/test.sqlite');
      process.env.SQLITE_DB_PATH = customPath;

      const resolved = getDatabasePath();
      expect(resolved).toBe(path.resolve(customPath));
      expect(fs.existsSync(path.dirname(customPath))).toBe(true);
    });

    it('uses DATABASE_FILE when SQLITE_DB_PATH is unset', () => {
      delete process.env.SQLITE_DB_PATH;
      const customPath = path.join(tempDir, 'dbfile.sqlite');
      process.env.DATABASE_FILE = customPath;

      const resolved = getDatabasePath();
      expect(resolved).toBe(path.resolve(customPath));
    });

    it('falls back to data/antigravity.sqlite when both env vars are unset', () => {
      delete process.env.SQLITE_DB_PATH;
      delete process.env.DATABASE_FILE;

      const resolved = getDatabasePath();
      expect(resolved).toBe(path.resolve(process.cwd(), 'data/antigravity.sqlite'));
    });
  });

  describe('createTypeOrmOptions', () => {
    it('builds better-sqlite3 DataSourceOptions with migrations and entities', () => {
      process.env.SQLITE_DB_PATH = path.join(tempDir, 'test.sqlite');
      process.env.DEBUG_SQL = 'true';

      const options = createTypeOrmOptions();
      expect(options.type).toBe('better-sqlite3');
      expect(options.database).toBe(path.resolve(tempDir, 'test.sqlite'));
      expect(options.logging).toBe(true);
      expect(options.migrationsRun).toBe(true);
    });
  });

  describe('getStandaloneDataSource', () => {
    it('initializes and caches DataSource instance', async () => {
      process.env.SQLITE_DB_PATH = path.join(tempDir, 'standalone.sqlite');
      const { getStandaloneDataSource } = await import('./database.config');

      const ds1 = await getStandaloneDataSource();
      expect(ds1.isInitialized).toBe(true);

      const ds2 = await getStandaloneDataSource();
      expect(ds2).toBe(ds1);

      await ds1.destroy();
    });
  });
});

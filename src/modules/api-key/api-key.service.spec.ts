import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ApiKeyService } from './api-key.service';
import { hashApiKey, previewApiKey } from './api-key-hash';
import { ApiKey } from './entities/api-key.entity';

function createMockRepo(initialKeys: any[] = []) {
  const store = new Map<string, any>();
  initialKeys.forEach((k) => store.set(k.id || k.keyHash, { ...k }));

  return {
    store,
    repo: {
      find: jest.fn(async (options?: any) => {
        const values = Array.from(store.values());
        if (options?.where?.role) {
          return values.filter(
            (v) => v.role === options.where.role && (options.where.isActive === undefined || v.isActive === options.where.isActive),
          );
        }
        return values;
      }),
      findOne: jest.fn(async ({ where }: any) => {
        if (where?.id) {
          return store.get(where.id) || null;
        }
        if (where?.keyHash) {
          for (const item of store.values()) {
            if (item.keyHash === where.keyHash) return item;
          }
          return null;
        }
        return null;
      }),
      create: jest.fn((dto) => ({ ...dto, id: dto.id || `key-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` })),
      save: jest.fn(async (entity) => {
        const saved = { ...entity, id: entity.id || `key-${Date.now()}` };
        store.set(saved.id, saved);
        return saved;
      }),
      update: jest.fn(async (id: string, partial: any) => {
        const existing = store.get(id);
        if (existing) {
          Object.assign(existing, partial);
        }
      }),
      delete: jest.fn(async (id: string) => {
        store.delete(id);
      }),
    },
  };
}

describe('ApiKeyService', () => {
  describe('ensureBootstrapAdminKey', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      delete process.env.PROXY_API_KEY;
      delete process.env.INITIAL_ADMIN_KEY;
    });

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('creates one admin key when none exists', async () => {
      const { repo, store } = createMockRepo([]);
      const service = new ApiKeyService(repo as any);
      jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {});
      jest.spyOn((service as any).logger, 'log').mockImplementation(() => {});

      const raw = await service.ensureBootstrapAdminKey();

      expect(raw).toMatch(/^sk-ag-[0-9a-f]{48}$/);
      expect(store.size).toBe(1);
      const saved = Array.from(store.values())[0];
      expect(saved).toMatchObject({ name: 'Bootstrap admin', role: 'admin', isActive: true });
    });

    it('does nothing when an active admin key exists and no env key is provided', async () => {
      const { repo, store } = createMockRepo([
        { id: 'admin-1', role: 'admin', isActive: true, keyHash: 'hash-admin' },
      ]);
      const service = new ApiKeyService(repo as any);

      await expect(service.ensureBootstrapAdminKey()).resolves.toBeNull();
      expect(store.size).toBe(1);
    });

    it('registers PROXY_API_KEY from environment as admin key when set', async () => {
      process.env.PROXY_API_KEY = 'sk-custom-env-master-key-12345';
      const { repo, store } = createMockRepo([]);
      const service = new ApiKeyService(repo as any);
      jest.spyOn((service as any).logger, 'log').mockImplementation(() => {});

      const raw = await service.ensureBootstrapAdminKey();

      expect(raw).toBe('sk-custom-env-master-key-12345');
      expect(store.size).toBe(1);
      const saved = Array.from(store.values())[0];
      expect(saved).toMatchObject({
        name: 'Master Key (.env)',
        role: 'admin',
        isActive: true,
        keyHash: hashApiKey('sk-custom-env-master-key-12345'),
      });
    });

    it('re-activates existing key if PROXY_API_KEY is present in DB but inactive', async () => {
      const key = 'sk-custom-env-master-key-disabled';
      process.env.PROXY_API_KEY = key;
      const { repo, store } = createMockRepo([
        {
          id: 'admin-disabled',
          name: 'Old Key',
          keyHash: hashApiKey(key),
          keyPreview: previewApiKey(key),
          role: 'client',
          isActive: false,
        },
      ]);
      const service = new ApiKeyService(repo as any);
      jest.spyOn((service as any).logger, 'log').mockImplementation(() => {});

      const raw = await service.ensureBootstrapAdminKey();

      expect(raw).toBe(key);
      const updated = store.get('admin-disabled');
      expect(updated.isActive).toBe(true);
      expect(updated.role).toBe('admin');
    });
  });

  describe('Lifecycle & Cache (onModuleInit, onModuleDestroy, reloadCache)', () => {
    it('initializes cache and cleans up timer on module destroy', async () => {
      const keyEntity: ApiKey = {
        id: 'k-1',
        name: 'Initial Key',
        keyHash: hashApiKey('sk-ag-test-123456789012345678901234'),
        keyPreview: previewApiKey('sk-ag-test-123456789012345678901234'),
        role: 'admin',
        isActive: true,
        allowedAccountIds: null,
        expiresAt: null,
        lastUsedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const { repo } = createMockRepo([keyEntity]);
      const service = new ApiKeyService(repo as any);
      jest.spyOn((service as any).logger, 'log').mockImplementation(() => {});
      jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {});

      await service.onModuleInit();
      expect(service.hasConfiguredProtection()).toBe(true);

      await service.onModuleDestroy();
      expect((service as any).flushTimer).toBeNull();
    });

    it('handles database errors during reloadCache gracefully', async () => {
      const { repo } = createMockRepo([]);
      repo.find.mockRejectedValueOnce(new Error('DB connection lost'));
      const service = new ApiKeyService(repo as any);
      const errorSpy = jest.spyOn((service as any).logger, 'error').mockImplementation(() => {});

      await service.reloadCache();
      expect(errorSpy).toHaveBeenCalledWith(
        'Failed to load API keys into cache:',
        expect.any(Error),
      );
    });
  });

  describe('createKey', () => {
    it('throws BadRequestException if name is missing or blank', async () => {
      const { repo } = createMockRepo([]);
      const service = new ApiKeyService(repo as any);

      await expect(service.createKey({ name: '' })).rejects.toThrow(BadRequestException);
      await expect(service.createKey({ name: '   ' })).rejects.toThrow('API Key name is required');
    });

    it('creates a key with auto-generated token', async () => {
      const { repo } = createMockRepo([]);
      const service = new ApiKeyService(repo as any);
      jest.spyOn((service as any).logger, 'log').mockImplementation(() => {});

      const result = await service.createKey({
        name: 'Client App',
        role: 'client',
        allowedAccountIds: ['acc-1', 'acc-2'],
      });

      expect(result.key).toMatch(/^sk-ag-[0-9a-f]{48}$/);
      expect(result.record.name).toBe('Client App');
      expect(result.record.role).toBe('client');
      expect(result.record.allowedAccountIds).toEqual(['acc-1', 'acc-2']);
      expect(service.hasConfiguredProtection()).toBe(true);
    });

    it('validates customKey length and duplicate existence', async () => {
      const { repo } = createMockRepo([]);
      const service = new ApiKeyService(repo as any);
      jest.spyOn((service as any).logger, 'log').mockImplementation(() => {});

      // Custom key too short (< 16 chars)
      await expect(
        service.createKey({ name: 'Short', customKey: 'short-key' }),
      ).rejects.toThrow(/at least 16 characters long/);

      // Custom key valid
      const custom = 'my-super-secret-custom-key-12345';
      const created = await service.createKey({ name: 'Valid Custom', customKey: custom });
      expect(created.key).toBe(custom);

      // Duplicate custom key
      await expect(
        service.createKey({ name: 'Duplicate Custom', customKey: custom }),
      ).rejects.toThrow('API Key with this value already exists');
    });

    it('validates allowedAccountIds and role arguments', async () => {
      const { repo } = createMockRepo([]);
      const service = new ApiKeyService(repo as any);

      // Invalid role
      await expect(
        service.createKey({ name: 'Bad Role', role: 'superadmin' as any }),
      ).rejects.toThrow(/role must be one of/);

      // Invalid allowedAccountIds
      await expect(
        service.createKey({ name: 'Bad Accounts', allowedAccountIds: 'not-an-array' as any }),
      ).rejects.toThrow('allowedAccountIds must be an array of strings');

      // Empty array normalizes to null
      const created = await service.createKey({
        name: 'Empty Accounts',
        allowedAccountIds: [],
        expiresAt: '2030-01-01T00:00:00.000Z',
      });
      expect(created.record.allowedAccountIds).toBeNull();
      expect(created.record.expiresAt).toBeInstanceOf(Date);
    });
  });

  describe('validateKeySync & validateKey', () => {
    const rawKey = 'sk-ag-test-client-key-123456789012345678';
    const rawExpiredKey = 'sk-ag-test-expired-key-1234567890123456';
    const rawDisabledKey = 'sk-ag-test-disabled-key-123456789012345';

    let service: ApiKeyService;
    let repoMock: ReturnType<typeof createMockRepo>;

    beforeEach(async () => {
      const activeKey: ApiKey = {
        id: 'k-active',
        name: 'Active Client',
        keyHash: hashApiKey(rawKey),
        keyPreview: previewApiKey(rawKey),
        role: 'client',
        isActive: true,
        allowedAccountIds: ['acc-1'],
        expiresAt: null,
        lastUsedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const expiredKey: ApiKey = {
        id: 'k-expired',
        name: 'Expired Key',
        keyHash: hashApiKey(rawExpiredKey),
        keyPreview: previewApiKey(rawExpiredKey),
        role: 'client',
        isActive: true,
        allowedAccountIds: null,
        expiresAt: new Date(Date.now() - 60000), // in the past
        lastUsedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const disabledKey: ApiKey = {
        id: 'k-disabled',
        name: 'Disabled Key',
        keyHash: hashApiKey(rawDisabledKey),
        keyPreview: previewApiKey(rawDisabledKey),
        role: 'admin',
        isActive: false,
        allowedAccountIds: null,
        expiresAt: null,
        lastUsedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      repoMock = createMockRepo([activeKey, expiredKey, disabledKey]);
      service = new ApiKeyService(repoMock.repo as any);
      jest.spyOn((service as any).logger, 'log').mockImplementation(() => {});
      jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {});
      await service.reloadCache();
    });

    it('returns invalid_key for empty, undefined, null, or unknown tokens', () => {
      expect(service.validateKeySync(null)).toEqual({ valid: false, reason: 'invalid_key' });
      expect(service.validateKeySync(undefined)).toEqual({ valid: false, reason: 'invalid_key' });
      expect(service.validateKeySync('')).toEqual({ valid: false, reason: 'invalid_key' });
      expect(service.validateKeySync('   ')).toEqual({ valid: false, reason: 'invalid_key' });
      expect(service.validateKeySync('sk-ag-unknown-token')).toEqual({ valid: false, reason: 'invalid_key' });
    });

    it('returns disabled for disabled key', () => {
      const result = service.validateKeySync(rawDisabledKey);
      expect(result).toEqual({
        valid: false,
        reason: 'disabled',
        keyId: 'k-disabled',
        keyName: 'Disabled Key',
      });
    });

    it('returns expired for past expiresAt key', () => {
      const result = service.validateKeySync(rawExpiredKey);
      expect(result).toEqual({
        valid: false,
        reason: 'expired',
        keyId: 'k-expired',
        keyName: 'Expired Key',
      });
    });

    it('validates active key and records lastUsed', () => {
      const result = service.validateKeySync(rawKey);
      expect(result).toEqual({
        valid: true,
        isMaster: false,
        role: 'client',
        keyId: 'k-active',
        keyName: 'Active Client',
        allowedAccountIds: ['acc-1'],
      });
      expect((service as any).pendingLastUsed.has('k-active')).toBe(true);
    });

    it('validateKey falls back to database on cache miss and caches the result', async () => {
      const lateKeyRaw = 'sk-ag-late-added-concurrent-key-12345';
      const lateKey: ApiKey = {
        id: 'k-late',
        name: 'Late Key',
        keyHash: hashApiKey(lateKeyRaw),
        keyPreview: previewApiKey(lateKeyRaw),
        role: 'admin',
        isActive: true,
        allowedAccountIds: null,
        expiresAt: null,
        lastUsedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      // Add directly to repo store, bypassing keyCache
      repoMock.store.set(lateKey.id, lateKey);

      // Async validateKey finds it in DB, adds to cache
      const result = await service.validateKey(lateKeyRaw);
      expect(result.valid).toBe(true);
      expect(result.role).toBe('admin');

      // Now sync validation also succeeds because it was cached
      expect(service.validateKeySync(lateKeyRaw).valid).toBe(true);
    });

    it('validateKey returns invalid if key not found in DB fallback', async () => {
      const result = await service.validateKey('sk-ag-completely-unknown-token');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('invalid_key');
    });

    it('validateAdminKey checks both validity and role === "admin"', async () => {
      // Client key returns false
      expect(await service.validateAdminKey(rawKey)).toBe(false);

      // Admin key created and tested
      const adminRes = await service.createKey({ name: 'Real Admin', role: 'admin' });
      expect(await service.validateAdminKey(adminRes.key)).toBe(true);

      // Invalid token returns false
      expect(await service.validateAdminKey('invalid-admin-key')).toBe(false);
    });
  });

  describe('flushPendingLastUsed', () => {
    it('flushes pending dates to DB and updates cache', async () => {
      const rawKey = 'sk-ag-flush-test-key-123456789012345678';
      const keyEntity: ApiKey = {
        id: 'k-flush',
        name: 'Flush Key',
        keyHash: hashApiKey(rawKey),
        keyPreview: previewApiKey(rawKey),
        role: 'client',
        isActive: true,
        allowedAccountIds: null,
        expiresAt: null,
        lastUsedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const { repo, store } = createMockRepo([keyEntity]);
      const service = new ApiKeyService(repo as any);
      jest.spyOn((service as any).logger, 'log').mockImplementation(() => {});
      await service.reloadCache();

      // Validate key to queue lastUsed
      service.validateKeySync(rawKey);
      expect((service as any).pendingLastUsed.size).toBe(1);

      // Flush
      await (service as any).flushPendingLastUsed();
      expect((service as any).pendingLastUsed.size).toBe(0);
      expect(store.get('k-flush').lastUsedAt).toBeInstanceOf(Date);

      // Calling flush when empty is a no-op
      await (service as any).flushPendingLastUsed();
    });

    it('handles repository update error gracefully', async () => {
      const { repo } = createMockRepo([]);
      repo.update.mockRejectedValueOnce(new Error('Update failed'));
      const service = new ApiKeyService(repo as any);
      const warnSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {});

      (service as any).pendingLastUsed.set('k-fail', new Date());
      await (service as any).flushPendingLastUsed();

      expect(warnSpy).toHaveBeenCalledWith(
        'Could not update lastUsedAt for key k-fail:',
        expect.any(Error),
      );
    });
  });

  describe('CRUD operations (listKeys, getKeyById, updateKey, deleteKey)', () => {
    let service: ApiKeyService;
    let repoMock: ReturnType<typeof createMockRepo>;

    beforeEach(async () => {
      repoMock = createMockRepo([]);
      service = new ApiKeyService(repoMock.repo as any);
      jest.spyOn((service as any).logger, 'log').mockImplementation(() => {});
    });

    it('listKeys lists all keys ordered by createdAt DESC', async () => {
      await service.createKey({ name: 'Key 1' });
      await service.createKey({ name: 'Key 2' });

      const list = await service.listKeys();
      expect(list).toHaveLength(2);
      expect(repoMock.repo.find).toHaveBeenCalledWith({ order: { createdAt: 'DESC' } });
    });

    it('getKeyById returns existing key and throws NotFoundException when missing', async () => {
      const created = await service.createKey({ name: 'FindMe' });
      const found = await service.getKeyById(created.record.id);
      expect(found.id).toBe(created.record.id);

      await expect(service.getKeyById('non-existent-id')).rejects.toThrow(NotFoundException);
    });

    it('updateKey modifies entity fields and updates cache', async () => {
      const created = await service.createKey({ name: 'Initial', role: 'client' });
      const expiry = new Date('2030-01-01').toISOString();

      const updated = await service.updateKey(created.record.id, {
        name: 'Updated Name',
        role: 'admin',
        isActive: false,
        allowedAccountIds: ['acc-99'],
        expiresAt: expiry,
      });

      expect(updated.name).toBe('Updated Name');
      expect(updated.role).toBe('admin');
      expect(updated.isActive).toBe(false);
      expect(updated.allowedAccountIds).toEqual(['acc-99']);
      expect(updated.expiresAt).toEqual(new Date(expiry));

      // Key is disabled in cache
      const syncResult = service.validateKeySync(created.key);
      expect(syncResult.valid).toBe(false);
      expect(syncResult.reason).toBe('disabled');
    });

    it('deleteKey removes key from repository and cache', async () => {
      const created = await service.createKey({ name: 'DeleteMe' });
      expect(service.hasConfiguredProtection()).toBe(true);

      const deleted = await service.deleteKey(created.record.id);
      expect(deleted).toBe(true);
      expect(service.hasConfiguredProtection()).toBe(false);

      await expect(service.getKeyById(created.record.id)).rejects.toThrow(NotFoundException);
      await expect(service.deleteKey(created.record.id)).rejects.toThrow(NotFoundException);
    });
  });
});

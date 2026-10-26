import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import {
  generateApiKey,
  hashApiKey,
  MIN_CUSTOM_KEY_LENGTH,
  previewApiKey,
} from "./api-key-hash";
import {
  ApiKeyValidationResult,
  CreateApiKeyDto,
  UpdateApiKeyDto,
} from "./dto/api-key.dto";
import { ApiKey, ApiKeyRole } from "./entities/api-key.entity";

const VALID_ROLES: ReadonlySet<ApiKeyRole> = new Set(["client", "admin"]);

function normalizeAllowedAccountIds(
  value: unknown,
): string[] | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (!Array.isArray(value)) {
    throw new BadRequestException("allowedAccountIds must be an array of strings");
  }
  const ids = value.map((s) => String(s).trim()).filter(Boolean);
  if (ids.length === 0) {
    return null;
  }
  return ids;
}

function normalizeRole(value: unknown): ApiKeyRole | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!VALID_ROLES.has(value as ApiKeyRole)) {
    throw new BadRequestException(`role must be one of: ${[...VALID_ROLES].join(", ")}`);
  }
  return value as ApiKeyRole;
}

/** A newly created key, paired with the one and only view of its plaintext. */
export interface CreatedApiKey {
  record: ApiKey;
  key: string;
}

@Injectable()
export class ApiKeyService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ApiKeyService.name);
  /** Keyed by SHA-256 digest of the key, never by the key itself. */
  private keyCache = new Map<string, ApiKey>();
  private pendingLastUsed = new Map<string, Date>();
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(
    @InjectRepository(ApiKey)
    private readonly apiKeyRepository: Repository<ApiKey>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reloadCache();

    // Periodic flush for lastUsedAt updates (every 30s)
    this.flushTimer = setInterval(() => {
      this.flushPendingLastUsed().catch((err) => {
        this.logger.error("Failed to flush lastUsedAt updates to SQLite:", err);
      });
    }, 30000);
    this.flushTimer.unref();

    await this.ensureBootstrapAdminKey();
  }

  /**
   * First-run bootstrap: if no active admin key exists, create one and show the
   * plaintext exactly once in the logs. On every later boot this is a no-op, so a
   * restart never mints a second admin key.
   */
  async ensureBootstrapAdminKey(): Promise<string | null> {
    const admins = await this.apiKeyRepository.find({
      where: { role: "admin", isActive: true },
    });
    if (admins.length > 0) return null;

    const { key } = await this.createKey({ name: "Bootstrap admin", role: "admin" });
    this.logger.warn(
      `No admin API key existed. Generated a bootstrap admin key (shown once): ${key}`,
    );
    return key;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flushPendingLastUsed();
  }

  /**
   * Reload all active keys from SQLite into in-memory cache for ultra-fast validation
   */
  async reloadCache(): Promise<void> {
    try {
      const keys = await this.apiKeyRepository.find();
      this.keyCache.clear();
      for (const item of keys) {
        this.keyCache.set(item.keyHash, item);
      }
      this.logger.log(
        `Loaded ${this.keyCache.size} API key(s) from SQLite database into memory cache.`,
      );
    } catch (err) {
      this.logger.error("Failed to load API keys into cache:", err);
    }
  }


  /**
   * Check if any key protection is active (keys in DB cache)
   */
  hasConfiguredProtection(): boolean {
    return this.keyCache.size > 0;
  }

  /**
   * Synchronously validate a client token against in-memory cache
   */
  validateKeySync(token: string | null | undefined): ApiKeyValidationResult {
    if (!token || typeof token !== "string") {
      return { valid: false, reason: "invalid_key" };
    }

    const trimmed = token.trim();
    if (!trimmed) {
      return { valid: false, reason: "invalid_key" };
    }

    const tokenHash = hashApiKey(trimmed);

    // Check in-memory cache, keyed by digest
    const keyEntity = this.keyCache.get(tokenHash);
    if (!keyEntity) {
      return { valid: false, reason: "invalid_key" };
    }

    if (!keyEntity.isActive) {
      return {
        valid: false,
        reason: "disabled",
        keyId: keyEntity.id,
        keyName: keyEntity.name,
      };
    }

    if (keyEntity.expiresAt && new Date() > new Date(keyEntity.expiresAt)) {
      return {
        valid: false,
        reason: "expired",
        keyId: keyEntity.id,
        keyName: keyEntity.name,
      };
    }

    this.recordLastUsed(keyEntity.id);

    return {
      valid: true,
      isMaster: false,
      role: keyEntity.role,
      keyId: keyEntity.id,
      keyName: keyEntity.name,
      allowedAccountIds: keyEntity.allowedAccountIds ?? null,
    };
  }

  /**
   * Validate a client token against Master Key and dynamic keys in DB
   */
  async validateKey(
    token: string | null | undefined,
  ): Promise<ApiKeyValidationResult> {
    const syncResult = this.validateKeySync(token);
    if (
      syncResult.valid ||
      syncResult.reason === "disabled" ||
      syncResult.reason === "expired"
    ) {
      return syncResult;
    }

    // Fallback to DB if cache miss (e.g. key created via CLI or other process concurrently)
    if (token && typeof token === "string") {
      const trimmed = token.trim();
      const dbKey = await this.apiKeyRepository.findOne({
        where: { keyHash: hashApiKey(trimmed) },
      });
      if (dbKey) {
        this.keyCache.set(dbKey.keyHash, dbKey);
        return this.validateKeySync(trimmed);
      }
    }

    return syncResult;
  }

  /**
   * Validate if token has admin privileges
   */
  async validateAdminKey(token: string | null | undefined): Promise<boolean> {
    const result = await this.validateKey(token);
    return result.valid && result.role === "admin";
  }

  private recordLastUsed(id: string): void {
    this.pendingLastUsed.set(id, new Date());
  }

  private async flushPendingLastUsed(): Promise<void> {
    if (this.pendingLastUsed.size === 0) {
      return;
    }
    const entries = Array.from(this.pendingLastUsed.entries());
    this.pendingLastUsed.clear();

    for (const [id, date] of entries) {
      try {
        await this.apiKeyRepository.update(id, { lastUsedAt: date });
        // Update in cache as well
        for (const item of this.keyCache.values()) {
          if (item.id === id) {
            item.lastUsedAt = date;
            break;
          }
        }
      } catch (err) {
        this.logger.warn(`Could not update lastUsedAt for key ${id}:`, err);
      }
    }
  }

  /**
   * Create a new API Key.
   *
   * The plaintext key is returned here and nowhere else, because only its digest is
   * stored. A caller that loses it must create a replacement.
   */
  async createKey(dto: CreateApiKeyDto): Promise<CreatedApiKey> {
    if (!dto.name || !dto.name.trim()) {
      throw new BadRequestException("API Key name is required");
    }

    let keyValue = dto.customKey?.trim();
    if (keyValue) {
      // A generated key is 192 bits of randomness, but a custom one is whatever the
      // operator typed, and the stored digest is only as strong as its input.
      if (keyValue.length < MIN_CUSTOM_KEY_LENGTH) {
        throw new BadRequestException(
          `A custom API key must be at least ${MIN_CUSTOM_KEY_LENGTH} characters long`,
        );
      }
      const existing = await this.apiKeyRepository.findOne({
        where: { keyHash: hashApiKey(keyValue) },
      });
      if (existing) {
        throw new BadRequestException("API Key with this value already exists");
      }
    } else {
      keyValue = generateApiKey();
    }

    const allowed = normalizeAllowedAccountIds(dto.allowedAccountIds);
    const role = normalizeRole(dto.role);

    const entity = this.apiKeyRepository.create({
      name: dto.name.trim(),
      keyHash: hashApiKey(keyValue),
      keyPreview: previewApiKey(keyValue),
      role: role ?? "client",
      isActive: true,
      allowedAccountIds: allowed ?? null,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      lastUsedAt: null,
    });

    const saved = await this.apiKeyRepository.save(entity);
    this.keyCache.set(saved.keyHash, saved);
    this.logger.log(
      `Created new API key [${saved.name}] (Role: ${saved.role}, ID: ${saved.id})`,
    );
    return { record: saved, key: keyValue };
  }

  /**
   * List all keys. Each carries only its masked preview -- the key cannot be recovered.
   */
  async listKeys(): Promise<ApiKey[]> {
    return this.apiKeyRepository.find({ order: { createdAt: "DESC" } });
  }

  async getKeyById(id: string): Promise<ApiKey> {
    const key = await this.apiKeyRepository.findOne({ where: { id } });
    if (!key) {
      throw new NotFoundException(`API key with ID ${id} not found`);
    }
    return key;
  }

  async updateKey(id: string, dto: UpdateApiKeyDto): Promise<ApiKey> {
    const key = await this.getKeyById(id);

    if (dto.name !== undefined) {
      key.name = dto.name.trim();
    }
    if (dto.role !== undefined) {
      key.role = normalizeRole(dto.role)!;
    }
    if (dto.isActive !== undefined) {
      key.isActive = dto.isActive;
    }
    if (dto.allowedAccountIds !== undefined) {
      key.allowedAccountIds = normalizeAllowedAccountIds(dto.allowedAccountIds) ?? null;
    }
    if (dto.expiresAt !== undefined) {
      key.expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    }

    const updated = await this.apiKeyRepository.save(key);
    this.keyCache.set(updated.keyHash, updated);
    this.logger.log(
      `Updated API key [${updated.name}] (ID: ${updated.id}, Active: ${updated.isActive})`,
    );
    return updated;
  }

  async deleteKey(id: string): Promise<boolean> {
    const key = await this.apiKeyRepository.findOne({ where: { id } });
    if (!key) {
      throw new NotFoundException(`API key with ID ${id} not found`);
    }

    await this.apiKeyRepository.delete(id);
    this.keyCache.delete(key.keyHash);
    this.logger.log(`Deleted API key [${key.name}] (ID: ${id})`);
    return true;
  }
}

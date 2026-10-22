# Login Gate + Jest/Playwright Test Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Khóa dashboard sau login admin, bổ sung quản trị account/audit còn thiếu, và dựng bộ test Jest (unit + E2E API) cùng Playwright chạy được local và CI.

**Architecture:** Jest chạy unit cạnh source và E2E API boot server Nest thật trong thư mục tạm (SQLite/JSON store riêng, upstream chặn bằng nock). Playwright chạy full-stack trên server tạm do chính nó khởi động, dữ liệu seed trước khi boot, Chromium, `workers: 1`. Phase sản phẩm (auth gate, account PATCH, audit filter) được triển khai TDD trước các spec UI.

**Tech Stack:** NestJS 11 + Fastify, TypeORM/better-sqlite3, React 19 + Vite, Jest 29 + ts-jest, nock, @playwright/test (Chromium), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-21-test-suite-design.md`

## Global Constraints

- Node 24; TypeScript CommonJS; alias `@/` → `src/`.
- Không test nào được gọi mạng thật. Unit/E2E API: `nock.disableNetConnect()`. Playwright: không seed credential thật, không bấm Sync.
- Không test nào được ghi vào `./data/`, `./accounts.json`, `./routing.json` thật. Mọi test dùng thư mục tạm.
- `GET /internal/*`, `POST /graphql` và mọi endpoint quản trị phải trả 401 khi không có admin key, sau Task 3.
- Bootstrap: DB không có admin key active → tự sinh một key role `admin`, in raw key đúng một lần ra console; restart không sinh thêm.
- Mọi chuỗi UI mới phải có cả `en` và `vi` trong `web/src/i18n/types.ts`, `locales/en.ts`, `locales/vi.ts`.
- Playwright chỉ Chromium, `workers: 1`, `fullyParallel: false`, không `waitForTimeout`.
- Test chạy xong `git status --porcelain` phải sạch.
- Không đổi schema DB; chỉ dùng cột `traffic_logs.apiKeyId` sẵn có.
- Commit sau mỗi task; message theo `feat:`, `test:`, `chore:`.

## Review Focus

1. Request `/internal/system/status` không token sau khi đã có admin key → **401**, không được lọt qua nhánh keyless.
2. `PATCH /internal/accounts/:id` với field lạ (`email`, `provider`) → **400**, không ghi một phần.
3. Account `is_active: false` vẫn hiện trong UI nhưng **không được chọn** cho request model → request không còn account → 503.
4. Audit filter `apiKeyId` không tồn tại hoặc `from > to` → **200 với danh sách rỗng**, không 500; `apiKeyId` sai định dạng → 400.
5. Chạy toàn bộ test không làm thay đổi file dữ liệu thật; server Playwright chỉ đọc/ghi trong thư mục tạm.

---

### Task 1: Jest unit foundation

**Files:**
- Modify: `package.json`
- Create: `jest.config.cjs`
- Create: `test/setup/jest.setup.ts`
- Create: `src/modules/api-key/api-key-hash.spec.ts`

**Interfaces:**
- Produces: `npm run test:unit [-- <pattern>]`, `npm run test:unit:watch`, `npm run test:cov`; Jest config map `@/` → `src/`.

- [ ] **Step 1: Add Jest dependencies**

Run:
```bash
npm i -D jest@^29.7.0 ts-jest@^29.2.5 @types/jest@^29.5.14 nock@^14.0.0
```

- [ ] **Step 2: Write the failing spec**

Create `src/modules/api-key/api-key-hash.spec.ts`:
```ts
import {
  API_KEY_HASH_LENGTH,
  generateApiKey,
  hashApiKey,
  hashesEqual,
  previewApiKey,
} from './api-key-hash';

describe('api-key-hash', () => {
  it('generates sk-ag keys with 48 hex characters', () => {
    expect(generateApiKey()).toMatch(/^sk-ag-[0-9a-f]{48}$/);
  });

  it('hashes deterministically and trims surrounding whitespace', () => {
    expect(hashApiKey(' abc ')).toBe(hashApiKey('abc'));
    expect(hashApiKey('abc')).toHaveLength(API_KEY_HASH_LENGTH);
  });

  it('compares only well-formed equal-length digests', () => {
    expect(hashesEqual(hashApiKey('a'), hashApiKey('a'))).toBe(true);
    expect(hashesEqual('abc', 'abc')).toBe(false);
  });

  it('previews without exposing the middle', () => {
    expect(previewApiKey('sk-ag-1234567890abcdef')).toBe('sk-ag-12...cdef');
    expect(previewApiKey('short')).toBe('****');
  });
});
```

- [ ] **Step 3: Run it and confirm Jest cannot run yet**

Run: `npx jest src/modules/api-key/api-key-hash.spec.ts`
Expected: FAIL — Jest chưa có config hoặc không resolve `@/`.

- [ ] **Step 4: Add Jest config and setup**

Create `jest.config.cjs`:
```js
/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/src', '<rootDir>/web/src/lib'],
  testMatch: ['**/*.spec.ts'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  setupFiles: ['<rootDir>/test/setup/jest.setup.ts'],
  clearMocks: true,
  testTimeout: 15000,
};
```

Create `test/setup/jest.setup.ts`:
```ts
process.env.NODE_ENV = 'test';
process.env.TZ = 'UTC';
```

Add scripts to `package.json`:
```json
"test:unit": "jest --config jest.config.cjs",
"test:unit:watch": "jest --config jest.config.cjs --watch",
"test:cov": "jest --config jest.config.cjs --coverage"
```

- [ ] **Step 5: Run the spec and confirm it passes**

Run: `npm run test:unit -- src/modules/api-key/api-key-hash.spec.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json jest.config.cjs test/setup/jest.setup.ts src/modules/api-key/api-key-hash.spec.ts
git commit -m "test: add jest unit test foundation"
```

---

### Task 2: E2E API harness

**Files:**
- Modify: `package.json`
- Create: `jest.e2e.config.cjs`
- Create: `test/e2e/helpers/temp-env.ts`
- Create: `test/e2e/helpers/seed.ts`
- Create: `test/e2e/helpers/server.ts`
- Create: `test/e2e/auth.e2e-spec.ts`

**Interfaces:**
- Produces in `temp-env.ts`:
  - `applyTempEnv(prefix: string): { dir: string; restore(): void }` — set `SQLITE_DB_PATH`, `ACCOUNTS_FILE`, `ROUTING_CONFIG_PATH`, `DATA_DIR`, `NODE_ENV=test`, `HOST=127.0.0.1`; restore previous values.
  - `freePort(): Promise<number>`.
- Produces in `seed.ts`:
  - `TEST_ADMIN_KEY = 'sk-ag-' + 'a'.repeat(48)`
  - `TEST_CLIENT_KEY = 'sk-ag-' + 'b'.repeat(48)`
  - `seedAdminKey(dbPath: string, rawKey: string, role?: 'admin' | 'client'): Promise<{ id: string }>`
  - `insertTrafficLogs(dbPath: string, rows: Array<Partial<TrafficLog> & { id: string; timestamp: number }>): Promise<void>`
- Produces in `server.ts`:
  - `startTestServer(options?: { accounts?: unknown[]; seedKeys?: boolean }): Promise<{ baseUrl: string; port: number; adminKey: string; clientKey: string; close(): Promise<void> }>` — mặc định seed admin+client key; `seedKeys: false` để test bootstrap; nếu có `accounts`, ghi `ACCOUNTS_FILE` trước khi boot.
  - `apiFetch(baseUrl: string, path: string, init?: { method?: string; token?: string | null; body?: unknown }): Promise<{ status: number; body: any }>`

- [ ] **Step 1: Write the failing E2E spec**

Create `test/e2e/auth.e2e-spec.ts`:
```ts
import { apiFetch, startTestServer } from './helpers/server';

describe('admin surface', () => {
  let server: Awaited<ReturnType<typeof startTestServer>>;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  it('returns system status for an admin key', async () => {
    const res = await apiFetch(server.baseUrl, '/internal/system/status', {
      token: server.adminKey,
    });

    expect(res.status).toBe(200);
    expect(res.body.port).toBe(server.port);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx jest --config jest.e2e.config.cjs test/e2e/auth.e2e-spec.ts`
Expected: FAIL — `jest.e2e.config.cjs` / helpers chưa tồn tại.

- [ ] **Step 3: Implement the helpers**

`test/e2e/helpers/temp-env.ts`:
```ts
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

export function applyTempEnv(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const previous = new Map<string, string | undefined>();
  const values: Record<string, string> = {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    SQLITE_DB_PATH: path.join(dir, 'test.sqlite'),
    ACCOUNTS_FILE: path.join(dir, 'accounts.json'),
    ROUTING_CONFIG_PATH: path.join(dir, 'routing.json'),
    DATA_DIR: dir,
  };
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  return {
    dir,
    restore() {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      srv.close(() => resolve(port));
    });
  });
}
```

`test/e2e/helpers/seed.ts`:
```ts
import { ApiKey } from '../../../src/modules/api-key/entities/api-key.entity';
import { hashApiKey, previewApiKey } from '../../../src/modules/api-key/api-key-hash';
import { getStandaloneDataSource } from '../../../src/modules/database/database.config';
import { TrafficLog } from '../../../src/modules/proxy-gateway/audit/entities/traffic-log.entity';

export const TEST_ADMIN_KEY = `sk-ag-${'a'.repeat(48)}`;
export const TEST_CLIENT_KEY = `sk-ag-${'b'.repeat(48)}`;

export async function seedAdminKey(
  _dbPath: string,
  rawKey: string,
  role: 'admin' | 'client' = 'admin',
) {
  const ds = await getStandaloneDataSource();
  try {
    const saved = await ds.getRepository(ApiKey).save({
      id: role === 'admin' ? '11111111-1111-4111-8111-111111111111' : '22222222-2222-4222-8222-222222222222',
      keyHash: hashApiKey(rawKey),
      keyPreview: previewApiKey(rawKey),
      name: role === 'admin' ? 'Test admin' : 'Test client',
      role,
      isActive: true,
      allowedAccountIds: null,
      expiresAt: null,
      lastUsedAt: null,
    });
    return { id: saved.id };
  } finally {
    await ds.destroy();
  }
}

export async function insertTrafficLogs(
  _dbPath: string,
  rows: Array<Partial<TrafficLog> & { id: string; timestamp: number }>,
) {
  const ds = await getStandaloneDataSource();
  try {
    const repo = ds.getRepository(TrafficLog);
    await repo.save(
      rows.map((row) => ({
        method: 'POST',
        endpoint: '/v1/chat/completions',
        model: 'gemini-2.5-pro',
        status: 200,
        latencyMs: 10,
        promptTokens: 1,
        completionTokens: 1,
        totalTokens: 2,
        errorMessage: null,
        apiKeyId: null,
        ...row,
      })),
    );
  } finally {
    await ds.destroy();
  }
}
```

`test/e2e/helpers/server.ts`:
```ts
import { freePort, applyTempEnv } from './temp-env';
import { seedAdminKey, TEST_ADMIN_KEY, TEST_CLIENT_KEY } from './seed';

export async function startTestServer(options: { accounts?: unknown[]; seedKeys?: boolean } = {}) {
  const temp = applyTempEnv('agp-e2e-');
  const port = await freePort();
  if (options.accounts) {
    const fs = await import('node:fs');
    fs.writeFileSync(process.env.ACCOUNTS_FILE!, JSON.stringify(options.accounts));
  }
  if (options.seedKeys !== false) {
    await seedAdminKey(process.env.SQLITE_DB_PATH!, TEST_ADMIN_KEY, 'admin');
    await seedAdminKey(process.env.SQLITE_DB_PATH!, TEST_CLIENT_KEY, 'client');
  }

  const { bootstrapNestServer, stopNestServer } = await import('../../src/server/main');
  const { DEFAULT_APP_CONFIG } = await import('../../src/modules/config/types');
  const started = await bootstrapNestServer({
    ...DEFAULT_APP_CONFIG.proxy,
    enabled: true,
    port,
    api_key: '',
    auto_start: true,
  });

  if (!started.success) throw new Error(`server failed to start: ${started.message}`);

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    port,
    adminKey: TEST_ADMIN_KEY,
    clientKey: TEST_CLIENT_KEY,
    async close() {
      await stopNestServer();
      temp.restore();
    },
  };
}

export async function apiFetch(
  baseUrl: string,
  path: string,
  init: { method?: string; token?: string | null; body?: unknown } = {},
) {
  const headers: Record<string, string> = {};
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${baseUrl}${path}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
```

Create `jest.e2e.config.cjs`:
```js
/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/test/e2e'],
  testMatch: ['**/*.e2e-spec.ts'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  setupFiles: ['<rootDir>/test/setup/jest.setup.ts'],
  maxWorkers: 1,
  testTimeout: 30000,
};
```

Add script:
```json
"test:e2e": "jest --config jest.e2e.config.cjs --runInBand",
"test:e2e:watch": "jest --config jest.e2e.config.cjs --runInBand --watch"
```

- [ ] **Step 4: Run the spec and confirm it passes**

Run: `npm run test:e2e -- test/e2e/auth.e2e-spec.ts`
Expected: PASS, 1 test; temp dir bị xoá sau khi chạy.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json jest.e2e.config.cjs test/e2e/
git commit -m "test: add e2e api harness with isolated temp data"
```

---

### Task 3: Enforce admin key + first-run bootstrap

**Files:**
- Modify: `src/modules/proxy-gateway/server/guards/admin.guard.ts`
- Modify: `src/modules/api-key/api-key.service.ts`
- Create: `src/modules/proxy-gateway/server/guards/admin.guard.spec.ts`
- Create: `src/modules/api-key/api-key.service.spec.ts`
- Create: `test/e2e/bootstrap.e2e-spec.ts`
- Modify: `test/e2e/auth.e2e-spec.ts`

**Interfaces:**
- Produces: `ApiKeyService.ensureBootstrapAdminKey(): Promise<string | null>` — trả raw key khi vừa tạo, `null` khi đã có admin key.
- Guard không token → `UnauthorizedException('Admin API key is required')`.
- `POST /internal/auth/validate` đã trả `role`; không sửa backend endpoint này.

- [ ] **Step 1: Write failing guard tests**

Create `src/modules/proxy-gateway/server/guards/admin.guard.spec.ts`:
```ts
import { UnauthorizedException } from '@nestjs/common';
import { AdminGuard } from './admin.guard';

function context(headers: Record<string, string>) {
  return {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => ({ headers, ip: '127.0.0.1' }) }),
  } as any;
}

describe('AdminGuard', () => {
  it('rejects a request with no token', async () => {
    const guard = new AdminGuard({ validateAdminKey: jest.fn() } as any);
    await expect(guard.canActivate(context({}))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a client-role or invalid token', async () => {
    const guard = new AdminGuard({ validateAdminKey: jest.fn().mockResolvedValue(false) } as any);
    await expect(
      guard.canActivate(context({ authorization: 'Bearer sk-ag-client' })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('allows an admin token', async () => {
    const guard = new AdminGuard({ validateAdminKey: jest.fn().mockResolvedValue(true) } as any);
    await expect(
      guard.canActivate(context({ authorization: 'Bearer sk-ag-admin' })),
    ).resolves.toBe(true);
  });

  it('still allows @Public handlers', async () => {
    const guard = new AdminGuard({ validateAdminKey: jest.fn() } as any);
    const ctx = context({});
    (ctx.getHandler as any) = () => {
      const handler = () => {};
      Reflect.defineMetadata('isPublic', true, handler);
      return handler;
    };
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
});
```

- [ ] **Step 2: Run and confirm the no-token test fails**

Run: `npm run test:unit -- src/modules/proxy-gateway/server/guards/admin.guard.spec.ts`
Expected: FAIL — guard currently returns `true` when no token.

- [ ] **Step 3: Remove the keyless bypass**

In `admin.guard.ts`, replace the final `return true;` with:
```ts
this.logger.warn('Rejected admin request without a token');
throw new UnauthorizedException('Admin API key is required');
```

- [ ] **Step 4: Write failing bootstrap tests**

Create `src/modules/api-key/api-key.service.spec.ts`:
```ts
import { ApiKeyService } from './api-key.service';

function repoWith(existing: any[]) {
  const saved: any[] = [];
  return {
    saved,
    repo: {
      find: jest.fn().mockResolvedValue(existing),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((v) => v),
      save: jest.fn(async (v) => {
        saved.push(v);
        return { ...v, id: 'key-1' };
      }),
    },
  };
}

describe('ApiKeyService.ensureBootstrapAdminKey', () => {
  it('creates one admin key when none exists', async () => {
    const { repo, saved } = repoWith([]);
    const service = new ApiKeyService(repo as any);
    const raw = await service.ensureBootstrapAdminKey();

    expect(raw).toMatch(/^sk-ag-[0-9a-f]{48}$/);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ name: 'Bootstrap admin', role: 'admin', isActive: true });
  });

  it('does nothing when an active admin key exists', async () => {
    const { repo, saved } = repoWith([{ role: 'admin', isActive: true }]);
    const service = new ApiKeyService(repo as any);
    await expect(service.ensureBootstrapAdminKey()).resolves.toBeNull();
    expect(saved).toHaveLength(0);
  });
});
```

- [ ] **Step 5: Run and confirm it fails**

Run: `npm run test:unit -- src/modules/api-key/api-key.service.spec.ts`
Expected: FAIL — `ensureBootstrapAdminKey` is not a function.

- [ ] **Step 6: Implement bootstrap key**

In `ApiKeyService`, call `await this.ensureBootstrapAdminKey();` at the end of `onModuleInit()` and add:
```ts
async ensureBootstrapAdminKey(): Promise<string | null> {
  const admins = await this.apiKeyRepository.find({
    where: { role: 'admin', isActive: true },
  });
  if (admins.length > 0) return null;

  const { key } = await this.createKey({ name: 'Bootstrap admin', role: 'admin' });
  this.logger.warn(
    `No admin API key existed. Generated a bootstrap admin key (shown once): ${key}`,
  );
  return key;
}
```

- [ ] **Step 7: Extend the E2E auth spec**

Add to `auth.e2e-spec.ts`:
```ts
it('rejects internal APIs without a token', async () => {
  const res = await apiFetch(server.baseUrl, '/internal/system/status');
  expect(res.status).toBe(401);
});

it('rejects a client-role key on the admin surface', async () => {
  const res = await apiFetch(server.baseUrl, '/internal/system/status', {
    token: server.clientKey,
  });
  expect(res.status).toBe(401);
});

it('requires an admin key for graphql', async () => {
  const res = await apiFetch(server.baseUrl, '/graphql', {
    body: { query: '{ __typename }' },
  });
  expect(res.status).toBe(401);
});
```

Create `test/e2e/bootstrap.e2e-spec.ts`:
```ts
import { getStandaloneDataSource } from '../../src/modules/database/database.config';
import { ApiKey } from '../../src/modules/api-key/entities/api-key.entity';
import { startTestServer } from './helpers/server';

describe('first-run admin bootstrap', () => {
  it('creates exactly one admin key when the database starts empty', async () => {
    const server = await startTestServer({ seedKeys: false });
    try {
      const ds = await getStandaloneDataSource();
      const admins = await ds.getRepository(ApiKey).find({ where: { role: 'admin' } });
      await ds.destroy();
      expect(admins).toHaveLength(1);
      expect(admins[0].keyPreview).toMatch(/^sk-ag-[0-9a-f]{2}\.\.\.[0-9a-f]{4}$/);
      expect(admins[0].isActive).toBe(true);
    } finally {
      await server.close();
    }
  });
});
```
Thêm vào service spec một assertion logger:
```ts
const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {});
expect(warn).toHaveBeenCalledWith(expect.stringContaining(raw!));
```

- [ ] **Step 8: Run all auth tests**

Run:
```bash
npm run test:unit -- src/modules/api-key/api-key.service.spec.ts src/modules/proxy-gateway/server/guards/admin.guard.spec.ts
npm run test:e2e -- test/e2e/auth.e2e-spec.ts test/e2e/bootstrap.e2e-spec.ts
```
Expected: PASS toàn bộ.

- [ ] **Step 9: Commit**

```bash
git add src/modules/api-key/api-key.service.ts src/modules/api-key/api-key.service.spec.ts \
  src/modules/proxy-gateway/server/guards/admin.guard.ts \
  src/modules/proxy-gateway/server/guards/admin.guard.spec.ts test/e2e/auth.e2e-spec.ts \
  test/e2e/bootstrap.e2e-spec.ts
git commit -m "feat: require admin key and bootstrap one on first run"
```

---

### Task 4: Account PATCH, overview fields, selection filter

**Files:**
- Create: `src/modules/cloud-account/account-update.ts`
- Create: `src/modules/cloud-account/account-update.spec.ts`
- Modify: `src/modules/cloud-account/controllers/account-management.controller.ts`
- Modify: `src/modules/proxy-gateway/server/modules/account-lease/account-lease.service.ts:381-401`
- Modify: `src/modules/cloud-account/controllers/system-status.controller.ts:20`
- Modify: `test/e2e/internal-api.e2e-spec.ts` (create if missing)

**Interfaces:**
- Produces: `parseAccountUpdateInput(body: unknown): { name?: string | null; is_active?: boolean }`.
- Produces: `PATCH /internal/accounts/:id` → `{ success: true, data: { id, email, name, is_active, ... } }`; 400 field lạ; 404 id không tồn tại.
- `getAccountsOverview()` thêm `name` và `is_active: account.is_active !== false`.

- [ ] **Step 1: Write the failing parser tests**

Create `src/modules/cloud-account/account-update.spec.ts`:
```ts
import { BadRequestException } from '@nestjs/common';
import { parseAccountUpdateInput } from './account-update';

describe('parseAccountUpdateInput', () => {
  it('trims a non-empty name and maps empty name to null', () => {
    expect(parseAccountUpdateInput({ name: '  Main  ' })).toEqual({ name: 'Main' });
    expect(parseAccountUpdateInput({ name: '   ' })).toEqual({ name: null });
  });

  it('accepts a boolean is_active', () => {
    expect(parseAccountUpdateInput({ is_active: false })).toEqual({ is_active: false });
  });

  it('rejects unknown fields', () => {
    expect(() => parseAccountUpdateInput({ email: 'x@y.z' })).toThrow(BadRequestException);
    expect(() => parseAccountUpdateInput({ name: 'x', provider: 'openai' })).toThrow(BadRequestException);
  });

  it('rejects wrong types and an empty body', () => {
    expect(() => parseAccountUpdateInput({ is_active: 'no' })).toThrow(BadRequestException);
    expect(() => parseAccountUpdateInput({})).toThrow(BadRequestException);
    expect(() => parseAccountUpdateInput(null)).toThrow(BadRequestException);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm run test:unit -- src/modules/cloud-account/account-update.spec.ts`
Expected: FAIL — module chưa tồn tại.

- [ ] **Step 3: Implement the parser**

Create `account-update.ts` with the exported function. Validation rules: body must be a non-null object; keys subset of `name`/`is_active`; at least one key; `name` string ≤ 255; `is_active` boolean; otherwise `BadRequestException` with a message naming the offending field.

- [ ] **Step 4: Run the parser tests**

Run: `npm run test:unit -- src/modules/cloud-account/account-update.spec.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Add the failing E2E test**

Create `test/e2e/internal-api.e2e-spec.ts` with `startTestServer`, then:
```ts
it('updates the display name', async () => {
  const created = await apiFetch(server.baseUrl, '/internal/accounts', {
    token: server.adminKey,
    body: { provider: 'google', email: 'patch-me@test.local' },
  });
  const res = await apiFetch(server.baseUrl, `/internal/accounts/${created.body.data.id}`, {
    method: 'PATCH',
    token: server.adminKey,
    body: { name: 'Renamed' },
  });
  expect(res.status).toBe(200);
  expect(res.body.data.name).toBe('Renamed');
  expect(res.body.data.is_active).toBe(true);
});

it('rejects unknown fields and unknown ids', async () => {
  const bad = await apiFetch(server.baseUrl, '/internal/accounts/00000000-0000-4000-8000-000000000000', {
    method: 'PATCH',
    token: server.adminKey,
    body: { email: 'nope@test.local' },
  });
  expect(bad.status).toBe(400);
  const missing = await apiFetch(server.baseUrl, '/internal/accounts/11111111-1111-4111-8111-111111111111', {
    method: 'PATCH',
    token: server.adminKey,
    body: { name: 'x' },
  });
  expect(missing.status).toBe(404);
});

it('does not select a disabled account for model requests', async () => {
  await apiFetch(server.baseUrl, '/internal/accounts', {
    token: server.adminKey,
    body: { provider: 'google', email: 'only@test.local' },
  });
  const list = await apiFetch(server.baseUrl, '/internal/accounts', { token: server.adminKey });
  for (const account of list.body.data) {
    await apiFetch(server.baseUrl, `/internal/accounts/${account.id}`, {
      method: 'PATCH',
      token: server.adminKey,
      body: { is_active: false },
    });
  }
  const res = await apiFetch(server.baseUrl, '/v1/chat/completions', {
    token: server.clientKey,
    body: { model: 'gemini-2.5-pro', messages: [{ role: 'user', content: 'hi' }] },
  });
  expect(res.status).toBe(503);
});
```

- [ ] **Step 6: Run and confirm the E2E test fails**

Run: `npm run test:e2e -- test/e2e/internal-api.e2e-spec.ts`
Expected: FAIL — PATCH trả 404.

- [ ] **Step 7: Implement the endpoint and overview fields**

In `AccountManagementController`, add `@Patch(':id')` with `@UseGuards(AdminGuard)` inherited:
- parse with `parseAccountUpdateInput(body)`;
- `const existing = await jsonAccountStoreInstance.getAccount(id)`; if missing throw `NotFoundException('Account not found')`;
- `await jsonAccountStoreInstance.upsertAccount({ ...existing, ...parsed })`;
- `await this.accountLeaseService.loadAccounts()`;
- return `{ success: true, data: (await this.accountLeaseService.getAccountsOverview()).find(a => a.id === id) }`.

In `getAccountsOverview()` add:
```ts
name: account.name ?? null,
is_active: account.is_active !== false,
```
In `system-status.controller.ts` filter active accounts with `a.is_active !== false && a.is_healthy && !a.is_cooldown`.

Also add `acc.is_active !== false` to the non-Google filter in `refreshDiscoveredProviderModels` (`account-lease.service.ts:918`).

- [ ] **Step 8: Run the E2E suite**

Run: `npm run test:e2e -- test/e2e/internal-api.e2e-spec.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/modules/cloud-account/account-update.ts src/modules/cloud-account/account-update.spec.ts \
  src/modules/cloud-account/controllers/account-management.controller.ts \
  src/modules/cloud-account/controllers/system-status.controller.ts \
  src/modules/proxy-gateway/server/modules/account-lease/account-lease.service.ts \
  test/e2e/internal-api.e2e-spec.ts
git commit -m "feat: add account patch and honor disabled accounts"
```

---

### Task 5: Audit `apiKeyId` / time filters

**Files:**
- Modify: `src/modules/proxy-gateway/audit/traffic-audit.types.ts:164-181`
- Modify: `src/modules/proxy-gateway/audit/traffic-audit.service.ts:233-270`
- Modify: `test/e2e/internal-api.e2e-spec.ts`

**Interfaces:**
- `TrafficAuditListInputSchema` thêm `apiKeyId: z.string().uuid().optional()`.
- `GET /internal/audit/requests?apiKeyId=&from=&to=` lọc server-side; `apiKeyId` sai định dạng → 400; `from > to` → `{ data: [], total: 0 }`.

- [ ] **Step 1: Write the failing E2E tests**

Add to `internal-api.e2e-spec.ts`, dùng `insertTrafficLogs` với 2 row:
- row A: `timestamp: 1790812800000` (`2026-10-01T00:00:00Z`), `apiKeyId: '11111111-1111-4111-8111-111111111111'`, `id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'`
- row B: `timestamp: 1790816400000` (`2026-10-01T01:00:00Z`), `apiKeyId: '22222222-2222-4222-8222-222222222222'`, `id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'`

```ts
it('filters audit rows by api key and time range', async () => {
  const byKey = await apiFetch(server.baseUrl, '/internal/audit/requests?apiKeyId=22222222-2222-4222-8222-222222222222', { token: server.adminKey });
  expect(byKey.status).toBe(200);
  expect(byKey.body.data.map((r: any) => r.requestId)).toEqual(['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']);

  const byTime = await apiFetch(server.baseUrl, '/internal/audit/requests?from=1790812800000&to=1790812800000', { token: server.adminKey });
  expect(byTime.body.data.map((r: any) => r.requestId)).toEqual(['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']);
});

it('returns empty for an inverted range and rejects a malformed key id', async () => {
  const inverted = await apiFetch(server.baseUrl, '/internal/audit/requests?from=1790816400000&to=1790812800000', { token: server.adminKey });
  expect(inverted.status).toBe(200);
  expect(inverted.body.data).toEqual([]);

  const malformed = await apiFetch(server.baseUrl, '/internal/audit/requests?apiKeyId=not-a-uuid', { token: server.adminKey });
  expect(malformed.status).toBe(400);
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npm run test:e2e -- test/e2e/internal-api.e2e-spec.ts`
Expected: FAIL — filters ignored, malformed id trả 200.

- [ ] **Step 3: Implement the filter**

Add the schema field. In `traffic-audit.service.ts#list`, after the `gqlExclude` where, add:
```ts
if (input?.from !== undefined) qb.andWhere('log.timestamp >= :from', { from: input.from });
if (input?.to !== undefined) qb.andWhere('log.timestamp <= :to', { to: input.to });
if (input?.apiKeyId) qb.andWhere('log.apiKeyId = :apiKeyId', { apiKeyId: input.apiKeyId });
```
`AuditListQuerySchema` already extends `from`/`to`, and the controller parses with zod, so the malformed UUID becomes 400 automatically.

- [ ] **Step 4: Run the E2E suite**

Run: `npm run test:e2e -- test/e2e/internal-api.e2e-spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/proxy-gateway/audit/traffic-audit.types.ts \
  src/modules/proxy-gateway/audit/traffic-audit.service.ts test/e2e/internal-api.e2e-spec.ts
git commit -m "feat: filter audit log by api key and time range"
```

---

### Task 6: Playwright foundation + seeded server

**Files:**
- Modify: `package.json`
- Modify: `.gitignore`
- Create: `playwright.config.ts`
- Create: `test/playwright/seed-data.ts`
- Create: `test/playwright/seed.ts`
- Create: `test/playwright/fixtures.ts`
- Create: `test/playwright/global-teardown.ts`
- Create: `test/playwright/smoke.spec.ts`

**Interfaces:**
- Produces in `test/playwright/seed-data.ts`: `PW_ADMIN_KEY`, `PW_CLIENT_KEY`, `PW_ADMIN_KEY_ID`, `PW_CLIENT_KEY_ID`, `T0 = 1790812800000` (`2026-10-01T00:00:00Z`).
- Produces: `npm run test:playwright`, `test:playwright:ui`, `test:playwright:headed`, `test:playwright:debug`, `test:playwright:server`.
- `webServer` luôn khởi động server tạm; `reuseExistingServer: false`.

- [ ] **Step 1: Install Playwright and write the failing smoke test**

Run:
```bash
npm i -D @playwright/test@^1.55.0
npx playwright install chromium
```

Create `test/playwright/smoke.spec.ts`:
```ts
import { expect, test } from '@playwright/test';

test('serves the app shell', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle(/LLM Gateway/i);
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx playwright test test/playwright/smoke.spec.ts`
Expected: FAIL — chưa có `playwright.config.ts`.

- [ ] **Step 3: Create the seed script**

`test/playwright/seed-data.ts`:
```ts
export const PW_ADMIN_KEY = `sk-ag-${'a'.repeat(48)}`;
export const PW_CLIENT_KEY = `sk-ag-${'b'.repeat(48)}`;
export const PW_ADMIN_KEY_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
export const PW_CLIENT_KEY_ID = 'bbbbbbbb-2222-4222-8222-222222222222';
export const T0 = 1790812800000; // 2026-10-01T00:00:00Z
```

`test/playwright/seed.ts` (script, top-level side effects; **không được import từ spec**):
- import constants từ `./seed-data`.
- xoá và tạo lại thư mục `DATA_DIR` trước khi ghi (server chưa boot ở bước này).
- `getStandaloneDataSource()` → save 2 `ApiKey` rows (admin/client, fixed ids).
- seed 3 `TrafficLog` rows at `T0`, `T0 + 3600_000`, `T0 + 7200_000` with statuses 200/429/500 and `apiKeyId` admin/client/null.
- write `process.env.ACCOUNTS_FILE` with:
  ```json
  [
    {"id":"acc-active","provider":"google","email":"active@test.local","name":"Active account","created_at":1790812800000,"last_used":1790812800000,"is_active":true},
    {"id":"acc-disabled","provider":"google","email":"disabled@test.local","name":"Disabled account","created_at":1790812800000,"last_used":1790812800000,"is_active":false},
    {"id":"acc-spare","provider":"google","email":"spare@test.local","name":"Spare account","created_at":1790812800000,"last_used":1790812800000,"is_active":true}
  ]
  ```
- write `process.env.ROUTING_CONFIG_PATH` with the three default rules from `routing.json.example` and `default_pipeline: ['google']`.
- `await ds.destroy()`. Không seed account có token để tránh quota sync gọi Google.

Add script:
```json
"test:playwright:server": "npm run build:all && tsx test/playwright/seed.ts && node dist/main.js"
```

- [ ] **Step 4: Create the Playwright config**

`playwright.config.ts`:
- dùng thư mục cố định `runDir = path.join(process.cwd(), 'test/.tmp/pw')`; `fs.mkdirSync(runDir, { recursive: true })` (không xoá ở đây — seed script xoá trước khi ghi, tránh worker xoá nhầm khi server đang chạy).
- `testDir: './test/playwright'`, `fullyParallel: false`, `workers: 1`, `retries: process.env.CI ? 1 : 0`.
- `globalTeardown: './test/playwright/global-teardown.ts'`.
- `use: { baseURL: 'http://127.0.0.1:8046', trace: 'on-first-retry', video: 'retain-on-failure' }`.
- `reporter: [['list'], ['html', { open: 'never' }]]`.
- `webServer: { command: 'npm run test:playwright:server', url: 'http://127.0.0.1:8046/', reuseExistingServer: false, timeout: 180000, env: { PORT: '8046', HOST: '127.0.0.1', NODE_ENV: 'production', SQLITE_DB_PATH: path.join(runDir, 'test.sqlite'), ACCOUNTS_FILE: path.join(runDir, 'accounts.json'), ROUTING_CONFIG_PATH: path.join(runDir, 'routing.json'), DATA_DIR: runDir } }`.

`test/playwright/global-teardown.ts` xoá `path.join(process.cwd(), 'test/.tmp/pw')` bằng `fs.rmSync(dir, { recursive: true, force: true })`.

- [ ] **Step 5: Add fixture helper**

`test/playwright/fixtures.ts`:
```ts
import { test as base } from '@playwright/test';
import { PW_ADMIN_KEY, PW_CLIENT_KEY } from './seed-data';

export { expect } from '@playwright/test';

export const test = base.extend<{ adminKey: string; clientKey: string }>({
  adminKey: async ({}, use) => use(PW_ADMIN_KEY),
  clientKey: async ({}, use) => use(PW_CLIENT_KEY),
});

export async function loginAsAdmin(page, key = PW_ADMIN_KEY) {
  await page.addInitScript(
    ([k]) => window.sessionStorage.setItem('antigravity_admin_key', k),
    [key],
  );
  await page.goto('/');
}
```
Lưu ý: `LoginView` chưa được nối nên smoke test chỉ kiểm tra shell; Task 7 sẽ dùng `loginAsAdmin`.

- [ ] **Step 6: Add scripts and ignore artifacts**

Add:
```json
"test:playwright": "playwright test",
"test:playwright:ui": "playwright test --ui",
"test:playwright:headed": "playwright test --headed",
"test:playwright:debug": "playwright test --debug",
"test:all": "npm run test:unit && npm run test:e2e && npm run test:playwright"
```
Task 15 sẽ đổi `test:all` sang `npm test && npm run test:playwright` sau khi `npm test` tồn tại.

`.gitignore` thêm `playwright-report/`, `test-results/`, `test/.tmp/`.

- [ ] **Step 7: Run the smoke test**

Run: `npm run test:playwright -- test/playwright/smoke.spec.ts`
Expected: PASS. Server build + seed + boot thành công; không có file mới trong repo ngoài `playwright-report/` (ignored).

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json .gitignore playwright.config.ts test/playwright/
git commit -m "test: add playwright foundation with isolated seeded server"
```

---

### Task 7: Login gate, logout, 401 handling

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/views/LoginView.tsx`
- Modify: `web/src/components/Header.tsx`
- Modify: `web/src/api/client.ts`
- Modify: `web/src/types/index.ts`
- Modify: `web/src/i18n/types.ts`
- Modify: `web/src/i18n/locales/en.ts`
- Modify: `web/src/i18n/locales/vi.ts`
- Create: `test/playwright/auth.spec.ts`

**Interfaces:**
- `AUTH_UNAUTHORIZED_EVENT = 'admin-unauthorized'` exported from `client.ts`; `fetchJson` dispatch event khi `res.status === 401`.
- `App` giữ `authState: 'checking' | 'anon' | 'authed'`; chỉ render dashboard khi `authed`.
- `Header` nhận thêm `onLogout: () => void`.
- Login chấp nhận key khi `validateKey` trả `valid: true` **và** `role === 'admin'`; nếu không hiện `login.errorNotAdmin`.
- Test ids: `login-key-input`, `login-submit`, `login-error`, `logout-button`.

- [ ] **Step 1: Write the failing Playwright auth spec**

Create `test/playwright/auth.spec.ts`:
```ts
import { expect, test } from './fixtures';
import { PW_ADMIN_KEY, PW_CLIENT_KEY } from './seed-data';

test('shows the login screen when no key is stored', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('login-key-input')).toBeVisible();
});

test('rejects empty, wrong, and client-role keys', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('login-error')).toBeVisible();

  await page.getByTestId('login-key-input').fill('sk-ag-not-a-real-key');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('login-error')).toContainText(/invalid/i);

  await page.getByTestId('login-key-input').fill(PW_CLIENT_KEY);
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('login-error')).toContainText(/admin/i);
});

test('logs in with an admin key, survives reload, and logs out', async ({ page, adminKey }) => {
  await page.goto('/');
  await page.getByTestId('login-key-input').fill(adminKey);
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('logout-button')).toBeVisible();

  await page.reload();
  await expect(page.getByTestId('logout-button')).toBeVisible();

  await page.getByTestId('logout-button').click();
  await expect(page.getByTestId('login-key-input')).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('antigravity_admin_key'))).toBeNull();
});

test('drops an invalid stored key back to login', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('antigravity_admin_key', 'sk-ag-stale'));
  await page.goto('/');
  await expect(page.getByTestId('login-key-input')).toBeVisible();
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npm run test:playwright -- test/playwright/auth.spec.ts`
Expected: FAIL — không có login gate/test ids.

- [ ] **Step 3: Add test ids and admin-role check to LoginView**

- `input` → `data-testid="login-key-input"`.
- submit button → `data-testid="login-submit"`.
- error box → `data-testid="login-error"`.
- After `api.validateKey(trimmed)`, require `res.valid && res.role === 'admin'`; otherwise `setError(res.error || t('login.errorNotAdmin'))`. `AuthValidateResult.role` đã có sẵn trong `web/src/types/index.ts`, không cần đổi backend.

- [ ] **Step 4: Gate App and wire logout**

- Initialize `const [authState, setAuthState] = useState<'checking'|'anon'|'authed'>(() => (getAdminKey() ? 'checking' : 'anon'))`.
- On mount when `authState === 'checking'`: validate stored key; valid admin → `authed`; else `clearAdminKey()` + `anon`.
- Listen for `AUTH_UNAUTHORIZED_EVENT` on window → `clearAdminKey()` + `setAuthState('anon')`.
- Chỉ gọi `loadData()` và bật polling 10s khi `authState === 'authed'`; khi `anon`/`checking` không gọi API.
- Render `<LoginView onAuthed={(key) => { setAdminKey(key); setAuthState('authed'); }} />` when `anon`; render a minimal loading block when `checking`; render existing layout when `authed`.
- `Header` gets `onLogout`; add button `data-testid="logout-button"` with `LogOut` icon and `t('common.logout')`.
- Logout handler clears key, resets `activeTab`, sets `anon`.

- [ ] **Step 5: Dispatch 401 events in the API client**

In `fetchJson` and `graphqlRequest`, before throwing on `!res.ok`, if `res.status === 401` dispatch `new Event(AUTH_UNAUTHORIZED_EVENT)`. Export the constant.

- [ ] **Step 6: Add i18n keys**

Add `login.errorNotAdmin`, `login.checking` (hoặc dùng `common.loadingGateway`) to types/en/vi. `common.logout` đã có.

- [ ] **Step 7: Run auth spec and unit tests**

Run:
```bash
npm run test:playwright -- test/playwright/auth.spec.ts
npm run test:unit
```
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add web/src/App.tsx web/src/views/LoginView.tsx web/src/components/Header.tsx \
  web/src/api/client.ts web/src/types/index.ts web/src/i18n test/playwright/auth.spec.ts
git commit -m "feat: gate dashboard behind admin login"
```

---

### Task 8: Accounts UI — search, filter, rename, disable

**Files:**
- Modify: `web/src/views/AccountsView.tsx`
- Modify: `web/src/api/client.ts`
- Modify: `web/src/types/index.ts`
- Modify: `web/src/i18n/types.ts`
- Modify: `web/src/i18n/locales/en.ts`
- Modify: `web/src/i18n/locales/vi.ts`
- Create: `test/playwright/accounts.spec.ts`

**Interfaces:**
- `Account` thêm `name?: string | null`, `is_active?: boolean`.
- `api.updateAccount(id: string, patch: { name?: string | null; is_active?: boolean })` → `fetchJson<{ success: true; data: Account }>` với `PATCH`.
- Test ids: `accounts-search`, `accounts-provider-filter`, `accounts-status-filter`, `account-row` (kèm `data-account-id`), `account-name`, `account-edit-name`, `account-save-name`, `account-toggle-active`, `account-disabled-badge`, `account-delete`.

- [ ] **Step 1: Write the failing Playwright spec**

Create `test/playwright/accounts.spec.ts`:
```ts
import { expect, test, loginAsAdmin } from './fixtures';

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByRole('button', { name: /accounts|tài khoản/i }).click();
});

test('searches and filters seeded accounts', async ({ page }) => {
  await expect(page.getByTestId('account-row')).toHaveCount(3);

  await page.getByTestId('accounts-search').fill('disabled');
  await expect(page.getByTestId('account-row')).toHaveCount(1);
  await expect(page.getByTestId('account-disabled-badge')).toBeVisible();

  await page.getByTestId('accounts-search').fill('');
  await page.getByTestId('accounts-status-filter').selectOption('disabled');
  await expect(page.getByTestId('account-row')).toHaveCount(1);
});

test('renames an account and persists after reload', async ({ page }) => {
  await page.getByTestId('account-edit-name').first().click();
  await page.getByTestId('account-name-input').fill('Renamed in test');
  await page.getByTestId('account-save-name').click();
  await expect(page.getByTestId('account-name').first()).toContainText('Renamed in test');

  await page.reload();
  await page.getByRole('button', { name: /accounts|tài khoản/i }).click();
  await expect(page.getByTestId('account-name').first()).toContainText('Renamed in test');
});

test('disables and re-enables an account', async ({ page }) => {
  const row = page.getByTestId('account-row').filter({ hasText: 'active@test.local' });
  await row.getByTestId('account-toggle-active').click();
  await page.getByRole('button', { name: /confirm|xác nhận/i }).click();
  await expect(row.getByTestId('account-disabled-badge')).toBeVisible();

  await row.getByTestId('account-toggle-active').click();
  await page.getByRole('button', { name: /confirm|xác nhận/i }).click();
  await expect(row.getByTestId('account-disabled-badge')).toHaveCount(0);
});

test('deletes a disposable account', async ({ page, request, adminKey }) => {
  const created = await request.post('/internal/accounts', {
    headers: { Authorization: `Bearer ${adminKey}` },
    data: { provider: 'google', email: 'delete-me@test.local' },
  });
  expect(created.ok()).toBeTruthy();

  await page.reload();
  await page.getByRole('button', { name: /accounts|tài khoản/i }).click();
  const row = page.getByTestId('account-row').filter({ hasText: 'delete-me@test.local' });
  await expect(row).toHaveCount(1);
  await row.getByTestId('account-delete').click();
  await page.getByRole('button', { name: /confirm|xác nhận|delete|xoá/i }).click();
  await expect(page.getByTestId('account-row').filter({ hasText: 'delete-me@test.local' })).toHaveCount(0);
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npm run test:playwright -- test/playwright/accounts.spec.ts`
Expected: FAIL — test ids chưa có.

- [ ] **Step 3: Add API client, types, and i18n**

- `api.updateAccount` with `method: 'PATCH'`.
- Account fields.
- i18n mới: `accounts.searchPlaceholder`, `accounts.filterProvider`, `accounts.filterStatus`, `accounts.allProviders`, `accounts.allStatuses`, `accounts.editName`, `accounts.saveName`, `accounts.disable`, `accounts.enable`, `accounts.confirmDisable`, `accounts.nameLabel`.

- [ ] **Step 4: Implement the UI**

In `AccountsView`:
- derive `filteredAccounts` from `accounts` theo search (email/name/id, case-insensitive), provider, status (`all`/`active`/`disabled`).
- render filter bar (search input + 2 selects) trước danh sách.
- map `filteredAccounts` thay vì `accounts`.
- mỗi row có `data-testid="account-row"` + `data-account-id`.
- hiện `account.name` cạnh email với `data-testid="account-name"` (fallback email).
- nút edit mở inline input `account-name-input` + save `account-save-name`, gọi `api.updateAccount`, `onReload()`.
- nút toggle `account-toggle-active` gọi `toast.confirm(t('accounts.confirmDisable'))` rồi `api.updateAccount(id, { is_active: !account.is_active })`, `onReload()`.
- nút xoá hiện có thêm `data-testid="account-delete"`.
- badge `account-disabled-badge` khi `account.is_active === false`.

- [ ] **Step 5: Run the accounts spec**

Run: `npm run test:playwright -- test/playwright/accounts.spec.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add web/src/views/AccountsView.tsx web/src/api/client.ts web/src/types/index.ts \
  web/src/i18n test/playwright/accounts.spec.ts
git commit -m "feat: add account search, rename, and disable controls"
```

---

### Task 9: Audit UI — time and API key filters

**Files:**
- Modify: `web/src/views/AuditLogsView.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/api/client.ts`
- Modify: `web/src/types/index.ts`
- Modify: `web/src/i18n/types.ts`
- Modify: `web/src/i18n/locales/en.ts`
- Modify: `web/src/i18n/locales/vi.ts`
- Create: `test/playwright/analytics-audit.spec.ts`

**Interfaces:**
- `api.getAuditRequests(params?: { from?: number; to?: number; apiKeyId?: string; limit?: number })` → query string.
- `AuditLogsView` tự fetch khi filter đổi; bỏ prop `logs` khỏi `App`.
- Test ids: `audit-from`, `audit-to`, `audit-apikey-filter`, `audit-clear-filters`, `audit-row`.

- [ ] **Step 1: Write the failing Playwright spec**

Create `test/playwright/analytics-audit.spec.ts` (chỉ phần audit; analytics thêm ở Task 14):
```ts
import { expect, test, loginAsAdmin } from './fixtures';
import { PW_CLIENT_KEY_ID } from './seed-data';

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByRole('button', { name: /traffic|nhật ký|logs/i }).click();
});

test('filters audit rows by time range', async ({ page }) => {
  await expect(page.getByTestId('audit-row')).toHaveCount(3);

  await page.getByTestId('audit-from').fill('2026-10-01T00:30');
  await page.getByTestId('audit-to').fill('2026-10-01T02:30');
  await expect(page.getByTestId('audit-row')).toHaveCount(2);
});

test('filters audit rows by api key and clears filters', async ({ page }) => {
  await page.getByTestId('audit-apikey-filter').selectOption(PW_CLIENT_KEY_ID);
  await expect(page.getByTestId('audit-row')).toHaveCount(1);
  await expect(page.getByTestId('audit-row')).toContainText('429');

  await page.getByTestId('audit-clear-filters').click();
  await expect(page.getByTestId('audit-row')).toHaveCount(3);
});
```
Ghi chú: `T0 = 1790812800000` là `2026-10-01T00:00:00Z`; sau filter `00:30–02:30`, còn row lúc 01:00 và 02:00.

- [ ] **Step 2: Run and confirm it fails**

Run: `npm run test:playwright -- test/playwright/analytics-audit.spec.ts`
Expected: FAIL — chưa có filter controls.

- [ ] **Step 3: Extend the client and types**

`getAuditRequests(params)` builds `URLSearchParams` only with defined values; keep the existing no-arg call working. `AuditRecord` đã có `apiKeyId` và `status`.

- [ ] **Step 4: Implement filter state in AuditLogsView**

- state: `from`, `to` (datetime-local strings), `apiKeyId`, `logs`, `apiKeys`, `loading`.
- `useEffect` on `[from, to, apiKeyId]` → `api.getAuditRequests({...})` → `setLogs`.
- load API keys once via `api.getApiKeys()` for the select.
- convert `datetime-local` via `new Date(value).getTime()`; bỏ qua giá trị rỗng.
- render inputs/select/clear button với test ids.
- giữ filter model/status phía client.
- `App` bỏ prop `logs`; vẫn gọi `api.getAuditRequests()` cho polling tổng? Không cần — bỏ khỏi `loadData` nếu không dùng nơi khác, hoặc giữ và bỏ truyền xuống. Chọn: bỏ `auditRes` khỏi `loadData`.

- [ ] **Step 5: Run the audit spec**

Run: `npm run test:playwright -- test/playwright/analytics-audit.spec.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add web/src/views/AuditLogsView.tsx web/src/App.tsx web/src/api/client.ts \
  web/src/types/index.ts web/src/i18n test/playwright/analytics-audit.spec.ts
git commit -m "feat: add audit time and api key filters"
```

---

### Task 10: Unit suite — shared utilities

**Files:**
- Create: `src/shared/security/sensitiveDataMasking.spec.ts`
- Create: `src/shared/utils/url.spec.ts`
- Create: `src/shared/persistence/atomic-json-file.spec.ts`
- Create: `src/shared/errors/error-guards.spec.ts`
- Create: `src/shared/errors/appError.spec.ts`
- Create: `web/src/lib/reorder.spec.ts`
- Create: `web/src/lib/exportCsv.spec.ts`
- Create: `web/src/lib/i18n-parity.spec.ts`

**Interfaces:**
- Consumes Task 1 runner. Không tạo abstraction mới; test public exports hiện có.

- [ ] **Step 1: Read each module's exported API**

Run: `grep -n "^export" src/shared/security/sensitiveDataMasking.ts src/shared/utils/url.ts src/shared/persistence/atomic-json-file.ts src/shared/errors/error-guards.ts src/shared/errors/appError.ts`

- [ ] **Step 2: Write the specs**

Cases bắt buộc:
- masking: object lồng nhau có `authorization`, `password`, `access_token` bị thay bằng giá trị che; field thường giữ nguyên; array giữ độ dài.
- url: `isValidProxyUrl` chấp nhận `http://`/`https://`, từ chối `file:`, `ftp:`, chuỗi rỗng và URL thiếu host.
- atomic-json-file: ghi rồi đọc lại đúng object; ghi đè file cũ; file chứa JSON hỏng trả fallback/throw đúng như implementation hiện tại (đọc code trước khi assert).
- error-guards: `Error` → message giữ nguyên; object lạ → chuỗi an toàn; null/undefined không ném.
- appError: `toAppError` (hoặc export tương đương) giữ status/code và message.
- `reorderByIndex`: move hợp lệ giữ nguyên các phần tử khác; from/to ngoài range hoặc bằng nhau trả copy không đổi.
- `exportTokenAnalyticsCsv`: có header, đủ section, số dòng timeSeries/byModel/byApiKey khớp input; giá trị cost format 4 chữ số thập phân.
- i18n parity: flatten key của `en` và `vi`, assert hai tập key bằng nhau (import `web/src/i18n/locales/en` + `vi`).

- [ ] **Step 3: Run and fix only real defects**

Run: `npm run test:unit -- src/shared web/src/lib`
Expected: PASS. Nếu fail vì hành vi hiện tại khác test, sửa test theo hành vi đúng đã đọc trong code; chỉ sửa source khi hành vi là bug rõ ràng.

- [ ] **Step 4: Commit**

```bash
git add src/shared web/src/lib
git commit -m "test: cover shared utilities and persistence"
```

---

### Task 11: Unit suite — routing, rate limit, retry

**Files:**
- Create: `src/modules/proxy-gateway/routing/rule-based-router.service.spec.ts`
- Create: `src/modules/proxy-gateway/server/shared/services/rate-limit-tracker.service.spec.ts`
- Create: `src/modules/proxy-gateway/server/shared/services/proxy-retry.service.spec.ts`
- Create: `src/modules/proxy-gateway/server/shared/services/model-routing.service.spec.ts`

**Interfaces:**
- Consumes public methods của từng service; constructor nhận config/path như code hiện tại.

- [ ] **Step 1: Write the failing specs**

Cases bắt buộc:
- rule-based-router: đọc config từ temp file; model khớp regex đầu tiên → đúng pipeline; không khớp → `default_pipeline`; file thiếu → fallback mặc định không ném.
- rate-limit-tracker: set lockout tương lai → `isRateLimited(id) === true`; hết hạn → false; `getRemainingWaitSec` giảm theo thời gian (dùng fake timers).
- proxy-retry: 429/5xx được đánh dấu retryable; 400/401 không; số attempt không vượt giới hạn.
- model-routing: alias/model variant resolve đúng; model lạ giữ nguyên hoặc trả null theo implementation.

- [ ] **Step 2: Run and confirm**

Run: `npm run test:unit -- src/modules/proxy-gateway/routing src/modules/proxy-gateway/server/shared/services`
Expected: PASS sau khi đọc signature thật và viết đúng.

- [ ] **Step 3: Commit**

```bash
git add src/modules/proxy-gateway/routing src/modules/proxy-gateway/server/shared/services
git commit -m "test: cover routing, rate limit, and retry policies"
```

---

### Task 12: Unit suite — protocol mappers and error envelopes

**Files:**
- Create: `src/modules/proxy-gateway/antigravity/ClaudeRequestMapper.spec.ts`
- Create: `src/modules/proxy-gateway/antigravity/OpenAIUsageMapper.spec.ts`
- Create: `src/modules/proxy-gateway/antigravity/ModelMapping.spec.ts`
- Create: `src/modules/proxy-gateway/antigravity/GeminiFinishReason.spec.ts`
- Create: `src/modules/proxy-gateway/server/common/google-error-details.spec.ts`
- Create: `src/modules/proxy-gateway/server/common/auth-error-envelope.spec.ts`

**Interfaces:**
- Consumes `transformClaudeRequestIn`, `toOpenAIUsage`, `toOpenAIUsageFromGeminiUsageMetadata`, mapping functions, `google-error-details`, envelope builder.

- [ ] **Step 1: Write the specs**

Cases bắt buộc:
- Claude request: system prompt + messages + tools giữ đúng thứ tự; `max_tokens` map sang `maxOutputTokens`; ảnh base64 giữ mime type.
- Usage: usage thiếu field → 0, không NaN; Gemini metadata map đúng prompt/candidate tokens; response usage map đúng tổng.
- ModelMapping: alias đã biết map đúng; model không biết giữ nguyên.
- FinishReason: `STOP` → `end_turn`, `MAX_TOKENS` → `max_tokens`, giá trị lạ → `end_turn`.
- google-error-details: 403 validation → nhận diện validation; 429 → rate limit; lỗi khác → unknown.
- auth-error-envelope: status 401 + message giữ nguyên shape.

- [ ] **Step 2: Run and align with real signatures**

Run: `npm run test:unit -- src/modules/proxy-gateway/antigravity src/modules/proxy-gateway/server/common`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/modules/proxy-gateway/antigravity src/modules/proxy-gateway/server/common
git commit -m "test: cover protocol mappers and error envelopes"
```

---

### Task 13: E2E API — proxy, graphql, persistence

**Files:**
- Create: `test/e2e/proxy-openai.e2e-spec.ts`
- Create: `test/e2e/proxy-anthropic.e2e-spec.ts`
- Create: `test/e2e/proxy-gemini.e2e-spec.ts`
- Create: `test/e2e/proxy-errors.e2e-spec.ts`
- Create: `test/e2e/graphql.e2e-spec.ts`
- Create: `test/e2e/persistence.e2e-spec.ts`

**Interfaces:**
- Consumes Task 2 helpers + `nock`.
- Upstream hosts: `https://api.openai.com`, `https://api.anthropic.com`, `https://generativelanguage.googleapis.com`, `https://cloudcode-pa.googleapis.com`.
- Seed account qua `startTestServer({ accounts })` **trước khi boot**, để `accountLeaseService` nạp được token ngay. `nock.disableNetConnect()` phải chạy trước `startTestServer` để chặn quota sync lúc boot.

- [ ] **Step 1: Write proxy specs**

Mỗi file `beforeAll`: `nock.disableNetConnect()`, `startTestServer({ accounts: [...] })`. Account fixtures:
```ts
const openaiAccount = {
  id: 'acc-openai', provider: 'openai', auth_type: 'api_key',
  email: 'oa@test.local', api_key: 'sk-test-openai',
  created_at: 1790812800000, last_used: 1790812800000,
};
const anthropicAccount = {
  id: 'acc-anthropic', provider: 'anthropic', auth_type: 'api_key',
  email: 'an@test.local', api_key: 'sk-test-anthropic',
  created_at: 1790812800000, last_used: 1790812800000,
};
const googleAccount = {
  id: 'acc-google', provider: 'google', auth_type: 'oauth',
  email: 'g@test.local', project_id: 'test-project',
  token: {
    access_token: 'test-google-token', refresh_token: 'test-refresh',
    expires_in: 3600, expiry_timestamp: 4102444800, token_type: 'Bearer',
    project_id: 'test-project',
  },
  created_at: 1790812800000, last_used: 1790812800000,
};
```
Cases:
- OpenAI: `POST /v1/chat/completions` với `Authorization: Bearer <clientKey>`, nock `POST https://api.openai.com/v1/chat/completions` → 200 `{id,object,choices:[{message:{role:'assistant',content:'hi'}}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}`; expect 200 và `body.choices[0].message.content === 'hi'`.
- Anthropic: `POST /v1/messages` với `{model:'claude-sonnet-4',max_tokens:8,messages:[{role:'user',content:'hi'}]}`, header `x-api-key: <clientKey>`; nock `POST https://api.anthropic.com/v1/messages` → 200 `{id:'msg_1',type:'message',role:'assistant',content:[{type:'text',text:'hi'}],model:'claude-sonnet-4',stop_reason:'end_turn',usage:{input_tokens:1,output_tokens:1}}`; expect 200 và text.
- Gemini: `POST /v1beta/models/gemini-2.5-flash:generateContent` với client key; account google ở trên. Nock **cả hai** host có thể được gọi: `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent` và `POST https://cloudcode-pa.googleapis.com/v1internal:generateContent`, cùng trả `{candidates:[{content:{parts:[{text:'hi'}],role:'model'},finishReason:'STOP'}],usageMetadata:{promptTokenCount:1,candidatesTokenCount:1,totalTokenCount:2}}`; expect 200 và text.
- SSE: cùng route với `stream: true`; nock reply `text/event-stream` gồm 2 chunk `data: {...}` và `data: [DONE]\n\n`; assert body chứa `[DONE]` và đúng thứ tự.

- [ ] **Step 2: Write error, graphql, persistence specs**

- 401 không key cho cả 3 route model.
- 503 khi không có account phù hợp (DB không seed account).
- unknown model → 400/404 theo response hiện tại (đọc status thực tế, assert cụ thể).
- nock 429 rồi 200 → request thành công sau retry (nếu retry bật) hoặc trả 429 envelope; chọn hành vi theo implementation và assert đúng một lần.
- nock 500 → envelope JSON có `error.message`.
- GraphQL: `POST /graphql` với admin key và body `{query: 'query Q($filter: TokenStatsFilterInput!) { tokenUsageStats(filter: $filter) { summary { totalTokens } } }', variables: {filter: {range: 'CUSTOM', from: 1790812800000, to: 1790899200000}}}`; expect 200 và `data.tokenUsageStats.summary.totalTokens` là number; không key → 401.
- Persistence: tạo client key qua API → `stopNestServer()` → boot lại cùng env → validate key qua `/internal/auth/validate` → `valid: true`.

- [ ] **Step 3: Run and stabilize**

Run: `npm run test:e2e`
Expected: PASS toàn bộ. Nếu upstream host/shape khác, sửa nock theo log lỗi thật (không tắt `disableNetConnect`).

- [ ] **Step 4: Commit**

```bash
git add test/e2e
git commit -m "test: cover proxy protocols, graphql, and persistence"
```

---

### Task 14: Playwright — remaining views

**Files:**
- Create: `test/playwright/dashboard.spec.ts`
- Create: `test/playwright/api-keys.spec.ts`
- Create: `test/playwright/routing.spec.ts`
- Create: `test/playwright/models.spec.ts`
- Create: `test/playwright/agent-setup.spec.ts`
- Create: `test/playwright/i18n.spec.ts`
- Modify: `test/playwright/analytics-audit.spec.ts` (thêm analytics)
- Modify: các view cần test id

**Interfaces:**
- Consumes `loginAsAdmin`, seeded keys/accounts/traffic.
- Routing dùng `POST /internal/routing` (không có PUT).

- [ ] **Step 1: Write the specs**

- dashboard: sau login thấy thẻ Gateway Online/port; account count 3; chart container render (`svg` hoặc canvas xuất hiện).
- api-keys: tạo key mới qua UI, thấy dialog/key một lần, copy; list hiển thị preview dạng `sk-ag-...`; reload không còn raw key; disable rồi delete key vừa tạo.
- routing: mở tab, thấy 3 rule seed; sửa pipeline của rule đầu (thêm/bớt provider), lưu, reload, assert còn nguyên; `afterAll` POST lại config gốc để không ảnh hưởng spec khác.
- models: danh sách model không rỗng; mở chi tiết một model thấy spec fields.
- agent-setup: chọn agent (Cursor/Claude Code), snippet chứa `http://127.0.0.1:8046` và key placeholder đúng.
- i18n: chuyển VI → heading đổi tiếng Việt; reload giữ VI; chuyển EN → đổi lại; không có text dạng `t('...')`.
- analytics: tab analytics render summary cards + chart từ traffic seed.

Thêm `data-testid` vào các control chưa có (key create form, routing editor, agent tabs) theo nhu cầu; không đổi layout.

- [ ] **Step 2: Run the full Playwright suite**

Run: `npm run test:playwright`
Expected: PASS toàn bộ, chạy 3 lần liên tiếp vẫn xanh.

- [ ] **Step 3: Commit**

```bash
git add test/playwright web/src
git commit -m "test: cover remaining dashboard views with playwright"
```

---

### Task 15: CI, docs, legacy cleanup

**Files:**
- Modify: `.github/workflows/ci.yml`
- Create: `TESTING.md`
- Modify: `README.md` (Authentication & Security)
- Modify: `SECURITY.md`
- Modify: `DOCUMENTATION_VN.md`
- Modify: `.env.example`
- Modify: `package.json`
- Delete: `test/auth-enforcement.spec.ts`
- Delete: `test/e2e-auth-flow.ts`

**Interfaces:**
- Produces: `npm test` = unit + E2E API; `npm run test:all` = `npm test` + Playwright.

- [ ] **Step 1: Update scripts**

```json
"test": "npm run test:unit && npm run test:e2e",
"test:all": "npm test && npm run test:playwright"
```

- [ ] **Step 2: Port legacy assertions**

Đảm bảo 5 assertion của `test/auth-enforcement.spec.ts` đã có tương đương trong `admin.guard.spec.ts` / `api-key.service.spec.ts` / `auth.e2e-spec.ts` (bao gồm: `PROXY_API_KEY` không được validate, `hasConfiguredProtection` phản ánh DB, guard không còn keyless). Port phần còn thiếu vào spec phù hợp rồi xoá 2 file cũ.

- [ ] **Step 3: Add CI jobs**

Thêm vào `ci.yml`:
```yaml
  unit-and-api-tests:
    name: Unit & API Tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run test:unit -- --coverage
      - run: npm run test:e2e
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: coverage
          path: coverage/
          retention-days: 7

  playwright:
    name: Playwright
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run test:playwright
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: |
            playwright-report/
            test-results/
          retention-days: 7
```

- [ ] **Step 4: Write `TESTING.md`**

Bao gồm: yêu cầu Node 24; cách chạy từng tầng; biến môi trường test; cách thêm unit/E2E/Playwright test; troubleshooting (port, browser install, temp dir); quy ước không dùng mạng thật/không đụng dữ liệu thật; cách chạy Playwright UI/headed.

- [ ] **Step 5: Update docs**

- README "Authentication & Security": dashboard và internal APIs yêu cầu admin key; key đầu tiên in ra console khi DB trống; tạo/thay key qua CLI; model API vẫn cần client key.
- SECURITY: bootstrap key, lưu hash, không log lại; khuyến nghị đổi key sau lần đầu; không mở port ra internet.
- DOCUMENTATION_VN: mục đăng nhập dashboard + quản trị account (tìm/sửa/tắt) + audit filter.
- `.env.example`: ghi chú dashboard cần admin key; key đầu tiên in ra console khi DB trống; không thêm biến môi trường mới.

- [ ] **Step 6: Run everything and verify no repo data changed**

Run:
```bash
npm test
npm run test:playwright
git status --porcelain
```
Expected: test PASS; `git status --porcelain` chỉ còn các file đã sửa có chủ đích, không có `data/`, `accounts.json`, `routing.json`.

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/ci.yml TESTING.md README.md SECURITY.md DOCUMENTATION_VN.md .env.example package.json
git rm test/auth-enforcement.spec.ts test/e2e-auth-flow.ts
git commit -m "chore: run tests in ci and document the test workflow"
```

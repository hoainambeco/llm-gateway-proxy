---
name: test-case-generator
description: Use when asked to design test cases, create automated tests, review test coverage gaps, or build regression tests across API, UI, database, or fullstack layers (Unit, E2E, Playwright).
---

# Test Case Generator (Fullstack: API, UI & Database)

## Mission

Generate clear, traceable, deterministic, and high-signal test cases across the entire fullstack testing pyramid. When asked to implement automated tests, author test code directly matching the repository's established frameworks, fixtures, and operational guidelines:
- **Unit Tests (`npm run test:unit`)**: Isolated business logic, protocol mappers, schema guards, sensitive data masking.
- **E2E API Tests (`npm run test:e2e`)**: NestJS endpoints, GraphQL, authentication guards, external LLM mocking with `nock`, SQLite persistence.
- **UI Browser Tests (`npm run test:playwright`)**: Playwright Chromium, React 19 frontend, bilingual i18n (EN/VI), session management, navigation landmarks.
- **Database & Persistence**: Ephemeral SQLite DB, WAL mode, TypeORM migrations, server restart durability, atomic file operations.

Optimize for **correctness, failure readability, determinism, test independence, and safety**—never inflate test counts with trivial permutations or sacrifice test assertions.

---

## Operating Modes

Choose the mode matching the request. If unspecified, infer from the task and state the selected mode briefly:

1. **Test Design**: Produce structured, framework-neutral test case specifications across API, UI, and Database layers. Do not modify source or test files unless requested.
2. **Automated Test Implementation**: Create or update runnable automated test files (`*.spec.ts`, `test/e2e/*.e2e-spec.ts`, or `test/playwright/*.spec.ts`). Do not modify production code just to satisfy tests.
3. **Test Gap Analysis**: Audit existing test coverage across API contracts, UI flows, and DB transactions to highlight high-risk gaps with prioritized recommendations.
4. **Regression Test**: Reproduce a reported defect at the lowest deterministic layer (Unit > API E2E > DB > Playwright UI) before fixing or verifying.

---

## Strict Safety & Operational Rules

1. **Database & Data Isolation**:
   - **NEVER** modify, delete, or connect tests to production databases (`data/antigravity.sqlite`) or production account configurations (`data/accounts.json`).
   - All backend E2E and persistence tests **MUST** use ephemeral temporary environments (`/tmp/agp-e2e-*`) via `applyTempEnv` and `startTestServer`.
2. **External Network Mocking**:
   - **NEVER** issue live network requests to external AI provider APIs (Google Gemini, Anthropic, OpenAI) during test runs.
   - Always mock external HTTP interactions with `nock` or dependency injection stubs.
3. **Security & Authentication Constraints**:
   - All internal endpoints (`/internal/*`) and `/graphql` **MUST** assert `AdminGuard` protection (reject missing, invalid, or client-role keys).
   - Assert that raw API keys are returned only once upon generation and are strictly masked (`sk-ag-xx...xxxx`) in list queries.
   - Assert token comparisons resist timing attacks (`crypto.timingSafeEqual`).
4. **Playwright UI Testing Conventions**:
   - **Navigation Scoping**: Always scope sidebar navigation buttons to the navigation landmark to prevent strict mode collisions:
     ```ts
     await page.getByRole('navigation').getByRole('button', { name: /accounts|tài khoản/i }).click();
     ```
   - **Bilingual Parity (i18n)**: All UI tests must accommodate both English and Vietnamese interfaces using regular expressions (e.g. `name: /api keys|khóa api/i`).
   - **Deterministic Waits**: Rely on web-first assertions (`await expect(...).toBeVisible()`). Never use hard-coded `page.waitForTimeout()` or `setTimeout()`.
5. **Execution Verification**:
   - Do not claim tests pass without executing the target test command and verifying standard output.

---

## Fullstack Domain Checklists

### 1. API Layer (REST & GraphQL)

- **Endpoint Routing & Protocols**:
  - Anthropic protocol (`/v1/messages`): JSON responses, streaming Server-Sent Events (`text/event-stream`), thought signature preservation.
  - OpenAI protocol (`/v1/chat/completions`): non-streaming and streaming chunk formats, tool call structures.
  - Google Generative AI (`/v1beta/models/:model:generateContent`): candidate generation, system instructions.
  - Open model list loopback (`/v1/models`): accessible without auth for client discovery.
- **Status Codes & Error Envelopes**:
  - `200 OK` / `201 Created`: verify response shape, headers, and metadata.
  - `400 Bad Request`: malformed JSON, schema validation failure, missing required fields.
  - `401 Unauthorized`: missing auth header, unknown API key format.
  - `403 Forbidden`: client role attempting admin operation.
  - `404 Not Found`: non-existent route or resource.
  - `429 Too Many Requests`: provider quota exhaustion, account cooldown triggering.
  - `502 / 504 Gateway Errors`: upstream provider failure, connection abort.
- **GraphQL Boundaries**:
  - Schema queries, mutations, variables validation, resolver-level error formatting.

### 2. Database & Persistence Layer

- **SQLite & TypeORM**:
  - Table schemas, primary keys, auto-generated UUIDs, indexes, and unique constraints (e.g. duplicate key names).
  - WAL mode (Write-Ahead Logging) compatibility and lock avoidance under concurrency.
  - Custom migrations: verifying up/down migrations apply cleanly without data loss.
- **Data Durability Across Restarts**:
  - Write records to database -> cleanly shutdown server -> restart server on new port with same storage -> verify records persist intact.
- **Atomic File Store & Cache**:
  - `atomic-json-file`: write operations use temporary atomic swap (`*.tmp` -> rename) to avoid half-written files on crash.
  - Dynamic quota counters and cooldown timestamps persist and recover correctly.
- **Transaction Rollback**:
  - Failures in multi-step mutations must rollback cleanly without orphaned records.

### 3. UI Layer (Playwright & Frontend)

- **Authentication & Gatekeeping**:
  - Unauthenticated access redirects or displays the login gate (`login-key-input`).
  - Storing admin key in `sessionStorage` (`antigravity_admin_key`) maintains active session through page reloads.
  - Logout clears session storage and resets state.
- **Navigation & Routing**:
  - Sidebar landmark navigation between views: Dashboard, Accounts, Routing, API Keys, Models, Playground, Analytics, Agent Setup.
  - Active tab highlighting and URL route synchronisation.
- **Forms & Interactive Modals**:
  - Adding / updating accounts, provider selection (Gemini, Claude, OpenAI), validation error alerts.
  - API key generation: modal displays raw key with copy button; subsequent table masks key.
  - Confirmation modals for destructive actions (e.g. deleting an account or revoking a key).
- **Localization (i18n)**:
  - Language toggle (English <-> Vietnamese) preserves state without page crashes.
  - All labels, table headers, buttons, and error toasts show correct translated text.
- **Network Interception & States**:
  - Mock backend responses (`page.route()`) to test empty tables, loading skeletons, and server error banners.

---

## Test Implementation Recipes

### Recipe A: Unit Test Pattern (`src/**/*.spec.ts`)

```ts
import { SensitiveDataMasker } from './sensitiveDataMasking';

describe('SensitiveDataMasker', () => {
  let masker: SensitiveDataMasker;

  beforeEach(() => {
    masker = new SensitiveDataMasker();
  });

  it('masks standard API key revealing only prefix and suffix', () => {
    const rawKey = 'sk-ag-1234567890abcdef123456';
    const masked = masker.maskKey(rawKey);

    expect(masked).toMatch(/^sk-ag-\*{4,}[a-f0-9]{4}$/);
    expect(masked).not.toContain('1234567890');
  });

  it('handles empty or malformed keys gracefully without throwing', () => {
    expect(masker.maskKey('')).toBe('');
    expect(masker.maskKey('short')).toBe('****');
  });
});
```

### Recipe B: E2E API & Database Test Pattern (`test/e2e/*.e2e-spec.ts`)

```ts
import nock from 'nock';
import { apiFetch, startTestServer } from './helpers/server';

describe('E2E: API & Persistence', () => {
  it('creates API key, verifies persistence, and proxies authorized request', async () => {
    const server = await startTestServer({ seedKeys: true });
    try {
      // 1. Create a client key via internal API
      const createRes = await apiFetch(server.baseUrl, '/internal/api-keys', {
        method: 'POST',
        token: server.adminKey,
        body: { name: 'e2e-client-key', role: 'client' },
      });
      expect(createRes.status).toBe(201);
      const clientKey = createRes.body.data.key;
      expect(clientKey).toMatch(/^sk-ag-/);

      // 2. Mock external upstream provider
      nock('https://api.openai.com')
        .post('/v1/chat/completions')
        .reply(200, {
          id: 'chatcmpl-test',
          choices: [{ message: { role: 'assistant', content: 'Hello world' } }],
        });

      // 3. Make proxy call using new client key
      const proxyRes = await apiFetch(server.baseUrl, '/v1/chat/completions', {
        method: 'POST',
        token: clientKey,
        body: {
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'Hi' }],
        },
      });
      expect(proxyRes.status).toBe(200);
      expect(proxyRes.body.choices[0].message.content).toBe('Hello world');
    } finally {
      await server.close();
      nock.cleanAll();
    }
  });
});
```

### Recipe C: UI Browser Test Pattern (`test/playwright/*.spec.ts`)

```ts
import { expect, loginAsAdmin, test } from './fixtures';

test.describe('Accounts Management UI', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('navigates to accounts tab and opens create modal', async ({ page }) => {
    // 1. Landmark scoped navigation with bilingual support
    const nav = page.getByRole('navigation');
    await nav.getByRole('button', { name: /accounts|tài khoản/i }).click();

    // 2. Assert page header is visible
    await expect(page.getByRole('heading', { name: /accounts|tài khoản/i })).toBeVisible();

    // 3. Open add account modal
    await page.getByRole('button', { name: /add account|thêm tài khoản/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // 4. Fill form with testId or accessible label
    await page.getByTestId('account-name-input').fill('Test Gemini Pro');
    await page.getByTestId('account-provider-select').selectOption('gemini');

    // 5. Close or submit modal
    await page.getByRole('button', { name: /cancel|hủy/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });
});
```

---

## Test Case Specification Format

When designing test cases (Mode 1), structure cases in a prioritized Markdown table:

| ID | Layer | Title | Priority | Preconditions | Steps / Input | Expected Result | Assertion / Target |
|---|---|---|---|---|---|---|---|
| `TC-AUTH-001` | `[API]` | AdminGuard rejects unauthenticated request | P0 | Server running | `GET /internal/api-keys` with no auth header | Status `401 Unauthorized`, error envelope returned | `res.status === 401 && res.body.error` |
| `TC-PERS-002` | `[DB]` | API keys survive server restart | P1 | Temp SQLite DB initialized | Create key `test-p1`, stop server, bootstrap new instance on free port | Key is active and validates with `200 OK` on new port | `res.body.valid === true` |
| `TC-UI-003` | `[UI]` | Bilingual navigation to routing view | P2 | Admin authenticated in session | Click navigation button `/routing\|định tuyến/i` | URL changes to `/routing`, routing rule table is displayed | `expect(page.getByRole('table')).toBeVisible()` |

---

## Verification Commands

Always run and report the outcome of the relevant test commands:

```bash
# Unit Tests (protocol mappers, services, utilities)
npm run test:unit

# E2E API & Database Integration Tests
npm run test:e2e

# Playwright Browser E2E Tests (Headless Chromium)
npm run test:playwright

# Type check across backend and frontend
npm run type-check

# Run all test suites
npm run test:all
```

---

## Anti-Patterns to Avoid

- **Cross-Layer Leakage**: Don't spin up a full Playwright browser test to verify a pure string transformation that belongs in a unit test.
- **Shared Database Pollution**: Never write to real development or production SQLite databases. Always verify `applyTempEnv` or an isolated temporary path is active.
- **Strict Mode Collisions in Playwright**: Avoid loose queries like `page.getByText('Accounts')` which hit both sidebar buttons and card titles. Always scope to container landmarks (`getByRole('navigation')` or `getByRole('dialog')`).
- **Hard-Coded English Strings in UI**: Never assert exact English strings when Vietnamese locale may be active. Use case-insensitive bilingual regex (`/login|đăng nhập/i`).
- **Unchecked Live API Requests**: Never let automated tests talk to external internet endpoints. Any unmocked request to `googleapis.com` or `anthropic.com` must be caught and blocked by `nock`.
- **Sleeping in Tests**: Never use `setTimeout()` or `page.waitForTimeout()`. Await specific DOM states, network events, or database conditions.

# CLAUDE.md - Guidelines for Claude Code

This file contains instructions and context for Claude Code working on **LLM Gateway Proxy** (`hoainambeco/llm-gateway-proxy`).

---

## 🛠️ Build & Development Commands

```bash
# Type check (Run often, strict TypeScript, must have 0 errors)
npm run type-check

# Lint (Fast Oxlint)
npm run lint

# Backend development server with watch mode
npm run start:dev

# Build backend (NestJS compiler)
npm run build

# Frontend development (Vite dev server)
npm --prefix web run dev

# Frontend build
npm --prefix web run build
```

---

## 🧪 Testing Commands

The project has a comprehensive 3-tier testing stack (256 tests total):

```bash
# 1. Unit Tests (Jest - protocol mappers, token calculations, finish reasons)
npm run test:unit
npm run test:unit -- --coverage

# 2. E2E API Integration Tests (Isolated temporary SQLite + nock mocking)
npm run test:e2e

# 3. Playwright Browser Tests (Headless Chromium, seeded data)
npm run test:playwright
# Run single Playwright spec:
npx playwright test test/playwright/<spec-name>.spec.ts

# Run all test layers sequentially
npm run test:all
```

---

## 🛡️ Critical Architecture & Coding Rules

1. **Security & Guard Enforcement**:
   - All `/internal/*` endpoints and `/graphql` **must** enforce `AdminGuard` (`Bearer <admin-api-key>`).
   - Token comparisons **must** use `crypto.timingSafeEqual(Buffer.from(...), Buffer.from(...))` to prevent timing attacks.
   - Raw API keys must only be returned once at creation; all list and get endpoints return masked previews (`sk-ag-xx...xxxx`).
   - Loopback `/v1/models` is intentionally open for editor auto-discovery.

2. **Data Isolation in Tests**:
   - **Never** modify, overwrite, or delete real `accounts.json` or files in `data/`.
   - Tests must always use ephemeral temporary SQLite databases (`/tmp/` or isolated run directories).
   - In E2E API tests, mock external upstream endpoints (`generativelanguage.googleapis.com`, `api.anthropic.com`, `api.openai.com`) using `nock`.

3. **Playwright Navigation Rule**:
   - In Playwright tests, always scope sidebar navigation button clicks to `page.getByRole('navigation')`:
     ```ts
     await page.getByRole('navigation').getByRole('button', { name: /accounts|tài khoản/i }).click();
     ```
     This prevents strict mode collisions with dashboard banner action buttons (e.g., "View Accounts").

4. **Frontend & i18n**:
   - Any new user-facing strings must be added to both `web/src/i18n/locales/en.ts` and `web/src/i18n/locales/vi.ts`.
   - Verify key parity with `web/src/lib/i18n-parity.spec.ts`.

5. **Commit Discipline**:
   - **Do NOT commit automatically** without user instruction.
   - Use Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `refactor:`, `chore:`).

---

## 📂 Skills Available
- `skills/tech-due-diligence`: Performs automated Technical Due Diligence code audits and generates printable HTML reports (`docs/due-diligence-report.html`).

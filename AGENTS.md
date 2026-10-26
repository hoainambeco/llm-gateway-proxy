# LLM Gateway Proxy - Agent Guidelines (`AGENTS.md`)

Welcome, AI Agent! This document outlines the architecture, conventions, workflows, and strict operational guidelines for working on the **LLM Gateway Proxy** codebase.

---

## 1. Project Overview & Architecture

**LLM Gateway Proxy** is a high-performance multi-provider proxy and routing gateway for modern AI coding assistants (Cursor, Claude Code, Cline, OpenCode).

- **Backend (Root)**:
  - Framework: **NestJS 10** + **Fastify/Express**
  - Language: **TypeScript** (Strict mode)
  - Database: **SQLite** (WAL mode enabled via TypeORM / custom migrations)
  - Key Services:
    - Protocol mappers: Anthropic (`/v1/messages`), OpenAI (`/v1/chat/completions`), Google Generative AI (`/v1beta/models/:model:generateContent`)
    - Account pooling & rotation: Dynamic quota tracking, automatic 429 cooldowns
    - Thought Signature preservation: Maintains chain-of-thought tokens for reasoning models (Claude Thinking, Gemini Thinking)
    - Admin Security: Session-based Login Gate, `AdminGuard`, bootstrap `INITIAL_ADMIN_KEY`
- **Frontend (`web/`)**:
  - Framework: **React 19** + **Vite**
  - Styling: **Tailwind CSS** + **Lucide Icons**
  - Localization: Custom `i18n` context supporting English (EN) and Vietnamese (VI) with 100% key parity
  - State: Key storage in localStorage, GraphQL & REST client adapters

---

## 2. Command Reference

### Development & Build
```bash
# Backend dev server (with hot reload)
npm run start:dev

# Strict TypeScript check (0 errors required)
npm run type-check

# Fast linting with Oxlint
npm run lint

# Compile NestJS production build
npm run build

# Run SQLite migrations
npm run migration:run

# Frontend dev server (port 5173 / proxies to gateway)
npm --prefix web run dev

# Frontend production build
npm --prefix web run build
```

### Testing Stack (256 Tests Total)
```bash
# Unit Tests (Jest - 205 tests covering protocol mappers, usage, error envelopes)
npm run test:unit
npm run test:unit -- --coverage

# E2E API Integration Tests (Jest + nock + isolated temp SQLite - 27 tests)
npm run test:e2e

# Playwright Browser E2E Tests (Headless Chromium - 24 tests)
npm run test:playwright

# Run all test layers sequentially
npm run test:all
```

---

## 3. Strict Operational Guidelines

1. **Database & Secret Safety**:
   - **NEVER** modify or delete production `accounts.json` or files in the `data/` directory.
   - All tests must use ephemeral temporary databases (`/tmp/` or isolated directories).
   - In E2E tests, always mock external network calls (Google, Anthropic, OpenAI) using `nock`.

2. **Security & Authentication Constraints**:
   - Every internal route (`/internal/*`) and `/graphql` **MUST** be protected by `AdminGuard`.
   - Token comparisons **MUST** use `crypto.timingSafeEqual` to avoid timing attacks.
   - Raw API keys must only be returned once upon creation. In all list/query responses, keys must be masked (e.g. `sk-ag-xx...xxxx`).
   - Loopback route `/v1/models` is intentionally open to allow editor extensions (Cursor/Cline) to discover available models without pre-authentication.

3. **Playwright UI Testing Rules**:
   - When targeting sidebar navigation buttons, **ALWAYS** scope to the navigation landmark to prevent strict mode collisions:
     ```ts
     await page.getByRole('navigation').getByRole('button', { name: /accounts|tài khoản/i }).click();
     ```
   - Retain language parity: UI elements must be testable in both English and Vietnamese.

4. **Git & Commit Hygiene**:
   - **Do NOT commit automatically** unless explicitly requested by the user.
   - Follow Conventional Commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`.

---

## 4. Skills & Extensibility

- **`skills/tech-due-diligence`**: Run automated Technical Due Diligence audits on this or any repository to generate printable Tailwind CSS reports (`docs/due-diligence-report.html`).

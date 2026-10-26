# Testing Guide

Antigravity Proxy has a multi-tier testing strategy consisting of Unit Tests, E2E API Tests, and Playwright Browser Tests.

## Test Commands

| Command | Description |
|---|---|
| `npm test` | Runs all Unit Tests (`test:unit`) and E2E API Tests (`test:e2e`). |
| `npm run test:unit` | Fast, isolated unit tests using Jest. |
| `npm run test:unit:watch` | Watch mode for unit tests. |
| `npm run test:cov` | Generate unit test code coverage report. |
| `npm run test:e2e` | End-to-end integration tests using in-memory / temporary isolated SQLite and ephemeral Nest instances. |
| `npm run test:playwright` | Full browser end-to-end testing with Playwright and seeded test database. |
| `npm run test:playwright:ui` | Interactive UI mode for Playwright debugging. |
| `npm run test:all` | Runs the entire test suite (`test:unit`, `test:e2e`, and `test:playwright`). |

---

## 1. Unit Tests (`src/**/*.spec.ts`)
- Covers protocol transformations (Claude, Gemini, OpenAI mappers, usage accounting, finish reasons).
- Tests error envelopes, retry policies, hashing, and utility services.
- Never depends on network, external APIs, or filesystem side-effects.

## 2. E2E API Tests (`test/e2e/*.e2e-spec.ts`)
- Spawns temporary Nest application instances with isolated SQLite databases and accounts files.
- Uses `nock` to stub upstream AI providers (`generativelanguage.googleapis.com`, `api.anthropic.com`, `api.openai.com`).
- Validates:
  - First-run admin key auto-bootstrap and authentication enforcement (`AdminGuard`, `ProxyGuard`, GraphQL).
  - Protocol proxying (OpenAI, Anthropic, Gemini, error handling, fallbacks).
  - Persistence across restarts and TypeORM migrations.

## 3. Playwright Browser Tests (`test/playwright/*.spec.ts`)
- Tests complete dashboard flows in headless Chromium:
  - **Login Gate**: Authentication, stored key revalidation, session logout.
  - **Accounts**: Search, provider/status filters, inline renaming, disabling/enabling accounts.
  - **API Keys**: Creation dialog with single-reveal key token, preview masking, revocation, and deletion.
  - **Routing**: Rule-based routing management, modal editor, persistence.
  - **Models**: Discovered models catalog, copy helper, search.
  - **Agent Setup**: Config generation presets for Cursor, Claude Code, Cline, etc.
  - **Audit & Analytics**: Time-range filtering, token usage charts.
  - **i18n**: Real-time language switching (EN/VI) and persistence.

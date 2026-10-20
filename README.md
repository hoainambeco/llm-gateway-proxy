# LLM Gateway Proxy (Standalone)

High-performance, standalone multi-protocol LLM Proxy Gateway extracted from AntigravityManager. Built with **NestJS + Fastify**.

Seamlessly proxies OpenAI, Anthropic, and Gemini API requests to Google Cloud Code / Antigravity, GitHub Copilot, Claude.ai, ChatGPT and OpenAI upstreams with multi-account round-robin scheduling, automatic token refresh, quota tracking, and thought signature recovery for thinking models.

> ### ⚠️ Disclaimer — read before using
>
> This is an independent research project. It is **not** affiliated with, endorsed by, or
> supported by Google.
>
> It talks to `cloudcode-pa.googleapis.com/v1internal` using OAuth scopes that Google
> grants only to its own first-party clients, so it only works with a credential pair
> taken from an Antigravity installation — the repository ships none, and you must supply
> your own (see [OAuth Client Credentials](#oauth-client-credentials)).
>
> Whether that use complies with Google's Terms of Service is **your** responsibility, as
> is any consequence to the Google accounts you link, up to and including suspension. The
> software is provided as is, without warranty of any kind, under the
> [MIT License](LICENSE). Published for education and interoperability research. If you
> need a supported path to these models, use the official Gemini API.

---

## Screenshots

The built-in web dashboard (served by the proxy itself) for managing accounts, routing, API keys, and traffic. All data shown is sample data.

![Dashboard](docs/screenshots/02-dashboard.png)

| Accounts & Quota | Rule-Based Routing |
| :---: | :---: |
| ![Accounts & Quota](docs/screenshots/03-accounts.png) | ![Routing Rules](docs/screenshots/04-routing.png) |
| **Model Catalog** | **API Keys** |
| ![Model Catalog](docs/screenshots/05-models.png) | ![API Keys](docs/screenshots/06-api-keys.png) |
| **Traffic & Audit Logs** | **Login** |
| ![Traffic & Logs](docs/screenshots/07-traffic.png) | ![Login](docs/screenshots/01-login.png) |

<details>
<summary>Vietnamese UI (i18n)</summary>

![Dashboard (Vietnamese)](docs/screenshots/08-dashboard-vi.png)

</details>

---

## Features

- **Multi-Protocol Translation**:
  - OpenAI Compatible: `/v1/chat/completions`, `/v1/models`, `/v1/responses` (WebSockets), `/v1/images/generations`
  - Anthropic Compatible: `/v1/messages`
  - Gemini Compatible: `/v1beta/models/...`
- **Multi-Account Pooling & Rotation (`accounts.json`)**:
  - Round-robin / sticky session / cache-first candidate selection.
  - Automatic OAuth token refresh (`ya29...` access token from `refresh_token`).
  - Automatic 429 rate-limit cooldown and failover across accounts.
- **Thought Signature Recovery**:
  - In-memory preservation of reasoning turns and thought signatures for Gemini 2.0 Thinking & Claude models.
- **Dynamic API Key Management (TypeORM + SQLite)**:
  - Create, revoke, enable/disable multiple API keys (`sk-ag-...`) for different clients/users.
  - Sub-millisecond in-memory cache validation with async last-used tracking.
  - TypeORM schema migrations with zero `synchronize: true` risk.
- **Ultra-lightweight & Headless**:
  - Pure Node.js & TypeScript built on NestJS & Fastify.
  - Deployable on Linux VPS, macOS, Windows, or Docker containers.

---

## Quick Start

### 1. Installation

```bash
cd llm-gateway-proxy
npm install
```

### 2. Configure Accounts

You can add multiple Google Cloud accounts using either the CLI wizard or manual JSON editing.

#### Method A: CLI Account Management (Recommended)
Add any account type via CLI:
```bash
# 1. Add Google Cloud / Antigravity Account (Interactive OAuth)
npm run add-account

# 2. Add Anthropic Claude API Key
npm run add-account -- --provider anthropic --key sk-ant-api03-... --email user@example.com

# 3. Add Claude.ai Web Session (Cookie)
npm run add-account -- --provider anthropic --session sk-ant-sid01-... --email user@example.com

# 4. Add GitHub Copilot Token (ghu_...)
npm run add-account -- --provider copilot --token ghu_... --email user@example.com

# 5. Add OpenAI Platform API Key (sk-proj-...)
npm run add-account -- --provider openai --key sk-proj-... --email user@example.com
```

#### Method B: Manual Configuration (`accounts.json`)
Alternatively, copy `accounts.json.example` to `accounts.json` and add your accounts directly:
```json
[
  {
    "id": "agy-1",
    "provider": "google",
    "email": "user1@gmail.com",
    "token": {
      "refresh_token": "1//04_YOUR_GOOGLE_REFRESH_TOKEN",
      "access_token": "ya29.YOUR_ACCESS_TOKEN",
      "project_id": "your-gcp-project-id"
    }
  },
  {
    "id": "claude-api-1",
    "provider": "anthropic",
    "auth_type": "api_key",
    "email": "claude@example.com",
    "api_key": "sk-ant-api03-..."
  },
  {
    "id": "copilot-1",
    "provider": "copilot",
    "auth_type": "copilot_token",
    "email": "copilot@example.com",
    "github_token": "ghu_..."
  }
]
```

### 3. Rule-Based Routing (`routing.json`)
Customize the priority and failover pipeline for each model:
```json
{
  "rules": [
    {
      "pattern": "^(claude-3-7-sonnet|claude-3-5-sonnet)",
      "pipeline": ["google", "anthropic_api", "anthropic_oauth", "anthropic_web"],
      "description": "Prioritize Antigravity, fallback to Anthropic pool on 429"
    },
    {
      "pattern": "^(gpt-4o|o1|o3|codex)",
      "pipeline": ["copilot", "openai_api", "chatgpt_web", "google"],
      "description": "Prioritize Copilot & OpenAI, fallback to Google transpile"
    }
  ],
  "default_pipeline": ["google", "anthropic_api", "copilot", "openai_api"]
}
```

### 3. Configure Environment

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Key variables:
- `ANTIGRAVITY_OAUTH_CLIENT_ID` / `ANTIGRAVITY_OAUTH_CLIENT_SECRET`: **Required.** See [OAuth Client Credentials](#oauth-client-credentials) below.
- `PORT`: Port to listen on (default `8045`).
- `SQLITE_DB_PATH`: Path to SQLite database file (default `./data/antigravity.sqlite`).
- `ACCOUNTS_FILE`: Path to `accounts.json` (default `./accounts.json`).

### 4. API Key Management (CLI & Migrations)

Manage dynamic API keys for Cursor, Claude Code, and other clients via CLI:

```bash
# List all API keys
npm run api-key list

# Create a new API key (auto-generates sk-ag-...)
npm run api-key create "Cursor - Work"

# Create an Admin key
npm run api-key create "Admin Dashboard" -- --role admin

# Toggle active/inactive state
npm run api-key toggle "Cursor - Work"

# Delete an API key
npm run api-key delete "Cursor - Work"
```

#### TypeORM Migrations

The database runs with `synchronize: false` for production safety. Migrations run automatically on startup (`migrationsRun: true`), and can also be managed manually:

```bash
# Auto-generate migration by comparing Entities against the SQLite schema
npm run migration:generate -- src/modules/database/migrations/<MigrationName>

# Run pending migrations
npm run migration:run

# Revert last migration
npm run migration:revert

# Create empty migration template
npm run migration:create -- src/modules/database/migrations/<MigrationName>
```

### 5. Run Server (Standard NestJS CLI)

**Development Mode (live reload / watch):**
```bash
npm run start:dev
```

**Production Build & Run:**
```bash
npm run build
npm run start:prod
```

---

## OAuth Client Credentials

This repository ships **no** OAuth client credentials. You must supply your own:

```bash
ANTIGRAVITY_OAUTH_CLIENT_ID=<client id>
ANTIGRAVITY_OAUTH_CLIENT_SECRET=<client secret>
```

Both are required. With either missing, the proxy logs a warning at startup and every
OAuth operation (`getAuthUrl`, code exchange, token refresh) fails with
`No OAuth client configured.`

### Why they are not bundled

The proxy calls `cloudcode-pa.googleapis.com/v1internal` and requests Google-internal
OAuth scopes (`auth/aicode`, `auth/cclog`, `auth/experimentsandconfigs`). Google grants
those only to its own first-party clients, so an OAuth client you create in your own GCP
project cannot request them — the only credentials that work belong to the Antigravity
desktop application.

Committing such a pair to a public repository would get it flagged by secret scanners
and revoked, breaking the proxy for everyone using it, so it is kept out of the source
tree and out of the published build.

### Obtaining a credential pair

Extract the client id and secret from the Antigravity installation on your own machine;
they are present in the application bundle. Whether your use of them complies with
Google's Terms of Service is your responsibility.

### Rotating

Because the pair is read from the environment, a revoked credential is replaced by
editing `.env` and restarting — no rebuild required.

### Using more than one client

`ANTIGRAVITY_OAUTH_CLIENTS` registers additional clients as
`key|client_id|client_secret[|label]` entries separated by `;`. Reusing the key
`antigravity_enterprise` overrides the credentials above. `ANTIGRAVITY_OAUTH_CLIENT_KEY`
selects which key is active at startup; the others are used as fallbacks when a token
exchange or refresh fails.

---

## Exposing the proxy

The proxy fronts your own Google accounts. Anyone who can reach the port can spend their
quota, read the model catalog, and — with an admin key — read the audit log, which stores
every prompt and response in full.

### Authentication & Security

- **Dashboard Access:** By default, accessing the Web UI (`http://localhost:8045/`) and internal management APIs does not require a login key. You can view connected accounts, routing rules, and manage API keys directly.
- **Model API Authentication:** Every request to proxy model endpoints (OpenAI, Anthropic, Gemini, etc.) **strictly requires** a valid dynamic API key. Keyless or unauthorized model requests are rejected immediately with HTTP `401 Unauthorized`.
- **Model Catalog Discovery:** Only local loopback discovery requests (`GET /v1/models` from `127.0.0.1`) are permitted unauthenticated to facilitate model discovery by local editors and extensions.

### Before putting it on a network

1. Generate client API keys in the Web UI (under "API Keys" tab) or via CLI: `npm run api-key create "Client Name"`.
2. Keep it behind a reverse proxy with TLS if accessing over untrusted networks. Plain HTTP sends keys across the network in cleartext.
3. Add rate limiting at your reverse proxy if needed. The proxy does not throttle requests by design.
4. Do not expose administrative ports freely to the public internet. See [SECURITY.md](SECURITY.md) for details.

Client API keys are stored only as SHA-256 digests. A key is displayed once, when it is
created, and cannot be recovered afterwards — if you lose one, delete it and create a new
one.

---

## Running with Docker

Build and run:

```bash
docker build -t llm-gateway-proxy .

# Run mounting accounts.json and SQLite data volume.
docker run -d \
  --name llm-gateway-proxy \
  -p 127.0.0.1:8045:8045 \
  -v $(pwd)/accounts.json:/app/data/accounts.json \
  -v $(pwd)/data:/app/data \
  -e PORT=8045 \
  llm-gateway-proxy
```

> **Note:** TypeORM migrations execute automatically on container startup (`migrationsRun: true`).
> To manually trigger production migrations inside a running container:
> ```bash
> docker exec -it llm-gateway-proxy npm run migration:run:prod
> ```

---

## Client Configuration Examples

Generate a unique API key for each client first (via Web UI or CLI):
```bash
npm run api-key create "My Client"
# Returns: sk-ag-xxxxxxxxxxxxxxxxxxxxxxxx
```

---

### Cursor IDE
1. Open **Cursor Settings** (`Ctrl + Shift + J` or `Cmd + Shift + J`) -> **Models**.
2. Add desired models:
   - `claude-3-7-sonnet` (or `claude-3-7-sonnet-thought`)
   - `claude-3-5-sonnet-20241022`
   - `gemini-2.5-pro`
   - `gemini-2.0-flash-exp`
3. Scroll down to **OpenAI API Key**:
   - Turn ON **Override OpenAI Base URL**.
   - **Base URL:** `http://localhost:8045/v1`
   - **API Key:** Enter your generated key (`sk-ag-...`).
4. Click **Verify** to test connection.

---

### OpenCode CLI
Configure in `opencode.json` (in your workspace or `~/.config/opencode/opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "antigravity": {
      "npm": "@ai-sdk/openai",
      "options": {
        "baseURL": "http://localhost:8045/v1",
        "apiKey": "sk-ag-YOUR_API_KEY"
      },
      "models": {
        "claude-3-7-sonnet": { "name": "Claude 3.7 Sonnet" },
        "gemini-2.5-pro": { "name": "Gemini 2.5 Pro" }
      }
    }
  }
}
```

Or via environment variables:
```bash
export OPENAI_BASE_URL="http://localhost:8045/v1"
export OPENAI_API_KEY="sk-ag-YOUR_API_KEY"
opencode --model openai/claude-3-7-sonnet
```

---

### Claude Code CLI (Official Anthropic CLI)
```bash
export ANTHROPIC_BASE_URL="http://localhost:8045"
export ANTHROPIC_API_KEY="sk-ag-YOUR_API_KEY"
claude
```

---

### OpenAI Codex / OpenAI SDK
Connect any OpenAI SDK client directly to the proxy:

#### TypeScript / Node.js
```typescript
import OpenAI from 'openai';

const openai = new OpenAI({
  baseURL: 'http://localhost:8045/v1',
  apiKey: 'sk-ag-YOUR_API_KEY',
});

const res = await openai.chat.completions.create({
  model: 'claude-3-7-sonnet',
  messages: [{ role: 'user', content: 'Hello!' }],
});
console.log(res.choices[0].message.content);
```

#### Python
```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:8045/v1",
    api_key="sk-ag-YOUR_API_KEY",
)

res = client.chat.completions.create(
    model="claude-3-7-sonnet",
    messages=[{"role": "user", "content": "Hello!"}],
)
print(res.choices[0].message.content)
```

---

### Cline / Roo Code (VS Code Extension)
In Settings -> **API Provider**:
- **OpenAI Compatible:**
  - **Base URL:** `http://localhost:8045/v1`
  - **API Key:** `sk-ag-YOUR_API_KEY`
  - **Model ID:** `claude-3-7-sonnet` or `gemini-2.5-pro`
- **Anthropic:**
  - **Base URL:** `http://localhost:8045`
  - **API Key:** `sk-ag-YOUR_API_KEY`
  - **Model ID:** `claude-3-7-sonnet`

---

### Aider
```bash
aider --openai-api-base http://localhost:8045/v1 \
      --openai-api-key sk-ag-YOUR_API_KEY \
      --model openai/claude-3-7-sonnet
```

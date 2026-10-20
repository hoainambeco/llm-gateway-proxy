# Security Policy

## Scope

This project is a self-hosted proxy. The secrets it keeps on the machine that runs it are
worth far more than the code:

| File                      | Contents                                                   | Consequence if leaked                                                                                                                                               |
| ------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `accounts.json`           | Google OAuth refresh tokens, one per linked account | Full, renewable access to those Google accounts' Antigravity quota                                                                                                  |
| `.env`                    | `ANTIGRAVITY_OAUTH_CLIENT_ID` / `_SECRET`           | Credential pair revoked once reported                                                                                                                               |
| `data/antigravity.sqlite` | Client API key hashes, traffic audit metadata       | Key hashes are not usable as credentials; audit rows store metadata only (model, status, token counts, error message) — request/response bodies are never persisted |

All three are listed in `.gitignore` and `.dockerignore`. Never commit them, never paste
them into an issue, and never attach a database file to a bug report without deleting the
`traffic_logs` table first.

## Client API keys

Only the SHA-256 digest of a client API key is stored. A key is shown once, when it is
created, and cannot be recovered afterwards from the web UI, the CLI, or the database --
if one is lost, delete it and create a replacement.

## Supported versions

Only the latest commit on `master` receives fixes. There are no maintained release
branches — pull `master` and rebuild.

## Reporting a vulnerability

Report privately, **not** as a public GitHub issue:

- Open a [GitHub Security Advisory](https://github.com/hoainambeco/llm-gateway-proxy/security/advisories/new), or
- Message the maintainer through GitHub ([@hoainambeco](https://github.com/hoainambeco)).

Please include the affected version or commit, a description of the impact, and the
minimum steps to reproduce. Redact any real token, API key, or account email from your
report.

Expect an acknowledgement within roughly a week. This is a spare-time project with no
paid maintainer, no SLA, and no bug bounty. If a report is accepted, the fix lands on
`master` and the advisory is published; if it is declined, you will be told why.

## Known weaknesses, accepted by design

These are documented rather than fixed, because the project assumes a trusted,
single-operator deployment. Treat them as reasons not to expose the proxy to the public
internet, not as vulnerabilities to report:

- **Model API Authentication.** Model execution endpoints strictly require a valid client API key
  stored in SQLite. Keyless requests are rejected with HTTP 401. Only loopback requests to the
  model catalog (`GET /v1/models`) are permitted unauthenticated for editor agent discovery.
- **No rate limiting.** Nothing throttles API key guesses or request volume. This is
  deliberate: the proxy fronts long-running agent sessions, where a throttle interrupts
  real work more often than it stops an attacker.
- **Permissive CORS.** The server calls `enableCors()` with no allowlist, so any origin
  may call it from a browser. Also deliberate: an allowlist breaks browser-based and
  editor-embedded agents that call the proxy from origins the operator cannot enumerate.
- **Audit logs keep metadata only.** The `traffic_logs` table stores per-request metadata
  (model, status, latency, token counts, error message), never request or response bodies.

## Not a vulnerability

Reports that the proxy uses Google-internal OAuth scopes, or that it works with
credentials extracted from the Antigravity desktop application, describe what the project
openly is — see the disclaimer in the README. That is a terms-of-service question for
each operator, not a security defect.

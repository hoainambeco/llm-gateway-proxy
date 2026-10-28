# OpenCode V2 (2.2.0) — HTTP contract for custom providers

**Method.** Docs were fetched from `opencode.ai/v2/docs/*` (linked per claim). Behaviour comes from the published code:
`@opencode/ai@2.2.0` (https://registry.npmjs.org/@opencode/ai/-/ai-2.2.0.tgz) and `@opencode/core@2.2.0`
(https://registry.npmjs.org/@opencode/core/-/core-2.2.0.tgz). Paths below are published-package paths; the same sources
read on GitHub default branch `dev` under `packages/ai/src/...`, which is *newer* — where they differ, 2.2.0 wins.

## A. Endpoint inventory

| Package (`package`) | HTTP call | When | Mandatory |
| --- | --- | --- | --- |
| `@opencode/ai/providers/openai-compatible` | `POST {baseURL}/chat/completions` (`dist/protocols/openai-compatible-chat.js`) | Every turn (steps, title, compaction, warming) | **Yes** |
| `.../openai-compatible/responses` | `POST {baseURL}/responses` (`dist/protocols/openai-compatible-responses.js`) | Every turn (HTTP only, no WS) | **Yes** |
| `@opencode/ai/providers/anthropic-compatible` | `POST {baseURL}/messages` (`dist/protocols/anthropic-messages.js`, `PATH="/messages"`) | Every turn | **Yes** |
| `@opencode/ai/providers/google` | `POST {baseURL}/models/{modelID}:streamGenerateContent?alt=sse` (`dist/protocols/gemini.js:774`) | Every turn | **Yes** |
| `@opencode/ai/providers/openai/chat` (comparison) | `POST {baseURL}/chat/completions`, default baseURL `https://api.openai.com/v1` | Every turn | **Yes** |

All four:

- Join URLs by concatenation after trailing-slash trim (`dist/route/endpoint.js`), so prefixes work
  (`https://gw.example/anthropic` + `/messages`). A missing `baseURL` fails locally (`anthropic-compatible` throws
  `Anthropic-compatible providers require a baseURL`).
- Never call `GET /models`, `HEAD`, `/health`, `/count_tokens` or any tokenizer. `/health` + `/v1/models` exist only in the
  built-in *discovery* plugins (`vllm` in `@opencode/core` `dist/chunks/tool-yxjvbhxs.js`; also
  https://opencode.ai/v2/docs/models#vllm). A custom provider with an explicit `models` map is never probed.
- Resolve auth *before* HTTP: a missing credential raises `AuthenticationError` / "Missing auth credential"
  (`dist/route/auth.js`), so no keyless request ever leaves.
- Opt-in/model-specific extras: `/responses/compact` (native compaction — only the native `openai` route wires `compact`),
  `/images/generations|/images/edits` (`type: "image"`), Google `:generateContent` / `:predictLongRunning`.
- `settings.transport: "websocket"` on a route without a WS channel warns and falls back to HTTP
  (https://opencode.ai/v2/docs/providers#websockets).

### Cadence of extra calls

- **Session title**: one extra streaming request after the first user message, same endpoint
  (`@opencode/core` `dist/chunks/tool-m89ew3ks.js`, `SessionTitle.attempt`).
- **Compaction**: one extra streaming request when context nears the limit (https://opencode.ai/v2/docs/compaction).
- **Warming**: only if enabled; a throwaway request every 4 min for 30 min (https://opencode.ai/v2/docs/warming#requests).

## B. Wire-format requirements

### OpenAI Chat (`openai-compatible`, and `openai/chat` for comparison)

Request is always `stream: true`. `stream_options: { include_usage: true }` is sent unless
`compatibility.streamUsage: false` (`dist/protocols/openai-chat.js:654`; docs
https://opencode.ai/v2/docs/models#compatibility).

Differences that matter between the two packages (same protocol, different route defaults):

| | `openai-compatible` | `openai/chat` |
| --- | --- | --- |
| `provider` identity | your config key (or `canonical`), `dist/providers/openai-compatible.js` + core `rewrite` | `openai` |
| `store: false` | **not sent** (only for openai/azure hosts) | sent |
| `prompt_cache_key` | **not sent** unless `compatibility.supportsPromptCacheKey: true` | sent |
| output-token field | `max_completion_tokens` (custom gateways!) unless `compatibility.maxTokensField: "max_tokens"` | `max_completion_tokens` |
| `strict` on tools | sent unless provider/URL is Moonshot/Together/Cloudflare/NVIDIA | sent |

`detectMaxTokensField` / `detectSupportsStore` / `detectSupportsStrictMode` live in `dist/protocols/openai-chat.js`
(~lines 522–580). A gateway URL matches none of the known hosts, so **`max_completion_tokens` is the default** — a proxy
that only accepts `max_tokens` 400s until `compatibility.maxTokensField: "max_tokens"` is set.

Streaming rules:

- `data:` frames of ChatCompletion chunks; `event:` names ignored. `data: [DONE]` is kept by `Framing.sseWithDone`
  (`dist/route/framing.js`) but is **not strictly required** — connection close triggers `onHalt`, which synthesises finish.
- **`finish_reason` is required** by default; without it the turn fails with
  `OpenAI Chat stream ended without finish_reason` (`compatibility.requireFinishReason`, default `true`).
- `choices: []` usage-only chunks are fine. Text or tool deltas *after* `finish_reason` are hard errors
  (`received content after the finish reason`, `Provider emitted … after the terminal event`).
- `finish_reason: "error" | "network_error"` becomes a provider error; `stop|end|length|tool_calls|function_call|content_filter`
  map to OpenCode reasons.
- Keep-alives: SSE comments are ignored, and `data: null` / `data: : keepalive` are dropped. Headers must arrive within
  5 min, chunks within 15 min (`300_000` / `900_000` ms; `settings.headerTimeout` / `chunkTimeout`,
  https://opencode.ai/v2/docs/providers#timeouts).

Tool calling: `choices[0].delta.tool_calls[]` with `index` (optional; the parser falls back to id-matching and position),
`id`, `function.name`, streamed `function.arguments`. `id` and `name` may split across chunks but both must exist before the
stream ends, else `OpenAI Chat tool call delta is missing id or name`. `tool_choice` is only sent with tools; `tools: []`
is sent when history has tool results but no active tools.

Reasoning: read from `compatibility.reasoningField`, else the first of `reasoning_content` / `reasoning` / `reasoning_text`
seen. Next turn replay writes the same field on the assistant message, plus `reasoning_details` if observed.
`requireReasoning` defaults to `true` when a `reasoningField` is set or the model is DeepSeek, so prior assistant messages
carry the field even when empty. A gateway rejecting unknown assistant fields 400s on turn 2 unless the field is remapped
(https://opencode.ai/v2/docs/models#reasoning).

Usage: `prompt_tokens` / `completion_tokens` / `total_tokens`; cache reads from `prompt_tokens_details.cached_tokens`,
`prompt_cache_hit_tokens`, `cached_tokens` or `cache_read_input_tokens`; cache writes from
`prompt_tokens_details.cache_write_tokens` or `cache_created_input_tokens`; reasoning from
`completion_tokens_details.reasoning_tokens`; `choice.usage` also accepted (`mapUsage`). With no usage at all the step
ends with `usage: undefined`, so no tokens/cost are recorded (`@opencode/core` `dist/chunks/tool-m89ew3ks.js`).

Multimodal: images/files lower to `image_url` / `{type:"file", file:{filename, file_data}}`; declare
`capabilities.input: ["text"]` on a text-only gateway or images will be attached anyway.

Errors: no OpenAI-shaped envelope required. Status classifies; the message is read from `{error:{message}}`, `{error:"…"}`,
`{message}`, `{Message}`, `{detail}` or `{errors:[{message}]}` (`providerErrorMessage`, `dist/provider-error.js`).
401/403 → auth (no retry); 402 / quota codes / 429-with-quota-text → quota; 429 → rate limit; 408/409/5xx → retryable
internal; other 4xx → invalid request; unrecognised → retryable. Context overflow is regex-detected (`prompt is too long`,
`context_length_exceeded`, …) and triggers one auto-compaction, so keep a recognisable phrase in 400 bodies
(https://opencode.ai/v2/docs/compaction#limits).

Retries (`@opencode/core` `dist/chunks/tool-wnhgecwx.js`): ≤10 attempts, exponential 2 s → 10 s, jittered; `Retry-After` /
`retry-after-ms` honoured up to 15 min; `x-should-retry: true|false` overrides; timeouts retried ≤3 times.
`x-ratelimit-*` and `anthropic-ratelimit-*` headers feed the UI.

### `/responses` (`openai-compatible/responses`)

`POST {baseURL}/responses` with `{model, input:[…], instructions?, tools, tool_choice?, stream:true, max_output_tokens,
store:false, include:["reasoning.encrypted_content"], prompt_cache_key?}` — `store:false` and `include` are route defaults
(`dist/protocols/openai-compatible-responses.js`), so accept them. Frames are `data:` JSON objects carrying `type`.
**A terminal event is mandatory**: `response.completed`, `response.incomplete`, `response.failed` or `error`
(`TERMINAL_TYPES`, `dist/protocols/open-responses.js:663`), else `The provider response ended unexpectedly.` Text:
`response.output_text.delta`; tool args: `response.function_call_arguments.delta/done`; reasoning:
`response.reasoning_summary_text.delta` / `response.reasoning_text.delta`; usage inside `response.completed.response.usage`.

### Anthropic Messages (`anthropic-compatible`)

`POST {baseURL}/messages`, headers `anthropic-version: 2023-06-01` and **always**
`anthropic-beta: interleaved-thinking-2025-05-14` (more betas for compaction/effort/speed); auth `x-api-key` (Bearer when
`authToken` is used). Body always sends `stream: true` and `max_tokens` (default 32,000) —
`dist/protocols/anthropic-messages.js:947`.

SSE rules (`SSE_EVENTS` allowlist via `Framing.sseEvents`):

- Frames must be **named**: `message_start`, `content_block_start`, `content_block_delta`, `content_block_stop`,
  `message_delta`, `message_stop`, `ping`, `error`. Unnamed `data:` frames take the SSE default name `message`, which the
  filter drops — a proxy omitting `event:` lines yields an empty stream.
- **`message_stop` is mandatory**: it is the only source of a finish event, else
  `The provider response ended unexpectedly.`
- Ordering matters: deltas whose `content_block_start` never arrived are **silently dropped**
  (`onContentBlockDelta`). `tool_use` needs `index` and `id`.
- `message_start.message.usage` and `message_delta.usage` merge right-biased; `input_tokens` is *non-cached*, with
  `cache_read_input_tokens` / `cache_creation_input_tokens` added, `output_tokens_details.thinking_tokens` as reasoning.
- Thinking: `thinking_delta` + trailing `signature_delta` are stored per block and replayed as
  `{type:"thinking", thinking, signature}`; `redacted_thinking` round-trips verbatim. Stripping signatures breaks turn 2.
- An `error` frame becomes a provider error prefixed with `error.type`; HTTP classification is the same table.
- `ping` is accepted, never required.

### Google (`google`)

`POST {baseURL}/models/{modelID}:streamGenerateContent?alt=sse`, auth header `x-goog-api-key` (or
`GOOGLE_GENERATIVE_AI_API_KEY`). `alt=sse` is part of the path: answer with SSE, not a JSON array. Frames are plain
`data: <GenerateContentResponse>`; no `event:` names needed. A chunk must eventually carry `candidates[0].finishReason`
**or** `usageMetadata`, else no finish event exists and the turn fails (`finish()`, `dist/protocols/gemini.js:478`). Usage:
`promptTokenCount`, `candidatesTokenCount` (excludes thoughts), `thoughtsTokenCount`, `cachedContentTokenCount`. Parts:
`{text}`, `{text, thought:true}`, `{functionCall:{name,args}}`; `thoughtSignature` must be echoed on replayed parts, and
unsigned Gemini 3+ tool calls get the sentinel `skip_thought_signature_validator` (`gemini.js:17-30`). `CONTINUATION` +
`continuationToken` triggers a re-POST — don't emit it unless implemented.

## C. Model declaration (`providers.<id>.models.<id>`)

Fields actually consumed (`@opencode/core` `ModelResolver`, `dist/chunks/tool-qcsk8x8g.js`; docs
https://opencode.ai/v2/docs/providers#models):

| Field | Effect when omitted |
| --- | --- |
| `modelID` | Defaults to the map key; this exact string is sent as `model` / in the URL path |
| `package` | Inherits the provider's `package` |
| `type` | `chat`; only `chat` models are offered for sessions (`image`/`decision` use other clients) |
| `capabilities.tools` | `true` |
| `capabilities.input` / `output` | `["text","image"]` / `["text"]` |
| `limit.context` / `limit.output` | 200,000 / 32,000 (drives compaction; a wrong value causes premature or late compaction) |
| `limit.input` | unspecified (no separate input cap) |
| `cost` | absent ⇒ zero cost, spend shows 0 for that model |
| `compatibility.*` | package defaults + models.dev values for the model's API |
| `settings` / `headers` / `body` | provider-level values, merged provider → model → variant |
| `variants` | only the built-in ones from `capabilities.reasoning` |
| `disabled` | model stays selectable |
| `name`, `family`, `releaseDate` | display-only |

`canonical` inherits a catalog provider's models/defaults and supplies the identity used by the
`max_tokens`/`store`/`strict` detection. `${VAR}` in `baseURL` is substituted from the **server process env**; unresolved
placeholders fail before any HTTP with
`Cannot initialize provider/model: NAME is required to resolve the provider endpoint` (`dist/chunks/tool-qcsk8x8g.js`).

## D. Documented failure modes → gateway duties

Error table (https://opencode.ai/v2/docs/providers#errors):

| Documented error | Cause | What the gateway must do |
| --- | --- | --- |
| `No model is available for session …` | nothing selectable | expose at least one enabled model in `providers.<id>.models` |
| `Model unavailable: provider/model` | provider inactive, key missing, or model absent/disabled | keep the map key stable, don't rely on discovery |
| `Cannot initialize …: NAME is required to resolve the provider endpoint` | `${NAME}` left in `baseURL` | set the var on the server process, or hardcode the URL |
| provider-specific (`Azure resource name is missing`, Vertex, Bedrock, Ollama, Copilot) | unrelated providers | n/a |

Checklist for a custom gateway:

1. Return SSE whenever `stream: true` (always); honour `alt=sse` for Google.
2. Always finish: `finish_reason` (Chat), `message_stop` (Anthropic), `response.completed` (`/responses`),
   `finishReason`/`usageMetadata` (Gemini). Otherwise every turn fails as `incomplete-stream`.
3. Accept `max_tokens` *and* `max_completion_tokens`, plus `stream_options.include_usage`, `store: false`,
   `include: ["reasoning.encrypted_content"]`, `anthropic-beta`, `cache_control`.
4. Preserve reasoning/thinking fields and signatures verbatim and replay them unchanged.
5. Emit `usage` (at minimum `prompt_tokens`/`completion_tokens`) or spend tracking stays empty.
6. Conventional statuses: 401/403 auth, 429 + `Retry-After` throttle, 5xx retryable, 400 with a recognisable
   "prompt is too long"/`context_length_exceeded` phrase for overflow. Never return 200 with a non-protocol error body.
7. Nothing after the finish signal; no `[DONE]` after an Anthropic `message_stop`.

## E. Gateway fit — measured against this repo

Checked by reading the gateway source, not by inference. `✓` means the contract above is met.

| Requirement (from §B) | OpenAI surface (`/v1/chat/completions`) | Anthropic surface (`/v1/messages`) | Gemini surface (`/v1beta`) |
| --- | --- | --- | --- |
| SSE whenever `stream: true` | ✓ `writeSseResponse` | ✓ `writeProxySseResponse` | ✓ (always SSE for `streamGenerateContent`, `alt` unread) |
| Mandatory terminal event | ✓ `finish_reason` on the finish chunk (`openai.service.ts` ~1036) | ✓ named `event: message_stop` (`ClaudeStreamingMapper.ts:352`) | ✓ `finishReason`/`usageMetadata` |
| Nothing after the terminal event | ✓ returns after `[DONE]` | ✓ `messageStopSent` guard | ✓ |
| `[DONE]` | ✓ sent | n/a (correctly absent) | n/a |
| Usage in stream | ✓ on the finish chunk | ✓ `message_delta.usage` | ✓ `usageMetadata` |
| Tool-call deltas with `index`/`id`/`name` | ✓ | ✓ `content_block_start(tool_use)` | ✓ `functionCall` |
| Reasoning round-trip | ~ `reasoning_content` replayed as a leading `thinking` block (no signature) — see below | ✓ `thinking` + `signature_delta`, signature replayed (`ClaudeRequestMapper.ts:754`) | ~ `thoughtSignature` accepted/forwarded |
| `max_tokens` | ✓ | ✓ | n/a |
| `max_completion_tokens` | ✓ read as a fallback for `max_tokens` | n/a | n/a |
| `stream_options.include_usage` | ignored (body has no validator) — harmless, usage is always emitted | n/a | n/a |
| `store: false`, `include: [...]` | `store+stream` together is a 400 by design; `store` alone is ignored | n/a | n/a |
| `anthropic-beta`, `cache_control` | ignored | ignored, not rejected | n/a |
| Auth header | `Authorization: Bearer`, `x-api-key`, `x-goog-api-key` all accepted (`api-key-auth.util.ts`) | same | same |
| Error envelope | `{error:{message,type}}` — OpenCode reads `error.message` | `{type:"error",error:{type,message}}` | `{error:{code,message,status}}` |
| 429 + `Retry-After` | ✓ when the pool is exhausted (`applyProxyRetryAfterHeader`) | ✓ | ✓ |
| Context-overflow phrase survives | upstream text is passed through; Gemini's "input token count … exceeds the maximum" matches OpenCode's regex | same | same |
| Model discovery probed | not called by OpenCode — no requirement | same | same |

Two gaps were found and are now closed in code (`openai-claude-conversion.ts`,
`openai-claude-conversion.spec.ts`):

1. **`max_completion_tokens` is now read.** OpenCode's default for a custom `openai-compatible` provider is
   `max_completion_tokens`; the gateway previously used only `max_tokens`, silently ignoring the client's ceiling.
   `max_tokens` still wins when both are present. `compatibility.maxTokensField: "max_tokens"` is no longer needed.
2. **`reasoning_content` is now replayed** as a leading `thinking` block on prior assistant messages, so the model
   starts the next turn with its own reasoning instead of losing it.

Remaining asymmetry, by design: the OpenAI surface carries no thought signature, so a replayed reasoning block reaches
the upstream unsigned (the mapper falls back to its placeholder/absence handling). The Anthropic surface round-trips a
real `signature`, which is why `anthropic-compatible` remains the more faithful package for OpenCode.

## F. Explicit uncertainties

- Chat `[DONE]`: code tolerates its absence, docs are silent — treat it as recommended, `finish_reason` as required.
- "No usage ⇒ zero cost" is inferred from `record(event.usage, cost)` receiving `undefined`; docs say nothing.
- GitHub `dev` is ahead of 2.2.0, so line references may drift.
- `settings.encoding` (`zstd`/`gzip`) and WebSockets are documented but not on by default for these four packages; only
  `openai`/`xai`/Azure Responses opt into WS.

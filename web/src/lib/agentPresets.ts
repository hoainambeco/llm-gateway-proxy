/**
 * Client configuration snippets for agents that talk to this gateway.
 *
 * The gateway speaks three dialects, so a preset is really "which dialect plus
 * where that client expects its settings". Anything that reads a file or an env
 * var produces the literal text to paste; anything configured purely through UI
 * produces the values to type, in the order the UI asks for them.
 */

export type AgentProtocol = 'openai' | 'anthropic' | 'gemini';

export interface AgentConfigValues {
  /** Origin only — never carries `/v1`, so presets can pick the path. */
  baseUrl: string;
  apiKey: string;
  models: string[];
}

export interface AgentPreset {
  id: string;
  label: string;
  /** Grouping heading in the picker. */
  family: string;
  protocol: AgentProtocol;
  /** Where the snippet belongs: a file path, or `null` for a settings UI. */
  fileHint: string | null;
  build: (values: AgentConfigValues) => string;
  docsUrl?: string;
}

/** Placeholder shown when the user has not picked a model yet. */
const NO_MODEL = '<model-id>';

/**
 * Drops a trailing slash and a trailing `/v1` so pasted values like
 * `http://host:8044/v1/` still yield one canonical origin.
 */
export function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '').replace(/\/v1$/, '');
}

/** The nth chosen model, or a visible placeholder when the list is short. */
const at = (models: string[], index: number): string =>
  models[index] ?? NO_MODEL;

/** Every chosen model, rendered as an indented block-item. */
const all = (models: string[]): string[] =>
  models.length > 0 ? models : [NO_MODEL];

/**
 * Picks the model OpenCode should use for throwaway work (session titles and
 * the like), where latency matters more than capability.
 *
 * Blindly taking the second pick is wrong for reasoning-tier families: picking
 * `flash-tiered-high` there would route every title generation through the most
 * expensive variant. A `-low` / `-mini` / `-nano` sibling is a better signal
 * than list order.
 *
 * The pattern anchors to the end of the id. Unanchored, `flash` matches inside
 * `gemini-3.8-flash-tiered` and picks the primary model twice over.
 */
function pickSmallModel(models: string[]): string {
  const primary = at(models, 0);
  const cheap = models.find(
    (id) => id !== primary && /-(?:low|mini|nano|haiku)$/i.test(id),
  );
  return cheap ?? at(models, 1);
}

/**
 * Renders the `models` map, one entry per chosen model.
 *
 * Display names stay the full id: shortening them to a shared prefix reads
 * better in a list but makes the base model hard to identify, and an agent
 * picker is the last place to be cryptic about which model is which.
 *
 * Comma placement comes from this array's own length, never from a different
 * one — mixing the two leaves a trailing comma that JSON.parse rejects.
 */
function modelsMap(models: string[], indent: string): string[] {
  const listed = all(models);
  return listed.map(
    (model, index) =>
      `${indent}"${model}": { "name": "${model}" }${index < listed.length - 1 ? ',' : ''}`,
  );
}

export const AGENT_PRESETS: AgentPreset[] = [
  {
    id: 'opencode-anthropic',
    label: 'OpenCode — Anthropic',
    family: 'Coding agent',
    protocol: 'anthropic',
    fileHint: 'opencode.json',
    build: ({ baseUrl, apiKey, models }) => {
      // Every chosen model is declared here, not just the default pair: this
      // map is what puts the rest in OpenCode's /models picker.
      const lines = [
        `{`,
        `  "$schema": "https://opencode.ai/config.json",`,
        `  "provider": {`,
        `    "anthropic": {`,
        `      "options": {`,
        `        "baseURL": "${baseUrl}",`,
        `        "apiKey": "{env:ANTIGRAVITY_API_KEY}"`,
        `      },`,
        `      "models": {`,
        ...modelsMap(models, '        '),
        `      }`,
        `    }`,
        `  },`,
        `  "model": "anthropic/${at(models, 0)}"${models.length > 1 ? ',' : ''}`,
      ];
      if (models.length > 1) {
        lines.push(`  "small_model": "anthropic/${pickSmallModel(models)}"`);
      }
      lines.push(
        `}`,
        ``,
        `# Key không nằm trong file — OpenCode thay {env:VAR} từ biến môi trường:`,
        `export ANTIGRAVITY_API_KEY="${apiKey}"`,
        ``,
        `# Model và small_model chỉ là 2 model mặc định. Các model còn lại`,
        `# đã khai báo ở trên: mở /models trong TUI để chuyển.`,
      );
      return lines.join('\n');
    },
  },
  {
    id: 'opencode-openai',
    label: 'OpenCode — OpenAI compatible',
    family: 'Coding agent',
    protocol: 'openai',
    fileHint: 'opencode.json',
    build: ({ baseUrl, apiKey, models }) => {
      const lines = [
        `{`,
        `  "$schema": "https://opencode.ai/config.json",`,
        `  "provider": {`,
        `    "antigravity": {`,
        `      "npm": "@ai-sdk/openai-compatible",`,
        `      "name": "LLM Gateway",`,
        `      "options": {`,
        `        "baseURL": "${baseUrl}/v1",`,
        `        "apiKey": "{env:ANTIGRAVITY_API_KEY}"`,
        `      },`,
        `      "models": {`,
        ...modelsMap(models, '        '),
        `      }`,
        `    }`,
        `  },`,
        `  "model": "antigravity/${at(models, 0)}"${models.length > 1 ? ',' : ''}`,
      ];
      if (models.length > 1) {
        lines.push(`  "small_model": "antigravity/${pickSmallModel(models)}"`);
      }
      lines.push(
        `}`,
        ``,
        `# Key không nằm trong file — OpenCode thay {env:VAR} từ biến môi trường:`,
        `export ANTIGRAVITY_API_KEY="${apiKey}"`,
        ``,
        `# Model và small_model chỉ là 2 model mặc định. Các model còn lại`,
        `# đã khai báo ở trên: mở /models trong TUI để chuyển.`,
      );
      return lines.join('\n');
    },
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    family: 'CLI',
    protocol: 'anthropic',
    fileHint: '~/.bashrc hoặc ~/.zshrc',
    build: ({ baseUrl, apiKey, models }) =>
      [
        `# Claude Code — thêm vào shell profile rồi mở terminal mới`,
        `export ANTHROPIC_BASE_URL="${baseUrl}"`,
        `export ANTHROPIC_AUTH_TOKEN="${apiKey}"`,
        `export ANTHROPIC_MODEL="${at(models, 0)}"`,
        `export ANTHROPIC_SMALL_FAST_MODEL="${at(models, 1)}"`,
      ].join('\n'),
  },
  {
    id: 'gemini-cli',
    label: 'Gemini CLI',
    family: 'CLI',
    protocol: 'gemini',
    fileHint: '~/.gemini/.env',
    build: ({ baseUrl, apiKey, models }) =>
      [
        `# Gemini CLI — ghi vào ~/.gemini/.env`,
        `GOOGLE_GEMINI_BASE_URL=${baseUrl}/v1beta`,
        `GEMINI_API_KEY=${apiKey}`,
        `# model: ${at(models, 0)}`,
      ].join('\n'),
  },
  {
    id: 'aider',
    label: 'Aider',
    family: 'CLI',
    protocol: 'openai',
    fileHint: '~/.aider.conf.yml',
    build: ({ baseUrl, apiKey, models }) =>
      [
        `# Aider — model phải qua tiền tố openai/ vì aider dùng định dạng litellm`,
        `model: openai/${at(models, 0)}`,
        `openai-api-base: ${baseUrl}/v1`,
        `openai-api-key: ${apiKey}`,
      ].join('\n'),
  },
  {
    id: 'cline',
    label: 'Cline',
    family: 'VS Code / IDE',
    protocol: 'openai',
    fileHint: 'VS Code → User Settings (JSON)',
    build: ({ baseUrl, apiKey, models }) =>
      `{
  "cline.apiProvider": "openai-compatible",
  "cline.openAiCompatibleBaseUrl": "${baseUrl}/v1",
  "cline.openAiCompatibleApiKey": "${apiKey}",
  "cline.openAiCompatibleModelId": "${at(models, 0)}"
}`,
  },
  {
    id: 'roo-code',
    label: 'Roo Code',
    family: 'VS Code / IDE',
    protocol: 'openai',
    fileHint: 'VS Code → User Settings (JSON)',
    build: ({ baseUrl, apiKey, models }) =>
      `{
  "roo-cline.apiProvider": "openai-compatible",
  "roo-cline.openAiCompatibleBaseUrl": "${baseUrl}/v1",
  "roo-cline.openAiCompatibleApiKey": "${apiKey}",
  "roo-cline.openAiCompatibleModelId": "${at(models, 0)}"
}`,
  },
  {
    id: 'continue',
    label: 'Continue',
    family: 'VS Code / IDE',
    protocol: 'openai',
    fileHint: '~/.continue/config.yaml',
    build: ({ baseUrl, apiKey, models }) =>
      [
        `# Continue — mỗi model cần một entry riêng trong danh sách models`,
        `name: LLM Gateway`,
        `version: 1.0.0`,
        `schema: v1`,
        `models:`,
        ...all(models).flatMap((model) => [
          `  - name: ${model}`,
          `    provider: openai`,
          `    model: ${model}`,
          `    apiBase: ${baseUrl}/v1`,
          `    apiKey: ${apiKey}`,
        ]),
      ].join('\n'),
  },
  {
    id: 'cursor',
    label: 'Cursor',
    family: 'VS Code / IDE',
    protocol: 'openai',
    fileHint: 'Cấu hình qua UI — điền theo thứ tự dưới đây',
    build: ({ baseUrl, apiKey, models }) =>
      [
        `Cursor → Settings → Models → OpenAI`,
        ``,
        `Override OpenAI Base URL:  ${baseUrl}/v1`,
        `OpenAI API Key:            ${apiKey}`,
        `Model:                     ${at(models, 0)}`,
        ``,
        `Bật "Override OpenAI Base URL" trước khi lưu, nếu không Cursor sẽ bỏ qua URL.`,
      ].join('\n'),
  },
  {
    id: 'openai-node',
    label: 'OpenAI SDK — Node.js',
    family: 'SDK',
    protocol: 'openai',
    fileHint: 'file: agent.mjs',
    build: ({ baseUrl, apiKey, models }) =>
      `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${baseUrl}/v1",
  apiKey: "${apiKey}",
});

const stream = await client.chat.completions.create({
  model: "${at(models, 0)}",
  messages: [{ role: "user", content: "Xin chào" }],
  stream: true,
});`,
  },
  {
    id: 'openai-python',
    label: 'OpenAI SDK — Python',
    family: 'SDK',
    protocol: 'openai',
    fileHint: 'file: agent.py',
    build: ({ baseUrl, apiKey, models }) =>
      `from openai import OpenAI

client = OpenAI(
    base_url="${baseUrl}/v1",
    api_key="${apiKey}",
)

stream = client.chat.completions.create(
    model="${at(models, 0)}",
    messages=[{"role": "user", "content": "Xin chào"}],
    stream=True,
)`,
  },
  {
    id: 'anthropic-python',
    label: 'Anthropic SDK — Python',
    family: 'SDK',
    protocol: 'anthropic',
    fileHint: 'file: agent.py',
    build: ({ baseUrl, apiKey, models }) =>
      `from anthropic import Anthropic

# Endpoint Anthropic không có /v1 ở cuối
client = Anthropic(
    base_url="${baseUrl}",
    api_key="${apiKey}",
)

message = client.messages.create(
    model="${at(models, 0)}",
    max_tokens=2048,
    messages=[{"role": "user", "content": "Xin chào"}],
)`,
  },
  {
    id: 'open-webui',
    label: 'Open WebUI',
    family: 'Self-hosted UI',
    protocol: 'openai',
    fileHint: 'docker run',
    build: ({ baseUrl, apiKey, models }) =>
      `docker run -d -p 3000:8080 \\
  --add-host host.docker.internal:host-gateway \\
  -e OPENAI_API_BASE_URL=${baseUrl}/v1 \\
  -e OPENAI_API_KEY=${apiKey} \\
  --name open-webui \\
  ghcr.io/open-webui/open-webui:main

# Sau đó trong Open WebUI: Admin Panel → Connections → thêm OpenAI,
# điền Base URL + API Key, rồi chọn model: ${at(models, 0)}`,
  },
  {
    id: 'curl',
    label: 'cURL — kiểm tra nhanh',
    family: 'Self-hosted UI',
    protocol: 'openai',
    fileHint: 'terminal',
    build: ({ baseUrl, apiKey, models }) =>
      `curl ${baseUrl}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${apiKey}" \\
  -d '{
    "model": "${at(models, 0)}",
    "messages": [{"role": "user", "content": "Xin chào"}],
    "stream": true
  }'`,
  },
];

export const AGENT_FAMILIES: string[] = Array.from(
  new Set(AGENT_PRESETS.map((preset) => preset.family)),
);

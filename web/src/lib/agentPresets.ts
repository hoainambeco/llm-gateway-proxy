/**
 * Client configuration snippets for agents that talk to this gateway.
 *
 * The gateway speaks three dialects, so a preset is really "which dialect plus
 * where that client expects its settings". Anything that reads a file or an env
 * var produces the literal text to paste; anything configured through UI
 * produces the values to type, in the order that UI asks for them.
 *
 * Every preset declares the config pieces it can emit as `options`, and the
 * user decides which ones land in the output. Nothing is added silently: an
 * option that is off by default stays off until it is asked for.
 */

export type AgentProtocol = 'openai' | 'anthropic' | 'gemini';

export interface AgentConfigValues {
  /** Origin only — never carries `/v1`, so presets can pick the path. */
  baseUrl: string;
  apiKey: string;
  models: string[];
  /** Output ceiling per model id, when the server reported one. */
  outputLimits: Record<string, number>;
}

export interface ConfigOption {
  id: string;
  label: string;
  hint: string;
  hintVi?: string;
  defaultOn: boolean;
}

export interface AgentPreset {
  id: string;
  label: string;
  /** Grouping heading in the picker. */
  family: string;
  protocol: AgentProtocol;
  /** Where the snippet belongs: a file path, or `null` for a settings UI. */
  fileHint: string | null;
  options: ConfigOption[];
  build: (
    values: AgentConfigValues,
    enabled: ReadonlySet<string>,
  ) => string;
  /** Guidance printed after the snippet. */
  notes: (
    values: AgentConfigValues,
    enabled: ReadonlySet<string>,
    lang?: 'en' | 'vi',
  ) => string[];
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
const at = (models: string[], index: number): string => models[index] ?? NO_MODEL;

/** Every chosen model, or a single placeholder when none were picked. */
const all = (models: string[]): string[] =>
  models.length > 0 ? models : [NO_MODEL];

/**
 * Picks the model a client should use for throwaway work (session titles and
 * the like), where latency matters more than capability.
 *
 * Blindly taking the second pick is wrong for reasoning-tier families: routing
 * `flash-tiered-high` there would spend the most expensive variant on every
 * title. A `-low` / `-mini` / `-nano` sibling is a better signal than order.
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
 * Builds the `models` map shared by the OpenCode presets.
 *
 * `limit` carries only models the server actually reported a ceiling for, so a
 * gap in the data never turns into an invented number.
 */
function modelsMap(
  values: AgentConfigValues,
  enabled: ReadonlySet<string>,
): Record<string, { name: string; limit?: { output: number } }> {
  const withLimit = enabled.has('limit');
  const entries: Record<string, { name: string; limit?: { output: number } }> = {};
  for (const model of all(values.models)) {
    const entry: { name: string; limit?: { output: number } } = { name: model };
    const ceiling = withLimit ? values.outputLimits[model] : undefined;
    if (typeof ceiling === 'number' && Number.isFinite(ceiling) && ceiling > 0) {
      entry.limit = { output: Math.floor(ceiling) };
    }
    entries[model] = entry;
  }
  return entries;
}

/** Formats a JSON preset. Going through the object removes any comma hazard. */
const json = (value: unknown): string => JSON.stringify(value, null, 2);

const opt = (
  id: string,
  label: string,
  hintEn: string,
  hintVi: string,
  defaultOn: boolean,
): ConfigOption => ({ id, label, hint: hintEn, hintVi, defaultOn });

export const AGENT_PRESETS: AgentPreset[] = [
  {
    id: 'opencode-anthropic',
    label: 'OpenCode — Anthropic',
    family: 'Coding agent',
    protocol: 'anthropic',
    fileHint: 'opencode.json',
    options: [
      opt('provider', 'provider.anthropic', 'Point OpenCode to gateway instead of official API', 'Trỏ OpenCode về gateway thay API chính', true),
      opt('models', 'provider.anthropic.models', 'Declare models so they appear in /models picker', 'Khai báo model để chúng hiện trong /models', true),
      opt('model', 'model', 'Default primary model', 'Model dùng mặc định', true),
      opt('small_model', 'small_model', 'Cheaper model for session titles & sub-tasks', 'Model rẻ cho việc phụ (đặt tên session)', true),
      opt('limit', 'limit.output', 'Output ceiling fetched from server', 'Trần output lấy từ server', false),
    ],
    build: (values, enabled) => {
      const config: Record<string, unknown> = {
        $schema: 'https://opencode.ai/config.json',
      };

      if (enabled.has('provider')) {
        config.provider = {
          anthropic: {
            options: {
              baseURL: values.baseUrl,
              apiKey: '{env:ANTIGRAVITY_API_KEY}',
            },
            ...(enabled.has('models')
              ? { models: modelsMap(values, enabled) }
              : {}),
          },
        };
      }

      if (enabled.has('model')) {
        config.model = `anthropic/${at(values.models, 0)}`;
      }
      if (enabled.has('small_model') && values.models.length > 1) {
        config.small_model = `anthropic/${pickSmallModel(values.models)}`;
      }

      return json(config);
    },
    notes: (values, _enabled, lang) => [
      lang === 'vi'
        ? '# Key không nằm trong file — OpenCode thay {env:VAR} từ biến môi trường:'
        : '# Key is read from environment variable rather than hardcoded in file:',
      `export ANTIGRAVITY_API_KEY="${values.apiKey}"`,
    ],
  },
  {
    id: 'opencode-openai',
    label: 'OpenCode — OpenAI compatible',
    family: 'Coding agent',
    protocol: 'openai',
    fileHint: 'opencode.json',
    options: [
      opt('provider', 'provider.antigravity', 'Configure gateway as OpenAI-compatible provider', 'Khai báo gateway là provider OpenAI-compatible', true),
      opt('models', 'provider.antigravity.models', 'Declare models so they appear in /models picker', 'Khai báo model để chúng hiện trong /models', true),
      opt('model', 'model', 'Default primary model', 'Model dùng mặc định', true),
      opt('small_model', 'small_model', 'Cheaper model for session titles & sub-tasks', 'Model rẻ cho việc phụ (đặt tên session)', true),
      opt('limit', 'limit.output', 'Output ceiling fetched from server', 'Trần output lấy từ server', false),
    ],
    build: (values, enabled) => {
      const config: Record<string, unknown> = {
        $schema: 'https://opencode.ai/config.json',
      };

      if (enabled.has('provider')) {
        config.provider = {
          antigravity: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Antigravity Gateway',
            options: {
              baseURL: `${values.baseUrl}/v1`,
              apiKey: '{env:ANTIGRAVITY_API_KEY}',
            },
            ...(enabled.has('models')
              ? { models: modelsMap(values, enabled) }
              : {}),
          },
        };
      }

      if (enabled.has('model')) {
        config.model = `antigravity/${at(values.models, 0)}`;
      }
      if (enabled.has('small_model') && values.models.length > 1) {
        config.small_model = `antigravity/${pickSmallModel(values.models)}`;
      }

      return json(config);
    },
    notes: (values, _enabled, lang) => [
      lang === 'vi'
        ? '# Key không nằm trong file — OpenCode thay {env:VAR} từ biến môi trường:'
        : '# Key is read from environment variable rather than hardcoded in file:',
      `export ANTIGRAVITY_API_KEY="${values.apiKey}"`,
    ],
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    family: 'CLI',
    protocol: 'anthropic',
    fileHint: '~/.bashrc hoặc ~/.zshrc',
    options: [
      opt('base_url', 'ANTHROPIC_BASE_URL', 'Gateway endpoint (without /v1)', 'Điểm cuối của gateway (không có /v1)', true),
      opt('auth_token', 'ANTHROPIC_AUTH_TOKEN', 'Access API key', 'Key truy cập', true),
      opt('model', 'ANTHROPIC_MODEL', 'Primary model', 'Model chính', true),
      opt('small_model', 'ANTHROPIC_SMALL_FAST_MODEL', 'Small model for background tasks', 'Model nhỏ cho việc phụ', true),
      opt('telemetry', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'Disable non-essential network traffic', 'Tắt gọi không cần thiết', false),
    ],
    build: (values, enabled) => {
      const lines: string[] = [];
      if (enabled.has('base_url')) {
        lines.push(`export ANTHROPIC_BASE_URL="${values.baseUrl}"`);
      }
      if (enabled.has('auth_token')) {
        lines.push(`export ANTHROPIC_AUTH_TOKEN="${values.apiKey}"`);
      }
      if (enabled.has('model')) {
        lines.push(`export ANTHROPIC_MODEL="${at(values.models, 0)}"`);
      }
      if (enabled.has('small_model') && values.models.length > 1) {
        lines.push(
          `export ANTHROPIC_SMALL_FAST_MODEL="${pickSmallModel(values.models)}"`,
        );
      }
      if (enabled.has('telemetry')) {
        lines.push('export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1');
      }
      return lines.join('\n');
    },
    notes: (_values, _enabled, lang) => [
      lang === 'vi'
        ? '# Dán vào shell profile rồi mở terminal mới.'
        : '# Paste into shell profile, then open a new terminal.',
    ],
  },
  {
    id: 'gemini-cli',
    label: 'Gemini CLI',
    family: 'CLI',
    protocol: 'gemini',
    fileHint: '~/.gemini/.env',
    options: [
      opt('base_url', 'GOOGLE_GEMINI_BASE_URL', 'Gateway endpoint', 'Điểm cuối của gateway', true),
      opt('api_key', 'GEMINI_API_KEY', 'Access API key', 'Key truy cập', true),
      opt('model', 'model', 'Default model to use', 'Model dùng mặc định', false),
    ],
    build: (values, enabled) => {
      const lines: string[] = [];
      if (enabled.has('base_url')) {
        lines.push(`GOOGLE_GEMINI_BASE_URL=${values.baseUrl}/v1beta`);
      }
      if (enabled.has('api_key')) {
        lines.push(`GEMINI_API_KEY=${values.apiKey}`);
      }
      if (enabled.has('model')) {
        lines.push(`# model: ${at(values.models, 0)}`);
      }
      return lines.join('\n');
    },
    notes: (_values, _enabled, lang) => [
      lang === 'vi' ? '# Ghi vào ~/.gemini/.env' : '# Write to ~/.gemini/.env',
    ],
  },
  {
    id: 'aider',
    label: 'Aider',
    family: 'CLI',
    protocol: 'openai',
    fileHint: '~/.aider.conf.yml',
    options: [
      opt('model', 'model', 'Model — aider uses litellm format requiring openai/ prefix', 'Model — aider dùng định dạng litellm nên cần tiền tố openai/', true),
      opt('api_base', 'openai-api-base', 'Gateway endpoint', 'Điểm cuối của gateway', true),
      opt('api_key', 'openai-api-key', 'Access API key', 'Key truy cập', true),
    ],
    build: (values, enabled) => {
      const lines: string[] = [];
      if (enabled.has('model')) {
        lines.push(`model: openai/${at(values.models, 0)}`);
      }
      if (enabled.has('api_base')) {
        lines.push(`openai-api-base: ${values.baseUrl}/v1`);
      }
      if (enabled.has('api_key')) {
        lines.push(`openai-api-key: ${values.apiKey}`);
      }
      return lines.join('\n');
    },
    notes: () => [],
  },
  {
    id: 'cline',
    label: 'Cline',
    family: 'VS Code / IDE',
    protocol: 'openai',
    fileHint: 'VS Code → User Settings (JSON)',
    options: [
      opt('api_provider', 'cline.apiProvider', 'openai-compatible', 'openai-compatible', true),
      opt('base_url', 'cline.openAiCompatibleBaseUrl', 'Gateway endpoint', 'Điểm cuối của gateway', true),
      opt('api_key', 'cline.openAiCompatibleApiKey', 'Access API key', 'Key truy cập', true),
      opt('model', 'cline.openAiCompatibleModelId', 'Model ID to use', 'Model dùng', true),
    ],
    build: (values, enabled) => {
      const settings: Record<string, unknown> = {};
      if (enabled.has('api_provider')) {
        settings['cline.apiProvider'] = 'openai-compatible';
      }
      if (enabled.has('base_url')) {
        settings['cline.openAiCompatibleBaseUrl'] = `${values.baseUrl}/v1`;
      }
      if (enabled.has('api_key')) {
        settings['cline.openAiCompatibleApiKey'] = values.apiKey;
      }
      if (enabled.has('model')) {
        settings['cline.openAiCompatibleModelId'] = at(values.models, 0);
      }
      return json(settings);
    },
    notes: () => [],
  },
  {
    id: 'roo-code',
    label: 'Roo Code',
    family: 'VS Code / IDE',
    protocol: 'openai',
    fileHint: 'VS Code → User Settings (JSON)',
    options: [
      opt('api_provider', 'roo-cline.apiProvider', 'openai-compatible', 'openai-compatible', true),
      opt('base_url', 'roo-cline.openAiCompatibleBaseUrl', 'Gateway endpoint', 'Điểm cuối của gateway', true),
      opt('api_key', 'roo-cline.openAiCompatibleApiKey', 'Access API key', 'Key truy cập', true),
      opt('model', 'roo-cline.openAiCompatibleModelId', 'Model ID to use', 'Model dùng', true),
    ],
    build: (values, enabled) => {
      const settings: Record<string, unknown> = {};
      if (enabled.has('api_provider')) {
        settings['roo-cline.apiProvider'] = 'openai-compatible';
      }
      if (enabled.has('base_url')) {
        settings['roo-cline.openAiCompatibleBaseUrl'] = `${values.baseUrl}/v1`;
      }
      if (enabled.has('api_key')) {
        settings['roo-cline.openAiCompatibleApiKey'] = values.apiKey;
      }
      if (enabled.has('model')) {
        settings['roo-cline.openAiCompatibleModelId'] = at(values.models, 0);
      }
      return json(settings);
    },
    notes: () => [],
  },
  {
    id: 'continue',
    label: 'Continue',
    family: 'VS Code / IDE',
    protocol: 'openai',
    fileHint: '~/.continue/config.yaml',
    options: [
      opt('header', 'name / version / schema', 'File header required by Continue', 'Phần đầu file, Continue cần để đọc config', true),
      opt('models', 'models[]', 'One entry per model with apiBase and apiKey', 'Mỗi model một entry, có apiBase + apiKey', true),
    ],
    build: (values, enabled) => {
      const lines: string[] = [];
      if (enabled.has('header')) {
        lines.push('name: Antigravity Gateway', 'version: 1.0.0', 'schema: v1');
      }
      if (enabled.has('models')) {
        lines.push('models:');
        for (const model of all(values.models)) {
          lines.push(
            `  - name: ${model}`,
            '    provider: openai',
            `    model: ${model}`,
            `    apiBase: ${values.baseUrl}/v1`,
            `    apiKey: ${values.apiKey}`,
          );
        }
      }
      return lines.join('\n');
    },
    notes: () => [],
  },
  {
    id: 'cursor',
    label: 'Cursor',
    family: 'VS Code / IDE',
    protocol: 'openai',
    fileHint: 'Cấu hình qua UI — điền theo thứ tự dưới đây',
    options: [
      opt('base_url', 'Override OpenAI Base URL', 'Must enable override, otherwise Cursor ignores URL', 'Phải bật nút override, nếu không Cursor bỏ qua URL', true),
      opt('api_key', 'OpenAI API Key', 'Access API key', 'Key truy cập', true),
      opt('model', 'Model', 'Model ID to use', 'Model dùng', true),
    ],
    build: (values, enabled) => {
      const lines: string[] = ['Cursor → Settings → Models → OpenAI'];
      if (enabled.has('base_url')) {
        lines.push('', `Override OpenAI Base URL:  ${values.baseUrl}/v1`);
      }
      if (enabled.has('api_key')) {
        lines.push(`OpenAI API Key:            ${values.apiKey}`);
      }
      if (enabled.has('model')) {
        lines.push(`Model:                     ${at(values.models, 0)}`);
      }
      return lines.join('\n');
    },
    notes: () => [],
  },
  {
    id: 'openai-node',
    label: 'OpenAI SDK — Node.js',
    family: 'SDK',
    protocol: 'openai',
    fileHint: 'file: agent.mjs',
    options: [
      opt('client', 'client', 'Initialize OpenAI client pointing to gateway', 'Khởi tạo client trỏ về gateway', true),
      opt('request', 'chat.completions.create', 'Call chat completions API', 'Gọi chat completions', true),
      opt('stream', 'stream: true', 'Stream completion responses', 'Nhận phản hồi dạng stream', false),
    ],
    build: (values, enabled) => {
      const chunks: string[] = [];
      if (enabled.has('client')) {
        chunks.push(
          'import OpenAI from "openai";',
          '',
          'const client = new OpenAI({',
          `  baseURL: "${values.baseUrl}/v1",`,
          `  apiKey: "${values.apiKey}",`,
          '});',
        );
      }
      if (enabled.has('request')) {
        chunks.push(
          '',
          'const stream = await client.chat.completions.create({',
          `  model: "${at(values.models, 0)}",`,
          '  messages: [{ role: "user", content: "Xin chào" }],',
          ...(enabled.has('stream') ? ['  stream: true,'] : []),
          '});',
        );
      }
      return chunks.join('\n');
    },
    notes: () => [],
  },
  {
    id: 'openai-python',
    label: 'OpenAI SDK — Python',
    family: 'SDK',
    protocol: 'openai',
    fileHint: 'file: agent.py',
    options: [
      opt('client', 'client', 'Initialize OpenAI client pointing to gateway', 'Khởi tạo client trỏ về gateway', true),
      opt('request', 'chat.completions.create', 'Call chat completions API', 'Gọi chat completions', true),
      opt('stream', 'stream=True', 'Stream completion responses', 'Nhận phản hồi dạng stream', false),
    ],
    build: (values, enabled) => {
      const chunks: string[] = [];
      if (enabled.has('client')) {
        chunks.push(
          'from openai import OpenAI',
          '',
          'client = OpenAI(',
          `    base_url="${values.baseUrl}/v1",`,
          `    api_key="${values.apiKey}",`,
          ')',
        );
      }
      if (enabled.has('request')) {
        chunks.push(
          '',
          'stream = client.chat.completions.create(',
          `    model="${at(values.models, 0)}",`,
          '    messages=[{"role": "user", "content": "Xin chào"}],',
          ...(enabled.has('stream') ? ['    stream=True,'] : []),
          ')',
        );
      }
      return chunks.join('\n');
    },
    notes: () => [],
  },
  {
    id: 'anthropic-python',
    label: 'Anthropic SDK — Python',
    family: 'SDK',
    protocol: 'anthropic',
    fileHint: 'file: agent.py',
    options: [
      opt('client', 'client', 'Initialize Anthropic client (no /v1 suffix)', 'Khởi tạo client — Anthropic không có /v1 ở cuối', true),
      opt('request', 'messages.create', 'Call messages API', 'Gọi messages', true),
    ],
    build: (values, enabled) => {
      const chunks: string[] = [];
      if (enabled.has('client')) {
        chunks.push(
          'from anthropic import Anthropic',
          '',
          'client = Anthropic(',
          `    base_url="${values.baseUrl}",`,
          `    api_key="${values.apiKey}",`,
          ')',
        );
      }
      if (enabled.has('request')) {
        chunks.push(
          '',
          'message = client.messages.create(',
          `    model="${at(values.models, 0)}",`,
          '    max_tokens=2048,',
          '    messages=[{"role": "user", "content": "Xin chào"}],',
          ')',
        );
      }
      return chunks.join('\n');
    },
    notes: () => [],
  },
  {
    id: 'open-webui',
    label: 'Open WebUI',
    family: 'Self-hosted UI',
    protocol: 'openai',
    fileHint: 'docker run',
    options: [
      opt('docker', 'docker run', 'Container run command', 'Lệnh khởi chạy container', true),
      opt('admin_steps', 'Admin Panel steps', 'Connection steps in Admin Panel', 'Thêm connection sau khi container chạy', false),
    ],
    build: (values, enabled) => {
      if (!enabled.has('docker')) {
        return '';
      }
      return [
        'docker run -d -p 3000:8080 \\',
        '  --add-host host.docker.internal:host-gateway \\',
        `  -e OPENAI_API_BASE_URL=${values.baseUrl}/v1 \\`,
        `  -e OPENAI_API_KEY=${values.apiKey} \\`,
        '  --name open-webui \\',
        '  ghcr.io/open-webui/open-webui:main',
      ].join('\n');
    },
    notes: (_values, enabled, lang) =>
      enabled.has('admin_steps')
        ? [
            '',
            lang === 'vi'
              ? '# Trong Open WebUI: Admin Panel → Connections → thêm OpenAI,'
              : '# In Open WebUI: Admin Panel → Connections → add OpenAI,',
            lang === 'vi'
              ? '# điền Base URL + API Key, rồi chọn model.'
              : '# enter Base URL + API Key, then select model.',
          ]
        : [],
  },
  {
    id: 'curl',
    label: 'cURL',
    family: 'Self-hosted UI',
    protocol: 'openai',
    fileHint: 'terminal',
    options: [
      opt('endpoint', 'URL', 'Chat completions endpoint URL', 'Đường dẫn chat completions', true),
      opt('headers', '-H', 'Content-Type and Authorization headers', 'Content-Type và Authorization', true),
      opt('body', '-d', 'JSON request payload', 'Payload gửi lên', true),
      opt('stream', '"stream": true', 'Stream response', 'Phản hồi dạng stream', false),
    ],
    build: (values, enabled) => {
      const lines: string[] = [];
      if (enabled.has('endpoint')) {
        lines.push(`curl ${values.baseUrl}/v1/chat/completions \\`);
      }
      if (enabled.has('headers')) {
        lines.push('  -H "Content-Type: application/json" \\');
        lines.push(`  -H "Authorization: Bearer ${values.apiKey}" \\`);
      }
      if (enabled.has('body')) {
        const payload = [
          '{',
          `    "model": "${at(values.models, 0)}",`,
          '    "messages": [{"role": "user", "content": "Xin chào"}]',
          ...(enabled.has('stream') ? ['    ,"stream": true'] : []),
          '}',
        ].join('\n');
        lines.push(`  -d '${payload}'`);
      }
      return lines.join('\n');
    },
    notes: () => [],
  },
];

export const AGENT_FAMILIES: string[] = Array.from(
  new Set(AGENT_PRESETS.map((preset) => preset.family)),
);

/** Option ids a preset starts with turned on. */
export function defaultEnabled(preset: AgentPreset): Set<string> {
  return new Set(
    preset.options.filter((option) => option.defaultOn).map((o) => o.id),
  );
}

export interface PlaygroundMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface PlaygroundConfig {
  baseUrl: string; // e.g. http://localhost:8045/v1
  apiKey: string; // Bearer token or placeholder
  model: string;
  systemPrompt?: string;
  messages: PlaygroundMessage[];
  temperature: number;
  maxTokens?: number;
  stream: boolean;
}

function cleanBaseUrl(url: string): string {
  return url.trim().replace(/\/chat\/completions\/?$/, '').replace(/\/+$/, '');
}

function getEndpointUrl(baseUrl: string): string {
  const clean = cleanBaseUrl(baseUrl);
  return `${clean}/chat/completions`;
}

function resolveMessages(config: PlaygroundConfig): PlaygroundMessage[] {
  const list: PlaygroundMessage[] = [];
  if (config.systemPrompt && config.systemPrompt.trim().length > 0) {
    list.push({ role: 'system', content: config.systemPrompt });
  }
  list.push(...config.messages);
  return list;
}

function formatPythonMessages(messages: PlaygroundMessage[]): string {
  if (messages.length === 0) return '[]';
  const lines = messages.map(
    (m) => `        {"role": "${m.role}", "content": ${JSON.stringify(m.content)}},`,
  );
  return `[\n${lines.join('\n')}\n    ]`;
}

function formatNodeMessages(messages: PlaygroundMessage[]): string {
  if (messages.length === 0) return '[]';
  const lines = messages.map(
    (m) => `    { role: "${m.role}", content: ${JSON.stringify(m.content)} },`,
  );
  return `[\n${lines.join('\n')}\n  ]`;
}

function formatFetchMessages(messages: PlaygroundMessage[]): string {
  if (messages.length === 0) return '[]';
  const lines = messages.map(
    (m) => `      { role: "${m.role}", content: ${JSON.stringify(m.content)} },`,
  );
  return `[\n${lines.join('\n')}\n    ]`;
}

export function generateCurl(config: PlaygroundConfig): string {
  const endpoint = getEndpointUrl(config.baseUrl);
  const messages = resolveMessages(config);

  const payload: Record<string, unknown> = {
    model: config.model,
    messages,
    temperature: config.temperature,
    ...(config.maxTokens !== undefined ? { max_tokens: config.maxTokens } : {}),
    stream: config.stream,
  };

  const jsonStr = JSON.stringify(payload, null, 2);
  // In bash, escape single quotes inside single-quoted string with '\''
  const escapedJson = jsonStr.replace(/'/g, `'\\''`);

  return `curl -X POST "${endpoint}" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${config.apiKey}" \\
  -d '${escapedJson}'`;
}

export function generatePython(config: PlaygroundConfig): string {
  const baseUrl = cleanBaseUrl(config.baseUrl);
  const messages = resolveMessages(config);
  const messagesFormatted = formatPythonMessages(messages);
  const streamBool = config.stream ? 'True' : 'False';
  const maxTokensParam =
    config.maxTokens !== undefined ? `\n    max_tokens=${config.maxTokens},` : '';

  if (config.stream) {
    return `from openai import OpenAI

client = OpenAI(
    base_url="${baseUrl}",
    api_key="${config.apiKey}",
)

stream = client.chat.completions.create(
    model="${config.model}",
    messages=${messagesFormatted},
    temperature=${config.temperature},${maxTokensParam}
    stream=${streamBool},
)

for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="")
`;
  }

  return `from openai import OpenAI

client = OpenAI(
    base_url="${baseUrl}",
    api_key="${config.apiKey}",
)

response = client.chat.completions.create(
    model="${config.model}",
    messages=${messagesFormatted},
    temperature=${config.temperature},${maxTokensParam}
    stream=${streamBool},
)

print(response.choices[0].message.content)
`;
}

export function generateNode(config: PlaygroundConfig): string {
  const baseUrl = cleanBaseUrl(config.baseUrl);
  const messages = resolveMessages(config);
  const messagesFormatted = formatNodeMessages(messages);
  const maxTokensParam =
    config.maxTokens !== undefined ? `\n  max_tokens: ${config.maxTokens},` : '';

  if (config.stream) {
    return `import OpenAI from "openai";

const openai = new OpenAI({
  baseURL: "${baseUrl}",
  apiKey: "${config.apiKey}",
});

const stream = await openai.chat.completions.create({
  model: "${config.model}",
  messages: ${messagesFormatted},
  temperature: ${config.temperature},${maxTokensParam}
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content || "");
}
`;
  }

  return `import OpenAI from "openai";

const openai = new OpenAI({
  baseURL: "${baseUrl}",
  apiKey: "${config.apiKey}",
});

const response = await openai.chat.completions.create({
  model: "${config.model}",
  messages: ${messagesFormatted},
  temperature: ${config.temperature},${maxTokensParam}
  stream: false,
});

console.log(response.choices[0].message.content);
`;
}

export function generateFetch(config: PlaygroundConfig): string {
  const endpoint = getEndpointUrl(config.baseUrl);
  const messages = resolveMessages(config);
  const messagesFormatted = formatFetchMessages(messages);
  const maxTokensParam =
    config.maxTokens !== undefined ? `\n      max_tokens: ${config.maxTokens},` : '';

  if (config.stream) {
    return `const response = await fetch("${endpoint}", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer ${config.apiKey}",
  },
  body: JSON.stringify({
    model: "${config.model}",
    messages: ${messagesFormatted},
    temperature: ${config.temperature},${maxTokensParam}
    stream: true,
  }),
});

const reader = response.body?.getReader();
const decoder = new TextDecoder();

while (reader) {
  const { done, value } = await reader.read();
  if (done) break;
  const chunk = decoder.decode(value);
  console.log(chunk);
}
`;
  }

  return `const response = await fetch("${endpoint}", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer ${config.apiKey}",
  },
  body: JSON.stringify({
    model: "${config.model}",
    messages: ${messagesFormatted},
    temperature: ${config.temperature},${maxTokensParam}
    stream: false,
  }),
});

const data = await response.json();
console.log(data.choices[0].message.content);
`;
}

import {
  generateCurl,
  generatePython,
  generateNode,
  generateFetch,
  type PlaygroundConfig,
  type PlaygroundMessage,
} from './codeSamples';

describe('codeSamples utility', () => {
  const baseConfig: PlaygroundConfig = {
    baseUrl: 'http://localhost:8045/v1',
    apiKey: 'sk-test-admin-key-12345',
    model: 'gemini-2.5-pro',
    messages: [
      { role: 'user', content: 'Explain quantum computing in one sentence.' },
    ],
    temperature: 0.7,
    stream: false,
  };

  describe('generateCurl', () => {
    it('produces a valid curl command with headers, endpoint, and payload', () => {
      const curl = generateCurl(baseConfig);

      expect(curl).toContain('curl -X POST');
      expect(curl).toContain('"http://localhost:8045/v1/chat/completions"');
      expect(curl).toContain('-H "Content-Type: application/json"');
      expect(curl).toContain('-H "Authorization: Bearer sk-test-admin-key-12345"');
      expect(curl).toContain('"model": "gemini-2.5-pro"');
      expect(curl).toContain('"temperature": 0.7');
      expect(curl).toContain('"stream": false');
      expect(curl).toContain('"role": "user"');
      expect(curl).toContain('Explain quantum computing in one sentence.');
    });

    it('handles trailing slashes on baseUrl gracefully', () => {
      const curl = generateCurl({
        ...baseConfig,
        baseUrl: 'http://localhost:8045/v1/',
      });

      expect(curl).toContain('"http://localhost:8045/v1/chat/completions"');
      expect(curl).not.toContain('//chat/completions');
    });

    it('includes max_tokens when specified', () => {
      const curl = generateCurl({
        ...baseConfig,
        maxTokens: 2048,
      });

      expect(curl).toContain('"max_tokens": 2048');
    });

    it('sets stream to true when requested', () => {
      const curl = generateCurl({
        ...baseConfig,
        stream: true,
      });

      expect(curl).toContain('"stream": true');
    });

    it('escapes single quotes in message content safely for bash', () => {
      const curl = generateCurl({
        ...baseConfig,
        messages: [{ role: 'user', content: "It's a test with 'quotes'" }],
      });

      expect(curl).toContain("It'\\''s a test with '\\''quotes'\\''");
    });
  });

  describe('generatePython', () => {
    it('produces a valid Python script using the official openai SDK for non-streaming', () => {
      const py = generatePython(baseConfig);

      expect(py).toContain('from openai import OpenAI');
      expect(py).toContain('client = OpenAI(');
      expect(py).toContain('base_url="http://localhost:8045/v1"');
      expect(py).toContain('api_key="sk-test-admin-key-12345"');
      expect(py).toContain('response = client.chat.completions.create(');
      expect(py).toContain('model="gemini-2.5-pro"');
      expect(py).toContain('temperature=0.7');
      expect(py).toContain('stream=False');
      expect(py).toContain('print(response.choices[0].message.content)');
      expect(py).not.toContain('for chunk in stream:');
    });

    it('produces streaming loop when stream is true', () => {
      const py = generatePython({
        ...baseConfig,
        stream: true,
      });

      expect(py).toContain('stream = client.chat.completions.create(');
      expect(py).toContain('stream=True');
      expect(py).toContain('for chunk in stream:');
      expect(py).toContain('print(chunk.choices[0].delta.content or "", end="")');
    });

    it('includes max_tokens parameter when specified', () => {
      const py = generatePython({
        ...baseConfig,
        maxTokens: 1024,
      });

      expect(py).toContain('max_tokens=1024');
    });

    it('strips /chat/completions if present in baseUrl', () => {
      const py = generatePython({
        ...baseConfig,
        baseUrl: 'http://localhost:8045/v1/chat/completions',
      });

      expect(py).toContain('base_url="http://localhost:8045/v1"');
    });
  });

  describe('generateNode', () => {
    it('produces valid TypeScript/JavaScript using import OpenAI from "openai"', () => {
      const node = generateNode(baseConfig);

      expect(node).toContain('import OpenAI from "openai";');
      expect(node).toContain('const openai = new OpenAI({');
      expect(node).toContain('baseURL: "http://localhost:8045/v1"');
      expect(node).toContain('apiKey: "sk-test-admin-key-12345"');
      expect(node).toContain('const response = await openai.chat.completions.create({');
      expect(node).toContain('model: "gemini-2.5-pro"');
      expect(node).toContain('temperature: 0.7');
      expect(node).toContain('stream: false');
      expect(node).toContain('console.log(response.choices[0].message.content);');
    });

    it('handles stream: true with async for loop in Node', () => {
      const node = generateNode({
        ...baseConfig,
        stream: true,
      });

      expect(node).toContain('const stream = await openai.chat.completions.create({');
      expect(node).toContain('stream: true');
      expect(node).toContain('for await (const chunk of stream)');
      expect(node).toContain('process.stdout.write(chunk.choices[0]?.delta?.content || "");');
    });

    it('includes max_tokens when specified in Node', () => {
      const node = generateNode({
        ...baseConfig,
        maxTokens: 4096,
      });

      expect(node).toContain('max_tokens: 4096');
    });
  });

  describe('generateFetch', () => {
    it('produces valid native fetch() call for non-streaming', () => {
      const js = generateFetch(baseConfig);

      expect(js).toContain('const response = await fetch("http://localhost:8045/v1/chat/completions", {');
      expect(js).toContain('method: "POST"');
      expect(js).toContain('"Content-Type": "application/json"');
      expect(js).toContain('"Authorization": "Bearer sk-test-admin-key-12345"');
      expect(js).toContain('JSON.stringify({');
      expect(js).toContain('stream: false');
      expect(js).toContain('const data = await response.json();');
      expect(js).toContain('console.log(data.choices[0].message.content);');
    });

    it('handles streaming fetch with ReadableStream reader and TextDecoder', () => {
      const js = generateFetch({
        ...baseConfig,
        stream: true,
      });

      expect(js).toContain('stream: true');
      expect(js).toContain('const reader = response.body?.getReader();');
      expect(js).toContain('const decoder = new TextDecoder();');
      expect(js).toContain('while (reader)');
      expect(js).toContain('const { done, value } = await reader.read();');
    });

    it('includes max_tokens in fetch body when specified', () => {
      const js = generateFetch({
        ...baseConfig,
        maxTokens: 512,
      });

      expect(js).toContain('max_tokens: 512');
    });
  });

  describe('systemPrompt handling across all generators', () => {
    const configWithSystem: PlaygroundConfig = {
      ...baseConfig,
      systemPrompt: 'You are a sarcastic robot.',
      messages: [
        { role: 'user', content: 'What is 2+2?' },
      ],
    };

    it('prepends system message in generateCurl without mutating original messages', () => {
      const originalMessagesCopy: PlaygroundMessage[] = [...configWithSystem.messages];
      const curl = generateCurl(configWithSystem);

      expect(curl).toContain('"role": "system"');
      expect(curl).toContain('"content": "You are a sarcastic robot."');
      expect(configWithSystem.messages).toEqual(originalMessagesCopy);
    });

    it('prepends system message in generatePython', () => {
      const py = generatePython(configWithSystem);

      expect(py).toContain('{"role": "system", "content": "You are a sarcastic robot."}');
    });

    it('prepends system message in generateNode', () => {
      const node = generateNode(configWithSystem);

      expect(node).toContain('{ role: "system", content: "You are a sarcastic robot." }');
    });

    it('prepends system message in generateFetch', () => {
      const js = generateFetch(configWithSystem);

      expect(js).toContain('{ role: "system", content: "You are a sarcastic robot." }');
    });

    it('ignores empty or whitespace-only systemPrompt', () => {
      const configEmptySystem: PlaygroundConfig = {
        ...baseConfig,
        systemPrompt: '   \n  ',
      };

      const curl = generateCurl(configEmptySystem);
      expect(curl).not.toContain('"role": "system"');

      const py = generatePython(configEmptySystem);
      expect(py).not.toContain('"role": "system"');

      const node = generateNode(configEmptySystem);
      expect(node).not.toContain('role: "system"');

      const js = generateFetch(configEmptySystem);
      expect(js).not.toContain('role: "system"');
    });
  });
});

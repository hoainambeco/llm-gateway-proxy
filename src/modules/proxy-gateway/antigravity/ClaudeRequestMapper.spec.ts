import { transformClaudeRequestIn } from './ClaudeRequestMapper';
import type { ClaudeRequest } from './types';

describe('ClaudeRequestMapper', () => {
  it('maps max_tokens to maxOutputTokens in generationConfig', () => {
    const claudeReq: ClaudeRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 1234,
    };

    const result = transformClaudeRequestIn(claudeReq, 'test-project');
    expect(result.request.generationConfig?.maxOutputTokens).toBe(1234);
  });

  it('preserves system prompt and user messages in order', () => {
    const claudeReq: ClaudeRequest = {
      model: 'claude-3-5-sonnet-20241022',
      system: 'You are a helpful coding assistant.',
      messages: [
        { role: 'user', content: 'Step 1' },
        { role: 'assistant', content: 'Reply 1' },
        { role: 'user', content: 'Step 2' },
      ],
      max_tokens: 100,
    };

    const result = transformClaudeRequestIn(claudeReq, 'test-project');
    expect(result.request.systemInstruction?.parts[0]?.text).toContain('helpful coding assistant');
    expect(result.request.contents).toHaveLength(3);
    expect(result.request.contents[0].role).toBe('user');
    expect(result.request.contents[0].parts[0].text).toBe('Step 1');
    expect(result.request.contents[1].role).toBe('model');
    expect(result.request.contents[1].parts[0].text).toBe('Reply 1');
    expect(result.request.contents[2].role).toBe('user');
    expect(result.request.contents[2].parts[0].text).toBe('Step 2');
  });

  it('preserves tools declarations and order', () => {
    const claudeReq: ClaudeRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [{ role: 'user', content: 'check weather' }],
      tools: [
        {
          name: 'get_weather',
          description: 'Get weather for location',
          input_schema: {
            type: 'object',
            properties: { location: { type: 'string' } },
            required: ['location'],
          },
        },
        {
          name: 'get_time',
          description: 'Get time for location',
          input_schema: {
            type: 'object',
            properties: { location: { type: 'string' } },
          },
        },
      ],
      max_tokens: 50,
    };

    const result = transformClaudeRequestIn(claudeReq, 'test-project');
    const fnDeclarations = result.request.tools?.[0]?.functionDeclarations;
    expect(fnDeclarations).toBeDefined();
    expect(fnDeclarations?.map((f) => f.name)).toEqual(['get_time', 'get_weather']);
  });

  it('converts base64 image content preserving mimeType and data', () => {
    const claudeReq: ClaudeRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'what is in this picture?' },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
              },
            },
          ],
        },
      ],
      max_tokens: 100,
    };

    const result = transformClaudeRequestIn(claudeReq, 'test-project');
    const parts = result.request.contents[0].parts;
    expect(parts).toHaveLength(2);
    expect(parts[0].text).toBe('what is in this picture?');
    expect(parts[1].inlineData).toEqual({
      mimeType: 'image/png',
      data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    });
  });

  it('maps tool_choice modes: none, auto, and specific tool choice', () => {
    const baseTools = [
      {
        name: 'get_weather',
        description: 'Get weather',
        input_schema: { type: 'object' },
      },
    ];
    const noneReq: ClaudeRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 10,
      tools: baseTools,
      tool_choice: 'none',
    };
    expect(
      transformClaudeRequestIn(noneReq, 'test').request.toolConfig?.functionCallingConfig?.mode,
    ).toBe('NONE');

    const autoReq: ClaudeRequest = {
      ...noneReq,
      tool_choice: 'auto',
    };
    expect(
      transformClaudeRequestIn(autoReq, 'test').request.toolConfig?.functionCallingConfig?.mode,
    ).toBe('AUTO');

    const anyReq: ClaudeRequest = {
      ...noneReq,
      tool_choice: 'any',
    };
    expect(
      transformClaudeRequestIn(anyReq, 'test').request.toolConfig?.functionCallingConfig?.mode,
    ).toBe('ANY');

    const toolObjReq: ClaudeRequest = {
      ...noneReq,
      tool_choice: { type: 'tool', name: 'get_weather' } as any,
    };
    expect(
      transformClaudeRequestIn(toolObjReq, 'test').request.toolConfig?.functionCallingConfig?.mode,
    ).toBe('ANY');
  });

  it('maps sampling parameters: temperature, top_p, top_k', () => {
    const claudeReq: ClaudeRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [{ role: 'user', content: 'test' }],
      max_tokens: 100,
      temperature: 0.7,
      top_p: 0.95,
      top_k: 40,
    };

    const result = transformClaudeRequestIn(claudeReq, 'test-project');
    const config = result.request.generationConfig;
    expect(config?.temperature).toBe(0.7);
    expect(config?.topP).toBe(0.95);
    expect(config?.topK).toBe(40);
  });

  it('maps thinking configuration and budget', () => {
    const claudeReq: ClaudeRequest = {
      model: 'claude-3-7-sonnet-20250219',
      messages: [{ role: 'user', content: 'think hard' }],
      max_tokens: 4096,
      thinking: {
        type: 'enabled',
        budget_tokens: 2048,
      },
    };

    const result = transformClaudeRequestIn(claudeReq, 'test-project');
    expect(result.request.generationConfig?.thinkingConfig?.thinkingBudget).toBe(2048);
  });

  it('maps tool_use and tool_result multi-turn blocks correctly', () => {
    const claudeReq: ClaudeRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [
        {
          role: 'user',
          content: 'what is the weather?',
        },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'call_123',
              name: 'get_weather',
              input: { location: 'Tokyo' },
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'call_123',
              content: 'Sunny, 22C',
            },
          ],
        },
      ],
      max_tokens: 200,
    };

    const result = transformClaudeRequestIn(claudeReq, 'test-project');
    const contents = result.request.contents;
    expect(contents).toHaveLength(3);
    // Model turn contains functionCall
    expect(contents[1].parts[0].functionCall).toEqual({
      id: 'call_123',
      name: 'get_weather',
      args: { location: 'Tokyo' },
    });
    // User response turn contains functionResponse
    expect(contents[2].parts[0].functionResponse).toBeDefined();
    expect(contents[2].parts[0].functionResponse?.name).toBe('get_weather');
  });

  it('handles system prompt as an array of content blocks', () => {
    const claudeReq: ClaudeRequest = {
      model: 'claude-3-5-sonnet-20241022',
      system: [
        { type: 'text', text: 'System instruction line 1' } as any,
        { type: 'text', text: 'System instruction line 2' } as any,
      ],
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 50,
    };

    const result = transformClaudeRequestIn(claudeReq, 'test-project');
    const sysText = result.request.systemInstruction?.parts[0]?.text;
    expect(sysText).toContain('System instruction line 1');
    expect(sysText).toContain('System instruction line 2');
  });

  it('maps response_format json_object and json_schema', () => {
    const jsonObjectReq: ClaudeRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [{ role: 'user', content: 'respond in json' }],
      max_tokens: 100,
      response_format: { type: 'json_object' },
    };
    const jsonObjectRes = transformClaudeRequestIn(jsonObjectReq, 'test');
    expect(jsonObjectRes.request.generationConfig?.responseMimeType).toBe('application/json');

    const jsonSchemaReq: ClaudeRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [{ role: 'user', content: 'respond in schema' }],
      max_tokens: 100,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'person',
          schema: {
            type: 'object',
            properties: { name: { type: 'string' } },
          },
        },
      },
    };
    const jsonSchemaRes = transformClaudeRequestIn(jsonSchemaReq, 'test');
    expect(jsonSchemaRes.request.generationConfig?.responseMimeType).toBe('application/json');
    expect(jsonSchemaRes.request.generationConfig?.responseSchema).toBeDefined();
  });

  it('handles openai source path with presence_penalty, frequency_penalty, seed, and stop_sequences', () => {
    const openAiReq: ClaudeRequest = {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 50,
      presence_penalty: 0.5,
      frequency_penalty: 0.2,
      seed: 42,
      stop_sequences: ['STOP'],
      metadata: { source: 'openai' },
    };

    const res = transformClaudeRequestIn(openAiReq, 'test', undefined, 'openai');
    const config = res.request.generationConfig;
    expect(config?.presencePenalty).toBe(0.5);
    expect(config?.frequencyPenalty).toBe(0.2);
    expect(config?.seed).toBe(42);
    expect(config?.stopSequences).toEqual(['STOP']);
  });
});

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
});

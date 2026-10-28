import { convertOpenAIToClaude } from './openai-claude-conversion';
import type { OpenAIChatRequest } from '@/modules/proxy-gateway/server/common/interfaces/request-interfaces';

function request(overrides: Partial<OpenAIChatRequest> = {}): OpenAIChatRequest {
  return {
    model: 'gemini-3-flash',
    messages: [{ role: 'user', content: 'hi' }],
    ...overrides,
  } as OpenAIChatRequest;
}

describe('convertOpenAIToClaude — output token limit', () => {
  it('honours max_completion_tokens when max_tokens is absent', () => {
    const converted = convertOpenAIToClaude(request({ max_completion_tokens: 4096 }));

    expect(converted.max_tokens).toBe(4096);
  });

  it('prefers max_tokens when the client sends both fields', () => {
    const converted = convertOpenAIToClaude(
      request({ max_tokens: 512, max_completion_tokens: 4096 }),
    );

    expect(converted.max_tokens).toBe(512);
  });
});

describe('convertOpenAIToClaude — assistant reasoning replay', () => {
  it('replays reasoning_content as a leading thinking block', () => {
    const converted = convertOpenAIToClaude(
      request({
        messages: [
          { role: 'user', content: 'hi' },
          {
            role: 'assistant',
            content: 'the answer',
            reasoning_content: 'because of the constraint',
          },
          { role: 'user', content: 'next' },
        ],
      }),
    );

    const assistant = converted.messages.find((message) => message.role === 'assistant');

    expect(assistant?.content).toEqual([
      { type: 'thinking', thinking: 'because of the constraint' },
      { type: 'text', text: 'the answer' },
    ]);
  });

  it('keeps the thinking block ahead of a replayed tool call', () => {
    const converted = convertOpenAIToClaude(
      request({
        messages: [
          { role: 'user', content: 'hi' },
          {
            role: 'assistant',
            content: null,
            reasoning_content: 'need a tool',
            tool_calls: [
              {
                id: 'call-1',
                type: 'function',
                function: { name: 'read_file', arguments: '{"path":"a.ts"}' },
              },
            ],
          },
          { role: 'tool', tool_call_id: 'call-1', content: 'file body' },
        ],
      }),
    );

    const assistant = converted.messages.find((message) => message.role === 'assistant');
    const blocks = assistant?.content as Array<{ type: string }>;

    expect(blocks.map((block) => block.type)).toEqual(['thinking', 'tool_use']);
  });

  it('does not add a thinking block when reasoning_content is empty', () => {
    const converted = convertOpenAIToClaude(
      request({
        messages: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'the answer', reasoning_content: '   ' },
        ],
      }),
    );

    const assistant = converted.messages.find((message) => message.role === 'assistant');

    expect(assistant?.content).toEqual([{ type: 'text', text: 'the answer' }]);
  });
});

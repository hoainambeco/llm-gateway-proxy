import { reconstructAuditSseResponse } from './traffic-audit-sse-reconstruction';

describe('traffic-audit-sse-reconstruction', () => {
  it('returns generic { events } wrapper if no recognized patterns exist', () => {
    const events = [{ arbitrary: 'data' }, { another: 123 }];
    expect(reconstructAuditSseResponse(events)).toEqual({ events });
  });

  it('reconstructs response.completed OpenAI responses style events', () => {
    const events = [
      { type: 'response.created', id: 'resp-1' },
      { type: 'response.in_progress' },
      {
        type: 'response.completed',
        response: {
          id: 'resp-1',
          status: 'completed',
          output: [{ text: 'Final answer' }],
        },
      },
    ];

    const result = reconstructAuditSseResponse(events);
    expect(result.id).toBe('resp-1');
    expect(result.status).toBe('completed');
    expect(result.output).toEqual([{ text: 'Final answer' }]);
    expect(result._unrecognized_events).toBeUndefined();
  });

  it('preserves unrecognized events in _unrecognized_events for response.completed', () => {
    const events = [
      { type: 'some_unknown_vendor_event', payload: 123 },
      {
        type: 'response.completed',
        response: { id: 'resp-1' },
      },
    ];

    const result = reconstructAuditSseResponse(events);
    expect(result.id).toBe('resp-1');
    expect(result._unrecognized_events).toEqual([
      { type: 'some_unknown_vendor_event', payload: 123 },
    ]);
  });

  it('reconstructs OpenAI chat completions stream with content and tool_calls', () => {
    const events = [
      {
        id: 'chatcmpl-123',
        model: 'gpt-4o',
        created: 1700000000,
        system_fingerprint: 'fp_abc',
        choices: [
          {
            index: 0,
            delta: { role: 'assistant', content: 'Hello' },
          },
        ],
      },
      {
        choices: [
          {
            index: 0,
            delta: {
              content: ' world!',
              reasoning_content: 'Thought trace',
              refusal: null,
              tool_calls: [
                {
                  index: 0,
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'get_weather', arguments: '{"cit' },
                },
              ],
            },
          },
        ],
      },
      {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: { arguments: 'y":"Hanoi"}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 25 },
      },
    ];

    const result = reconstructAuditSseResponse(events);
    expect(result.id).toBe('chatcmpl-123');
    expect(result.model).toBe('gpt-4o');
    expect(result.created).toBe(1700000000);
    expect(result.system_fingerprint).toBe('fp_abc');
    expect(result.usage).toEqual({ prompt_tokens: 10, completion_tokens: 25 });

    const choices = result.choices as any[];
    expect(choices.length).toBe(1);
    expect(choices[0].finish_reason).toBe('tool_calls');
    expect(choices[0].message.role).toBe('assistant');
    expect(choices[0].message.content).toBe('Hello world!');
    expect(choices[0].message.reasoning_content).toBe('Thought trace');
    expect(choices[0].message.tool_calls).toEqual([
      {
        index: 0,
        id: 'call_1',
        type: 'function',
        function: {
          name: 'get_weather',
          arguments: '{"city":"Hanoi"}',
        },
      },
    ]);
  });

  it('reconstructs Anthropic messages stream with content blocks and tool JSON parsing', () => {
    const events = [
      {
        type: 'message_start',
        message: {
          id: 'msg_01',
          model: 'claude-3-7-sonnet',
          usage: { input_tokens: 20 },
        },
      },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking', thinking: '' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'Thinking step 1...', signature: 'sig_xyz' },
      },
      {
        type: 'content_block_stop',
        index: 0,
      },
      {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_use', id: 'tool_1', name: 'search', input: '' },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '{"q":' },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '"Vietnam"}' },
      },
      {
        type: 'content_block_stop',
        index: 1,
      },
      {
        type: 'content_block_start',
        index: 2,
        content_block: { type: 'text', text: '' },
      },
      {
        type: 'content_block_delta',
        index: 2,
        delta: { type: 'text_delta', text: 'Here are the results.' },
      },
      {
        type: 'content_block_stop',
        index: 2,
      },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { output_tokens: 45 },
      },
      {
        type: 'message_stop',
      },
    ];

    const result = reconstructAuditSseResponse(events) as any;
    expect(result.id).toBe('msg_01');
    expect(result.model).toBe('claude-3-7-sonnet');
    expect(result.stop_reason).toBe('end_turn');
    expect(result.usage).toEqual({ input_tokens: 20, output_tokens: 45 });

    expect(result.content).toHaveLength(3);
    // Block 0: thinking
    expect(result.content[0]).toEqual({
      type: 'thinking',
      thinking: 'Thinking step 1...',
      signature: 'sig_xyz',
    });
    // Block 1: tool_use with parsed input
    expect(result.content[1]).toEqual({
      type: 'tool_use',
      id: 'tool_1',
      name: 'search',
      input: { q: 'Vietnam' },
    });
    // Block 2: text
    expect(result.content[2]).toEqual({
      type: 'text',
      text: 'Here are the results.',
    });
  });

  it('reconstructs Gemini stream candidates with parts, finishReason, and usageMetadata', () => {
    const events = [
      {
        modelVersion: 'gemini-2.5-flash',
        responseId: 'resp_gemini_1',
        candidates: [
          {
            index: 0,
            content: {
              role: 'model',
              parts: [{ text: 'First part ' }],
            },
          },
        ],
      },
      {
        candidates: [
          {
            index: 0,
            content: {
              parts: [{ text: 'second part.' }],
            },
            finishReason: 'STOP',
            safetyRatings: [{ category: 'HARM', probability: 'NEGLIGIBLE' }],
          },
        ],
        usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 30 },
      },
    ];

    const result = reconstructAuditSseResponse(events) as any;
    expect(result.modelVersion).toBe('gemini-2.5-flash');
    expect(result.responseId).toBe('resp_gemini_1');
    expect(result.usageMetadata).toEqual({ promptTokenCount: 15, candidatesTokenCount: 30 });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].index).toBe(0);
    expect(result.candidates[0].finishReason).toBe('STOP');
    expect(result.candidates[0].content.parts).toEqual([
      { text: 'First part ' },
      { text: 'second part.' },
    ]);
  });

  it('handles wrapped Gemini responses with envelope fields', () => {
    const events = [
      {
        requestId: 'req-wrap-1',
        response: {
          candidates: [
            {
              index: 0,
              content: { parts: [{ text: 'Wrapped Gemini' }] },
              finishReason: 'STOP',
            },
          ],
        },
      },
    ];

    const result = reconstructAuditSseResponse(events) as any;
    expect(result.requestId).toBe('req-wrap-1');
    expect(result.response.candidates[0].content.parts).toEqual([{ text: 'Wrapped Gemini' }]);
  });
});

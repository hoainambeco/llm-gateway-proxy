import { normalizeSseForAudit } from './normalize-sse-for-audit';

describe('normalize-sse-for-audit', () => {
  it('returns raw text as-is if no data: lines exist', () => {
    const raw = 'Plain text response without SSE framing';
    expect(normalizeSseForAudit(raw)).toBe(raw);
  });

  it('parses valid SSE data frames and returns reconstructed response', () => {
    const sse = [
      'event: message',
      'data: {"choices":[{"delta":{"content":"Hello"}}]}',
      '',
      ': keepalive comment',
      'data: {"choices":[{"delta":{"content":" world!"}}]}',
      '',
      'data: [DONE]',
    ].join('\n');

    const result = normalizeSseForAudit(sse) as { response: unknown; stream: boolean };
    expect(result).toBeDefined();
    expect(result.stream).toBe(true);
    expect(result.response).toBeDefined();
  });

  it('handles CRLF line endings and empty data lines gracefully', () => {
    const sse = 'data: {"id":"1"}\r\ndata: \r\ndata: {"id":"2"}\r\ndata: [DONE]\r\n';
    const result = normalizeSseForAudit(sse) as { response: unknown; stream: boolean };
    expect(result.stream).toBe(true);
    expect(result.response).toBeDefined();
  });

  it('returns raw text unchanged if any JSON payload is malformed', () => {
    const malformedSse = [
      'data: {"valid":"json"}',
      'data: {unquoted_broken_json',
      'data: [DONE]',
    ].join('\n');

    expect(normalizeSseForAudit(malformedSse)).toBe(malformedSse);
  });
});

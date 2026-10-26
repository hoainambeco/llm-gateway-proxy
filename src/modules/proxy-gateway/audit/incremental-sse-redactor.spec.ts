import {
  IncrementalSseRedactor,
  conservativeMask,
} from './incremental-sse-redactor';

describe('incremental-sse-redactor', () => {
  describe('conservativeMask', () => {
    it('redacts basic auth credentials in URLs', () => {
      const input = 'Request to https://user:secret@api.openai.com/v1';
      expect(conservativeMask(input)).toBe(
        'Request to https://[REDACTED]@api.openai.com/v1',
      );
    });

    it('redacts sensitive query parameters in URLs', () => {
      const input = 'https://api.example.com?api_key=sk-12345&other=value';
      expect(conservativeMask(input)).toBe(
        'https://api.example.com?api_key=[REDACTED]&other=value',
      );
    });

    it('redacts sensitive JSON values', () => {
      const json = '{"authorization": "Bearer sec-999", "password": "mypassword", "safe": "ok"}';
      const masked = conservativeMask(json);
      expect(masked).toContain('"authorization": "[REDACTED]"');
      expect(masked).toContain('"password": "[REDACTED]"');
      expect(masked).toContain('"safe": "ok"');
    });
  });

  describe('IncrementalSseRedactor', () => {
    it('redacts and emits complete SSE events across chunk boundaries', () => {
      const parsedEvents: unknown[] = [];
      const redactor = new IncrementalSseRedactor({
        onParsedEvent: (evt) => parsedEvents.push(evt),
      });

      // Split event across two chunks
      const chunk1 = 'event: message\ndata: {"choices":[{"delta":{"content":"Hel';
      const chunk2 = 'lo"}}],"authorization":"secret-token"}\n\n';

      const out1 = redactor.push(chunk1);
      expect(out1.length).toBe(0); // held until boundary

      const out2 = redactor.push(chunk2);
      expect(out2.length).toBe(1);
      expect(out2[0]).toContain('"authorization":"[REDACTED]"');
      expect(out2[0]).toContain('"content":"Hello"');

      expect(parsedEvents.length).toBe(1);
    });

    it('identifies [DONE] terminal event', () => {
      const redactor = new IncrementalSseRedactor();
      const output = redactor.push('data: [DONE]\n\n');
      expect(output[0]).toBe('data: [DONE]\n\n');

      const finished = redactor.finish();
      expect(finished.result.terminalEventSeen).toBe(true);
      expect(finished.result.errorSummary).toBeNull();
    });

    it('identifies terminal event from message_stop or finishReason', () => {
      const redactor = new IncrementalSseRedactor();
      redactor.push('data: {"type":"message_stop"}\n\n');

      const finished = redactor.finish();
      expect(finished.result.terminalEventSeen).toBe(true);

      const redactorGemini = new IncrementalSseRedactor();
      redactorGemini.push('data: {"candidates":[null, {"finishReason":""}, {"finishReason":"STOP"}]}\n\n');
      expect(redactorGemini.finish().result.terminalEventSeen).toBe(true);

      const redactorResp = new IncrementalSseRedactor();
      redactorResp.push('data: {"response":{"status":"completed"}}\n\n');
      expect(redactorResp.finish().result.terminalEventSeen).toBe(true);

      const redactorFailed = new IncrementalSseRedactor();
      redactorFailed.push('data: {"type":"response.failed"}\n\n');
      expect(redactorFailed.finish().result.terminalEventSeen).toBe(true);
    });

    it('handles events with no data: lines and empty lines', () => {
      const redactor = new IncrementalSseRedactor();
      const output = redactor.push(': ping comment only\n\n\n');
      expect(output.length).toBeGreaterThan(0);
    });

    it('falls back to conservativeMask and records parse error on malformed JSON data', () => {
      const redactor = new IncrementalSseRedactor();
      const output = redactor.push('data: {invalid-json-data: key="secret"}\n\n');
      expect(output.length).toBe(1);

      const finished = redactor.finish();
      expect(finished.result.parseErrorOffset).not.toBeNull();
      expect(finished.result.errorSummary).not.toBeNull();
    });

    it('flushes pending unclosed event on finish()', () => {
      const redactor = new IncrementalSseRedactor();
      redactor.push('data: {"id":"last-event"}');

      const finished = redactor.finish();
      expect(finished.chunks.length).toBe(1);
      expect(finished.chunks[0]).toContain('last-event');
    });

    it('handles CRLF line endings', () => {
      const redactor = new IncrementalSseRedactor();
      const output = redactor.push('data: {"crlf":true}\r\n\r\n');
      expect(output.length).toBe(1);
      expect(output[0]).toContain('"crlf":true');
    });
  });
});

import { classifyHttpTraffic } from './traffic-classifier';

describe('traffic-classifier', () => {
  describe('classifyHttpTraffic', () => {
    it('classifies system routes correctly', () => {
      expect(classifyHttpTraffic('GET', '/health')).toBe('system');
      expect(classifyHttpTraffic('GET', '/healthz')).toBe('system');
      expect(classifyHttpTraffic('GET', '/internal/audit/stats')).toBe('system');
      expect(classifyHttpTraffic('POST', '/graphql')).toBe('system');
      expect(classifyHttpTraffic('GET', '/graphql/playground')).toBe('system');
    });

    it('handles percent-encoded paths for system routes', () => {
      // %67raphql = graphql
      expect(classifyHttpTraffic('POST', '/%67raphql')).toBe('system');
    });

    it('handles malformed percent-encoding safely without throwing', () => {
      // %E0%A4% is invalid UTF-8 sequence for decodeURIComponent
      expect(classifyHttpTraffic('POST', '/%E0%A4%A')).toBe('model');
      expect(classifyHttpTraffic('GET', '/%E0%A4%A')).toBe('auxiliary');
    });

    it('classifies auxiliary routes correctly', () => {
      expect(classifyHttpTraffic('GET', '/v1/models')).toBe('auxiliary');
      expect(classifyHttpTraffic('GET', '/v1/models/gemini-pro')).toBe('auxiliary');
      expect(classifyHttpTraffic('POST', '/v1/messages/count_tokens')).toBe('auxiliary');
      expect(classifyHttpTraffic('POST', '/v1beta/models/gemini-pro:countTokens')).toBe('auxiliary');
      expect(classifyHttpTraffic('POST', '/v1internal/countTokens')).toBe('auxiliary');
      expect(classifyHttpTraffic('GET', '/v1beta/files/file-123')).toBe('auxiliary');
      expect(classifyHttpTraffic('GET', '/upload/v1beta/files')).toBe('auxiliary');
      expect(classifyHttpTraffic('GET', '/v1/files')).toBe('auxiliary');
      expect(classifyHttpTraffic('POST', '/v1/batches')).toBe('auxiliary');
      expect(classifyHttpTraffic('POST', '/v1/messages/batches')).toBe('auxiliary');
      expect(classifyHttpTraffic('POST', '/v1beta/batches')).toBe('auxiliary');
      expect(classifyHttpTraffic('POST', '/v1beta/models/gemini-pro:batchGenerateContent')).toBe('auxiliary');
      expect(classifyHttpTraffic('GET', '/v1/responses/resp-abc')).toBe('auxiliary');
      expect(classifyHttpTraffic('GET', '/v1/chat/completions/comp-xyz')).toBe('auxiliary');
    });

    it('classifies model generation routes correctly', () => {
      expect(classifyHttpTraffic('POST', '/v1/chat/completions')).toBe('model');
      expect(classifyHttpTraffic('POST', '/v1/responses')).toBe('model');
      expect(classifyHttpTraffic('POST', '/v1/messages')).toBe('model');
      expect(classifyHttpTraffic('POST', '/v1/complete')).toBe('model');
      expect(classifyHttpTraffic('POST', '/v1/images/generations')).toBe('model');
      expect(classifyHttpTraffic('POST', '/v1beta/models/gemini-2.5-flash:generateContent')).toBe('model');
      expect(classifyHttpTraffic('POST', '/v1beta/models/gemini-pro:streamGenerateContent')).toBe('model');
      expect(classifyHttpTraffic('POST', '/compatible/custom/v1/chat/completions')).toBe('model');
    });

    it('falls back to POST -> model and non-POST -> auxiliary for unlisted routes', () => {
      expect(classifyHttpTraffic('POST', '/unknown/vendor/api')).toBe('model');
      expect(classifyHttpTraffic('GET', '/unknown/vendor/api')).toBe('auxiliary');
      expect(classifyHttpTraffic('DELETE', '/unknown/vendor/api')).toBe('auxiliary');
      expect(classifyHttpTraffic('PUT', '/unknown/vendor/api')).toBe('auxiliary');
    });

    it('ignores query parameters and hashes during route matching', () => {
      expect(classifyHttpTraffic('GET', '/health?verbose=1#status')).toBe('system');
      expect(classifyHttpTraffic('POST', '/v1/chat/completions?stream=true')).toBe('model');
      expect(classifyHttpTraffic('GET', '/v1/models?limit=10')).toBe('auxiliary');
    });
  });
});

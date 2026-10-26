import { mergeAuditUsage, extractAuditUsage, type AuditUsage } from './audit-usage';

describe('audit-usage', () => {
  describe('mergeAuditUsage', () => {
    it('returns previous if next is undefined', () => {
      const prev: AuditUsage = { inputTokens: 10, outputTokens: 20 };
      expect(mergeAuditUsage(prev, undefined)).toEqual(prev);
    });

    it('returns next fields merged onto previous', () => {
      const prev: AuditUsage = { inputTokens: 10, outputTokens: 20, cachedTokens: 5 };
      const next: AuditUsage = { outputTokens: 25, reasoningTokens: 8 };

      expect(mergeAuditUsage(prev, next)).toEqual({
        inputTokens: 10,
        outputTokens: 25,
        cachedTokens: 5,
        reasoningTokens: 8,
      });
    });

    it('works when previous is undefined', () => {
      const next: AuditUsage = { inputTokens: 15 };
      expect(mergeAuditUsage(undefined, next)).toEqual({ inputTokens: 15 });
    });
  });

  describe('extractAuditUsage', () => {
    it('returns undefined for non-objects or depth > 8', () => {
      expect(extractAuditUsage(null)).toBeUndefined();
      expect(extractAuditUsage('string')).toBeUndefined();
      expect(extractAuditUsage(123)).toBeUndefined();
      expect(extractAuditUsage({ usage: { prompt_tokens: 10 } }, 9)).toBeUndefined();
    });

    it('extracts OpenAI style usage with details', () => {
      const payload = {
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          prompt_tokens_details: {
            cached_tokens: 20,
          },
          completion_tokens_details: {
            reasoning_tokens: 15,
          },
        },
      };

      expect(extractAuditUsage(payload)).toEqual({
        inputTokens: 100,
        outputTokens: 50,
        cachedTokens: 20,
        reasoningTokens: 15,
      });
    });

    it('extracts Gemini style usageMetadata', () => {
      const payload = {
        usageMetadata: {
          promptTokenCount: 200,
          candidatesTokenCount: 80,
          cachedContentTokenCount: 40,
          thoughtsTokenCount: 30,
        },
      };

      expect(extractAuditUsage(payload)).toEqual({
        inputTokens: 200,
        outputTokens: 80,
        cachedTokens: 40,
        reasoningTokens: 30,
      });
    });

    it('extracts Anthropic style usage with cache_read_input_tokens', () => {
      const payload = {
        usage: {
          input_tokens: 300,
          output_tokens: 120,
          cache_read_input_tokens: 50,
          reasoning_tokens: 25,
        },
      };

      expect(extractAuditUsage(payload)).toEqual({
        inputTokens: 300,
        outputTokens: 120,
        cachedTokens: 50,
        reasoningTokens: 25,
      });
    });

    it('extracts nested usage from events array, response, and message wrappers', () => {
      const payload = {
        events: [
          {
            usage: { input_tokens: 50 },
          },
          {
            usage: { output_tokens: 30 },
          },
        ],
        response: {
          usage: { cached_tokens: 10 },
        },
        message: {
          usage: { reasoning_tokens: 5 },
        },
      };

      expect(extractAuditUsage(payload)).toEqual({
        inputTokens: 50,
        outputTokens: 30,
        cachedTokens: 10,
        reasoningTokens: 5,
      });
    });

    it('returns undefined if usage object has no recognized finite numbers', () => {
      const payload = {
        usage: {
          prompt_tokens: 'one hundred',
          output_tokens: NaN,
          cached_tokens: null,
        },
      };

      expect(extractAuditUsage(payload)).toBeUndefined();
    });
  });
});

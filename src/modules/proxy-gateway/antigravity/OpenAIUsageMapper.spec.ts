import {
  toOpenAIUsage,
  toOpenAIUsageFromGeminiUsageMetadata,
  toOpenAIResponsesUsage,
} from './OpenAIUsageMapper';

describe('OpenAIUsageMapper', () => {
  describe('toOpenAIUsage', () => {
    it('handles undefined usage gracefully without returning NaN', () => {
      const result = toOpenAIUsage(undefined);
      expect(result).toEqual({
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        prompt_tokens_details: undefined,
        completion_tokens_details: undefined,
      });
      expect(Number.isNaN(result.prompt_tokens)).toBe(false);
      expect(Number.isNaN(result.total_tokens)).toBe(false);
    });

    it('maps partial usage fields and defaults missing to 0', () => {
      const result = toOpenAIUsage({
        input_tokens: 42,
      } as any);
      expect(result.prompt_tokens).toBe(42);
      expect(result.completion_tokens).toBe(0);
      expect(result.total_tokens).toBe(42);
      expect(result.prompt_tokens_details).toBeUndefined();
      expect(result.completion_tokens_details).toBeUndefined();
    });

    it('includes token details when cached or reasoning tokens are present', () => {
      const result = toOpenAIUsage({
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 20,
        reasoning_tokens: 15,
      });
      expect(result.prompt_tokens).toBe(100);
      expect(result.completion_tokens).toBe(50);
      expect(result.total_tokens).toBe(150);
      expect(result.prompt_tokens_details).toEqual({ cached_tokens: 20 });
      expect(result.completion_tokens_details).toEqual({ reasoning_tokens: 15 });
    });
  });

  describe('toOpenAIUsageFromGeminiUsageMetadata', () => {
    it('handles undefined metadata', () => {
      const result = toOpenAIUsageFromGeminiUsageMetadata(undefined);
      expect(result.prompt_tokens).toBe(0);
      expect(result.completion_tokens).toBe(0);
      expect(result.total_tokens).toBe(0);
    });

    it('maps standard Gemini camelCase metadata', () => {
      const result = toOpenAIUsageFromGeminiUsageMetadata({
        promptTokenCount: 120,
        candidatesTokenCount: 45,
        totalTokenCount: 165,
        cachedContentTokenCount: 30,
        thoughtsTokenCount: 10,
      });
      expect(result.prompt_tokens).toBe(120);
      expect(result.completion_tokens).toBe(45);
      expect(result.total_tokens).toBe(165);
      expect(result.prompt_tokens_details).toEqual({ cached_tokens: 30 });
      expect(result.completion_tokens_details).toEqual({ reasoning_tokens: 10 });
    });

    it('maps snake_case Gemini metadata with total_output_tokens supplemental addition', () => {
      const result = toOpenAIUsageFromGeminiUsageMetadata({
        total_input_tokens: 80,
        total_output_tokens: 40,
        total_thought_tokens: 15,
        total_tool_use_tokens: 5,
        total_tokens: 140,
      });
      expect(result.prompt_tokens).toBe(80);
      // outputTokens = total_output_tokens + reasoningTokens + toolUseTokens = 40 + 15 + 5 = 60
      expect(result.completion_tokens).toBe(60);
      expect(result.total_tokens).toBe(140);
      expect(result.completion_tokens_details).toEqual({ reasoning_tokens: 15 });
    });
  });

  describe('toOpenAIResponsesUsage', () => {
    it('translates prompt/completion naming to input/output naming', () => {
      const openAiUsage = {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
        prompt_tokens_details: { cached_tokens: 5 },
        completion_tokens_details: { reasoning_tokens: 8 },
      };

      const responsesUsage = toOpenAIResponsesUsage(openAiUsage);
      expect(responsesUsage).toEqual({
        input_tokens: 10,
        output_tokens: 20,
        total_tokens: 30,
        input_tokens_details: { cached_tokens: 5 },
        output_tokens_details: { reasoning_tokens: 8 },
      });
    });
  });
});

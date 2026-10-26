import {
  registerDynamicModelSpecs,
  getDynamicModelSpecs,
  resolveModelAlias,
  isThinkingModel,
  getMaxOutputTokens,
  getThinkingBudget,
} from './ModelSpecs';

describe('ModelSpecs', () => {
  describe('registerDynamicModelSpecs and getDynamicModelSpecs', () => {
    it('handles undefined input gracefully', () => {
      registerDynamicModelSpecs(undefined);
      expect(getDynamicModelSpecs()).toBeDefined();
    });

    it('registers dynamic model specs correctly', () => {
      registerDynamicModelSpecs({
        'my-custom-dyn-model': {
          max_output_tokens: 16384,
          thinking_budget: 8192,
          supports_thinking: true,
          display_name: 'Custom Dynamic Model',
        } as any,
      });

      const specs = getDynamicModelSpecs();
      const spec = specs.get('my-custom-dyn-model');
      expect(spec).toBeDefined();
      expect(spec?.max_output_tokens).toBe(16384);
      expect(spec?.thinking_budget).toBe(8192);
      expect(spec?.is_thinking).toBe(true);
      expect(spec?.display_name).toBe('Custom Dynamic Model');
    });
  });

  describe('resolveModelAlias', () => {
    it('resolves known aliases', () => {
      expect(resolveModelAlias('gemini-3.6-flash-high')).toBe('gemini-3.7-flash-high');
    });

    it('returns the same model if not an alias', () => {
      expect(resolveModelAlias('unaliased-model')).toBe('unaliased-model');
    });
  });

  describe('isThinkingModel', () => {
    it('returns dynamic is_thinking when registered', () => {
      registerDynamicModelSpecs({
        'dyn-think': {
          supports_thinking: true,
        } as any,
        'dyn-nothink': {
          supports_thinking: false,
        } as any,
      });

      expect(isThinkingModel('dyn-think')).toBe(true);
      expect(isThinkingModel('dyn-nothink')).toBe(false);
      expect(isThinkingModel('dyn-think-high')).toBe(true);
    });

    it('resolves static specs for known thinking models', () => {
      expect(isThinkingModel('claude-sonnet-4-6-thinking')).toBe(true);
      expect(isThinkingModel('unknown-model-xyz')).toBe(false);
    });
  });

  describe('getMaxOutputTokens', () => {
    it('returns dynamic max_output_tokens when available', () => {
      registerDynamicModelSpecs({
        'dyn-tokens': {
          max_output_tokens: 32000,
        } as any,
      });

      expect(getMaxOutputTokens('dyn-tokens')).toBe(32000);
      expect(getMaxOutputTokens('dyn-tokens-low')).toBe(32000);
    });

    it('returns tokens from static specs', () => {
      expect(getMaxOutputTokens('claude-sonnet-4-6-thinking')).toBe(64000);
    });

    it('returns DEFAULT_MAX_OUTPUT_TOKENS (65535) for unknown models', () => {
      expect(getMaxOutputTokens('unknown-non-existent-model')).toBe(65535);
    });
  });

  describe('getThinkingBudget', () => {
    it('computes variant tiered budgets (low, medium, high)', () => {
      registerDynamicModelSpecs({
        'dyn-base': {
          thinking_budget: 20000,
        } as any,
      });

      // low: max(1000, floor(20000 * 0.15)) = 3000
      expect(getThinkingBudget('dyn-base-low')).toBe(3000);

      // medium: max(2000, floor(20000 * 0.40)) = 8000
      expect(getThinkingBudget('dyn-base-medium')).toBe(8000);

      // high: baseBudget = 20000
      expect(getThinkingBudget('dyn-base-high')).toBe(20000);
    });

    it('returns dynamic thinking_budget directly for non-variant names', () => {
      registerDynamicModelSpecs({
        'dyn-direct': {
          thinking_budget: 12345,
        } as any,
      });
      expect(getThinkingBudget('dyn-direct')).toBe(12345);
    });

    it('returns static thinking_budget or DEFAULT_THINKING_BUDGET (24576)', () => {
      expect(getThinkingBudget('claude-opus-4-6-thinking')).toBe(32768);
      expect(getThinkingBudget('gemini-3-pro-image')).toBe(24576);
      expect(getThinkingBudget('completely-unknown-model')).toBe(24576);
    });
  });
});

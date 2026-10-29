import {
  registerDynamicModelSpecs,
  getDynamicModelSpecs,
  clearDynamicModelSpecs,
  resolveModelAlias,
  isThinkingModel,
  getMaxOutputTokens,
  getThinkingBudget,
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_THINKING_BUDGET,
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

  describe('Dynamic Model Specs for Novel Upstream Models', () => {
    afterEach(() => {
      clearDynamicModelSpecs();
    });

    it('correctly discovers and applies dynamic specs for novel model (model-argon)', () => {
      registerDynamicModelSpecs({
        'model-argon': {
          max_output_tokens: 32768,
          thinking_budget: 12000,
          supports_thinking: true,
          display_name: 'Argon Novel Model',
        } as any,
      });

      expect(getMaxOutputTokens('model-argon')).toBe(32768);
      expect(getThinkingBudget('model-argon')).toBe(12000);
      expect(isThinkingModel('model-argon')).toBe(true);
    });

    it('falls back safely for unknown/unregistered models', () => {
      expect(getMaxOutputTokens('unknown-argon-ghost')).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
      expect(getMaxOutputTokens('unknown-argon-ghost')).toBe(65535);
      expect(getThinkingBudget('unknown-argon-ghost')).toBe(DEFAULT_THINKING_BUDGET);
      expect(getThinkingBudget('unknown-argon-ghost')).toBe(24576);
      expect(isThinkingModel('unknown-argon-ghost')).toBe(false);
    });

    it('inherits base model dynamic specs when stripping suffixes (-low, -medium, -high)', () => {
      registerDynamicModelSpecs({
        'model-argon': {
          max_output_tokens: 32768,
          thinking_budget: 12000,
          supports_thinking: true,
        } as any,
      });

      // Max output tokens inherit from base dynamic spec
      expect(getMaxOutputTokens('model-argon-low')).toBe(32768);
      expect(getMaxOutputTokens('model-argon-medium')).toBe(32768);
      expect(getMaxOutputTokens('model-argon-high')).toBe(32768);

      // Thinking budget applies tier calculations from base dynamic budget (12000)
      // high: baseBudget = 12000
      expect(getThinkingBudget('model-argon-high')).toBe(12000);
      // medium: max(2000, floor(12000 * 0.40)) = 4800
      expect(getThinkingBudget('model-argon-medium')).toBe(4800);
      // low: max(1000, floor(12000 * 0.15)) = 1800
      expect(getThinkingBudget('model-argon-low')).toBe(1800);

      // Thinking capability inherits from base dynamic spec
      expect(isThinkingModel('model-argon-low')).toBe(true);
      expect(isThinkingModel('model-argon-medium')).toBe(true);
      expect(isThinkingModel('model-argon-high')).toBe(true);
    });

    it('prioritizes exact dynamic spec match over suffix stripping', () => {
      registerDynamicModelSpecs({
        'model-argon': {
          max_output_tokens: 32768,
          thinking_budget: 12000,
          supports_thinking: true,
        } as any,
        'model-argon-high': {
          max_output_tokens: 40000,
          thinking_budget: 15000,
          supports_thinking: true,
        } as any,
      });

      // Directly registered variant should return exact dynamic values, not base
      expect(getThinkingBudget('model-argon-high')).toBe(15000);
      expect(getMaxOutputTokens('model-argon-high')).toBe(40000);
    });

    it('resets dynamic specs via clearDynamicModelSpecs', () => {
      registerDynamicModelSpecs({
        'model-argon': {
          max_output_tokens: 32768,
          thinking_budget: 12000,
          supports_thinking: true,
        } as any,
      });

      expect(getMaxOutputTokens('model-argon')).toBe(32768);
      clearDynamicModelSpecs();
      expect(getMaxOutputTokens('model-argon')).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
      expect(getThinkingBudget('model-argon')).toBe(DEFAULT_THINKING_BUDGET);
      expect(isThinkingModel('model-argon')).toBe(false);
    });
  });
});

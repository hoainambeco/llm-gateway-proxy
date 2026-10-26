import {
  usesAuthoritativeThinkingBudget,
  resolveModelVariant,
  rebindModelVariant,
} from './model-variant-registry';

describe('model-variant-registry', () => {
  describe('usesAuthoritativeThinkingBudget', () => {
    it('returns true for known Gemini 3 families and aliases', () => {
      expect(usesAuthoritativeThinkingBudget('gemini-3.7-flash')).toBe(true);
      expect(usesAuthoritativeThinkingBudget('gemini-3.1-pro')).toBe(true);
      expect(usesAuthoritativeThinkingBudget('models/gemini-3.7-flash-high')).toBe(true);
    });

    it('returns true for thinking models with tier suffixes', () => {
      expect(usesAuthoritativeThinkingBudget('claude-sonnet-4-6-thinking-high')).toBe(true);
    });

    it('returns true for models containing agent', () => {
      expect(usesAuthoritativeThinkingBudget('gemini-flash-agent')).toBe(true);
    });

    it('returns true for gemini >= 3', () => {
      expect(usesAuthoritativeThinkingBudget('gemini-3.0-flash')).toBe(true);
    });

    it('returns false for non-gemini or older models without agent/thinking', () => {
      expect(usesAuthoritativeThinkingBudget('gemini-1.5-flash')).toBe(false);
      expect(usesAuthoritativeThinkingBudget('some-custom-model')).toBe(false);
    });
  });

  describe('resolveModelVariant', () => {
    it('resolves explicit tiered variant from model name', () => {
      const resolved = resolveModelVariant({ model: 'gemini-3.7-flash-low' });
      expect(resolved).not.toBeNull();
      expect(resolved?.canonicalModel).toBe('gemini-3.7-flash');
      expect(resolved?.tier).toBe('low');
      expect(resolved?.thinkingBudget).toBe(1000);
      expect(resolved?.supportsTools).toBe(true);
    });

    it('resolves tier via effort parameter (low, medium, high)', () => {
      const low = resolveModelVariant({ model: 'gemini-3.7-flash', effort: 'low' });
      expect(low?.tier).toBe('low');

      const med = resolveModelVariant({ model: 'gemini-3.7-flash', effort: 'medium' });
      expect(med?.tier).toBe('medium');

      const high = resolveModelVariant({ model: 'gemini-3.7-flash', effort: 'high' });
      expect(high?.tier).toBe('high');
    });

    it('resolves tier via budgetTokens hint', () => {
      const low = resolveModelVariant({ model: 'gemini-3.7-flash', budgetTokens: 1500 });
      expect(low?.tier).toBe('low');

      const med = resolveModelVariant({ model: 'gemini-3.7-flash', budgetTokens: 5000 });
      expect(med?.tier).toBe('medium');

      const high = resolveModelVariant({ model: 'gemini-3.7-flash', budgetTokens: 16000 });
      expect(high?.tier).toBe('high');
    });

    it('resolves non-variant or dynamic model', () => {
      const resolved = resolveModelVariant({ model: 'gemini-2.5-flash' });
      if (resolved) {
        expect(resolved.model).toBeDefined();
      }
    });

    it('resolves dynamic tiered models (e.g. -tiered suffix)', () => {
      const tieredLow = resolveModelVariant({
        model: 'claude-sonnet-4-6-thinking-tiered',
        effort: 'low',
      });
      expect(tieredLow).not.toBeNull();
      expect(tieredLow?.tier).toBe('low');
      expect(tieredLow?.canonicalModel).toBe('claude-sonnet-4-6-thinking-tiered');

      const tieredMed = resolveModelVariant({
        model: 'claude-sonnet-4-6-thinking-tiered',
        effort: 'medium',
      });
      expect(tieredMed?.tier).toBe('medium');
    });

    it('returns null for completely unsupported models without thinking or specs', () => {
      expect(resolveModelVariant({ model: 'unknown-vendor-non-existent-model' })).toBeNull();
    });
  });

  describe('rebindModelVariant', () => {
    it('returns null if variant is null', () => {
      expect(rebindModelVariant(null, 'gemini-3.7-flash-high')).toBeNull();
    });

    it('returns original variant if physicalModel matches variant.model', () => {
      const variant = resolveModelVariant({ model: 'gemini-3.7-flash-low' });
      expect(variant).not.toBeNull();
      const rebind = rebindModelVariant(variant, variant!.model);
      expect(rebind).toBe(variant);
    });

    it('rebinds to another tier within the same family', () => {
      const variant = resolveModelVariant({ model: 'gemini-3.7-flash-low' });
      expect(variant).not.toBeNull();
      const rebind = rebindModelVariant(variant, 'gemini-3.7-flash-high');
      expect(rebind?.tier).toBe('high');
      expect(rebind?.thinkingBudget).toBe(10000);
    });

    it('rebinds model name when physical model matches canonical model prefix or alias', () => {
      const variant = resolveModelVariant({ model: 'gemini-3.7-flash-low' });
      expect(variant).not.toBeNull();
      const rebind = rebindModelVariant(variant, 'gemini-3.7-flash');
      expect(rebind?.model).toBe('gemini-3.7-flash');
    });

    it('rebinds dynamic variant with matching base model', () => {
      const variant = resolveModelVariant({
        model: 'claude-sonnet-4-6-thinking-tiered',
        effort: 'low',
      });
      expect(variant).not.toBeNull();
      const rebind = rebindModelVariant(variant, 'claude-sonnet-4-6-thinking-high');
      expect(rebind).not.toBeNull();
      expect(rebind?.model).toBe('claude-sonnet-4-6-thinking-high');
    });

    it('returns null when rebind physical model does not match family or base', () => {
      const variant = resolveModelVariant({ model: 'gemini-3.7-flash-low' });
      expect(variant).not.toBeNull();
      const rebind = rebindModelVariant(variant, 'unrelated-non-matching-model');
      expect(rebind).toBeNull();
    });
  });
});

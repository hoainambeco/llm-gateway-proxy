import {
  mapClaudeModelToGemini,
  normalizeGeminiModelAlias,
  lookupBuiltInModelMapping,
  lookupGeminiModelAlias,
  getAnthropicFamilyMappingKey,
  resolveModelRoute,
  updateDynamicForwardingRules,
} from './ModelMapping';

describe('ModelMapping', () => {
  describe('mapClaudeModelToGemini', () => {
    it('returns empty string for empty input', () => {
      expect(mapClaudeModelToGemini('')).toBe('');
      expect(mapClaudeModelToGemini(null as any)).toBe('');
    });

    it('maps known Claude aliases to target models', () => {
      expect(mapClaudeModelToGemini('claude-3-5-sonnet-20241022')).toBe('claude-sonnet-4-6-thinking');
      expect(mapClaudeModelToGemini('claude-opus-4')).toBe('claude-opus-4-6-thinking');
    });

    it('keeps unknown models intact', () => {
      expect(mapClaudeModelToGemini('custom-unknown-model-v1')).toBe('custom-unknown-model-v1');
    });
  });

  describe('normalizeGeminiModelAlias', () => {
    it('normalizes case and whitespace for aliases', () => {
      expect(normalizeGeminiModelAlias('  gemini-3-flash-preview  ')).toBe('gemini-3-flash');
    });

    it('returns original modelId if not an alias', () => {
      expect(normalizeGeminiModelAlias('gemini-unknown-xyz')).toBe('gemini-unknown-xyz');
    });
  });

  describe('lookupBuiltInModelMapping & lookupGeminiModelAlias', () => {
    it('returns target for known built-in mapping and undefined for unknown', () => {
      expect(lookupBuiltInModelMapping('claude-3-5-sonnet-20241022')).toBe('claude-sonnet-4-6-thinking');
      expect(lookupBuiltInModelMapping('non-existent-model')).toBeUndefined();
    });

    it('returns target for known gemini alias and undefined for unknown', () => {
      expect(lookupGeminiModelAlias('gemini-3-flash-preview')).toBe('gemini-3-flash');
      expect(lookupGeminiModelAlias('non-existent-alias-xyz')).toBeUndefined();
    });
  });

  describe('getAnthropicFamilyMappingKey', () => {
    it('returns undefined for non-claude models', () => {
      expect(getAnthropicFamilyMappingKey('gpt-4o')).toBeUndefined();
      expect(getAnthropicFamilyMappingKey('gemini-2.5-pro')).toBeUndefined();
    });

    it('identifies claude-4.5-series', () => {
      expect(getAnthropicFamilyMappingKey('claude-4-5-sonnet')).toBe('claude-4.5-series');
      expect(getAnthropicFamilyMappingKey('claude-opus-4.5')).toBe('claude-4.5-series');
    });

    it('identifies claude-3.5-series', () => {
      expect(getAnthropicFamilyMappingKey('claude-3-5-sonnet-20241022')).toBe('claude-3.5-series');
      expect(getAnthropicFamilyMappingKey('claude-haiku-3.5')).toBe('claude-3.5-series');
    });

    it('falls back to claude-default for other claude models', () => {
      expect(getAnthropicFamilyMappingKey('claude-2.1')).toBe('claude-default');
      expect(getAnthropicFamilyMappingKey('claude-instant-1.2')).toBe('claude-default');
    });
  });

  describe('resolveModelRoute', () => {
    it('gives custom mapping priority over group and system mapping', () => {
      const custom = { 'claude-test': 'my-custom-target' };
      const openai = {};
      const anthropic = { 'claude-default': 'group-target' };

      const result = resolveModelRoute('claude-test', custom, openai, anthropic);
      expect(result).toBe('my-custom-target');
    });

    it('falls back to anthropic group mapping if custom mapping does not match', () => {
      const custom = {};
      const openai = {};
      const anthropic = { 'claude-3.5-series': 'group-3.5-target' };

      const result = resolveModelRoute('claude-3-5-sonnet', custom, openai, anthropic);
      expect(result).toBe('group-3.5-target');
    });

    it('falls back to built-in system mapping if no custom or group mapping applies', () => {
      const result = resolveModelRoute('claude-3-5-sonnet-20241022', {}, {}, {});
      expect(result).toBe('claude-sonnet-4-6-thinking');
    });

    it('returns originalModel if nothing matches', () => {
      const result = resolveModelRoute('completely-unknown-model', {}, {}, {});
      expect(result).toBe('completely-unknown-model');
    });

    it('honors dynamic forwarding rules with highest priority', () => {
      updateDynamicForwardingRules('deprecated-model-x', 'new-model-y');
      const result = resolveModelRoute('deprecated-model-x', { 'deprecated-model-x': 'custom' }, {}, {});
      expect(result).toBe('new-model-y');
    });
  });
});

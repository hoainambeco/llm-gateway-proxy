import {
  mapClaudeModelToGemini,
  normalizeGeminiModelAlias,
  lookupBuiltInModelMapping,
  lookupGeminiModelAlias,
  getAnthropicFamilyMappingKey,
  resolveModelRoute,
  updateDynamicForwardingRules,
  getSupportedModels,
  getPublicModelIdForDisplayName,
  getAllDynamicModels,
  getOpenAICompatibleModels,
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

    it('routes OpenAI gpt-4 series (o1, o3, classic gpt-4)', () => {
      const openai = { 'gpt-4-series': 'gemini-3.1-pro-high' };
      expect(resolveModelRoute('gpt-4', {}, openai, {})).toBe('gemini-3.1-pro-high');
      expect(resolveModelRoute('o1-mini-2024-09-12', {}, openai, {})).toBe('gemini-3.1-pro-high');
      expect(resolveModelRoute('o3-mini', {}, openai, {})).toBe('gemini-3.1-pro-high');
    });

    it('routes OpenAI gpt-4o/3.5 series (4o, turbo, mini)', () => {
      const openai = { 'gpt-4o-series': 'gemini-3.7-flash-medium' };
      expect(resolveModelRoute('gpt-4o', {}, openai, {})).toBe('gemini-3.7-flash-medium');
      expect(resolveModelRoute('gpt-3.5-turbo', {}, openai, {})).toBe('gemini-3.7-flash-medium');
      expect(resolveModelRoute('gpt-4-turbo', {}, openai, {})).toBe('gemini-3.7-flash-medium');
    });

    it('routes OpenAI gpt-5 series with fallback to gpt-4-series', () => {
      const openaiGpt5 = { 'gpt-5-series': 'gemini-3.7-flash-high' };
      expect(resolveModelRoute('gpt-5', {}, openaiGpt5, {})).toBe('gemini-3.7-flash-high');

      const openaiFallback = { 'gpt-4-series': 'gemini-3.1-pro-high' };
      expect(resolveModelRoute('gpt-5', {}, openaiFallback, {})).toBe('gemini-3.1-pro-high');
    });

    it('routes Anthropic series with fallback to exact mapping', () => {
      const anthropicExact = { 'claude-3-haiku-20240307': 'custom-haiku-target' };
      expect(resolveModelRoute('claude-3-haiku-20240307', {}, {}, anthropicExact)).toBe('custom-haiku-target');
    });
  });

  describe('getSupportedModels & getPublicModelIdForDisplayName', () => {
    it('returns supported models list', () => {
      const models = getSupportedModels();
      expect(models.length).toBeGreaterThan(0);
      expect(models).toContain('gemini-3-flash');
    });

    it('looks up public model ID by display name or returns undefined', () => {
      expect(getPublicModelIdForDisplayName(null)).toBeUndefined();
      expect(getPublicModelIdForDisplayName('')).toBeUndefined();
      expect(getPublicModelIdForDisplayName('Non Existent Model Display Name 12345')).toBeUndefined();
    });
  });

  describe('getAllDynamicModels & getOpenAICompatibleModels', () => {
    it('returns models including custom mapping and static fallback models', () => {
      const dynamic = getAllDynamicModels({ 'my-custom-model': 'target' });
      expect(dynamic).toContain('my-custom-model');
      expect(dynamic.length).toBeGreaterThan(10);
    });

    it('returns raw models when onlyRawQuotaModels is true', () => {
      const raw = getAllDynamicModels({}, ['raw-model-a', 'raw-model-b'], true);
      expect(raw).toEqual(['raw-model-a', 'raw-model-b']);
    });

    it('filters out image models in getOpenAICompatibleModels unless onlyRawQuotaModels is true', () => {
      const openAiModels = getOpenAICompatibleModels({}, ['text-model', 'image-model-xyz']);
      expect(openAiModels).toContain('text-model');
      expect(openAiModels).not.toContain('image-model-xyz');

      const rawOpenAiModels = getOpenAICompatibleModels({}, ['image-model-xyz'], true);
      expect(rawOpenAiModels).toContain('image-model-xyz');
    });
  });
});

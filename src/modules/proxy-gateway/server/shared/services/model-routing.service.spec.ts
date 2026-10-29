import { ModelRoutingService } from './model-routing.service';
import { ModelRouteMissJournalService } from './model-route-miss-journal.service';
import { setServerConfig } from '../../../../../server/server-config';
import { updateDynamicForwardingRules } from '../../../antigravity/ModelMapping';
import {
  registerDynamicModelSpecs,
  clearDynamicModelSpecs,
} from '../../../antigravity/ModelSpecs';
import type { ProxyConfig } from '@/modules/config/types';

describe('ModelRoutingService', () => {
  let service: ModelRoutingService;
  let mockMissJournal: jest.Mocked<ModelRouteMissJournalService>;

  beforeEach(() => {
    mockMissJournal = {
      record: jest.fn(),
      clear: jest.fn(),
      getSnapshot: jest.fn(),
      flush: jest.fn(),
    } as unknown as jest.Mocked<ModelRouteMissJournalService>;

    service = new ModelRoutingService(mockMissJournal);

    // Reset server config to empty/default
    setServerConfig({
      model_aliases: [],
      custom_mapping: {},
      anthropic_mapping: {},
    } as unknown as ProxyConfig);
  });

  describe('built-in resolutions', () => {
    it('resolves the built-in Claude 3.5 Sonnet mapping', () => {
      expect(service.resolveModelRoute('claude-3-5-sonnet-20241022')).toEqual({
        requestedModel: 'claude-3-5-sonnet-20241022',
        normalizedModel: 'claude-3-5-sonnet-20241022',
        resolvedModel: 'claude-sonnet-4-6-thinking',
        source: 'built-in',
      });
    });

    it('resolves the built-in Gemini 3.1 Pro preview mapping', () => {
      expect(service.resolveModelRoute('gemini-3.1-pro-preview')).toEqual({
        requestedModel: 'gemini-3.1-pro-preview',
        normalizedModel: 'gemini-3.1-pro-preview',
        resolvedModel: 'gemini-3.1-pro-high',
        source: 'built-in',
      });
    });

    it('strips a leading models/ prefix before resolving', () => {
      const requestedModel = 'models/claude-3-5-sonnet-20241022';

      expect(service.resolveModelRoute(requestedModel)).toEqual({
        requestedModel,
        normalizedModel: 'claude-3-5-sonnet-20241022',
        resolvedModel: 'claude-sonnet-4-6-thinking',
        source: 'built-in',
      });
    });

    it('trims surrounding whitespace before resolving', () => {
      const requestedModel = '  claude-3-5-sonnet-20241022  ';

      expect(service.resolveModelRoute(requestedModel)).toEqual({
        requestedModel,
        normalizedModel: 'claude-3-5-sonnet-20241022',
        resolvedModel: 'claude-sonnet-4-6-thinking',
        source: 'built-in',
      });
    });

    it('reports a supported model that maps to itself as canonical', () => {
      expect(service.resolveModelRoute('claude-sonnet-4-6-thinking')).toEqual({
        requestedModel: 'claude-sonnet-4-6-thinking',
        normalizedModel: 'claude-sonnet-4-6-thinking',
        resolvedModel: 'claude-sonnet-4-6-thinking',
        source: 'canonical',
      });
    });

    it('reports gemini-2.5-pro as canonical mapping to itself', () => {
      expect(service.resolveModelRoute('gemini-2.5-pro')).toEqual({
        requestedModel: 'gemini-2.5-pro',
        normalizedModel: 'gemini-2.5-pro',
        resolvedModel: 'gemini-2.5-pro',
        source: 'canonical',
      });
    });

    it('reports dynamically registered model from quota as canonical', () => {
      registerDynamicModelSpecs({
        argon: {
          percentage: 100,
          resetTime: '2026-10-28T00:00:00Z',
          display_name: 'Argon Experimental',
        },
      });

      expect(service.resolveModelRoute('argon')).toEqual({
        requestedModel: 'argon',
        normalizedModel: 'argon',
        resolvedModel: 'argon',
        source: 'canonical',
      });
      clearDynamicModelSpecs();
    });

    it('falls back to GEMINI_MODEL_ALIASES when not in CLAUDE_TO_GEMINI', () => {
      expect(service.resolveModelRoute('gemini-3-flash-preview')).toEqual({
        requestedModel: 'gemini-3-flash-preview',
        normalizedModel: 'gemini-3-flash-preview',
        resolvedModel: 'gemini-3-flash',
        source: 'built-in',
      });
    });

    it('returns a miss with the normalized id unchanged for an unknown model', () => {
      const requestedModel = 'not-a-real-model';

      expect(service.resolveModelRoute(requestedModel)).toEqual({
        requestedModel,
        normalizedModel: 'not-a-real-model',
        resolvedModel: 'not-a-real-model',
        source: 'miss',
      });
    });
  });

  describe('configured & wildcard mappings', () => {
    it('matches configured exact custom mapping', () => {
      setServerConfig({
        custom_mapping: { 'my-custom-model': 'gemini-3-flash-preview' },
      } as unknown as ProxyConfig);

      const res = service.resolveModelRoute('my-custom-model');
      expect(res.source).toBe('configured');
      expect(res.resolvedModel).toBe('gemini-3-flash'); // normalized alias of gemini-3-flash-preview
    });

    it('matches wildcard mapping with asterisk', () => {
      setServerConfig({
        custom_mapping: {
          'custom-prefix-*': 'gemini-3.7-flash',
          '': 'invalid-empty-key',
          'empty-target': '',
        },
      } as unknown as ProxyConfig);

      const res = service.resolveModelRoute('custom-prefix-super-fast');
      expect(res.source).toBe('configured');
      expect(res.resolvedModel).toBe('gemini-3.7-flash');
    });

    it('matches Anthropic family mapping when configured', () => {
      setServerConfig({
        anthropic_mapping: {
          'claude-3.5-series': 'gemini-3.7-flash-high',
        },
      } as unknown as ProxyConfig);

      // Model that triggers claude-3.5-series family but is not in CLAUDE_TO_GEMINI
      const res = service.resolveModelRoute('claude-3-5-custom-unreleased');
      expect(res.source).toBe('configured');
      expect(res.resolvedModel).toBe('gemini-3.7-flash-high');
    });
  });

  describe('dynamic legacy forwarding', () => {
    it('resolves dynamic forwarding target when registered', () => {
      updateDynamicForwardingRules('legacy-deprecated-xyz', 'gemini-3-flash');

      const res = service.resolveModelRoute('legacy-deprecated-xyz');
      expect(res.source).toBe('dynamic-legacy');
      expect(res.resolvedModel).toBe('gemini-3-flash');
    });
  });

  describe('normalizeGeminiModel and resolveTargetModel helpers', () => {
    it('normalizes model correctly', () => {
      expect(service.normalizeGeminiModel('models/gemini-2.0-flash')).toBe('gemini-2.0-flash');
      expect(service.normalizeGeminiModel('  gemini-pro  ')).toBe('gemini-pro');
    });

    it('resolveTargetModel returns resolved model directly', () => {
      expect(service.resolveTargetModel('claude-3-5-sonnet-20241022')).toBe(
        'claude-sonnet-4-6-thinking',
      );
    });
  });

  describe('resolveModelRouteForRequest (with side-effects)', () => {
    it('records miss to missJournal when model cannot be routed', () => {
      const res = service.resolveModelRouteForRequest('models/unknown-ai-model');
      expect(res.source).toBe('miss');
      expect(mockMissJournal.record).toHaveBeenCalledWith('models/unknown-ai-model');
    });

    it('does not record miss to missJournal when model is resolved', () => {
      const res = service.resolveModelRouteForRequest('claude-sonnet-4-6-thinking');
      expect(res.source).toBe('canonical');
      expect(mockMissJournal.record).not.toHaveBeenCalled();
    });

    it('handles omitted missJournal gracefully', () => {
      const standalone = new ModelRoutingService(undefined);
      expect(() => standalone.resolveModelRouteForRequest('unknown-model')).not.toThrow();
    });
  });

  describe('createModelSpecificHeaders', () => {
    it('returns empty headers for undefined or empty model', () => {
      expect(service.createModelSpecificHeaders(undefined)).toEqual({});
      expect(service.createModelSpecificHeaders('')).toEqual({});
    });

    it('returns anthropic-beta header for claude models', () => {
      const headers = service.createModelSpecificHeaders('claude-sonnet-4-6-thinking');
      expect(headers).toHaveProperty('anthropic-beta');
      expect(headers['anthropic-beta']).toContain('claude-code-20250219');
    });

    it('returns empty headers for non-claude models', () => {
      expect(service.createModelSpecificHeaders('gemini-2.0-flash')).toEqual({});
      expect(service.createModelSpecificHeaders('gpt-4o')).toEqual({});
    });
  });
});

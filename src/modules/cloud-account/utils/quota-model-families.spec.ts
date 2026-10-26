import {
  getQuotaModelFamilyId,
  aggregateQuotaModelFamilies,
  aggregateVisibleQuotaModelFamilies,
  getVisibleQuotaModelsForPresentation,
} from './quota-model-families';
import type { CloudQuotaModelInfo } from '@/modules/cloud-account/types';

describe('quota-model-families', () => {
  describe('getQuotaModelFamilyId', () => {
    it('categorizes image models into flash-image or pro-image', () => {
      expect(getQuotaModelFamilyId('gemini-2.5-flash-image')).toBe('gemini-flash-image');
      expect(getQuotaModelFamilyId('gemini-3-pro-image')).toBe('gemini-pro-image');
    });

    it('categorizes flash-lite and flash-thinking models', () => {
      expect(getQuotaModelFamilyId('gemini-3.1-flash-lite')).toBe('gemini-flash-lite');
      expect(getQuotaModelFamilyId('gemini-2.5-flash')).toBe('gemini-flash-lite');
      expect(getQuotaModelFamilyId('gemini-2.5-flash-thinking')).toBe('gemini-flash-lite');
    });

    it('categorizes pro series models', () => {
      expect(getQuotaModelFamilyId('gemini-3.1-pro-preview')).toBe('gemini-3.1-pro');
      expect(getQuotaModelFamilyId('gemini-pro')).toBe('gemini-3.1-pro');
      expect(getQuotaModelFamilyId('gemini-pro-agent')).toBe('gemini-3.1-pro');
    });

    it('categorizes gemini-3.7-flash and 3.6-flash series', () => {
      expect(getQuotaModelFamilyId('gemini-3.7-flash-high')).toBe('gemini-3.7-flash');
      expect(getQuotaModelFamilyId('gemini-3.6-flash-medium')).toBe('gemini-3.7-flash');
    });

    it('categorizes gemini-3.5-flash and gemini-3-flash series', () => {
      expect(getQuotaModelFamilyId('gemini-3.5-flash-low')).toBe('gemini-3.5-flash');
      expect(getQuotaModelFamilyId('gemini-3-flash')).toBe('gemini-3.5-flash');
      expect(getQuotaModelFamilyId('gemini-3-flash-agent')).toBe('gemini-3.5-flash');
    });

    it('categorizes claude and gpt-oss models', () => {
      expect(getQuotaModelFamilyId('claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
      expect(getQuotaModelFamilyId('claude-opus-4-5-preview')).toBe('claude-opus-4-5');
      expect(getQuotaModelFamilyId('gpt-oss-120b-medium')).toBe('gpt-oss-120b');
    });

    it('returns normalized model name when no family matches', () => {
      expect(getQuotaModelFamilyId('models/custom-experimental-model')).toBe('custom-experimental-model');
    });
  });

  describe('aggregateQuotaModelFamilies & presentations', () => {
    it('aggregates multiple models in the same family', () => {
      const models: Record<string, CloudQuotaModelInfo> = {
        'gemini-3.7-flash-low': {
          percentage: 0.8,
          resetTime: '2026-10-25T12:00:00Z',
          display_name: 'Flash Low',
          supports_thinking: true,
        } as any,
        'gemini-3.7-flash-high': {
          percentage: 0.5,
          resetTime: '2026-10-25T10:00:00Z',
          display_name: 'Flash High',
          supports_thinking: true,
        } as any,
      };

      const aggregated = aggregateQuotaModelFamilies(models);
      expect(aggregated['gemini-3.7-flash']).toBeDefined();
      expect(aggregated['gemini-3.7-flash'].percentage).toBe(0.5); // lowest percentage
      expect(aggregated['gemini-3.7-flash'].resetTime).toBe('2026-10-25T10:00:00Z'); // earliest reset
    });

    it('returns visible quota models for presentation', () => {
      const models: Record<string, CloudQuotaModelInfo> = {
        'gemini-3.1-pro-high': {
          percentage: 1.0,
          resetTime: '2026-10-25T15:00:00Z',
        } as any,
      };

      const visible = getVisibleQuotaModelsForPresentation(models, {});
      expect(Object.keys(visible)).toContain('gemini-3.1-pro-high');
    });

    it('aggregates visible quota model families with visibility settings filter', () => {
      const models: Record<string, CloudQuotaModelInfo> = {
        'gemini-3.7-flash': { percentage: 0.9, resetTime: '2026-10-25T12:00:00Z' } as any,
        'gemini-3.1-pro': { percentage: 0.7, resetTime: '2026-10-25T12:00:00Z' } as any,
      };

      const visible = aggregateVisibleQuotaModelFamilies(models, { 'gemini-3.7-flash': false });
      expect(visible['gemini-3.7-flash']).toBeUndefined();
      expect(visible['gemini-3.1-pro']).toBeDefined();
    });
  });
});

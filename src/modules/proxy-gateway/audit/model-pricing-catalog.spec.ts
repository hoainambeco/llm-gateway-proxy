import {
  getModelPricing,
  calculateEstimatedCostUsd,
  DEFAULT_MODEL_PRICE,
} from './model-pricing-catalog';

describe('model-pricing-catalog', () => {
  describe('getModelPricing', () => {
    it('returns default model price when model name is null, undefined, or empty', () => {
      expect(getModelPricing(null)).toEqual(DEFAULT_MODEL_PRICE);
      expect(getModelPricing(undefined)).toEqual(DEFAULT_MODEL_PRICE);
      expect(getModelPricing('')).toEqual(DEFAULT_MODEL_PRICE);
    });

    it('returns correct rates for Claude models', () => {
      expect(getModelPricing('claude-3-7-sonnet-20250219')).toEqual({
        promptUsdPerMillion: 3.0,
        completionUsdPerMillion: 15.0,
      });
      expect(getModelPricing('claude-sonnet-4')).toEqual({
        promptUsdPerMillion: 3.0,
        completionUsdPerMillion: 15.0,
      });
      expect(getModelPricing('claude-3-5-haiku-20241022')).toEqual({
        promptUsdPerMillion: 0.8,
        completionUsdPerMillion: 4.0,
      });
      expect(getModelPricing('claude-3-opus-20240229')).toEqual({
        promptUsdPerMillion: 15.0,
        completionUsdPerMillion: 75.0,
      });
      expect(getModelPricing('claude-opus-4')).toEqual({
        promptUsdPerMillion: 15.0,
        completionUsdPerMillion: 75.0,
      });
    });

    it('returns correct rates for Gemini models', () => {
      expect(getModelPricing('gemini-2.5-pro')).toEqual({
        promptUsdPerMillion: 1.25,
        completionUsdPerMillion: 5.0,
      });
      expect(getModelPricing('gemini-3.1-pro')).toEqual({
        promptUsdPerMillion: 1.25,
        completionUsdPerMillion: 5.0,
      });
      expect(getModelPricing('gemini-pro-vision')).toEqual({
        promptUsdPerMillion: 1.25,
        completionUsdPerMillion: 5.0,
      });
      expect(getModelPricing('gemini-2.5-flash')).toEqual({
        promptUsdPerMillion: 0.15,
        completionUsdPerMillion: 0.6,
      });
      expect(getModelPricing('gemini-3-flash')).toEqual({
        promptUsdPerMillion: 0.15,
        completionUsdPerMillion: 0.6,
      });
      expect(getModelPricing('gemini-flash')).toEqual({
        promptUsdPerMillion: 0.15,
        completionUsdPerMillion: 0.6,
      });
    });

    it('returns correct rates for OpenAI models', () => {
      expect(getModelPricing('gpt-4o-mini')).toEqual({
        promptUsdPerMillion: 0.15,
        completionUsdPerMillion: 0.6,
      });
      expect(getModelPricing('gpt-4o')).toEqual({
        promptUsdPerMillion: 2.5,
        completionUsdPerMillion: 10.0,
      });
    });

    it('returns default rate for unrecognized models', () => {
      expect(getModelPricing('some-unregistered-custom-model')).toEqual(DEFAULT_MODEL_PRICE);
    });
  });

  describe('calculateEstimatedCostUsd', () => {
    it('calculates cost and rounds to 4 decimal places', () => {
      // For claude-3-7-sonnet: 3.0 prompt, 15.0 completion per million
      // 1,000,000 prompt = $3.00, 500,000 completion = $7.50 -> $10.50
      const cost = calculateEstimatedCostUsd('claude-3-7-sonnet', 1_000_000, 500_000);
      expect(cost).toBe(10.5);

      // Smaller numbers: 1,000 prompt, 500 completion
      // 1,000 / 1M * 3 = 0.003
      // 500 / 1M * 15 = 0.0075
      // total = 0.0105
      const smallCost = calculateEstimatedCostUsd('claude-3-7-sonnet', 1_000, 500);
      expect(smallCost).toBe(0.0105);
    });

    it('works with null/undefined model using default pricing', () => {
      // Default: 1.0 prompt, 3.0 completion per million
      // 1M prompt = $1.00, 1M completion = $3.00 -> $4.00
      const cost = calculateEstimatedCostUsd(null, 1_000_000, 1_000_000);
      expect(cost).toBe(4.0);
    });
  });
});

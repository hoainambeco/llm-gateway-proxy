export interface ModelPriceRate {
  promptUsdPerMillion: number;
  completionUsdPerMillion: number;
}

export const DEFAULT_MODEL_PRICE: ModelPriceRate = {
  promptUsdPerMillion: 1.0,
  completionUsdPerMillion: 3.0,
};

export function getModelPricing(modelName: string | null | undefined): ModelPriceRate {
  if (!modelName) return DEFAULT_MODEL_PRICE;
  const m = modelName.toLowerCase();
  if (m.includes('claude-3-7-sonnet') || m.includes('claude-sonnet-4')) {
    return { promptUsdPerMillion: 3.0, completionUsdPerMillion: 15.0 };
  }
  if (m.includes('claude-3-5-haiku')) {
    return { promptUsdPerMillion: 0.8, completionUsdPerMillion: 4.0 };
  }
  if (m.includes('claude-3-opus') || m.includes('claude-opus-4')) {
    return { promptUsdPerMillion: 15.0, completionUsdPerMillion: 75.0 };
  }
  if (m.includes('gemini-2.5-pro') || m.includes('gemini-3.1-pro') || m.includes('gemini-pro')) {
    return { promptUsdPerMillion: 1.25, completionUsdPerMillion: 5.0 };
  }
  if (m.includes('gemini-2.5-flash') || m.includes('gemini-3-flash') || m.includes('gemini-flash')) {
    return { promptUsdPerMillion: 0.15, completionUsdPerMillion: 0.6 };
  }
  if (m.includes('gpt-4o-mini')) {
    return { promptUsdPerMillion: 0.15, completionUsdPerMillion: 0.6 };
  }
  if (m.includes('gpt-4o')) {
    return { promptUsdPerMillion: 2.5, completionUsdPerMillion: 10.0 };
  }
  return DEFAULT_MODEL_PRICE;
}

export function calculateEstimatedCostUsd(
  modelName: string | null | undefined,
  promptTokens: number,
  completionTokens: number,
): number {
  const rate = getModelPricing(modelName);
  const cost =
    (promptTokens / 1_000_000) * rate.promptUsdPerMillion +
    (completionTokens / 1_000_000) * rate.completionUsdPerMillion;
  return Math.round(cost * 10000) / 10000;
}

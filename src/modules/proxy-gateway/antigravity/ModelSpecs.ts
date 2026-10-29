import modelSpecsJson from './model-specs';
import { isNumber } from 'lodash-es';
import type { CloudQuotaModelInfo } from '@/modules/cloud-account/types';

export type ModelSpec = {
  max_output_tokens?: number;
  thinking_budget?: number;
  is_thinking?: boolean;
  display_name?: string;
};

type SpecsConfig = {
  models: Record<string, ModelSpec>;
  aliases: Record<string, string>;
};

export const DEFAULT_MAX_OUTPUT_TOKENS = 65535;
export const DEFAULT_THINKING_BUDGET = 24576;

const SPECS = modelSpecsJson as SpecsConfig;

const DYNAMIC_SPECS = new Map<string, ModelSpec>();

/**
 * Register dynamic model specifications discovered from upstream account quotas.
 */
export function registerDynamicModelSpecs(
  models: Record<string, CloudQuotaModelInfo> | undefined,
): void {
  if (!models) {
    return;
  }
  for (const [modelId, info] of Object.entries(models)) {
    const normalized = modelId.trim().toLowerCase();
    DYNAMIC_SPECS.set(normalized, {
      max_output_tokens: info.max_output_tokens,
      thinking_budget: info.thinking_budget,
      is_thinking: info.supports_thinking,
      display_name: info.display_name,
    });
  }
}

/**
 * Read-only view of dynamic model specs.
 */
export function getDynamicModelSpecs(): ReadonlyMap<string, ModelSpec> {
  return DYNAMIC_SPECS;
}

/**
 * Clear all dynamic model specifications (for resets and testing).
 */
export function clearDynamicModelSpecs(): void {
  DYNAMIC_SPECS.clear();
}

export function resolveModelAlias(modelId: string): string {
  const normalized = modelId.trim();
  return SPECS.aliases[normalized] ?? normalized;
}

/**
 * Check whether a model supports thinking/reasoning.
 */
export function isThinkingModel(modelId: string): boolean {
  const normalized = modelId.trim().toLowerCase();
  const dynamic = DYNAMIC_SPECS.get(normalized)?.is_thinking;
  if (dynamic !== undefined) {
    return dynamic;
  }

  const baseMatch = /^(.+)-(?:low|medium|high|extra-low)$/i.exec(normalized);
  if (baseMatch) {
    const baseDynamic = DYNAMIC_SPECS.get(baseMatch[1])?.is_thinking;
    if (baseDynamic !== undefined) {
      return baseDynamic;
    }
    const baseSpec = SPECS.models[resolveModelAlias(baseMatch[1])]?.is_thinking;
    if (baseSpec !== undefined) {
      return baseSpec;
    }
  }

  const resolved = resolveModelAlias(modelId);
  return SPECS.models[resolved]?.is_thinking ?? false;
}

export function getMaxOutputTokens(modelId: string): number {
  const normalized = modelId.trim().toLowerCase();
  const dynamic = DYNAMIC_SPECS.get(normalized)?.max_output_tokens;
  if (isNumber(dynamic) && Number.isFinite(dynamic) && dynamic > 0) {
    return Math.floor(dynamic);
  }

  const baseMatch = /^(.+)-(?:low|medium|high|extra-low)$/i.exec(normalized);
  if (baseMatch) {
    const baseDynamic = DYNAMIC_SPECS.get(baseMatch[1])?.max_output_tokens;
    if (isNumber(baseDynamic) && Number.isFinite(baseDynamic) && baseDynamic > 0) {
      return Math.floor(baseDynamic);
    }
    const baseSpec = SPECS.models[resolveModelAlias(baseMatch[1])]?.max_output_tokens;
    if (isNumber(baseSpec) && Number.isFinite(baseSpec) && baseSpec > 0) {
      return Math.floor(baseSpec);
    }
  }

  const resolved = resolveModelAlias(modelId);
  const fromSpec = SPECS.models[resolved]?.max_output_tokens;
  if (isNumber(fromSpec) && Number.isFinite(fromSpec) && fromSpec > 0) {
    return Math.floor(fromSpec);
  }
  return DEFAULT_MAX_OUTPUT_TOKENS;
}

export function getThinkingBudget(modelId: string): number {
  const normalized = modelId.trim().toLowerCase();

  // 1. Read from DYNAMIC_SPECS first for exact model name
  const dynamic = DYNAMIC_SPECS.get(normalized)?.thinking_budget;
  if (isNumber(dynamic) && Number.isFinite(dynamic) && dynamic >= 0) {
    return Math.floor(dynamic);
  }

  // 2. Strip suffixes (-low, -medium, -high, -extra-low) to read base model dynamic spec (or static spec)
  const variantMatch = /^(.+)-(low|medium|high|extra-low)$/i.exec(normalized);
  if (variantMatch) {
    const base = variantMatch[1];
    const tier = variantMatch[2].toLowerCase();
    const baseBudget =
      DYNAMIC_SPECS.get(base)?.thinking_budget ??
      SPECS.models[resolveModelAlias(base)]?.thinking_budget;
    if (isNumber(baseBudget) && Number.isFinite(baseBudget) && baseBudget > 0) {
      if (tier === 'extra-low' || tier === 'low') {
        return Math.max(1000, Math.floor(baseBudget * 0.15));
      } else if (tier === 'medium') {
        return Math.max(2000, Math.floor(baseBudget * 0.40));
      } else if (tier === 'high') {
        return baseBudget;
      }
    }
  }

  // 3. Static spec fallback for exact model name / resolved alias
  const resolved = resolveModelAlias(modelId);
  const fromSpec = SPECS.models[resolved]?.thinking_budget;
  if (isNumber(fromSpec) && Number.isFinite(fromSpec) && fromSpec >= 0) {
    return Math.floor(fromSpec);
  }

  // 4. Safe default
  return DEFAULT_THINKING_BUDGET;
}

import { toProviderModelDetails } from './provider-model-details';
import type { CloudQuotaModelInfo } from '@/modules/cloud-account/types';

describe('toProviderModelDetails', () => {
  it('returns undefined when modelDetails is undefined or null', () => {
    expect(toProviderModelDetails(undefined)).toBeUndefined();
  });

  it('returns undefined when all fields are undefined or invalid numbers', () => {
    expect(
      toProviderModelDetails({} as CloudQuotaModelInfo),
    ).toBeUndefined();

    expect(
      toProviderModelDetails({
        max_output_tokens: -5,
        max_tokens: 0,
        thinking_budget: -1,
      } as unknown as CloudQuotaModelInfo),
    ).toBeUndefined();
  });

  it('normalizes max_output_tokens and thinking_budget', () => {
    const details = toProviderModelDetails({
      max_output_tokens: 8192.5,
      thinking_budget: 1024.9,
    } as unknown as CloudQuotaModelInfo);

    expect(details).toEqual({
      maxOutputTokens: 8192,
      thinkingBudget: 1024,
      modalities: undefined,
    });
  });

  it('falls back to max_tokens when max_output_tokens is undefined', () => {
    const details = toProviderModelDetails({
      max_tokens: 4096,
      thinking_budget: 0, // 0 is non-negative and valid
    } as unknown as CloudQuotaModelInfo);

    expect(details).toEqual({
      maxOutputTokens: 4096,
      thinkingBudget: 0,
      modalities: undefined,
    });
  });

  it('extracts modalities when supports_images or supported_mime_types is defined', () => {
    const details = toProviderModelDetails({
      supports_images: true,
      supported_mime_types: { 'image/png': true, 'image/jpeg': false },
    } as unknown as CloudQuotaModelInfo);

    expect(details).toEqual({
      maxOutputTokens: undefined,
      thinkingBudget: undefined,
      modalities: {
        supportsImages: true,
        supportedMimeTypes: { 'image/png': true, 'image/jpeg': false },
      },
    });
  });
});

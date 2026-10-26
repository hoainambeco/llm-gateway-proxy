import {
  IMAGE_GENERATION_SAFETY_SETTINGS,
  normalizeExplicitImageSize,
  imageAspectRatioFromSize,
  selectImageAspectRatioInput,
  cleanImageModelName,
  resolveImageGenerationConfig,
} from './ImageGenerationConfig';

describe('ImageGenerationConfig', () => {
  describe('IMAGE_GENERATION_SAFETY_SETTINGS', () => {
    it('defines 4 safety categories with threshold OFF', () => {
      expect(IMAGE_GENERATION_SAFETY_SETTINGS).toHaveLength(4);
      expect(IMAGE_GENERATION_SAFETY_SETTINGS.every((s) => s.threshold === 'OFF')).toBe(true);
    });
  });

  describe('normalizeExplicitImageSize', () => {
    it('returns undefined for null, undefined, or auto', () => {
      expect(normalizeExplicitImageSize(undefined)).toBeUndefined();
      expect(normalizeExplicitImageSize(null)).toBeUndefined();
      expect(normalizeExplicitImageSize('auto')).toBeUndefined();
      expect(normalizeExplicitImageSize(' AUTO ')).toBeUndefined();
      expect(normalizeExplicitImageSize('')).toBeUndefined();
    });

    it('normalizes valid sizes to uppercase 1K, 2K, 4K', () => {
      expect(normalizeExplicitImageSize('1k')).toBe('1K');
      expect(normalizeExplicitImageSize('2K')).toBe('2K');
      expect(normalizeExplicitImageSize('  4k  ')).toBe('4K');
    });

    it('throws error for non-string or invalid size', () => {
      expect(() => normalizeExplicitImageSize(123)).toThrow('Invalid image_size');
      expect(() => normalizeExplicitImageSize('8k')).toThrow('Invalid image_size');
      expect(() => normalizeExplicitImageSize('large')).toThrow('Invalid image_size');
    });
  });

  describe('imageAspectRatioFromSize', () => {
    it('returns undefined for non-string, empty, or auto', () => {
      expect(imageAspectRatioFromSize(undefined)).toBeUndefined();
      expect(imageAspectRatioFromSize(null)).toBeUndefined();
      expect(imageAspectRatioFromSize('')).toBeUndefined();
      expect(imageAspectRatioFromSize('auto')).toBeUndefined();
    });

    it('recognizes direct aspect ratio strings', () => {
      expect(imageAspectRatioFromSize('16:9')).toBe('16:9');
      expect(imageAspectRatioFromSize('1:1')).toBe('1:1');
      expect(imageAspectRatioFromSize('4:3')).toBe('4:3');
      expect(imageAspectRatioFromSize('9:16')).toBe('9:16');
      expect(imageAspectRatioFromSize('21:9')).toBe('21:9');
    });

    it('computes aspect ratio from pixel dimensions', () => {
      expect(imageAspectRatioFromSize('1920x1080')).toBe('16:9');
      expect(imageAspectRatioFromSize('1024x1024')).toBe('1:1');
      expect(imageAspectRatioFromSize('1080x1920')).toBe('9:16');
      expect(imageAspectRatioFromSize('1200x900')).toBe('4:3');
      expect(imageAspectRatioFromSize('800x1000')).toBe('4:5');
    });

    it('returns undefined for malformed or non-positive dimensions', () => {
      expect(imageAspectRatioFromSize('1920')).toBeUndefined();
      expect(imageAspectRatioFromSize('1920x1080x2')).toBeUndefined();
      expect(imageAspectRatioFromSize('1920x 1080')).toBeUndefined();
      expect(imageAspectRatioFromSize('abcxdef')).toBeUndefined();
      expect(imageAspectRatioFromSize('0x1080')).toBeUndefined();
      expect(imageAspectRatioFromSize('-1920x1080')).toBeUndefined();
    });
  });

  describe('selectImageAspectRatioInput', () => {
    it('returns preferred when valid', () => {
      expect(selectImageAspectRatioInput('16:9', '1:1')).toBe('16:9');
    });

    it('returns fallback when preferred is invalid but fallback is valid', () => {
      expect(selectImageAspectRatioInput('invalid', '1:1')).toBe('1:1');
      expect(selectImageAspectRatioInput(undefined, '4:3')).toBe('4:3');
    });

    it('returns undefined when neither is valid', () => {
      expect(selectImageAspectRatioInput('invalid1', 'invalid2')).toBeUndefined();
    });
  });

  describe('cleanImageModelName', () => {
    it('strips single resolution and aspect ratio suffixes', () => {
      expect(cleanImageModelName('imagen-3.0-generate-002-hd')).toBe('imagen-3.0-generate-002');
      expect(cleanImageModelName('imagen-3.0-generate-002-16x9')).toBe('imagen-3.0-generate-002');
      expect(cleanImageModelName('imagen-3.0-generate-002-16-9')).toBe('imagen-3.0-generate-002');
    });

    it('recursively strips multiple suffixes', () => {
      expect(cleanImageModelName('imagen-3.0-generate-002-4k-16x9')).toBe('imagen-3.0-generate-002');
      expect(cleanImageModelName('imagen-3.0-generate-002-standard-1x1')).toBe('imagen-3.0-generate-002');
    });
  });

  describe('resolveImageGenerationConfig', () => {
    it('resolves config from input parameters', () => {
      const result = resolveImageGenerationConfig('imagen-3.0-generate-002', {
        size: '1920x1080',
        quality: 'hd',
      });

      expect(result.imageConfig.aspectRatio).toBe('16:9');
      expect(result.imageConfig.imageSize).toBe('4K');
      expect(result.parsedBaseModel).toBe('imagen-3.0-generate-002');
    });

    it('falls back to model name suffixes when input parameters are omitted', () => {
      const result = resolveImageGenerationConfig('imagen-3.0-generate-002-2k-16-9');
      expect(result.imageConfig.aspectRatio).toBe('16:9');
      expect(result.imageConfig.imageSize).toBe('2K');
      expect(result.parsedBaseModel).toBe('imagen-3.0-generate-002');
    });

    it('falls back to 1:1 aspect ratio when no aspect ratio can be inferred', () => {
      const result = resolveImageGenerationConfig('imagen-3.0-generate-002-standard');
      expect(result.imageConfig.aspectRatio).toBe('1:1');
      expect(result.imageConfig.imageSize).toBe('1K');
      expect(result.parsedBaseModel).toBe('imagen-3.0-generate-002');
    });

    it('maps quality values: low/standard/1k -> 1K, medium/2k -> 2K, high/hd/4k -> 4K', () => {
      expect(
        resolveImageGenerationConfig('model', { quality: 'low' }).imageConfig.imageSize,
      ).toBe('1K');
      expect(
        resolveImageGenerationConfig('model', { quality: 'medium' }).imageConfig.imageSize,
      ).toBe('2K');
      expect(
        resolveImageGenerationConfig('model', { quality: 'high' }).imageConfig.imageSize,
      ).toBe('4K');
    });
  });
});

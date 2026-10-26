import {
  isMalformedFunctionCallFinishReason,
  mapGeminiFinishReasonToOpenAI,
  MALFORMED_FUNCTION_CALL_RECOVERY_TEXT,
} from './GeminiFinishReason';

describe('GeminiFinishReason', () => {
  describe('isMalformedFunctionCallFinishReason', () => {
    it('returns true for MALFORMED_FUNCTION_CALL regardless of casing', () => {
      expect(isMalformedFunctionCallFinishReason('MALFORMED_FUNCTION_CALL')).toBe(true);
      expect(isMalformedFunctionCallFinishReason('malformed_function_call')).toBe(true);
    });

    it('returns false for null, undefined, empty, or normal stop reasons', () => {
      expect(isMalformedFunctionCallFinishReason(null)).toBe(false);
      expect(isMalformedFunctionCallFinishReason(undefined)).toBe(false);
      expect(isMalformedFunctionCallFinishReason('')).toBe(false);
      expect(isMalformedFunctionCallFinishReason('STOP')).toBe(false);
      expect(isMalformedFunctionCallFinishReason('MAX_TOKENS')).toBe(false);
    });
  });

  describe('mapGeminiFinishReasonToOpenAI', () => {
    it('returns null for falsy finish reasons', () => {
      expect(mapGeminiFinishReasonToOpenAI(null)).toBeNull();
      expect(mapGeminiFinishReasonToOpenAI(undefined)).toBeNull();
      expect(mapGeminiFinishReasonToOpenAI('')).toBeNull();
    });

    it('maps STOP and MALFORMED_FUNCTION_CALL to stop', () => {
      expect(mapGeminiFinishReasonToOpenAI('STOP')).toBe('stop');
      expect(mapGeminiFinishReasonToOpenAI('stop')).toBe('stop');
      expect(mapGeminiFinishReasonToOpenAI('MALFORMED_FUNCTION_CALL')).toBe('stop');
    });

    it('maps MAX_TOKENS to length', () => {
      expect(mapGeminiFinishReasonToOpenAI('MAX_TOKENS')).toBe('length');
      expect(mapGeminiFinishReasonToOpenAI('max_tokens')).toBe('length');
    });

    it('maps SAFETY and RECITATION to content_filter', () => {
      expect(mapGeminiFinishReasonToOpenAI('SAFETY')).toBe('content_filter');
      expect(mapGeminiFinishReasonToOpenAI('RECITATION')).toBe('content_filter');
    });

    it('defaults unknown finish reasons to stop', () => {
      expect(mapGeminiFinishReasonToOpenAI('UNKNOWN_STATE')).toBe('stop');
      expect(mapGeminiFinishReasonToOpenAI('OTHER')).toBe('stop');
    });
  });

  describe('MALFORMED_FUNCTION_CALL_RECOVERY_TEXT', () => {
    it('provides a non-empty fallback string', () => {
      expect(typeof MALFORMED_FUNCTION_CALL_RECOVERY_TEXT).toBe('string');
      expect(MALFORMED_FUNCTION_CALL_RECOVERY_TEXT.length).toBeGreaterThan(0);
    });
  });
});

import {
  PLACEHOLDER_THOUGHT_SIGNATURE,
  isGeminiFlashModel,
  modelKeepsThinkingWithoutSignature,
  injectPlaceholderSignaturesForModel,
} from './ThoughtSignatureCompat';
import type { GeminiContent } from './types';

describe('ThoughtSignatureCompat', () => {
  describe('isGeminiFlashModel', () => {
    it('returns true for gemini flash models', () => {
      expect(isGeminiFlashModel('gemini-3-flash')).toBe(true);
      expect(isGeminiFlashModel('gemini-2.5-flash-preview')).toBe(true);
    });

    it('returns false for non-flash or non-gemini models', () => {
      expect(isGeminiFlashModel('gemini-3-pro')).toBe(false);
      expect(isGeminiFlashModel('claude-3-5-sonnet')).toBe(false);
    });
  });

  describe('modelKeepsThinkingWithoutSignature', () => {
    it('returns true for flash models or gemini-pro-agent', () => {
      expect(modelKeepsThinkingWithoutSignature('gemini-3-flash')).toBe(true);
      expect(modelKeepsThinkingWithoutSignature('gemini-pro-agent')).toBe(true);
    });

    it('returns false for standard pro models', () => {
      expect(modelKeepsThinkingWithoutSignature('gemini-3-pro')).toBe(false);
    });
  });

  describe('injectPlaceholderSignaturesForModel', () => {
    it('leaves contents unchanged when no functionCall is present', () => {
      const contents: GeminiContent[] = [
        { role: 'user', parts: [{ text: 'Hello' }] },
      ];
      const result = injectPlaceholderSignaturesForModel(contents, 'gemini-3-flash');
      expect(result).toBe(contents);
    });

    it('injects placeholder signature for unsigned tool calls on flash models', () => {
      const contents: GeminiContent[] = [
        {
          role: 'model',
          parts: [
            {
              functionCall: {
                name: 'search',
                args: { query: 'test' },
              },
            },
          ],
        },
      ];

      const result = injectPlaceholderSignaturesForModel(contents, 'gemini-3-flash');
      expect(result).not.toBe(contents);
      expect(result[0].parts[0].thoughtSignature).toBe(PLACEHOLDER_THOUGHT_SIGNATURE);
      expect(result[0].parts[0].thought_signature).toBe(PLACEHOLDER_THOUGHT_SIGNATURE);
    });

    it('does not inject placeholder for non-flash models', () => {
      const contents: GeminiContent[] = [
        {
          role: 'model',
          parts: [
            {
              functionCall: {
                name: 'search',
                args: { query: 'test' },
              },
            },
          ],
        },
      ];

      const result = injectPlaceholderSignaturesForModel(contents, 'gemini-3-pro');
      expect(result).toBe(contents);
    });

    it('preserves existing thoughtSignature when present and synchronizes aliases', () => {
      const contents: GeminiContent[] = [
        {
          role: 'model',
          parts: [
            {
              functionCall: {
                name: 'search',
                args: {},
              },
              thoughtSignature: 'existing-sig',
            },
          ],
        },
      ];

      const result = injectPlaceholderSignaturesForModel(contents, 'gemini-3-pro');
      expect(result[0].parts[0].thoughtSignature).toBe('existing-sig');
      expect(result[0].parts[0].thought_signature).toBe('existing-sig');
    });

    it('leaves parts alone if both thoughtSignature and thought_signature are already defined', () => {
      const contents: GeminiContent[] = [
        {
          role: 'model',
          parts: [
            {
              functionCall: {
                name: 'search',
                args: {},
              },
              thoughtSignature: 'sig1',
              thought_signature: 'sig2',
            },
          ],
        },
      ];

      const result = injectPlaceholderSignaturesForModel(contents, 'gemini-3-flash');
      expect(result).toBe(contents);
    });
  });
});

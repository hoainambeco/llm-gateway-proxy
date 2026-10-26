import {
  resolveGlobalSystemPrompt,
  hasGlobalSystemPrompt,
  formatGlobalSystemPrompt,
} from './GlobalSystemPrompt';

describe('GlobalSystemPrompt', () => {
  describe('resolveGlobalSystemPrompt', () => {
    it('returns null when config is undefined or disabled', () => {
      expect(resolveGlobalSystemPrompt(undefined)).toBeNull();
      expect(resolveGlobalSystemPrompt({ enabled: false, content: 'Some prompt' })).toBeNull();
    });

    it('returns null when enabled but content is empty or whitespace', () => {
      expect(resolveGlobalSystemPrompt({ enabled: true, content: '   ' })).toBeNull();
      expect(resolveGlobalSystemPrompt({ enabled: true, content: '' })).toBeNull();
    });

    it('returns trimmed content when enabled and non-empty', () => {
      expect(
        resolveGlobalSystemPrompt({ enabled: true, content: '  Act as a senior engineer.  ' }),
      ).toBe('Act as a senior engineer.');
    });
  });

  describe('hasGlobalSystemPrompt', () => {
    it('returns true when any text part contains the global prompt', () => {
      const parts = [
        { text: 'Prefix instructions' },
        { text: 'Act as a senior engineer. Follow best practices.' },
      ];
      expect(hasGlobalSystemPrompt(parts, 'Act as a senior engineer.')).toBe(true);
    });

    it('returns false when no text part contains the prompt', () => {
      const parts = [{ text: 'Different instructions' }];
      expect(hasGlobalSystemPrompt(parts, 'Act as a senior engineer.')).toBe(false);
    });
  });

  describe('formatGlobalSystemPrompt', () => {
    it('appends double newline', () => {
      expect(formatGlobalSystemPrompt('Hello')).toBe('Hello\n\n');
    });
  });
});

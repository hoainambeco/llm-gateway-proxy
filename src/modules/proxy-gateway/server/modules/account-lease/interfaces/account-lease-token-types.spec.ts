import {
  normalizeProjectId,
  normalizeModelId,
  normalizeClientKey,
} from './account-lease-token-types';

describe('account-lease-token-types utilities', () => {
  describe('normalizeProjectId', () => {
    it('returns undefined for non-strings, null, undefined, or empty strings', () => {
      expect(normalizeProjectId(null)).toBeUndefined();
      expect(normalizeProjectId(undefined)).toBeUndefined();
      expect(normalizeProjectId(123 as unknown as string)).toBeUndefined();
      expect(normalizeProjectId('')).toBeUndefined();
      expect(normalizeProjectId('   ')).toBeUndefined();
    });

    it('returns undefined for cloud-code-* projects', () => {
      expect(normalizeProjectId('cloud-code-12345')).toBeUndefined();
      expect(normalizeProjectId('CLOUD-CODE-999')).toBeUndefined();
    });

    it('returns undefined for projects/ or projects paths', () => {
      expect(normalizeProjectId('projects')).toBeUndefined();
      expect(normalizeProjectId('projects/my-proj')).toBeUndefined();
      expect(normalizeProjectId('PROJECTS/123')).toBeUndefined();
    });

    it('returns trimmed valid project ID', () => {
      expect(normalizeProjectId('  my-valid-project-id  ')).toBe('my-valid-project-id');
    });
  });

  describe('normalizeModelId', () => {
    it('returns undefined for non-strings', () => {
      expect(normalizeModelId(null)).toBeUndefined();
      expect(normalizeModelId(undefined)).toBeUndefined();
      expect(normalizeModelId(456 as unknown as string)).toBeUndefined();
    });

    it('strips leading models/ prefix and trims', () => {
      expect(normalizeModelId('models/gemini-2.0-flash')).toBe('gemini-2.0-flash');
      expect(normalizeModelId('MODELS/claude-3-5-sonnet')).toBe('claude-3-5-sonnet');
      expect(normalizeModelId('models/')).toBeUndefined();
      expect(normalizeModelId('  ')).toBeUndefined();
    });
  });

  describe('normalizeClientKey', () => {
    it('returns undefined for non-strings or empty strings', () => {
      expect(normalizeClientKey(undefined)).toBeUndefined();
      expect(normalizeClientKey(null as unknown as string)).toBeUndefined();
      expect(normalizeClientKey('')).toBeUndefined();
      expect(normalizeClientKey('   ')).toBeUndefined();
    });

    it('trims and lowercases client key', () => {
      expect(normalizeClientKey('  My-OAuth-Key  ')).toBe('my-oauth-key');
    });
  });
});

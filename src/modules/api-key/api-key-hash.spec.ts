import {
  API_KEY_HASH_LENGTH,
  generateApiKey,
  hashApiKey,
  hashesEqual,
  previewApiKey,
} from './api-key-hash';

describe('api-key-hash', () => {
  it('generates sk-ag keys with 48 hex characters', () => {
    expect(generateApiKey()).toMatch(/^sk-ag-[0-9a-f]{48}$/);
  });

  it('hashes deterministically and trims surrounding whitespace', () => {
    expect(hashApiKey(' abc ')).toBe(hashApiKey('abc'));
    expect(hashApiKey('abc')).toHaveLength(API_KEY_HASH_LENGTH);
  });

  it('compares only well-formed equal-length digests', () => {
    expect(hashesEqual(hashApiKey('a'), hashApiKey('a'))).toBe(true);
    expect(hashesEqual('abc', 'abc')).toBe(false);
  });

  it('previews without exposing the middle', () => {
    expect(previewApiKey('sk-ag-1234567890abcdef')).toBe('sk-ag-12...cdef');
    expect(previewApiKey('short')).toBe('****');
  });
});

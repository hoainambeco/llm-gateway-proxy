import { normalizeTrustedGoogleValidationUrl } from './google-validation-url';

describe('google-validation-url', () => {
  it('returns undefined for undefined, empty, or invalid URLs', () => {
    expect(normalizeTrustedGoogleValidationUrl(undefined)).toBeUndefined();
    expect(normalizeTrustedGoogleValidationUrl('')).toBeUndefined();
    expect(normalizeTrustedGoogleValidationUrl('not a url')).toBeUndefined();
  });

  it('rejects non-https URLs', () => {
    expect(normalizeTrustedGoogleValidationUrl('http://accounts.google.com/auth')).toBeUndefined();
  });

  it('rejects untrusted hosts', () => {
    expect(normalizeTrustedGoogleValidationUrl('https://evil.com/auth')).toBeUndefined();
    expect(normalizeTrustedGoogleValidationUrl('https://google.com/auth')).toBeUndefined();
  });

  it('returns normalized URL string for trusted accounts.google.com URLs', () => {
    const validUrl = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=123';
    expect(normalizeTrustedGoogleValidationUrl(validUrl)).toBe(validUrl);
  });
});

import {
  FALLBACK_VERSION,
  resolveLocalInstalledVersion,
  buildUserAgent,
  resolveRequestUserAgent,
} from './request-user-agent';

describe('request-user-agent', () => {
  it('resolves local installed version or fallback version', () => {
    expect(resolveLocalInstalledVersion()).toBe(FALLBACK_VERSION);
  });

  it('builds user agent string with antigravity prefix, version, platform, and arch', () => {
    const ua = buildUserAgent('1.2.3');
    expect(ua).toMatch(/^antigravity\/1\.2\.3 (windows|darwin|linux)\/(amd64|arm64|[a-zA-Z0-9_-]+)$/);
  });

  it('resolves request user agent using local fallback under test environment', async () => {
    const ua = await resolveRequestUserAgent();
    expect(ua).toContain(`antigravity/${FALLBACK_VERSION}`);

    // Hits cache
    const cached = await resolveRequestUserAgent();
    expect(cached).toBe(ua);
  });
});

import { isValidProxyUrl } from './url';

describe('isValidProxyUrl', () => {
  it.each([
    'http://127.0.0.1:8080',
    'https://proxy.example.com',
    'http://user:pass@proxy.example.com:3128',
  ])('accepts %s', (url) => {
    expect(isValidProxyUrl(url)).toBe(true);
  });

  it.each([
    'socks://127.0.0.1:1080',
    'socks4://127.0.0.1:1080',
    'socks5://127.0.0.1:1080',
  ])('accepts the supported socks scheme %s', (url) => {
    // The implementation whitelists socks/socks4/socks5 alongside http/https.
    expect(isValidProxyUrl(url)).toBe(true);
  });

  it.each([
    ['', 'empty string'],
    ['file:///etc/config.json', 'file protocol'],
    ['ftp://proxy.example.com', 'ftp protocol'],
    ['javascript:void(0)', 'javascript pseudo-scheme'],
    ['http://', 'scheme without host (URL constructor throws)'],
    ['not a url at all', 'garbage text'],
    ['   ', 'whitespace only'],
  ])('rejects %s (%s)', (url) => {
    expect(isValidProxyUrl(url)).toBe(false);
  });

  it('rejects unknown protocols such as mailto', () => {
    expect(isValidProxyUrl('mailto:user@example.com')).toBe(false);
  });
});

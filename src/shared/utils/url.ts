export function isValidProxyUrl(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    // A scheme alone is not a proxy target: `http://` parses with an empty host.
    if (!parsed.hostname) return false;
    return ['http:', 'https:', 'socks:', 'socks4:', 'socks5:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

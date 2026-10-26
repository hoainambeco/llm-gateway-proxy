import {
  isSensitiveAuditKey,
  sanitizeAuditHeaders,
  sanitizeAuditUrl,
  snapshotAuditPayload,
  sanitizeAuditValue,
  sanitizeAuditString,
  redactUrlCredentials,
} from './audit-sanitizer';

describe('audit-sanitizer', () => {
  describe('isSensitiveAuditKey', () => {
    it('returns true for common sensitive keys and suffixes', () => {
      expect(isSensitiveAuditKey('authorization')).toBe(true);
      expect(isSensitiveAuditKey('Authorization')).toBe(true);
      expect(isSensitiveAuditKey('proxy-authorization')).toBe(true);
      expect(isSensitiveAuditKey('cookie')).toBe(true);
      expect(isSensitiveAuditKey('set-cookie')).toBe(true);
      expect(isSensitiveAuditKey('x-api-key')).toBe(true);
      expect(isSensitiveAuditKey('api_key')).toBe(true);
      expect(isSensitiveAuditKey('apiKey')).toBe(true);
      expect(isSensitiveAuditKey('x-goog-api-key')).toBe(true);
      expect(isSensitiveAuditKey('x-anthropic-api-key')).toBe(true);
      expect(isSensitiveAuditKey('access_token')).toBe(true);
      expect(isSensitiveAuditKey('refreshToken')).toBe(true);
      expect(isSensitiveAuditKey('id_token')).toBe(true);
      expect(isSensitiveAuditKey('client_secret')).toBe(true);
      expect(isSensitiveAuditKey('password')).toBe(true);
      expect(isSensitiveAuditKey('credentials')).toBe(true);
      expect(isSensitiveAuditKey('my-custom-session-token')).toBe(true);
      expect(isSensitiveAuditKey('auth_token')).toBe(true);
    });

    it('returns false for harmless keys', () => {
      expect(isSensitiveAuditKey('content-type')).toBe(false);
      expect(isSensitiveAuditKey('user-agent')).toBe(false);
      expect(isSensitiveAuditKey('model')).toBe(false);
      expect(isSensitiveAuditKey('max_tokens')).toBe(false);
      expect(isSensitiveAuditKey('temperature')).toBe(false);
    });
  });

  describe('sanitizeAuditHeaders', () => {
    it('returns empty object for undefined or empty headers', () => {
      expect(sanitizeAuditHeaders(undefined)).toEqual({});
      expect(sanitizeAuditHeaders({})).toEqual({});
    });

    it('masks sensitive headers and preserves non-sensitive headers', () => {
      const headers = {
        authorization: 'Bearer secret-12345',
        'x-api-key': 'sk-secret-999',
        'content-type': 'application/json',
        accept: '*/*',
      };

      const sanitized = sanitizeAuditHeaders(headers);
      expect(sanitized.authorization).toBe('[REDACTED]');
      expect(sanitized['x-api-key']).toBe('[REDACTED]');
      expect(sanitized['content-type']).toBe('application/json');
      expect(sanitized.accept).toBe('*/*');
    });
  });

  describe('sanitizeAuditUrl', () => {
    it('returns raw URL unchanged if no query string exists', () => {
      expect(sanitizeAuditUrl('/v1/models')).toBe('/v1/models');
    });

    it('redacts sensitive query parameters in URL', () => {
      const url = '/v1/models?api_key=secret-key&other=allowed';
      const sanitized = sanitizeAuditUrl(url);
      expect(sanitized).toContain('api_key=%5BREDACTED%5D');
      expect(sanitized).toContain('other=allowed');
    });

    it('leaves non-sensitive query params untouched', () => {
      const url = '/v1/models?filter=active&limit=10';
      expect(sanitizeAuditUrl(url)).toBe(url);
    });
  });

  describe('redactUrlCredentials', () => {
    it('redacts user/password in http and socks URLs', () => {
      expect(redactUrlCredentials('http://admin:pass123@proxy.internal:8080')).toBe(
        'http://[REDACTED]@proxy.internal:8080',
      );
      expect(redactUrlCredentials('socks5://user:pass@127.0.0.1:1080')).toBe(
        'socks5://[REDACTED]@127.0.0.1:1080',
      );
    });

    it('redacts query credentials in URLs', () => {
      expect(redactUrlCredentials('https://example.com/api?access_token=secret&val=1')).toBe(
        'https://example.com/api?access_token=[REDACTED]&val=1',
      );
    });
  });

  describe('sanitizeAuditString', () => {
    it('summarizes base64 data URLs', () => {
      const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
      const summary = sanitizeAuditString(dataUrl) as Record<string, unknown>;
      expect(summary.redacted).toBe(true);
      expect(summary.mime_type).toBe('image/png');
      expect(summary.sha256).toBeDefined();
    });

    it('summarizes non-base64 data URLs', () => {
      const dataUrl = 'data:text/plain,Hello%20World';
      const summary = sanitizeAuditString(dataUrl) as Record<string, unknown>;
      expect(summary.redacted).toBe(true);
      expect(summary.mime_type).toBe('text/plain');
    });

    it('summarizes inline media with base64 keys', () => {
      const summary = sanitizeAuditString('c29tZS1iaW5hcnktZGF0YQ==', 'b64_json') as Record<string, unknown>;
      expect(summary.redacted).toBe(true);
      expect(summary.source).toBe('b64_json');
    });

    it('falls back to redactUrlCredentials for normal strings', () => {
      const normal = 'Normal message with https://usr:pwd@host.com';
      expect(sanitizeAuditString(normal)).toBe('Normal message with https://[REDACTED]@host.com');
    });
  });

  describe('sanitizeAuditValue', () => {
    it('passes primitives through', () => {
      expect(sanitizeAuditValue(null)).toBeNull();
      expect(sanitizeAuditValue(undefined)).toBeUndefined();
      expect(sanitizeAuditValue(123)).toBe(123);
      expect(sanitizeAuditValue(true)).toBe(true);
    });

    it('recursively redacts sensitive keys in nested objects and arrays', () => {
      const payload = {
        model: 'gemini-pro',
        nested: {
          password: 'secret_password',
          safeKey: 'safeValue',
          tokens: ['item1', { client_secret: 'sec-secret' }],
        },
      };

      const result = sanitizeAuditValue(payload) as any;
      expect(result.model).toBe('gemini-pro');
      expect(result.nested.password).toBe('[REDACTED]');
      expect(result.nested.safeKey).toBe('safeValue');
      expect(result.nested.tokens[0]).toBe('item1');
      expect(result.nested.tokens[1].client_secret).toBe('[REDACTED]');
    });

    it('handles circular references by returning [Circular]', () => {
      const circular: any = { name: 'cycle' };
      circular.self = circular;

      const result = sanitizeAuditValue(circular) as any;
      expect(result.name).toBe('cycle');
      expect(result.self).toBe('[Circular]');
    });

    it('summarizes Buffer and Uint8Array as binary', () => {
      const buf = Buffer.from('binary-data', 'utf-8');
      const result = sanitizeAuditValue(buf) as any;
      expect(result.redacted).toBe(true);
      expect(result.bytes).toBe(buf.byteLength);
    });
  });

  describe('snapshotAuditPayload', () => {
    it('handles null/undefined as empty', () => {
      expect(snapshotAuditPayload(null)).toEqual({
        bytes: 0,
        kind: 'empty',
        oversized: false,
        sha256: null,
        text: null,
      });
      expect(snapshotAuditPayload(undefined)).toEqual({
        bytes: 0,
        kind: 'empty',
        oversized: false,
        sha256: null,
        text: null,
      });
    });

    it('handles Buffer as binary snapshot', () => {
      const buf = Buffer.from('hello buffer');
      const snap = snapshotAuditPayload(buf);
      expect(snap.kind).toBe('binary');
      expect(snap.bytes).toBe(buf.byteLength);
      expect(snap.sha256).toBeDefined();
    });

    it('snapshots valid JSON objects', () => {
      const obj = { prompt: 'What is AI?', apiKey: 'secret-val' };
      const snap = snapshotAuditPayload(obj);
      expect(snap.kind).toBe('json');
      expect(snap.oversized).toBe(false);
      expect(snap.text).toContain('"apiKey":"[REDACTED]"');
    });

    it('snapshots plain string', () => {
      const snap = snapshotAuditPayload('Just a plain string');
      expect(snap.kind).toBe('text');
      expect(snap.text).toBe('Just a plain string');
    });

    it('flags oversized payloads when exceeding maxBytes', () => {
      const largeString = 'x'.repeat(1000);
      const snap = snapshotAuditPayload(largeString, 500);
      expect(snap.kind).toBe('oversized');
      expect(snap.oversized).toBe(true);
      expect(snap.bytes).toBe(1000);
      expect(snap.text).toContain('audit_body_limit');
    });
  });
});

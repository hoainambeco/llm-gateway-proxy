import {
  resolveAuthErrorSurface,
  buildAuthErrorBody,
} from './auth-error-envelope';

describe('auth-error-envelope', () => {
  describe('resolveAuthErrorSurface', () => {
    it('detects Gemini surface from URL path', () => {
      expect(resolveAuthErrorSurface({ headers: {}, url: '/v1beta/models' })).toBe('gemini');
      expect(
        resolveAuthErrorSurface({
          headers: {},
          url: '/upload/v1beta/files?uploadType=resumable',
        }),
      ).toBe('gemini');
    });

    it('detects Anthropic surface from /v1/messages URL path', () => {
      expect(resolveAuthErrorSurface({ headers: {}, url: '/v1/messages' })).toBe('anthropic');
      expect(
        resolveAuthErrorSurface({ headers: {}, url: '/v1/messages/count_tokens' }),
      ).toBe('anthropic');
    });

    it('detects Anthropic surface from headers when URL path is shared', () => {
      expect(
        resolveAuthErrorSurface({
          headers: { 'anthropic-version': '2023-06-01' },
          url: '/v1/models',
        }),
      ).toBe('anthropic');
      expect(
        resolveAuthErrorSurface({
          headers: { 'anthropic-beta': 'tools-2024-04-04' },
          url: '/v1/models',
        }),
      ).toBe('anthropic');
    });

    it('defaults to OpenAI surface for standard routes', () => {
      expect(
        resolveAuthErrorSurface({
          headers: {},
          url: '/v1/chat/completions',
        }),
      ).toBe('openai');
      expect(
        resolveAuthErrorSurface({
          headers: {},
          url: '/v1/models',
        }),
      ).toBe('openai');
    });
  });

  describe('buildAuthErrorBody', () => {
    it('builds Anthropic-compliant error envelope', () => {
      const result = buildAuthErrorBody('anthropic', 'API key is required');
      expect(result).toEqual({
        error: {
          message: 'API key is required',
          type: 'authentication_error',
        },
        type: 'error',
      });
    });

    it('builds Gemini-compliant error envelope', () => {
      const result = buildAuthErrorBody('gemini', 'Invalid API token');
      expect(result).toEqual({
        error: {
          code: 401,
          message: 'Invalid API token',
          status: 'UNAUTHENTICATED',
        },
      });
    });

    it('builds OpenAI-compliant error envelope', () => {
      const result = buildAuthErrorBody('openai', 'Missing Bearer token');
      expect(result).toEqual({
        error: {
          code: 'invalid_api_key',
          message: 'Missing Bearer token',
          param: null,
          type: 'invalid_request_error',
        },
      });
    });
  });
});

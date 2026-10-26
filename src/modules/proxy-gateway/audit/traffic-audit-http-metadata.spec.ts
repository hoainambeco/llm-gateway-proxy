import type { FastifyRequest } from 'fastify';
import {
  resolveThoughtSession,
  createThoughtSessionKey,
  resolveStableSessionId,
  inferProtocol,
  isAuditManagementRoute,
  firstHeader,
  resolveHttpOutcome,
} from './traffic-audit-http-metadata';

describe('traffic-audit-http-metadata', () => {
  const createMockRequest = (overrides?: Partial<FastifyRequest>): FastifyRequest =>
    ({
      headers: {},
      query: {},
      body: {},
      ...overrides,
    } as unknown as FastifyRequest);

  describe('resolveThoughtSession and createThoughtSessionKey', () => {
    it('creates stable key with tenant hash and session id', () => {
      const headers = {
        authorization: 'Bearer secret-token-123',
      };
      const key1 = createThoughtSessionKey(headers, 'sess-abc');
      const key2 = createThoughtSessionKey(headers, 'sess-abc');

      expect(key1).toBe(key2);
      expect(key1).toContain(':sess-abc');

      // Different credential gives different tenant hash
      const keyDiff = createThoughtSessionKey({ 'x-api-key': 'other-key' }, 'sess-abc');
      expect(keyDiff).not.toBe(key1);
    });

    it('falls back to anonymous tenant hash when no credential headers are present', () => {
      const key = createThoughtSessionKey({}, 'sess-1');
      expect(key).toContain(':sess-1');
    });

    it('resolves session with stable true when stable session id is detected', () => {
      const req = createMockRequest({
        headers: { 'x-session-id': 'custom-sess-42', 'x-goog-api-key': 'goog-key' },
      });

      const res = resolveThoughtSession(req);
      expect(res.stable).toBe(true);
      expect(res.clientId).toBe('custom-sess-42');
      expect(res.key).toContain(':custom-sess-42');
    });

    it('falls back to fallbackClientId or random UUID with stable false', () => {
      const req = createMockRequest();
      const res = resolveThoughtSession(req, 'fallback-client');

      expect(res.stable).toBe(false);
      expect(res.clientId).toBe('fallback-client');

      const resNoFallback = resolveThoughtSession(req);
      expect(resNoFallback.stable).toBe(false);
      expect(resNoFallback.clientId).toMatch(/^request-/);
    });
  });

  describe('resolveStableSessionId', () => {
    it('reads from query params', () => {
      const req = createMockRequest({ query: { conversation_id: 'conv-query-1' } });
      expect(resolveStableSessionId(req)).toBe('conv-query-1');
    });

    it('reads from headers', () => {
      const req = createMockRequest({ headers: { 'openai-conversation-id': 'openai-conv-123' } });
      expect(resolveStableSessionId(req)).toBe('openai-conv-123');
    });

    it('reads from body root', () => {
      const req = createMockRequest({ body: { previous_response_id: 'prev-res-999' } });
      expect(resolveStableSessionId(req)).toBe('prev-res-999');
    });

    it('reads from body metadata', () => {
      const req = createMockRequest({
        body: { metadata: { user_id: 'user-vip-1' } },
      });
      expect(resolveStableSessionId(req)).toBe('user-vip-1');
    });

    it('returns null when no session keys exist in query, headers, or body', () => {
      const req = createMockRequest({ body: { other: 'data' } });
      expect(resolveStableSessionId(req)).toBeNull();
    });
  });

  describe('inferProtocol', () => {
    it('infers anthropic protocol for messages and complete routes', () => {
      expect(inferProtocol('/v1/messages')).toBe('anthropic');
      expect(inferProtocol('/v1/complete')).toBe('anthropic');
    });

    it('infers openai-responses and openai protocols', () => {
      expect(inferProtocol('/v1/responses')).toBe('openai-responses');
      expect(inferProtocol('/v1/chat/completions')).toBe('openai');
      expect(inferProtocol('/v1/models')).toBe('openai');
    });

    it('infers gemini protocol', () => {
      expect(inferProtocol('/v1beta/models/gemini-pro:generateContent')).toBe('gemini');
      expect(inferProtocol('/upload/v1beta/files')).toBe('gemini');
    });

    it('infers admin-http protocol', () => {
      expect(inferProtocol('/internal/audit/stats')).toBe('admin-http');
      expect(inferProtocol('/health')).toBe('admin-http');
    });

    it('infers compatible for other routes', () => {
      expect(inferProtocol('/custom/route')).toBe('compatible');
    });
  });

  describe('isAuditManagementRoute', () => {
    it('identifies internal audit, thinking, and v1 thinking routes', () => {
      expect(isAuditManagementRoute('/internal/audit/requests')).toBe(true);
      expect(isAuditManagementRoute('/internal/thinking/stats')).toBe(true);
      expect(isAuditManagementRoute('/v1/thinking/sessions')).toBe(true);
      expect(isAuditManagementRoute('/v1/chat/completions')).toBe(false);
      expect(isAuditManagementRoute('/internal/model-specs')).toBe(false);
    });
  });

  describe('firstHeader', () => {
    it('returns string or first element of string array', () => {
      expect(firstHeader('single-header')).toBe('single-header');
      expect(firstHeader(['first', 'second'])).toBe('first');
      expect(firstHeader(undefined)).toBeNull();
      expect(firstHeader(null)).toBeNull();
      expect(firstHeader(123)).toBeNull();
      expect(firstHeader([])).toBeNull();
    });
  });

  describe('resolveHttpOutcome', () => {
    it('maps 401 and 403 to auth_failed', () => {
      expect(resolveHttpOutcome(401, null)).toBe('auth_failed');
      expect(resolveHttpOutcome(403, null)).toBe('auth_failed');
    });

    it('maps 408 or timeout error to timeout', () => {
      expect(resolveHttpOutcome(408, null)).toBe('timeout');
      expect(resolveHttpOutcome(504, new Error('Gateway timeout occurred'))).toBe('timeout');
    });

    it('maps 499 to client_cancelled', () => {
      expect(resolveHttpOutcome(499, null)).toBe('client_cancelled');
    });

    it('maps >= 500 to internal_error', () => {
      expect(resolveHttpOutcome(500, null)).toBe('internal_error');
      expect(resolveHttpOutcome(502, null)).toBe('internal_error');
      expect(resolveHttpOutcome(504, null)).toBe('internal_error');
    });

    it('maps 200, 201, 400, 404, 429 to completed', () => {
      expect(resolveHttpOutcome(200, null)).toBe('completed');
      expect(resolveHttpOutcome(201, null)).toBe('completed');
      expect(resolveHttpOutcome(400, null)).toBe('completed');
      expect(resolveHttpOutcome(404, null)).toBe('completed');
      expect(resolveHttpOutcome(429, null)).toBe('completed');
    });
  });
});

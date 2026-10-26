import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { of } from 'rxjs';
import {
  isLoopbackIp,
  getCurrentRequestLoopback,
  setCurrentAuditAccountId,
  setCurrentAuditAllowedAccountIds,
  getCurrentAllowedAccountIds,
  captureCurrentAuditUsage,
  getTrafficAuditRequestContext,
  runWithTrafficAuditRequestContext,
  startCurrentUpstreamAttempt,
  completeCurrentUpstreamAttempt,
  getProxyResponseTimingContext,
  captureHijackedHttpResponseChunk,
  completeHijackedHttpResponse,
  TrafficAuditContextInterceptor,
  registerTrafficAuditHttpHooks,
  type TrafficAuditRequestContext,
} from './traffic-audit-context';
import { trafficAuditService } from './traffic-audit.service';

describe('traffic-audit-context', () => {
  describe('isLoopbackIp', () => {
    it('identifies loopback IPv4 and IPv6 addresses', () => {
      expect(isLoopbackIp('127.0.0.1')).toBe(true);
      expect(isLoopbackIp('127.0.1.5')).toBe(true);
      expect(isLoopbackIp('::1')).toBe(true);
      expect(isLoopbackIp('::ffff:127.0.0.1')).toBe(true);
    });

    it('rejects remote IPs or null/undefined', () => {
      expect(isLoopbackIp('192.168.1.1')).toBe(false);
      expect(isLoopbackIp('10.0.0.1')).toBe(false);
      expect(isLoopbackIp('8.8.8.8')).toBe(false);
      expect(isLoopbackIp(undefined)).toBe(false);
      expect(isLoopbackIp(null)).toBe(false);
      expect(isLoopbackIp('')).toBe(false);
    });
  });

  describe('context accessors and mutators in runWithTrafficAuditRequestContext', () => {
    it('manages accountId, allowedAccountIds, and loopback in async storage', () => {
      const mockReq = { ip: '127.0.0.1' } as unknown as FastifyRequest;
      const initialCtx: TrafficAuditRequestContext & { request: FastifyRequest } = {
        attemptSequence: 0,
        parent: null,
        thoughtSessionKey: 'sess-key',
        thoughtSessionStable: true,
        request: mockReq,
      };

      runWithTrafficAuditRequestContext(initialCtx, () => {
        expect(getTrafficAuditRequestContext()).toBe(initialCtx);
        expect(getCurrentRequestLoopback()).toBe(true);

        setCurrentAuditAccountId('acc-123');
        expect(getTrafficAuditRequestContext()?.currentAccountId).toBe('acc-123');

        setCurrentAuditAllowedAccountIds(['acc-1', 'acc-2']);
        expect(getCurrentAllowedAccountIds()).toEqual(['acc-1', 'acc-2']);

        captureCurrentAuditUsage({ usage: { prompt_tokens: 50, completion_tokens: 20 } });
        expect(getTrafficAuditRequestContext()?.upstreamUsage).toEqual({
          inputTokens: 50,
          outputTokens: 20,
        });
      });

      expect(getTrafficAuditRequestContext()).toBeUndefined();
      expect(getCurrentRequestLoopback()).toBe(false);
      expect(getCurrentAllowedAccountIds()).toBeUndefined();
    });

    it('manages upstream attempt tracking via trafficAuditService', () => {
      const startSpy = jest.spyOn(trafficAuditService, 'startAttempt').mockReturnValue({} as any);
      const completeSpy = jest.spyOn(trafficAuditService, 'completeAttempt').mockImplementation();

      const ctx: TrafficAuditRequestContext = {
        attemptSequence: 0,
        parent: { id: 'parent-1' } as any,
        thoughtSessionKey: 'k',
        thoughtSessionStable: true,
        currentAccountId: 'acc-active',
      };

      runWithTrafficAuditRequestContext(ctx, () => {
        const handle = startCurrentUpstreamAttempt({
          endpoint: 'http://upstream.local',
          operation: 'generateContent',
        });
        expect(startSpy).toHaveBeenCalledWith(
          ctx.parent,
          1,
          expect.objectContaining({ accountId: 'acc-active', endpoint: 'http://upstream.local' }),
        );

        completeCurrentUpstreamAttempt(handle, {
          status: 200,
          outcome: 'completed',
        });
        expect(completeSpy).toHaveBeenCalledWith(handle, {
          status: 200,
          outcome: 'completed',
        });
      });

      // Outside context: returns null
      expect(
        startCurrentUpstreamAttempt({ endpoint: 'http://none', operation: 'test' }),
      ).toBeNull();
    });
  });

  describe('TrafficAuditContextInterceptor', () => {
    it('passes through when request has no audit state', (done) => {
      const interceptor = new TrafficAuditContextInterceptor();
      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => ({}),
        }),
      } as any;

      const mockCallHandler = {
        handle: () => of('result-data'),
      };

      interceptor.intercept(mockContext, mockCallHandler).subscribe({
        next: (value) => {
          expect(value).toBe('result-data');
          done();
        },
      });
    });
  });

  describe('Fastify lifecycle hooks and hijacked responses', () => {
    let hooks: Record<string, Function>;
    let mockInstance: FastifyInstance;
    let startParentSpy: jest.SpyInstance;
    let completeParentSpy: jest.SpyInstance;
    let _beginParentSseSpy: jest.SpyInstance;

    beforeEach(() => {
      hooks = {};
      mockInstance = {
        addHook: (name: string, fn: Function) => {
          hooks[name] = fn;
        },
      } as unknown as FastifyInstance;

      startParentSpy = jest.spyOn(trafficAuditService, 'startParent').mockReturnValue({ id: 'p-1' } as any);
      completeParentSpy = jest.spyOn(trafficAuditService, 'completeParent').mockImplementation();
      _beginParentSseSpy = jest.spyOn(trafficAuditService, 'beginParentSse').mockReturnValue({
        write: jest.fn().mockReturnValue(true),
        finish: jest.fn().mockResolvedValue(undefined),
      } as any);

      registerTrafficAuditHttpHooks(mockInstance);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('registers all 5 lifecycle hooks', () => {
      expect(hooks.onRequest).toBeDefined();
      expect(hooks.preHandler).toBeDefined();
      expect(hooks.onSend).toBeDefined();
      expect(hooks.onError).toBeDefined();
      expect(hooks.onResponse).toBeDefined();
    });

    it('executes full request/response lifecycle for JSON payload', async () => {
      const rawEmitter = new EventEmitter();
      const mockReq = {
        url: '/v1/chat/completions',
        method: 'POST',
        headers: { authorization: 'Bearer key-123' },
        raw: rawEmitter,
        ip: '127.0.0.1',
        body: { model: 'gpt-4o' },
      } as unknown as FastifyRequest;

      const mockReply = {
        statusCode: 200,
        getHeaders: () => ({ 'content-type': 'application/json' }),
      } as unknown as FastifyReply;

      // 1. onRequest
      await hooks.onRequest(mockReq, mockReply);
      expect(getProxyResponseTimingContext(mockReq)).toBeDefined();

      // 2. preHandler
      await hooks.preHandler(mockReq);
      expect(startParentSpy).toHaveBeenCalled();

      // 3. onSend with JSON string
      const payload = '{"choices":[{"message":{"content":"Hello back"}}]}';
      const returnedPayload = await hooks.onSend(mockReq, mockReply, payload);
      expect(returnedPayload).toBe(payload);

      // 4. onResponse
      await hooks.onResponse(mockReq, mockReply);
      expect(completeParentSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          status: 200,
          outcome: 'completed',
        }),
      );
    });

    it('ignores internal audit management routes', async () => {
      const mockReq = {
        url: '/internal/audit/stats',
        method: 'GET',
        headers: {},
      } as unknown as FastifyRequest;

      await hooks.onRequest(mockReq, {} as any);
      expect(getProxyResponseTimingContext(mockReq)).toBeUndefined();
    });

    it('handles streaming response with createCapturingTransform', async () => {
      const rawEmitter = new EventEmitter();
      const mockReq = {
        url: '/v1/chat/completions',
        method: 'POST',
        headers: {},
        raw: rawEmitter,
        ip: '127.0.0.1',
      } as unknown as FastifyRequest;

      const replyRawEmitter = new EventEmitter() as any;
      replyRawEmitter.writableFinished = true;
      const mockReply = {
        statusCode: 200,
        raw: replyRawEmitter,
        getHeaders: () => ({ 'content-type': 'text/event-stream' }),
      } as unknown as FastifyReply;

      await hooks.onRequest(mockReq, mockReply);
      await hooks.preHandler(mockReq);

      const stream = Readable.from(['data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n', 'data: [DONE]\n\n']);
      const transformed = await hooks.onSend(mockReq, mockReply, stream);
      expect(transformed).toBeDefined();

      // Consume stream to trigger finish
      for await (const _chunk of transformed as Readable) {
        // read all
      }

      await hooks.onResponse(mockReq, mockReply);
      expect(completeParentSpy).toHaveBeenCalled();
    });

    it('handles hijacked HTTP response chunks and completion', async () => {
      const rawEmitter = new EventEmitter();
      const mockReq = {
        url: '/v1/messages',
        method: 'POST',
        headers: {},
        raw: rawEmitter,
        ip: '127.0.0.1',
      } as unknown as FastifyRequest;

      const mockReply = {
        statusCode: 200,
        getHeaders: () => ({}),
      } as unknown as FastifyReply;

      captureHijackedHttpResponseChunk(mockReq, 'data: {"type":"message_start"}\n\n');
      captureHijackedHttpResponseChunk(mockReq, Buffer.from('data: [DONE]\n\n'));

      completeHijackedHttpResponse(mockReq, mockReply);
      await new Promise((r) => setImmediate(r));

      expect(completeParentSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          responsePayloadHandled: true,
          status: 200,
        }),
      );
    });

    it('records error in onError hook and maps to internal_error when 500', async () => {
      const rawEmitter = new EventEmitter();
      const mockReq = {
        url: '/v1/chat/completions',
        method: 'POST',
        headers: {},
        raw: rawEmitter,
        ip: '127.0.0.1',
      } as unknown as FastifyRequest;

      const mockReply = {
        statusCode: 500,
        getHeaders: () => ({}),
      } as unknown as FastifyReply;

      await hooks.onRequest(mockReq, mockReply);
      const testError = new Error('Database crashed');
      await hooks.onError(mockReq, mockReply, testError);
      await hooks.onResponse(mockReq, mockReply);

      expect(completeParentSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          status: 500,
          error: testError,
          outcome: 'internal_error',
        }),
      );
    });
  });
});

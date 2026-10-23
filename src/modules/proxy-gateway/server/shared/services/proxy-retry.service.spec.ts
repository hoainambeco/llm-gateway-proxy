import { UpstreamRequestError } from '../../common/exceptions/upstream-request.exception';
import {
  ProxyRetryAccountLeaseService,
  ProxyRetryLogger,
  ProxyRetryService,
} from './proxy-retry.service';

describe('ProxyRetryService', () => {
  let logger: ProxyRetryLogger;
  let service: ProxyRetryService;

  function makeService(lease: Partial<ProxyRetryAccountLeaseService> = {}): ProxyRetryService {
    return new ProxyRetryService(
      lease as ProxyRetryAccountLeaseService,
      logger,
      {} as any,
    );
  }

  beforeEach(() => {
    logger = { log: jest.fn(), warn: jest.fn() };
    service = makeService();
  });

  describe('classifyUpstreamFailure', () => {
    it.each([
      ['429 Too Many Requests', true],
      ['500 Internal Server Error', true],
      ['502 Bad Gateway', true],
      ['503 Service Unavailable', true],
      ['504 Gateway Timeout', true],
    ])('marks "%s" as retryable', (message, retryable) => {
      const result = service.classifyUpstreamFailure(message);

      expect(result.retry).toBe(retryable);
    });

    it('marks a 429 as rate limited', () => {
      expect(service.classifyUpstreamFailure('429 Too Many Requests')).toEqual({
        retry: true,
        markAsForbidden: false,
        markAsRateLimited: true,
      });
    });

    it('retries a 500 without marking the account rate limited', () => {
      expect(service.classifyUpstreamFailure('500 Internal Server Error')).toEqual({
        retry: true,
        markAsForbidden: false,
        markAsRateLimited: false,
      });
    });

    it('does not retry a 400', () => {
      expect(service.classifyUpstreamFailure('400 Bad Request')).toEqual({
        retry: false,
        markAsForbidden: false,
        markAsRateLimited: false,
      });
    });

    it('retries a 401 as a forbidden account failover', () => {
      expect(service.classifyUpstreamFailure('401 Unauthorized')).toEqual({
        retry: true,
        markAsForbidden: true,
        markAsRateLimited: false,
      });
    });

    it('treats an invalid_grant message as a forbidden account failover', () => {
      expect(service.classifyUpstreamFailure('invalid_grant: token revoked')).toEqual({
        retry: true,
        markAsForbidden: true,
        markAsRateLimited: false,
      });
    });
  });

  describe('token retry state', () => {
    it('starts with no attempts, no failures, and all failures rate limited', () => {
      const state = service.createTokenRetryState();

      expect(state.attemptedAccountIds.size).toBe(0);
      expect(state.graceRetryToken).toBeNull();
      expect(state.graceRetriedAccountIds.size).toBe(0);
      expect(state.lastNonRateLimitError).toBeNull();
      expect(state.failureCount).toBe(0);
      expect(state.allFailuresRateLimited).toBe(true);
      expect(state.allowedAccountIds).toBeNull();
    });

    it('excludes attempted accounts and returns null when the lease is exhausted', async () => {
      const getNextToken = jest
        .fn()
        .mockResolvedValueOnce({ id: 'account-1' })
        .mockResolvedValueOnce(null);
      service = makeService({ getNextToken });
      const state = service.createTokenRetryState();

      const first = await service.selectRetryToken(state, 'gemini-3-flash');
      expect(first?.id).toBe('account-1');
      expect(state.attemptedAccountIds).toEqual(new Set(['account-1']));

      const second = await service.selectRetryToken(state, 'gemini-3-flash');
      expect(second).toBeNull();

      expect(getNextToken).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ excludeAccountIds: [] }),
      );
      expect(getNextToken).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ excludeAccountIds: ['account-1'] }),
      );
    });

    it('counts failures and records the retry-after hint from a 429', () => {
      const state = service.createTokenRetryState();
      const rateLimited = new UpstreamRequestError({
        message: '429 Too Many Requests',
        status: 429,
        body: 'retry after 12s',
      });

      service.recordFailure(state, rateLimited);

      expect(state.failureCount).toBe(1);
      expect(state.allFailuresRateLimited).toBe(true);
      expect(state.retryAfterSeconds).toBe(12);
    });

    it('keeps counting failures and remembers the first non-rate-limit error', () => {
      const state = service.createTokenRetryState();
      const rateLimited = new UpstreamRequestError({
        message: '429 Too Many Requests',
        status: 429,
        body: 'retry after 12s',
      });
      const serverError = new UpstreamRequestError({
        message: '500 Internal Server Error',
        status: 500,
      });

      service.recordFailure(state, rateLimited);
      service.recordFailure(state, serverError);

      expect(state.failureCount).toBe(2);
      expect(state.allFailuresRateLimited).toBe(false);
      expect(state.lastNonRateLimitError).toBe(serverError);
    });
  });
});

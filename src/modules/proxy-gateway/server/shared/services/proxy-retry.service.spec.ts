import { calculateRetryDelay, sleep } from '../../../antigravity/retry-utils';
import { UpstreamRequestError } from '../../common/exceptions/upstream-request.exception';
import { ProxyAccountUnavailableError } from '../../common/exceptions/proxy-account-unavailable.exception';
import {
  ProxyRetryAccountLeaseService,
  ProxyRetryLogger,
  ProxyRetryService,
  ImageSchedulerPermit,
} from './proxy-retry.service';
import { ModelAvailabilityService } from './model-availability.service';
import { CloudAccount } from '@/modules/cloud-account/types';

jest.mock('../../../antigravity/retry-utils', () => ({
  calculateRetryDelay: jest.fn(),
  sleep: jest.fn(),
}));

describe('ProxyRetryService', () => {
  const mockedCalculateRetryDelay = calculateRetryDelay as jest.MockedFunction<
    typeof calculateRetryDelay
  >;
  const mockedSleep = sleep as jest.MockedFunction<typeof sleep>;

  let logger: ProxyRetryLogger;
  let logMock: jest.Mock;
  let warnMock: jest.Mock;
  let modelAvailabilityMock: jest.Mocked<ModelAvailabilityService>;
  let leaseMock: jest.Mocked<ProxyRetryAccountLeaseService>;
  let service: ProxyRetryService;

  function makeService(
    overrides: Partial<ProxyRetryAccountLeaseService> = {},
  ): ProxyRetryService {
    leaseMock = {
      getNextToken: jest.fn(),
      getNextImageToken: jest.fn(),
      recordParityError: jest.fn(),
      markAsForbidden: jest.fn(),
      markAsRateLimited: jest.fn(),
      markFromUpstreamError: jest.fn().mockResolvedValue(undefined),
      getRemainingRateLimitWait: jest.fn().mockReturnValue(60),
      getMinimumRateLimitWaitForPool: jest.fn().mockReturnValue(15),
      markModelSuccess: jest.fn(),
      markImageRateLimitFast: jest.fn().mockReturnValue(false),
      reconcileImageRateLimit: jest.fn().mockResolvedValue(undefined),
      markValidationRequired: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    } as unknown as jest.Mocked<ProxyRetryAccountLeaseService>;

    return new ProxyRetryService(
      leaseMock,
      logger,
      modelAvailabilityMock,
    );
  }

  beforeEach(() => {
    mockedCalculateRetryDelay.mockReturnValue(2500);
    mockedSleep.mockResolvedValue(undefined);
    logMock = jest.fn();
    warnMock = jest.fn();
    logger = { log: logMock, warn: warnMock };
    modelAvailabilityMock = {
      mark: jest.fn(),
      clearAccount: jest.fn(),
      clearModel: jest.fn(),
      clearModelFamily: jest.fn(),
      clearCapabilityFailures: jest.fn(),
      getSnapshot: jest.fn(),
      getActiveSnapshot: jest.fn(),
    } as unknown as jest.Mocked<ModelAvailabilityService>;

    service = makeService();
  });

  describe('classifyUpstreamFailure', () => {
    it.each([
      ['429 Too Many Requests', true],
      ['500 Internal Server Error', true],
      ['502 Bad Gateway', true],
      ['503 Service Unavailable', true],
      ['504 Gateway Timeout', true],
      ['408 Request Timeout', true],
      ['socket hang up', true],
      ['empty response stream', true],
      ['connection reset', true],
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

    it('does not retry an unclassified 400', () => {
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

    it('treats 403 and permission_denied as forbidden failovers', () => {
      expect(service.classifyUpstreamFailure('403 Forbidden')).toEqual({
        retry: true,
        markAsForbidden: true,
        markAsRateLimited: false,
      });
      expect(service.classifyUpstreamFailure('PERMISSION_DENIED for caller')).toEqual({
        retry: true,
        markAsForbidden: true,
        markAsRateLimited: false,
      });
    });
  });

  describe('waitBeforeRetry', () => {
    it('returns immediately on the first attempt without sleeping or logging', async () => {
      await service.waitBeforeRetry(0, 3, 'Gemini', false);

      expect(mockedCalculateRetryDelay).not.toHaveBeenCalled();
      expect(mockedSleep).not.toHaveBeenCalled();
      expect(logger.log).not.toHaveBeenCalled();
    });

    it('returns immediately when backoff should be skipped', async () => {
      await service.waitBeforeRetry(2, 3, 'Gemini', true);

      expect(mockedCalculateRetryDelay).not.toHaveBeenCalled();
      expect(mockedSleep).not.toHaveBeenCalled();
      expect(logger.log).not.toHaveBeenCalled();
    });

    it('logs the attempt and sleeps for the jittered backoff delay', async () => {
      await service.waitBeforeRetry(2, 3, 'Gemini', false);

      expect(mockedCalculateRetryDelay).toHaveBeenCalledWith(1);
      expect(mockedSleep).toHaveBeenCalledWith(2500);
      expect(logger.log).toHaveBeenCalledTimes(1);
      expect(logMock.mock.calls[0][0]).toContain('retry 3/3');
      expect(logMock.mock.calls[0][0]).toContain('Gemini');
    });
  });

  describe('token retry state & permits', () => {
    it('starts with clean initial state', () => {
      const state = service.createTokenRetryState();

      expect(state.attemptedAccountIds.size).toBe(0);
      expect(state.graceRetryToken).toBeNull();
      expect(state.graceRetriedAccountIds.size).toBe(0);
      expect(state.lastNonRateLimitError).toBeNull();
      expect(state.failureCount).toBe(0);
      expect(state.allFailuresRateLimited).toBe(true);
      expect(state.allowedAccountIds).toBeNull();
      expect(state.imagePermit).toBeNull();
    });

    it('selectRetryToken returns graceRetryToken when present without leasing a new token', async () => {
      const state = service.createTokenRetryState();
      const graceToken = { id: 'grace-acc' } as CloudAccount;
      state.graceRetryToken = graceToken;

      const selected = await service.selectRetryToken(state, 'gemini-3-flash');
      expect(selected).toBe(graceToken);
      expect(state.graceRetryToken).toBeNull();
      expect(leaseMock.getNextToken).not.toHaveBeenCalled();
    });

    it('selectRetryToken leases image token with permit for image models when getNextImageToken exists', async () => {
      const mockPermit: ImageSchedulerPermit = { release: jest.fn() };
      const imageToken = { id: 'img-acc' } as CloudAccount;
      const getNextImageToken = jest.fn().mockResolvedValue({
        token: imageToken,
        permit: mockPermit,
      });

      service = makeService({ getNextImageToken });
      const state = service.createTokenRetryState();

      const token = await service.selectRetryToken(
        state,
        'gemini-3-pro-image',
        undefined,
        true, // imageRequest = true
      );
      expect(token).toBe(imageToken);
      expect(state.imagePermit).toBe(mockPermit);

      // Taking permit clears it from state
      const taken = service.takeImagePermit(state);
      expect(taken).toBe(mockPermit);
      expect(state.imagePermit).toBeNull();
    });

    it('releaseImagePermit releases permit and clears it', () => {
      const state = service.createTokenRetryState();
      const mockPermit: ImageSchedulerPermit = { release: jest.fn() };
      state.imagePermit = mockPermit;

      service.releaseImagePermit(state);
      expect(mockPermit.release).toHaveBeenCalled();
      expect(state.imagePermit).toBeNull();
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

  describe('resolveTerminalError', () => {
    it('returns ProxyAccountUnavailableError when all failures were rate limited', () => {
      const state = service.createTokenRetryState();
      service.recordFailure(
        state,
        new UpstreamRequestError({ status: 429, message: 'Too many requests', body: 'retry after 20s' }),
      );

      const terminal = service.resolveTerminalError(state, new Error('last error'));
      expect(terminal).toBeInstanceOf(ProxyAccountUnavailableError);
      const unavailable = terminal as ProxyAccountUnavailableError;
      expect(unavailable.getStatus()).toBe(429);
      // Min between 20s (from error) and 15s (from mock getMinimumRateLimitWaitForPool)
      expect(unavailable.retryAfterSeconds).toBe(15);
    });

    it('returns lastNonRateLimitError when some failures were not rate limits', () => {
      const state = service.createTokenRetryState();
      const serverError = new UpstreamRequestError({ status: 500, message: 'Internal error' });
      service.recordFailure(state, serverError);

      const terminal = service.resolveTerminalError(state, new Error('fallback'));
      expect(terminal).toBe(serverError);
    });
  });

  describe('prepareGraceRetry', () => {
    it('returns false if account already underwent grace retry', async () => {
      const state = service.createTokenRetryState();
      const token = { id: 'acc-1' } as CloudAccount;
      state.graceRetriedAccountIds.add('acc-1');

      const res = await service.prepareGraceRetry(state, token, new Error('fail'), 'test');
      expect(res).toBe(false);
    });

    it('returns false when error is not an eligible 429 grace retry delay', async () => {
      const state = service.createTokenRetryState();
      const token = { id: 'acc-1' } as CloudAccount;
      const error = new UpstreamRequestError({
        status: 429,
        message: 'quota_exhausted strict', // strict marker disables grace retry
        body: 'Resource exhausted: quota_exhausted',
      });

      const res = await service.prepareGraceRetry(state, token, error, 'test');
      expect(res).toBe(false);
    });

    it('waits for grace delay with buffer and sets graceRetryToken', async () => {
      const state = service.createTokenRetryState();
      const token = { id: 'acc-1' } as CloudAccount;
      const error = new UpstreamRequestError({
        status: 429,
        message: 'Rate limit exceeded',
        body: 'Please retry after 2s', // 2000ms + 1000ms text buffer = 3000ms
      });

      const res = await service.prepareGraceRetry(state, token, error, 'test');
      expect(res).toBe(true);
      expect(mockedSleep).toHaveBeenCalledWith(3000);
      expect(state.graceRetriedAccountIds.has('acc-1')).toBe(true);
      expect(state.graceRetryToken).toBe(token);
    });

    it('handles baseline mode grace retry', async () => {
      const state = service.createTokenRetryState();
      const token = { id: 'acc-1' } as CloudAccount;
      const error = new UpstreamRequestError({
        status: 429,
        message: 'rate limit',
        body: 'retry after 1s', // 1000ms + 1500ms baseline buffer = 2500ms
      });

      const res = await service.prepareGraceRetry(state, token, error, 'test', 'baseline');
      expect(res).toBe(true);
      expect(mockedSleep).toHaveBeenCalledWith(2500);
    });
  });

  describe('applyUpstreamPenalty and markUpstreamSuccess', () => {
    it('marks image model as model_not_supported on 404', async () => {
      const error = new UpstreamRequestError({ status: 404, message: 'Not found' });
      await service.applyUpstreamPenalty('acc-1', 'gemini-3-pro-image', error);

      expect(leaseMock.recordParityError).toHaveBeenCalled();
      expect(modelAvailabilityMock.mark).toHaveBeenCalledWith(
        'acc-1',
        'gemini-3-pro-image',
        'model_not_supported',
        undefined,
        expect.objectContaining({ status: 404 }),
      );
    });

    it('marks image model as model_forbidden on 403', async () => {
      const error = new UpstreamRequestError({ status: 403, message: 'Forbidden' });
      await service.applyUpstreamPenalty('acc-1', 'gemini-3-pro-image', error);

      expect(modelAvailabilityMock.mark).toHaveBeenCalledWith(
        'acc-1',
        'gemini-3-pro-image',
        'model_forbidden',
        undefined,
        expect.objectContaining({ status: 403 }),
      );
    });

    it('handles 403 recoverable validation_required error', async () => {
      const error = new UpstreamRequestError({
        status: 403,
        message: 'Verification required',
        body: JSON.stringify({
          error: {
            details: [
              {
                '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
                reason: 'VALIDATION_REQUIRED',
                domain: 'cloudcode-pa.googleapis.com',
                metadata: {
                  validation_link: 'https://verify.google.com/auth',
                },
              },
              {
                '@type': 'type.googleapis.com/google.rpc.Help',
                links: [{ url: 'https://verify.google.com/auth', description: 'Verify account' }],
              },
            ],
          },
        }),
      });

      await service.applyUpstreamPenalty('acc-1', 'gemini-1.5-pro', error);
      expect(leaseMock.markValidationRequired).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: 'acc-1',
          verificationUrl: 'https://verify.google.com/auth',
        }),
      );
    });

    it('marks account as forbidden on plain 401 or 403', async () => {
      const error401 = new UpstreamRequestError({ status: 401, message: 'Unauthorized' });
      await service.applyUpstreamPenalty('acc-1', 'gemini-1.5-pro', error401);
      expect(leaseMock.markAsForbidden).toHaveBeenCalledWith('acc-1');

      const error403 = new UpstreamRequestError({ status: 403, message: 'Forbidden' });
      await service.applyUpstreamPenalty('acc-2', 'gemini-1.5-pro', error403);
      expect(leaseMock.markAsForbidden).toHaveBeenCalledWith('acc-2');
    });

    it('handles plain Error instances for penalties', async () => {
      await service.applyUpstreamPenalty('acc-1', 'gemini-1.5-pro', new Error('401 Unauthorized'));
      expect(leaseMock.markAsForbidden).toHaveBeenCalledWith('acc-1');

      await service.applyUpstreamPenalty('acc-2', 'gemini-1.5-pro', new Error('429 Too many requests'));
      expect(leaseMock.markFromUpstreamError).toHaveBeenCalledWith(
        expect.objectContaining({ accountIdOrEmail: 'acc-2', status: 429 }),
      );
    });

    it('markUpstreamSuccess clears availability and marks model success', () => {
      service.markUpstreamSuccess('acc-1', 'gemini-3-pro-image');
      expect(leaseMock.markModelSuccess).toHaveBeenCalledWith('acc-1', 'gemini-3-pro-image');
      expect(modelAvailabilityMock.clearModelFamily).toHaveBeenCalledWith('acc-1', 'gemini-3-pro-image');

      service.markUpstreamSuccess('acc-2', 'gemini-2.0-flash');
      expect(leaseMock.markModelSuccess).toHaveBeenCalledWith('acc-2', 'gemini-2.0-flash');
      expect(modelAvailabilityMock.clearModel).toHaveBeenCalledWith('acc-2', 'gemini-2.0-flash');
    });
  });

  describe('prepareScheduledImageRetry', () => {
    it('returns false and releases permit for non-UpstreamRequestError', async () => {
      const state = service.createTokenRetryState();
      const mockPermit: ImageSchedulerPermit = { release: jest.fn() };
      state.imagePermit = mockPermit;

      const token = { id: 'img-acc' } as CloudAccount;
      const res = await service.prepareScheduledImageRetry(
        state,
        token,
        'gemini-3-pro-image',
        new Error('Network error'),
        'test',
      );

      expect(res).toBe(false);
      expect(mockPermit.release).toHaveBeenCalled();
    });

    it('schedules fast mark and grace retry for 429 image error', async () => {
      const state = service.createTokenRetryState();
      const mockPermit: ImageSchedulerPermit = { release: jest.fn() };
      state.imagePermit = mockPermit;

      const token = { id: 'img-acc' } as CloudAccount;
      const error = new UpstreamRequestError({
        status: 429,
        message: 'Rate limit',
        body: 'Please retry after 1s',
      });

      const res = await service.prepareScheduledImageRetry(
        state,
        token,
        'gemini-3-pro-image',
        error,
        'test',
      );

      expect(res).toBe(true);
      expect(state.graceRetryToken).toBe(token);
    });
  });
});

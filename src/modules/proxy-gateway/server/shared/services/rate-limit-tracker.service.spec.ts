import {
  RateLimitReason,
  RateLimitTrackerService,
  hasGenericResourceExhaustedSignal,
  hasExplicitQuotaExhaustedSignal,
  hasStrictQuotaExhaustedMarker,
  isGeminiImageModel,
  isRecognizedGeminiImageModel,
  parseRetryDelay,
  parseRetryDelayMilliseconds,
  parseBaselineRetryDelayMilliseconds,
  shouldGraceRetry,
  PersistedModelRateLimit,
} from './rate-limit-tracker.service';
import type { CooldownBus } from './cooldown-bus';

describe('RateLimitTrackerService', () => {
  const FIXED_NOW = new Date('2026-01-15T12:00:00.000Z');

  let service: RateLimitTrackerService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(FIXED_NOW);
    service = new RateLimitTrackerService();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('pure helpers', () => {
    it('hasGenericResourceExhaustedSignal identifies generic resource exhaustion', () => {
      expect(hasGenericResourceExhaustedSignal('RESOURCE_EXHAUSTED: quota')).toBe(true);
      expect(hasGenericResourceExhaustedSignal('The resource has been exhausted')).toBe(true);
      expect(hasGenericResourceExhaustedSignal('Internal server error')).toBe(false);
      expect(hasGenericResourceExhaustedSignal(undefined)).toBe(false);
    });

    it('hasExplicitQuotaExhaustedSignal identifies explicit quota signals', () => {
      expect(hasExplicitQuotaExhaustedSignal('quota_exhausted')).toBe(true);
      expect(hasExplicitQuotaExhaustedSignal('Quota exceeded for project')).toBe(true);
      expect(hasExplicitQuotaExhaustedSignal('quotaresetdelay in 30s')).toBe(true);
      expect(hasExplicitQuotaExhaustedSignal('daily quota reached')).toBe(true);
      expect(hasExplicitQuotaExhaustedSignal('limit per day exceeded')).toBe(true);
      expect(hasExplicitQuotaExhaustedSignal('too many requests')).toBe(false);
      expect(hasExplicitQuotaExhaustedSignal(undefined)).toBe(false);
    });

    it('hasStrictQuotaExhaustedMarker strictly checks for quota_exhausted', () => {
      expect(hasStrictQuotaExhaustedMarker('error: QUOTA_EXHAUSTED')).toBe(true);
      expect(hasStrictQuotaExhaustedMarker('quota exceeded')).toBe(false);
      expect(hasStrictQuotaExhaustedMarker(undefined)).toBe(false);
    });

    it('isGeminiImageModel identifies image models', () => {
      expect(isGeminiImageModel('gemini-3-pro-image')).toBe(true);
      expect(isGeminiImageModel('gemini-3.1-flash-image')).toBe(true);
      expect(isGeminiImageModel('gemini-2.0-flash')).toBe(false);
      expect(isGeminiImageModel(undefined)).toBe(false);
    });

    it('isRecognizedGeminiImageModel identifies recognized long-image quota models', () => {
      expect(isRecognizedGeminiImageModel('gemini-3-pro-image')).toBe(true);
      expect(isRecognizedGeminiImageModel('models/gemini-3.1-flash-image')).toBe(true);
      expect(isRecognizedGeminiImageModel('gemini-3.1-pro-image')).toBe(true);
      expect(isRecognizedGeminiImageModel('gemini-1.5-pro')).toBe(false);
      expect(isRecognizedGeminiImageModel(undefined)).toBe(false);
    });

    it('shouldGraceRetry checks retry window (<= 5000ms)', () => {
      expect(shouldGraceRetry(0)).toBe(false);
      expect(shouldGraceRetry(-100)).toBe(false);
      expect(shouldGraceRetry(200)).toBe(true);
      expect(shouldGraceRetry(5000)).toBe(true);
      expect(shouldGraceRetry(5001)).toBe(false);
    });

    describe('parseRetryDelay and variants', () => {
      it('parses retry-after header as seconds or HTTP date', () => {
        expect(parseRetryDelay(undefined, '15')).toEqual({
          delayMs: 15000,
          source: 'retry-after',
        });

        const futureDate = new Date(FIXED_NOW.getTime() + 25000).toUTCString();
        expect(parseRetryDelay(undefined, futureDate)).toEqual({
          delayMs: 25000,
          source: 'retry-after',
        });

        expect(parseRetryDelay(undefined, 'invalid-date')).toBeNull();
      });

      it('parses structured JSON error bodies', () => {
        const jsonBody = JSON.stringify({
          error: {
            details: [
              {
                '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
                metadata: {
                  quotaResetDelay: '45s',
                },
              },
            ],
          },
        });

        expect(parseRetryDelay(jsonBody)).toEqual({
          delayMs: 45000,
          source: 'structured',
        });
        expect(parseRetryDelayMilliseconds(jsonBody)).toBe(45000);
      });

      it('parses structured duration object with seconds and nanos', () => {
        const jsonBody = JSON.stringify({
          error: {
            details: [
              {
                retryDelay: {
                  seconds: 10,
                  nanos: 500000000, // 500ms
                },
              },
            ],
          },
        });

        expect(parseRetryDelay(jsonBody)).toEqual({
          delayMs: 10500,
          source: 'structured',
        });
      });

      it('parses text regex patterns when structured parsing does not match', () => {
        expect(parseRetryDelay('Your quota will reset after 2m30s.')).toEqual({
          delayMs: 150000,
          source: 'text',
        });
        expect(parseRetryDelay('Please retry after 10s.')).toEqual({
          delayMs: 10000,
          source: 'text',
        });
        expect(parseRetryDelay('Error: quotaResetDelay: 500ms')).toEqual({
          delayMs: 500,
          source: 'text',
        });
        expect(parseRetryDelay('Unrelated error without retry delay')).toBeNull();
      });

      it('parseBaselineRetryDelayMilliseconds falls back across patterns and structured body', () => {
        expect(parseBaselineRetryDelayMilliseconds('quota will reset after 12s')).toBe(12000);
        const structured = JSON.stringify({
          error: {
            details: [
              {
                retryDelay: '8s',
              },
            ],
          },
        });
        expect(parseBaselineRetryDelayMilliseconds(structured)).toBe(8000);
        expect(parseBaselineRetryDelayMilliseconds(undefined)).toBeNull();
      });
    });
  });

  describe('lockout tracking and query', () => {
    it('is rate limited before the lockout expires and releases it afterwards', () => {
      const resetAt = new Date(FIXED_NOW.getTime() + 60_000).toISOString();

      expect(
        service.setLockoutUntilIso('account-1', resetAt, RateLimitReason.RateLimitExceeded),
      ).toBe(true);

      expect(service.isRateLimited('account-1')).toBe(true);
      expect(service.getRemainingWaitSec('account-1')).toBe(60);

      jest.advanceTimersByTime(30_000);

      expect(service.isRateLimited('account-1')).toBe(true);
      expect(service.getRemainingWaitSec('account-1')).toBe(30);

      jest.advanceTimersByTime(30_001);

      expect(service.isRateLimited('account-1')).toBe(false);
      expect(service.getRemainingWaitSec('account-1')).toBe(0);
    });

    it('scopes a model lockout to that model', () => {
      const resetAt = new Date(FIXED_NOW.getTime() + 45_000).toISOString();

      expect(
        service.setLockoutUntilIso(
          'account-1',
          resetAt,
          RateLimitReason.QuotaExhausted,
          'gemini-3-flash',
        ),
      ).toBe(true);

      expect(service.isRateLimited('account-1', 'gemini-3-flash')).toBe(true);
      expect(service.isRateLimited('account-1')).toBe(false);

      jest.advanceTimersByTime(45_001);

      expect(service.isRateLimited('account-1', 'gemini-3-flash')).toBe(false);
    });

    it('rejects an invalid ISO timestamp without creating a lockout', () => {
      expect(
        service.setLockoutUntilIso('account-1', 'not-a-date', RateLimitReason.RateLimitExceeded),
      ).toBe(false);
      expect(service.isRateLimited('account-1')).toBe(false);
    });

    it('clears specific account or model lockout', () => {
      service.setLockoutUntilIso(
        'account-1',
        new Date(FIXED_NOW.getTime() + 60000).toISOString(),
        RateLimitReason.RateLimitExceeded,
      );
      service.setLockoutUntilIso(
        'account-1',
        new Date(FIXED_NOW.getTime() + 60000).toISOString(),
        RateLimitReason.RateLimitExceeded,
        'gemini-pro',
      );

      expect(service.isRateLimited('account-1')).toBe(true);
      expect(service.isRateLimited('account-1', 'gemini-pro')).toBe(true);

      expect(service.clear('account-1')).toBe(true);
      expect(service.isRateLimited('account-1')).toBe(false);
      expect(service.isRateLimited('account-1', 'gemini-pro')).toBe(true);

      expect(service.clearModel('account-1', 'gemini-pro')).toBe(true);
      expect(service.isRateLimited('account-1', 'gemini-pro')).toBe(false);
    });

    it('clearAll removes all tracked lockouts', () => {
      service.setLockoutUntilIso(
        'account-1',
        new Date(FIXED_NOW.getTime() + 60000).toISOString(),
        RateLimitReason.RateLimitExceeded,
      );
      service.setLockoutUntilIso(
        'account-2',
        new Date(FIXED_NOW.getTime() + 60000).toISOString(),
        RateLimitReason.RateLimitExceeded,
      );

      expect(service.clearAll()).toBe(2);
      expect(service.isRateLimited('account-1')).toBe(false);
      expect(service.isRateLimited('account-2')).toBe(false);
    });

    it('cleanupExpired removes only expired lockouts', () => {
      service.setLockoutUntilIso(
        'account-exp',
        new Date(FIXED_NOW.getTime() + 10000).toISOString(),
        RateLimitReason.RateLimitExceeded,
      );
      service.setLockoutUntilIso(
        'account-alive',
        new Date(FIXED_NOW.getTime() + 60000).toISOString(),
        RateLimitReason.RateLimitExceeded,
      );

      jest.advanceTimersByTime(20000);

      const cleaned = service.cleanupExpired();
      expect(cleaned).toBe(1);
      expect(service.isRateLimited('account-exp')).toBe(false);
      expect(service.isRateLimited('account-alive')).toBe(true);
    });

    it('clearModelFamilies releases matching model families unless long-image quota is preserved', () => {
      service.setLockoutUntilIso(
        'account-1',
        new Date(FIXED_NOW.getTime() + 60000).toISOString(),
        RateLimitReason.QuotaExhausted,
        'gemini-3.1-pro',
      );
      service.setLockoutUntilIso(
        'account-1',
        new Date(FIXED_NOW.getTime() + 60000).toISOString(),
        RateLimitReason.QuotaExhausted,
        'gemini-2.0-flash',
      );

      // Recover 'gemini-3.1-pro-preview' which shares the family 'gemini-3.1-pro'
      const cleared = service.clearModelFamilies('account-1', ['gemini-3.1-pro-preview']);
      expect(cleared).toBe(1);
      expect(service.isRateLimited('account-1', 'gemini-3.1-pro')).toBe(false);
      expect(service.isRateLimited('account-1', 'gemini-2.0-flash')).toBe(true);

      // Empty iterable returns 0
      expect(service.clearModelFamilies('account-1', [])).toBe(0);
    });

    it('markSuccess and markModelSuccess clear lockouts and failure counts', () => {
      service.setLockoutUntilIso(
        'account-1',
        new Date(FIXED_NOW.getTime() + 60000).toISOString(),
        RateLimitReason.RateLimitExceeded,
      );
      service.setLockoutUntilIso(
        'account-1',
        new Date(FIXED_NOW.getTime() + 60000).toISOString(),
        RateLimitReason.RateLimitExceeded,
        'gemini-1.5-pro',
      );

      service.markSuccess('account-1');
      expect(service.isRateLimited('account-1')).toBe(false);

      service.markModelSuccess('account-1', 'gemini-1.5-pro');
      expect(service.isRateLimited('account-1', 'gemini-1.5-pro')).toBe(false);
    });
  });

  describe('restorePersistedLongImageLimit', () => {
    it('restores valid long image limit exceeding MAX_LOCKOUT_SECONDS', () => {
      const now = FIXED_NOW.getTime();
      const validEntry: PersistedModelRateLimit = {
        accountId: 'acc-1',
        modelId: 'gemini-3-pro-image',
        reason: 'quota_exhausted',
        status: 429,
        message: 'Resource exhausted: quota_exhausted. Please retry after 10m.',
        detectedAt: now,
        unavailableUntil: now + 600 * 1000, // 10 min (> 300s)
      };

      expect(service.restorePersistedLongImageLimit(validEntry)).toBe(true);
      expect(service.isRateLimited('acc-1', 'gemini-3-pro-image')).toBe(true);
      expect(service.getRemainingWaitSec('acc-1', 'gemini-3-pro-image')).toBe(600);
    });

    it('rejects entries not qualifying for long image limit restoration', () => {
      const now = FIXED_NOW.getTime();
      const base: PersistedModelRateLimit = {
        accountId: 'acc-1',
        modelId: 'gemini-3-pro-image',
        reason: 'quota_exhausted',
        status: 429,
        message: 'Resource exhausted: quota_exhausted. retry after 10m',
        detectedAt: now,
        unavailableUntil: now + 600 * 1000,
      };

      // Non-429 status
      expect(service.restorePersistedLongImageLimit({ ...base, status: 500 })).toBe(false);
      // Non-quota_exhausted reason
      expect(service.restorePersistedLongImageLimit({ ...base, reason: 'rate_limited' })).toBe(false);
      // Non-image model
      expect(service.restorePersistedLongImageLimit({ ...base, modelId: 'gemini-1.5-pro' })).toBe(false);
      // Missing strict marker
      expect(service.restorePersistedLongImageLimit({ ...base, message: 'daily limit reached' })).toBe(false);
      // Already expired
      expect(service.restorePersistedLongImageLimit({ ...base, unavailableUntil: now - 1000 })).toBe(false);
      // Short lockout <= 300s
      expect(
        service.restorePersistedLongImageLimit({
          ...base,
          unavailableUntil: now + 120 * 1000,
          message: 'quota_exhausted retry after 120s',
        }),
      ).toBe(false);
    });
  });

  describe('trackFromUpstreamError', () => {
    it('returns null for non-rate-limit HTTP status codes', () => {
      const info = service.trackFromUpstreamError({
        accountId: 'acc-1',
        status: 200,
        backoffSteps: [],
      });
      expect(info).toBeNull();
    });

    it('tracks 404 and 500/503 server errors', () => {
      const info404 = service.trackFromUpstreamError({
        accountId: 'acc-1',
        status: 404,
        backoffSteps: [],
      });
      expect(info404?.reason).toBe(RateLimitReason.ServerError);
      expect(info404?.retryAfterSec).toBe(5);

      const info500 = service.trackFromUpstreamError({
        accountId: 'acc-1',
        status: 500,
        backoffSteps: [],
      });
      expect(info500?.reason).toBe(RateLimitReason.ServerError);
      expect(info500?.retryAfterSec).toBe(8);
    });

    it('tracks ModelCapacityExhausted and increments backoff steps', () => {
      const body = JSON.stringify({
        error: {
          status: 'UNAVAILABLE',
          message: 'No capacity available for model currently',
        },
      });

      const first = service.trackFromUpstreamError({
        accountId: 'acc-1',
        status: 503,
        body,
        model: 'gemini-3.1-pro',
        backoffSteps: [],
      });
      expect(first?.reason).toBe(RateLimitReason.ModelCapacityExhausted);
      expect(first?.retryAfterSec).toBe(5);

      const second = service.trackFromUpstreamError({
        accountId: 'acc-1',
        status: 503,
        body,
        model: 'gemini-3.1-pro',
        backoffSteps: [],
      });
      expect(second?.retryAfterSec).toBe(10);

      const third = service.trackFromUpstreamError({
        accountId: 'acc-1',
        status: 503,
        body,
        model: 'gemini-3.1-pro',
        backoffSteps: [],
      });
      expect(third?.retryAfterSec).toBe(15);
    });

    it('tracks RateLimitExceeded with generic resource exhausted (30s) vs standard (5s)', () => {
      const generic = service.trackFromUpstreamError({
        accountId: 'acc-1',
        status: 429,
        body: 'resource_exhausted: Rate limit per minute exceeded',
        backoffSteps: [],
      });
      expect(generic?.reason).toBe(RateLimitReason.RateLimitExceeded);
      expect(generic?.retryAfterSec).toBe(30);

      const standard = service.trackFromUpstreamError({
        accountId: 'acc-2',
        status: 429,
        body: 'too many requests',
        backoffSteps: [],
      });
      expect(standard?.reason).toBe(RateLimitReason.RateLimitExceeded);
      expect(standard?.retryAfterSec).toBe(5);
    });

    it('tracks QuotaExhausted and walks custom backoff steps', () => {
      const body = 'Quota exceeded: daily quota limit reached';
      const customSteps = [40, 120, 240];

      const step1 = service.trackFromUpstreamError({
        accountId: 'acc-quota',
        status: 429,
        body,
        backoffSteps: customSteps,
      });
      expect(step1?.reason).toBe(RateLimitReason.QuotaExhausted);
      expect(step1?.retryAfterSec).toBe(40);

      const step2 = service.trackFromUpstreamError({
        accountId: 'acc-quota',
        status: 429,
        body,
        backoffSteps: customSteps,
      });
      expect(step2?.retryAfterSec).toBe(120);

      const step3 = service.trackFromUpstreamError({
        accountId: 'acc-quota',
        status: 429,
        body,
        backoffSteps: customSteps,
      });
      expect(step3?.retryAfterSec).toBe(240);

      // Capped at last step
      const step4 = service.trackFromUpstreamError({
        accountId: 'acc-quota',
        status: 429,
        body,
        backoffSteps: customSteps,
      });
      expect(step4?.retryAfterSec).toBe(240);
    });

    it('uses explicit retryAfter delay when present and caps non-image models at MAX_LOCKOUT_SECONDS (300s)', () => {
      const info = service.trackFromUpstreamError({
        accountId: 'acc-1',
        status: 429,
        retryAfter: '600', // 10 min
        model: 'gemini-1.5-pro',
        backoffSteps: [],
      });

      expect(info?.retryAfterSec).toBe(300); // capped at 300s
      expect(info?.preservesLongImageQuota).toBe(false);
    });

    it('preserves long image quota over 300s for recognized image models', () => {
      const info = service.trackFromUpstreamError({
        accountId: 'acc-1',
        status: 429,
        body: 'quota_exhausted: quota will reset after 600s',
        model: 'gemini-3-pro-image',
        backoffSteps: [],
      });

      expect(info?.retryAfterSec).toBe(600);
      expect(info?.preservesLongImageQuota).toBe(true);
    });

    it('parses error detail reasons from Google JSON body', () => {
      const body = JSON.stringify({
        error: {
          details: [
            {
              reason: 'RATE_LIMIT_EXCEEDED',
            },
          ],
        },
      });

      const info = service.trackFromUpstreamError({
        accountId: 'acc-1',
        status: 429,
        body,
        backoffSteps: [],
      });
      expect(info?.reason).toBe(RateLimitReason.RateLimitExceeded);
    });

    it('expires failure count after 1 hour', () => {
      const body = 'model capacity exhausted';
      service.trackFromUpstreamError({
        accountId: 'acc-1',
        status: 429,
        body,
        model: 'gemini-3.1-pro',
        backoffSteps: [],
      });

      // Second failure within 1 hour increases retryAfterSec to 10
      const second = service.trackFromUpstreamError({
        accountId: 'acc-1',
        status: 429,
        body,
        model: 'gemini-3.1-pro',
        backoffSteps: [],
      });
      expect(second?.retryAfterSec).toBe(10);

      // Advance by > 1 hour
      jest.advanceTimersByTime(60 * 60 * 1000 + 1000);

      const afterHour = service.trackFromUpstreamError({
        accountId: 'acc-1',
        status: 429,
        body,
        model: 'gemini-3.1-pro',
        backoffSteps: [],
      });
      // Count reset to 1 -> 5s
      expect(afterHour?.retryAfterSec).toBe(5);
    });

    it('parseAndMarkFromError delegates to trackFromUpstreamError', () => {
      const res = service.parseAndMarkFromError({
        accountId: 'acc-delegate',
        status: 429,
        body: 'too many requests',
        backoffSteps: [],
      });
      expect(res?.reason).toBe(RateLimitReason.RateLimitExceeded);
    });
  });

  describe('distributed CooldownBus integration', () => {
    class MockCooldownBus implements CooldownBus {
      published: Array<{ accountId: string; untilMs: number; model?: string }> = [];
      subscribers: Array<(accountId: string, untilMs: number, model?: string) => void> = [];

      async publishCooldown(accountId: string, untilMs: number, model?: string): Promise<void> {
        this.published.push({ accountId, untilMs, model });
      }

      subscribe(handler: (accountId: string, untilMs: number, model?: string) => void): () => void {
        this.subscribers.push(handler);
        return () => {
          this.subscribers = this.subscribers.filter((s) => s !== handler);
        };
      }

      simulateRemoteEvent(accountId: string, untilMs: number, model?: string): void {
        for (const sub of this.subscribers) {
          sub(accountId, untilMs, model);
        }
      }
    }

    it('publishes cooldown event on setLockoutUntilIso', () => {
      const bus = new MockCooldownBus();
      const tracker = new RateLimitTrackerService(bus);

      tracker.setLockoutUntilIso(
        'acc-bus-1',
        new Date(Date.now() + 15000).toISOString(),
        RateLimitReason.RateLimitExceeded,
      );

      expect(bus.published).toHaveLength(1);
      expect(bus.published[0]?.accountId).toBe('acc-bus-1');
      expect(bus.published[0]?.untilMs).toBeGreaterThan(Date.now());
    });

    it('publishes cooldown event on trackFromUpstreamError', () => {
      const bus = new MockCooldownBus();
      const tracker = new RateLimitTrackerService(bus);

      tracker.trackFromUpstreamError({
        accountId: 'acc-bus-2',
        status: 429,
        body: 'too many requests',
        model: 'gemini-2.5-flash',
        backoffSteps: [],
      });

      expect(bus.published).toHaveLength(1);
      expect(bus.published[0]?.accountId).toBe('acc-bus-2');
      expect(bus.published[0]?.model).toBe('gemini-2.5-flash');
    });

    it('subscribes to remote events and updates local lockout without re-broadcasting', () => {
      const bus = new MockCooldownBus();
      const tracker = new RateLimitTrackerService(bus);

      expect(tracker.isRateLimited('acc-remote', 'gemini-pro')).toBe(false);

      const futureReset = Date.now() + 45000;
      bus.simulateRemoteEvent('acc-remote', futureReset, 'gemini-pro');

      expect(tracker.isRateLimited('acc-remote', 'gemini-pro')).toBe(true);
      expect(tracker.getRemainingWaitSeconds('acc-remote', 'gemini-pro')).toBeGreaterThan(0);
      // Ensure the remote event was applied locally WITHOUT triggering an outgoing publish
      expect(bus.published).toHaveLength(0);
    });
  });
});


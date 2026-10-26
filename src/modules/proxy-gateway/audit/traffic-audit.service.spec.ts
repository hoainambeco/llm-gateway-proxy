import { TrafficAuditService } from './traffic-audit.service';
import * as dbConfig from '@/modules/database/database.config';

describe('TrafficAuditService', () => {
  let service: TrafficAuditService;
  let mockTrafficRepo: any;
  let mockApiKeyRepo: any;
  let mockDataSource: any;

  function createMockQueryBuilder(overrides: Record<string, any> = {}) {
    const qb: any = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      addGroupBy: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({}),
      getRawMany: jest.fn().mockResolvedValue([]),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      ...overrides,
    };
    return qb;
  }

  beforeEach(() => {
    service = new TrafficAuditService();

    mockTrafficRepo = {
      create: jest.fn((entity) => entity),
      insert: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      count: jest.fn().mockResolvedValue(5),
      find: jest.fn().mockResolvedValue([{ id: 'log-1' }, { id: 'log-2' }]),
      remove: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn(() => createMockQueryBuilder()),
    };

    mockApiKeyRepo = {
      find: jest.fn().mockResolvedValue([]),
    };

    mockDataSource = {
      getRepository: jest.fn((entity) => {
        if (entity && entity.name === 'ApiKey') {
          return mockApiKeyRepo;
        }
        return mockTrafficRepo;
      }),
    };

    jest.spyOn(dbConfig, 'getStandaloneDataSource').mockResolvedValue(mockDataSource as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('configuration and lifecycle', () => {
    it('respects configured enabled state', async () => {
      await service.configure({ enabled: false } as any);
      expect(service.isEnabled()).toBe(false);

      const parent = service.startParent({
        method: 'POST',
        protocol: 'openai',
        trafficClass: 'model',
        url: '/v1/chat/completions',
      });
      expect(parent).toBeNull();

      const attempt = service.startAttempt(null, 1);
      expect(attempt).toBeNull();
    });

    it('creates and completes audit parent handle for model traffic', async () => {
      await service.configure({ enabled: true } as any);

      const handle = service.startParent({
        method: 'POST',
        protocol: 'gemini',
        trafficClass: 'model',
        url: '/v1beta/models/gemini-2.5-pro:generateContent',
        apiKeyId: 'key-test',
        requestBody: { model: 'gemini-2.5-pro' },
      });

      expect(handle).not.toBeNull();
      expect(handle?.model).toBe('gemini-2.5-pro');
      expect(handle?.trafficClass).toBe('model');

      service.completeParent(handle, {
        status: 200,
        outcome: 'completed',
        usage: { inputTokens: 100, outputTokens: 40 },
      });

      await new Promise((r) => setImmediate(r));

      expect(mockTrafficRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          id: handle?.id,
          apiKeyId: 'key-test',
          model: 'gemini-2.5-pro',
          status: 200,
          promptTokens: 100,
          completionTokens: 40,
          totalTokens: 140,
        }),
      );
      expect(mockTrafficRepo.insert).toHaveBeenCalled();
    });

    it('ignores non-model traffic classes when persisting logs', async () => {
      await service.configure({ enabled: true } as any);

      const handle = service.startParent({
        method: 'GET',
        protocol: 'admin-http',
        trafficClass: 'system',
        url: '/health',
      });

      service.completeParent(handle, { status: 200, outcome: 'completed' });
      await new Promise((r) => setImmediate(r));

      expect(mockTrafficRepo.insert).not.toHaveBeenCalled();
    });

    it('handles parent completion with error and no handle gracefully', async () => {
      expect(() => service.completeParent(null, { outcome: 'completed' })).not.toThrow();

      await service.configure({ enabled: true } as any);
      const handle = service.startParent({
        method: 'POST',
        protocol: 'openai',
        trafficClass: 'model',
        url: '/v1/chat/completions',
      });

      service.completeParent(handle, {
        outcome: 'internal_error',
        error: new Error('Upstream failed'),
      });

      await new Promise((r) => setImmediate(r));
      expect(mockTrafficRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 500,
          errorMessage: 'Upstream failed',
        }),
      );
    });

    it('tracks upstream attempts and SSE writers', () => {
      const parent = { id: 'p-1', startedAt: Date.now(), trafficClass: 'model' as const };
      const attempt = service.startAttempt(parent, 1);
      expect(attempt).not.toBeNull();
      expect(attempt?.parentId).toBe('p-1');

      expect(() =>
        service.completeAttempt(attempt, { status: 200, outcome: 'completed' }),
      ).not.toThrow();
      expect(() => service.completeAttempt(null, { outcome: 'completed' })).not.toThrow();

      const parentSse = service.beginParentSse(parent);
      expect(parentSse?.write('chunk')).toBe(true);

      const attemptSse = service.beginAttemptSse(attempt);
      expect(attemptSse?.write('chunk')).toBe(true);
    });
  });

  describe('query and administration methods', () => {
    it('lists logs with query builder', async () => {
      const mockQueryBuilder = createMockQueryBuilder({
        getManyAndCount: jest.fn().mockResolvedValue([
          [
            {
              id: 'log-1',
              apiKeyId: 'k-1',
              timestamp: 1000,
              method: 'POST',
              endpoint: '/v1/chat',
              model: 'gpt-4o',
              status: 200,
              latencyMs: 150,
              promptTokens: 10,
              completionTokens: 20,
              totalTokens: 30,
              errorMessage: null,
            },
          ],
          1,
        ]),
      });
      mockTrafficRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      const res = await service.list({
        from: 500,
        to: 1500,
        apiKeyId: 'k-1',
        limit: 10,
        offset: 0,
      });

      expect(res.total).toBe(1);
      expect(res.rows[0].requestId).toBe('log-1');
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('log.timestamp >= :from', { from: 500 });
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('log.timestamp <= :to', { to: 1500 });
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('log.apiKeyId = :apiKeyId', { apiKeyId: 'k-1' });
    });

    it('returns filter options for models, operations, and protocols', async () => {
      const mockQueryBuilder = createMockQueryBuilder({
        getRawMany: jest.fn().mockResolvedValue([{ model: 'gpt-4o' }, { model: 'claude-3-7-sonnet' }]),
      });
      mockTrafficRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      const opts = await service.filterOptions();
      expect(opts.models).toEqual(['gpt-4o', 'claude-3-7-sonnet']);
      expect(opts.protocols).toContain('gemini');
    });

    it('provides stats and deletion operations', async () => {
      const stats = await service.stats();
      expect(stats.rows).toBe(5);
      expect(stats.workerAlive).toBe(true);

      const deleted = await service.delete('log-1');
      expect(deleted).toBe(1);

      const cleared = await service.clear();
      expect(cleared).toBe(2);

      const repair = await service.repair();
      expect(repair.success).toBe(true);

      expect(await service.detail('any')).toBeNull();
      expect(await service.bodyPage({} as any)).toBeNull();
      expect(await service.bodySearch()).toEqual({ matches: [] });

      const generator = service.bodyContent('any');
      const item = await generator.next();
      expect(item.done).toBe(true);
    });
  });

  describe('getTokenUsageStats', () => {
    it('executes token usage aggregation across time range presets', async () => {
      const mockSummaryBuilder = createMockQueryBuilder({
        getRawOne: jest.fn().mockResolvedValue({
          totalRequests: '10',
          successfulRequests: '9',
          failedRequests: '1',
          promptTokens: '1000',
          completionTokens: '500',
          totalTokens: '1500',
        }),
      });

      const mockModelUsageBuilder = createMockQueryBuilder({
        getRawMany: jest.fn().mockResolvedValue([
          {
            model: 'gpt-4o',
            requests: '10',
            promptTokens: '1000',
            completionTokens: '500',
            totalTokens: '1500',
          },
        ]),
      });

      const mockKeyUsageBuilder = createMockQueryBuilder({
        getRawMany: jest.fn().mockResolvedValue([
          {
            apiKeyId: 'k-1',
            requests: '10',
            promptTokens: '1000',
            completionTokens: '500',
            totalTokens: '1500',
          },
        ]),
      });

      const mockTimeSeriesBuilder = createMockQueryBuilder({
        getRawMany: jest.fn().mockResolvedValue([
          {
            bucketTimestamp: 1000,
            requests: '5',
            promptTokens: '500',
            completionTokens: '250',
            totalTokens: '750',
          },
        ]),
      });

      let callCount = 0;
      mockTrafficRepo.createQueryBuilder.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return mockSummaryBuilder;
        if (callCount === 2) return mockModelUsageBuilder;
        if (callCount === 3) return mockKeyUsageBuilder;
        return mockTimeSeriesBuilder;
      });

      mockApiKeyRepo.find.mockResolvedValue([
        { id: 'k-1', name: 'Primary Admin Key' },
      ]);

      const stats = await service.getTokenUsageStats({
        range: 'TWENTY_FOUR_HOURS',
        apiKeyId: 'k-1',
      });

      expect(stats.summary.totalRequests).toBe(10);
      expect(stats.summary.successfulRequests).toBe(9);
      expect(stats.summary.failedRequests).toBe(1);
      expect(stats.summary.totalTokens).toBe(1500);
      expect(stats.timeSeries).toHaveLength(24);
      expect(stats.byApiKey[0].name).toBe('Primary Admin Key');
      expect(stats.byModel[0].model).toBe('gpt-4o');
      expect(stats.topModels[0].model).toBe('gpt-4o');
    });

    it('supports ONE_HOUR, SEVEN_DAYS, THIRTY_DAYS, and CUSTOM ranges', async () => {
      mockTrafficRepo.createQueryBuilder.mockImplementation(() => createMockQueryBuilder());

      for (const range of ['ONE_HOUR', 'SEVEN_DAYS', 'THIRTY_DAYS', 'NINETY_DAYS', 'ONE_YEAR', 'CUSTOM'] as const) {
        await service.getTokenUsageStats({
          range,
          from: 1000,
          to: 2000,
        });
      }
    });
  });
});

import { randomUUID } from 'node:crypto';
import { getStandaloneDataSource } from '@/modules/database/database.config';
import type { TrafficAuditConfig } from '@/modules/config/types';
import { DEFAULT_APP_CONFIG } from '@/modules/config/types';
import { getServerConfig } from '@/server/server-config';
import { logger } from '@/shared/logging/logger';
import type {
  CompleteAuditParentInput,
  CompleteUpstreamAttemptInput,
  StartAuditParentInput,
  StartUpstreamAttemptInput,
  TrafficAuditBodyPage,
  TrafficAuditBodyPageInput,
  TrafficAuditDetail,
  TrafficAuditListInput,
  TrafficAuditStats,
} from './traffic-audit.types';
import type { TrafficClass } from './traffic-classifier';
import { TrafficLog } from './entities/traffic-log.entity';
import { ApiKey } from '@/modules/api-key/entities/api-key.entity';
import { calculateEstimatedCostUsd } from './model-pricing-catalog';
import type {
  TokenStatsFilter,
  TokenUsageStatsResult,
  TimeSeriesDataPointResult,
  ApiKeyTokenUsageResult,
  ModelTokenUsageResult,
  TopModelRankingResult,
} from './traffic-audit.types';
import { In } from 'typeorm';

export interface AuditHandle {
  id: string;
  startedAt: number;
  trafficClass: TrafficClass;
  method?: string;
  url?: string;
  model?: string;
  apiKeyId?: string;
}

export interface UpstreamAttemptHandle {
  attemptSequence: number;
  id: string;
  parentId: string;
  startedAt: number;
  trafficClass: TrafficClass;
}

export interface AuditSseBodyWriter {
  write(chunk: string): boolean;
  finish(outcome?: unknown): Promise<void>;
  end?(): void;
}

export interface DatabaseRepairResult {
  error?: string;
  recoveredRecords?: number;
  success: boolean;
}

interface StoredTrafficLog {
  id: string;
  apiKeyId: string | null;
  timestamp: number;
  method: string;
  endpoint: string;
  model: string | null;
  status: number;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  errorMessage: string | null;
}

export class TrafficAuditService {
  private config: TrafficAuditConfig | null = null;

  private getConfig(): TrafficAuditConfig {
    return this.config ?? getServerConfig()?.traffic_audit ?? DEFAULT_APP_CONFIG.proxy.traffic_audit;
  }

  public isEnabled(): boolean {
    return this.getConfig().enabled;
  }

  private async getRepository() {
    try {
      const dataSource = await getStandaloneDataSource();
      return dataSource.getRepository(TrafficLog);
    } catch (err) {
      logger.warn('Could not obtain TypeORM traffic_logs repository:', err);
      return null;
    }
  }

  private async recordTraffic(log: StoredTrafficLog): Promise<void> {
    const repo = await this.getRepository();
    if (!repo) {
      return;
    }
    try {
      const entity = repo.create({
        id: log.id,
        apiKeyId: log.apiKeyId,
        timestamp: log.timestamp,
        method: log.method,
        endpoint: log.endpoint,
        model: log.model,
        status: log.status,
        latencyMs: log.latencyMs,
        promptTokens: log.promptTokens,
        completionTokens: log.completionTokens,
        totalTokens: log.totalTokens,
        errorMessage: log.errorMessage,
      });
      await repo.insert(entity);
    } catch (err) {
      logger.warn('Failed to insert traffic log via TypeORM', err);
    }
  }

  public startParent(input: StartAuditParentInput): AuditHandle | null {
    if (!this.isEnabled()) {
      return null;
    }
    const startedAt = Date.now();

    let modelName: string | undefined = undefined;
    if (typeof input.requestBody === 'object' && input.requestBody !== null) {
      modelName = (input.requestBody as any).model;
    }
    if (!modelName && input.url) {
      const match = /\/models\/([^/:?]+)/.exec(input.url);
      if (match) {
        modelName = match[1];
      }
    }

    const handle: AuditHandle = {
      id: randomUUID(),
      startedAt,
      trafficClass: input.trafficClass,
      method: input.method,
      url: input.url,
      model: modelName,
      apiKeyId: input.apiKeyId,
    };

    logger.info(`[Audit] --> ${input.method} ${input.url} (class: ${input.trafficClass}, id: ${handle.id.slice(0, 8)})`);
    return handle;
  }

  public completeParent(handle: AuditHandle | null, input: CompleteAuditParentInput): void {
    if (!handle) {
      return;
    }
    const duration = Math.max(1, Date.now() - handle.startedAt);
    const status = input.status ?? (input.error ? 500 : 200);
    logger.info(`[Audit] <-- Completed (${status}) in ${duration}ms (id: ${handle.id.slice(0, 8)})`);

    // Only persist logs for actual AI model usage; skip auxiliary/system/ipc requests
    if (handle.trafficClass !== 'model') {
      return;
    }

    // Strictly save only non-sensitive metadata (NO prompt/chat content)
    void this.recordTraffic({
      id: handle.id,
      apiKeyId: input.apiKeyId ?? handle.apiKeyId ?? null,
      timestamp: handle.startedAt,
      method: handle.method || 'POST',
      endpoint: handle.url || '',
      model: handle.model || null,
      status,
      latencyMs: duration,
      promptTokens: input.usage?.inputTokens || 0,
      completionTokens: input.usage?.outputTokens || 0,
      totalTokens: (input.usage?.inputTokens || 0) + (input.usage?.outputTokens || 0),
      errorMessage: input.error
        ? input.error instanceof Error
          ? input.error.message
          : String(input.error)
        : null,
    });
  }

  public startAttempt(
    parent: AuditHandle | null,
    attemptSequence: number,
    _input?: StartUpstreamAttemptInput,
  ): UpstreamAttemptHandle | null {
    if (!parent || !this.isEnabled()) {
      return null;
    }
    return {
      attemptSequence,
      id: randomUUID(),
      parentId: parent.id,
      startedAt: Date.now(),
      trafficClass: parent.trafficClass,
    };
  }

  public completeAttempt(
    handle: UpstreamAttemptHandle | null,
    input: CompleteUpstreamAttemptInput,
  ): void {
    if (!handle) {
      return;
    }
    const duration = Date.now() - handle.startedAt;
    logger.debug(`[Audit] Upstream attempt ${handle.attemptSequence} finished (${input.status}) in ${duration}ms`);
  }

  public beginParentSse(_handle: AuditHandle | null): AuditSseBodyWriter | null {
    return {
      write: () => true,
      finish: () => Promise.resolve(),
      end: () => {},
    };
  }

  public beginAttemptSse(_handle: UpstreamAttemptHandle | null): AuditSseBodyWriter | null {
    return {
      write: () => true,
      finish: () => Promise.resolve(),
      end: () => {},
    };
  }

  public async list(input?: TrafficAuditListInput) {
    const repo = await this.getRepository();
    if (!repo) {
      return { data: [], rows: [], total: 0 };
    }
    const limit = Math.min(input?.limit ?? 50, 100);
    const offset = input?.offset ?? 0;

    try {
      const qb = repo
        .createQueryBuilder('log')
        .where('log.endpoint NOT LIKE :gqlExclude', { gqlExclude: '%/graphql%' })
        .orderBy('log.timestamp', 'DESC')
        .take(limit)
        .skip(offset);

      if (input?.from !== undefined) {
        qb.andWhere('log.timestamp >= :from', { from: input.from });
      }
      if (input?.to !== undefined) {
        qb.andWhere('log.timestamp <= :to', { to: input.to });
      }
      if (input?.apiKeyId) {
        qb.andWhere('log.apiKeyId = :apiKeyId', { apiKeyId: input.apiKeyId });
      }

      const [logs, total] = await qb.getManyAndCount();

      const rows = logs.map((log) => ({
        requestId: log.id,
        apiKeyId: log.apiKeyId,
        timestamp: log.timestamp,
        method: log.method,
        endpoint: log.endpoint,
        model: log.model,
        status: log.status,
        latencyMs: log.latencyMs,
        promptTokens: log.promptTokens,
        completionTokens: log.completionTokens,
        totalTokens: log.totalTokens,
        errorMessage: log.errorMessage,
      }));

      return { data: rows, rows, total };
    } catch (err) {
      logger.warn('Failed to query traffic logs via TypeORM', err);
      return { data: [], rows: [], total: 0 };
    }
  }

  public async filterOptions() {
    const repo = await this.getRepository();
    if (!repo) {
      return { models: [], operations: [], protocols: [] };
    }
    try {
      const modelRows: Array<{ model: string }> = await repo
        .createQueryBuilder('log')
        .select('DISTINCT log.model', 'model')
        .where('log.model IS NOT NULL')
        .getRawMany();
      return {
        models: modelRows.map((r) => r.model),
        operations: ['chat', 'messages', 'models'],
        protocols: ['openai', 'anthropic', 'gemini'],
      };
    } catch {
      return { models: [], operations: [], protocols: [] };
    }
  }

  public async detail(_id: string): Promise<TrafficAuditDetail | null> {
    return null;
  }

  public async bodyPage(_input: TrafficAuditBodyPageInput): Promise<TrafficAuditBodyPage | null> {
    return null;
  }

  public async *bodyContent(_bodyId: string): AsyncGenerator<string> {
    // Empty generator - no body content stored
  }

  public async bodySearch() {
    return { matches: [] };
  }

  public async stats(): Promise<TrafficAuditStats> {
    const repo = await this.getRepository();
    let rowCount = 0;
    if (repo) {
      try {
        rowCount = await repo.count();
      } catch {
        // ignore
      }
    }
    return {
      bodyStoredBytes: 0,
      databaseBytes: 0,
      droppedCount: 0,
      incompleteBodies: 0,
      lastDropReason: null,
      oldestTimestamp: null,
      rows: rowCount,
      workerAlive: true,
      workerPendingBytes: 0,
      workerPendingCommands: 0,
    };
  }

  public async delete(id: string): Promise<number> {
    const repo = await this.getRepository();
    if (!repo) return 0;
    try {
      const res = await repo.delete(id);
      return res.affected ?? 0;
    } catch {
      return 0;
    }
  }

  public async clear(_trafficClass: TrafficClass | null = null): Promise<number> {
    const repo = await this.getRepository();
    if (!repo) return 0;
    try {
      const logs = await repo.find();
      await repo.remove(logs);
      return logs.length;
    } catch {
      return 0;
    }
  }

  public async configure(config: TrafficAuditConfig): Promise<void> {
    this.config = config;
  }

  public async repair(): Promise<DatabaseRepairResult> {
    return { success: true };
  }

  public recordAdminOperation(_op: string, _affected?: number): void {}

  public async getTokenUsageStats(filter: TokenStatsFilter): Promise<TokenUsageStatsResult> {
    const ds = await getStandaloneDataSource();
    const trafficRepo = ds.getRepository(TrafficLog);
    const apiKeyRepo = ds.getRepository(ApiKey);

    const now = Date.now();
    let from = filter.from ?? now - 24 * 60 * 60 * 1000;
    let to = filter.to ?? now;
    let bucketMs = 60 * 60 * 1000; // 1 hour default

    switch (filter.range) {
      case 'ONE_HOUR':
        from = now - 60 * 60 * 1000;
        to = now;
        bucketMs = 5 * 60 * 1000; // 5 min
        break;
      case 'TWENTY_FOUR_HOURS':
        from = now - 24 * 60 * 60 * 1000;
        to = now;
        bucketMs = 60 * 60 * 1000; // 1 hour
        break;
      case 'SEVEN_DAYS':
        from = now - 7 * 24 * 60 * 60 * 1000;
        to = now;
        bucketMs = 6 * 60 * 60 * 1000; // 6 hours
        break;
      case 'THIRTY_DAYS':
        from = now - 30 * 24 * 60 * 60 * 1000;
        to = now;
        bucketMs = 24 * 60 * 60 * 1000; // 1 day
        break;
      case 'NINETY_DAYS':
        from = now - 90 * 24 * 60 * 60 * 1000;
        to = now;
        bucketMs = 3 * 24 * 60 * 60 * 1000; // 3 days
        break;
      case 'ONE_YEAR':
        from = now - 365 * 24 * 60 * 60 * 1000;
        to = now;
        bucketMs = 30 * 24 * 60 * 60 * 1000; // ~1 month
        break;
      case 'CUSTOM':
      default:
        from = filter.from ?? now - 24 * 60 * 60 * 1000;
        to = filter.to ?? now;
        const diff = Math.max(1000, to - from);
        if (diff <= 2 * 24 * 60 * 60 * 1000) {
          bucketMs = 60 * 60 * 1000; // 1h
        } else if (diff <= 60 * 24 * 60 * 60 * 1000) {
          bucketMs = 24 * 60 * 60 * 1000; // 1d
        } else {
          bucketMs = 7 * 24 * 60 * 60 * 1000; // 7d
        }
        break;
    }

    const baseWhere = ['"timestamp" >= :from', '"timestamp" <= :to', '"endpoint" NOT LIKE :gqlExclude'];
    const parameters: Record<string, any> = { from, to, gqlExclude: '%/graphql%' };

    if (filter.apiKeyId) {
      baseWhere.push('"apiKeyId" = :apiKeyId');
      parameters.apiKeyId = filter.apiKeyId;
    }

    const whereClause = baseWhere.join(' AND ');

    // 1. Summary Query
    const summaryRaw = await trafficRepo
      .createQueryBuilder('log')
      .select('COUNT(*)', 'totalRequests')
      .addSelect('SUM(CASE WHEN log.status >= 200 AND log.status < 400 THEN 1 ELSE 0 END)', 'successfulRequests')
      .addSelect('SUM(CASE WHEN log.status >= 400 OR log.status = 0 THEN 1 ELSE 0 END)', 'failedRequests')
      .addSelect('COALESCE(SUM(log.promptTokens), 0)', 'promptTokens')
      .addSelect('COALESCE(SUM(log.completionTokens), 0)', 'completionTokens')
      .addSelect('COALESCE(SUM(log.totalTokens), 0)', 'totalTokens')
      .addSelect('COALESCE(AVG(log.latencyMs), 0)', 'avgLatencyMs')
      .where(whereClause, parameters)
      .getRawOne();

    // 2. By Model Query
    const modelRows = await trafficRepo
      .createQueryBuilder('log')
      .select('COALESCE(log.model, :unknownModel)', 'model')
      .addSelect('COUNT(*)', 'requestCount')
      .addSelect('COALESCE(SUM(log.promptTokens), 0)', 'promptTokens')
      .addSelect('COALESCE(SUM(log.completionTokens), 0)', 'completionTokens')
      .addSelect('COALESCE(SUM(log.totalTokens), 0)', 'totalTokens')
      .where(whereClause, { ...parameters, unknownModel: 'Unknown / Direct' })
      .groupBy('model')
      .orderBy('totalTokens', 'DESC')
      .getRawMany();

    // 3. By ApiKey Query
    const apiKeyRows = await trafficRepo
      .createQueryBuilder('log')
      .select('COALESCE(log.apiKeyId, :noKey)', 'apiKeyId')
      .addSelect('COUNT(*)', 'requestCount')
      .addSelect('COALESCE(SUM(log.promptTokens), 0)', 'promptTokens')
      .addSelect('COALESCE(SUM(log.completionTokens), 0)', 'completionTokens')
      .addSelect('COALESCE(SUM(log.totalTokens), 0)', 'totalTokens')
      .where(whereClause, { ...parameters, noKey: 'unauthenticated' })
      .groupBy('apiKeyId')
      .orderBy('totalTokens', 'DESC')
      .getRawMany();

    // 4. Time-series Buckets
    const numBuckets = Math.max(1, Math.ceil((to - from) / bucketMs));
    const timeSeriesRaw = await trafficRepo
      .createQueryBuilder('log')
      .select(`CAST((log.timestamp - :from) / :bucketMs AS INTEGER)`, 'bucketIndex')
      .addSelect('COALESCE(log.model, :unknownModel)', 'model')
      .addSelect('COUNT(*)', 'requestCount')
      .addSelect('COALESCE(SUM(log.promptTokens), 0)', 'promptTokens')
      .addSelect('COALESCE(SUM(log.completionTokens), 0)', 'completionTokens')
      .addSelect('COALESCE(SUM(log.totalTokens), 0)', 'totalTokens')
      .where(whereClause, { ...parameters, bucketMs, unknownModel: 'Unknown' })
      .groupBy('bucketIndex')
      .addGroupBy('model')
      .getRawMany();

    // Calculate Costs and Model breakdown
    let totalEstimatedCost = 0;
    const byModel: ModelTokenUsageResult[] = [];
    const overallTotalTokens = Number(summaryRaw?.totalTokens ?? 0);

    for (const r of modelRows) {
      const pTokens = Number(r.promptTokens || 0);
      const cTokens = Number(r.completionTokens || 0);
      const tTokens = Number(r.totalTokens || 0);
      const reqCount = Number(r.requestCount || 0);
      const cost = calculateEstimatedCostUsd(r.model, pTokens, cTokens);
      totalEstimatedCost += cost;

      const percentage = overallTotalTokens > 0
        ? Math.round((tTokens / overallTotalTokens) * 1000) / 10
        : 0;

      byModel.push({
        model: r.model,
        promptTokens: pTokens,
        completionTokens: cTokens,
        totalTokens: tTokens,
        requestCount: reqCount,
        percentage,
        estimatedCostUsd: cost,
      });
    }

    totalEstimatedCost = Math.round(totalEstimatedCost * 10000) / 10000;

    // Top Models ranking
    const topModels: TopModelRankingResult[] = byModel.slice(0, 10).map((m, idx) => ({
      rank: idx + 1,
      model: m.model,
      totalTokens: m.totalTokens,
      requestCount: m.requestCount,
      percentage: m.percentage,
      estimatedCostUsd: m.estimatedCostUsd,
    }));

    // Resolve ApiKey metadata
    const apiKeyIds = apiKeyRows
      .map((r) => r.apiKeyId)
      .filter((id) => id && id !== 'unauthenticated');

    const keyEntityMap = new Map<string, ApiKey>();
    if (apiKeyIds.length > 0) {
      try {
        const foundKeys = await apiKeyRepo.find({ where: { id: In(apiKeyIds) } });
        for (const k of foundKeys) {
          keyEntityMap.set(k.id, k);
        }
      } catch {
        // ignore
      }
    }

    const byApiKey: ApiKeyTokenUsageResult[] = apiKeyRows.map((r) => {
      const pTokens = Number(r.promptTokens || 0);
      const cTokens = Number(r.completionTokens || 0);
      const tTokens = Number(r.totalTokens || 0);
      const reqCount = Number(r.requestCount || 0);
      const keyObj = keyEntityMap.get(r.apiKeyId);

      const percentage = overallTotalTokens > 0
        ? Math.round((tTokens / overallTotalTokens) * 1000) / 10
        : 0;

      // Estimate key cost based on average or default rate
      const cost = calculateEstimatedCostUsd(null, pTokens, cTokens);

      return {
        apiKeyId: r.apiKeyId,
        name: keyObj ? keyObj.name : r.apiKeyId === 'unauthenticated' ? 'Public / No Key' : 'Deleted Key',
        keyPreview: keyObj ? keyObj.keyPreview : r.apiKeyId === 'unauthenticated' ? 'none' : `${r.apiKeyId.slice(0, 8)}...`,
        promptTokens: pTokens,
        completionTokens: cTokens,
        totalTokens: tTokens,
        requestCount: reqCount,
        percentage,
        estimatedCostUsd: cost,
      };
    });

    // Populate Time Series Buckets (zero fill)
    const bucketMap = new Map<number, { promptTokens: number; completionTokens: number; totalTokens: number; requestCount: number; cost: number }>();
    for (let i = 0; i < numBuckets; i++) {
      bucketMap.set(i, { promptTokens: 0, completionTokens: 0, totalTokens: 0, requestCount: 0, cost: 0 });
    }

    for (const row of timeSeriesRaw) {
      const bIdx = Number(row.bucketIndex);
      if (bIdx >= 0 && bIdx < numBuckets) {
        const b = bucketMap.get(bIdx)!;
        const pTokens = Number(row.promptTokens || 0);
        const cTokens = Number(row.completionTokens || 0);
        const tTokens = Number(row.totalTokens || 0);
        const reqCount = Number(row.requestCount || 0);
        const cost = calculateEstimatedCostUsd(row.model, pTokens, cTokens);

        b.promptTokens += pTokens;
        b.completionTokens += cTokens;
        b.totalTokens += tTokens;
        b.requestCount += reqCount;
        b.cost += cost;
      }
    }

    const timeSeries: TimeSeriesDataPointResult[] = [];
    for (let i = 0; i < numBuckets; i++) {
      const bTimestamp = from + i * bucketMs;
      const b = bucketMap.get(i)!;
      const d = new Date(bTimestamp);

      let label = '';
      if (bucketMs < 24 * 60 * 60 * 1000) {
        label = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
      } else {
        label = `${d.getMonth() + 1}/${d.getDate()}`;
      }

      timeSeries.push({
        timestamp: bTimestamp,
        label,
        promptTokens: b.promptTokens,
        completionTokens: b.completionTokens,
        totalTokens: b.totalTokens,
        requestCount: b.requestCount,
        estimatedCostUsd: Math.round(b.cost * 10000) / 10000,
      });
    }

    return {
      range: filter.range,
      from,
      to,
      summary: {
        totalTokens: overallTotalTokens,
        promptTokens: Number(summaryRaw?.promptTokens ?? 0),
        completionTokens: Number(summaryRaw?.completionTokens ?? 0),
        totalRequests: Number(summaryRaw?.totalRequests ?? 0),
        successfulRequests: Number(summaryRaw?.successfulRequests ?? 0),
        failedRequests: Number(summaryRaw?.failedRequests ?? 0),
        avgLatencyMs: Math.round(Number(summaryRaw?.avgLatencyMs ?? 0)),
        estimatedCostUsd: totalEstimatedCost,
      },
      timeSeries,
      byApiKey,
      byModel,
      topModels,
    };
  }

  public async close(): Promise<void> {}
}

export const trafficAuditService = new TrafficAuditService();

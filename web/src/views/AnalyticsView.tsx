import React, { useState, useEffect, useCallback } from 'react';
import {
  BarChart3,
  RefreshCw,
  Download,
  Key,
  Layers,
  Clock,
  DollarSign,
  TrendingUp,
  Cpu,
} from 'lucide-react';
import { api } from '../api/client';
import type { ApiKeyItem, TokenUsageStatsResponse, TimeRangePresetType } from '../types';
import { TimeSeriesChart } from '../components/charts/TimeSeriesChart';
import { exportTokenAnalyticsCsv } from '../lib/exportCsv';
import { useTranslation } from '../i18n';

function formatTokens(num: number): string {
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(2)}B`;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}k`;
  return num.toLocaleString();
}

export const AnalyticsView: React.FC = () => {
  const { t } = useTranslation();

  const [rangePreset, setRangePreset] = useState<TimeRangePresetType>('TWENTY_FOUR_HOURS');
  const [selectedApiKeyId, setSelectedApiKeyId] = useState<string>('');
  const [customFrom, setCustomFrom] = useState<string>('');
  const [customTo, setCustomTo] = useState<string>('');

  const [apiKeys, setApiKeys] = useState<ApiKeyItem[]>([]);
  const [stats, setStats] = useState<TokenUsageStatsResponse | null>(null);
  const [requestState, setRequestState] = useState<'loading' | 'ready'>('loading');
  const [error, setError] = useState<string | null>(null);

  // A filter change starts a new fetch. The busy flag is adjusted during
  // render (react.dev "adjust state during render") instead of inside the
  // effect, so the refetch effect never sets state synchronously.
  const queryKey = `${rangePreset}|${selectedApiKeyId}|${customFrom}|${customTo}`;
  const [prevQueryKey, setPrevQueryKey] = useState(queryKey);
  if (prevQueryKey !== queryKey) {
    setPrevQueryKey(queryKey);
    setRequestState('loading');
    setError(null);
  }
  const isLoading = requestState === 'loading';

  // Fetch API keys for filter dropdown
  useEffect(() => {
    api.getApiKeys()
      .then((keys) => setApiKeys(keys || []))
      .catch(() => {});
  }, []);

  const loadStats = useCallback(() => {
    let from: number | undefined;
    let to: number | undefined;
    if (rangePreset === 'CUSTOM') {
      if (customFrom) from = new Date(customFrom).getTime();
      if (customTo) to = new Date(customTo).getTime();
    }

    return api
      .getTokenStats({
        range: rangePreset,
        from,
        to,
        apiKeyId: selectedApiKeyId || undefined,
      })
      .then((res) => setStats(res))
      .catch((err: any) => setError(err.message || 'Failed to fetch token analytics'))
      .finally(() => setRequestState('ready'));
  }, [rangePreset, selectedApiKeyId, customFrom, customTo]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  const handleRefresh = () => {
    setRequestState('loading');
    setError(null);
    void loadStats();
  };

  const handleExportCsv = () => {
    if (!stats) return;
    exportTokenAnalyticsCsv(stats);
  };

  const presets: Array<{ id: TimeRangePresetType; label: string }> = [
    { id: 'ONE_HOUR', label: t('analytics.presets.oneHour') },
    { id: 'TWENTY_FOUR_HOURS', label: t('analytics.presets.twentyFourHours') },
    { id: 'SEVEN_DAYS', label: t('analytics.presets.sevenDays') },
    { id: 'THIRTY_DAYS', label: t('analytics.presets.thirtyDays') },
    { id: 'NINETY_DAYS', label: t('analytics.presets.ninetyDays') },
    { id: 'ONE_YEAR', label: t('analytics.presets.oneYear') },
    { id: 'CUSTOM', label: t('analytics.presets.custom') },
  ];

  return (
    <div className="space-y-6">
      {/* Top Header & Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-zinc-900 border border-zinc-800 p-4 rounded-xl">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-400">
            <BarChart3 className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-zinc-100">{t('analytics.title')}</h2>
            <p className="text-xs text-zinc-400">{t('analytics.description')}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* API Key selector */}
          <div className="relative">
            <select
              value={selectedApiKeyId}
              onChange={(e) => setSelectedApiKeyId(e.target.value)}
              className="bg-zinc-800 border border-zinc-700/80 rounded-lg px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              <option value="">{t('analytics.allApiKeys')}</option>
              {apiKeys.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name} ({k.keyPreview || k.key || k.id.slice(0, 8)})
                </option>
              ))}
            </select>
          </div>

          {/* Export CSV button */}
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={!stats || isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5 text-zinc-400" />
            {t('analytics.exportCsv')}
          </button>

          {/* Refresh button */}
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isLoading}
            className="p-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 rounded-lg text-xs transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-emerald-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Preset Pills */}
      <div className="flex flex-wrap items-center gap-1.5 bg-zinc-900/60 p-1.5 rounded-xl border border-zinc-800/80">
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setRangePreset(p.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              rangePreset === p.id
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
            }`}
          >
            {p.label}
          </button>
        ))}

        {rangePreset === 'CUSTOM' && (
          <div className="flex items-center gap-2 pl-3 border-l border-zinc-800 text-xs">
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-200"
            />
            <span className="text-zinc-500">to</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-200"
            />
          </div>
        )}
      </div>

      {error && (
        <div className="p-4 bg-red-900/20 border border-red-800/60 rounded-xl text-red-400 text-xs">
          {error}
        </div>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Total Tokens */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-zinc-400 text-xs mb-2">
            <span>{t('analytics.totalTokens')}</span>
            <Layers className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-zinc-100">
            {stats ? formatTokens(stats.summary.totalTokens) : '0'}
          </div>
          <div className="flex items-center gap-3 mt-2 text-[11px] text-zinc-400">
            <span>Prompt: <span className="text-zinc-200 font-mono">{stats ? formatTokens(stats.summary.promptTokens) : '0'}</span></span>
            <span>•</span>
            <span>Comp: <span className="text-zinc-200 font-mono">{stats ? formatTokens(stats.summary.completionTokens) : '0'}</span></span>
          </div>
        </div>

        {/* Card 2: Total Requests */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-zinc-400 text-xs mb-2">
            <span>{t('analytics.totalRequests')}</span>
            <TrendingUp className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-zinc-100">
            {stats ? stats.summary.totalRequests.toLocaleString() : '0'}
          </div>
          <div className="flex items-center gap-3 mt-2 text-[11px] text-zinc-400">
            <span className="text-emerald-400 font-medium">{stats ? stats.summary.successfulRequests : 0} ok</span>
            <span>•</span>
            <span className="text-red-400 font-medium">{stats ? stats.summary.failedRequests : 0} err</span>
          </div>
        </div>

        {/* Card 3: Est. Cost */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-zinc-400 text-xs mb-2">
            <span>{t('analytics.estimatedCost')}</span>
            <DollarSign className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-amber-400">
            ${stats ? stats.summary.estimatedCostUsd.toFixed(4) : '0.0000'}
          </div>
          <div className="text-[11px] text-zinc-500 mt-2">
            Calculated from model price catalog
          </div>
        </div>

        {/* Card 4: Avg Latency */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-zinc-400 text-xs mb-2">
            <span>{t('analytics.avgLatency')}</span>
            <Clock className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-zinc-100">
            {stats ? `${stats.summary.avgLatencyMs}ms` : '0ms'}
          </div>
          <div className="text-[11px] text-zinc-500 mt-2">
            Average server processing time
          </div>
        </div>
      </div>

      {/* Time Series Chart */}
      <TimeSeriesChart data={stats?.timeSeries || []} />

      {/* Two Column Grid: Top Models & API Keys */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Models Ranking */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Cpu className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-semibold text-zinc-200">{t('analytics.topModels')}</h3>
          </div>

          {(!stats || stats.topModels.length === 0) ? (
            <div className="py-8 text-center text-zinc-500 text-xs">
              {t('analytics.noData')}
            </div>
          ) : (
            <div className="space-y-3">
              {stats.topModels.map((m) => (
                <div key={m.model} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="w-4 text-center font-mono text-zinc-500 font-bold">
                        #{m.rank}
                      </span>
                      <span className="font-medium text-zinc-200">{m.model}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-zinc-400">{formatTokens(m.totalTokens)}</span>
                      <span className="font-mono text-zinc-400 text-[11px] w-12 text-right">
                        {m.percentage}%
                      </span>
                      {m.estimatedCostUsd > 0 && (
                        <span className="font-mono text-amber-400 text-[11px] w-16 text-right">
                          ${m.estimatedCostUsd.toFixed(3)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden">
                    <div
                      className="bg-emerald-500 h-full rounded-full transition-all duration-500"
                      style={{ width: `${Math.min(100, Math.max(m.percentage, 2))}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* By API Key Breakdown */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Key className="w-4 h-4 text-blue-400" />
            <h3 className="text-sm font-semibold text-zinc-200">{t('analytics.byApiKey')}</h3>
          </div>

          {(!stats || stats.byApiKey.length === 0) ? (
            <div className="py-8 text-center text-zinc-500 text-xs">
              {t('analytics.noData')}
            </div>
          ) : (
            <div className="space-y-3">
              {stats.byApiKey.map((k) => (
                <div key={k.apiKeyId} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <div>
                      <span className="font-medium text-zinc-200">{k.name}</span>
                      <span className="ml-2 font-mono text-zinc-500 text-[11px]">
                        ({k.keyPreview})
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-zinc-400">{formatTokens(k.totalTokens)}</span>
                      <span className="font-mono text-zinc-400 text-[11px] w-12 text-right">
                        {k.percentage}%
                      </span>
                      {k.estimatedCostUsd > 0 && (
                        <span className="font-mono text-amber-400 text-[11px] w-16 text-right">
                          ${k.estimatedCostUsd.toFixed(3)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden">
                    <div
                      className="bg-blue-500 h-full rounded-full transition-all duration-500"
                      style={{ width: `${Math.min(100, Math.max(k.percentage, 2))}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Model Breakdown Full-Width Table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden shadow-sm">
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-200">{t('analytics.byModel')}</h3>
          <span className="text-xs text-zinc-500">
            {stats?.byModel.length || 0} models recorded
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-zinc-950/50 text-zinc-400 border-b border-zinc-800">
              <tr>
                <th className="py-3 px-4 font-medium">{t('analytics.model')}</th>
                <th className="py-3 px-4 font-medium">{t('analytics.promptTokens')}</th>
                <th className="py-3 px-4 font-medium">{t('analytics.completionTokens')}</th>
                <th className="py-3 px-4 font-medium">{t('analytics.tokens')}</th>
                <th className="py-3 px-4 font-medium">{t('analytics.requests')}</th>
                <th className="py-3 px-4 font-medium">{t('analytics.share')}</th>
                <th className="py-3 px-4 font-medium text-right">{t('analytics.cost')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800 text-zinc-300 font-mono">
              {(!stats || stats.byModel.length === 0) ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-zinc-500 font-sans">
                    {t('analytics.noData')}
                  </td>
                </tr>
              ) : (
                stats.byModel.map((m) => (
                  <tr key={m.model} className="hover:bg-zinc-800/40 transition-colors">
                    <td className="py-3 px-4 font-sans font-medium text-zinc-200">{m.model}</td>
                    <td className="py-3 px-4 text-zinc-400">{m.promptTokens.toLocaleString()}</td>
                    <td className="py-3 px-4 text-zinc-400">{m.completionTokens.toLocaleString()}</td>
                    <td className="py-3 px-4 font-bold text-emerald-400">{m.totalTokens.toLocaleString()}</td>
                    <td className="py-3 px-4 text-zinc-300">{m.requestCount.toLocaleString()}</td>
                    <td className="py-3 px-4 text-zinc-400">{m.percentage}%</td>
                    <td className="py-3 px-4 text-right text-amber-400">
                      ${m.estimatedCostUsd.toFixed(4)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

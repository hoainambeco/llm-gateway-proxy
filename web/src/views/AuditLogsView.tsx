import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import type { ApiKeyItem, AuditRecord } from '../types';
import { Activity, RefreshCw, AlertCircle, X } from 'lucide-react';
import { useTranslation } from '../i18n';

export const AuditLogsView: React.FC = () => {
  const { t } = useTranslation();
  const [filterModel, setFilterModel] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  // Server-side filters. `from`/`to` are raw `datetime-local` strings so the
  // inputs stay controlled; they are converted to epoch millis on fetch.
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [apiKeyId, setApiKeyId] = useState('');

  const [logs, setLogs] = useState<AuditRecord[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKeyItem[]>([]);
  const [requestState, setRequestState] = useState<'loading' | 'ready'>('loading');
  const [reloadToken, setReloadToken] = useState(0);

  // A filter or refresh change starts a new fetch. The busy flag is adjusted
  // during render (react.dev "adjust state during render") so the refetch
  // effect never sets state synchronously.
  const queryKey = `${from}|${to}|${apiKeyId}|${reloadToken}`;
  const [prevQueryKey, setPrevQueryKey] = useState(queryKey);
  if (prevQueryKey !== queryKey) {
    setPrevQueryKey(queryKey);
    setRequestState('loading');
  }
  const loading = requestState === 'loading';

  // Load the API key list once for the filter dropdown.
  useEffect(() => {
    let cancelled = false;
    api
      .getApiKeys()
      .then((keys) => {
        if (!cancelled) setApiKeys(keys || []);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  // Refetch whenever a server-side filter changes (or refresh is requested).
  useEffect(() => {
    let cancelled = false;
    const params: { from?: number; to?: number; apiKeyId?: string } = {};
    if (from) params.from = new Date(from).getTime();
    if (to) params.to = new Date(to).getTime();
    if (apiKeyId) params.apiKeyId = apiKeyId;

    void api
      .getAuditRequests(params)
      .then((rows) => {
        if (!cancelled) setLogs(rows);
      })
      .finally(() => {
        if (!cancelled) setRequestState('ready');
      });

    return () => {
      cancelled = true;
    };
  }, [from, to, apiKeyId, reloadToken]);

  const handleClearFilters = useCallback(() => {
    setFrom('');
    setTo('');
    setApiKeyId('');
    setFilterModel('');
    setFilterStatus('all');
  }, []);

  const filteredLogs = logs.filter((log) => {
    if (log.endpoint?.includes('/graphql')) {
      return false;
    }
    if (filterModel && !log.model?.toLowerCase().includes(filterModel.toLowerCase())) {
      return false;
    }
    if (filterStatus === '2xx' && (log.status < 200 || log.status >= 300)) return false;
    if (filterStatus === '4xx' && (log.status < 400 || log.status >= 500)) return false;
    if (filterStatus === '5xx' && log.status < 500) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-zinc-100 flex items-center gap-2">
            <Activity className="w-5 h-5 text-purple-400" />
            {t('audit.titleWithCount', { count: filteredLogs.length })}
          </h2>
          <p className="text-xs text-zinc-400">
            {t('audit.description')}
          </p>
        </div>

        <button
          onClick={() => setReloadToken((n) => n + 1)}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-xl text-xs font-medium transition-all"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-purple-400' : ''}`} />
          <span>{t('audit.refreshBtn')}</span>
        </button>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-1.5 text-xs text-zinc-200">
          <span className="text-[11px] uppercase tracking-wider text-zinc-500">
            {t('audit.timeFrom')}
          </span>
          <input
            type="datetime-local"
            data-testid="audit-from"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="bg-transparent text-xs text-zinc-200 focus:outline-none [color-scheme:dark]"
          />
        </label>

        <label className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-1.5 text-xs text-zinc-200">
          <span className="text-[11px] uppercase tracking-wider text-zinc-500">
            {t('audit.timeTo')}
          </span>
          <input
            type="datetime-local"
            data-testid="audit-to"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="bg-transparent text-xs text-zinc-200 focus:outline-none [color-scheme:dark]"
          />
        </label>

        <select
          data-testid="audit-apikey-filter"
          value={apiKeyId}
          onChange={(e) => setApiKeyId(e.target.value)}
          className="bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-purple-500"
        >
          <option value="">{t('audit.allApiKeys')}</option>
          {apiKeys.map((key) => (
            <option key={key.id} value={key.id}>
              {key.name}
            </option>
          ))}
        </select>

        <button
          data-testid="audit-clear-filters"
          onClick={handleClearFilters}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-300 rounded-xl text-xs font-medium transition-all"
        >
          <X className="w-3.5 h-3.5" />
          <span>{t('audit.clearFilters')}</span>
        </button>

        <input
          type="text"
          placeholder={t('audit.filterPlaceholder')}
          value={filterModel}
          onChange={(e) => setFilterModel(e.target.value)}
          className="bg-zinc-900 border border-zinc-800 rounded-xl px-3.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-purple-500 w-56"
        />

        <div className="flex items-center gap-1 bg-zinc-900 p-1 rounded-xl border border-zinc-800 text-xs">
          <button
            onClick={() => setFilterStatus('all')}
            className={`px-2.5 py-1 rounded-lg transition-all ${
              filterStatus === 'all' ? 'bg-zinc-800 text-zinc-100 font-semibold' : 'text-zinc-400'
            }`}
          >
            {t('audit.filters.all')}
          </button>
          <button
            onClick={() => setFilterStatus('2xx')}
            className={`px-2.5 py-1 rounded-lg transition-all ${
              filterStatus === '2xx' ? 'bg-emerald-500/20 text-emerald-400 font-semibold' : 'text-zinc-400'
            }`}
          >
            {t('audit.filters.success')}
          </button>
          <button
            onClick={() => setFilterStatus('4xx')}
            className={`px-2.5 py-1 rounded-lg transition-all ${
              filterStatus === '4xx' ? 'bg-amber-500/20 text-amber-400 font-semibold' : 'text-zinc-400'
            }`}
          >
            {t('audit.filters.rateLimit')}
          </button>
          <button
            onClick={() => setFilterStatus('5xx')}
            className={`px-2.5 py-1 rounded-lg transition-all ${
              filterStatus === '5xx' ? 'bg-rose-500/20 text-rose-400 font-semibold' : 'text-zinc-400'
            }`}
          >
            {t('audit.filters.error')}
          </button>
        </div>
      </div>

      {/* Logs Table */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 overflow-hidden">
        {filteredLogs.length === 0 ? (
          <div className="p-12 text-center text-zinc-500 text-sm">
            <AlertCircle className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
            <p>{t('audit.noLogsMatch')}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-900/80 border-b border-zinc-800 text-zinc-400 font-medium uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-4">{t('audit.table.time')}</th>
                  <th className="py-3 px-4">{t('audit.table.apiKey')}</th>
                  <th className="py-3 px-4">{t('audit.table.methodRoute')}</th>
                  <th className="py-3 px-4">{t('audit.table.model')}</th>
                  <th className="py-3 px-4">{t('audit.table.status')}</th>
                  <th className="py-3 px-4">{t('audit.table.latency')}</th>
                  <th className="py-3 px-4 text-right">{t('audit.table.tokens')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 font-mono">
                {filteredLogs.map((log) => {
                  const statusColor =
                    log.status >= 200 && log.status < 300
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      : log.status === 429
                        ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                        : 'bg-rose-500/10 text-rose-400 border border-rose-500/20';

                  return (
                    <tr
                      key={log.requestId}
                      data-testid="audit-row"
                      className="hover:bg-zinc-900/50 transition-colors"
                    >
                      <td className="py-3 px-4 text-zinc-400 text-[11px]">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 text-[11px] font-mono">
                          {log.apiKeyId ? log.apiKeyId.slice(0, 8) : '-'}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-bold text-zinc-300 mr-2 text-[11px]">{log.method}</span>
                        <span className="text-zinc-400 text-[11px]">{log.endpoint}</span>
                      </td>
                      <td className="py-3 px-4 text-zinc-200 font-medium">{log.model || '-'}</td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${statusColor}`}>
                          {log.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-zinc-400">{log.latencyMs}ms</td>
                      <td className="py-3 px-4 text-right text-zinc-400">
                        {log.promptTokens || log.completionTokens ? (
                          <span>
                            {log.promptTokens ?? 0} &rarr; {log.completionTokens ?? 0}
                          </span>
                        ) : (
                          '-'
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

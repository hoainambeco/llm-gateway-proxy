import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Pencil,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  ShieldAlert,
  Trash2,
  Users,
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { useToast } from '../components/Toast';
import { useTranslation } from '../i18n';
import type { Account } from '../types';

function formatResetCountdown(resetTime: string, resettingText: string, prefixTemplate: string): string {
  const diffMs = new Date(resetTime).getTime() - Date.now();
  if (diffMs <= 0) return resettingText;
  const diffMin = Math.floor(diffMs / 60000);
  let timeStr = '';
  if (diffMin < 60) {
    timeStr = `${diffMin}m`;
  } else {
    const hours = Math.floor(diffMin / 60);
    const mins = diffMin % 60;
    timeStr = mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
  return prefixTemplate.replace('{time}', timeStr);
}

interface AccountsViewProps {
  accounts: Account[];
  onReload: () => void;
}

export const AccountsView: React.FC<AccountsViewProps> = ({ accounts, onReload }) => {
  const { t } = useTranslation();
  const toast = useToast();
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<'google' | 'anthropic' | 'copilot' | 'openai'>('google');

  // List filters and inline row actions
  const [search, setSearch] = useState('');
  const [providerFilter, setProviderFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'disabled'>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [savingNameId, setSavingNameId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Sub-tabs
  const [anthropicMode, setAnthropicMode] = useState<'json' | 'oauth' | 'api_key' | 'web_session'>('json');
  const [copilotMode, setCopilotMode] = useState<'device' | 'token'>('device');
  const [openaiMode, setOpenaiMode] = useState<'json' | 'oauth' | 'key'>('json');

  // Form inputs
  const [email, setEmail] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [sessionKey, setSessionKey] = useState('');
  const [githubToken, setGithubToken] = useState('');
  const [rawJson, setRawJson] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Google OAuth
  const [oauthLoading, setOauthLoading] = useState(false);
  const [oauthUrl, setOauthUrl] = useState<string | null>(null);

  // Claude OAuth PKCE state
  const [claudeOAuthData, setClaudeOAuthData] = useState<{
    authUrl: string;
    codeVerifier: string;
    state: string;
    redirectUri: string;
  } | null>(null);
  const [claudeAuthCode, setClaudeAuthCode] = useState('');

  // OpenAI OAuth PKCE state
  const [openaiOAuthData, setOpenaiOAuthData] = useState<{
    authUrl: string;
    codeVerifier: string;
    state: string;
    redirectUri: string;
  } | null>(null);
  const [openaiAuthCode, setOpenaiAuthCode] = useState('');

  // Copilot Device Code state
  const [copilotDevice, setCopilotDevice] = useState<{
    device_code: string;
    user_code: string;
    verification_uri: string;
    interval: number;
  } | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
    };
  }, []);

  const handleSyncAccount = async (id: string) => {
    try {
      setSyncingId(id);
      await api.syncAccounts(id);
      onReload();
    } catch (err: any) {
      toast.error(t('accounts.syncFailed', { message: err.message }));
    } finally {
      setSyncingId(null);
    }
  };

  const handleDeleteAccount = async (id: string, email: string) => {
    const confirmed = await toast.confirm(t('accounts.confirmDelete', { email }), {
      title: t('common.confirmDeleteTitle'),
      danger: true,
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
    });
    if (!confirmed) return;

    try {
      setDeletingId(id);
      await api.deleteAccount(id);
      if (editingId === id) {
        setEditingId(null);
        setEditingName('');
      }
      onReload();
      toast.success(t('common.done'));
    } catch (err: any) {
      toast.error(t('accounts.deleteFailed', { message: err.message }));
    } finally {
      setDeletingId(null);
    }
  };

  const handleStartEditName = (account: Account) => {
    setEditingId(account.id);
    setEditingName(account.name ?? '');
  };

  const handleCancelEditName = () => {
    setEditingId(null);
    setEditingName('');
  };

  const handleSaveName = async (id: string) => {
    try {
      setSavingNameId(id);
      await api.updateAccount(id, { name: editingName.trim() || null });
      setEditingId(null);
      setEditingName('');
      onReload();
      toast.success(t('common.done'));
    } catch (err: any) {
      toast.error(t('accounts.updateFailed', { message: err.message }));
    } finally {
      setSavingNameId(null);
    }
  };

  const handleToggleActive = async (account: Account) => {
    const nextActive = account.is_active === false;
    const confirmed = await toast.confirm(
      t(nextActive ? 'accounts.confirmEnable' : 'accounts.confirmDisable', {
        email: account.email,
      }),
      {
        title: t(nextActive ? 'accounts.enable' : 'accounts.disable'),
        danger: !nextActive,
        confirmLabel: t(nextActive ? 'accounts.enable' : 'accounts.disable'),
        cancelLabel: t('common.cancel'),
      },
    );
    if (!confirmed) return;

    try {
      setTogglingId(account.id);
      await api.updateAccount(account.id, { is_active: nextActive });
      onReload();
    } catch (err: any) {
      toast.error(t('accounts.updateFailed', { message: err.message }));
    } finally {
      setTogglingId(null);
    }
  };

  const handleGoogleOAuth = async () => {
    try {
      setOauthLoading(true);
      const res = await api.getOAuthUrl();
      if (res?.url) {
        setOauthUrl(res.url);
        const popup = window.open(res.url, '_blank', 'width=600,height=700,noopener,noreferrer');
        if (popup) {
          const timer = setInterval(() => {
            if (popup.closed) {
              clearInterval(timer);
              setShowAddModal(false);
              onReload();
            }
          }, 1000);
        }
      }
    } catch (err: any) {
      toast.error(t('accounts.oauthError', { message: err.message }));
    } finally {
      setOauthLoading(false);
    }
  };

  // --- Claude OAuth PKCE Handlers ---
  const handleStartClaudeOAuth = async () => {
    try {
      setSubmitting(true);
      const res = await api.initClaudeOAuth();
      setClaudeOAuthData(res);
      window.open(res.authUrl, '_blank', 'width=600,height=700,noopener,noreferrer');
    } catch (err: any) {
      toast.error(t('accounts.claudeOAuthInitFailed', { message: err.message }));
    } finally {
      setSubmitting(false);
    }
  };

  const handleExchangeClaudeOAuth = async () => {
    if (!claudeAuthCode.trim() || !claudeOAuthData) {
      toast.warning(t('accounts.claudePasteCodeRequired'));
      return;
    }

    let code = claudeAuthCode.trim();
    if (code.includes('code=')) {
      try {
        const u = new URL(code);
        code = u.searchParams.get('code') || code;
      } catch {
        const m = code.match(/code=([^&]+)/);
        if (m) code = m[1];
      }
    }

    try {
      setSubmitting(true);
      await api.exchangeClaudeOAuth({
        code,
        codeVerifier: claudeOAuthData.codeVerifier,
        redirectUri: claudeOAuthData.redirectUri,
        state: claudeOAuthData.state,
        email: email.trim() || undefined,
      });
      setShowAddModal(false);
      resetForms();
      onReload();
    } catch (err: any) {
      toast.error(t('accounts.claudeExchangeFailed', { message: err.message }));
    } finally {
      setSubmitting(false);
    }
  };

  // --- OpenAI OAuth PKCE Handlers ---
  const handleStartOpenAIOAuth = async () => {
    try {
      setSubmitting(true);
      const res = await api.initOpenAIOAuth();
      setOpenaiOAuthData(res);
      window.open(res.authUrl, '_blank', 'width=600,height=700,noopener,noreferrer');
    } catch (err: any) {
      toast.error(t('accounts.openaiOAuthInitFailed', { message: err.message }));
    } finally {
      setSubmitting(false);
    }
  };

  const handleExchangeOpenAIOAuth = async () => {
    if (!openaiAuthCode.trim() || !openaiOAuthData) {
      toast.warning(t('accounts.openaiPasteCodeRequired'));
      return;
    }

    let code = openaiAuthCode.trim();
    if (code.includes('code=')) {
      try {
        const u = new URL(code);
        code = u.searchParams.get('code') || code;
      } catch {
        const m = code.match(/code=([^&]+)/);
        if (m) code = m[1];
      }
    }

    try {
      setSubmitting(true);
      await api.exchangeOpenAIOAuth({
        code,
        codeVerifier: openaiOAuthData.codeVerifier,
        redirectUri: openaiOAuthData.redirectUri,
        email: email.trim() || undefined,
      });
      setShowAddModal(false);
      resetForms();
      onReload();
    } catch (err: any) {
      toast.error(t('accounts.openaiExchangeFailed', { message: err.message }));
    } finally {
      setSubmitting(false);
    }
  };

  // --- Copilot Device Flow Handlers ---
  const handleStartCopilotDevice = async () => {
    try {
      setSubmitting(true);
      const res = await api.startCopilotDeviceFlow();
      setCopilotDevice(res);

      // Start Polling (respect GitHub's recommended interval; start slightly slower to avoid rate-limit)
      let intervalSec = Math.max(5, res.interval || 5);
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);

      const scheduleNextPoll = () => {
        if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        pollTimerRef.current = setTimeout(async () => {
          try {
            const pollRes = await api.pollCopilotDeviceCode({
              device_code: res.device_code,
              email: email.trim() || undefined,
            });

            if (pollRes.status === 'success') {
              if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
              setShowAddModal(false);
              resetForms();
              onReload();
            } else if (pollRes.status === 'error') {
              if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
              toast.error(t('accounts.copilotPollError', { message: pollRes.message || '' }));
            } else if (pollRes.status === 'slow_down') {
              // Increase interval to respect GitHub's rate-limit guidance
              intervalSec = pollRes.retryIntervalSeconds || intervalSec + 5;
              scheduleNextPoll();
            } else {
              // pending
              scheduleNextPoll();
            }
          } catch {
            // network hiccup: retry with the same (or slightly larger) interval
            intervalSec = Math.min(intervalSec + 5, 30);
            scheduleNextPoll();
          }
        }, intervalSec * 1000);
      };

      scheduleNextPoll();
    } catch (err: any) {
      toast.error(t('accounts.copilotStartFailed', { message: err.message }));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyCode = () => {
    if (copilotDevice?.user_code) {
      navigator.clipboard.writeText(copilotDevice.user_code);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    }
  };

  // --- Save Handler for Manual / JSON inputs ---
  const handleSaveAccount = async () => {
    if (!email.trim() && selectedProvider !== 'anthropic') {
      toast.warning(t('accounts.emailRequired'));
      return;
    }

    try {
      setSubmitting(true);

      if (selectedProvider === 'anthropic') {
        if (anthropicMode === 'json') {
          if (!rawJson.trim()) {
            toast.warning(t('accounts.jsonRequired'));
            return;
          }
          let parsed: any;
          try {
            parsed = JSON.parse(rawJson);
          } catch {
            toast.warning(t('accounts.jsonInvalid'));
            return;
          }

          const oauthObj = parsed.claudeAiOauth || parsed.claude_oauth || parsed;
          if (!oauthObj.accessToken && !oauthObj.access_token) {
            toast.warning(t('accounts.jsonTokenRequired'));
            return;
          }

          await api.addAccount({
            provider: 'anthropic',
            auth_type: 'cli_oauth',
            email: email.trim() || `claude-${Date.now()}@antigravity.proxy`,
            claudeAiOauth: {
              accessToken: oauthObj.accessToken || oauthObj.access_token,
              refreshToken: oauthObj.refreshToken || oauthObj.refresh_token,
              expiresAt: oauthObj.expiresAt || oauthObj.expires_at,
              refreshTokenExpiresAt: oauthObj.refreshTokenExpiresAt || oauthObj.refresh_token_expires_at,
              scopes: oauthObj.scopes,
              subscriptionType: oauthObj.subscriptionType || 'pro',
              rateLimitTier: oauthObj.rateLimitTier,
            },
          });
        } else if (anthropicMode === 'api_key') {
          if (!apiKey.trim()) {
            toast.warning(t('accounts.apiKeyRequired'));
            return;
          }
          await api.addAccount({
            provider: 'anthropic',
            auth_type: 'api_key',
            email: email.trim(),
            api_key: apiKey.trim(),
          });
        } else if (anthropicMode === 'web_session') {
          if (!sessionKey.trim()) {
            toast.warning(t('accounts.sessionKeyRequired'));
            return;
          }
          await api.addAccount({
            provider: 'anthropic',
            auth_type: 'web_session',
            email: email.trim(),
            session_key: sessionKey.trim(),
          });
        }
      } else if (selectedProvider === 'copilot') {
        if (!githubToken.trim()) {
          toast.warning(t('accounts.githubTokenRequired'));
          return;
        }
        await api.addAccount({
          provider: 'copilot',
          auth_type: 'copilot_token',
          email: email.trim(),
          github_token: githubToken.trim(),
        });
      } else if (selectedProvider === 'openai') {
        if (openaiMode === 'json') {
          if (!rawJson.trim()) {
            toast.warning(t('accounts.jsonRequired'));
            return;
          }
          let parsed: any;
          try {
            parsed = JSON.parse(rawJson);
          } catch {
            toast.warning(t('accounts.jsonInvalid'));
            return;
          }

          const tokensObj = parsed.tokens || parsed.openai_oauth || parsed;
          if (!tokensObj.access_token && !tokensObj.accessToken) {
            toast.warning(t('accounts.jsonTokenRequired'));
            return;
          }

          await api.addAccount({
            provider: 'openai',
            auth_type: 'cli_oauth',
            email: email.trim() || undefined,
            tokens: {
              access_token: tokensObj.access_token || tokensObj.accessToken,
              refresh_token: tokensObj.refresh_token || tokensObj.refreshToken,
              id_token: tokensObj.id_token || tokensObj.idToken,
              account_id: tokensObj.account_id || tokensObj.accountId,
            },
          });
        } else if (openaiMode === 'key') {
          if (!apiKey.trim()) {
            toast.warning(t('accounts.apiKeyRequired'));
            return;
          }
          await api.addAccount({
            provider: 'openai',
            auth_type: 'api_key',
            email: email.trim(),
            api_key: apiKey.trim(),
          });
        }
      }

      setShowAddModal(false);
      resetForms();
      onReload();
      toast.success(t('common.done'));
    } catch (err: any) {
      toast.error(t('accounts.saveAccountFailed', { message: err.message }));
    } finally {
      setSubmitting(false);
    }
  };

  const resetForms = () => {
    setEmail('');
    setApiKey('');
    setSessionKey('');
    setGithubToken('');
    setRawJson('');
    setClaudeOAuthData(null);
    setClaudeAuthCode('');
    setOpenaiOAuthData(null);
    setOpenaiAuthCode('');
    setCopilotDevice(null);
    setCopiedCode(false);
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
  };

  const getProviderBadge = (provider: string, authType?: string) => {
    const p = (provider || 'google').toLowerCase();
    if (p === 'anthropic') {
      const typeLabel =
        authType === 'cli_oauth'
          ? 'Claude Code OAuth'
          : authType === 'web_session'
            ? 'Web Session'
            : 'API Key';
      return (
        <span className="text-[11px] px-2 py-0.5 rounded font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
          Anthropic ({typeLabel})
        </span>
      );
    }
    if (p === 'copilot') {
      return (
        <span className="text-[11px] px-2 py-0.5 rounded font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          GitHub Copilot
        </span>
      );
    }
    if (p === 'openai') {
      const typeLabel =
        authType === 'cli_oauth'
          ? 'Codex OAuth'
          : 'API Key';
      return (
        <span className="text-[11px] px-2 py-0.5 rounded font-medium bg-green-500/10 text-green-400 border border-green-500/20">
          OpenAI ({typeLabel})
        </span>
      );
    }
    return (
      <span className="text-[11px] px-2 py-0.5 rounded font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
        Google Antigravity
      </span>
    );
  };

  const providerOptions = Array.from(
    new Set(accounts.map((account) => account.provider).filter(Boolean)),
  ).sort();
  const normalizedSearch = search.trim().toLowerCase();
  const filteredAccounts = accounts.filter((account) => {
    if (providerFilter !== 'all' && account.provider !== providerFilter) {
      return false;
    }

    const isDisabled = account.is_active === false;
    if (statusFilter === 'active' && isDisabled) return false;
    if (statusFilter === 'disabled' && !isDisabled) return false;

    if (!normalizedSearch) return true;
    return [account.email, account.name ?? '', account.id].some((value) =>
      value.toLowerCase().includes(normalizedSearch),
    );
  });

  return (
    <div className="space-y-6">
      {/* Header controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-zinc-100 flex items-center gap-2">
            <Users className="w-5 h-5 text-emerald-400" />
            {t('accounts.titleWithCount', { count: accounts.length })}
          </h2>
          <p className="text-xs text-zinc-400">
            {t('accounts.description')}
          </p>
        </div>

        <button
          onClick={() => {
            resetForms();
            setShowAddModal(true);
          }}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-zinc-950 rounded-xl font-semibold text-sm transition-all shadow-lg shadow-emerald-500/20"
        >
          <Plus className="w-4 h-4" />
          <span>{t('accounts.addAccountBtn')}</span>
        </button>
      </div>

      {/* Search and filters */}
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2">
        <input
          type="search"
          data-testid="accounts-search"
          aria-label={t('accounts.searchPlaceholder')}
          placeholder={t('accounts.searchPlaceholder')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="w-full px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500/60"
        />
        <select
          data-testid="accounts-provider-filter"
          aria-label={t('accounts.filterProvider')}
          value={providerFilter}
          onChange={(event) => setProviderFilter(event.target.value)}
          className="px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500/60"
        >
          <option value="all">{t('accounts.allProviders')}</option>
          {providerOptions.map((provider) => (
            <option key={provider} value={provider}>
              {provider}
            </option>
          ))}
        </select>
        <select
          data-testid="accounts-status-filter"
          aria-label={t('accounts.filterStatus')}
          value={statusFilter}
          onChange={(event) =>
            setStatusFilter(event.target.value as 'all' | 'active' | 'disabled')
          }
          className="px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500/60"
        >
          <option value="all">{t('accounts.allStatuses')}</option>
          <option value="active">{t('common.active')}</option>
          <option value="disabled">{t('common.disabled')}</option>
        </select>
      </div>

      {oauthUrl && (
        <div className="p-4 rounded-xl bg-zinc-900 border border-emerald-500/30 text-xs text-zinc-300 flex items-center justify-between">
          <div className="space-y-1">
            <p className="font-semibold text-emerald-400">{t('accounts.oauthOpenedTitle')}</p>
            <p className="text-zinc-400">{t('accounts.oauthBlockedHint')}</p>
            <a href={oauthUrl} target="_blank" rel="noreferrer" className="text-teal-400 underline break-all font-mono">
              {oauthUrl}
            </a>
          </div>
          <button
            onClick={() => setOauthUrl(null)}
            className="px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
          >
            {t('common.close')}
          </button>
        </div>
      )}

      {/* Account Cards */}
      {accounts.length === 0 ? (
        <div className="p-12 text-center rounded-2xl border border-zinc-800 bg-zinc-900/30">
          <AlertCircle className="w-10 h-10 text-zinc-500 mx-auto mb-3" />
          <p className="text-sm text-zinc-300 font-medium">{t('accounts.noAccountsYet')}</p>
          <p className="text-xs text-zinc-500 mt-1 max-w-sm mx-auto">
            {t('accounts.noAccountsSubhint')}
          </p>
        </div>
      ) : filteredAccounts.length === 0 ? (
        <div className="p-12 text-center rounded-2xl border border-zinc-800 bg-zinc-900/30">
          <AlertCircle className="w-10 h-10 text-zinc-500 mx-auto mb-3" />
          <p className="text-sm text-zinc-300 font-medium">
            {t('accounts.noMatches')}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filteredAccounts.map((account) => {
            const models = account.quota?.models || {};
            const modelKeys = Object.keys(models);
            const isDisabled = account.is_active === false;

            return (
              <div
                key={account.id}
                data-testid="account-row"
                data-account-id={account.id}
                className="p-5 rounded-2xl bg-zinc-900/60 border border-zinc-800 hover:border-zinc-700/80 transition-all space-y-4"
              >
                {/* Account Header */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-zinc-800/80">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-zinc-800 flex items-center justify-center font-bold text-zinc-200">
                      {account.email.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-base text-zinc-100">{account.email}</span>
                        <span
                          data-testid="account-name"
                          className="text-xs px-2 py-0.5 rounded bg-zinc-800/80 text-zinc-300"
                        >
                          {account.name || account.email}
                        </span>
                        <span className="text-xs font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">
                          {account.id}
                        </span>
                        {getProviderBadge(account.provider, account.auth_type)}
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-xs text-zinc-400">
                        {account.project_id && (
                          <>
                            <span>
                              {t('accounts.projectLabel')}{' '}
                              <code className="text-zinc-300 font-mono">{account.project_id}</code>
                            </span>
                            <span>•</span>
                          </>
                        )}
                        <span>
                          {t('accounts.tierLabel')}{' '}
                          <span className="text-emerald-400 font-medium">
                            {account.quota?.subscription_tier || 'Standard'}
                          </span>
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 w-full sm:w-auto justify-end flex-wrap">
                    {isDisabled ? (
                      <span
                        data-testid="account-disabled-badge"
                        className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/20 font-medium"
                      >
                        <ShieldAlert className="w-3.5 h-3.5" />
                        {t('common.disabled')}
                      </span>
                    ) : account.is_cooldown ? (
                      <span className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20 font-medium">
                        <ShieldAlert className="w-3.5 h-3.5" />
                        {t('accounts.cooldownRemaining', { seconds: account.cooldown_remaining_sec ?? 0 })}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {t('common.active')}
                      </span>
                    )}

                    {editingId === account.id ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          data-testid="account-name-input"
                          aria-label={t('accounts.nameLabel')}
                          value={editingName}
                          onChange={(event) => setEditingName(event.target.value)}
                          className="w-40 px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-700 text-xs text-zinc-100 focus:outline-none focus:border-emerald-500/60"
                        />
                        <button
                          type="button"
                          data-testid="account-save-name"
                          onClick={() => handleSaveName(account.id)}
                          disabled={savingNameId === account.id}
                          className="p-2 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 transition-all text-xs flex items-center gap-1.5 disabled:opacity-50"
                          title={t('accounts.saveName')}
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">{t('accounts.saveName')}</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleCancelEditName}
                          className="px-2 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-zinc-200"
                          title={t('common.cancel')}
                        >
                          {t('common.cancel')}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        data-testid="account-edit-name"
                        onClick={() => handleStartEditName(account)}
                        className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-all text-xs flex items-center gap-1.5"
                        title={t('accounts.editName')}
                        aria-label={t('accounts.editName')}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    )}

                    <button
                      type="button"
                      data-testid="account-toggle-active"
                      onClick={() => handleToggleActive(account)}
                      disabled={togglingId === account.id}
                      className={`p-2 rounded-lg border transition-all text-xs flex items-center gap-1.5 disabled:opacity-50 ${
                        isDisabled
                          ? 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border-emerald-500/20'
                          : 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border-amber-500/20'
                      }`}
                      title={t(isDisabled ? 'accounts.enable' : 'accounts.disable')}
                      aria-label={t(isDisabled ? 'accounts.enable' : 'accounts.disable')}
                    >
                      {isDisabled ? (
                        <Power className="w-3.5 h-3.5" />
                      ) : (
                        <PowerOff className="w-3.5 h-3.5" />
                      )}
                    </button>

                    {account.provider === 'google' && (
                      <button
                        onClick={() => handleSyncAccount(account.id)}
                        disabled={syncingId === account.id}
                        className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-all text-xs font-medium flex items-center gap-1.5 disabled:opacity-50"
                        title={t('common.syncQuota')}
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${syncingId === account.id ? 'animate-spin text-emerald-400' : ''}`} />
                        <span className="hidden sm:inline">{t('common.sync')}</span>
                      </button>
                    )}

                    <button
                      type="button"
                      data-testid="account-delete"
                      onClick={() => handleDeleteAccount(account.id, account.email)}
                      disabled={deletingId === account.id}
                      className="p-2 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 transition-all text-xs flex items-center gap-1.5"
                      title={t('common.delete')}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">{t('common.delete')}</span>
                    </button>
                  </div>
                </div>

                {/* Quota Section for Google accounts */}
                {modelKeys.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-2">
                      {t('accounts.modelQuotasTitle', { count: modelKeys.length })}
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                      {modelKeys.map((modelKey) => {
                        const info = models[modelKey];
                        const rawPct = info.percentage || 0;
                        const pct = rawPct <= 1 ? Math.round(rawPct * 100) : Math.round(rawPct);
                        const isDepleted = pct <= 0;
                        const isResetting = info.resetTime ? new Date(info.resetTime).getTime() > Date.now() : false;

                        return (
                          <div
                            key={modelKey}
                            className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/80 flex flex-col justify-between"
                          >
                            <div>
                              <div className="flex items-center justify-between gap-1 mb-1">
                                <span className="font-mono text-xs font-bold text-zinc-200 truncate" title={modelKey}>
                                  {info.display_name || modelKey}
                                </span>
                                <span className={`text-xs font-bold ${isDepleted ? 'text-rose-400' : 'text-emerald-400'}`}>
                                  {pct}%
                                </span>
                              </div>
                              <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                                <div
                                  className={`h-full transition-all duration-500 ${
                                    isDepleted ? 'bg-rose-500' : pct < 30 ? 'bg-amber-500' : 'bg-emerald-500'
                                  }`}
                                  style={{ width: `${Math.max(5, pct)}%` }}
                                />
                              </div>
                            </div>

                            {isResetting && info.resetTime && (
                              <div className="mt-2 text-[10px] text-zinc-400 flex items-center gap-1">
                                <Clock className="w-3 h-3 text-amber-400" />
                                <span>{formatResetCountdown(info.resetTime, t('accounts.resettingNow'), t('accounts.resetCountdown'))}</span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add Account Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-lg p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <h3 className="text-base font-bold text-zinc-100 flex items-center gap-2">
                <Plus className="w-5 h-5 text-emerald-400" />
                {t('accounts.addAccount.title')}
              </h3>
              <button
                onClick={() => {
                  resetForms();
                  setShowAddModal(false);
                }}
                className="text-zinc-400 hover:text-zinc-200 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            {/* Provider Tabs */}
            <div className="grid grid-cols-4 gap-1.5 p-1 bg-zinc-950 rounded-xl border border-zinc-800">
              <button
                type="button"
                onClick={() => setSelectedProvider('google')}
                className={`py-2 rounded-lg text-xs font-bold transition-all ${
                  selectedProvider === 'google'
                    ? 'bg-blue-500 text-zinc-950 shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {t('accounts.addAccount.googleTab')}
              </button>
              <button
                type="button"
                onClick={() => setSelectedProvider('anthropic')}
                className={`py-2 rounded-lg text-xs font-bold transition-all ${
                  selectedProvider === 'anthropic'
                    ? 'bg-amber-500 text-zinc-950 shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {t('accounts.addAccount.claudeTab')}
              </button>
              <button
                type="button"
                onClick={() => setSelectedProvider('copilot')}
                className={`py-2 rounded-lg text-xs font-bold transition-all ${
                  selectedProvider === 'copilot'
                    ? 'bg-emerald-500 text-zinc-950 shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {t('accounts.addAccount.copilotTab')}
              </button>
              <button
                type="button"
                onClick={() => setSelectedProvider('openai')}
                className={`py-2 rounded-lg text-xs font-bold transition-all ${
                  selectedProvider === 'openai'
                    ? 'bg-green-500 text-zinc-950 shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {t('accounts.addAccount.openaiTab')}
              </button>
            </div>

            {/* Content per Provider */}
            {selectedProvider === 'google' && (
              <div className="space-y-4 py-2">
                <p className="text-xs text-zinc-400">
                  {t('accounts.addAccount.google.desc')}
                </p>
                <button
                  type="button"
                  onClick={handleGoogleOAuth}
                  disabled={oauthLoading}
                  className="w-full py-3 rounded-xl bg-blue-500 hover:bg-blue-600 text-zinc-950 font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2"
                >
                  <ExternalLink className="w-4 h-4" />
                  {oauthLoading ? t('accounts.addAccount.google.opening') : t('accounts.addAccount.google.openLogin')}
                </button>
              </div>
            )}

            {/* ANTHROPIC CLAUDE */}
            {selectedProvider === 'anthropic' && (
              <div className="space-y-4">
                {/* Mode Selector */}
                <div className="flex flex-wrap gap-2 text-xs border-b border-zinc-800 pb-3">
                  <button
                    type="button"
                    onClick={() => setAnthropicMode('json')}
                    className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                      anthropicMode === 'json' ? 'bg-amber-500 text-zinc-950 font-bold' : 'bg-zinc-800 text-zinc-400'
                    }`}
                  >
                    {t('accounts.addAccount.anthropic.modeJson')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAnthropicMode('oauth')}
                    className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                      anthropicMode === 'oauth' ? 'bg-amber-500 text-zinc-950 font-bold' : 'bg-zinc-800 text-zinc-400'
                    }`}
                  >
                    {t('accounts.addAccount.anthropic.modeOauth')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAnthropicMode('api_key')}
                    className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                      anthropicMode === 'api_key' ? 'bg-amber-500 text-zinc-950 font-bold' : 'bg-zinc-800 text-zinc-400'
                    }`}
                  >
                    {t('accounts.addAccount.anthropic.modeApiKey')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAnthropicMode('web_session')}
                    className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                      anthropicMode === 'web_session' ? 'bg-amber-500 text-zinc-950 font-bold' : 'bg-zinc-800 text-zinc-400'
                    }`}
                  >
                    {t('accounts.addAccount.anthropic.modeWebSession')}
                  </button>
                </div>

                {/* Sub-mode: JSON Paste */}
                {anthropicMode === 'json' && (
                  <div className="space-y-3">
                    <p className="text-xs text-zinc-400"
                      dangerouslySetInnerHTML={{ __html: t('accounts.addAccount.anthropic.jsonDesc') }}
                    />
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1">
                        {t('accounts.addAccount.anthropic.emailLabelOptional')}
                      </label>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="user@example.com"
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-amber-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1">
                        {t('accounts.addAccount.anthropic.jsonContentLabel')}
                      </label>
                      <textarea
                        value={rawJson}
                        onChange={(e) => setRawJson(e.target.value)}
                        rows={6}
                        placeholder={`{\n  "claudeAiOauth": {\n    "accessToken": "sk-ant-oat01-...",\n    "refreshToken": "sk-ant-ort01-...",\n    "expiresAt": 1790675906830\n  }\n}`}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-xs font-mono text-zinc-200 focus:outline-none focus:border-amber-500"
                      />
                    </div>
                  </div>
                )}

                {/* Sub-mode: 1-Click Claude OAuth PKCE */}
                {anthropicMode === 'oauth' && (
                  <div className="space-y-3">
                    <p className="text-xs text-zinc-400">
                      {t('accounts.addAccount.anthropic.oauthDesc')}
                    </p>
                    {!claudeOAuthData ? (
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={handleStartClaudeOAuth}
                        className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-zinc-950 font-bold text-xs shadow-md transition-all flex items-center justify-center gap-2"
                      >
                        <ExternalLink className="w-4 h-4" />
                        {t('accounts.addAccount.anthropic.openLogin')}
                      </button>
                    ) : (
                      <div className="space-y-3 p-3 bg-zinc-950 rounded-xl border border-zinc-800">
                        <p className="text-xs text-emerald-400 font-semibold flex items-center gap-1">
                          <CheckCircle2 className="w-4 h-4" /> {t('accounts.addAccount.anthropic.loginOpened')}
                        </p>
                        <p className="text-[11px] text-zinc-400">
                          {t('accounts.addAccount.anthropic.callbackHint')}
                        </p>
                        <input
                          type="text"
                          value={claudeAuthCode}
                          onChange={(e) => setClaudeAuthCode(e.target.value)}
                          placeholder={t('accounts.addAccount.anthropic.codePlaceholder')}
                          className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs font-mono text-zinc-100 focus:outline-none focus:border-amber-500"
                        />
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={handleExchangeClaudeOAuth}
                          className="w-full py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-zinc-950 font-bold text-xs shadow-md transition-all"
                        >
                          {submitting ? t('accounts.addAccount.anthropic.exchanging') : t('accounts.addAccount.anthropic.completeLogin')}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Sub-mode: API Key */}
                {anthropicMode === 'api_key' && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1">
                        {t('accounts.addAccount.anthropic.emailLabel')}
                      </label>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="user@example.com"
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-amber-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1">
                        {t('accounts.addAccount.anthropic.apiKeyLabel')}
                      </label>
                      <input
                        type="password"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder="sk-ant-api03-..."
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs font-mono text-zinc-100 focus:outline-none focus:border-amber-500"
                      />
                    </div>
                  </div>
                )}

                {/* Sub-mode: Web Session */}
                {anthropicMode === 'web_session' && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1">
                        {t('accounts.addAccount.anthropic.emailLabel')}
                      </label>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="user@example.com"
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-amber-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1">
                        {t('accounts.addAccount.anthropic.sessionKeyLabel')}
                      </label>
                      <input
                        type="password"
                        value={sessionKey}
                        onChange={(e) => setSessionKey(e.target.value)}
                        placeholder="sk-ant-sid01-..."
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs font-mono text-zinc-100 focus:outline-none focus:border-amber-500"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* GITHUB COPILOT */}
            {selectedProvider === 'copilot' && (
              <div className="space-y-4">
                <div className="flex gap-2 text-xs border-b border-zinc-800 pb-3">
                  <button
                    type="button"
                    onClick={() => setCopilotMode('device')}
                    className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                      copilotMode === 'device' ? 'bg-emerald-500 text-zinc-950 font-bold' : 'bg-zinc-800 text-zinc-400'
                    }`}
                  >
                    {t('accounts.addAccount.copilot.modeDevice')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCopilotMode('token')}
                    className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                      copilotMode === 'token' ? 'bg-emerald-500 text-zinc-950 font-bold' : 'bg-zinc-800 text-zinc-400'
                    }`}
                  >
                    {t('accounts.addAccount.copilot.modeToken')}
                  </button>
                </div>

                {copilotMode === 'device' && (
                  <div className="space-y-4">
                    {!copilotDevice ? (
                      <div className="space-y-3">
                        <p className="text-xs text-zinc-400">
                          {t('accounts.addAccount.copilot.deviceDesc')}
                        </p>
                        <div>
                          <label className="block text-xs font-medium text-zinc-400 mb-1">
                            {t('accounts.addAccount.copilot.emailLabelOptional')}
                          </label>
                          <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="copilot@example.com"
                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-emerald-500"
                          />
                        </div>
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={handleStartCopilotDevice}
                          className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-zinc-950 font-bold text-xs shadow-md transition-all flex items-center justify-center gap-2"
                        >
                          <ExternalLink className="w-4 h-4" />
                          {t('accounts.addAccount.copilot.getCode')}
                        </button>
                      </div>
                    ) : (
                      <div className="p-4 rounded-xl bg-zinc-950 border border-emerald-500/40 space-y-4 text-center">
                        <p className="text-xs text-zinc-400">
                          {t('accounts.addAccount.copilot.step1')}
                        </p>
                        <div className="flex items-center justify-center gap-3">
                          <span className="font-mono text-xl font-extrabold text-emerald-400 tracking-widest bg-zinc-900 px-4 py-2 rounded-xl border border-zinc-700">
                            {copilotDevice.user_code}
                          </span>
                          <button
                            type="button"
                            onClick={handleCopyCode}
                            className="p-2.5 bg-zinc-800 hover:bg-zinc-700 rounded-xl text-zinc-200 transition-colors"
                            title={t('common.copy')}
                          >
                            {copiedCode ? <Check className="w-5 h-5 text-emerald-400" /> : <Copy className="w-5 h-5" />}
                          </button>
                        </div>
                        <p className="text-xs text-zinc-400">
                          {t('accounts.addAccount.copilot.step2')}
                        </p>
                        <a
                          href={copilotDevice.verification_uri}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-500 text-zinc-950 font-bold text-xs hover:bg-emerald-600 transition-all"
                        >
                          <ExternalLink className="w-4 h-4" />
                          {t('accounts.addAccount.copilot.open', { uri: copilotDevice.verification_uri })}
                        </a>
                        <div className="pt-2 text-[11px] text-zinc-400 flex items-center justify-center gap-2">
                          <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                          <span>{t('accounts.addAccount.copilot.listening')}</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {copilotMode === 'token' && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1">
                        {t('accounts.addAccount.copilot.emailLabel')}
                      </label>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="copilot@example.com"
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1">
                        {t('accounts.addAccount.copilot.tokenLabel')}
                      </label>
                      <input
                        type="password"
                        value={githubToken}
                        onChange={(e) => setGithubToken(e.target.value)}
                        placeholder="ghu_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs font-mono text-zinc-100 focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* OPENAI */}
            {selectedProvider === 'openai' && (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-1 p-1 bg-zinc-950 rounded-lg border border-zinc-800 text-xs">
                  <button
                    type="button"
                    onClick={() => setOpenaiMode('json')}
                    className={`py-1.5 rounded-md font-medium transition-colors ${
                      openaiMode === 'json'
                        ? 'bg-zinc-800 text-green-400 shadow-sm'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {t('accounts.addAccount.openai.modeJson')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpenaiMode('oauth')}
                    className={`py-1.5 rounded-md font-medium transition-colors ${
                      openaiMode === 'oauth'
                        ? 'bg-zinc-800 text-green-400 shadow-sm'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {t('accounts.addAccount.openai.modeOauth')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpenaiMode('key')}
                    className={`py-1.5 rounded-md font-medium transition-colors ${
                      openaiMode === 'key'
                        ? 'bg-zinc-800 text-green-400 shadow-sm'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {t('accounts.addAccount.openai.modeKey')}
                  </button>
                </div>

                {openaiMode === 'json' && (
                  <div className="space-y-3">
                    <p className="text-[11px] text-zinc-400"
                      dangerouslySetInnerHTML={{ __html: t('accounts.addAccount.openai.jsonDesc') }}
                    />
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1">
                        {t('accounts.addAccount.openai.emailLabelOptional')}
                      </label>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder={t('accounts.addAccount.openai.emailPlaceholder')}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-green-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1">
                        {t('accounts.addAccount.openai.jsonContentLabel')}
                      </label>
                      <textarea
                        value={rawJson}
                        onChange={(e) => setRawJson(e.target.value)}
                        placeholder={`{\n  "auth_mode": "chatgpt",\n  "tokens": {\n    "access_token": "...",\n    "refresh_token": "...",\n    "account_id": "..."\n  }\n}`}
                        rows={6}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs font-mono text-zinc-100 focus:outline-none focus:border-green-500 resize-none"
                      />
                    </div>
                  </div>
                )}

                {openaiMode === 'oauth' && (
                  <div className="space-y-4">
                    <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-lg space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-zinc-300">{t('accounts.addAccount.openai.step1')}</span>
                        <button
                          type="button"
                          onClick={handleStartOpenAIOAuth}
                          disabled={submitting}
                          className="px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          {t('accounts.addAccount.openai.openLogin')}
                        </button>
                      </div>
                      <p className="text-[11px] text-zinc-500">
                        {t('accounts.addAccount.openai.oauthDesc')}
                      </p>
                    </div>

                    {openaiOAuthData && (
                      <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-lg space-y-3">
                        <span className="text-xs font-medium text-zinc-300">{t('accounts.addAccount.openai.step2')}</span>
                        <div>
                          <input
                            type="text"
                            value={openaiAuthCode}
                            onChange={(e) => setOpenaiAuthCode(e.target.value)}
                            placeholder={t('accounts.addAccount.openai.codePlaceholder')}
                            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs font-mono text-zinc-100 focus:outline-none focus:border-green-500"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={handleExchangeOpenAIOAuth}
                          disabled={submitting || !openaiAuthCode.trim()}
                          className="w-full py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition-colors"
                        >
                          {submitting ? t('accounts.addAccount.openai.completing') : t('accounts.addAccount.openai.confirmSave')}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {openaiMode === 'key' && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1">
                        {t('accounts.addAccount.openai.emailLabel')}
                      </label>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="openai@example.com"
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-green-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1">
                        {t('accounts.addAccount.openai.apiKeyLabel')}
                      </label>
                      <input
                        type="password"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder="sk-proj-xxxxxxxxxxxxxxxxxxxxxxxx"
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs font-mono text-zinc-100 focus:outline-none focus:border-green-500"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Action buttons (only for manual save forms) */}
            {selectedProvider !== 'google' && !(selectedProvider === 'anthropic' && anthropicMode === 'oauth') && !(selectedProvider === 'copilot' && copilotMode === 'device' && copilotDevice) && !(selectedProvider === 'openai' && openaiMode === 'oauth') && (
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => {
                    resetForms();
                    setShowAddModal(false);
                  }}
                  className="px-3.5 py-2 text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                  {t('accounts.addAccount.cancel')}
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleSaveAccount}
                  className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-zinc-950 text-xs font-bold shadow-md transition-all disabled:opacity-50"
                >
                  {submitting ? t('accounts.addAccount.saving') : t('accounts.addAccount.saveAccount')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

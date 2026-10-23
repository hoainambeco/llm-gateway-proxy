import { useCallback, useEffect, useState } from 'react';
import { api, AUTH_UNAUTHORIZED_EVENT } from './api/client';
import { clearAdminKey, getAdminKey, setAdminKey } from './api/keyStorage';
import { Header } from './components/Header';
import { Sidebar, type TabType } from './components/Sidebar';
import { useToast } from './components/Toast';
import { useTranslation } from './i18n';
import type {
  Account,
  ApiKeyItem,
  ModelEntry,
  SystemStatus,
} from './types';
import { AccountsView } from './views/AccountsView';
import { AgentSetupView, type ModelSpecEntry } from './views/AgentSetupView';
import { ApiKeysView } from './views/ApiKeysView';
import { AnalyticsView } from './views/AnalyticsView';
import { AuditLogsView } from './views/AuditLogsView';
import { DashboardView } from './views/DashboardView';
import { LoginView } from './views/LoginView';
import { ModelsView } from './views/ModelsView';
import { RoutingView } from './views/RoutingView';

type AuthState = 'checking' | 'anon' | 'authed';

export function App() {
  const { t } = useTranslation();
  const toast = useToast();
  const [authState, setAuthState] = useState<AuthState>(() =>
    getAdminKey() ? 'checking' : 'anon',
  );
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [modelSpecs, setModelSpecs] = useState<ModelSpecEntry[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKeyItem[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const [statusRes, accountsRes, modelsRes, apiKeysRes, specsRes] =
        await Promise.allSettled([
          api.getSystemStatus(),
          api.getAccounts(),
          api.getModels(),
          api.getApiKeys(),
          api.getModelSpecs(),
        ]);

      if (statusRes.status === 'fulfilled') setStatus(statusRes.value);
      if (accountsRes.status === 'fulfilled') setAccounts(accountsRes.value);
      if (modelsRes.status === 'fulfilled') setModels(modelsRes.value);
      if (specsRes.status === 'fulfilled') setModelSpecs(specsRes.value);
      if (apiKeysRes.status === 'fulfilled') setApiKeys(apiKeysRes.value);
    } catch (err) {
      console.error('Error loading data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Revalidate a key restored from sessionStorage before showing the dashboard.
  useEffect(() => {
    if (authState !== 'checking') return;

    let cancelled = false;
    const storedKey = getAdminKey();
    if (!storedKey) {
      // oxlint-disable-next-line react/set-state-in-effect
      setAuthState('anon');
      return;
    }

    void (async () => {
      try {
        const res = await api.validateKey(storedKey);
        if (cancelled) return;
        if (res.valid && res.role === 'admin') {
          setAuthState('authed');
        } else {
          clearAdminKey();
          setAuthState('anon');
        }
      } catch {
        if (cancelled) return;
        clearAdminKey();
        setAuthState('anon');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authState]);

  // Any 401 from the API means the stored key is no longer usable.
  useEffect(() => {
    const handleUnauthorized = () => {
      clearAdminKey();
      setAuthState('anon');
    };
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized);
    return () =>
      window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized);
  }, []);

  // Only the authenticated dashboard may talk to the backend.
  useEffect(() => {
    if (authState !== 'authed') return;

    // oxlint-disable-next-line react/set-state-in-effect
    void loadData();
    const interval = setInterval(() => {
      void loadData();
    }, 10000); // Polling every 10 seconds
    return () => clearInterval(interval);
  }, [authState, loadData]);

  const handleLogout = useCallback(() => {
    clearAdminKey();
    setActiveTab('dashboard');
    setAuthState('anon');
  }, []);

  const handleAuthed = useCallback((key: string) => {
    setAdminKey(key);
    setAuthState('authed');
  }, []);

  const handleSyncAll = async () => {
    try {
      setIsSyncing(true);
      await api.syncAccounts();
      await loadData();
    } catch (err: any) {
      toast.error(t('accounts.syncFailed', { message: err.message }));
    } finally {
      setIsSyncing(false);
    }
  };

  const titles: Record<TabType, { title: string; subtitle: string }> = {
    dashboard: {
      title: t('tabs.dashboard.title'),
      subtitle: t('tabs.dashboard.subtitle'),
    },
    accounts: {
      title: t('tabs.accounts.title'),
      subtitle: t('tabs.accounts.subtitle'),
    },
    routing: {
      title: t('tabs.routing.title'),
      subtitle: t('tabs.routing.subtitle'),
    },
    models: {
      title: t('tabs.models.title'),
      subtitle: t('tabs.models.subtitle'),
    },
    'agent-setup': {
      title: t('tabs.agentSetup.title'),
      subtitle: t('tabs.agentSetup.subtitle'),
    },
    'api-keys': {
      title: t('tabs.apiKeys.title'),
      subtitle: t('tabs.apiKeys.subtitle'),
    },
    analytics: {
      title: t('tabs.analytics.title'),
      subtitle: t('tabs.analytics.subtitle'),
    },
    audit: {
      title: t('tabs.audit.title'),
      subtitle: t('tabs.audit.subtitle'),
    },
  };

  if (authState === 'checking') {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans flex items-center justify-center">
        <div className="flex items-center text-zinc-500 text-sm">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-emerald-500 mr-3" />
          <span>{t('login.checking')}</span>
        </div>
      </div>
    );
  }

  if (authState === 'anon') {
    return <LoginView onAuthed={handleAuthed} />;
  }

  return (
    <div className="flex min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-emerald-500/30 selection:text-emerald-300">
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        statusPort={status?.port ?? 8044}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <Header
          title={titles[activeTab].title}
          subtitle={titles[activeTab].subtitle}
          onRefresh={handleSyncAll}
          isRefreshing={isSyncing}
          onLogout={handleLogout}
        />

        <main className="flex-1 p-6 md:p-8 max-w-7xl w-full mx-auto overflow-y-auto">
          {loading && !status ? (
            <div className="flex items-center justify-center h-64 text-zinc-500 text-sm">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-emerald-500 mr-3" />
              <span>{t('common.loadingGateway')}</span>
            </div>
          ) : (
            <>
              {activeTab === 'dashboard' && (
                <DashboardView
                  status={status}
                  accounts={accounts}
                  onNavigate={setActiveTab}
                  onSyncAll={handleSyncAll}
                  isSyncing={isSyncing}
                />
              )}
              {activeTab === 'accounts' && (
                <AccountsView accounts={accounts} onReload={loadData} />
              )}
              {activeTab === 'routing' && <RoutingView />}
              {activeTab === 'models' && (
                <ModelsView models={models} proxyPort={status?.port} />
              )}
              {activeTab === 'agent-setup' && (
                <AgentSetupView
                  models={models}
                  modelSpecs={modelSpecs}
                  defaultPort={status?.port ?? 8044}
                />
              )}
              {activeTab === 'api-keys' && (
                <ApiKeysView
                  apiKeys={apiKeys}
                  accounts={accounts}
                  onReload={loadData}
                />
              )}
              {activeTab === 'analytics' && <AnalyticsView />}
              {activeTab === 'audit' && <AuditLogsView />}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;

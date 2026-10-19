import React from 'react';
import {
  LayoutDashboard,
  Users,
  Cpu,
  Key,
  Activity,
  Layers,
  Sparkles,
  Route,
  Plug,
  BarChart3,
} from 'lucide-react';
import { useTranslation } from '../i18n';

export type TabType =
  | 'dashboard'
  | 'accounts'
  | 'routing'
  | 'models'
  | 'agent-setup'
  | 'api-keys'
  | 'analytics'
  | 'audit';

interface SidebarProps {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  statusPort?: number;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab, statusPort = 8044 }) => {
  const { t } = useTranslation();

  const navItems = [
    { id: 'dashboard' as TabType, label: t('navigation.dashboard'), icon: LayoutDashboard },
    { id: 'accounts' as TabType, label: t('navigation.accounts'), icon: Users },
    { id: 'routing' as TabType, label: t('navigation.routing') || 'Routing Rules', icon: Route },
    { id: 'models' as TabType, label: t('navigation.models'), icon: Cpu },
    {
      id: 'agent-setup' as TabType,
      label: t('navigation.agentSetup'),
      icon: Plug,
    },
    { id: 'api-keys' as TabType, label: t('navigation.apiKeys'), icon: Key },
    { id: 'analytics' as TabType, label: t('navigation.analytics'), icon: BarChart3 },
    { id: 'audit' as TabType, label: t('navigation.audit'), icon: Activity },
  ];

  return (
    <aside className="w-64 bg-zinc-950 border-r border-zinc-800 flex flex-col justify-between shrink-0 h-screen sticky top-0">
      <div>
        {/* Brand Logo */}
        <div className="p-6 border-b border-zinc-800/80 flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <Sparkles className="w-5 h-5 text-zinc-950 font-bold" />
          </div>
          <div>
            <h1 className="font-bold text-base text-zinc-100 tracking-tight flex items-center gap-1.5">
              Antigravity <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-mono">UI</span>
            </h1>
            <p className="text-xs text-zinc-400 font-medium">{t('common.brandSubtitle')}</p>
          </div>
        </div>

        {/* Navigation Links */}
        <nav className="p-3 space-y-1.5 mt-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-zinc-800/90 text-emerald-400 shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/80'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-emerald-400' : 'text-zinc-400'}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Footer Info */}
      <div className="p-4 border-t border-zinc-800/80 m-3 rounded-xl bg-zinc-900/40">
        <div className="flex items-center justify-between text-xs text-zinc-400">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            {t('common.gatewayOnline')}
          </span>
          <span className="font-mono text-zinc-300">:{statusPort}</span>
        </div>
        <div className="mt-2 text-[11px] text-zinc-400 flex items-center gap-1 font-mono">
          <Layers className="w-3.5 h-3.5 text-zinc-400" />
          <span>{t('common.versionStandalone')}</span>
        </div>
      </div>
    </aside>
  );
};

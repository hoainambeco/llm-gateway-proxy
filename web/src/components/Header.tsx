import { Globe, LogOut, RefreshCw, ShieldCheck } from 'lucide-react';
import React from 'react';
import { useTranslation } from '../i18n';
import { LanguageSwitcher } from './LanguageSwitcher';

interface HeaderProps {
  title: string;
  subtitle?: string;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  onLogout: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  title,
  subtitle,
  onRefresh,
  isRefreshing = false,
  onLogout,
}) => {
  const { t } = useTranslation();

  return (
    <header className="h-16 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-md px-6 md:px-8 flex items-center justify-between sticky top-0 z-10">
      <div>
        <h2 className="text-lg font-bold text-zinc-100">{title}</h2>
        {subtitle && <p className="text-xs text-zinc-400">{subtitle}</p>}
      </div>

      <div className="flex items-center gap-3">
        <LanguageSwitcher />

        <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-900 border border-zinc-800 text-xs text-zinc-300">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span>{t('common.localSecurityActive')}</span>
        </div>

        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium transition-all disabled:opacity-50"
            title={t('common.syncTooltip')}
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-emerald-400' : ''}`}
            />
            <span>
              {isRefreshing ? t('common.syncing') : t('common.syncQuota')}
            </span>
          </button>
        )}

        <div className="flex items-center gap-1.5 text-xs text-zinc-400 font-mono bg-zinc-900 px-2.5 py-1.5 rounded-lg border border-zinc-800">
          <Globe className="w-3.5 h-3.5 text-teal-400" />
          <span>0.0.0.0</span>
        </div>

        <button
          onClick={onLogout}
          data-testid="logout-button"
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-rose-500/20 hover:text-rose-300 text-zinc-200 text-xs font-medium transition-all"
          title={t('common.logout')}
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>{t('common.logout')}</span>
        </button>
      </div>
    </header>
  );
};

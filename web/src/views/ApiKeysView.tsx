import React, { useState } from 'react';
import type { Account, ApiKeyItem } from '../types';
import { api } from '../api/client';
import { Key, Plus, Trash2, Shield, Users } from 'lucide-react';
import { useTranslation } from '../i18n';
import { useToast } from '../components/toast-context';

interface ApiKeysViewProps {
  apiKeys: ApiKeyItem[];
  accounts?: Account[];
  onReload: () => void;
}

export const ApiKeysView: React.FC<ApiKeysViewProps> = ({
  apiKeys,
  accounts = [],
  onReload,
}) => {
  const { t } = useTranslation();
  const toast = useToast();
  const [showModal, setShowModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyRole, setNewKeyRole] = useState<'client' | 'admin'>('client');
  const [useAllAccounts, setUseAllAccounts] = useState(true);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [createdKeyData, setCreatedKeyData] = useState<any>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) return;

    try {
      setCreating(true);
      const allowed = useAllAccounts ? null : selectedAccountIds;
      const res = await api.createApiKey({
        name: newKeyName.trim(),
        role: newKeyRole,
        allowedAccountIds: allowed && allowed.length > 0 ? allowed : null,
      });
      setCreatedKeyData(res.data);
      onReload();
    } catch (err: any) {
      toast.error(t('apiKeys.createFailed', { message: err.message }));
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    const confirmed = await toast.confirm(t('apiKeys.confirmDelete', { name }), {
      title: t('common.confirmDeleteTitle'),
      danger: true,
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
    });
    if (!confirmed) return;

    try {
      await api.deleteApiKey(id);
      onReload();
    } catch (err: any) {
      toast.error(t('apiKeys.deleteFailed', { message: err.message }));
    }
  };

  const handleToggleActive = async (key: ApiKeyItem) => {
    try {
      await api.updateApiKey(key.id, { isActive: !key.isActive });
      onReload();
    } catch (err: any) {
      toast.error(t('apiKeys.updateFailed', { message: err.message }));
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(text);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const closeModal = () => {
    setShowModal(false);
    setCreatedKeyData(null);
    setNewKeyName('');
    setUseAllAccounts(true);
    setSelectedAccountIds([]);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-zinc-100 flex items-center gap-2">
            <Key className="w-5 h-5 text-amber-400" />
            {t('apiKeys.titleWithCount', { count: apiKeys.length })}
          </h2>
          <p className="text-xs text-zinc-400">
            {t('apiKeys.description')}
          </p>
        </div>

        <button
          onClick={() => {
            setUseAllAccounts(true);
            setSelectedAccountIds([]);
            setShowModal(true);
          }}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-zinc-950 rounded-xl font-semibold text-sm transition-all shadow-lg shadow-emerald-500/20"
        >
          <Plus className="w-4 h-4" />
          <span>{t('apiKeys.createBtn')}</span>
        </button>
      </div>

      {/* Keys Table */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 overflow-hidden">
        {apiKeys.length === 0 ? (
          <div className="p-12 text-center text-zinc-500 text-sm">
            {t('apiKeys.noKeysYet')}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-900/80 border-b border-zinc-800 text-zinc-400 font-medium uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-4">{t('apiKeys.table.name')}</th>
                  <th className="py-3 px-4">{t('apiKeys.table.apiKey')}</th>
                  <th className="py-3 px-4">{t('apiKeys.table.role')}</th>
                  <th className="py-3 px-4">{t('apiKeys.table.accounts')}</th>
                  <th className="py-3 px-4">{t('apiKeys.table.status')}</th>
                  <th className="py-3 px-4">{t('apiKeys.table.lastUsed')}</th>
                  <th className="py-3 px-4 text-right">{t('apiKeys.table.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {apiKeys.map((k) => (
                  <tr key={k.id} className="hover:bg-zinc-900/50 transition-colors">
                    <td className="py-3.5 px-4 font-semibold text-zinc-200">{k.name}</td>
                    <td className="py-3.5 px-4 font-mono text-zinc-400">
                      {/* Only a hash of the key is stored, so there is nothing to reveal
                          or copy here -- the full value is shown once, at creation. */}
                      <span title={t('apiKeys.hashedKeyHint')}>{k.key}</span>
                    </td>
                    <td className="py-3.5 px-4">
                      <span
                        className={`px-2 py-0.5 rounded font-mono text-[11px] ${
                          k.role === 'admin'
                            ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                            : 'bg-zinc-800 text-zinc-300'
                        }`}
                      >
                        {k.role}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      {!k.allowedAccountIds || k.allowedAccountIds.length === 0 ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 text-[11px] font-medium">
                          <Users className="w-3 h-3 text-emerald-400" />
                          <span>{t('apiKeys.table.allAccounts')}</span>
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1 max-w-[220px]">
                          {k.allowedAccountIds.map((accId) => {
                            const found = accounts.find((a) => a.id === accId || a.email === accId);
                            const label = found ? found.email : accId;
                            return (
                              <span
                                key={accId}
                                className="px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-300 border border-teal-500/20 text-[10px] font-mono truncate max-w-[150px]"
                                title={label}
                              >
                                {label}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </td>
                    <td className="py-3.5 px-4">
                      <button
                        onClick={() => handleToggleActive(k)}
                        className={`px-2 py-0.5 rounded text-[11px] font-medium transition-all ${
                          k.isActive
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : 'bg-zinc-800 text-zinc-500'
                        }`}
                      >
                        {k.isActive ? t('common.active') : t('common.disabled')}
                      </button>
                    </td>
                    <td className="py-3.5 px-4 text-zinc-400">
                      {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : t('common.never')}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <button
                        onClick={() => handleDelete(k.id, k.name)}
                        className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 transition-all"
                        title={t('apiKeys.deleteKey')}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-zinc-100 flex items-center gap-2">
              <Key className="w-4 h-4 text-emerald-400" />
              {t('apiKeys.modal.title')}
            </h3>

            {createdKeyData ? (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-xs space-y-2">
                  <div className="flex items-center gap-2 text-emerald-400 font-semibold">
                    <Shield className="w-4 h-4" />
                    <span>{t('apiKeys.modal.successTitle')}</span>
                  </div>
                  <p className="text-zinc-300">
                    {t('apiKeys.modal.successWarning')}
                  </p>
                  <div className="flex items-center justify-between gap-2 p-2.5 rounded bg-zinc-950 font-mono text-emerald-300 text-xs break-all">
                    <span>{createdKeyData.key}</span>
                    <button
                      onClick={() => copyToClipboard(createdKeyData.key)}
                      className="p-1.5 rounded bg-emerald-500 text-zinc-950 hover:bg-emerald-400 shrink-0 font-sans font-bold"
                    >
                      {copiedKey === createdKeyData.key ? t('common.copied') : t('common.copy')}
                    </button>
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    onClick={closeModal}
                    className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-xl text-xs font-semibold"
                  >
                    {t('common.done')}
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleCreate} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                    {t('apiKeys.modal.nameLabel')}
                  </label>
                  <input
                    type="text"
                    required
                    placeholder={t('apiKeys.modal.namePlaceholder')}
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2 text-xs text-zinc-200 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                    {t('apiKeys.modal.roleLabel')}
                  </label>
                  <select
                    value={newKeyRole}
                    onChange={(e: any) => setNewKeyRole(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2 text-xs text-zinc-200 focus:outline-none focus:border-emerald-500"
                  >
                    <option value="client">{t('apiKeys.modal.roleClient')}</option>
                    <option value="admin">{t('apiKeys.modal.roleAdmin')}</option>
                  </select>
                </div>

                {/* Account Selection Scope */}
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                    {t('apiKeys.modal.accountsScopeLabel')}
                  </label>
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <button
                      type="button"
                      onClick={() => setUseAllAccounts(true)}
                      className={`p-2.5 rounded-xl border text-xs font-medium text-left transition-all ${
                        useAllAccounts
                          ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400'
                          : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                      }`}
                    >
                      <div className="font-semibold text-zinc-200">
                        {t('apiKeys.modal.allAccountsOption')}
                      </div>
                      <div className="text-[10px] text-zinc-400 mt-0.5">
                        {accounts.length} accounts
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setUseAllAccounts(false);
                        if (selectedAccountIds.length === 0 && accounts.length > 0) {
                          setSelectedAccountIds([accounts[0].id]);
                        }
                      }}
                      className={`p-2.5 rounded-xl border text-xs font-medium text-left transition-all ${
                        !useAllAccounts
                          ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400'
                          : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                      }`}
                    >
                      <div className="font-semibold text-zinc-200">
                        {t('apiKeys.modal.customAccountsOption')}
                      </div>
                      <div className="text-[10px] text-zinc-400 mt-0.5">
                        {selectedAccountIds.length} selected
                      </div>
                    </button>
                  </div>

                  {!useAllAccounts && (
                    <div className="p-2.5 rounded-xl bg-zinc-950 border border-zinc-800 space-y-1.5 max-h-48 overflow-y-auto">
                      <p className="text-[11px] text-zinc-400 mb-1">
                        {t('apiKeys.modal.selectAccountsHint')}
                      </p>
                      {accounts.length === 0 ? (
                        <p className="text-xs text-zinc-500 italic py-2">
                          {t('apiKeys.modal.noAccountsConfigured')}
                        </p>
                      ) : (
                        accounts.map((acc) => {
                          const isChecked = selectedAccountIds.includes(acc.id);
                          return (
                            <label
                              key={acc.id}
                              className={`flex items-center justify-between p-2 rounded-lg border cursor-pointer transition-all ${
                                isChecked
                                  ? 'bg-emerald-950/30 border-emerald-500/30 text-zinc-200'
                                  : 'bg-zinc-900/60 border-zinc-800/80 text-zinc-400 hover:border-zinc-700'
                              }`}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setSelectedAccountIds((prev) => [...prev, acc.id]);
                                    } else {
                                      setSelectedAccountIds((prev) =>
                                        prev.filter((id) => id !== acc.id),
                                      );
                                    }
                                  }}
                                  className="rounded border-zinc-700 text-emerald-500 focus:ring-0 focus:ring-offset-0 bg-zinc-900"
                                />
                                <div className="truncate">
                                  <div className="text-xs font-semibold text-zinc-200 truncate">
                                    {acc.email}
                                  </div>
                                  <div className="text-[10px] font-mono text-zinc-400">
                                    {acc.id} • {acc.quota?.subscription_tier || 'Standard'}
                                  </div>
                                </div>
                              </div>
                              {acc.is_cooldown ? (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 shrink-0">
                                  Cooldown
                                </span>
                              ) : (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 shrink-0">
                                  Active
                                </span>
                              )}
                            </label>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-xs font-medium"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={creating || (!useAllAccounts && selectedAccountIds.length === 0)}
                    className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-zinc-950 rounded-xl text-xs font-semibold disabled:opacity-50"
                  >
                    {creating ? t('apiKeys.modal.submittingBtn') : t('apiKeys.modal.submitBtn')}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

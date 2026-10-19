import React, { useEffect, useState } from 'react';
import { Route, Plus, Trash2, Edit2, Save, RefreshCw, Check, GripVertical } from 'lucide-react';
import type { RoutingConfig, RoutingRule } from '../types';
import { api } from '../api/client';
import { useTranslation } from '../i18n';
import { useToast } from '../components/Toast';
import {
  DragList,
  type DragHandleProps,
} from '../components/DragList';
import { reorderByIndex } from '../lib/reorder';

const ALL_PROVIDERS = [
  { id: 'google', label: 'Google Antigravity', color: 'bg-blue-500/10 text-blue-400 border-blue-500/30' },
  { id: 'anthropic_api', label: 'Claude (API Key)', color: 'bg-amber-500/10 text-amber-400 border-amber-500/30' },
  { id: 'anthropic_oauth', label: 'Claude (CLI OAuth)', color: 'bg-orange-500/10 text-orange-400 border-orange-500/30' },
  { id: 'anthropic_web', label: 'Claude (Web Session)', color: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30' },
  { id: 'copilot', label: 'GitHub Copilot', color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' },
  { id: 'openai_api', label: 'OpenAI (API Key)', color: 'bg-green-500/10 text-green-400 border-green-500/30' },
  { id: 'chatgpt_web', label: 'ChatGPT (Web OAuth)', color: 'bg-teal-500/10 text-teal-400 border-teal-500/30' },
];

const providerMeta = (id: string) =>
  ALL_PROVIDERS.find((item) => item.id === id);

/**
 * The grip that starts a drag and carries the keyboard equivalent. Rendering it
 * here keeps every list in the view behaving the same way.
 */
const DragHandle: React.FC<{ handle: DragHandleProps; label: string }> = ({
  handle,
  label,
}) => (
  <button
    type="button"
    draggable={handle.draggable}
    data-drag-handle={handle.handleIndex}
    onDragStart={handle.onDragStart}
    onDragEnd={handle.onDragEnd}
    onKeyDown={handle.onKeyDown}
    onFocus={handle.onFocus}
    onBlur={handle.onBlur}
    aria-label={label}
    title={label}
    className={`shrink-0 cursor-grab active:cursor-grabbing rounded p-1 text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800 transition-colors focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:text-zinc-200 ${
      handle.focused ? 'text-zinc-300' : ''
    }`}
  >
    <GripVertical className="w-4 h-4" />
  </button>
);

/** A drop-target row's visual state, shared by the rules list and the pipelines. */
const dragRowClass = (handle: DragHandleProps, base: string): string =>
  [
    base,
    handle.isDragging ? 'opacity-40' : '',
    handle.focused ? 'ring-1 ring-inset ring-emerald-500/50' : '',
  ]
    .filter(Boolean)
    .join(' ');

export const RoutingView: React.FC = () => {
  const { t } = useTranslation();
  const toast = useToast();
  const [config, setConfig] = useState<RoutingConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  // Form state
  const [pattern, setPattern] = useState('');
  const [pipeline, setPipeline] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [rawMode, setRawMode] = useState(false);
  const [rawJson, setRawJson] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);

  const fetchConfig = async () => {
    try {
      setLoading(true);
      const data = await api.getRoutingConfig();
      setConfig(data);
      setRawJson(JSON.stringify(data, null, 2));
    } catch (err: any) {
      toast.error(t('routing.loadFailed', { message: err.message }));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  const handleOpenAdd = () => {
    setEditingIndex(null);
    setPattern('');
    setPipeline(['google']);
    setDescription('');
    setShowModal(true);
  };

  const handleOpenEdit = (index: number) => {
    if (!config) return;
    const rule = config.rules[index];
    setEditingIndex(index);
    setPattern(rule.pattern);
    setPipeline([...rule.pipeline]);
    setDescription(rule.description || '');
    setShowModal(true);
  };

  const handleDeleteRule = async (index: number) => {
    if (!config) return;
    const confirmed = await toast.confirm(t('routing.deleteConfirmMessage'), {
      title: t('routing.deleteConfirmTitle'),
      danger: true,
      confirmLabel: t('routing.deleteRule'),
      cancelLabel: t('routing.cancel'),
    });
    if (!confirmed) return;

    const newRules = config.rules.filter((_, idx) => idx !== index);
    const updated = { ...config, rules: newRules };
    await saveNewConfig(updated);
  };

  const handleSaveModal = async () => {
    if (!pattern.trim()) {
      toast.warning(t('routing.patternRequired'));
      return;
    }
    if (pipeline.length === 0) {
      toast.warning(t('routing.pipelineRequired'));
      return;
    }
    if (!config) return;

    const newRule: RoutingRule = {
      pattern: pattern.trim(),
      pipeline,
      description: description.trim(),
    };

    let newRules = [...config.rules];
    if (editingIndex !== null) {
      newRules[editingIndex] = newRule;
    } else {
      newRules.push(newRule);
    }

    const updated = { ...config, rules: newRules };
    await saveNewConfig(updated);
    setShowModal(false);
  };

  /**
   * `rollback` restores the pre-edit config when the write fails. Reordering
   * applies optimistically so the row lands under the cursor; without this a
   * failed drop would leave the list showing an order the server never took.
   */
  const saveNewConfig = async (
    newConfig: RoutingConfig,
    options: { rollback?: RoutingConfig; errorKey?: string } = {},
  ) => {
    try {
      setSaving(true);
      await api.updateRoutingConfig(newConfig);
      setConfig(newConfig);
      setRawJson(JSON.stringify(newConfig, null, 2));
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    } catch (err: any) {
      if (options.rollback) {
        setConfig(options.rollback);
        setRawJson(JSON.stringify(options.rollback, null, 2));
      }
      toast.error(t(options.errorKey ?? 'routing.saveFailed', { message: err.message }));
    } finally {
      setSaving(false);
    }
  };

  /** Apply a reorder to the live config and persist it through the same path. */
  const commitReorder = (
    patch: (current: RoutingConfig) => RoutingConfig,
  ) => {
    if (!config) return;
    const previous = config;
    const updated = patch(previous);
    if (updated === previous) return;
    setConfig(updated);
    setRawJson(JSON.stringify(updated, null, 2));
    void saveNewConfig(updated, {
      rollback: previous,
      errorKey: 'routing.reorderFailed',
    });
  };

  const handleReorderRules = (from: number, to: number) => {
    commitReorder((current) => ({
      ...current,
      rules: reorderByIndex(current.rules, from, to),
    }));
  };

  const handleReorderDefaultPipeline = (from: number, to: number) => {
    commitReorder((current) => ({
      ...current,
      default_pipeline: reorderByIndex(current.default_pipeline, from, to),
    }));
  };

  const handleReorderPipeline = (from: number, to: number) => {
    setPipeline((current) => reorderByIndex(current, from, to));
  };

  const handleSaveRaw = async () => {
    try {
      const parsed = JSON.parse(rawJson);
      await saveNewConfig(parsed);
    } catch (err: any) {
      toast.error(t('routing.invalidJson', { message: err.message }));
    }
  };

  const toggleProviderInPipeline = (providerId: string) => {
    if (pipeline.includes(providerId)) {
      setPipeline(pipeline.filter((p) => p !== providerId));
    } else {
      setPipeline([...pipeline, providerId]);
    }
  };

  const availableProviders = ALL_PROVIDERS.filter(
    (prov) => !pipeline.includes(prov.id),
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12 text-zinc-400">
        <RefreshCw className="w-5 h-5 animate-spin mr-2" /> {t('routing.loading')}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-zinc-100 flex items-center gap-2">
            <Route className="w-5 h-5 text-emerald-400" />
            {t('routing.ruleBasedTitle')}
          </h2>
          <p className="text-xs text-zinc-400">
            {t('routing.ruleBasedDesc')}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {saveSuccess && (
            <span className="text-xs text-emerald-400 flex items-center gap-1">
              <Check className="w-4 h-4" /> {t('routing.saved')}
            </span>
          )}
          <button
            onClick={() => setRawMode(!rawMode)}
            className="px-3 py-1.5 rounded-lg border border-zinc-700 hover:bg-zinc-800 text-xs font-medium text-zinc-300 transition-colors"
          >
            {rawMode ? t('routing.visualMode') : t('routing.rawJsonMode')}
          </button>
          {!rawMode && (
            <button
              onClick={handleOpenAdd}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-zinc-950 font-semibold text-xs shadow-md transition-all"
            >
              <Plus className="w-4 h-4" /> {t('routing.addRule')}
            </button>
          )}
        </div>
      </div>

      {rawMode ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-4">
          <textarea
            value={rawJson}
            onChange={(e) => setRawJson(e.target.value)}
            className="w-full h-96 bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-xs font-mono text-zinc-200 focus:outline-none focus:border-emerald-500"
          />
          <button
            disabled={saving}
            onClick={handleSaveRaw}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-zinc-950 font-semibold text-xs transition-all disabled:opacity-50"
          >
            <Save className="w-4 h-4" /> {saving ? t('routing.saving') : t('common.save')}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Rules list */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
            <DragList
              items={config?.rules ?? []}
              getKey={(rule) => rule.pattern}
              onReorder={handleReorderRules}
              className="divide-y divide-zinc-800/80"
              renderItem={(rule, idx, handle) => (
                <div
                  className={dragRowClass(
                    handle,
                    'p-4 hover:bg-zinc-800/30 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4',
                  )}
                >
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <DragHandle
                      handle={handle}
                      label={t('routing.reorderRuleTooltip', {
                        index: idx + 1,
                        total: config?.rules.length ?? 0,
                      })}
                    />
                    <div className="space-y-2 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-bold text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded border border-zinc-700 tabular-nums">
                          #{idx + 1}
                        </span>
                        <span className="font-mono text-xs font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                          {rule.pattern}
                        </span>
                        {rule.description && (
                          <span className="text-xs text-zinc-400">{rule.description}</span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs text-zinc-500">{t('routing.pipelineLabel')}</span>
                        {rule.pipeline.map((p, pIdx) => {
                          const meta = providerMeta(p);
                          return (
                            <React.Fragment key={pIdx}>
                              <span
                                className={`text-xs px-2 py-0.5 rounded border font-medium ${
                                  meta?.color || 'bg-zinc-800 text-zinc-300 border-zinc-700'
                                }`}
                              >
                                {pIdx + 1}. {meta?.label || p}
                              </span>
                              {pIdx < rule.pipeline.length - 1 && (
                                <span className="text-xs text-zinc-600">➔</span>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end md:self-center">
                    <button
                      onClick={() => handleOpenEdit(idx)}
                      className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors"
                      title={t('routing.editTooltip')}
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteRule(idx)}
                      className="p-1.5 text-zinc-400 hover:text-red-400 hover:bg-zinc-800 rounded-lg transition-colors"
                      title={t('routing.deleteTooltip')}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            />

            {(!config?.rules || config.rules.length === 0) && (
              <div className="p-8 text-center text-xs text-zinc-500">
                {t('routing.noRules')}
              </div>
            )}
          </div>

          {/* Default pipeline */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-1">
              {t('routing.defaultPipelineTitle')}
            </h3>
            <p className="text-xs text-zinc-500 mb-3">
              {t('routing.defaultPipelineHint')}
            </p>
            <DragList
              items={config?.default_pipeline ?? []}
              getKey={(p) => p}
              onReorder={handleReorderDefaultPipeline}
              renderItem={(p, pIdx, handle) => {
                const meta = providerMeta(p);
                return (
                  <div
                    className={dragRowClass(
                      handle,
                      'flex items-center gap-2 rounded-lg transition-colors',
                    )}
                  >
                    <DragHandle
                      handle={handle}
                      label={t('routing.reorderDefaultTooltip', {
                        index: pIdx + 1,
                        total: config?.default_pipeline.length ?? 0,
                      })}
                    />
                    <span className="text-xs text-zinc-500 tabular-nums w-5 shrink-0">
                      {pIdx + 1}.
                    </span>
                    <span
                      className={`text-xs px-2.5 py-1 rounded border font-medium ${
                        meta?.color || 'bg-zinc-800 text-zinc-300 border-zinc-700'
                      }`}
                    >
                      {meta?.label || p}
                    </span>
                  </div>
                );
              }}
            />
          </div>
        </div>
      )}

      {/* Edit / Add Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-lg p-6 space-y-5 shadow-2xl">
            <h3 className="text-base font-bold text-zinc-100 flex items-center gap-2">
              <Route className="w-5 h-5 text-emerald-400" />
              {editingIndex !== null ? t('routing.editRule') : t('routing.addRule')}
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">
                  {t('routing.patternLabel')}
                </label>
                <input
                  type="text"
                  value={pattern}
                  onChange={(e) => setPattern(e.target.value)}
                  placeholder={t('routing.patternPlaceholder')}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs font-mono text-zinc-100 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">
                  {t('routing.descriptionLabel')}
                </label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t('routing.descriptionPlaceholder')}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-2">
                  {t('routing.providersLabel')}
                </label>

                {/* Selected providers, in the order they are tried. */}
                <DragList
                  items={pipeline}
                  getKey={(p) => p}
                  onReorder={handleReorderPipeline}
                  renderItem={(p, pIdx, handle) => {
                    const meta = providerMeta(p);
                    return (
                      <div
                        className={dragRowClass(
                          handle,
                          'flex items-center gap-2 rounded-lg bg-zinc-950 border border-zinc-800 px-2 py-1.5 mb-1.5',
                        )}
                      >
                        <DragHandle
                          handle={handle}
                          label={t('routing.reorderProviderTooltip', {
                            index: pIdx + 1,
                            total: pipeline.length,
                          })}
                        />
                        <span className="text-xs text-zinc-500 tabular-nums w-5 shrink-0">
                          {pIdx + 1}.
                        </span>
                        <span
                          className={`text-xs px-2 py-0.5 rounded border font-medium flex-1 ${
                            meta?.color || 'bg-zinc-800 text-zinc-300 border-zinc-700'
                          }`}
                        >
                          {meta?.label || p}
                        </span>
                        <button
                          type="button"
                          onClick={() => toggleProviderInPipeline(p)}
                          className="p-1 text-zinc-600 hover:text-red-400 hover:bg-zinc-800 rounded transition-colors"
                          title={t('routing.removeProviderTooltip')}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  }}
                />

                {pipeline.length === 0 && (
                  <p className="text-xs text-zinc-600 py-2 text-center border border-dashed border-zinc-800 rounded-lg">
                    {t('routing.noProvidersSelected')}
                  </p>
                )}
              </div>

              {/* Everything not yet in the pipeline, appended on click. */}
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-2">
                  {t('routing.addProviderLabel')}
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {availableProviders.map((prov) => (
                    <button
                      type="button"
                      key={prov.id}
                      onClick={() => toggleProviderInPipeline(prov.id)}
                      className={`flex items-center justify-between px-3 py-2 rounded-lg border text-xs font-medium transition-all ${prov.color} shadow-sm ring-1 ring-emerald-500/50 hover:brightness-125`}
                    >
                      <span>{prov.label}</span>
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-800">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="px-3.5 py-2 text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                {t('routing.cancel')}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleSaveModal}
                className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-zinc-950 text-xs font-semibold shadow-md transition-all disabled:opacity-50"
              >
                {saving ? t('routing.saving') : t('routing.saveRule')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

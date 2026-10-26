import React, { useMemo, useState } from 'react';
import {
  Plug,
  Search,
  Copy,
  Check,
  Terminal,
  ChevronRight,
  Info,
  X,
} from 'lucide-react';
import type { ModelEntry } from '../types';
import { useTranslation } from '../i18n';
import { useToast } from '../components/toast-context';
import {
  AGENT_FAMILIES,
  AGENT_PRESETS,
  defaultEnabled,
  normalizeBaseUrl,
  type AgentPreset,
} from '../lib/agentPresets';

export interface ModelSpecEntry {
  id: string;
  maxOutputTokens: number;
}

interface AgentSetupViewProps {
  models: ModelEntry[];
  /** Output ceilings per model, when the server reported any. */
  modelSpecs?: ModelSpecEntry[];
  /** Fallback origin when the dashboard is served from an unknown host. */
  defaultPort?: number;
}

const PROTOCOL_COLOR: Record<AgentPreset['protocol'], string> = {
  openai: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  anthropic: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  gemini: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
};

const PROTOCOL_LABEL: Record<AgentPreset['protocol'], string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Gemini',
};

/** The gateway is reached at whatever origin the browser is talking to. */
const originFromBrowser = (fallbackPort: number): string => {
  if (typeof window === 'undefined') return `http://localhost:${fallbackPort}`;
  return window.location.origin;
};

export const AgentSetupView: React.FC<AgentSetupViewProps> = ({
  models,
  modelSpecs = [],
  defaultPort = 8044,
}) => {
  const { t, language } = useTranslation();
  const toast = useToast();

  const [baseUrl, setBaseUrl] = useState(() => originFromBrowser(defaultPort));
  const [apiKey, setApiKey] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [agentId, setAgentId] = useState(AGENT_PRESETS[0].id);
  // Per-agent, so switching agents never silently reuses another one's picks.
  const [enabledByAgent, setEnabledByAgent] = useState<
    Record<string, string[]>
  >(() =>
    Object.fromEntries(
      AGENT_PRESETS.map((preset) => [preset.id, [...defaultEnabled(preset)]]),
    ),
  );
  const [modelSearch, setModelSearch] = useState('');
  const [agentSearch, setAgentSearch] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  const agent =
    AGENT_PRESETS.find((preset) => preset.id === agentId) ?? AGENT_PRESETS[0];

  const enabledOptions = useMemo(
    () => new Set(enabledByAgent[agent.id] ?? defaultEnabled(agent)),
    [agent, enabledByAgent],
  );

  const toggleOption = (optionId: string) => {
    setEnabledByAgent((current) => {
      const next = new Set(current[agent.id] ?? defaultEnabled(agent));
      if (next.has(optionId)) {
        next.delete(optionId);
      } else {
        next.add(optionId);
      }
      return { ...current, [agent.id]: [...next] };
    });
  };

  const outputLimits = useMemo(
    () =>
      Object.fromEntries(
        modelSpecs.map((spec) => [spec.id, spec.maxOutputTokens]),
      ),
    [modelSpecs],
  );

  const normalizedBase = normalizeBaseUrl(baseUrl);
  const chosenModels = useMemo(() => {
    const order = new Map(selected.map((id, index) => [id, index]));
    return models
      .filter((model) => order.has(model.id))
      .sort(
        (left, right) =>
          (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0),
      )
      .map((model) => model.id);
  }, [models, selected]);

  const values = useMemo(
    () => ({
      baseUrl: normalizedBase,
      apiKey: apiKey.trim() || '<your-api-key>',
      models: chosenModels,
      outputLimits,
    }),
    [normalizedBase, apiKey, chosenModels, outputLimits],
  );

  const configText = useMemo(() => {
    const body = agent.build(values, enabledOptions);
    const notes = agent.notes(values, enabledOptions, language);
    return notes.length > 0 ? `${body}\n${notes.join('\n')}` : body;
  }, [agent, values, enabledOptions, language]);

  const filteredModels = useMemo(
    () =>
      models.filter((model) =>
        model.id.toLowerCase().includes(modelSearch.toLowerCase()),
      ),
    [models, modelSearch],
  );

  const filteredAgents = useMemo(() => {
    const term = agentSearch.toLowerCase().trim();
    if (!term) return AGENT_PRESETS;
    return AGENT_PRESETS.filter(
      (preset) =>
        preset.label.toLowerCase().includes(term) ||
        preset.family.toLowerCase().includes(term),
    );
  }, [agentSearch]);

  const toggleModel = (id: string) => {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : // Newest pick goes to the top so the config leads with what the user
          // just chose rather than with whatever the catalog listed first.
          [id, ...current],
    );
  };

  const copy = async (text: string, token: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(token);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      toast.error(t('agentSetup.copyFailed'));
    }
  };

  const sectionTitle = (
    n: number,
    title: string,
    hint?: string,
  ): React.ReactNode => (
    <div className="flex items-start gap-2.5 mb-3">
      <span className="shrink-0 w-5 h-5 rounded-md bg-zinc-800 border border-zinc-700 text-zinc-400 text-[11px] font-bold flex items-center justify-center tabular-nums">
        {n}
      </span>
      <div className="min-w-0">
        <h3 className="text-xs font-semibold text-zinc-200">{title}</h3>
        {hint && <p className="text-[11px] text-zinc-500 mt-0.5">{hint}</p>}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-zinc-100 flex items-center gap-2">
          <Plug className="w-5 h-5 text-emerald-400" />
          {t('agentSetup.title')}
        </h2>
        <p className="text-xs text-zinc-400 mt-1">{t('agentSetup.subtitle')}</p>
      </div>

      {/* Connection values */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1">
            {t('agentSetup.baseUrlLabel')}
          </label>
          <input
            type="text"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            spellCheck={false}
            placeholder={`http://localhost:${defaultPort}`}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs font-mono text-zinc-100 focus:outline-none focus:border-emerald-500"
          />
          <p className="text-[11px] text-zinc-500 mt-1">
            {t('agentSetup.baseUrlHint')}
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1">
            {t('agentSetup.apiKeyLabel')}
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            spellCheck={false}
            autoComplete="off"
            placeholder="sk-ag-..."
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs font-mono text-zinc-100 focus:outline-none focus:border-emerald-500"
          />
          <p className="text-[11px] text-zinc-500 mt-1">
            {t('agentSetup.apiKeyHint')}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Models */}
        <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          {sectionTitle(
            1,
            t('agentSetup.modelTitle'),
            t('agentSetup.modelDesc'),
          )}

          <div className="relative mb-3">
            <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-2.5" />
            <input
              type="text"
              value={modelSearch}
              onChange={(event) => setModelSearch(event.target.value)}
              placeholder={t('agentSetup.modelSearch')}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-9 pr-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-emerald-500"
            />
          </div>

          {selected.length > 0 && (
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] text-emerald-400">
                {t('agentSetup.selectedCount', {
                  count: selected.length,
                })}
              </span>
              <button
                type="button"
                onClick={() => setSelected([])}
                className="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                {t('agentSetup.clearSelection')}
              </button>
            </div>
          )}

          <div className="max-h-[26rem] overflow-y-auto space-y-0.5 -mx-1 px-1">
            {filteredModels.map((model) => {
              const isSelected = selected.includes(model.id);
              return (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => toggleModel(model.id)}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left transition-colors ${
                    isSelected
                      ? 'bg-emerald-500/10 ring-1 ring-emerald-500/30'
                      : 'hover:bg-zinc-800/60'
                  }`}
                >
                  <span
                    className={`shrink-0 w-4 h-4 rounded border flex items-center justify-center ${
                      isSelected
                        ? 'bg-emerald-500 border-emerald-500'
                        : 'border-zinc-700'
                    }`}
                  >
                    {isSelected && (
                      <Check className="w-3 h-3 text-zinc-950" strokeWidth={3} />
                    )}
                  </span>
                  <span className="font-mono text-[11px] text-zinc-300 truncate">
                    {model.id}
                  </span>
                </button>
              );
            })}
            {filteredModels.length === 0 && (
              <p className="text-xs text-zinc-500 p-4 text-center">
                {t('agentSetup.noModels')}
              </p>
            )}
          </div>
        </section>

        {/* Agents */}
        <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          {sectionTitle(2, t('agentSetup.agentTitle'), t('agentSetup.agentDesc'))}

          <div className="relative mb-3">
            <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-2.5" />
            <input
              type="text"
              value={agentSearch}
              onChange={(event) => setAgentSearch(event.target.value)}
              placeholder={t('agentSetup.agentSearch')}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-9 pr-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className="max-h-[26rem] overflow-y-auto space-y-3 -mx-1 px-1">
            {AGENT_FAMILIES.map((family) => {
              const items = filteredAgents.filter(
                (preset) => preset.family === family,
              );
              if (items.length === 0) return null;
              return (
                <div key={family}>
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold px-1 mb-1.5">
                    {family}
                  </p>
                  <div className="space-y-1">
                    {items.map((preset) => {
                      const isActive = preset.id === agent.id;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => setAgentId(preset.id)}
                          className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-all ${
                            isActive
                              ? 'bg-zinc-800 ring-1 ring-emerald-500/40'
                              : 'hover:bg-zinc-800/60'
                          }`}
                        >
                          <Terminal
                            className={`w-4 h-4 shrink-0 ${
                              isActive ? 'text-emerald-400' : 'text-zinc-500'
                            }`}
                          />
                          <span className="flex-1 min-w-0">
                            <span
                              className={`block text-xs font-medium ${
                                isActive ? 'text-zinc-100' : 'text-zinc-300'
                              }`}
                            >
                              {preset.label}
                            </span>
                            {preset.fileHint && (
                              <span className="block text-[10px] text-zinc-500 truncate">
                                {preset.fileHint}
                              </span>
                            )}
                          </span>
                          <span
                            className={`shrink-0 text-[9px] px-1.5 py-0.5 rounded border font-medium ${PROTOCOL_COLOR[preset.protocol]}`}
                          >
                            {PROTOCOL_LABEL[preset.protocol]}
                          </span>
                          {isActive && (
                            <ChevronRight className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {filteredAgents.length === 0 && (
              <p className="text-xs text-zinc-500 p-4 text-center">
                {t('agentSetup.noAgents')}
              </p>
            )}
          </div>
        </section>
      </div>

      {/* Output */}
      <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
        {sectionTitle(
          3,
          t('agentSetup.configTitle'),
          t('agentSetup.configDesc'),
        )}

        {/* What goes into the snippet, chosen piece by piece. */}
        <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 mb-3">
          <p className="text-[11px] text-zinc-500 mb-2">
            {t('agentSetup.optionsTitle')}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
            {agent.options.map((option) => {
              const on = enabledOptions.has(option.id);
              const unavailable =
                option.id === 'limit' && chosenModels.length === 0;
              const optionHint =
                language === 'vi' && option.hintVi ? option.hintVi : option.hint;
              return (
                <button
                  key={option.id}
                  type="button"
                  disabled={unavailable}
                  onClick={() => toggleOption(option.id)}
                  title={optionHint}
                  className={`flex items-start gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors ${
                    on ? 'bg-zinc-900' : 'opacity-60 hover:opacity-90'
                  } ${unavailable ? 'opacity-40 cursor-not-allowed' : ''}`}
                >
                  <span
                    className={`shrink-0 mt-0.5 w-4 h-4 rounded border flex items-center justify-center ${
                      on
                        ? 'bg-emerald-500 border-emerald-500'
                        : 'border-zinc-700'
                    }`}
                  >
                    {on && (
                      <Check className="w-3 h-3 text-zinc-950" strokeWidth={3} />
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-mono text-[11px] text-zinc-200 break-all">
                      {option.label}
                    </span>
                    <span className="block text-[10px] text-zinc-500">
                      {optionHint}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="text-xs font-semibold text-zinc-200">
            {agent.label}
          </span>
          {agent.fileHint && (
            <span className="text-[11px] text-zinc-500 font-mono">
              → {agent.fileHint}
            </span>
          )}
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${PROTOCOL_COLOR[agent.protocol]}`}
          >
            {PROTOCOL_LABEL[agent.protocol]}
          </span>
          {chosenModels.length === 0 && (
            <span className="text-[11px] text-amber-400">
              {t('agentSetup.noModelWarning')}
            </span>
          )}
          <button
            type="button"
            onClick={() => void copy(configText, 'config')}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-zinc-950 text-xs font-semibold transition-colors"
          >
            {copied === 'config' ? (
              <Check className="w-3.5 h-3.5" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
            {copied === 'config' ? t('common.copied') : t('common.copy')}
          </button>
        </div>

        <pre className="bg-zinc-950 border border-zinc-800 rounded-lg p-3.5 overflow-x-auto text-[11px] leading-relaxed font-mono text-zinc-200">
          <code>{configText}</code>
        </pre>

        <div className="flex items-start gap-2 mt-3 text-[11px] text-zinc-500">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <p>{t('agentSetup.disclaimer')}</p>
        </div>
      </section>

      {/* Selected chips, so the order carried into the config is visible. */}
      {chosenModels.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-zinc-500 mr-1">
            {t('agentSetup.configOrder')}:
          </span>
          {chosenModels.map((id, index) => (
            <span
              key={id}
              className="inline-flex items-center gap-1.5 text-[11px] pl-2 pr-1 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono"
            >
              {index + 1}. {id}
              <button
                type="button"
                onClick={() => toggleModel(id)}
                className="p-0.5 rounded hover:bg-emerald-500/20 transition-colors"
                title={t('agentSetup.removeModel')}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
};
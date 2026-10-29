import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Code2,
  Copy,
  Cpu,
  Eye,
  Globe,
  Hash,
  RotateCcw,
  Search,
  Send,
  SlidersHorizontal,
  Sparkles,
  Square,
  Terminal,
} from 'lucide-react';
import { getAdminKey } from '../api/keyStorage';
import { useToast } from '../components/toast-context';
import { useTranslation } from '../i18n';
import {
  generateCurl,
  generateFetch,
  generateNode,
  generatePython,
  type PlaygroundConfig,
  type PlaygroundMessage,
} from '../lib/codeSamples';
import type { ModelEntry } from '../types';

export interface PlaygroundViewProps {
  models: ModelEntry[];
  defaultPort?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  latencyMs?: number;
  tokens?: {
    prompt?: number;
    completion?: number;
  };
  error?: boolean;
}

type CodeLanguage = 'curl' | 'python' | 'node' | 'fetch';

function getModelBadges(modelId: string) {
  const lower = modelId.toLowerCase();
  const isThinking =
    lower.includes('thinking') ||
    lower.includes('-high') ||
    lower.includes('-medium') ||
    lower.includes('-low') ||
    lower.includes('tiered');

  const isVision =
    lower.includes('vision') ||
    lower.includes('gemini') ||
    lower.includes('claude-3') ||
    lower.includes('gpt-4');

  const isAnthropic = lower.includes('claude');
  const isGemini = lower.includes('gemini');
  const isOpenAI =
    lower.includes('gpt') || lower.includes('o1') || lower.includes('o3');

  return { isThinking, isVision, isAnthropic, isGemini, isOpenAI };
}

function CodeBlockSnippet({
  language,
  code,
}: {
  language: string;
  code: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback
    }
  };

  return (
    <div className="my-2.5 rounded-xl border border-zinc-800 bg-zinc-950 overflow-hidden text-xs font-mono shadow-sm">
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-900/90 border-b border-zinc-800/80 text-[11px] text-zinc-400">
        <span className="font-semibold uppercase tracking-wider text-zinc-400">
          {language || 'code'}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-2 py-0.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-emerald-400" />
              <span className="text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-3 overflow-x-auto text-zinc-200 whitespace-pre leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function MessageContentRenderer({ content }: { content: string }) {
  const parts = useMemo(() => {
    // Match code blocks: ```lang\ncode```
    const regex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
    const elements: Array<{
      type: 'text' | 'code';
      language?: string;
      content: string;
    }> = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        elements.push({
          type: 'text',
          content: content.slice(lastIndex, match.index),
        });
      }
      elements.push({
        type: 'code',
        language: match[1] || 'text',
        content: match[2].trimEnd(),
      });
      lastIndex = regex.lastIndex;
    }

    if (lastIndex < content.length) {
      elements.push({
        type: 'text',
        content: content.slice(lastIndex),
      });
    }

    return elements;
  }, [content]);

  return (
    <div className="space-y-2 text-xs text-zinc-200 leading-relaxed break-words">
      {parts.map((part, idx) => {
        if (part.type === 'code') {
          return (
            <CodeBlockSnippet
              key={idx}
              language={part.language || 'text'}
              code={part.content}
            />
          );
        }

        // Render basic inline formatting (bold, inline code, line breaks)
        const lines = part.content.split('\n');
        return (
          <div key={idx} className="space-y-1">
            {lines.map((line, lineIdx) => {
              if (!line.trim()) {
                return <div key={lineIdx} className="h-1.5" />;
              }

              // Check for bullet list
              const isBullet = line.startsWith('- ') || line.startsWith('* ');
              const cleanLine = isBullet ? line.slice(2) : line;

              // Parse inline code and bold
              const formattedParts: React.ReactNode[] = [];
              const inlineRegex = /(`[^`]+`|\*\*[^*]+\*\*)/g;
              let inlineLast = 0;
              let inlineMatch: RegExpExecArray | null;

              while ((inlineMatch = inlineRegex.exec(cleanLine)) !== null) {
                if (inlineMatch.index > inlineLast) {
                  formattedParts.push(
                    cleanLine.slice(inlineLast, inlineMatch.index),
                  );
                }
                const token = inlineMatch[0];
                if (token.startsWith('`') && token.endsWith('`')) {
                  formattedParts.push(
                    <code
                      key={inlineMatch.index}
                      className="px-1.5 py-0.5 rounded bg-zinc-800 text-emerald-400 font-mono text-[11px]"
                    >
                      {token.slice(1, -1)}
                    </code>,
                  );
                } else if (token.startsWith('**') && token.endsWith('**')) {
                  formattedParts.push(
                    <strong
                      key={inlineMatch.index}
                      className="font-semibold text-zinc-100"
                    >
                      {token.slice(2, -2)}
                    </strong>,
                  );
                }
                inlineLast = inlineRegex.lastIndex;
              }

              if (inlineLast < cleanLine.length) {
                formattedParts.push(cleanLine.slice(inlineLast));
              }

              return (
                <p
                  key={lineIdx}
                  className={isBullet ? 'flex items-start gap-2 pl-2' : ''}
                >
                  {isBullet && (
                    <span className="text-emerald-400 font-bold">•</span>
                  )}
                  <span>{formattedParts}</span>
                </p>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function ThinkingBlock({
  thinking,
  isStreaming,
}: {
  thinking: string;
  isStreaming: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="mb-2.5 rounded-xl border border-purple-800/30 bg-purple-950/20 overflow-hidden text-xs">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="w-full flex items-center justify-between px-3 py-2 text-purple-300 hover:bg-purple-900/20 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Brain className="w-3.5 h-3.5 text-purple-400" />
          <span className="font-semibold text-[11px] uppercase tracking-wider">
            Thought Process
          </span>
          {isStreaming && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 text-[10px] animate-pulse">
              thinking...
            </span>
          )}
          {!isStreaming && (
            <span className="text-[10px] text-purple-400/70">
              ({thinking.length} chars)
            </span>
          )}
        </div>
        {isOpen ? (
          <ChevronUp className="w-3.5 h-3.5 text-purple-400" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-purple-400" />
        )}
      </button>

      {isOpen && (
        <div className="p-3 border-t border-purple-800/20 bg-purple-950/30 text-purple-200/80 font-mono text-xs whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto">
          {thinking}
        </div>
      )}
    </div>
  );
}

export const PlaygroundView: React.FC<PlaygroundViewProps> = ({
  models,
  defaultPort = 8044,
}) => {
  const { t } = useTranslation();
  const toast = useToast();

  // Model selection (derived to avoid cascading renders)
  const [userSelectedModel, setUserSelectedModel] = useState<string | null>(null);

  const selectedModel = useMemo(() => {
    if (userSelectedModel && models.some((m) => m.id === userSelectedModel)) {
      return userSelectedModel;
    }
    if (models.length > 0) {
      const preferred = models.find(
        (m) =>
          m.id.includes('gemini-2.5-pro') ||
          m.id.includes('claude-3-7-sonnet') ||
          m.id.includes('gpt-4o'),
      );
      return preferred ? preferred.id : models[0].id;
    }
    return userSelectedModel || 'gemini-2.5-pro';
  }, [models, userSelectedModel]);

  const [modelSearch, setModelSearch] = useState('');
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsModelDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // System Prompt & Parameters
  const [systemPrompt, setSystemPrompt] = useState('');
  const [isSystemPromptOpen, setIsSystemPromptOpen] = useState(false);
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState<number | undefined>(4096);
  const [stream, setStream] = useState(true);

  // Chat State
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputPrompt, setInputPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null);
  const [lastTokenUsage, setLastTokenUsage] = useState<{
    prompt?: number;
    completion?: number;
  } | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // Code Export State
  const [activeLang, setActiveLang] = useState<CodeLanguage>('curl');
  const [copiedCode, setCopiedCode] = useState(false);

  // Abort controller reference
  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat to bottom
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Clean stop handler
  const handleStopStream = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsLoading(false);
  };

  // Clear chat
  const handleClearChat = () => {
    handleStopStream();
    setMessages([]);
    setLastLatencyMs(null);
    setLastTokenUsage(null);
    setErrorBanner(null);
  };

  // Send message
  const handleSend = async () => {
    const trimmedInput = inputPrompt.trim();
    if (!trimmedInput || isLoading || !selectedModel) return;

    setErrorBanner(null);
    const userMessageId = `user-${Date.now()}`;
    const assistantMessageId = `assistant-${Date.now()}`;

    const newUserMsg: ChatMessage = {
      id: userMessageId,
      role: 'user',
      content: trimmedInput,
    };

    const newAssistantMsg: ChatMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      thinking: '',
    };

    const updatedHistory = [...messages, newUserMsg];
    setMessages([...updatedHistory, newAssistantMsg]);
    setInputPrompt('');
    setIsLoading(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const startTime = performance.now();

    const apiMessages: PlaygroundMessage[] = [];
    if (systemPrompt.trim()) {
      apiMessages.push({ role: 'system', content: systemPrompt.trim() });
    }
    for (const msg of updatedHistory) {
      apiMessages.push({ role: msg.role, content: msg.content });
    }

    const payload: Record<string, unknown> = {
      model: selectedModel,
      messages: apiMessages,
      temperature,
      stream,
      ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
    };

    try {
      const adminKey = getAdminKey();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (adminKey) {
        headers['Authorization'] = `Bearer ${adminKey}`;
      }

      const response = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        let errMessage = `HTTP ${response.status}: ${response.statusText}`;
        try {
          const errData = await response.json();
          if (errData?.error?.message) {
            errMessage = errData.error.message;
          }
        } catch {
          // Keep statusText
        }
        throw new Error(errMessage);
      }

      if (stream) {
        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('Response body stream is unavailable');
        }

        const decoder = new TextDecoder();
        let buffer = '';
        let assistantContent = '';
        let assistantThinking = '';
        let promptToks = 0;
        let completionToks = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(':')) continue;
            if (trimmed === 'data: [DONE]') continue;
            if (trimmed.startsWith('data: ')) {
              const jsonStr = trimmed.slice(6);
              try {
                const parsed = JSON.parse(jsonStr);
                const delta = parsed.choices?.[0]?.delta;
                if (delta?.content) {
                  assistantContent += delta.content;
                }
                if (delta?.reasoning_content) {
                  assistantThinking += delta.reasoning_content;
                }
                if (parsed.usage) {
                  promptToks = parsed.usage.prompt_tokens ?? promptToks;
                  completionToks =
                    parsed.usage.completion_tokens ?? completionToks;
                }

                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMessageId
                      ? {
                          ...m,
                          content: assistantContent,
                          thinking: assistantThinking || undefined,
                        }
                      : m,
                  ),
                );
              } catch {
                // Ignore incomplete SSE chunk
              }
            }
          }
        }

        const latency = Math.round(performance.now() - startTime);
        setLastLatencyMs(latency);
        if (promptToks > 0 || completionToks > 0) {
          setLastTokenUsage({ prompt: promptToks, completion: completionToks });
        }

        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMessageId
              ? {
                  ...m,
                  content: assistantContent,
                  thinking: assistantThinking || undefined,
                  latencyMs: latency,
                  tokens:
                    promptToks > 0 || completionToks > 0
                      ? { prompt: promptToks, completion: completionToks }
                      : undefined,
                }
              : m,
          ),
        );
      } else {
        // Non-streaming JSON response
        const data = await response.json();
        const latency = Math.round(performance.now() - startTime);
        const choice = data.choices?.[0];
        const content = choice?.message?.content || '';
        const thinking = choice?.message?.reasoning_content || '';
        const promptToks = data.usage?.prompt_tokens;
        const completionToks = data.usage?.completion_tokens;

        setLastLatencyMs(latency);
        if (promptToks !== undefined || completionToks !== undefined) {
          setLastTokenUsage({ prompt: promptToks, completion: completionToks });
        }

        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMessageId
              ? {
                  ...m,
                  content,
                  thinking: thinking || undefined,
                  latencyMs: latency,
                  tokens:
                    promptToks !== undefined || completionToks !== undefined
                      ? { prompt: promptToks, completion: completionToks }
                      : undefined,
                }
              : m,
          ),
        );
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // Stream aborted by user, leave partial content
        return;
      }
      const errMessage =
        err instanceof Error ? err.message : 'Unknown request error';
      setErrorBanner(errMessage);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMessageId
            ? {
                ...m,
                content:
                  m.content ||
                  `Error generating response: ${errMessage}`,
                error: true,
              }
            : m,
        ),
      );
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  };

  // Base URL calculation for Code Generator
  const baseUrl = useMemo(() => {
    if (typeof window !== 'undefined') {
      const port = defaultPort || (window.location.port ? Number(window.location.port) : 8044);
      return `${window.location.protocol}//${window.location.hostname}:${port}/v1`;
    }
    return `http://localhost:${defaultPort}/v1`;
  }, [defaultPort]);

  // Code sample configuration
  const playgroundConfig = useMemo<PlaygroundConfig>(() => {
    const effectiveMessages: PlaygroundMessage[] =
      messages.length > 0
        ? messages.map((m) => ({ role: m.role, content: m.content }))
        : inputPrompt.trim()
          ? [{ role: 'user', content: inputPrompt.trim() }]
          : [
              {
                role: 'user',
                content: 'Explain quantum computing in one sentence.',
              },
            ];

    return {
      baseUrl,
      apiKey: getAdminKey() || '<your-admin-key>',
      model: selectedModel,
      systemPrompt: systemPrompt.trim() || undefined,
      messages: effectiveMessages,
      temperature,
      maxTokens: maxTokens || undefined,
      stream,
    };
  }, [
    baseUrl,
    selectedModel,
    systemPrompt,
    messages,
    inputPrompt,
    temperature,
    maxTokens,
    stream,
  ]);

  // Generated code string
  const generatedCode = useMemo(() => {
    switch (activeLang) {
      case 'curl':
        return generateCurl(playgroundConfig);
      case 'python':
        return generatePython(playgroundConfig);
      case 'node':
        return generateNode(playgroundConfig);
      case 'fetch':
        return generateFetch(playgroundConfig);
      default:
        return '';
    }
  }, [activeLang, playgroundConfig]);

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(generatedCode);
      setCopiedCode(true);
      toast.success(t('playground.copied'));
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      toast.error('Failed to copy code');
    }
  };

  const filteredModels = useMemo(() => {
    const term = modelSearch.toLowerCase().trim();
    if (!term) return models;
    return models.filter((m) => m.id.toLowerCase().includes(term));
  }, [models, modelSearch]);

  const selectedBadges = useMemo(
    () => getModelBadges(selectedModel),
    [selectedModel],
  );

  const quickPrompts = [
    'Explain how LLM proxying and quota rotation work.',
    'Write a TypeScript function to debounce an async call.',
    'What are the key trade-offs between REST and GraphQL?',
  ];

  return (
    <div className="space-y-6">
      {/* Top Banner / Controls Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 p-5 rounded-2xl bg-zinc-900/60 border border-zinc-800 shadow-sm">
        {/* Model Selector Dropdown */}
        <div className="relative" ref={dropdownRef}>
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-400 mb-1.5">
            {t('playground.modelSelect')}
          </label>
          <button
            type="button"
            onClick={() => setIsModelDropdownOpen((prev) => !prev)}
            className="w-full sm:w-80 flex items-center justify-between gap-2.5 px-3.5 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 hover:border-zinc-700 text-left transition-all group"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Cpu className="w-4 h-4 text-teal-400 shrink-0" />
              <span className="font-mono text-xs font-bold text-zinc-100 truncate">
                {selectedModel || 'Select model...'}
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {selectedBadges.isThinking && (
                <span className="px-1.5 py-0.5 rounded bg-purple-500/10 border border-purple-500/20 text-purple-400 text-[10px] font-medium flex items-center gap-1">
                  <Brain className="w-3 h-3" />
                  Thinking
                </span>
              )}
              {selectedBadges.isVision && (
                <span className="px-1.5 py-0.5 rounded bg-teal-500/10 border border-teal-500/20 text-teal-400 text-[10px] font-medium flex items-center gap-1">
                  <Eye className="w-3 h-3" />
                  Vision
                </span>
              )}
              <ChevronDown className="w-4 h-4 text-zinc-500 group-hover:text-zinc-300 transition-colors" />
            </div>
          </button>

          {/* Model Search & Selection Popover */}
          {isModelDropdownOpen && (
            <div className="absolute z-30 mt-2 w-full sm:w-96 rounded-2xl bg-zinc-900 border border-zinc-700 shadow-2xl p-2.5 space-y-2">
              <div className="relative">
                <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Search available models..."
                  value={modelSearch}
                  onChange={(e) => setModelSearch(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-9 pr-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500"
                  autoFocus
                />
              </div>

              <div className="max-h-60 overflow-y-auto space-y-1">
                {filteredModels.length === 0 ? (
                  <div className="p-4 text-center text-xs text-zinc-500">
                    No models found matching &quot;{modelSearch}&quot;
                  </div>
                ) : (
                  filteredModels.map((m) => {
                    const badges = getModelBadges(m.id);
                    const isSelected = m.id === selectedModel;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          setUserSelectedModel(m.id);
                          setIsModelDropdownOpen(false);
                        }}
                        className={`w-full flex items-center justify-between p-2.5 rounded-xl text-left text-xs transition-all ${
                          isSelected
                            ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
                            : 'hover:bg-zinc-800/80 text-zinc-200'
                        }`}
                      >
                        <div className="min-w-0 pr-2">
                          <p className="font-mono font-medium truncate">
                            {m.id}
                          </p>
                          <p className="text-[10px] text-zinc-500 font-mono">
                            {m.owned_by}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {badges.isThinking && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">
                              Think
                            </span>
                          )}
                          {badges.isVision && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-400 border border-teal-500/20">
                              Vision
                            </span>
                          )}
                          {isSelected && (
                            <Check className="w-3.5 h-3.5 text-emerald-400 ml-1" />
                          )}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        {/* Status Bar / Latency & Usage Badges */}
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-950 border border-zinc-800 text-zinc-300">
            <Clock className="w-3.5 h-3.5 text-teal-400" />
            <span className="text-zinc-500">{t('playground.latency')}:</span>
            <span className="font-mono font-semibold text-zinc-200">
              {lastLatencyMs !== null ? `${lastLatencyMs} ms` : '—'}
            </span>
          </div>

          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-950 border border-zinc-800 text-zinc-300">
            <Hash className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-zinc-500">{t('playground.tokens')}:</span>
            <span className="font-mono font-semibold text-zinc-200">
              {lastTokenUsage
                ? `${lastTokenUsage.prompt ?? 0} in / ${lastTokenUsage.completion ?? 0} out`
                : '—'}
            </span>
          </div>

          <button
            type="button"
            onClick={handleClearChat}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-800/80 hover:bg-zinc-800 text-zinc-300 hover:text-zinc-100 transition-colors"
            title={t('playground.clearChat')}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>{t('playground.clearChat')}</span>
          </button>
        </div>
      </div>

      {/* Main Dual-Column Grid Layout */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left Column: Chat Studio (7 cols on XL) */}
        <div className="xl:col-span-7 flex flex-col gap-4">
          {/* Collapsible System Prompt */}
          <div className="rounded-2xl bg-zinc-900/50 border border-zinc-800 overflow-hidden shadow-sm">
            <button
              type="button"
              onClick={() => setIsSystemPromptOpen((prev) => !prev)}
              className="w-full flex items-center justify-between p-3.5 hover:bg-zinc-800/40 text-left transition-colors"
            >
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-bold text-zinc-200">
                  {t('playground.systemPrompt')}
                </span>
                {systemPrompt.trim().length > 0 && (
                  <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-mono">
                    {systemPrompt.trim().length} chars
                  </span>
                )}
              </div>
              {isSystemPromptOpen ? (
                <ChevronUp className="w-4 h-4 text-zinc-500" />
              ) : (
                <ChevronRight className="w-4 h-4 text-zinc-500" />
              )}
            </button>

            {isSystemPromptOpen && (
              <div className="p-3.5 border-t border-zinc-800 bg-zinc-950/60">
                <textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder={t('playground.systemPromptPlaceholder')}
                  rows={3}
                  className="w-full bg-zinc-900/90 border border-zinc-800 rounded-xl p-3 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500 font-mono transition-all resize-y"
                />
              </div>
            )}
          </div>

          {/* Parameters Toolbar */}
          <div className="p-4 rounded-2xl bg-zinc-900/40 border border-zinc-800 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            {/* Temperature Slider */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-zinc-400 font-medium flex items-center gap-1.5">
                  <SlidersHorizontal className="w-3.5 h-3.5 text-teal-400" />
                  {t('playground.temperature')}
                </span>
                <span className="font-mono text-emerald-400 font-semibold">
                  {temperature.toFixed(1)}
                </span>
              </div>
              <input
                type="range"
                min="0.0"
                max="2.0"
                step="0.1"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
                className="w-full accent-emerald-500 cursor-pointer bg-zinc-800 rounded-lg h-1.5"
              />
              <div className="flex justify-between text-[10px] text-zinc-500 mt-1">
                <span>0.0 (Precise)</span>
                <span>2.0 (Creative)</span>
              </div>
            </div>

            {/* Max Output Tokens */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-zinc-400 font-medium">
                  {t('playground.maxTokens')}
                </span>
                <span className="font-mono text-zinc-200">
                  {maxTokens ?? 'Default'}
                </span>
              </div>
              <input
                type="number"
                min="128"
                max="32768"
                step="256"
                value={maxTokens ?? ''}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  setMaxTokens(isNaN(val) ? undefined : val);
                }}
                placeholder="4096"
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1 text-xs text-zinc-200 font-mono focus:outline-none focus:border-emerald-500"
              />
            </div>

            {/* Stream Toggle Switch */}
            <div className="flex flex-col justify-center">
              <label className="flex items-center justify-between cursor-pointer group">
                <span className="text-zinc-400 font-medium group-hover:text-zinc-300 transition-colors">
                  {t('playground.stream')}
                </span>
                <input
                  type="checkbox"
                  checked={stream}
                  onChange={(e) => setStream(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500 relative"></div>
              </label>
              <p className="text-[10px] text-zinc-500 mt-1">
                {stream ? 'Real-time SSE token stream' : 'Single batch JSON response'}
              </p>
            </div>
          </div>

          {/* Error Banner */}
          {errorBanner && (
            <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold">Request Failed</p>
                <p className="text-rose-300/90 mt-0.5">{errorBanner}</p>
              </div>
            </div>
          )}

          {/* Chat Message Box */}
          <div className="rounded-2xl bg-zinc-900/50 border border-zinc-800 flex flex-col h-[520px] overflow-hidden shadow-sm">
            {/* Scrollable Messages Area */}
            <div className="flex-1 p-4 overflow-y-auto space-y-4">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center p-6 text-center">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mb-3 shadow-sm">
                    <Sparkles className="w-6 h-6" />
                  </div>
                  <h3 className="text-sm font-bold text-zinc-200 mb-1">
                    {t('playground.title')}
                  </h3>
                  <p className="text-xs text-zinc-400 max-w-sm mb-4 leading-relaxed">
                    {t('playground.subtitle')}
                  </p>
                  <div className="flex flex-col gap-2 max-w-md w-full">
                    {quickPrompts.map((prompt, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setInputPrompt(prompt)}
                        className="text-left text-xs p-2.5 rounded-xl bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-zinc-300 hover:text-emerald-300 transition-all flex items-center justify-between group"
                      >
                        <span className="truncate">{prompt}</span>
                        <ChevronRight className="w-3.5 h-3.5 text-zinc-500 group-hover:text-emerald-400 shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((message) => {
                  const isUser = message.role === 'user';
                  const isMessageLoading =
                    isLoading &&
                    message.role === 'assistant' &&
                    !message.content &&
                    !message.error;

                  return (
                    <div
                      key={message.id}
                      className={`flex flex-col ${
                        isUser ? 'items-end' : 'items-start'
                      }`}
                    >
                      {/* Role & Model Tag */}
                      <div className="flex items-center gap-1.5 mb-1 px-1 text-[11px] text-zinc-500">
                        {isUser ? (
                          <span className="font-semibold text-zinc-400">
                            You
                          </span>
                        ) : (
                          <span className="font-mono text-teal-400 flex items-center gap-1">
                            <Cpu className="w-3 h-3" />
                            {selectedModel}
                          </span>
                        )}
                        {message.latencyMs !== undefined && (
                          <span>• {message.latencyMs}ms</span>
                        )}
                      </div>

                      {/* Bubble */}
                      <div
                        className={`max-w-[90%] sm:max-w-[85%] rounded-2xl p-4 shadow-sm ${
                          isUser
                            ? 'bg-emerald-600/20 border border-emerald-500/30 text-zinc-100 rounded-tr-none'
                            : message.error
                              ? 'bg-rose-950/20 border border-rose-800/40 text-rose-200 rounded-tl-none'
                              : 'bg-zinc-950/90 border border-zinc-800/90 text-zinc-200 rounded-tl-none'
                        }`}
                      >
                        {/* Thinking Block */}
                        {message.thinking && (
                          <ThinkingBlock
                            thinking={message.thinking}
                            isStreaming={isLoading && !message.content}
                          />
                        )}

                        {/* Loading pulse indicator */}
                        {isMessageLoading && (
                          <div className="flex items-center gap-2 text-zinc-500 text-xs py-1">
                            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                            <span>{t('playground.sending')}</span>
                          </div>
                        )}

                        {/* Message content */}
                        {message.content && (
                          <MessageContentRenderer content={message.content} />
                        )}
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Bar */}
            <div className="p-3 border-t border-zinc-800 bg-zinc-950/80">
              <div className="relative flex items-end gap-2">
                <textarea
                  value={inputPrompt}
                  onChange={(e) => setInputPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void handleSend();
                    }
                  }}
                  placeholder={t('playground.userPromptPlaceholder')}
                  rows={2}
                  className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500 font-sans transition-all resize-none"
                  disabled={isLoading}
                />

                {isLoading ? (
                  <button
                    type="button"
                    onClick={handleStopStream}
                    className="p-3 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 border border-rose-500/40 text-xs font-semibold flex items-center justify-center transition-all shadow-sm shrink-0"
                    title="Stop generating"
                  >
                    <Square className="w-4 h-4 fill-current" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleSend()}
                    disabled={!inputPrompt.trim() || !selectedModel}
                    className="p-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-950 font-semibold text-xs flex items-center justify-center transition-all shadow-sm shrink-0"
                    title={t('playground.send')}
                  >
                    <Send className="w-4 h-4" />
                  </button>
                )}
              </div>
              <div className="flex items-center justify-between text-[10px] text-zinc-500 mt-2 px-1">
                <span>Enter to send, Shift+Enter for new line</span>
                <span>Protected by Gateway Auth</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Code Sample Studio (5 cols on XL) */}
        <div className="xl:col-span-5 flex flex-col gap-4 sticky top-6">
          <div className="p-4 rounded-2xl bg-zinc-900/60 border border-zinc-800 shadow-sm space-y-3">
            {/* Header & Tabs */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-800/80 pb-3">
              <div className="flex items-center gap-2">
                <Code2 className="w-4 h-4 text-emerald-400" />
                <h3 className="text-xs font-bold text-zinc-200">
                  {t('playground.codeSamples')}
                </h3>
              </div>

              {/* Language Switcher Tabs */}
              <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-xl border border-zinc-800">
                <button
                  type="button"
                  onClick={() => setActiveLang('curl')}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-mono transition-all ${
                    activeLang === 'curl'
                      ? 'bg-emerald-500 text-zinc-950 font-bold shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  cURL
                </button>
                <button
                  type="button"
                  onClick={() => setActiveLang('python')}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-mono transition-all ${
                    activeLang === 'python'
                      ? 'bg-emerald-500 text-zinc-950 font-bold shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Python
                </button>
                <button
                  type="button"
                  onClick={() => setActiveLang('node')}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-mono transition-all ${
                    activeLang === 'node'
                      ? 'bg-emerald-500 text-zinc-950 font-bold shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Node.js
                </button>
                <button
                  type="button"
                  onClick={() => setActiveLang('fetch')}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-mono transition-all ${
                    activeLang === 'fetch'
                      ? 'bg-emerald-500 text-zinc-950 font-bold shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Fetch
                </button>
              </div>
            </div>

            {/* Code Display Container */}
            <div className="relative rounded-xl bg-zinc-950 border border-zinc-800 overflow-hidden shadow-inner">
              <div className="flex items-center justify-between px-3 py-2 bg-zinc-900/90 border-b border-zinc-800 text-[11px] text-zinc-400">
                <div className="flex items-center gap-2">
                  {activeLang === 'curl' && <Terminal className="w-3.5 h-3.5 text-amber-400" />}
                  {activeLang === 'python' && <Code2 className="w-3.5 h-3.5 text-blue-400" />}
                  {activeLang === 'node' && <Cpu className="w-3.5 h-3.5 text-emerald-400" />}
                  {activeLang === 'fetch' && <Globe className="w-3.5 h-3.5 text-teal-400" />}
                  <span className="font-mono text-zinc-300">
                    {activeLang === 'curl' && 'bash / terminal'}
                    {activeLang === 'python' && 'openai-python >= 1.0.0'}
                    {activeLang === 'node' && 'openai-node >= 4.0.0'}
                    {activeLang === 'fetch' && 'standard fetch API'}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={handleCopyCode}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium transition-all shadow-sm"
                  title={t('playground.copyCode')}
                >
                  {copiedCode ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400">
                        {t('playground.copied')}
                      </span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-zinc-400" />
                      <span>{t('playground.copyCode')}</span>
                    </>
                  )}
                </button>
              </div>

              <pre className="p-4 text-xs font-mono text-emerald-400/90 overflow-x-auto max-h-[580px] leading-relaxed whitespace-pre selection:bg-emerald-500/30 selection:text-emerald-200">
                <code>{generatedCode}</code>
              </pre>
            </div>

            <div className="p-3 rounded-xl bg-zinc-950/60 border border-zinc-800 text-[11px] text-zinc-400 flex items-center justify-between">
              <span>
                Model: <code className="text-zinc-200 font-mono">{selectedModel}</code>
              </span>
              <span>
                Stream: <code className="text-zinc-200 font-mono">{stream ? 'true' : 'false'}</code>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

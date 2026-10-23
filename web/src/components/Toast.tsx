import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, HelpCircle } from 'lucide-react';
import { useTranslation } from '../i18n';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

interface ConfirmOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  warning: (message: string) => void;
  confirm: (message: string, options?: ConfirmOptions) => Promise<boolean>;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TOAST_ICONS: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle2 className="w-5 h-5 text-emerald-400" />,
  error: <AlertTriangle className="w-5 h-5 text-rose-400" />,
  info: <Info className="w-5 h-5 text-sky-400" />,
  warning: <AlertTriangle className="w-5 h-5 text-amber-400" />,
};

const TOAST_STYLES: Record<ToastType, string> = {
  success: 'border-emerald-500/30',
  error: 'border-rose-500/30',
  info: 'border-sky-500/30',
  warning: 'border-amber-500/30',
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t } = useTranslation();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmState, setConfirmState] = useState<{
    message: string;
    options: ConfirmOptions;
    resolve: (value: boolean) => void;
  } | null>(null);
  const idRef = useRef(0);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const pushToast = useCallback(
    (message: string, type: ToastType = 'info') => {
      const id = ++idRef.current;
      setToasts((prev) => [...prev, { id, type, message }]);
      window.setTimeout(() => dismissToast(id), 5000);
    },
    [dismissToast],
  );

  const toast = useCallback((message: string, type: ToastType = 'info') => pushToast(message, type), [pushToast]);
  const success = useCallback((message: string) => pushToast(message, 'success'), [pushToast]);
  const error = useCallback((message: string) => pushToast(message, 'error'), [pushToast]);
  const info = useCallback((message: string) => pushToast(message, 'info'), [pushToast]);
  const warning = useCallback((message: string) => pushToast(message, 'warning'), [pushToast]);

  const confirm = useCallback(
    (message: string, options: ConfirmOptions = {}) =>
      new Promise<boolean>((resolve) => {
        setConfirmState({ message, options, resolve });
      }),
    [],
  );

  const handleConfirm = (value: boolean) => {
    confirmState?.resolve(value);
    setConfirmState(null);
  };

  return (
    <ToastContext.Provider value={{ toast, success, error, info, warning, confirm }}>
      {children}

      {/* Toast stack */}
      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)]">
        {toasts.map((item) => (
          <div
            key={item.id}
            className={`flex items-start gap-2.5 bg-zinc-900/95 backdrop-blur border rounded-xl px-4 py-3 shadow-xl transition-all duration-200 ${TOAST_STYLES[item.type]}`}
          >
            <span className="mt-0.5 shrink-0">{TOAST_ICONS[item.type]}</span>
            <span className="flex-1 text-xs leading-relaxed text-zinc-200 break-words">{item.message}</span>
            <button
              type="button"
              onClick={() => dismissToast(item.id)}
              className="shrink-0 text-zinc-500 hover:text-zinc-200 transition-colors"
              aria-label={t('common.close')}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      {/* Confirm modal */}
      {confirmState && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-[110]">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-sm p-6 space-y-4 shadow-2xl">
            <div className="flex items-start gap-3">
              <span
                className={`mt-0.5 shrink-0 ${
                  confirmState.options.danger ? 'text-rose-400' : 'text-emerald-400'
                }`}
              >
                <HelpCircle className="w-5 h-5" />
              </span>
              <div className="space-y-1">
                {confirmState.options.title && (
                  <h3 className="text-sm font-bold text-zinc-100">{confirmState.options.title}</h3>
                )}
                <p className="text-xs leading-relaxed text-zinc-300 break-words">{confirmState.message}</p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => handleConfirm(false)}
                className="px-3.5 py-2 text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                {confirmState.options.cancelLabel || t('common.cancel')}
              </button>
              <button
                type="button"
                data-testid="confirm-dialog-confirm"
                onClick={() => handleConfirm(true)}
                className={`px-4 py-2 rounded-lg text-zinc-950 text-xs font-semibold shadow-md transition-all ${
                  confirmState.options.danger
                    ? 'bg-rose-500 hover:bg-rose-600'
                    : 'bg-emerald-500 hover:bg-emerald-600'
                }`}
              >
                {confirmState.options.confirmLabel || t('common.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
};

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return ctx;
}
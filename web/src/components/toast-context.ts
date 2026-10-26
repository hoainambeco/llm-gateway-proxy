import { createContext, useContext } from 'react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ConfirmOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  warning: (message: string) => void;
  confirm: (message: string, options?: ConfirmOptions) => Promise<boolean>;
}

/**
 * Shared between the provider and its consumers. It lives here rather than in
 * `Toast.tsx` so that file stays component-only and Fast Refresh keeps working.
 */
export const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return ctx;
}

'use client';

import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { AlertCircle, CheckCircle2, AlertTriangle, Info, X, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ToastType = 'error' | 'success' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
  duration?: number;
}

interface ToastContextType {
  toasts: ToastItem[];
  addToast: (toast: Omit<ToastItem, 'id'>) => string;
  removeToast: (id: string) => void;
  error: (message: string, title?: string) => string;
  success: (message: string, title?: string) => string;
  warning: (message: string, title?: string) => string;
  info: (message: string, title?: string) => string;
}

const ToastContext = createContext<ToastContextType | null>(null);

let externalAddToast: ((toast: Omit<ToastItem, 'id'>) => string) | null = null;

export const toast = {
  error: (message: string, title?: string) => {
    if (externalAddToast) return externalAddToast({ type: 'error', message, title });
    console.error(`[Toast Error] ${title ? `${title}: ` : ''}${message}`);
    return '';
  },
  success: (message: string, title?: string) => {
    if (externalAddToast) return externalAddToast({ type: 'success', message, title });
    console.log(`[Toast Success] ${title ? `${title}: ` : ''}${message}`);
    return '';
  },
  warning: (message: string, title?: string) => {
    if (externalAddToast) return externalAddToast({ type: 'warning', message, title });
    console.warn(`[Toast Warning] ${title ? `${title}: ` : ''}${message}`);
    return '';
  },
  info: (message: string, title?: string) => {
    if (externalAddToast) return externalAddToast({ type: 'info', message, title });
    console.info(`[Toast Info] ${title ? `${title}: ` : ''}${message}`);
    return '';
  },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    ({ type, title, message, duration = 5000 }: Omit<ToastItem, 'id'>) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const newToast: ToastItem = { id, type, title, message, duration };

      setToasts((prev) => [newToast, ...prev].slice(0, 5)); // Keep max 5 active toasts

      if (duration > 0) {
        setTimeout(() => {
          removeToast(id);
        }, duration);
      }

      return id;
    },
    [removeToast]
  );

  // Bind singleton toast helper
  externalAddToast = addToast;

  const value = useMemo(
    () => ({
      toasts,
      addToast,
      removeToast,
      error: (message: string, title?: string) => addToast({ type: 'error', message, title }),
      success: (message: string, title?: string) => addToast({ type: 'success', message, title }),
      warning: (message: string, title?: string) => addToast({ type: 'warning', message, title }),
      info: (message: string, title?: string) => addToast({ type: 'info', message, title }),
    }),
    [toasts, addToast, removeToast]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Toast Render Container: Fixed Top-Right */}
      <div
        aria-live="assertive"
        className="fixed top-4 right-4 z-50 flex flex-col gap-2.5 max-w-sm w-full pointer-events-none select-none"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="alert"
            className={cn(
              'pointer-events-auto flex items-start gap-3 p-3.5 rounded-xl border shadow-lg backdrop-blur-md transition-all duration-300 animate-in slide-in-from-top-2 fade-in',
              t.type === 'error' &&
                'bg-red-50/95 border-red-200 text-red-900 dark:bg-zinc-950/95 dark:border-red-900/80 dark:text-red-200',
              t.type === 'success' &&
                'bg-emerald-50/95 border-emerald-200 text-emerald-900 dark:bg-zinc-950/95 dark:border-emerald-900/80 dark:text-emerald-200',
              t.type === 'warning' &&
                'bg-amber-50/95 border-amber-200 text-amber-900 dark:bg-zinc-950/95 dark:border-amber-900/80 dark:text-amber-200',
              t.type === 'info' &&
                'bg-blue-50/95 border-blue-200 text-blue-900 dark:bg-zinc-950/95 dark:border-blue-900/80 dark:text-blue-200'
            )}
          >
            {/* Icon */}
            <div className="shrink-0 mt-0.5">
              {t.type === 'error' && <ShieldAlert className="w-5 h-5 text-red-600 dark:text-red-400" />}
              {t.type === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />}
              {t.type === 'warning' && <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />}
              {t.type === 'info' && <Info className="w-5 h-5 text-blue-600 dark:text-blue-400" />}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              {t.title && (
                <h4 className="text-xs font-bold leading-tight mb-0.5">
                  {t.title}
                </h4>
              )}
              <p className="text-xs font-normal leading-relaxed opacity-95 break-words">
                {t.message}
              </p>
            </div>

            {/* Dismiss Close Button */}
            <button
              type="button"
              onClick={() => removeToast(t.id)}
              className="shrink-0 p-1 rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
              title="Dismiss notification"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    return toast;
  }
  return context;
}

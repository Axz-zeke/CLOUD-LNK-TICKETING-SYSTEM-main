'use client';

import React from 'react';
import { createPortal } from 'react-dom';
import { X, ShieldCheck, Database } from 'lucide-react';
import { SystemHealthBackupCard } from '@/components/admin/SystemHealthBackupCard';

export interface AdminPanelModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRefreshParent?: () => void;
}

export function AdminPanelModal({ isOpen, onClose, onRefreshParent }: AdminPanelModalProps) {
  if (!isOpen) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className="relative w-full max-w-5xl max-h-[90vh] bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-900 dark:text-zinc-100"
        role="dialog"
        aria-modal="true"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/80 backdrop-blur sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 dark:bg-purple-950 text-purple-600 dark:text-purple-400 rounded-xl border border-purple-200 dark:border-purple-800">
              <ShieldCheck className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <h2 className="text-base font-semibold leading-tight text-slate-900 dark:text-white flex items-center gap-2">
                <span>Enterprise System Health & Database Backup</span>
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300 border border-purple-200 dark:border-purple-800 font-bold">
                  SUPERADMIN
                </span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-zinc-400">
                Live SQLite WAL Engine diagnostics, hot snapshots & disk optimization
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-slate-100 dark:hover:bg-zinc-800 rounded-xl transition-colors cursor-pointer"
            title="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6">
          <SystemHealthBackupCard onRefreshParent={onRefreshParent} />
        </div>
      </div>
    </div>,
    document.body
  );
}

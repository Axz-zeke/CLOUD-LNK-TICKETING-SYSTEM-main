'use client';

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Compass,
  X,
  Layers,
  LayoutGrid,
  ShieldCheck,
  Clock,
  Sparkles,
  ArrowRight,
  Calendar,
  Sun,
} from 'lucide-react';
import { SITE_CONFIG } from '@/lib/constants';

interface WelcomeModalProps {
  isOpen: boolean;
  onStartTour: () => void;
  onSkip: () => void;
}

export function WelcomeModal({
  isOpen,
  onStartTour,
  onSkip,
}: WelcomeModalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!isOpen || !mounted || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[9990] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity animate-in fade-in duration-200"
        onClick={onSkip}
      />

      {/* Modal Dialog Card */}
      <div className="relative z-10 w-full max-w-lg bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 text-zinc-900 dark:text-zinc-100">
        {/* Decorative Top Accent Banner */}
        <div className="h-1.5 w-full bg-gradient-to-r from-blue-600 via-indigo-500 to-purple-600" />

        <div className="p-6 sm:p-7 space-y-6">
          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1.5">
              <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700 dark:bg-blue-950/80 dark:text-blue-300 border border-blue-200 dark:border-blue-800/80">
                <ShieldCheck className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                <span>Internal Service Desk</span>
              </div>
              <h2 className="text-xl font-bold tracking-tight text-zinc-950 dark:text-white">
                Welcome to {SITE_CONFIG.name}
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                Your air-gapped internal ticketing and service desk platform for {SITE_CONFIG.company}.
              </p>
            </div>

            <button
              type="button"
              onClick={onSkip}
              className="p-1.5 text-zinc-400 hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-200 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-900 transition-colors cursor-pointer shrink-0"
              title="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Quick Overview Highlights */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-zinc-900/60 border border-slate-200/80 dark:border-zinc-800/80 space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-900 dark:text-zinc-200">
                <LayoutGrid className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                <span>4-Mode Workspace</span>
              </div>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-snug">
                Switch instantly between List, Kanban Board, Gantt, and Dashboard.
              </p>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 dark:bg-zinc-900/60 border border-slate-200/80 dark:border-zinc-800/80 space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-900 dark:text-zinc-200">
                <Calendar className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                <span>Date Range Filter</span>
              </div>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-snug">
                Historical presets & 2-column interactive custom calendar picker.
              </p>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 dark:bg-zinc-900/60 border border-slate-200/80 dark:border-zinc-800/80 space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-900 dark:text-zinc-200">
                <Layers className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                <span>Dept Queues & Handoffs</span>
              </div>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-snug">
                RBAC space isolation with cross-department ticket transfers.
              </p>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 dark:bg-zinc-900/60 border border-slate-200/80 dark:border-zinc-800/80 space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-900 dark:text-zinc-200">
                <Sun className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                <span>Low-Glare Dual Theme</span>
              </div>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-snug">
                Sleek Dark Mode and Soft Daylight Light Mode with zero eye glare.
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-slate-100 dark:border-zinc-800/80">
            <button
              type="button"
              onClick={onSkip}
              className="w-full sm:w-auto px-4 py-2 text-xs font-medium text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-900 transition-colors cursor-pointer text-center"
            >
              Skip for Now
            </button>

            <button
              type="button"
              onClick={onStartTour}
              className="w-full sm:w-auto px-5 py-2.5 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-xl shadow-md shadow-blue-600/20 flex items-center justify-center gap-2 transition-all cursor-pointer group"
            >
              <Compass className="w-4 h-4 group-hover:rotate-45 transition-transform" />
              <span>Start Interactive Tour</span>
              <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

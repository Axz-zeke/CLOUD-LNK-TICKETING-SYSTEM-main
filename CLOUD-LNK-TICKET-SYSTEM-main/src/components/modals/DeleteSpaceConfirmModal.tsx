'use client';

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  X,
  Lock,
  Eye,
  EyeOff,
  Trash2,
  Loader2,
  Check,
  ShieldAlert,
} from 'lucide-react';
import { useOptionalWorkspace } from '@/context/workspace-context';

export interface DeleteSpaceConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetSpace?: {
    id: string;
    name: string;
    key?: string;
  } | null;
  space?: {
    id: string;
    name: string;
    key?: string;
  } | null;
  onDeleted?: () => void;
}

export function DeleteSpaceConfirmModal({
  isOpen,
  onClose,
  targetSpace,
  space,
  onDeleted,
}: DeleteSpaceConfirmModalProps) {
  const target = targetSpace || space;
  const workspaceContext = useOptionalWorkspace();

  const [mounted, setMounted] = useState(false);
  const [nameConfirm, setNameConfirm] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Reset inputs when opening modal or changing target space
  useEffect(() => {
    if (isOpen) {
      setNameConfirm('');
      setPassword('');
      setShowPassword(false);
      setError(null);
      setPasswordError(null);
      setIsDeleting(false);
    }
  }, [isOpen, target?.id]);

  if (!isOpen || !target || !mounted) return null;

  const isNameMatched = nameConfirm.trim() === target.name.trim();
  const canDelete = isNameMatched && password.trim().length > 0 && !isDeleting;

  const handleDelete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canDelete) return;

    setIsDeleting(true);
    setError(null);
    setPasswordError(null);

    try {
      const res = await fetch(`/api/admin/spaces/${target.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ superadminPassword: password }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 401 || data.error === 'INVALID_CREDENTIALS') {
          setPasswordError(data.message || 'Incorrect password. Verification failed.');
        } else {
          setError(data.message || data.error || 'Failed to delete department space.');
        }
        setIsDeleting(false);
        return;
      }

      // Success: instantly remove from workspace React state & client cache (0ms removal)
      if (workspaceContext?.optimisticRemoveSpace) {
        workspaceContext.optimisticRemoveSpace(target.id);
      } else if (workspaceContext?.currentSpace?.id === target.id && workspaceContext?.selectFastView) {
        workspaceContext.selectFastView('everything');
      }

      // Background refresh to ensure full backend synchronization
      if (workspaceContext?.refreshSpaces) {
        workspaceContext.refreshSpaces().catch(() => {});
      }

      onDeleted?.();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Network error occurred while deleting space.');
      setIsDeleting(false);
    }
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-space-modal-title"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6 overflow-y-auto animate-in fade-in duration-200"
    >
      <div className="bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 rounded-2xl shadow-2xl max-w-lg w-full flex flex-col overflow-hidden animate-in zoom-in-95 duration-150 text-zinc-900 dark:text-zinc-100">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-red-200/60 dark:border-red-950/80 bg-red-50/60 dark:bg-red-950/20 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-100 dark:bg-red-950/80 border border-red-200 dark:border-red-800 flex items-center justify-center text-red-600 dark:text-red-400 shrink-0 shadow-xs">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h3
                id="delete-space-modal-title"
                className="text-sm sm:text-base font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2"
              >
                Delete Department Space
                <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-red-600/10 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/60 font-semibold">
                  Danger Zone
                </span>
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Permanent deletion requiring Superadmin authorization
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            aria-label="Close dialog"
            className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content & Form */}
        <form onSubmit={handleDelete} className="p-6 space-y-5">
          {/* General Error Banner */}
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 rounded-xl text-xs text-red-700 dark:text-red-300 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Warning Callout */}
          <div className="p-3.5 bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 rounded-xl space-y-1.5">
            <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300 font-semibold text-xs">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <span>Irreversible Action Warning</span>
            </div>
            <p className="text-xs text-amber-900/90 dark:text-amber-200/80 leading-relaxed pl-6">
              This will permanently delete the department space{' '}
              <strong className="font-semibold text-zinc-900 dark:text-white">
                {target.name} {target.key ? `(${target.key})` : ''}
              </strong>{' '}
              and cascade-delete all associated{' '}
              <strong className="underline">tickets, comments, attachments, queue lists, and member assignments</strong>.
              This operation cannot be undone.
            </p>
          </div>

          {/* Step 1: Confirm Space Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 flex items-center justify-between">
              <span>
                1. To confirm, type <span className="font-mono text-red-600 dark:text-red-400 font-bold">&quot;{target.name}&quot;</span> below:
              </span>
              {isNameMatched && (
                <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                  <Check className="w-3.5 h-3.5" />
                  Matched
                </span>
              )}
            </label>
            <input
              type="text"
              autoFocus
              value={nameConfirm}
              onChange={(e) => {
                setNameConfirm(e.target.value);
                if (error) setError(null);
              }}
              placeholder={target.name}
              disabled={isDeleting}
              className={`w-full px-3.5 py-2 text-xs rounded-xl bg-slate-50 dark:bg-zinc-900 border text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none transition-colors shadow-2xs ${
                nameConfirm.length > 0 && !isNameMatched
                  ? 'border-red-300 dark:border-red-800 focus:ring-1 focus:ring-red-500'
                  : isNameMatched
                  ? 'border-emerald-500 dark:border-emerald-500 focus:ring-1 focus:ring-emerald-500'
                  : 'border-slate-200 dark:border-zinc-800 focus:border-blue-500 focus:ring-1 focus:ring-blue-500'
              }`}
            />
          </div>

          {/* Step 2: Superadmin Password Challenge */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-zinc-400" />
              <span>2. Enter Superadmin Password:</span>
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (passwordError) setPasswordError(null);
                }}
                placeholder="Superadmin account password"
                disabled={isDeleting}
                className={`w-full pl-3.5 pr-10 py-2 text-xs rounded-xl bg-slate-50 dark:bg-zinc-900 border text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none transition-colors shadow-2xs ${
                  passwordError
                    ? 'border-red-500 focus:ring-1 focus:ring-red-500'
                    : 'border-slate-200 dark:border-zinc-800 focus:border-red-500 focus:ring-1 focus:ring-red-500'
                }`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300 transition-colors"
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {passwordError && (
              <p className="text-[11px] text-red-600 dark:text-red-400 font-medium flex items-center gap-1 mt-1">
                <AlertTriangle className="w-3 h-3 shrink-0" />
                <span>{passwordError}</span>
              </p>
            )}
          </div>

          {/* Action Buttons */}
          <div className="pt-2 flex items-center justify-end gap-2.5 border-t border-slate-200 dark:border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              disabled={isDeleting}
              className="px-4 py-2 text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canDelete}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-600/40 disabled:cursor-not-allowed text-white rounded-xl text-xs font-semibold shadow-xs transition-colors cursor-pointer"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Verifying & Deleting...</span>
                </>
              ) : (
                <>
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Permanently Delete Space</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}

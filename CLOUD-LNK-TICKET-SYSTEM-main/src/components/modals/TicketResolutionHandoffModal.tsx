'use client';

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  CheckCircle2,
  ArrowRightLeft,
  Building,
  Layers,
  MessageSquare,
  AlertCircle,
  Loader2,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { AuthenticatedUser } from '@/lib/security/rbac';
import { useOptionalWorkspace } from '@/context/workspace-context';

export interface SpaceQueueItem {
  id: string;
  name: string;
  description?: string | null;
  color?: string | null;
  isPrivate?: boolean;
}

export interface IntakeSpaceItem {
  id: string;
  name: string;
  slug?: string;
  key: string;
  lists: SpaceQueueItem[];
  departmentHead?: {
    id: string;
    name: string;
  } | null;
}

export interface TicketResolutionHandoffModalProps {
  isOpen: boolean;
  onClose: () => void;
  task: {
    id: string;
    taskKey: string;
    title: string;
    spaceId: string;
    space?: { id: string; name: string; key: string };
    listId?: string;
    list?: { id: string; name: string };
  } | null;
  currentUser: AuthenticatedUser;
  onSuccess?: (updatedTask: any, action: 'CLOSE' | 'TRANSFER') => void;
}

export function TicketResolutionHandoffModal({
  isOpen,
  onClose,
  task,
  currentUser,
  onSuccess,
}: TicketResolutionHandoffModalProps) {
  const workspaceCtx = useOptionalWorkspace();
  const workspaceCtxRef = useRef(workspaceCtx);
  workspaceCtxRef.current = workspaceCtx;

  const [mounted, setMounted] = useState(false);
  const [action, setAction] = useState<'CLOSE' | 'TRANSFER'>('CLOSE');

  // Guard refs so background polling or parent re-renders NEVER reset user selection while modal is open
  const wasOpenRef = useRef(false);
  const initializedTaskIdRef = useRef<string | null>(null);

  // Intake Spaces state
  const [intakeSpaces, setIntakeSpaces] = useState<IntakeSpaceItem[]>([]);
  const [loadingSpaces, setLoadingSpaces] = useState(false);
  const [selectedSpaceId, setSelectedSpaceId] = useState<string>('');
  const [selectedListId, setSelectedListId] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  // Submission state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Pause background delta-sync polling while Resolution/Handoff modal is open
  useEffect(() => {
    if (!isOpen) return;
    workspaceCtxRef.current?.beginTaskMutation();
    return () => {
      workspaceCtxRef.current?.endTaskMutation();
    };
  }, [isOpen]);

  const taskId = task?.id || null;
  const taskSpaceId = task?.spaceId || null;

  // Effect A: Form State Initialization (ONLY depends on [isOpen, taskId])
  // Never resets user selection while modal stays open for the same task
  useEffect(() => {
    if (!isOpen || !taskId) {
      wasOpenRef.current = false;
      initializedTaskIdRef.current = null;
      return;
    }

    const isNewlyOpened = !wasOpenRef.current || initializedTaskIdRef.current !== taskId;
    if (!isNewlyOpened) {
      return;
    }

    wasOpenRef.current = true;
    initializedTaskIdRef.current = taskId;

    setAction('CLOSE');
    setNotes('');
    setErrorMessage(null);
    setSelectedSpaceId('');
    setSelectedListId('');
  }, [isOpen, taskId]);

  // Effect B: Pre-populate from workspaceCtx in 0ms + fetch all transferable department spaces & queues
  // Depends ONLY on [isOpen, taskSpaceId] and NEVER leaves loadingSpaces stuck on true
  useEffect(() => {
    if (!isOpen) return;

    const applySpacesAndDefaultSelection = (
      spacesList: IntakeSpaceItem[],
      currentSpaceId: string | null
    ) => {
      if (!Array.isArray(spacesList) || spacesList.length === 0) return;

      setIntakeSpaces(spacesList);

      setSelectedSpaceId((prevSpaceId) => {
        const otherSpaces = spacesList.filter((s) => s.id !== currentSpaceId);
        const existingSpace = spacesList.find((s) => s.id === prevSpaceId);

        // Keep existing valid selection unless it's empty or still pointing to the current space when other spaces exist
        if (
          existingSpace &&
          (existingSpace.id !== currentSpaceId || otherSpaces.length === 0)
        ) {
          setSelectedListId((prevListId) => {
            const hasValidList = existingSpace.lists?.some((l) => l.id === prevListId);
            return hasValidList ? prevListId : existingSpace.lists?.[0]?.id || '';
          });
          return existingSpace.id;
        }

        const initialSpace = otherSpaces[0] || spacesList[0];
        if (initialSpace) {
          setSelectedListId(initialSpace.lists?.[0]?.id || '');
          return initialSpace.id;
        }
        return prevSpaceId;
      });
    };

    // 1. Pre-populate immediately in 0ms from workspaceCtx?.spaces if available
    const ctxSpaces = workspaceCtxRef.current?.spaces;
    let hasPrepopulated = false;
    if (Array.isArray(ctxSpaces) && ctxSpaces.length > 0) {
      const mappedCtxSpaces: IntakeSpaceItem[] = ctxSpaces.map((s) => ({
        id: s.id,
        name: s.name,
        slug: s.key.toLowerCase(),
        key: s.key,
        departmentHead: s.departmentHead
          ? { id: s.departmentHead.id, name: s.departmentHead.name }
          : null,
        lists: Array.isArray(s.lists)
          ? s.lists.map((l) => ({
              id: l.id,
              name: l.name,
              description: l.description || null,
              isPrivate: Boolean(l.isPrivate),
              color: l.color || null,
            }))
          : [],
      }));
      applySpacesAndDefaultSelection(mappedCtxSpaces, taskSpaceId);
      setLoadingSpaces(false);
      hasPrepopulated = true;
    }

    // 2. Fetch full organization intake spaces (including non-member departments)
    const fetchAllIntakeSpaces = async () => {
      if (!hasPrepopulated) {
        setLoadingSpaces(true);
      }
      try {
        const res = await fetch('/api/spaces/intake', { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          const fetchedSpaces: IntakeSpaceItem[] = Array.isArray(data?.spaces)
            ? data.spaces
            : Array.isArray(data)
            ? data
            : [];
          if (fetchedSpaces.length > 0) {
            applySpacesAndDefaultSelection(fetchedSpaces, taskSpaceId);
          }
        }
      } catch (err) {
        console.error('Failed to load department spaces for handoff:', err);
      } finally {
        setLoadingSpaces(false);
      }
    };

    void fetchAllIntakeSpaces();
  }, [isOpen, taskSpaceId]);

  // Update target list when selected space changes
  const handleSpaceChange = (spaceId: string) => {
    setSelectedSpaceId(spaceId);
    const space = intakeSpaces.find((s) => s.id === spaceId);
    if (space && space.lists && space.lists.length > 0) {
      setSelectedListId(space.lists[0].id);
    } else {
      setSelectedListId('');
    }
  };

  const currentTargetSpace = intakeSpaces.find((s) => s.id === selectedSpaceId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!task) return;

    if (action === 'TRANSFER') {
      if (!selectedSpaceId) {
        setErrorMessage('Please select a target department space.');
        return;
      }
      if (!selectedListId) {
        setErrorMessage('Please select a target queue in the chosen department.');
        return;
      }
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const res = await fetch(`/api/tasks/${task.id}/handoff`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action,
          targetSpaceId: action === 'TRANSFER' ? selectedSpaceId : undefined,
          targetListId: action === 'TRANSFER' ? selectedListId : undefined,
          notes: notes.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to complete ticket action.');
      }

      onSuccess?.(data.task, action);
      onClose();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'An error occurred during submission.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!mounted || !isOpen || !task) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/50 dark:bg-black/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg bg-white dark:bg-[#12151E] border border-slate-200/90 dark:border-white/10 rounded-2xl shadow-2xl shadow-blue-950/10 overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-white/10 bg-slate-50/80 dark:bg-zinc-900/50 flex items-center justify-between">
          <div className="min-w-0 pr-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950 dark:border-blue-800 dark:text-blue-300">
                {task.taskKey}
              </span>
              <span className="text-[11px] font-medium text-slate-500 dark:text-zinc-400">Resolution & Hand-off</span>
            </div>
            <h2 className="text-sm sm:text-base font-semibold text-slate-900 dark:text-zinc-100 truncate">
              {task.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:text-zinc-400 dark:hover:text-zinc-200 dark:hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {errorMessage && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 dark:bg-red-950/60 dark:border-red-800/80 rounded-xl flex items-start gap-2.5 text-xs dark:text-red-200">
              <AlertCircle className="w-4 h-4 text-red-500 dark:text-red-400 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Decision Cards */}
          <div className="space-y-3">
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-zinc-400">
              Select Ticket Progression Action
            </label>

            {/* Card 1: Permanently Close Ticket */}
            <div
              onClick={() => setAction('CLOSE')}
              className={`p-4 rounded-xl border transition-all cursor-pointer flex items-start gap-3 ${
                action === 'CLOSE'
                  ? 'bg-emerald-50/70 border-emerald-500 ring-1 ring-emerald-500/20 dark:bg-emerald-950/30 dark:border-emerald-500/60 dark:ring-emerald-500/30'
                  : 'bg-slate-50/70 border-slate-200 hover:border-blue-300 hover:bg-blue-50/30 dark:bg-zinc-900/60 dark:border-zinc-800 dark:hover:border-zinc-700 dark:hover:bg-zinc-900'
              }`}
            >
              <div
                className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                  action === 'CLOSE'
                    ? 'bg-emerald-600 text-white dark:bg-emerald-500 dark:text-zinc-950'
                    : 'border border-slate-300 bg-white dark:border-zinc-700 dark:bg-zinc-800'
                }`}
              >
                {action === 'CLOSE' && <CheckCircle2 className="w-3.5 h-3.5" />}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-zinc-100">Permanently Close Ticket</h3>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800">
                    RESOLVED
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-zinc-400 mt-1">
                  Marks the issue as completely resolved. Closes the ticket and stops SLA active tracking.
                </p>
              </div>
            </div>

            {/* Card 2: Hand-off / Transfer to Another Department */}
            <div
              onClick={() => setAction('TRANSFER')}
              className={`p-4 rounded-xl border transition-all cursor-pointer flex items-start gap-3 ${
                action === 'TRANSFER'
                  ? 'bg-blue-50/80 border-blue-600 ring-1 ring-blue-600/20 dark:bg-blue-950/30 dark:border-blue-500/60 dark:ring-blue-500/30'
                  : 'bg-slate-50/70 border-slate-200 hover:border-blue-300 hover:bg-blue-50/30 dark:bg-zinc-900/60 dark:border-zinc-800 dark:hover:border-zinc-700 dark:hover:bg-zinc-900'
              }`}
            >
              <div
                className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                  action === 'TRANSFER'
                    ? 'bg-blue-600 text-white dark:bg-blue-500 dark:text-zinc-950'
                    : 'border border-slate-300 bg-white dark:border-zinc-700 dark:bg-zinc-800'
                }`}
              >
                {action === 'TRANSFER' && <ArrowRightLeft className="w-3.5 h-3.5" />}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-zinc-100">
                    Hand-off / Transfer to Another Department
                  </h3>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 border border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800">
                    RESETS TO OPEN
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-zinc-400 mt-1">
                  Transfers ticket ownership to another department queue for subsequent steps (e.g. IT spec validation, PO release).
                </p>
              </div>
            </div>
          </div>

          {/* Department and Queue Selection (Visible only when action === 'TRANSFER') */}
          {action === 'TRANSFER' && (
            <div className="p-4 bg-slate-50 border border-slate-200 dark:bg-zinc-900/80 dark:border-zinc-800 rounded-xl space-y-3.5 animate-in fade-in duration-200">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Target Department */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-slate-700 dark:text-zinc-400 flex items-center gap-1.5">
                    <Building className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                    <span>Target Department Space</span>
                  </label>
                  {loadingSpaces ? (
                    <div className="p-2.5 bg-white border border-slate-300 dark:bg-zinc-950 dark:border-zinc-800 rounded-lg text-xs text-slate-500 dark:text-zinc-500 flex items-center gap-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
                      <span>Loading spaces...</span>
                    </div>
                  ) : (
                    <select
                      value={selectedSpaceId}
                      onChange={(e) => handleSpaceChange(e.target.value)}
                      className="w-full bg-white border border-slate-300 dark:bg-zinc-950 dark:border-zinc-800 rounded-lg px-2.5 py-2 text-xs text-slate-800 dark:text-zinc-200 focus:outline-none focus:border-blue-600 dark:focus:border-blue-500 cursor-pointer"
                    >
                      {intakeSpaces.map((space) => (
                        <option key={space.id} value={space.id}>
                          {space.name} ({space.key})
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Target Queue */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-slate-700 dark:text-zinc-400 flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                    <span>Target Queue</span>
                  </label>
                  <select
                    value={selectedListId}
                    onChange={(e) => setSelectedListId(e.target.value)}
                    disabled={!currentTargetSpace?.lists || currentTargetSpace.lists.length === 0}
                    className="w-full bg-white border border-slate-300 dark:bg-zinc-950 dark:border-zinc-800 rounded-lg px-2.5 py-2 text-xs text-slate-800 dark:text-zinc-200 focus:outline-none focus:border-blue-600 dark:focus:border-blue-500 cursor-pointer disabled:opacity-50"
                  >
                    {currentTargetSpace?.lists && currentTargetSpace.lists.length > 0 ? (
                      currentTargetSpace.lists.map((list) => (
                        <option key={list.id} value={list.id}>
                          {list.name} {list.isPrivate ? '(Private)' : ''}
                        </option>
                      ))
                    ) : (
                      <option value="">No queues available</option>
                    )}
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Hand-off Remarks / Notes */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-slate-700 dark:text-zinc-400 flex items-center gap-1.5">
              <MessageSquare className="w-3.5 h-3.5 text-slate-500 dark:text-zinc-400" />
              <span>
                {action === 'TRANSFER' ? 'Hand-off Notes & Remarks' : 'Closure Remarks (Optional)'}
              </span>
            </label>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={
                action === 'TRANSFER'
                  ? 'e.g. Quotation reviewed and approved. Handing over to IT for technical hardware spec validation.'
                  : 'e.g. Resolved customer request via phone. All items confirmed delivered.'
              }
              className="w-full bg-white border border-slate-300 dark:bg-zinc-900 dark:border-zinc-800 rounded-xl p-3 text-xs text-slate-800 dark:text-zinc-100 placeholder-slate-400 dark:placeholder-zinc-500 focus:outline-none focus:border-blue-600 dark:focus:border-blue-500 transition-colors resize-none"
            />
          </div>

          {/* Footer Actions */}
          <div className="pt-3 border-t border-slate-200 dark:border-zinc-800/80 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 dark:bg-transparent dark:border-transparent dark:text-zinc-400 dark:hover:text-zinc-200 dark:hover:bg-zinc-800 rounded-xl transition-colors cursor-pointer"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={isSubmitting}
              className={`px-5 py-2 text-xs font-semibold rounded-xl text-white shadow-sm transition-all flex items-center gap-2 cursor-pointer ${
                action === 'TRANSFER'
                  ? 'bg-blue-600 hover:bg-blue-700 shadow-blue-600/20'
                  : 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/20'
              }`}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Processing...</span>
                </>
              ) : action === 'TRANSFER' ? (
                <>
                  <ArrowRightLeft className="w-3.5 h-3.5" />
                  <span>Confirm Transfer</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Close Ticket</span>
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

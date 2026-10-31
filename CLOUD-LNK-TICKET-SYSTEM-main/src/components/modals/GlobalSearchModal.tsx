'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Search,
  X,
  Loader2,
  Ticket,
  Folder,
  Layers,
  MessageSquare,
  ArrowRight,
  CornerDownLeft,
  ArrowUp,
  ArrowDown,
  User,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import { useWorkspace } from '@/context/workspace-context';
import { AuthenticatedUser } from '@/lib/security/rbac';

export interface SearchTicket {
  id: string;
  taskKey: string;
  title: string;
  description?: string | null;
  priority: string;
  isCollaborated: boolean;
  space: {
    id: string;
    name: string;
    slug: string;
    key: string;
    color: string;
  };
  list: {
    id: string;
    name: string;
    color?: string | null;
  } | null;
  status: {
    id: string;
    name: string;
    color: string;
    isCompleted: boolean;
    isClosed: boolean;
  };
  assignee: {
    id: string;
    name: string;
    username: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface SearchSpaceQueue {
  id: string;
  type: 'space' | 'queue';
  spaceId: string;
  spaceName: string;
  spaceKey: string;
  listId: string | null;
  listName: string | null;
  color: string;
}

export interface SearchComment {
  id: string;
  snippet: string;
  isInternal: boolean;
  createdAt: string;
  author: {
    id: string;
    name: string;
    username: string;
  };
  task: {
    id: string;
    taskKey: string;
    title: string;
    spaceId: string;
    spaceName: string;
    spaceKey: string;
    spaceColor: string;
  };
}

export interface GlobalSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser?: AuthenticatedUser;
}

type FlatItem =
  | { type: 'ticket'; item: SearchTicket }
  | { type: 'space'; item: SearchSpaceQueue }
  | { type: 'comment'; item: SearchComment };

function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query || query.length < 2) return <span>{text}</span>;
  const cleanQ = query.startsWith('#') || query.startsWith('@') ? query.slice(1).trim() : query;
  if (!cleanQ) return <span>{text}</span>;

  const regex = new RegExp(`(${cleanQ.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = text.split(regex);

  return (
    <span>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark
            key={i}
            className="bg-amber-500/25 text-amber-900 dark:text-amber-200 font-semibold rounded-xs px-0.5"
          >
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </span>
  );
}

export function GlobalSearchModal({ isOpen, onClose, currentUser }: GlobalSearchModalProps) {
  const { selectSpace, selectList, setSelectedTaskId } = useWorkspace();

  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [tickets, setTickets] = useState<SearchTicket[]>([]);
  const [spaces, setSpaces] = useState<SearchSpaceQueue[]>([]);
  const [comments, setComments] = useState<SearchComment[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Focus input whenever opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
    } else {
      setQuery('');
      setTickets([]);
      setSpaces([]);
      setComments([]);
      setSelectedIndex(0);
    }
  }, [isOpen]);

  // Debounced search fetch
  useEffect(() => {
    if (!isOpen) return;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setTickets([]);
      setSpaces([]);
      setComments([]);
      setIsLoading(false);
      setSelectedIndex(0);
      return;
    }

    setIsLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}&limit=15`);
        if (res.ok) {
          const data = await res.json();
          setTickets(data.tickets || []);
          setSpaces(data.spaces || []);
          setComments(data.comments || []);
          setSelectedIndex(0);
        }
      } catch (err) {
        console.error('Failed to search workspace:', err);
      } finally {
        setIsLoading(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [query, isOpen]);

  // Flattened items array for unified keyboard navigation
  const flatItems: FlatItem[] = useMemo(() => {
    const list: FlatItem[] = [];
    tickets.forEach((t) => list.push({ type: 'ticket', item: t }));
    spaces.forEach((s) => list.push({ type: 'space', item: s }));
    comments.forEach((c) => list.push({ type: 'comment', item: c }));
    return list;
  }, [tickets, spaces, comments]);

  // Clamp selectedIndex when items change
  useEffect(() => {
    if (flatItems.length === 0) {
      setSelectedIndex(0);
    } else if (selectedIndex >= flatItems.length) {
      setSelectedIndex(flatItems.length - 1);
    }
  }, [flatItems, selectedIndex]);

  // Handle select action
  const handleSelectItem = useCallback(
    (item: FlatItem) => {
      if (item.type === 'ticket') {
        setSelectedTaskId(item.item.id);
        onClose();
      } else if (item.type === 'space') {
        if (item.item.listId) {
          selectList(item.item.spaceId, item.item.listId);
        } else {
          selectSpace(item.item.spaceId);
        }
        onClose();
      } else if (item.type === 'comment') {
        setSelectedTaskId(item.item.task.id);
        onClose();
      }
    },
    [setSelectedTaskId, selectList, selectSpace, onClose]
  );

  // Global Keydown Handler for navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }

    if (flatItems.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % flatItems.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + flatItems.length) % flatItems.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const current = flatItems[selectedIndex];
      if (current) {
        handleSelectItem(current);
      }
    }
  };

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return;
    const activeEl = listRef.current.querySelector('[data-active="true"]');
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  if (!isOpen) return null;

  let currentGlobalIdx = 0;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-start justify-center pt-16 sm:pt-24 px-4 animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-2xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl shadow-2xl flex flex-col overflow-hidden text-zinc-900 dark:text-zinc-100 animate-in zoom-in-95 duration-100"
        onKeyDown={handleKeyDown}
      >
        {/* Search Bar Input */}
        <div className="relative flex items-center px-4 py-3 border-b border-slate-200 dark:border-zinc-800 bg-slate-50/50 dark:bg-zinc-900/60">
          <Search className="w-5 h-5 text-zinc-400 shrink-0 mr-3" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tickets, spaces, queues, or notes... (Type # for spaces, @ for people)"
            className="w-full bg-transparent text-sm sm:text-base outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500 font-medium"
          />

          <div className="flex items-center gap-1.5 ml-2 shrink-0">
            {isLoading && <Loader2 className="w-4 h-4 text-blue-500 animate-spin mr-1" />}
            {query.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  inputRef.current?.focus();
                }}
                className="p-1 rounded text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-slate-200 dark:hover:bg-zinc-800 transition-colors"
                title="Clear input"
              >
                <X className="w-4 h-4" />
              </button>
            )}
            <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono font-semibold text-zinc-500 bg-slate-200/70 dark:bg-zinc-800 border border-slate-300 dark:border-zinc-700 rounded shadow-xs">
              ESC
            </kbd>
          </div>
        </div>

        {/* Quick Filter Filter Chips */}
        <div className="px-4 py-2 border-b border-slate-200/70 dark:border-zinc-800/70 bg-slate-100/40 dark:bg-zinc-950/40 flex items-center gap-2 overflow-x-auto text-[11px] text-zinc-500">
          <span className="font-medium shrink-0">Filter:</span>
          <button
            type="button"
            onClick={() => {
              setQuery((prev) => (prev.startsWith('#') ? prev.slice(1).trim() : `# ${prev.trim()}`));
              inputRef.current?.focus();
            }}
            className={`px-2 py-0.5 rounded-full border transition-colors cursor-pointer shrink-0 ${
              query.startsWith('#')
                ? 'bg-blue-100 dark:bg-blue-950/80 border-blue-400 text-blue-700 dark:text-blue-300'
                : 'border-slate-200 dark:border-zinc-800 hover:bg-slate-200/50 dark:hover:bg-zinc-800'
            }`}
          >
            # Spaces & Queues
          </button>
          <button
            type="button"
            onClick={() => {
              setQuery((prev) => (prev.startsWith('@') ? prev.slice(1).trim() : `@ ${prev.trim()}`));
              inputRef.current?.focus();
            }}
            className={`px-2 py-0.5 rounded-full border transition-colors cursor-pointer shrink-0 ${
              query.startsWith('@')
                ? 'bg-blue-100 dark:bg-blue-950/80 border-blue-400 text-blue-700 dark:text-blue-300'
                : 'border-slate-200 dark:border-zinc-800 hover:bg-slate-200/50 dark:hover:bg-zinc-800'
            }`}
          >
            @ Assignees & Authors
          </button>
        </div>

        {/* Results Container */}
        <div
          ref={listRef}
          className="max-h-[380px] sm:max-h-[440px] overflow-y-auto divide-y divide-slate-100 dark:divide-zinc-800/60 p-2 scrollbar-thin scrollbar-thumb-zinc-700/60 scrollbar-track-transparent custom-scrollbar"
        >
          {/* Empty / Prompt States */}
          {query.trim().length < 2 && (
            <div className="py-12 text-center text-xs text-zinc-400 dark:text-zinc-500 space-y-2">
              <div className="inline-flex p-3 rounded-full bg-slate-100 dark:bg-zinc-800/60 text-zinc-400 dark:text-zinc-500 mb-1">
                <Search className="w-5 h-5" />
              </div>
              <p className="font-medium text-zinc-600 dark:text-zinc-300">
                Type at least 2 characters to search
              </p>
              <p className="text-[11px] max-w-sm mx-auto">
                Strict RBAC guarantees zero data leakage. Search tickets, department spaces, and internal notes you hold clearance for.
              </p>
            </div>
          )}

          {query.trim().length >= 2 && !isLoading && flatItems.length === 0 && (
            <div className="py-12 text-center text-xs text-zinc-400 dark:text-zinc-500 space-y-2">
              <div className="inline-flex p-3 rounded-full bg-slate-100 dark:bg-zinc-800/60 text-zinc-400 mb-1">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <p className="font-medium text-zinc-600 dark:text-zinc-300">
                No matching results found
              </p>
              <p className="text-[11px] max-w-sm mx-auto">
                No tickets, spaces, or discussion notes matched &ldquo;{query}&rdquo; within your authorized department scope.
              </p>
            </div>
          )}

          {/* Section 1: Spaces & Queues */}
          {spaces.length > 0 && (
            <div className="pb-2">
              <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 flex items-center gap-1.5">
                <Folder className="w-3 h-3" />
                <span>Spaces & Department Queues ({spaces.length})</span>
              </div>
              <div className="space-y-1">
                {spaces.map((s) => {
                  const idx = currentGlobalIdx++;
                  const isSelected = selectedIndex === idx;
                  return (
                    <div
                      key={`space-${s.id}-${s.type}`}
                      data-active={isSelected}
                      onClick={() => handleSelectItem({ type: 'space', item: s })}
                      className={`px-3 py-2 rounded-lg flex items-center justify-between gap-3 text-xs cursor-pointer transition-all ${
                        isSelected
                          ? 'bg-blue-50 dark:bg-zinc-800/90 border border-blue-200 dark:border-zinc-700 shadow-xs'
                          : 'hover:bg-slate-100 dark:hover:bg-zinc-800/50 border border-transparent'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: s.color || '#3B82F6' }}
                        />
                        {s.type === 'queue' ? (
                          <Layers className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                        ) : (
                          <Folder className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                        )}
                        <span className="font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                          <HighlightText text={s.spaceName} query={query} />
                        </span>
                        {s.listName && (
                          <span className="flex items-center gap-1 text-zinc-500 dark:text-zinc-400 truncate">
                            <ArrowRight className="w-3 h-3 shrink-0 text-zinc-400" />
                            <HighlightText text={s.listName} query={query} />
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 font-medium">
                          {s.type === 'queue' ? 'Queue List' : 'Space'}
                        </span>
                        {isSelected && (
                          <CornerDownLeft className="w-3 h-3 text-blue-500 dark:text-blue-400" />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Section 2: Tickets */}
          {tickets.length > 0 && (
            <div className="py-2">
              <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 flex items-center gap-1.5">
                <Ticket className="w-3 h-3" />
                <span>Tickets ({tickets.length})</span>
              </div>
              <div className="space-y-1">
                {tickets.map((t) => {
                  const idx = currentGlobalIdx++;
                  const isSelected = selectedIndex === idx;
                  return (
                    <div
                      key={`ticket-${t.id}`}
                      data-active={isSelected}
                      onClick={() => handleSelectItem({ type: 'ticket', item: t })}
                      className={`px-3 py-2.5 rounded-lg flex items-center justify-between gap-3 text-xs cursor-pointer transition-all ${
                        isSelected
                          ? 'bg-blue-50 dark:bg-zinc-800/90 border border-blue-200 dark:border-zinc-700 shadow-xs'
                          : 'hover:bg-slate-100 dark:hover:bg-zinc-800/50 border border-transparent'
                      }`}
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          {/* Space badge */}
                          <span
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold"
                            style={{
                              backgroundColor: `${t.space.color}15`,
                              color: t.space.color,
                              borderColor: `${t.space.color}35`,
                              borderWidth: '1px',
                            }}
                          >
                            <span
                              className="w-1.5 h-1.5 rounded-full"
                              style={{ backgroundColor: t.space.color }}
                            />
                            {t.space.key}
                          </span>

                          {/* Monospace Task Key */}
                          <span className="font-mono font-bold text-xs text-blue-600 dark:text-blue-400">
                            <HighlightText text={t.taskKey} query={query} />
                          </span>

                          {/* Contributed badge if cross-department */}
                          {t.isCollaborated && (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/10 text-amber-700 dark:bg-amber-950/80 dark:text-amber-300 border border-amber-500/30">
                              <Sparkles className="w-2.5 h-2.5" />
                              Contributed
                            </span>
                          )}

                          {/* Queue name breadcrumb if present */}
                          {t.list?.name && (
                            <span className="text-[10px] text-zinc-400 dark:text-zinc-500 truncate max-w-[120px]">
                              in {t.list.name}
                            </span>
                          )}
                        </div>

                        {/* Title */}
                        <p className="font-medium text-xs text-zinc-800 dark:text-zinc-200 truncate">
                          <HighlightText text={t.title} query={query} />
                        </p>
                      </div>

                      {/* Right metadata: Status, Priority, Assignee */}
                      <div className="flex items-center gap-2 shrink-0">
                        {/* Status pill */}
                        <span
                          className="px-2 py-0.5 rounded-full text-[10px] font-medium shrink-0 border"
                          style={{
                            backgroundColor: `${t.status.color}15`,
                            color: t.status.color,
                            borderColor: `${t.status.color}35`,
                          }}
                        >
                          {t.status.name}
                        </span>

                        {/* Assignee */}
                        {t.assignee ? (
                          <div
                            className="flex items-center gap-1 text-[11px] text-zinc-500 dark:text-zinc-400"
                            title={`Assigned to ${t.assignee.name}`}
                          >
                            <User className="w-3 h-3 text-zinc-400" />
                            <span className="hidden sm:inline truncate max-w-[90px]">
                              {t.assignee.name.split(' ')[0]}
                            </span>
                          </div>
                        ) : (
                          <span className="text-[10px] text-zinc-400 italic hidden sm:inline">
                            Unassigned
                          </span>
                        )}

                        {isSelected && (
                          <CornerDownLeft className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400 ml-1" />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Section 3: Discussion Notes */}
          {comments.length > 0 && (
            <div className="pt-2">
              <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 flex items-center gap-1.5">
                <MessageSquare className="w-3 h-3" />
                <span>Discussion Notes ({comments.length})</span>
              </div>
              <div className="space-y-1">
                {comments.map((c) => {
                  const idx = currentGlobalIdx++;
                  const isSelected = selectedIndex === idx;
                  return (
                    <div
                      key={`comment-${c.id}`}
                      data-active={isSelected}
                      onClick={() => handleSelectItem({ type: 'comment', item: c })}
                      className={`px-3 py-2 rounded-lg flex items-center justify-between gap-3 text-xs cursor-pointer transition-all ${
                        isSelected
                          ? 'bg-blue-50 dark:bg-zinc-800/90 border border-blue-200 dark:border-zinc-700 shadow-xs'
                          : 'hover:bg-slate-100 dark:hover:bg-zinc-800/50 border border-transparent'
                      }`}
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-bold text-[11px] text-blue-600 dark:text-blue-400">
                            {c.task.taskKey}
                          </span>
                          <span className="text-zinc-400 dark:text-zinc-600">•</span>
                          <span className="text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
                            {c.author.name}
                          </span>
                          {c.isInternal && (
                            <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-500/10 text-amber-700 dark:bg-amber-950/80 dark:text-amber-300 border border-amber-500/30">
                              Staff Note
                            </span>
                          )}
                        </div>

                        <p className="text-[11px] text-zinc-600 dark:text-zinc-400 italic line-clamp-2">
                          &ldquo;<HighlightText text={c.snippet} query={query} />&rdquo;
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {isSelected && (
                          <CornerDownLeft className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400" />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer Navigation Hints */}
        <div className="px-4 py-2.5 border-t border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950/70 flex items-center justify-between text-[11px] text-zinc-500">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded bg-slate-200 dark:bg-zinc-800 text-[10px] font-mono">
                <ArrowUp className="w-2.5 h-2.5 inline" />
              </kbd>
              <kbd className="px-1 py-0.5 rounded bg-slate-200 dark:bg-zinc-800 text-[10px] font-mono">
                <ArrowDown className="w-2.5 h-2.5 inline" />
              </kbd>
              <span>navigate</span>
            </span>

            <span className="inline-flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-zinc-800 text-[10px] font-mono">
                ↵
              </kbd>
              <span>select</span>
            </span>

            <span className="inline-flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-zinc-800 text-[10px] font-mono">
                esc
              </kbd>
              <span>close</span>
            </span>
          </div>

          <div className="hidden sm:flex items-center gap-2 text-[10px] text-zinc-400">
            <span>Enterprise Scope Protection Active</span>
          </div>
        </div>
      </div>
    </div>
  );
}

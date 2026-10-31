'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  SlidersHorizontal,
  Building,
  Shield,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  GripVertical,
  Check,
  AlertCircle,
  Loader2,
  Ticket,
  AlertTriangle,
  FolderKanban,
  CheckCircle2,
  Globe,
  Lock,
  Pencil,
  Tag,
  Calendar,
  DollarSign,
  Hash,
  Type,
  ListFilter,
} from 'lucide-react';
import { SpaceItem, TaskStatusItem, useWorkspace } from '@/context/workspace-context';
import { AuthenticatedUser } from '@/lib/security/rbac';
import { cn } from '@/lib/utils';

export interface DepartmentManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser?: AuthenticatedUser;
  initialSpaceId?: string;
  onQueuesChanged?: () => void;
}

export interface CustomFieldItem {
  id: string;
  spaceId: string;
  listId?: string | null;
  list?: { id: string; name: string } | null;
  name: string;
  fieldType: 'TEXT' | 'NUMBER' | 'CURRENCY' | 'SELECT' | 'DATE';
  options?: string | null;
  isRequired: boolean;
  order: number;
  createdAt?: string;
}

interface QueueListItem {
  id: string;
  spaceId: string;
  name: string;
  color?: string | null;
  description?: string | null;
  order: number;
  isPrivate?: boolean;
  _count?: {
    tasks: number;
  };
}

const COLOR_PRESETS = [
  { name: 'Blue', hex: '#3B82F6' },
  { name: 'Indigo', hex: '#6366F1' },
  { name: 'Purple', hex: '#8B5CF6' },
  { name: 'Emerald', hex: '#10B981' },
  { name: 'Amber', hex: '#F59E0B' },
  { name: 'Rose', hex: '#F43F5E' },
  { name: 'Cyan', hex: '#06B6D4' },
  { name: 'Slate', hex: '#64748B' },
];

export function DepartmentManagementModal({
  isOpen,
  onClose,
  currentUser,
  initialSpaceId,
  onQueuesChanged,
}: DepartmentManagementModalProps) {
  const { spaces, refreshSpaces, currentSpace, optimisticAddList, optimisticRemoveList } = useWorkspace();

  const [mounted, setMounted] = useState(false);
  const [selectedSpaceId, setSelectedSpaceId] = useState<string>('');
  const [lists, setLists] = useState<QueueListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Reorder state
  const [isReordering, setIsReordering] = useState(false);
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);

  // Inline add state
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(COLOR_PRESETS[0].hex);
  const [newIsPrivate, setNewIsPrivate] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Inline delete confirmation state
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Tab state: 'queues' or 'statuses' or 'customFields'
  const [activeTab, setActiveTab] = useState<'queues' | 'statuses' | 'customFields'>('queues');

  // Status edit state
  const [editingStatusId, setEditingStatusId] = useState<string | null>(null);
  const [statusEditName, setStatusEditName] = useState('');
  const [statusEditColor, setStatusEditColor] = useState('');
  const [isSavingStatus, setIsSavingStatus] = useState(false);

  // Custom Fields state
  const [customFields, setCustomFields] = useState<CustomFieldItem[]>([]);
  const [customFieldsLoading, setCustomFieldsLoading] = useState(false);
  const [queueScope, setQueueScope] = useState<string>('ALL');
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldType, setNewFieldType] = useState<'TEXT' | 'NUMBER' | 'CURRENCY' | 'SELECT' | 'DATE'>('TEXT');
  const [newFieldListId, setNewFieldListId] = useState<string>('ALL');
  const [newFieldOptions, setNewFieldOptions] = useState('');
  const [newFieldRequired, setNewFieldRequired] = useState(false);
  const [isSubmittingField, setIsSubmittingField] = useState(false);
  const [confirmDeleteFieldId, setConfirmDeleteFieldId] = useState<string | null>(null);
  const [isDeletingField, setIsDeletingField] = useState(false);

  // Custom Field Edit state
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [editFieldName, setEditFieldName] = useState('');
  const [editFieldType, setEditFieldType] = useState<'TEXT' | 'NUMBER' | 'CURRENCY' | 'SELECT' | 'DATE'>('TEXT');
  const [editFieldListId, setEditFieldListId] = useState<string>('ALL');
  const [editFieldOptions, setEditFieldOptions] = useState('');
  const [editFieldRequired, setEditFieldRequired] = useState(false);
  const [isSavingField, setIsSavingField] = useState(false);

  const isSuperadmin = currentUser?.globalRole === 'SUPERADMIN';
  const isAdmin = currentUser?.globalRole === 'ADMIN';

  useEffect(() => {
    setMounted(true);
  }, []);

  // Determine initial or locked department space
  const authorizedSpace = useMemo(() => {
    if (!spaces || spaces.length === 0) return undefined;

    if (isSuperadmin) {
      if (initialSpaceId) {
        const found = spaces.find((s) => s.id === initialSpaceId);
        if (found) return found;
      }
      if (currentSpace) {
        const found = spaces.find((s) => s.id === currentSpace.id);
        if (found) return found;
      }
      return spaces[0];
    }

    if (isAdmin && currentUser) {
      // Find space where user is department head or admin member
      const headSpace = spaces.find(
        (s) =>
          s.departmentHeadId === currentUser.id ||
          s.departmentHead?.id === currentUser.id ||
          s.members?.some((m) => m.userId === currentUser.id && m.role === 'ADMIN')
      );
      if (headSpace) return headSpace;

      // Fallback to current space or initial space
      if (initialSpaceId) {
        const found = spaces.find((s) => s.id === initialSpaceId);
        if (found) return found;
      }
      if (currentSpace) {
        const found = spaces.find((s) => s.id === currentSpace.id);
        if (found) return found;
      }
      return spaces[0];
    }

    return undefined;
  }, [spaces, isSuperadmin, isAdmin, currentUser, initialSpaceId, currentSpace]);

  // Sync selectedSpaceId when modal opens or authorized space changes
  useEffect(() => {
    if (isOpen && authorizedSpace?.id) {
      setSelectedSpaceId((prev) => (isSuperadmin && prev ? prev : authorizedSpace.id));
      setError(null);
      setSuccess(null);
      setConfirmDeleteId(null);
    }
  }, [isOpen, authorizedSpace?.id, isSuperadmin]);

  const successTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const showTimedSuccess = useCallback((msg: string) => {
    if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
    setSuccess(msg);
    successTimeoutRef.current = setTimeout(() => {
      setSuccess(null);
    }, 3000);
  }, []);

  useEffect(() => {
    return () => {
      if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
    };
  }, []);

  // Fetch lists whenever selectedSpaceId changes
  const fetchLists = useCallback(async (spaceId: string) => {
    if (!spaceId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/spaces/${spaceId}/lists`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch queue lists');
      }
      setLists(data.lists || []);
    } catch (err: any) {
      setError(err.message || 'Error loading queue lists');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen && selectedSpaceId) {
      fetchLists(selectedSpaceId);
    }
  }, [isOpen, selectedSpaceId, fetchLists]);

  const activeSpace = useMemo(() => {
    return spaces.find((s) => s.id === selectedSpaceId) || authorizedSpace;
  }, [spaces, selectedSpaceId, authorizedSpace]);

  // Reorder submission helper
  const handleReorder = async (updatedLists: QueueListItem[]) => {
    if (!selectedSpaceId || updatedLists.length === 0) return;
    setIsReordering(true);
    setError(null);

    // Optimistic UI update
    setLists(updatedLists);

    try {
      const listIds = updatedLists.map((l) => l.id);
      const res = await fetch(`/api/spaces/${selectedSpaceId}/lists/reorder`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listIds }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save reordered queue lists');
      }

      showTimedSuccess('Queue order updated successfully.');
      await refreshSpaces();
      onQueuesChanged?.();
    } catch (err: any) {
      setError(err.message || 'Failed to reorder queue lists');
      // Revert from server
      await fetchLists(selectedSpaceId);
    } finally {
      setIsReordering(false);
    }
  };

  // Move item up
  const handleMoveUp = (index: number) => {
    if (index <= 0 || isReordering) return;
    const newLists = [...lists];
    const temp = newLists[index - 1];
    newLists[index - 1] = newLists[index];
    newLists[index] = temp;
    handleReorder(newLists);
  };

  // Move item down
  const handleMoveDown = (index: number) => {
    if (index >= lists.length - 1 || isReordering) return;
    const newLists = [...lists];
    const temp = newLists[index + 1];
    newLists[index + 1] = newLists[index];
    newLists[index] = temp;
    handleReorder(newLists);
  };

  // Drag and Drop handlers
  const handleDragStart = (index: number) => {
    setDraggedIdx(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
  };

  const handleDrop = (index: number) => {
    if (draggedIdx === null || draggedIdx === index || isReordering) {
      setDraggedIdx(null);
      return;
    }
    const newLists = [...lists];
    const [draggedItem] = newLists.splice(draggedIdx, 1);
    newLists.splice(index, 0, draggedItem);
    setDraggedIdx(null);
    handleReorder(newLists);
  };

  // Create Queue List
  const handleCreateQueue = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) {
      setError('Queue name is required.');
      return;
    }

    if (!selectedSpaceId) {
      setError('Please select a department space first.');
      return;
    }

    // 0ms Optimistic UI update in modal & sidebar
    const tempId = `temp_${Date.now()}`;
    const optimisticList: QueueListItem = {
      id: tempId,
      spaceId: selectedSpaceId,
      name: trimmed,
      color: newColor || null,
      description: null,
      order: lists.length,
      isPrivate: newIsPrivate,
      _count: { tasks: 0 },
    };

    optimisticAddList(selectedSpaceId, optimisticList as any);
    setLists((prev) => [...prev, optimisticList]);
    setNewName('');
    setNewIsPrivate(false);
    setIsSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(`/api/spaces/${selectedSpaceId}/lists`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmed,
          color: newColor,
          isPrivate: newIsPrivate,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        // Rollback optimistic item
        optimisticRemoveList(selectedSpaceId, tempId);
        setLists((prev) => prev.filter((l) => l.id !== tempId));
        throw new Error(data.error || 'Failed to create queue list');
      }

      if (data.list) {
        optimisticAddList(selectedSpaceId, data.list);
        setLists((prev) =>
          prev.map((l) => (l.id === tempId ? data.list : l))
        );
      }
      showTimedSuccess(`Queue '${data.list?.name || trimmed}' added successfully.`);
      void refreshSpaces().catch(() => {});
      onQueuesChanged?.();
    } catch (err: any) {
      setError(err.message || 'Error creating queue list');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Delete Queue List
  const handleDeleteQueue = async (listId: string) => {
    if (!selectedSpaceId) return;
    const previousLists = [...lists];
    const targetItem = lists.find((l) => l.id === listId);

    // 0ms Optimistic deletion
    optimisticRemoveList(selectedSpaceId, listId);
    setLists((prev) => prev.filter((l) => l.id !== listId));
    setConfirmDeleteId(null);
    setIsDeleting(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(`/api/spaces/${selectedSpaceId}/lists/${listId}`, {
        method: 'DELETE',
      });

      const data = await res.json();
      if (!res.ok) {
        // Rollback
        if (targetItem) optimisticAddList(selectedSpaceId, targetItem as any);
        setLists(previousLists);
        throw new Error(data.message || data.error || 'Failed to delete queue list');
      }

      showTimedSuccess('Queue list deleted successfully.');
      void refreshSpaces().catch(() => {});
      onQueuesChanged?.();
    } catch (err: any) {
      setError(err.message || 'Error deleting queue list');
    } finally {
      setIsDeleting(false);
    }
  };

  // Toggle Queue List Visibility (Public vs Private)
  const handleToggleVisibility = async (list: QueueListItem) => {
    if (!selectedSpaceId) return;
    const nextIsPrivate = !list.isPrivate;
    // Optimistic local state update
    setLists((prev) =>
      prev.map((l) => (l.id === list.id ? { ...l, isPrivate: nextIsPrivate } : l))
    );

    try {
      const res = await fetch(`/api/spaces/${selectedSpaceId}/lists/${list.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPrivate: nextIsPrivate }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update queue visibility');
      }

      setSuccess(`Queue '${list.name}' is now ${nextIsPrivate ? 'Private' : 'Public'}.`);
      setTimeout(() => setSuccess(null), 3000);
      await refreshSpaces();
      onQueuesChanged?.();
    } catch (err: any) {
      setError(err.message || 'Error updating queue visibility');
      await fetchLists(selectedSpaceId);
    }
  };

  const activeStatuses = useMemo(() => {
    return activeSpace?.statuses ? [...activeSpace.statuses].sort((a, b) => a.order - b.order) : [];
  }, [activeSpace?.statuses]);

  const handleStartStatusEdit = (st: TaskStatusItem) => {
    setEditingStatusId(st.id);
    setStatusEditName(st.name);
    setStatusEditColor(st.color || '#6B7280');
    setError(null);
  };

  const handleCancelStatusEdit = () => {
    setEditingStatusId(null);
    setStatusEditName('');
    setStatusEditColor('');
  };

  const handleSaveStatus = async (st: TaskStatusItem) => {
    const trimmed = statusEditName.trim();
    if (!trimmed) {
      setError('Status name cannot be empty.');
      return;
    }

    if (!selectedSpaceId) return;

    setIsSavingStatus(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(`/api/spaces/${selectedSpaceId}/statuses/${st.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmed,
          color: statusEditColor || st.color,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update status');
      }

      setSuccess(`Status '${trimmed}' saved successfully.`);
      setTimeout(() => setSuccess(null), 3000);
      setEditingStatusId(null);
      await refreshSpaces();
      onQueuesChanged?.();
    } catch (err: any) {
      setError(err.message || 'Error updating status');
    } finally {
      setIsSavingStatus(false);
    }
  };

  // Fetch custom fields whenever selectedSpaceId changes
  const fetchCustomFields = useCallback(async (spaceId: string) => {
    if (!spaceId) return;
    setCustomFieldsLoading(true);
    try {
      const res = await fetch(`/api/spaces/${spaceId}/custom-fields`);
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.fields) {
        setCustomFields(data.fields);
      }
    } catch (err: any) {
      console.error('Failed to load custom fields', err);
    } finally {
      setCustomFieldsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen && selectedSpaceId) {
      fetchCustomFields(selectedSpaceId);
    }
  }, [isOpen, selectedSpaceId, fetchCustomFields]);

  // Reset queue list scope whenever department space changes
  useEffect(() => {
    setQueueScope('ALL');
    setNewFieldListId('ALL');
    setEditingFieldId(null);
  }, [selectedSpaceId]);

  // Filter custom fields based on currently selected Queue List Scope
  const filteredCustomFields = useMemo(() => {
    if (queueScope === 'ALL') {
      return customFields;
    }
    return customFields.filter((f) => !f.listId || f.listId === queueScope);
  }, [customFields, queueScope]);

  // Create Custom Field Handler
  const handleCreateCustomField = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newFieldName.trim();
    if (!trimmed) {
      setError('Field name is required.');
      return;
    }
    if (!selectedSpaceId) return;

    setIsSubmittingField(true);
    setError(null);
    setSuccess(null);

    try {
      const payload: any = {
        name: trimmed,
        fieldType: newFieldType,
        isRequired: newFieldRequired,
        listId: newFieldListId === 'ALL' ? null : newFieldListId,
      };
      if (newFieldType === 'SELECT') {
        payload.options = newFieldOptions
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      }

      const res = await fetch(`/api/spaces/${selectedSpaceId}/custom-fields`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create custom field');
      }

      setNewFieldName('');
      setNewFieldOptions('');
      setNewFieldRequired(false);
      setNewFieldListId(queueScope);
      showTimedSuccess(`Custom field '${trimmed}' added successfully.`);
      await fetchCustomFields(selectedSpaceId);
      await refreshSpaces();
      onQueuesChanged?.();
    } catch (err: any) {
      setError(err.message || 'Error creating custom field');
    } finally {
      setIsSubmittingField(false);
    }
  };

  // Start Custom Field Edit
  const handleStartFieldEdit = (field: CustomFieldItem) => {
    setEditingFieldId(field.id);
    setEditFieldName(field.name);
    setEditFieldType(field.fieldType);
    setEditFieldListId(field.listId || 'ALL');
    let opts = '';
    if (field.options) {
      try {
        const parsed = JSON.parse(field.options);
        opts = Array.isArray(parsed) ? parsed.join(', ') : '';
      } catch {
        opts = field.options;
      }
    }
    setEditFieldOptions(opts);
    setEditFieldRequired(field.isRequired);
    setError(null);
  };

  // Cancel Custom Field Edit
  const handleCancelFieldEdit = () => {
    setEditingFieldId(null);
    setEditFieldName('');
    setEditFieldOptions('');
    setEditFieldRequired(false);
    setEditFieldListId('ALL');
  };

  // Save Custom Field Edit
  const handleSaveFieldEdit = async (fieldId: string) => {
    const trimmed = editFieldName.trim();
    if (!trimmed) {
      setError('Field name cannot be empty.');
      return;
    }
    if (!selectedSpaceId) return;

    setIsSavingField(true);
    setError(null);
    setSuccess(null);

    try {
      const payload: any = {
        name: trimmed,
        fieldType: editFieldType,
        isRequired: editFieldRequired,
        listId: editFieldListId === 'ALL' ? null : editFieldListId,
      };
      if (editFieldType === 'SELECT') {
        payload.options = editFieldOptions
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      } else {
        payload.options = null;
      }

      const res = await fetch(`/api/spaces/${selectedSpaceId}/custom-fields/${fieldId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update custom field');
      }

      showTimedSuccess(`Custom field '${trimmed}' updated successfully.`);
      setEditingFieldId(null);
      await fetchCustomFields(selectedSpaceId);
      await refreshSpaces();
      onQueuesChanged?.();
    } catch (err: any) {
      setError(err.message || 'Error updating custom field');
    } finally {
      setIsSavingField(false);
    }
  };

  // Delete Custom Field Handler
  const handleDeleteCustomField = async (fieldId: string) => {
    if (!selectedSpaceId) return;
    setIsDeletingField(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(`/api/spaces/${selectedSpaceId}/custom-fields/${fieldId}`, {
        method: 'DELETE',
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to delete custom field');
      }

      setConfirmDeleteFieldId(null);
      showTimedSuccess('Custom field deleted successfully.');
      await fetchCustomFields(selectedSpaceId);
      await refreshSpaces();
      onQueuesChanged?.();
    } catch (err: any) {
      setError(err.message || 'Error deleting custom field');
    } finally {
      setIsDeletingField(false);
    }
  };

  if (!isOpen || !mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="dept-settings-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-zinc-950/70 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div
        className="w-full max-w-2xl max-h-[85vh] flex flex-col bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header */}
        <div className="flex-shrink-0 px-6 pt-5 pb-4 border-b border-zinc-800/80 bg-zinc-950 space-y-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-950/80 border border-blue-800 flex items-center justify-center text-blue-400 shrink-0 shadow-2xs">
                <FolderKanban className="w-5 h-5" />
              </div>
              <div>
                <h2
                  id="dept-settings-title"
                  className="text-base font-bold text-zinc-100 tracking-tight"
                >
                  Department Queue Settings
                </h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Manage, add, and reorder Kanban queues and swimlanes
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Department Settings Modal"
              className="p-1.5 text-zinc-400 hover:text-zinc-200 rounded-lg hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Department Space Selector */}
          {isSuperadmin ? (
            <div className="p-3 bg-zinc-900/60 rounded-xl border border-zinc-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="flex items-center gap-2">
                <Building className="w-4 h-4 text-blue-400 shrink-0" />
                <div>
                  <span className="text-xs font-semibold text-zinc-100">
                    Department Space
                  </span>
                  <p className="text-[11px] text-zinc-400">
                    Switch spaces to configure their active queue lists
                  </p>
                </div>
              </div>
              <select
                value={selectedSpaceId}
                onChange={(e) => setSelectedSpaceId(e.target.value)}
                className="px-3 py-1.5 bg-zinc-950 border border-zinc-700 rounded-lg text-xs font-semibold text-zinc-200 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer shadow-2xs shrink-0"
              >
                {spaces.map((sp) => (
                  <option key={sp.id} value={sp.id}>
                    {sp.name} ({sp.key})
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="p-3 bg-blue-950/40 rounded-xl border border-blue-900/60 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Shield className="w-4 h-4 text-blue-400 shrink-0" />
                <div>
                  <span className="text-[11px] uppercase tracking-wider font-mono font-medium text-blue-300">
                    Department Clearance
                  </span>
                  <h3 className="text-xs font-bold text-zinc-100">
                    Managing Queues for: {activeSpace?.name || 'Department Space'}
                  </h3>
                </div>
              </div>
              <span className="px-2 py-0.5 rounded font-mono text-[10px] font-bold bg-blue-900/60 text-blue-200 border border-blue-800">
                {activeSpace?.key || 'DEP'}
              </span>
            </div>
          )}
        </div>

        {/* Navigation Tabs */}
        <div className="flex-shrink-0 px-6 border-b border-zinc-800 bg-zinc-950 flex gap-6 pt-2">
          <button
            type="button"
            onClick={() => setActiveTab('queues')}
            className={cn(
              'pb-2.5 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 cursor-pointer',
              activeTab === 'queues'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            )}
          >
            <FolderKanban className="w-3.5 h-3.5" />
            <span>Queue Lists</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-zinc-800 font-mono text-zinc-300">
              {lists.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('statuses')}
            className={cn(
              'pb-2.5 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 cursor-pointer',
              activeTab === 'statuses'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            )}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Department Statuses</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-zinc-800 font-mono text-zinc-300">
              {activeStatuses.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('customFields')}
            className={cn(
              'pb-2.5 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 cursor-pointer',
              activeTab === 'customFields'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            )}
          >
            <Tag className="w-3.5 h-3.5" />
            <span>Custom Fields</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-zinc-800 font-mono text-zinc-300">
              {customFields.length}
            </span>
          </button>
        </div>

        {/* Scrollable Tab Body */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-6 pb-6 custom-scrollbar">
          {/* Feedback Alerts */}
          {error && (
            <div className="p-3 rounded-xl bg-red-950/60 border border-red-800 text-xs text-red-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="p-3 rounded-xl bg-emerald-950/60 border border-emerald-800 text-xs text-emerald-300 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{success}</span>
            </div>
          )}

          {activeTab === 'queues' ? (
            <>
              {/* 2. Queue Arrangement / List Section */}
              <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
                <span>Active Queue Lists</span>
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono bg-slate-100 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 font-normal">
                  {lists.length}
                </span>
              </h3>
              <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                Use arrows or drag to reorder columns
              </span>
            </div>

            {loading ? (
              <div className="py-12 flex flex-col items-center justify-center gap-2 text-zinc-400">
                <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
                <span className="text-xs">Loading queue lists...</span>
              </div>
            ) : lists.length === 0 ? (
              <div className="py-10 border border-dashed border-slate-200 dark:border-zinc-800 rounded-xl text-center">
                <FolderKanban className="w-8 h-8 text-zinc-300 dark:text-zinc-700 mx-auto mb-2" />
                <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  No queue lists found in this department.
                </p>
                <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-0.5">
                  Use the form below to create your first queue list.
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {lists.map((lst, idx) => {
                  const ticketCount = lst._count?.tasks ?? 0;
                  const isFirst = idx === 0;
                  const isLast = idx === lists.length - 1;
                  const isConfirmingDelete = confirmDeleteId === lst.id;

                  return (
                    <div
                      key={lst.id}
                      draggable={!isConfirmingDelete}
                      onDragStart={() => handleDragStart(idx)}
                      onDragOver={(e) => handleDragOver(e, idx)}
                      onDrop={() => handleDrop(idx)}
                      className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 bg-slate-50/80 dark:bg-zinc-900/60 border border-slate-200 dark:border-zinc-800/80 rounded-xl transition-all ${
                        draggedIdx === idx ? 'opacity-40 border-blue-400' : 'hover:border-slate-300 dark:hover:border-zinc-700'
                      }`}
                    >
                      {/* Left: Reorder Controls + Color Badge + Name */}
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        {/* Drag Handle / Sequence Order */}
                        <div
                          className="flex items-center gap-1 text-zinc-400 dark:text-zinc-600 cursor-grab active:cursor-grabbing shrink-0"
                          title="Drag to rearrange"
                        >
                          <GripVertical className="w-3.5 h-3.5" />
                          <span className="font-mono text-[10px] w-4 text-center font-semibold">
                            {idx + 1}
                          </span>
                        </div>

                        {/* Up / Down Arrow Reorder Buttons */}
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            type="button"
                            disabled={isFirst || isReordering}
                            onClick={() => handleMoveUp(idx)}
                            title="Move column up / left"
                            className="p-1 rounded text-zinc-400 hover:text-zinc-800 dark:text-zinc-500 dark:hover:text-zinc-200 hover:bg-slate-200/60 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
                          >
                            <ArrowUp className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            disabled={isLast || isReordering}
                            onClick={() => handleMoveDown(idx)}
                            title="Move column down / right"
                            className="p-1 rounded text-zinc-400 hover:text-zinc-800 dark:text-zinc-500 dark:hover:text-zinc-200 hover:bg-slate-200/60 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
                          >
                            <ArrowDown className="w-3 h-3" />
                          </button>
                        </div>

                        {/* Color Dot & Name */}
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-3 h-3 rounded-full shrink-0 shadow-2xs border border-black/10 dark:border-white/10"
                            style={{ backgroundColor: lst.color || '#3B82F6' }}
                          />
                          <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                            {lst.name}
                          </span>
                        </div>
                      </div>

                      {/* Right: Visibility Badge + Ticket Count & Delete Action */}
                      <div className="flex items-center gap-2 justify-end shrink-0">
                        {/* Visibility Toggle Badge */}
                        <button
                          type="button"
                          onClick={() => handleToggleVisibility(lst)}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors border cursor-pointer ${
                            lst.isPrivate
                              ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30 hover:bg-amber-500/20'
                              : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
                          }`}
                          title={
                            lst.isPrivate
                              ? 'Private queue: Visible only to department members (Click to make Public)'
                              : 'Public queue: Visible company-wide (Click to make Private)'
                          }
                        >
                          {lst.isPrivate ? (
                            <>
                              <Lock className="w-2.5 h-2.5" />
                              <span>Private</span>
                            </>
                          ) : (
                            <>
                              <Globe className="w-2.5 h-2.5" />
                              <span>Public</span>
                            </>
                          )}
                        </button>

                        {/* Ticket Count Badge */}
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-medium border ${
                            ticketCount > 0
                              ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/70 dark:text-blue-300 dark:border-blue-800'
                              : 'bg-zinc-100 text-zinc-500 border-zinc-200 dark:bg-zinc-900 dark:text-zinc-400 dark:border-zinc-800'
                          }`}
                          title={`${ticketCount} active ticket(s) in this queue`}
                        >
                          <Ticket className="w-2.5 h-2.5" />
                          <span>
                            {ticketCount} {ticketCount === 1 ? 'ticket' : 'tickets'}
                          </span>
                        </span>

                        {/* Delete Action with Active Ticket Guard */}
                        {isConfirmingDelete ? (
                          <div className="flex items-center gap-1.5 p-1 bg-red-50 dark:bg-red-950/80 border border-red-200 dark:border-red-800 rounded-lg">
                            <span className="text-[10px] text-red-700 dark:text-red-300 font-medium px-1">
                              Delete queue?
                            </span>
                            <button
                              type="button"
                              disabled={isDeleting}
                              onClick={() => handleDeleteQueue(lst.id)}
                              className="px-2 py-0.5 bg-red-600 hover:bg-red-500 text-white rounded text-[10px] font-semibold transition-colors cursor-pointer"
                            >
                              {isDeleting ? 'Deleting...' : 'Yes, Delete'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-1.5 py-0.5 text-[10px] text-zinc-600 dark:text-zinc-400 hover:bg-slate-200 dark:hover:bg-zinc-800 rounded transition-colors cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled={ticketCount > 0}
                            onClick={() => setConfirmDeleteId(lst.id)}
                            title={
                              ticketCount > 0
                                ? 'Cannot delete: contains active tickets'
                                : `Delete queue list '${lst.name}'`
                            }
                            className={`p-1.5 rounded-lg transition-colors ${
                              ticketCount > 0
                                ? 'text-zinc-300 dark:text-zinc-700 cursor-not-allowed opacity-50'
                                : 'text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:text-zinc-500 dark:hover:text-red-400 dark:hover:bg-red-950/50 cursor-pointer'
                            }`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 3. Add Queue Inline Section */}
          <div className="pt-2 border-t border-slate-200 dark:border-zinc-800">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300 mb-2">
              Add New Queue List
            </h3>
            <form
              onSubmit={handleCreateQueue}
              className="p-3 bg-slate-50/60 dark:bg-zinc-900/40 border border-slate-200 dark:border-zinc-800 rounded-xl space-y-3"
            >
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <input
                  type="text"
                  placeholder="e.g. Urgent Triage, QA Review, DevOps Deployment..."
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="flex-1 px-3 py-1.5 bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-700 rounded-lg text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-blue-500 shadow-2xs"
                />

                {/* Visibility Segmented Control: Public vs Private */}
                <div className="flex items-center gap-1 p-0.5 bg-slate-100 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-lg shrink-0">
                  <button
                    type="button"
                    onClick={() => setNewIsPrivate(false)}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                      !newIsPrivate
                        ? 'bg-white text-emerald-700 dark:bg-zinc-800 dark:text-emerald-400 shadow-2xs'
                        : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
                    }`}
                    title="Public: Visible company-wide for all ticket creators"
                  >
                    <Globe className="w-3 h-3 text-emerald-500" />
                    <span>Public</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewIsPrivate(true)}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                      newIsPrivate
                        ? 'bg-white text-amber-700 dark:bg-zinc-800 dark:text-amber-400 shadow-2xs'
                        : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
                    }`}
                    title="Private: Visible only to department members and Superadmins"
                  >
                    <Lock className="w-3 h-3 text-amber-500" />
                    <span>Private</span>
                  </button>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting || !newName.trim() || !selectedSpaceId}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer shrink-0"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Adding...</span>
                    </>
                  ) : (
                    <>
                      <Plus className="w-3.5 h-3.5" />
                      <span>+ Add Queue</span>
                    </>
                  )}
                </button>
              </div>

              {/* Color Presets */}
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                  Accent Color:
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {COLOR_PRESETS.map((preset) => (
                    <button
                      key={preset.hex}
                      type="button"
                      onClick={() => setNewColor(preset.hex)}
                      title={preset.name}
                      className={`w-5 h-5 rounded-full transition-all cursor-pointer flex items-center justify-center ${
                        newColor === preset.hex
                          ? 'ring-2 ring-offset-2 ring-blue-500 dark:ring-offset-zinc-950 scale-110'
                          : 'hover:scale-105 opacity-80 hover:opacity-100'
                      }`}
                      style={{ backgroundColor: preset.hex }}
                    >
                      {newColor === preset.hex && <Check className="w-2.5 h-2.5 text-white" />}
                    </button>
                  ))}
                </div>
              </div>
            </form>
          </div>
        </>
      ) : activeTab === 'statuses' ? (
        /* Department Statuses Configuration Section */
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
                <span>Department Lifecycle Statuses</span>
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono bg-slate-100 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 font-normal">
                  {activeStatuses.length}
                </span>
              </h3>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                Customize column names and colors. Underlying SLA lifecycle categories are preserved.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            {activeStatuses.map((st, idx) => {
              const isEditing = editingStatusId === st.id;
              const category = st.category || (st.isClosed ? 'CLOSED' : st.isCompleted ? 'RESOLVED' : idx === 0 ? 'OPEN' : 'IN_PROGRESS');

              const categoryBadgeStyles: Record<string, string> = {
                OPEN: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800',
                IN_PROGRESS: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800',
                RESOLVED: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800',
                CLOSED: 'bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:border-zinc-800',
              };

              return (
                <div
                  key={st.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-3 bg-slate-50/80 dark:bg-zinc-900/60 border border-slate-200 dark:border-zinc-800/80 rounded-xl"
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <span className="font-mono text-[10px] text-zinc-400 dark:text-zinc-500 w-4 text-center shrink-0">
                      {idx + 1}
                    </span>
                    <span
                      className="w-3.5 h-3.5 rounded-full shrink-0 shadow-xs"
                      style={{ backgroundColor: isEditing ? (statusEditColor || st.color) : st.color }}
                    />

                    {isEditing ? (
                      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 flex-1 min-w-0">
                        <input
                          type="text"
                          autoFocus
                          value={statusEditName}
                          onChange={(e) => setStatusEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveStatus(st);
                            if (e.key === 'Escape') handleCancelStatusEdit();
                          }}
                          maxLength={50}
                          placeholder="Status Name"
                          className="flex-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-white dark:bg-zinc-950 border border-blue-500 text-zinc-900 dark:text-zinc-100 outline-none ring-1 ring-blue-500/50 shadow-inner"
                        />
                        <div className="flex items-center gap-1 shrink-0">
                          {COLOR_PRESETS.map((p) => (
                            <button
                              key={p.hex}
                              type="button"
                              onClick={() => setStatusEditColor(p.hex)}
                              title={p.name}
                              style={{ backgroundColor: p.hex }}
                              className={`w-4 h-4 rounded-full transition-transform cursor-pointer ${
                                (statusEditColor || st.color) === p.hex
                                  ? 'ring-2 ring-blue-500 scale-110'
                                  : 'opacity-70 hover:opacity-100'
                              }`}
                            />
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200 uppercase tracking-wide truncate">
                          {st.name}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                    <span
                      className={`px-2 py-0.5 rounded font-mono text-[10px] font-semibold uppercase border ${
                        categoryBadgeStyles[category] || categoryBadgeStyles.IN_PROGRESS
                      }`}
                      title={`Lifecycle category: ${category}`}
                    >
                      {category}
                    </span>

                    {isEditing ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleSaveStatus(st)}
                          disabled={isSavingStatus || !statusEditName.trim()}
                          title="Save"
                          className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-md text-[11px] font-semibold flex items-center gap-1 disabled:opacity-40 cursor-pointer transition-colors shadow-xs"
                        >
                          {isSavingStatus ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                          <span>Save</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleCancelStatusEdit}
                          disabled={isSavingStatus}
                          title="Cancel"
                          className="px-2 py-1 bg-slate-200 hover:bg-slate-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-md text-[11px] font-semibold cursor-pointer transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleStartStatusEdit(st)}
                        className="px-2.5 py-1 bg-white hover:bg-slate-100 dark:bg-zinc-800 dark:hover:bg-zinc-700 border border-slate-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-md text-[11px] font-medium flex items-center gap-1 cursor-pointer transition-colors shadow-2xs"
                      >
                        <Pencil className="w-3 h-3 text-zinc-400" />
                        <span>Rename</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* Department Custom Fields Configuration Section */
        <div className="space-y-6">
          {/* Section Header with Compact Queue Filter */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-200">
                  Department Custom Fields
                </h3>
                <span className="px-2 py-0.5 text-[11px] font-semibold rounded-full bg-zinc-800 text-zinc-300">
                  {filteredCustomFields.length}
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">
                Configure custom attributes populated on tickets in this department.
              </p>
            </div>

            {/* Compact Queue Filter */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-[11px] font-medium text-zinc-400 whitespace-nowrap">Scope:</span>
              <select
                value={queueScope}
                onChange={(e) => setQueueScope(e.target.value)}
                className="bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-200 text-xs font-medium rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-500"
              >
                <option value="ALL">All Queue Lists (Dept-Wide)</option>
                {lists.map((q) => (
                  <option key={q.id} value={q.id}>{q.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* List of Custom Fields */}
          {customFieldsLoading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-zinc-400">
              <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
              <span className="text-xs">Loading custom fields...</span>
            </div>
          ) : filteredCustomFields.length === 0 ? (
            <div className="py-10 border border-dashed border-zinc-800 rounded-xl text-center">
              <Tag className="w-8 h-8 text-zinc-700 mx-auto mb-2" />
              <p className="text-xs font-medium text-zinc-400">
                {queueScope === 'ALL'
                  ? 'No custom fields configured for this department yet.'
                  : 'No custom fields configured for this queue list scope.'}
              </p>
              <p className="text-[11px] text-zinc-500 mt-0.5">
                Use the form below to define custom fields like Asset ID, Estimated Cost, or Equipment Type.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredCustomFields.map((field, idx) => {
                const isEditing = editingFieldId === field.id;
                const isConfirmingDelete = confirmDeleteFieldId === field.id;

                let parsedOptions: string[] = [];
                if (field.options) {
                  try {
                    parsedOptions = JSON.parse(field.options);
                  } catch {
                    parsedOptions = [];
                  }
                }

                const queueListName =
                  field.list?.name ||
                  (field.listId ? lists.find((l) => l.id === field.listId)?.name : null);

                return (
                  <div
                    key={field.id}
                    className="px-4 py-3 rounded-xl bg-zinc-900/50 border border-zinc-800/80 hover:border-zinc-700/80 transition-colors"
                  >
                    {isEditing ? (
                      <div className="space-y-3.5 w-full">
                        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                          <div className="sm:col-span-5">
                            <label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-400 mb-1">
                              Field Name
                            </label>
                            <input
                              type="text"
                              autoFocus
                              value={editFieldName}
                              onChange={(e) => setEditFieldName(e.target.value)}
                              placeholder="Field Name"
                              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-blue-500 focus:outline-none"
                            />
                          </div>
                          <div className="sm:col-span-3">
                            <label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-400 mb-1">
                              Field Type
                            </label>
                            <select
                              value={editFieldType}
                              onChange={(e) => setEditFieldType(e.target.value as any)}
                              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-2 text-xs text-zinc-100 focus:border-blue-500 focus:outline-none"
                            >
                              <option value="TEXT">Text</option>
                              <option value="NUMBER">Number</option>
                              <option value="CURRENCY">Currency</option>
                              <option value="SELECT">Dropdown</option>
                              <option value="DATE">Date</option>
                            </select>
                          </div>
                          <div className="sm:col-span-4">
                            <label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-400 mb-1">
                              Target Queue
                            </label>
                            <select
                              value={editFieldListId}
                              onChange={(e) => setEditFieldListId(e.target.value)}
                              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-2 text-xs text-zinc-100 focus:border-blue-500 focus:outline-none"
                            >
                              <option value="ALL">All Queues (Dept-Wide)</option>
                              {lists.map((l) => (
                                <option key={l.id} value={l.id}>
                                  {l.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        {editFieldType === 'SELECT' && (
                          <div className="pt-2 border-t border-zinc-800">
                            <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 block mb-1">
                              Dropdown Options (comma-separated):
                            </label>
                            <input
                              type="text"
                              value={editFieldOptions}
                              onChange={(e) => setEditFieldOptions(e.target.value)}
                              placeholder="e.g. Laptop, Monitor, Mouse, Keyboard"
                              className="w-full px-3 py-2 text-xs rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 focus:outline-none focus:border-blue-500"
                            />
                          </div>
                        )}

                        <div className="flex items-center justify-between pt-2 border-t border-zinc-800/60">
                          <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={editFieldRequired}
                              onChange={(e) => setEditFieldRequired(e.target.checked)}
                              className="w-3.5 h-3.5 rounded border-zinc-700 bg-zinc-900 text-blue-600 focus:ring-0"
                            />
                            <span>Required field when submitting tickets</span>
                          </label>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleSaveFieldEdit(field.id)}
                              disabled={isSavingField || !editFieldName.trim()}
                              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 disabled:opacity-40 cursor-pointer transition-colors"
                            >
                              {isSavingField ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                              <span>Save Changes</span>
                            </button>
                            <button
                              type="button"
                              onClick={handleCancelFieldEdit}
                              disabled={isSavingField}
                              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs font-medium cursor-pointer transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div className="flex items-center justify-between gap-4">
                          {/* Left Group */}
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <span className="text-xs font-mono text-zinc-500 w-4 flex-shrink-0">
                              {idx + 1}
                            </span>
                            <span className="text-sm font-semibold text-zinc-100 truncate" title={field.name}>
                              {field.name}
                            </span>
                          </div>

                          {/* Middle / Right Metadata Pills */}
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {/* Type Badge */}
                            <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded bg-blue-950/60 text-blue-300 border border-blue-800/60">
                              {field.fieldType}
                            </span>

                            {/* Queue Scope Badge */}
                            {!field.listId || field.listId === 'ALL' ? (
                              <span className="px-2 py-0.5 text-[10px] font-semibold uppercase rounded bg-zinc-800 text-zinc-300 border border-zinc-700">
                                All Queues
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 text-[10px] font-semibold uppercase rounded bg-indigo-950/60 text-indigo-300 border border-indigo-700/50">
                                {queueListName || 'Queue'}
                              </span>
                            )}

                            {/* Required / Optional Badge */}
                            {field.isRequired ? (
                              <span className="px-2 py-0.5 text-[10px] font-semibold uppercase rounded bg-amber-950/50 text-amber-300 border border-amber-800/50">
                                Required
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 text-[10px] font-medium uppercase rounded bg-zinc-900 text-zinc-500 border border-zinc-800">
                                Optional
                              </span>
                            )}
                          </div>

                          {/* Right Actions */}
                          <div className="flex items-center gap-1.5 flex-shrink-0 pl-2 border-l border-zinc-800/80">
                            {isConfirmingDelete ? (
                              <div className="flex items-center gap-1.5 p-1 bg-red-950/80 border border-red-800 rounded-lg">
                                <span className="text-[10px] text-red-300 font-medium px-1">
                                  Delete field?
                                </span>
                                <button
                                  type="button"
                                  disabled={isDeletingField}
                                  onClick={() => handleDeleteCustomField(field.id)}
                                  className="px-2 py-0.5 bg-red-600 hover:bg-red-500 text-white rounded text-[10px] font-semibold transition-colors cursor-pointer"
                                >
                                  {isDeletingField ? 'Deleting...' : 'Yes, Delete'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteFieldId(null)}
                                  className="px-1.5 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-800 rounded transition-colors cursor-pointer"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleStartFieldEdit(field)}
                                  className="px-2.5 py-1 text-xs font-medium rounded-lg bg-zinc-800/80 hover:bg-zinc-700 text-zinc-200 flex items-center gap-1 cursor-pointer transition-colors"
                                >
                                  <Pencil className="w-3 h-3 text-zinc-400" />
                                  <span>Edit</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteFieldId(field.id)}
                                  className="p-1.5 rounded-lg text-zinc-400 hover:text-rose-400 hover:bg-rose-950/30 transition-colors cursor-pointer"
                                  title="Delete custom field"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Dropdown Options Preview */}
                        {field.fieldType === 'SELECT' && parsedOptions.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5 pt-2 mt-2 border-t border-zinc-800/50">
                            <span className="text-[10px] text-zinc-400">Options:</span>
                            {parsedOptions.map((opt, oIdx) => (
                              <span
                                key={oIdx}
                                className="px-2 py-0.5 rounded text-[10px] font-medium bg-purple-950/40 text-purple-300 border border-purple-800/30"
                              >
                                {opt}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Add New Custom Field Form */}
          <div className="space-y-2 pt-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-300">
              Add New Custom Field
            </h3>
            <form
              onSubmit={handleCreateCustomField}
              className="p-4 rounded-xl bg-zinc-900/40 border border-zinc-800/90 space-y-3.5"
            >
              {/* Row 1 — 3-Column Input Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                {/* Column 1 — Field Name */}
                <div className="sm:col-span-5">
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-400 mb-1">
                    Field Name
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Asset ID, Cost..."
                    value={newFieldName}
                    onChange={(e) => setNewFieldName(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                {/* Column 2 — Data Type */}
                <div className="sm:col-span-3">
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-400 mb-1">
                    Field Type
                  </label>
                  <select
                    value={newFieldType}
                    onChange={(e) => setNewFieldType(e.target.value as any)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-2 text-xs text-zinc-100 focus:border-blue-500 focus:outline-none"
                  >
                    <option value="TEXT">Text</option>
                    <option value="NUMBER">Number</option>
                    <option value="CURRENCY">Currency</option>
                    <option value="SELECT">Dropdown</option>
                    <option value="DATE">Date</option>
                  </select>
                </div>

                {/* Column 3 — Target Queue */}
                <div className="sm:col-span-4">
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-400 mb-1">
                    Target Queue
                  </label>
                  <select
                    value={newFieldListId}
                    onChange={(e) => setNewFieldListId(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-2 text-xs text-zinc-100 focus:border-blue-500 focus:outline-none"
                  >
                    <option value="ALL">All Queues (Dept-Wide)</option>
                    {lists.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* SELECT Options Row if Dropdown type */}
              {newFieldType === 'SELECT' && (
                <div className="pt-2 border-t border-zinc-800/60">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 block mb-1">
                    Dropdown Options (comma-separated):
                  </label>
                  <input
                    type="text"
                    value={newFieldOptions}
                    onChange={(e) => setNewFieldOptions(e.target.value)}
                    placeholder="e.g. Laptop, Desktop, Monitor, VPN Token, Mobile Device"
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-blue-500 focus:outline-none"
                  />
                </div>
              )}

              {/* Row 2 — Bottom Action Bar */}
              <div className="flex items-center justify-between pt-2 border-t border-zinc-800/60">
                {/* Left: Required Checkbox Toggle */}
                <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={newFieldRequired}
                    onChange={(e) => setNewFieldRequired(e.target.checked)}
                    className="w-3.5 h-3.5 rounded border-zinc-700 bg-zinc-900 text-blue-600 focus:ring-0"
                  />
                  <span>Required field when submitting tickets</span>
                </label>

                {/* Right: + Add Field CTA Button */}
                <button
                  type="submit"
                  disabled={isSubmittingField || !newFieldName.trim() || !selectedSpaceId}
                  className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-colors whitespace-nowrap flex-shrink-0 cursor-pointer"
                >
                  {isSubmittingField ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Adding...</span>
                    </>
                  ) : (
                    <>
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Field</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
        </div>

        {/* Modal Footer */}
        <div className="flex-shrink-0 px-6 py-3.5 border-t border-zinc-800 bg-zinc-900/60 flex items-center justify-between">
          <span className="text-[11px] text-zinc-400">
            Changes to queue lists and ordering synchronize in real-time across Kanban & Sidebar.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-medium text-zinc-300 hover:text-zinc-100 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg shadow-2xs transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

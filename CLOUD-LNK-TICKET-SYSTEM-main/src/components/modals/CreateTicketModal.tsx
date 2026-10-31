'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  X,
  Ticket,
  UploadCloud,
  FileText,
  Trash2,
  AlertCircle,
  Loader2,
  CheckCircle2,
  Tag,
  Building,
  Layers,
  Flag,
  Image as ImageIcon,
  CheckSquare,
  Plus,
  Calendar,
  RotateCcw,
} from 'lucide-react';
import { useWorkspace, SpaceItem, ListItem } from '@/context/workspace-context';
import { AuthenticatedUser } from '@/lib/security/rbac';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { invalidateClientTasksCache } from '@/lib/client-cache';
import { uploadFileWithProgress } from '@/lib/client-file-uploader';

export interface StagedFileItem {
  localId: string;
  file: File;
  status: 'UPLOADING' | 'UPLOADED' | 'ERROR';
  progress: number;
  errorMessage?: string;
  stagedData?: {
    fileId: string;
    fileName: string;
    fileUrl: string;
    fileType: string;
    fileSize: number;
  };
  abortController?: AbortController;
}

export interface SpaceCustomField {
  id: string;
  spaceId: string;
  listId?: string | null;
  list?: { id: string; name: string } | null;
  name: string;
  fieldType: 'TEXT' | 'NUMBER' | 'CURRENCY' | 'SELECT' | 'DATE';
  options?: string | null;
  isRequired: boolean;
  order: number;
}

interface CreateTicketModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTicketCreated?: (task: any) => void;
  currentUser: AuthenticatedUser;
}

const PRIORITIES = [
  { value: 'LOW', label: 'Low', color: 'bg-blue-600 text-white border-blue-600 dark:bg-zinc-800 dark:text-zinc-200 dark:border-zinc-600' },
  { value: 'NORMAL', label: 'Normal', color: 'bg-blue-600 text-white border-blue-600 dark:bg-blue-600 dark:text-white dark:border-blue-500' },
  { value: 'HIGH', label: 'High', color: 'bg-blue-600 text-white border-blue-600 dark:bg-amber-950/80 dark:text-amber-300 dark:border-amber-700' },
  { value: 'URGENT', label: 'Urgent', color: 'bg-blue-600 text-white border-blue-600 dark:bg-red-950/80 dark:text-red-300 dark:border-red-700' },
];

export function CreateTicketModal({
  isOpen,
  onClose,
  onTicketCreated,
  currentUser,
}: CreateTicketModalProps) {
  const { spaces: sidebarSpaces, currentSpace, currentList } = useWorkspace();

  // Intake Spaces state (All active company departments)
  const [intakeSpaces, setIntakeSpaces] = useState<SpaceItem[]>([]);
  const [loadingIntakeSpaces, setLoadingIntakeSpaces] = useState(false);

  // Selected space and list
  const [selectedSpaceId, setSelectedSpaceId] = useState<string>('');
  const [selectedListId, setSelectedListId] = useState<string>('');

  // Form inputs
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('NORMAL');

  // Dynamic custom fields state
  const [customFields, setCustomFields] = useState<Record<string, string>>({});
  const [spaceCustomFields, setSpaceCustomFields] = useState<SpaceCustomField[]>([]);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string>>({});

  // Filter custom fields: department-wide fields + queue-specific fields for the selected queue
  const applicableCustomFields = useMemo(() => {
    return spaceCustomFields.filter(
      (field) =>
        field.spaceId === selectedSpaceId &&
        (!field.listId || field.listId === selectedListId)
    );
  }, [spaceCustomFields, selectedSpaceId, selectedListId]);

  // Timeline & Milestones state
  const [startDate, setStartDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [isMilestone, setIsMilestone] = useState(false);

  // Initial Checklist items
  const [initialChecklist, setInitialChecklist] = useState<string[]>([]);
  const [newChecklistInput, setNewChecklistInput] = useState('');

  // Staged files for eager upload
  const [stagedFiles, setStagedFiles] = useState<StagedFileItem[]>([]);
  const stagedFilesRef = useRef<StagedFileItem[]>([]);
  stagedFilesRef.current = stagedFiles;
  const ticketCreatedSuccessRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);

  // Submission & Multi-Stage Progress State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [creationStep, setCreationStep] = useState<'IDLE' | 'CREATING_TICKET' | 'SUCCESS'>('IDLE');
  const [uploadProgress, setUploadProgress] = useState<{ completed: number; total: number; percent: number }>({
    completed: 0,
    total: 0,
    percent: 0,
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const wasOpenRef = useRef(false);

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setPriority('NORMAL');
    setCustomFields({});
    setCustomFieldValues({});
    setInitialChecklist([]);
    setNewChecklistInput('');
    setStartDate('');
    setDueDate('');
    setIsMilestone(false);
    setStagedFiles([]);
    setErrorMessage(null);
    setCreationStep('IDLE');
    setUploadProgress({ completed: 0, total: 0, percent: 0 });
    ticketCreatedSuccessRef.current = false;
  };

  // Cleanup staged files on cancel or modal close (unless ticket was successfully created)
  const handleCloseAndCleanup = () => {
    if (creationStep !== 'IDLE' || isSubmitting) return;

    if (!ticketCreatedSuccessRef.current) {
      const uploadedFileIds = stagedFilesRef.current
        .filter((f) => f.status === 'UPLOADED' && f.stagedData?.fileId)
        .map((f) => f.stagedData!.fileId);

      // Abort any in-flight uploads
      stagedFilesRef.current.forEach((f) => {
        if (f.abortController) f.abortController.abort();
      });

      if (uploadedFileIds.length > 0) {
        try {
          fetch('/api/attachments/stage', {
            method: 'DELETE',
            keepalive: true,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileIds: uploadedFileIds }),
          }).catch((err) => console.warn('Failed to clean up abandoned staged files:', err));
        } catch (err) {
          console.warn('Keepalive delete failed:', err);
        }
      }
    }

    resetForm();
    onClose();
  };

  // Guard 1: Reset form fields strictly upon explicit open state transition & cleanup on abandon
  useEffect(() => {
    if (!isOpen) {
      wasOpenRef.current = false;

      // If modal was closed without creating the ticket, cleanup staged files
      if (!ticketCreatedSuccessRef.current && stagedFilesRef.current.length > 0) {
        const uploadedFileIds = stagedFilesRef.current
          .filter((f) => f.status === 'UPLOADED' && f.stagedData?.fileId)
          .map((f) => f.stagedData!.fileId);

        stagedFilesRef.current.forEach((f) => {
          if (f.abortController) f.abortController.abort();
        });

        if (uploadedFileIds.length > 0) {
          fetch('/api/attachments/stage', {
            method: 'DELETE',
            keepalive: true,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileIds: uploadedFileIds }),
          }).catch(() => {});
        }
      }

      setStagedFiles([]);
      setCreationStep('IDLE');
      setUploadProgress({ completed: 0, total: 0, percent: 0 });
      ticketCreatedSuccessRef.current = false;
      return;
    }

    if (!wasOpenRef.current) {
      wasOpenRef.current = true;
      resetForm();

      // Focus title after render
      setTimeout(() => titleInputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Load space custom fields when selectedSpaceId changes
  useEffect(() => {
    if (!selectedSpaceId) return;

    let isMounted = true;
    fetch(`/api/spaces/${selectedSpaceId}/custom-fields`)
      .then((res) => res.json())
      .then((data) => {
        if (isMounted && Array.isArray(data.fields)) {
          setSpaceCustomFields(data.fields);
        } else if (isMounted) {
          setSpaceCustomFields([]);
        }
      })
      .catch((err) => console.error('Failed to load custom fields', err));

    return () => {
      isMounted = false;
    };
  }, [selectedSpaceId]);

  // Load all active spaces for universal cross-department intake
  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    const fetchIntakeSpaces = async () => {
      try {
        setLoadingIntakeSpaces(true);
        const res = await fetch('/api/spaces/intake');
        if (res.ok) {
          const data = await res.json();
          if (isMounted && Array.isArray(data.spaces) && data.spaces.length > 0) {
            setIntakeSpaces(data.spaces);

            // Synchronize selected space and primary queue
            setSelectedSpaceId((prevSpaceId) => {
              const matchedPrev = data.spaces.find((s: SpaceItem) => s.id === prevSpaceId);
              if (matchedPrev) return prevSpaceId;

              // Default to user's active space if available, or first company space
              const defaultSpace =
                data.spaces.find((s: SpaceItem) => s.id === currentSpace?.id) || data.spaces[0];
              if (defaultSpace) {
                const defaultList = defaultSpace.lists?.[0];
                if (defaultList) {
                  setSelectedListId(defaultList.id);
                }
                return defaultSpace.id;
              }
              return prevSpaceId;
            });
          }
        }
      } catch (err) {
        console.error('Failed to fetch intake spaces:', err);
      } finally {
        if (isMounted) setLoadingIntakeSpaces(false);
      }
    };

    fetchIntakeSpaces();

    return () => {
      isMounted = false;
    };
  }, [isOpen, currentSpace?.id]);

  const availableSpaces = intakeSpaces.length > 0 ? intakeSpaces : sidebarSpaces;

  const activeSpace = availableSpaces.find((s) => s.id === selectedSpaceId) || availableSpaces[0];

  const isSuperadmin = currentUser?.globalRole === 'SUPERADMIN';
  const isHead = Boolean(
    activeSpace &&
      currentUser?.id &&
      (activeSpace.departmentHeadId === currentUser.id ||
        activeSpace.departmentHead?.id === currentUser.id)
  );
  const isMember =
    isSuperadmin ||
    isHead ||
    Boolean(activeSpace?.members?.some((m) => m.userId === currentUser?.id));

  const activeLists = (activeSpace?.lists || []).filter((l) => !l.isPrivate || isMember);

  // Guard 2: Ensure list is selected when space is valid but list is unselected
  useEffect(() => {
    if (!isOpen) return;
    if (selectedSpaceId && (!selectedListId || !activeLists.some((l) => l.id === selectedListId))) {
      const firstList = activeLists[0];
      if (firstList) {
        setSelectedListId(firstList.id);
      }
    }
  }, [isOpen, selectedSpaceId, selectedListId, activeLists]);

  // Controlled handler for switching department space (Auto-selects primary intake queue)
  const handleSpaceChange = (newSpaceId: string) => {
    if (newSpaceId === selectedSpaceId) return;
    setSelectedSpaceId(newSpaceId);
    setCustomFields({});
    setCustomFieldValues({});
    setInitialChecklist([]);
    setNewChecklistInput('');

    const newSpace = availableSpaces.find((s) => s.id === newSpaceId);
    const isNewSpaceHead = Boolean(
      newSpace &&
        currentUser?.id &&
        (newSpace.departmentHeadId === currentUser.id ||
          newSpace.departmentHead?.id === currentUser.id)
    );
    const isNewSpaceMember =
      isSuperadmin ||
      isNewSpaceHead ||
      Boolean(newSpace?.members?.some((m) => m.userId === currentUser?.id));
    const newSpaceLists = (newSpace?.lists || []).filter((l) => !l.isPrivate || isNewSpaceMember);
    const firstList = newSpaceLists[0];
    setSelectedListId(firstList?.id || '');
  };

  const handleAddInitialChecklistItem = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const clean = newChecklistInput.trim();
    if (!clean) return;
    setInitialChecklist((prev) => [...prev, clean]);
    setNewChecklistInput('');
  };

  const handleRemoveInitialChecklistItem = (index: number) => {
    setInitialChecklist((prev) => prev.filter((_, i) => i !== index));
  };

  const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

  if (!isOpen) return null;

  // Handle eager upload for an individual file (Supports up to 100MB with direct Drive v3 streaming & live XHR progress)
  const uploadStagedFile = async (item: StagedFileItem) => {
    if (item.file.size > MAX_FILE_SIZE) {
      setStagedFiles((prev) =>
        prev.map((f) =>
          f.localId === item.localId
            ? {
                ...f,
                status: 'ERROR',
                progress: 0,
                errorMessage: `Exceeds 100MB maximum limit (${(item.file.size / (1024 * 1024)).toFixed(1)}MB)`,
              }
            : f
        )
      );
      return;
    }

    const abortController = new AbortController();

    setStagedFiles((prev) =>
      prev.map((f) =>
        f.localId === item.localId
          ? { ...f, status: 'UPLOADING', progress: 5, errorMessage: undefined, abortController }
          : f
      )
    );

    try {
      const stagedAttachment = await uploadFileWithProgress(item.file, {
        signal: abortController.signal,
        onProgress: (percent) => {
          setStagedFiles((prev) =>
            prev.map((f) =>
              f.localId === item.localId ? { ...f, progress: Math.max(f.progress, percent) } : f
            )
          );
        },
      });

      setStagedFiles((prev) =>
        prev.map((f) =>
          f.localId === item.localId
            ? {
                ...f,
                status: 'UPLOADED',
                progress: 100,
                stagedData: stagedAttachment,
                abortController: undefined,
              }
            : f
        )
      );
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      setStagedFiles((prev) =>
        prev.map((f) =>
          f.localId === item.localId
            ? {
                ...f,
                status: 'ERROR',
                errorMessage: err.message || 'Upload failed',
                abortController: undefined,
              }
            : f
        )
      );
    }
  };

  // Immediate upload on file selection
  const handleAddFiles = (files: FileList | File[]) => {
    if (creationStep !== 'IDLE' || isSubmitting) return;

    const newItems: StagedFileItem[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!stagedFiles.some((f) => f.file.name === file.name && f.file.size === file.size)) {
        const localId = `staged_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const isTooLarge = file.size > MAX_FILE_SIZE;
        newItems.push({
          localId,
          file,
          status: isTooLarge ? 'ERROR' : 'UPLOADING',
          progress: isTooLarge ? 0 : 5,
          errorMessage: isTooLarge
            ? `Exceeds 100MB maximum limit (${(file.size / (1024 * 1024)).toFixed(1)}MB)`
            : undefined,
        });
      }
    }

    if (newItems.length > 0) {
      setStagedFiles((prev) => [...prev, ...newItems]);
      newItems.forEach((item) => {
        if (item.status === 'UPLOADING') {
          uploadStagedFile(item);
        }
      });
    }
  };

  // Remove individual staged file & clean up Google Drive / RAM cache
  const handleRemoveFile = (localId: string) => {
    if (creationStep !== 'IDLE' || isSubmitting) return;

    const targetItem = stagedFiles.find((f) => f.localId === localId);
    if (!targetItem) return;

    if (targetItem.abortController) {
      targetItem.abortController.abort();
    }

    if (targetItem.status === 'UPLOADED' && targetItem.stagedData?.fileId) {
      const fileIdToDelete = targetItem.stagedData.fileId;
      fetch('/api/attachments/stage', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileIds: [fileIdToDelete] }),
      }).catch((err) => console.warn('Failed to delete removed staged file:', err));
    }

    setStagedFiles((prev) => prev.filter((f) => f.localId !== localId));
  };

  // Retry failed upload
  const handleRetryUpload = (localId: string) => {
    const item = stagedFiles.find((f) => f.localId === localId);
    if (item) {
      uploadStagedFile(item);
    }
  };

  // Clipboard Paste support (Ctrl + V)
  const handlePaste = (e: React.ClipboardEvent) => {
    if (creationStep !== 'IDLE' || isSubmitting) return;
    const items = e.clipboardData?.items;
    if (!items) return;

    const pastedFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) {
          const name = file.name.startsWith('image')
            ? `screenshot_${Date.now()}.png`
            : file.name;
          const namedFile = new File([file], name, { type: file.type });
          pastedFiles.push(namedFile);
        }
      }
    }

    if (pastedFiles.length > 0) {
      e.preventDefault();
      handleAddFiles(pastedFiles);
    }
  };

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (creationStep === 'IDLE' && !isSubmitting) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (creationStep !== 'IDLE' || isSubmitting) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleAddFiles(e.dataTransfer.files);
    }
  };

  // Custom field update helper
  const handleCustomFieldChange = (key: string, value: string) => {
    setCustomFields((prev) => ({ ...prev, [key]: value }));
  };

  // Streamlined Ticket Submit Handler (Fast single-step creation with pre-uploaded attachments)
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!title.trim()) {
      setErrorMessage('Please provide a ticket title.');
      titleInputRef.current?.focus();
      return;
    }

    if (!selectedSpaceId || !selectedListId) {
      setErrorMessage('Please select a target Space and List queue.');
      return;
    }

    if (stagedFiles.some((f) => f.status === 'UPLOADING')) {
      setErrorMessage('Please wait for file attachments to finish uploading.');
      return;
    }

    if (stagedFiles.some((f) => f.status === 'ERROR')) {
      setErrorMessage('Some attachments failed to upload. Please retry or remove them before creating the ticket.');
      return;
    }

    // Validate required department custom fields (scoped to department-wide + selected queue list)
    for (const field of applicableCustomFields) {
      if (field.isRequired) {
        const val = customFieldValues[field.id];
        if (!val || String(val).trim() === '') {
          setErrorMessage(`Required department field "${field.name}" is missing.`);
          return;
        }
      }
    }

    setIsSubmitting(true);
    setCreationStep('CREATING_TICKET');
    setUploadProgress({
      completed: stagedFiles.length,
      total: stagedFiles.length,
      percent: 50,
    });

    try {
      const readyAttachments = stagedFiles
        .filter((f) => f.status === 'UPLOADED' && f.stagedData)
        .map((f) => f.stagedData!);

      // Single atomic Task Creation with pre-uploaded attachments
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          priority,
          spaceId: selectedSpaceId,
          listId: selectedListId,
          customFieldValues: applicableCustomFields
            .map((f) => ({
              fieldId: f.id,
              value: String(customFieldValues[f.id] || '').trim(),
            }))
            .filter((v) => v.value !== ''),
          checklistItems: initialChecklist,
          customFields: Object.fromEntries(
            applicableCustomFields.map((f) => [f.id, customFieldValues[f.id] || ''])
          ),
          startDate: startDate || null,
          dueDate: dueDate || null,
          isMilestone,
          stagedAttachments: readyAttachments,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create ticket.');
      }

      const { task: newTask } = await res.json();

      // Guard against cancel cleanup
      ticketCreatedSuccessRef.current = true;

      // Stage 2: Success state (100%)
      setCreationStep('SUCCESS');
      setUploadProgress({
        completed: readyAttachments.length,
        total: readyAttachments.length,
        percent: 100,
      });

      // Synchronize client cache and workspace state immediately
      invalidateClientTasksCache();
      onTicketCreated?.(newTask);

      if (readyAttachments.length > 0) {
        toast.success(
          `Ticket ${newTask.taskKey} created with ${readyAttachments.length} attachment${readyAttachments.length > 1 ? 's' : ''}`,
          'Ticket Created'
        );
      } else {
        toast.success(`Ticket ${newTask.taskKey} created successfully`, 'Ticket Created');
      }

      // Brief emerald success state for 400ms before closing modal
      await new Promise((resolve) => setTimeout(resolve, 400));

      resetForm();
      onClose();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Unknown error creating ticket.');
      setCreationStep('IDLE');
    } finally {
      setIsSubmitting(false);
    }
  };

  const spaceKey = activeSpace?.key.toUpperCase() || '';

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6 overflow-y-auto"
      onPaste={handlePaste}
    >
      <div className="bg-[#F0F4FA] dark:bg-[#12151E] border border-[#C8D5E6] dark:border-white/10 rounded-xl shadow-2xl shadow-blue-950/10 max-w-2xl w-full max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150 text-[#0F172A] dark:text-zinc-100">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#C8D5E6] dark:border-white/10 bg-[#EAF0F8] dark:bg-zinc-950/60 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#DFECFA] dark:bg-zinc-800 border border-[#B9D3F3] dark:border-zinc-700 flex items-center justify-center text-[#1E3A8A] dark:text-blue-400">
              <Ticket className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[#0F172A] dark:text-white">Create New Ticket</h3>
              <p className="text-[11px] text-[#475569] dark:text-slate-400">
                Submit an issue or service request with attachments and custom metadata
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={creationStep !== 'IDLE' || isSubmitting}
            onClick={handleCloseAndCleanup}
            className={cn(
              "p-1.5 text-[#475569] hover:text-[#0F172A] hover:bg-[#DEE8F4] dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer",
              (creationStep !== 'IDLE' || isSubmitting) && "opacity-40 cursor-not-allowed pointer-events-none"
            )}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body (Scrollable) */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5 bg-[#F0F4FA] dark:bg-[#12151E]">
          <fieldset disabled={creationStep !== 'IDLE' || isSubmitting} className="contents space-y-5">
          {/* Error Message */}
          {errorMessage && (
            <div className="p-3 bg-[#F9E8EC] dark:bg-red-950/60 border border-[#F1C4D0] dark:border-red-800 rounded-lg text-xs text-[#9F1239] dark:text-red-200 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-[#9F1239] dark:text-red-400 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Department Space & List Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-[#0F172A] dark:text-slate-300 flex items-center gap-1.5">
                <Building className="w-3.5 h-3.5 text-blue-600 dark:text-zinc-400" />
                Target Space (Department)
              </label>
              <select
                value={selectedSpaceId}
                onChange={(e) => handleSpaceChange(e.target.value)}
                className="w-full bg-[#F3F6FB] dark:bg-zinc-950 border border-[#C4D2E4] dark:border-zinc-800 rounded-lg px-3 py-2 text-xs text-[#0F172A] dark:text-slate-100 focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 cursor-pointer"
              >
                {availableSpaces.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.key})
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-[#0F172A] dark:text-slate-300 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-blue-600 dark:text-zinc-400" />
                Queue / List
              </label>
              <select
                value={selectedListId}
                onChange={(e) => setSelectedListId(e.target.value)}
                className="w-full bg-[#F3F6FB] dark:bg-zinc-950 border border-[#C4D2E4] dark:border-zinc-800 rounded-lg px-3 py-2 text-xs text-[#0F172A] dark:text-slate-100 focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 cursor-pointer"
              >
                {activeLists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} {l.isPrivate ? '(Private)' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Title Input */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#0F172A] dark:text-slate-300 flex items-center justify-between">
              <span>Title <span className="text-rose-500 dark:text-red-400">*</span></span>
              <span className="text-[10px] text-[#475569] dark:text-slate-400 font-mono font-normal">Short, concise summary</span>
            </label>
            <input
              ref={titleInputRef}
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Workstation SSD failure or Core Switch link flap..."
              className="w-full bg-[#F3F6FB] dark:bg-zinc-950 border border-[#C4D2E4] dark:border-zinc-800 rounded-lg px-3 py-2 text-xs text-[#0F172A] dark:text-slate-100 placeholder-[#64748B] dark:placeholder-zinc-500 focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
            />
          </div>

          {/* Priority Picker */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#0F172A] dark:text-slate-300 flex items-center gap-1.5">
              <Flag className="w-3.5 h-3.5 text-blue-600 dark:text-zinc-400" />
              Priority Level
            </label>
            <div className="grid grid-cols-4 gap-2">
              {PRIORITIES.map((p) => {
                const isSelected = priority === p.value;
                return (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setPriority(p.value)}
                    className={`py-1.5 px-2 text-xs rounded-lg border text-center transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-blue-600 text-white border-blue-600 shadow-sm shadow-blue-600/20 font-semibold'
                        : 'bg-[#D8E1EE] text-[#1E293B] border-[#C4D1E2] hover:bg-[#CAD8EA] hover:border-[#ADC8EC] font-medium dark:bg-white/5 dark:text-slate-300 dark:border-white/10 dark:hover:text-white dark:hover:border-white/20'
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Description Textarea */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#0F172A] dark:text-slate-300 flex items-center justify-between">
              <span>Detailed Description</span>
              <span className="text-[10px] text-[#475569] dark:text-slate-400 font-normal">Supports Ctrl + V screenshot paste</span>
            </label>
            <textarea
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Provide complete steps to reproduce, error codes, and troubleshooting already attempted..."
              className="w-full bg-[#F3F6FB] dark:bg-zinc-950 border border-[#C4D2E4] dark:border-zinc-800 rounded-lg p-3 text-xs text-[#0F172A] dark:text-slate-100 placeholder-[#64748B] dark:placeholder-zinc-500 focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 leading-relaxed font-sans"
            />
          </div>

          {/* Default Action Checklist Section */}
          <div className="space-y-2 p-3.5 bg-slate-50/90 border border-slate-200/90 dark:bg-white/[0.03] dark:border-white/10 rounded-xl">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                <CheckSquare className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>Action Checklist Subtasks ({initialChecklist.length})</span>
              </label>
              <span className="text-[10px] text-slate-500 dark:text-slate-400">Subtasks pre-populated on ticket</span>
            </div>

            {/* Checklist Chips */}
            {initialChecklist.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {initialChecklist.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 text-xs text-slate-800 dark:text-zinc-200 shadow-2xs"
                  >
                    <span className="text-emerald-600 dark:text-emerald-400 font-mono text-[10px]">☑</span>
                    <span className="truncate max-w-[220px]">{item}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveInitialChecklistItem(idx)}
                      className="text-slate-400 hover:text-rose-600 dark:text-zinc-500 dark:hover:text-red-400 cursor-pointer ml-0.5"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Quick-add row for subtask */}
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newChecklistInput}
                onChange={(e) => setNewChecklistInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddInitialChecklistItem(e);
                  }
                }}
                placeholder="Add a default checklist subtask... (Press Enter)"
                className="w-full bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 dark:text-zinc-200 placeholder-slate-400 dark:placeholder-zinc-600 focus:outline-none focus:border-blue-600"
              />
              <button
                type="button"
                onClick={handleAddInitialChecklistItem}
                className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer shrink-0 flex items-center gap-1 shadow-sm shadow-blue-600/20 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add</span>
              </button>
            </div>
          </div>

          {/* Dynamic Department Custom Fields */}
          {applicableCustomFields.length > 0 && (
            <div className="p-3.5 bg-slate-50/90 border border-slate-200/90 dark:bg-white/[0.03] dark:border-white/10 rounded-xl space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
                <Tag className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                <span>Department Custom Fields ({activeSpace?.name || 'Space'})</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {applicableCustomFields.map((field) => {
                  const val = customFieldValues[field.id] || '';
                  let parsedOptions: string[] = [];
                  if (field.fieldType === 'SELECT' && field.options) {
                    try {
                      parsedOptions = JSON.parse(field.options);
                    } catch {
                      parsedOptions = [];
                    }
                  }

                  return (
                    <div key={field.id} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <label className="text-[11px] text-zinc-400 font-medium flex items-center gap-1.5">
                          <span>{field.name}</span>
                          {field.isRequired && (
                            <span className="text-red-400 font-bold" title="Required field">*</span>
                          )}
                          {field.listId && (
                            <span className="px-1.5 py-0.2 rounded text-[9px] font-semibold bg-indigo-950/60 text-indigo-300 border border-indigo-700/50">
                              Queue-Specific
                            </span>
                          )}
                        </label>
                        <span className="text-[9px] font-mono uppercase text-zinc-500">
                          {field.fieldType}
                        </span>
                      </div>

                      {field.fieldType === 'SELECT' ? (
                        <select
                          value={val}
                          onChange={(e) =>
                            setCustomFieldValues((prev) => ({
                              ...prev,
                              [field.id]: e.target.value,
                            }))
                          }
                          className="w-full bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-zinc-600 cursor-pointer"
                        >
                          <option value="">-- Select {field.name} --</option>
                          {parsedOptions.map((opt, i) => (
                            <option key={i} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      ) : field.fieldType === 'CURRENCY' ? (
                        <div className="relative">
                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500 text-xs font-mono">
                            ₱
                          </span>
                          <input
                            type="number"
                            step="0.01"
                            value={val}
                            onChange={(e) =>
                              setCustomFieldValues((prev) => ({
                                ...prev,
                                [field.id]: e.target.value,
                              }))
                            }
                            placeholder="0.00"
                            className="w-full bg-zinc-900 border border-zinc-800 rounded pl-6 pr-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
                          />
                        </div>
                      ) : field.fieldType === 'NUMBER' ? (
                        <input
                          type="number"
                          value={val}
                          onChange={(e) =>
                            setCustomFieldValues((prev) => ({
                              ...prev,
                              [field.id]: e.target.value,
                            }))
                          }
                          placeholder={`Enter ${field.name}`}
                          className="w-full bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
                        />
                      ) : field.fieldType === 'DATE' ? (
                        <input
                          type="date"
                          value={val}
                          onChange={(e) =>
                            setCustomFieldValues((prev) => ({
                              ...prev,
                              [field.id]: e.target.value,
                            }))
                          }
                          className="w-full bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-zinc-600"
                        />
                      ) : (
                        <input
                          type="text"
                          value={val}
                          onChange={(e) =>
                            setCustomFieldValues((prev) => ({
                              ...prev,
                              [field.id]: e.target.value,
                            }))
                          }
                          placeholder={`Enter ${field.name}`}
                          className="w-full bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Timeline & Milestones Section */}
          <div className="p-3.5 bg-slate-50/90 border border-slate-200/90 dark:bg-white/[0.03] dark:border-white/10 rounded-xl space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
              <Calendar className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>Timeline & Milestones (Optional)</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] text-slate-600 dark:text-zinc-400 font-medium">Planned Start Date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 dark:text-zinc-200 focus:outline-none focus:border-blue-600"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] text-slate-600 dark:text-zinc-400 font-medium">Planned Due Date</label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 dark:text-zinc-200 focus:outline-none focus:border-blue-600"
                />
              </div>
            </div>

            <div className="pt-1 flex items-center justify-between">
              <label className="text-xs text-slate-700 dark:text-zinc-300 flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isMilestone}
                  onChange={(e) => setIsMilestone(e.target.checked)}
                  className="rounded border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-amber-500 focus:ring-0 cursor-pointer"
                />
                <span className="flex items-center gap-1 font-medium">
                  <span className="text-amber-500 dark:text-amber-400 font-bold">◆</span>
                  <span>Mark as Project Milestone</span>
                </span>
              </label>
            </div>
          </div>


          {/* File Attachments Dropzone & Staged List */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <UploadCloud className="w-3.5 h-3.5 text-blue-600 dark:text-zinc-400" />
                Local File Attachments
              </label>
              <span className="text-[10px] text-slate-500 dark:text-zinc-400 font-mono">
                Up to 100MB per file
              </span>
            </div>

            {/* Dropzone Container */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => {
                if (creationStep === 'IDLE' && !isSubmitting) {
                  fileInputRef.current?.click();
                }
              }}
              className={cn(
                "border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all",
                isDragging
                  ? "border-blue-500 bg-blue-50 dark:bg-blue-950/20"
                  : "border-blue-200 bg-blue-50/40 hover:bg-blue-50/80 hover:border-blue-300 dark:border-white/10 dark:bg-white/[0.02] dark:hover:border-zinc-700 dark:hover:bg-zinc-950",
                (creationStep !== 'IDLE' || isSubmitting) && "opacity-50 cursor-not-allowed pointer-events-none"
              )}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                disabled={creationStep !== 'IDLE' || isSubmitting}
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    handleAddFiles(e.target.files);
                  }
                }}
              />
              <UploadCloud className="w-6 h-6 text-blue-500 dark:text-zinc-500 mx-auto mb-1.5" />
              <p className="text-xs text-slate-700 dark:text-zinc-300 font-medium">
                Drop files here, click to browse, or paste image with{' '}
                <kbd className="px-1.5 py-0.5 rounded bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 font-mono text-[10px] text-slate-700 dark:text-zinc-300 shadow-2xs">
                  Ctrl + V
                </kbd>
              </p>
              <p className="text-[10px] text-slate-500 dark:text-zinc-500 mt-1">
                Documents, CAD/PDF packages, archives, video (up to 100MB per file: PDF, ZIP, RAR, 7Z, MP4, DWG, PNG, JPG, XLSX, etc.)
              </p>
            </div>

            {/* Staged Files List with Per-File Progress & Actions */}
            {stagedFiles.length > 0 && (
              <div className="space-y-1.5 pt-1">
                <div className="flex items-center justify-between text-[11px] font-medium text-zinc-400">
                  <span>Staged Files ({stagedFiles.length}):</span>
                  <span className="text-[10px] text-zinc-500 font-mono">
                    {stagedFiles.filter((f) => f.status === 'UPLOADED').length} ready
                    {stagedFiles.some((f) => f.status === 'UPLOADING') && ' • uploading...'}
                  </span>
                </div>
                <div className="divide-y divide-zinc-800/80 border border-zinc-800 rounded-lg overflow-hidden bg-zinc-950/60">
                  {stagedFiles.map((item) => {
                    const isImg = item.file.type.startsWith('image/');
                    const sizeMb = item.file.size / (1024 * 1024);
                    const sizeFormatted = sizeMb >= 1 ? `${sizeMb.toFixed(1)} MB` : `${(item.file.size / 1024).toFixed(1)} KB`;

                    return (
                      <div
                        key={item.localId}
                        className="flex flex-col px-3 py-2 text-xs hover:bg-zinc-900/60 transition-colors gap-1.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            {isImg ? (
                              <ImageIcon className="w-4 h-4 text-purple-400 shrink-0" />
                            ) : (
                              <FileText className="w-4 h-4 text-blue-400 shrink-0" />
                            )}
                            <span className="font-mono text-zinc-200 truncate">{item.file.name}</span>
                            <span className="text-[10px] font-mono text-zinc-500 shrink-0">
                              ({sizeFormatted})
                            </span>
                          </div>

                          {/* Status Badge & Actions */}
                          <div className="flex items-center gap-2 shrink-0">
                            {item.status === 'UPLOADING' && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-blue-950/60 text-blue-400 border border-blue-800/50">
                                <Loader2 className="w-3 h-3 animate-spin" />
                                <span>Uploading...</span>
                              </span>
                            )}
                            {item.status === 'UPLOADED' && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-950/60 text-emerald-400 border border-emerald-800/50">
                                <CheckCircle2 className="w-3 h-3" />
                                <span>Uploaded • Ready</span>
                              </span>
                            )}
                            {item.status === 'ERROR' && (
                              <div className="flex items-center gap-1.5">
                                <span
                                  title={item.errorMessage || 'Upload failed'}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-red-950/60 text-red-400 border border-red-800/50"
                                >
                                  <AlertCircle className="w-3 h-3" />
                                  <span>Failed</span>
                                </span>
                                <button
                                  type="button"
                                  disabled={creationStep !== 'IDLE' || isSubmitting}
                                  onClick={() => handleRetryUpload(item.localId)}
                                  className="px-1.5 py-0.5 text-[10px] font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded border border-zinc-700 cursor-pointer transition-colors flex items-center gap-1"
                                >
                                  <RotateCcw className="w-2.5 h-2.5" />
                                  <span>Retry</span>
                                </button>
                              </div>
                            )}

                            <button
                              type="button"
                              disabled={creationStep !== 'IDLE' || isSubmitting}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRemoveFile(item.localId);
                              }}
                              title="Remove file"
                              className={cn(
                                "text-zinc-500 hover:text-red-400 p-1 rounded transition-colors cursor-pointer",
                                (creationStep !== 'IDLE' || isSubmitting) && "opacity-40 cursor-not-allowed pointer-events-none"
                              )}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Per-File Animated Progress Bar */}
                        {item.status === 'UPLOADING' && (
                          <div className="w-full bg-zinc-900 rounded-full h-1 overflow-hidden border border-zinc-800/80">
                            <div
                              className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full transition-all duration-300 ease-out"
                              style={{ width: `${item.progress}%` }}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          </fieldset>
        </form>

        {/* Footer Actions / Creation Progress Bar */}
        <div className="px-6 py-3.5 border-t border-[#C8D5E6] dark:border-white/10 bg-[#EAF0F8] dark:bg-[#0D0F17] shrink-0">
          {creationStep !== 'IDLE' ? (
            <div className="w-full space-y-2 py-0.5 animate-in fade-in duration-200">
              <div className="flex items-center justify-between text-xs font-medium">
                <div className="flex items-center gap-2">
                  {creationStep === 'CREATING_TICKET' && (
                    <>
                      <Loader2 className="w-4 h-4 text-blue-600 dark:text-blue-400 animate-spin shrink-0" />
                      <span className="text-slate-800 dark:text-zinc-200">Creating ticket in department queue...</span>
                    </>
                  )}
                  {creationStep === 'SUCCESS' && (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      <span className="text-emerald-700 dark:text-emerald-300 font-semibold">Ticket created successfully!</span>
                    </>
                  )}
                </div>
                <span
                  className={cn(
                    "font-mono text-xs font-semibold tabular-nums",
                    creationStep === 'SUCCESS' ? "text-emerald-600 dark:text-emerald-400" : "text-blue-600 dark:text-blue-400"
                  )}
                >
                  {uploadProgress.percent}%
                </span>
              </div>

              {/* Progress Bar Track */}
              <div className="w-full bg-slate-200 dark:bg-zinc-900 rounded-full h-2.5 overflow-hidden border border-slate-300 dark:border-zinc-800 p-0.5">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-300 ease-out",
                    creationStep === 'SUCCESS'
                      ? "bg-gradient-to-r from-emerald-500 to-teal-400 shadow-sm shadow-emerald-500/50"
                      : "bg-gradient-to-r from-blue-600 to-indigo-500 shadow-sm shadow-blue-500/50"
                  )}
                  style={{ width: `${uploadProgress.percent}%` }}
                />
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div className="text-[11px] text-slate-600 dark:text-slate-400 font-mono">
                Reporter: <span className="text-slate-900 dark:text-white font-semibold">@{currentUser.username}</span>
              </div>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleCloseAndCleanup}
                  className="px-3.5 py-1.5 bg-[#D8E1EE] text-[#1E293B] border border-[#C4D1E2] hover:bg-[#CAD8EA] dark:bg-white/5 dark:text-slate-300 dark:border-white/10 dark:hover:bg-white/10 text-xs font-medium rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>

                {(() => {
                  const isAnyFileUploading = stagedFiles.some((f) => f.status === 'UPLOADING');
                  const hasUploadErrors = stagedFiles.some((f) => f.status === 'ERROR');

                  if (isAnyFileUploading) {
                    return (
                      <button
                        type="button"
                        disabled
                        title="Waiting for file uploads to finish"
                        className="px-4 py-1.5 bg-blue-600/70 text-white text-xs font-semibold rounded-lg shadow flex items-center gap-1.5 cursor-not-allowed opacity-80"
                      >
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Uploading files...</span>
                      </button>
                    );
                  }

                  if (hasUploadErrors) {
                    return (
                      <button
                        type="button"
                        disabled
                        title="Please retry or remove failed file uploads"
                        className="px-4 py-1.5 bg-red-600/60 text-white text-xs font-semibold rounded-lg shadow flex items-center gap-1.5 cursor-not-allowed opacity-80"
                      >
                        <AlertCircle className="w-3.5 h-3.5" />
                        <span>Fix Failed Uploads</span>
                      </button>
                    );
                  }

                  return (
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={handleSubmit}
                      className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-sm shadow-blue-600/20 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <Ticket className="w-3.5 h-3.5" />
                      <span>Create Ticket</span>
                    </button>
                  );
                })()}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  X,
  Copy,
  Check,
  Building,
  Layers,
  Flag,
  UserCheck,
  User as UserIcon,
  Calendar,
  Clock,
  MessageSquare,
  Lock,
  Send,
  UploadCloud,
  FileText,
  Download,
  AlertCircle,
  AlertTriangle,
  Loader2,
  Tag,
  Edit2,
  CheckCheck,
  CheckSquare,
  Eye,
  Paperclip,
  Image as ImageIcon,
  Trash2,
  ArrowRightLeft,
  ArrowLeftRight,
  ArrowRight,
  GitBranch,
  Users,
  RefreshCw,
  CheckCircle2,
  AtSign,
  Hash,
  DollarSign,
  ListFilter,
  Type,
  Link as LinkIcon,
  PlusCircle,
} from 'lucide-react';
import { AuthenticatedUser } from '@/lib/security/rbac';
import { TaskStatusItem, useWorkspace } from '@/context/workspace-context';
import { ScrollArea } from '@/components/ui/scroll-area';
import { TicketResolutionHandoffModal } from '@/components/modals/TicketResolutionHandoffModal';
import { uploadFileWithProgress } from '@/lib/client-file-uploader';
import { canModifyTicket, hasTicketSpaceClearance } from '@/lib/security/permissions';
import { evaluateTaskSla } from '@/lib/sla';
import { computeTaskCollaboration } from '@/lib/collaboration-utils';
import { getClientCache, setClientCache } from '@/lib/client-cache';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import {
  CANONICAL_STATUSES,
  getResolvedWorkflowStatuses,
  resolveCanonicalStatusName,
  getCanonicalStatusColor,
} from '@/lib/status-utils';

export interface CustomFieldDef {
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

export interface TaskCustomFieldValueItem {
  id: string;
  taskId: string;
  fieldId: string;
  value: string;
  updatedAt: string;
  field: CustomFieldDef;
}

export interface TaskChecklistItemData {
  id: string;
  taskId: string;
  title: string;
  isCompleted: boolean;
  completedById?: string | null;
  completedAt?: string | null;
  order: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface TaskDetailAttachment {
  id: string;
  taskId: string;
  fileName?: string;
  fileUrl?: string;
  fileType?: string;
  fileSize?: number;
  uploadedById?: string;
  uploadedBy?: {
    id: string;
    username: string;
    name: string;
  };
  filename?: string;
  filepath?: string;
  size?: number;
  mimeType?: string;
  createdAt: string;
  uploader?: {
    id: string;
    username: string;
    name: string;
    email?: string;
  };
}

export interface TaskCommentAttachment {
  id?: string;
  fileName?: string;
  filename?: string;
  fileUrl?: string;
  filepath?: string;
  fileType?: string;
  mimeType?: string;
  fileSize?: number;
  size?: number;
}

export interface TaskDetailComment {
  id: string;
  taskId: string;
  authorId: string;
  content: string;
  isInternal: boolean;
  attachmentsJson?: string | null;
  attachments?: TaskCommentAttachment[];
  createdAt: string;
  author: {
    id: string;
    username: string;
    name: string;
    email?: string;
    globalRole: string;
    spaceMemberships?: Array<{ space: { id: string; name: string; key: string } }>;
  };
}

export interface TaskContributor {
  id: string;
  username: string;
  name: string;
  email: string;
  globalRole: string;
  homeDepartment?: string;
  spaceMemberships?: Array<{ space: { id: string; name: string; key: string } }>;
}

export interface TaskHistoryRecord {
  id: string;
  taskId: string;
  actorId: string;
  actor: {
    id: string;
    username: string;
    name: string;
    email: string;
    globalRole: string;
    homeDepartment?: string;
    spaceMemberships?: Array<{ space: { id: string; name: string; key: string } }>;
  };
  actionType: string;
  fromSpaceId?: string | null;
  fromSpace?: { id: string; name: string; key: string } | null;
  toSpaceId?: string | null;
  toSpace?: { id: string; name: string; key: string } | null;
  fromQueueName?: string | null;
  toQueueName?: string | null;
  notes?: string | null;
  createdAt: string;
}

export interface TaskDetailData {
  id: string;
  taskKey: string;
  title: string;
  description?: string | null;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  statusId: string;
  listId: string;
  spaceId: string;
  assigneeId?: string | null;
  createdById: string;
  customFields: string;
  customFieldValues?: TaskCustomFieldValueItem[];
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  space: {
    id: string;
    name: string;
    key: string;
    statuses?: TaskStatusItem[];
    lists?: Array<{ id: string; name: string; color?: string; order: number; isPrivate?: boolean }>;
    customFields?: CustomFieldDef[];
    slaPolicy?: any;
  };
  list: {
    id: string;
    name: string;
  };
  status: {
    id: string;
    name: string;
    color: string;
    order: number;
    isCompleted: boolean;
    isClosed: boolean;
  };
  assignee?: {
    id: string;
    username: string;
    name: string;
    email: string;
    globalRole?: string;
    spaceMemberships?: Array<{ space: { id: string; name: string; key: string } }>;
  } | null;
  createdBy: {
    id: string;
    username: string;
    name: string;
    email: string;
    globalRole: string;
    homeDepartment?: string;
    spaceMemberships?: Array<{ space: { id: string; name: string; key: string } }>;
  };
  comments?: TaskDetailComment[];
  checklistItems?: TaskChecklistItemData[];
  attachments?: TaskDetailAttachment[];
  contributors?: TaskContributor[];
  history?: TaskHistoryRecord[];
  startDate?: string | null;
  dueDate?: string | null;
  isMilestone?: boolean;
  dependsOnIds?: string | null;
  progress?: number;
}

interface TaskDetailDrawerProps {
  taskId: string | null;
  initialTask?: any;
  isOpen: boolean;
  onClose: () => void;
  currentUser: AuthenticatedUser;
  onTaskUpdated?: (updatedTask: any) => void;
  allStaffUsers?: Array<{ id: string; name: string; username: string; email: string }>;
}

function extractCustomFieldsDraft(taskObj: any): Record<string, string> {
  const initialFields: Record<string, string> = {};
  if (!taskObj) return initialFields;
  try {
    const legacy =
      typeof taskObj.customFields === 'string'
        ? JSON.parse(taskObj.customFields)
        : taskObj.customFields || {};
    if (legacy && typeof legacy === 'object') {
      Object.assign(initialFields, legacy);
    }
  } catch {}

  if (Array.isArray(taskObj.customFieldValues)) {
    taskObj.customFieldValues.forEach((cfv: any) => {
      if (cfv.fieldId) initialFields[cfv.fieldId] = cfv.value;
      if (cfv.field?.name) initialFields[cfv.field.name] = cfv.value;
    });
  }
  return initialFields;
}

function resolveAndNormalizeSeededTask(
  targetTaskId: string | null,
  initialTaskProp: any,
  workspaceTasksList: any[],
  spacesList: any[]
): TaskDetailData | null {
  if (!targetTaskId) return null;

  const detailCached = getClientCache<TaskDetailData>('task:detail:' + targetTaskId);
  const liveTask =
    (initialTaskProp?.id === targetTaskId ? initialTaskProp : null) ||
    workspaceTasksList?.find((t: any) => t.id === targetTaskId) ||
    null;

  if (!detailCached && !liveTask) return null;

  const raw: any =
    detailCached && liveTask
      ? {
          ...detailCached,
          ...liveTask,
          comments:
            Array.isArray(liveTask.comments) && liveTask.comments.length > 0
              ? liveTask.comments
              : detailCached.comments || [],
          history:
            Array.isArray(liveTask.history) && liveTask.history.length > 0
              ? liveTask.history
              : detailCached.history || [],
          checklistItems:
            Array.isArray(liveTask.checklistItems)
              ? liveTask.checklistItems
              : detailCached.checklistItems || [],
          attachments:
            Array.isArray(liveTask.attachments)
              ? liveTask.attachments
              : detailCached.attachments || [],
          customFieldValues:
            Array.isArray(liveTask.customFieldValues)
              ? liveTask.customFieldValues
              : detailCached.customFieldValues || [],
          contributors:
            Array.isArray(liveTask.contributors) && liveTask.contributors.length > 0
              ? liveTask.contributors
              : detailCached.contributors || [],
        }
      : liveTask || detailCached;

  const effectiveSpaceId = raw.spaceId || raw.space?.id || '';
  const matchedSpace = Array.isArray(spacesList)
    ? spacesList.find((s: any) => s.id === effectiveSpaceId)
    : null;

  const mergedSpace = {
    id: raw.space?.id || matchedSpace?.id || effectiveSpaceId,
    name: raw.space?.name || matchedSpace?.name || 'Department',
    key: raw.space?.key || matchedSpace?.key || 'GEN',
    statuses: raw.space?.statuses || matchedSpace?.statuses || [],
    lists: raw.space?.lists || matchedSpace?.lists || [],
    customFields: raw.space?.customFields || matchedSpace?.customFields || [],
    slaPolicy: raw.space?.slaPolicy || matchedSpace?.slaPolicy || null,
  };

  const mergedList =
    raw.list ||
    mergedSpace.lists?.find((l: any) => l.id === raw.listId) || {
      id: raw.listId || 'default',
      name: 'General Queue',
    };

  const mergedStatus = raw.status || {
    id: raw.statusId || 'st-open',
    name: resolveCanonicalStatusName(raw.statusId) || 'Open',
    color: '#3B82F6',
    order: 0,
    isCompleted: false,
    isClosed: false,
  };

  const mergedCreatedBy = raw.createdBy
    ? {
        ...raw.createdBy,
        homeDepartment:
          raw.createdBy.homeDepartment ||
          raw.createdBy.spaceMemberships?.[0]?.space?.name ||
          (raw.createdBy.globalRole === 'EMPLOYEE' ? 'Employee' : 'General'),
      }
    : {
        id: raw.createdById || '',
        username: 'user',
        name: 'Requester',
        email: '',
        globalRole: 'EMPLOYEE',
        homeDepartment: 'General',
      };

  return {
    ...raw,
    spaceId: effectiveSpaceId,
    listId: raw.listId || mergedList.id,
    statusId: raw.statusId || mergedStatus.id,
    customFields: typeof raw.customFields === 'string' ? raw.customFields : JSON.stringify(raw.customFields || {}),
    space: mergedSpace,
    list: mergedList,
    status: mergedStatus,
    createdBy: mergedCreatedBy,
    comments: Array.isArray(raw.comments) ? raw.comments : [],
    history: Array.isArray(raw.history) ? raw.history : [],
    checklistItems: Array.isArray(raw.checklistItems) ? raw.checklistItems : [],
    attachments: Array.isArray(raw.attachments) ? raw.attachments : [],
    customFieldValues: Array.isArray(raw.customFieldValues) ? raw.customFieldValues : [],
    contributors: Array.isArray(raw.contributors) ? raw.contributors : [],
  };
}

const PRIORITIES = [
  { value: 'LOW', label: 'Low', color: 'text-zinc-400 bg-zinc-800 border-zinc-700' },
  { value: 'NORMAL', label: 'Normal', color: 'text-blue-400 bg-blue-950/60 border-blue-800' },
  { value: 'HIGH', label: 'High', color: 'text-amber-400 bg-amber-950/60 border-amber-800' },
  { value: 'URGENT', label: 'Urgent', color: 'text-red-400 bg-red-950/60 border-red-800' },
];

function renderCommentWithMentions(content: string, isInternal: boolean) {
  if (!content) return null;
  const mentionRegex = /(@everyone|@[a-zA-Z0-9_.-]+)/g;
  const elements: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = mentionRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      elements.push(content.substring(lastIndex, match.index));
    }
    const mentionText = match[1];
    if (mentionText === '@everyone') {
      elements.push(
        <span
          key={`mention-${match.index}`}
          className="inline-flex items-center gap-0.5 px-1.5 py-0.2 mx-0.5 rounded font-semibold text-[11px] bg-purple-500/20 text-purple-300 border border-purple-500/30"
        >
          @everyone
        </span>
      );
    } else {
      elements.push(
        <span
          key={`mention-${match.index}`}
          className="inline-flex items-center gap-0.5 px-1.5 py-0.2 mx-0.5 rounded font-semibold text-[11px] bg-blue-500/20 text-blue-300 border border-blue-500/30"
        >
          {mentionText}
        </span>
      );
    }
    lastIndex = match.index + mentionText.length;
  }

  if (lastIndex < content.length) {
    elements.push(content.substring(lastIndex));
  }

  return elements.length > 0 ? elements : content;
}

export function TaskDetailDrawer({
  taskId,
  initialTask,
  isOpen,
  onClose,
  currentUser,
  onTaskUpdated,
  allStaffUsers = [],
}: TaskDetailDrawerProps) {
  const {
    subscribeToRealTimeEvents,
    spaces,
    tasks: workspaceTasks,
    updateTaskStatusOptimistic,
    optimisticRemoveTask,
    triggerTaskRefresh,
    refreshSpaces,
  } = useWorkspace();

  const initialTaskRef = useRef(initialTask);
  initialTaskRef.current = initialTask;
  const workspaceTasksRef = useRef(workspaceTasks);
  workspaceTasksRef.current = workspaceTasks;
  const spacesRef = useRef(spaces);
  spacesRef.current = spaces;

  // 0ms Instant Pre-Hydration on mount so opening any ticket renders in 0ms without a blocking spinner
  const initialSeeded = useMemo(
    () => resolveAndNormalizeSeededTask(taskId, initialTask, workspaceTasks, spaces),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [taskId]
  );

  const [task, setTask] = useState<TaskDetailData | null>(() => initialSeeded);
  const [isLoading, setIsLoading] = useState<boolean>(() => !initialSeeded);
  const [isHydratingActivity, setIsHydratingActivity] = useState<boolean>(
    () => !taskId || !getClientCache('task:detail:' + taskId)
  );
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Status Dropdown State & Click-Outside Guard
  const [isStatusMenuOpen, setIsStatusMenuOpen] = useState(false);
  const statusDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (statusDropdownRef.current && !statusDropdownRef.current.contains(event.target as Node)) {
        setIsStatusMenuOpen(false);
      }
    }
    if (isStatusMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isStatusMenuOpen]);

  // Guaranteed Canonical & Cross-Department Status Resolver
  const availableStatuses = useMemo(() => {
    return getResolvedWorkflowStatuses(task, spaces);
  }, [task, spaces]);

  const currentStatusObj = useMemo(() => {
    if (!task) return null;
    return (
      availableStatuses.find((s) => s.id === task.statusId) ||
      availableStatuses.find((s) => s.name.toLowerCase() === task.status?.name?.toLowerCase()) ||
      availableStatuses.find((s) => s.category === (task.status as any)?.category) ||
      availableStatuses[0]
    );
  }, [availableStatuses, task]);

  const currentStatusName =
    currentStatusObj?.name ||
    task?.status?.name ||
    resolveCanonicalStatusName(task?.statusId) ||
    'Open';

  const currentStatusColor = getCanonicalStatusColor(
    currentStatusObj || task?.status || task?.statusId
  );

  // Copy key state
  const [hasCopiedKey, setHasCopiedKey] = useState(false);

  // Inline Title Editing
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(() => initialSeeded?.title || '');

  // Inline Description Editing
  const [isEditingDesc, setIsEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState(() => initialSeeded?.description || '');

  // Custom Fields Editing
  const [customFieldsDraft, setCustomFieldsDraft] = useState<Record<string, string>>(() =>
    extractCustomFieldsDraft(initialSeeded)
  );
  const [isSavingCustomFields, setIsSavingCustomFields] = useState(false);

  // Timeline & Milestones State
  const [startDateDraft, setStartDateDraft] = useState(() =>
    initialSeeded?.startDate ? new Date(initialSeeded.startDate).toISOString().slice(0, 10) : ''
  );
  const [dueDateDraft, setDueDateDraft] = useState(() =>
    initialSeeded?.dueDate ? new Date(initialSeeded.dueDate).toISOString().slice(0, 10) : ''
  );
  const [isMilestoneDraft, setIsMilestoneDraft] = useState(() => Boolean(initialSeeded?.isMilestone));
  const [isSavingSchedule, setIsSavingSchedule] = useState(false);

  // Comments state
  const [comments, setComments] = useState<TaskDetailComment[]>(() => initialSeeded?.comments || []);
  const [newComment, setNewComment] = useState('');
  const [isInternalComment, setIsInternalComment] = useState(false);
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);

  // Mention Autocomplete state
  const [mentionableUsers, setMentionableUsers] = useState<
    Array<{ id: string; name: string; username: string; email: string; globalRole: string; isSpaceMember: boolean; departmentBadge?: string }>
  >([]);
  const [showMentionMenu, setShowMentionMenu] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionCursorPos, setMentionCursorPos] = useState(0);
  const commentTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Staged inline comment attachments
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [commentUploadProgress, setCommentUploadProgress] = useState<Record<string, number>>({});
  const [isDraggingOverComment, setIsDraggingOverComment] = useState(false);
  const commentFileInputRef = useRef<HTMLInputElement>(null);

  // Attachments upload state
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [uploadFileProgress, setUploadFileProgress] = useState<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Checklist state
  const [checklist, setChecklist] = useState<TaskChecklistItemData[]>(
    () => initialSeeded?.checklistItems || []
  );
  const [newChecklistTitle, setNewChecklistTitle] = useState('');
  const [isAddingChecklist, setIsAddingChecklist] = useState(false);

  // Lightbox & Dropzone state
  const [lightboxImage, setLightboxImage] = useState<{ url: string; name: string } | null>(null);
  const [isDragOverDropzone, setIsDragOverDropzone] = useState(false);

  // Tab & Handoff Intercept state
  const [activeMainTab, setActiveMainTab] = useState<'comments' | 'history'>('comments');
  const [isHandoffModalOpen, setIsHandoffModalOpen] = useState(false);
  const commentsEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll comments feed to bottom when a new comment is posted or tab switches
  useEffect(() => {
    if (activeMainTab === 'comments' && comments.length > 0) {
      commentsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [comments.length, activeMainTab]);

  const isStaffOrAdmin =
    currentUser.globalRole === 'SUPERADMIN' ||
    hasTicketSpaceClearance(currentUser, task?.spaceId || task?.space?.id, spaces);

  const canDeleteAttachmentItem = (att?: {
    uploadedById?: string;
    uploadedBy?: { id: string };
    uploader?: { id: string };
  }) => {
    if (!task) return false;
    return (
      currentUser.globalRole === 'SUPERADMIN' ||
      att?.uploadedById === currentUser.id ||
      att?.uploadedBy?.id === currentUser.id ||
      att?.uploader?.id === currentUser.id ||
      task.createdById === currentUser.id ||
      isStaffOrAdmin
    );
  };

  const canDeleteCommentItem = (comment?: TaskDetailComment) => {
    if (!task) return false;
    return (
      currentUser.globalRole === 'SUPERADMIN' ||
      comment?.authorId === currentUser.id ||
      comment?.author?.id === currentUser.id ||
      task.createdById === currentUser.id ||
      isStaffOrAdmin
    );
  };

  const loadMentionsWithCache = (id: string, spaceId?: string) => {
    if (!spaceId) return;
    const mentionCacheKey = `users:mentions:${spaceId}`;
    const cachedMentions = getClientCache<any[]>(mentionCacheKey, 300_000);
    if (cachedMentions) {
      setMentionableUsers(cachedMentions);
      return;
    }

    fetch(`/api/users/mentions?taskId=${id}&spaceId=${spaceId}`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data?.users)) {
          setClientCache(mentionCacheKey, data.users, 300_000);
          setMentionableUsers(data.users);
        }
      })
      .catch(() => {});
  };

  // Fetch full guarded task details in background while keeping 0ms pre-hydrated UI interactive
  const loadTaskDetails = async (id: string) => {
    const seeded = resolveAndNormalizeSeededTask(
      id,
      initialTaskRef.current,
      workspaceTasksRef.current,
      spacesRef.current
    );

    if (seeded) {
      setTask(seeded);
      setTitleDraft(seeded.title);
      setDescDraft(seeded.description || '');
      setChecklist(seeded.checklistItems || []);
      setStartDateDraft(seeded.startDate ? new Date(seeded.startDate).toISOString().slice(0, 10) : '');
      setDueDateDraft(seeded.dueDate ? new Date(seeded.dueDate).toISOString().slice(0, 10) : '');
      setIsMilestoneDraft(Boolean(seeded.isMilestone));
      const seededComments = Array.from(
        new Map((seeded.comments || []).map((c) => [c.id, c])).values()
      );
      setComments(seededComments);
      setCustomFieldsDraft(extractCustomFieldsDraft(seeded));
      setIsLoading(false);
      setError(null);
      loadMentionsWithCache(id, seeded.spaceId || seeded.space?.id);
    } else {
      setIsLoading(true);
      setError(null);
    }

    setIsHydratingActivity(!getClientCache('task:detail:' + id));

    try {
      const res = await fetch(`/api/tasks/${id}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to load task details');
      }

      const { task: fetchedTask } = await res.json();
      if (!fetchedTask) return;

      // Store full enriched task in client-cache for 60s so re-opening has comments & history in 0ms
      setClientCache('task:detail:' + id, fetchedTask, 60_000);

      setTask(fetchedTask);
      setTitleDraft((prev) => (isEditingTitle ? prev : fetchedTask.title));
      setDescDraft((prev) => (isEditingDesc ? prev : fetchedTask.description || ''));
      setChecklist(fetchedTask.checklistItems || []);
      setStartDateDraft(
        fetchedTask.startDate ? new Date(fetchedTask.startDate).toISOString().slice(0, 10) : ''
      );
      setDueDateDraft(
        fetchedTask.dueDate ? new Date(fetchedTask.dueDate).toISOString().slice(0, 10) : ''
      );
      setIsMilestoneDraft(Boolean(fetchedTask.isMilestone));

      // Deduplicate comments to prevent React duplicate key collisions
      const rawComments: TaskDetailComment[] = fetchedTask.comments || [];
      const uniqueComments = Array.from(
        new Map(rawComments.map((c) => [c.id, c])).values()
      );
      setComments(uniqueComments);
      setCustomFieldsDraft(extractCustomFieldsDraft(fetchedTask));

      // Fetch mentionable users lazily/cached for 5 minutes without blocking render
      const spaceId = fetchedTask.spaceId || fetchedTask.space?.id;
      loadMentionsWithCache(fetchedTask.id, spaceId);
    } catch (err) {
      if (!seeded) {
        setError(err instanceof Error ? err.message : 'Error loading task');
      }
    } finally {
      setIsLoading(false);
      setIsHydratingActivity(false);
    }
  };

  // Depends ONLY on [taskId, isOpen] so parent/context re-renders never cancel the in-flight request
  useEffect(() => {
    if (isOpen && taskId) {
      void loadTaskDetails(taskId);
      setIsInternalComment(false);
      setIsEditingTitle(false);
      setIsEditingDesc(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, isOpen]);

  // Keep client-side detail cache synchronized with local drawer mutations (comments, checklist, attachments, status)
  useEffect(() => {
    if (!task?.id || isHydratingActivity) return;
    setClientCache(
      'task:detail:' + task.id,
      {
        ...task,
        comments,
        checklistItems: checklist,
      },
      60_000
    );
  }, [task, comments, checklist, isHydratingActivity]);

  // Real-Time Event Sync: Live update task attributes, append comments, or close on delete
  useEffect(() => {
    if (!isOpen || !taskId) return;

    const unsubscribe = subscribeToRealTimeEvents((event: any) => {
      if (!event || !event.type) return;

      if (event.type === 'TASK_UPDATED' && event.task?.id === taskId) {
        setTask((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            ...event.task,
            status: event.task.status || prev.status,
            comments: prev.comments,
            attachments: prev.attachments,
          };
        });
      } else if (event.type === 'COMMENT_CREATED' && event.taskId === taskId) {
        // RBAC defense-in-depth: Never append internal notes if viewer lacks space staff clearance
        if (event.isInternal && !hasTicketSpaceClearance(currentUser, task?.spaceId || task?.space?.id, spaces)) {
          return;
        }
        if (event.comment) {
          setComments((prev) => {
            if (prev.some((c) => c.id === event.comment.id)) return prev;
            return [...prev, event.comment];
          });
        }
      } else if (event.type === 'TASK_DELETED' && event.taskId === taskId) {
        onClose();
      }
    });

    return () => {
      unsubscribe();
    };
  }, [isOpen, taskId, subscribeToRealTimeEvents, currentUser.globalRole, onClose]);

  const canModify = Boolean(
    task && canModifyTicket(currentUser, task, spaces)
  );

  // Delete Task Handler
  const handleDeleteTask = async () => {
    if (!task) return;
    if (!canModify) {
      toast.error(
        'Permission Denied: Only department staff or Superadmins can modify this ticket.',
        'Clearance Denied'
      );
      return;
    }
    if (!confirm(`Are you sure you want to permanently delete ticket ${task.taskKey}?`)) {
      return;
    }

    try {
      setIsDeleting(true);
      const res = await fetch(`/api/tasks/${task.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete task');
      }
      optimisticRemoveTask(task.id);
      triggerTaskRefresh({ silent: true, forceFresh: true });
      refreshSpaces();
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Error deleting task');
    } finally {
      setIsDeleting(false);
    }
  };

  if (!isOpen || !taskId) return null;

  // 1-Click Copy Ticket Key
  const handleCopyKey = () => {
    if (!task) return;
    navigator.clipboard.writeText(task.taskKey);
    setHasCopiedKey(true);
    setTimeout(() => setHasCopiedKey(false), 2000);
  };

  // Inline Title Save
  const handleSaveTitle = async () => {
    if (!task || !titleDraft.trim() || titleDraft.trim() === task.title) {
      setIsEditingTitle(false);
      return;
    }

    if (!canModify) {
      toast.error(
        'Permission Denied: Only department staff or Superadmins can modify this ticket.',
        'Clearance Denied'
      );
      setIsEditingTitle(false);
      return;
    }

    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: titleDraft.trim() }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update title');
      }
      const { task: updated } = await res.json();
      setTask((prev) => (prev ? { ...prev, title: updated.title } : null));
      onTaskUpdated?.(updated);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Error updating title');
    } finally {
      setIsEditingTitle(false);
    }
  };

  // Inline Description Save
  const handleSaveDesc = async () => {
    if (!task) {
      setIsEditingDesc(false);
      return;
    }

    if (!canModify) {
      toast.error(
        'Permission Denied: Only department staff or Superadmins can modify this ticket.',
        'Clearance Denied'
      );
      setIsEditingDesc(false);
      return;
    }

    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: descDraft.trim() || null }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update description');
      }
      const { task: updated } = await res.json();
      setTask((prev) => (prev ? { ...prev, description: updated.description } : null));
      onTaskUpdated?.(updated);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Error updating description');
    } finally {
      setIsEditingDesc(false);
    }
  };

  // Status Change (0ms Optimistic UI & In-Place Background Sync)
  const handleChangeStatus = async (newStatusId: string) => {
    if (!task || task.statusId === newStatusId) return;

    if (!canModify) {
      toast.error(
        'Permission Denied: Only department staff, assignees, or creators can modify this ticket.',
        'Clearance Denied'
      );
      return;
    }

    setIsStatusMenuOpen(false);

    // Resolve target status accurately from availableStatuses (guaranteed to have all 5 canonical states)
    const targetStatus =
      availableStatuses.find((s) => s.id === newStatusId) ||
      CANONICAL_STATUSES.find((s) => s.id === newStatusId);

    const resolvedStatusObj = targetStatus || {
      id: newStatusId,
      name: resolveCanonicalStatusName(newStatusId),
      color: '#3B82F6',
      order: 0,
      isCompleted: false,
      isClosed: false,
      category: 'OPEN',
    };

    const previousTaskSnapshot = { ...task };
    const isClosing = Boolean(resolvedStatusObj.isCompleted || resolvedStatusObj.isClosed);

    // 1. Immediately update drawer's local state on next animation frame / 0ms (never blank)
    setTask((prev) =>
      prev
        ? {
            ...prev,
            statusId: resolvedStatusObj.id,
            status: {
              ...prev.status,
              ...resolvedStatusObj,
              id: resolvedStatusObj.id,
              name: resolvedStatusObj.name,
              color: resolvedStatusObj.color,
            },
            completedAt: isClosing ? (prev.completedAt || new Date().toISOString()) : null,
          }
        : null
    );

    // 2. Dispatch unified optimistic status handler (updates background views & in-place client cache instantly)
    try {
      const res = await updateTaskStatusOptimistic(task.id, resolvedStatusObj.id, resolvedStatusObj);
      if (res?.success && res.task) {
        setTask((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            ...res.task,
            status: res.task.status || resolvedStatusObj,
          };
        });
        onTaskUpdated?.(res.task);
      } else if (!res?.success) {
        // Roll back drawer local state
        setTask(previousTaskSnapshot);
      }
    } catch (err: any) {
      console.error('Drawer status update error:', err);
      setTask(previousTaskSnapshot);
      toast.error(err.message || 'Failed to update status', 'Update Failed');
    }
  };

  // Queue List Change
  const handleChangeList = async (newListId: string) => {
    if (!task || task.listId === newListId) return;

    if (!canModify) {
      toast.error(
        'Permission Denied: Only department staff or Superadmins can modify this ticket.',
        'Clearance Denied'
      );
      return;
    }

    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listId: newListId }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const errMsg = data.error || (res.status === 403 ? 'Permission Denied: Only department staff or Superadmins can modify this ticket.' : 'Failed to update queue list');
        toast.error(errMsg, res.status === 403 ? 'Clearance Denied' : 'Update Failed');
        return;
      }
      const { task: updated } = await res.json();
      setTask((prev) => (prev ? { ...prev, list: updated.list, listId: newListId, space: updated.space || prev.space } : null));
      onTaskUpdated?.(updated);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Failed to update queue list');
    }
  };

  // Priority Change
  const handleChangePriority = async (newPriority: string) => {
    if (!task || task.priority === newPriority) return;

    if (!canModify) {
      toast.error(
        'Permission Denied: Only department staff or Superadmins can modify this ticket.',
        'Clearance Denied'
      );
      return;
    }

    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priority: newPriority }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const errMsg = data.error || (res.status === 403 ? 'Permission Denied: Only department staff or Superadmins can modify this ticket.' : 'Failed to update priority');
        toast.error(errMsg, res.status === 403 ? 'Clearance Denied' : 'Update Failed');
        return;
      }
      const { task: updated } = await res.json();
      setTask((prev) => (prev ? { ...prev, priority: updated.priority } : null));
      onTaskUpdated?.(updated);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Failed to update priority');
    }
  };

  // Assign to Me
  const handleAssignToMe = async () => {
    if (!task) return;

    if (!canModify) {
      toast.error(
        'Permission Denied: Only department staff or Superadmins can modify this ticket.',
        'Clearance Denied'
      );
      return;
    }

    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assigneeId: currentUser.id }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const errMsg = data.error || (res.status === 403 ? 'Permission Denied: Only department staff or Superadmins can modify this ticket.' : 'Failed to assign task');
        toast.error(errMsg, res.status === 403 ? 'Clearance Denied' : 'Update Failed');
        return;
      }
      const { task: updated } = await res.json();
      setTask((prev) => (prev ? { ...prev, assignee: updated.assignee, assigneeId: currentUser.id } : null));
      onTaskUpdated?.(updated);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Failed to assign task');
    }
  };

  // Save Custom Fields
  const handleSaveCustomFields = async () => {
    if (!task) return;

    if (!canModify) {
      toast.error(
        'Permission Denied: Only department staff or Superadmins can modify this ticket.',
        'Clearance Denied'
      );
      return;
    }

    setIsSavingCustomFields(true);

    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customFields: customFieldsDraft }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const errMsg = data.error || (res.status === 403 ? 'Permission Denied: Only department staff or Superadmins can modify this ticket.' : 'Failed to update custom fields');
        toast.error(errMsg, res.status === 403 ? 'Clearance Denied' : 'Update Failed');
        return;
      }
      const { task: updated } = await res.json();
      setTask((prev) =>
        prev
          ? {
              ...prev,
              customFields: updated.customFields,
              customFieldValues: updated.customFieldValues,
            }
          : null
      );
      toast.success('Custom fields saved successfully.');
      onTaskUpdated?.(updated);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Failed to update custom fields');
    } finally {
      setIsSavingCustomFields(false);
    }
  };

  // Save Timeline & Milestone Schedule
  const handleSaveSchedule = async () => {
    if (!task) return;

    if (!canModify) {
      toast.error(
        'Permission Denied: Only department staff or Superadmins can modify ticket schedule.',
        'Clearance Denied'
      );
      return;
    }

    setIsSavingSchedule(true);
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDate: startDateDraft || null,
          dueDate: dueDateDraft || null,
          isMilestone: isMilestoneDraft,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || data.error || 'Failed to update schedule');
      }

      const { task: updated } = await res.json();
      setTask((prev) => (prev ? { ...prev, ...updated } : null));
      toast.success('Schedule saved.');
      onTaskUpdated?.(updated);
    } catch (err: any) {
      toast.error(err.message || 'Failed to update schedule');
    } finally {
      setIsSavingSchedule(false);
    }
  };

  const collabInfo = useMemo(() => (task ? computeTaskCollaboration(task as any) : null), [task]);

  // Mention options filtered by query with ticket-scoped RBAC and department badges
  const mentionOptions = useMemo(() => {
    const list: Array<{ type: 'everyone' | 'user'; id: string; label: string; subtitle?: string; user?: any }> = [];

    const query = mentionQuery.toLowerCase();
    if (!query || 'everyone'.startsWith(query) || 'all'.startsWith(query)) {
      // Dynamic @everyone subtitle reflecting ticket scope
      const currentDept = task?.space?.name || 'department';
      const originDept =
        collabInfo?.originSpace?.name && collabInfo.originSpace.name !== currentDept
          ? collabInfo.originSpace.name
          : null;
      const everyoneSubtitle = originDept
        ? `Notify all ${originDept} & ${currentDept} staff on this ticket`
        : `Notify all ${currentDept} staff on this ticket`;

      list.push({
        type: 'everyone',
        id: 'everyone',
        label: '@everyone',
        subtitle: everyoneSubtitle,
      });
    }

    mentionableUsers
      .filter((u) => {
        if (!query) return true;
        return (
          u.username.toLowerCase().includes(query) ||
          u.name.toLowerCase().includes(query) ||
          (u.departmentBadge && u.departmentBadge.toLowerCase().includes(query))
        );
      })
      .slice(0, 8)
      .forEach((u) => {
        list.push({
          type: 'user',
          id: u.id,
          label: `@${u.username}`,
          subtitle: u.departmentBadge || `${u.name} (${u.globalRole})`,
          user: u,
        });
      });

    return list;
  }, [mentionQuery, mentionableUsers, task?.space?.name, collabInfo]);

  // Insert selected mention into textarea
  const insertMention = (opt: { type: 'everyone' | 'user'; label: string }) => {
    const textarea = commentTextareaRef.current;
    const cursorPos = textarea ? textarea.selectionStart : mentionCursorPos;
    const textBefore = newComment.slice(0, cursorPos);
    const textAfter = newComment.slice(cursorPos);

    const replacedBefore = textBefore.replace(/(?:^|\s)@([a-zA-Z0-9_.-]*)$/, (match) => {
      const leadingSpace = match.startsWith(' ') ? ' ' : '';
      return `${leadingSpace}${opt.label} `;
    });

    const updated = replacedBefore + textAfter;
    setNewComment(updated);
    setShowMentionMenu(false);

    setTimeout(() => {
      if (textarea) {
        textarea.focus();
        const nextPos = replacedBefore.length;
        textarea.setSelectionRange(nextPos, nextPos);
      }
    }, 0);
  };

  const handleCommentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setNewComment(val);

    const cursorPos = e.target.selectionStart;
    const textBeforeCursor = val.slice(0, cursorPos);
    const match = textBeforeCursor.match(/(?:^|\s)@([a-zA-Z0-9_.-]*)$/);

    if (match) {
      setShowMentionMenu(true);
      setMentionQuery(match[1].toLowerCase());
      setMentionIndex(0);
      setMentionCursorPos(cursorPos);
    } else {
      setShowMentionMenu(false);
    }
  };

  const handleCommentKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showMentionMenu && mentionOptions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex((prev) => (prev + 1) % mentionOptions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex((prev) => (prev - 1 + mentionOptions.length) % mentionOptions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          insertMention(mentionOptions[mentionIndex] || mentionOptions[0]);
          return;
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowMentionMenu(false);
        return;
      }
    }

    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      handlePostComment();
    }
  };

  // Handle file selection from comment paperclip button
  const handleCommentFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selected = Array.from(e.target.files);
      const valid = selected.filter((file) => {
        if (file.size > 100 * 1024 * 1024) {
          toast.error(`File "${file.name}" exceeds the 100MB limit (${(file.size / (1024 * 1024)).toFixed(1)}MB).`);
          return false;
        }
        return true;
      });
      setStagedFiles((prev) => [...prev, ...valid]);
    }
    e.target.value = '';
  };

  // Post Comment / Internal Note
  const handlePostComment = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!task || (!newComment.trim() && stagedFiles.length === 0) || isSubmittingComment) return;

    setIsSubmittingComment(true);
    setCommentError(null);

    try {
      let stagedAttachments: any[] = [];
      if (stagedFiles.length > 0) {
        stagedAttachments = await Promise.all(
          stagedFiles.map((file, idx) => {
            const key = `${file.name}-${idx}`;
            return uploadFileWithProgress(file, {
              onProgress: (pct) => {
                setCommentUploadProgress((prev) => ({ ...prev, [key]: pct }));
              },
            });
          })
        );
      }

      const res = await fetch(`/api/tasks/${task.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: newComment.trim(),
          isInternal: isStaffOrAdmin ? isInternalComment : false,
          ...(stagedAttachments.length > 0 ? { stagedAttachments } : {}),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to post comment');
      }

      const data = await res.json();
      const { comment, createdAttachments } = data;

      if (comment) {
        setComments((prev) => {
          if (prev.some((c) => c.id === comment.id)) return prev;
          return [...prev, comment];
        });
      }

      if (Array.isArray(createdAttachments) && createdAttachments.length > 0) {
        setTask((prev) => {
          if (!prev) return null;
          const currentAttachments = prev.attachments || [];
          const newAtts = createdAttachments.filter(
            (ca: any) => !currentAttachments.some((ea) => ea.id === ca.id)
          );
          return {
            ...prev,
            attachments: [...newAtts, ...currentAttachments],
          };
        });
      }

      setNewComment('');
      setStagedFiles([]);
      setCommentUploadProgress({});
      onTaskUpdated?.(task);
    } catch (err) {
      setCommentError(err instanceof Error ? err.message : 'Error posting comment');
    } finally {
      setIsSubmittingComment(false);
    }
  };

  // Upload Attachment via direct dropzone (Up to 100MB, Vercel-safe 2MB Chunked Resumable)
  const handleUploadFile = async (file: File) => {
    if (!task) return;
    if (file.size > 100 * 1024 * 1024) {
      toast.error(`File "${file.name}" exceeds the 100MB limit (${(file.size / (1024 * 1024)).toFixed(1)}MB).`);
      return;
    }
    setIsUploadingFile(true);
    setUploadFileProgress(5);

    try {
      const stagedAttachment = await uploadFileWithProgress(file, {
        onProgress: (pct) => setUploadFileProgress(pct),
      });

      const res = await fetch(`/api/tasks/${task.id}/attachments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stagedAttachments: [stagedAttachment],
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to upload attachment');
      }

      const data = await res.json();
      const { attachment, comment } = data;

      if (attachment) {
        setTask((prev) => {
          if (!prev) return null;
          const currentAttachments = prev.attachments || [];
          if (currentAttachments.some((a) => a.id === attachment.id)) return prev;
          return {
            ...prev,
            attachments: [attachment, ...currentAttachments],
          };
        });
        toast.success(attachment.fileName || attachment.filename || 'Attachment uploaded');
      }

      if (comment) {
        setComments((prev) => {
          if (prev.some((c) => c.id === comment.id)) return prev;
          return [...prev, comment];
        });
      }

      onTaskUpdated?.(task);
    } catch (err: any) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setIsUploadingFile(false);
      setUploadFileProgress(0);
    }
  };

  // Synchronized Two-Way Attachment Deletion
  const handleDeleteAttachment = async (attachmentId: string) => {
    if (!task) return;
    if (!confirm('Are you sure you want to remove this attachment?')) return;

    // Identify target attachment attributes for cross-feed matching
    const targetAtt = task.attachments?.find((a) => a.id === attachmentId);
    let targetUrl = targetAtt?.fileUrl || targetAtt?.filepath;
    let targetName = targetAtt?.fileName || targetAtt?.filename;

    if (!targetUrl || !targetName) {
      for (const c of comments) {
        let atts = c.attachments || [];
        if (atts.length === 0 && c.attachmentsJson) {
          try {
            atts = JSON.parse(c.attachmentsJson);
          } catch {}
        }
        const match = atts.find((a: any) => a.id === attachmentId);
        if (match) {
          if (!targetUrl) targetUrl = match.fileUrl || match.filepath;
          if (!targetName) targetName = match.fileName || match.filename;
          break;
        }
      }
    }

    // 1. Optimistically remove from task attachments (left pane)
    setTask((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        attachments: (prev.attachments || []).filter((a) => {
          const isMatch =
            a.id === attachmentId ||
            (Boolean(targetUrl) && (a.fileUrl === targetUrl || a.filepath === targetUrl)) ||
            (Boolean(targetName) && (a.fileName === targetName || a.filename === targetName) && !a.id);
          return !isMatch;
        }),
      };
    });

    // 2. Optimistically synchronize with comments state (right pane)
    setComments((prevComments) => {
      const nextComments: TaskDetailComment[] = [];
      for (const c of prevComments) {
        let atts = c.attachments || [];
        if (atts.length === 0 && c.attachmentsJson) {
          try {
            atts = JSON.parse(c.attachmentsJson);
          } catch {}
        }
        const filteredAtts = atts.filter((a: any) => {
          const isMatch =
            (Boolean(a.id) && a.id === attachmentId) ||
            (Boolean(targetUrl) && (a.fileUrl === targetUrl || a.filepath === targetUrl)) ||
            (Boolean(targetName) && (a.fileName === targetName || a.filename === targetName) && !a.id);
          return !isMatch;
        });

        if (filteredAtts.length !== atts.length) {
          const trimmed = c.content.trim();
          const isFileOnly =
            trimmed.startsWith('Attached ') ||
            trimmed.startsWith('Uploaded attachment:') ||
            trimmed === '' ||
            trimmed === `Attached 1 file: ${targetName}` ||
            trimmed === `Uploaded attachment: ${targetName}`;

          // If file-only comment and 0 remaining attachments, auto-remove shell comment
          if (filteredAtts.length === 0 && isFileOnly) {
            continue;
          }

          nextComments.push({
            ...c,
            attachments: filteredAtts,
            attachmentsJson: filteredAtts.length > 0 ? JSON.stringify(filteredAtts) : null,
          });
        } else {
          nextComments.push(c);
        }
      }
      return nextComments;
    });

    try {
      const res = await fetch(`/api/tasks/${task.id}/attachments/${attachmentId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete attachment');
      }

      const data = await res.json();
      if (Array.isArray(data.deletedCommentIds) && data.deletedCommentIds.length > 0) {
        setComments((prev) => prev.filter((c) => !data.deletedCommentIds.includes(c.id)));
      }

      toast.success('Attachment deleted');
      onTaskUpdated?.(task);
    } catch (err: any) {
      alert(err instanceof Error ? err.message : 'Failed to delete attachment');
      loadTaskDetails(task.id);
    }
  };

  // Delete entire comment and its linked attachments
  const handleDeleteComment = async (commentId: string) => {
    if (!task) return;
    if (!confirm('Are you sure you want to delete this comment and its attachments?')) return;

    // Identify attachments linked to this comment for optimistic removal from left pane
    const targetComment = comments.find((c) => c.id === commentId);
    let attsToRemove: string[] = [];
    if (targetComment) {
      let atts = targetComment.attachments || [];
      if (atts.length === 0 && targetComment.attachmentsJson) {
        try {
          atts = JSON.parse(targetComment.attachmentsJson);
        } catch {}
      }
      attsToRemove = atts.map((a: any) => a.id).filter(Boolean);
      const attUrls = atts.map((a: any) => a.fileUrl || a.filepath).filter(Boolean);
      if (task.attachments) {
        for (const a of task.attachments) {
          const url = a.fileUrl || a.filepath;
          if (url && attUrls.includes(url) && !attsToRemove.includes(a.id)) {
            attsToRemove.push(a.id);
          }
        }
      }
    }

    // 1. Optimistic removal of comment from feed
    setComments((prev) => prev.filter((c) => c.id !== commentId));

    // 2. Optimistic removal of linked files from left pane
    if (attsToRemove.length > 0) {
      setTask((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          attachments: (prev.attachments || []).filter((a) => !attsToRemove.includes(a.id)),
        };
      });
    }

    try {
      const res = await fetch(`/api/tasks/${task.id}/comments/${commentId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete comment');
      }

      const data = await res.json();
      if (Array.isArray(data.deletedAttachmentIds) && data.deletedAttachmentIds.length > 0) {
        setTask((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            attachments: (prev.attachments || []).filter(
              (a) => !data.deletedAttachmentIds.includes(a.id)
            ),
          };
        });
      }

      toast.success('Comment deleted');
      onTaskUpdated?.(task);
    } catch (err: any) {
      alert(err instanceof Error ? err.message : 'Failed to delete comment');
      loadTaskDetails(task.id);
    }
  };

  // Delete attachment directly from inside a comment card
  const handleDeleteCommentAttachment = async (commentId: string, att: any) => {
    if (!task) return;
    const attId =
      att.id ||
      task.attachments?.find(
        (a) =>
          (a.fileUrl && (a.fileUrl === att.fileUrl || a.fileUrl === att.filepath)) ||
          (a.fileName && (a.fileName === att.fileName || a.fileName === att.filename))
      )?.id;

    if (attId) {
      await handleDeleteAttachment(attId);
    } else {
      alert('Attachment reference could not be found.');
    }
  };

  // Checklist Actions
  const handleToggleChecklist = async (item: TaskChecklistItemData) => {
    if (!task) return;
    const newCompleted = !item.isCompleted;

    // Instant optimistic update
    setChecklist((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, isCompleted: newCompleted } : i))
    );

    try {
      const res = await fetch(`/api/tasks/${task.id}/checklist/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isCompleted: newCompleted }),
      });
      if (!res.ok) {
        throw new Error('Failed to update subtask');
      }
      const { item: updated } = await res.json();
      setChecklist((prev) =>
        prev.map((i) => (i.id === item.id ? updated : i))
      );
      onTaskUpdated?.(task);
    } catch (err) {
      // Revert optimistic update
      setChecklist((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, isCompleted: item.isCompleted } : i))
      );
    }
  };

  const handleAddChecklist = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanTitle = newChecklistTitle.trim();
    if (!cleanTitle || !task || isAddingChecklist) return;

    setIsAddingChecklist(true);
    setNewChecklistTitle('');

    try {
      const res = await fetch(`/api/tasks/${task.id}/checklist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: cleanTitle }),
      });
      if (!res.ok) {
        throw new Error('Failed to add checklist item');
      }
      const { item } = await res.json();
      setChecklist((prev) => [...prev, item]);
      onTaskUpdated?.(task);
    } catch (err: any) {
      alert(err?.message || 'Failed to add checklist item');
    } finally {
      setIsAddingChecklist(false);
    }
  };

  const handleDeleteChecklist = async (itemId: string) => {
    if (!task) return;
    const previousList = checklist;
    setChecklist((prev) => prev.filter((i) => i.id !== itemId));

    try {
      const res = await fetch(`/api/tasks/${task.id}/checklist/${itemId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        throw new Error('Failed to delete checklist item');
      }
      onTaskUpdated?.(task);
    } catch (err) {
      setChecklist(previousList);
    }
  };

  // Lightbox keyboard escape listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && lightboxImage) {
        setLightboxImage(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lightboxImage]);

  // Global clipboard screenshot paste listener inside drawer
  useEffect(() => {
    if (!isOpen || !task?.id) return;

    const handleWindowPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';
      if (isInput) return;

      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            const namedFile = new File([file], `screenshot-${Date.now()}.png`, { type: file.type });
            handleUploadFile(namedFile);
            return;
          }
        }
      }
    };

    window.addEventListener('paste', handleWindowPaste);
    return () => window.removeEventListener('paste', handleWindowPaste);
  }, [isOpen, task?.id]);

  // Clipboard Paste support on comment composer: Stages images/files
  const handleCommentPaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const newFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          const name = file.name.startsWith('image')
            ? `screenshot_${Date.now()}.png`
            : file.name;
          const namedFile = new File([file], name, { type: file.type });
          newFiles.push(namedFile);
        }
      }
    }
    if (newFiles.length > 0) {
      setStagedFiles((prev) => [...prev, ...newFiles]);
    }
  };

  const spaceKey = task?.space?.key.toUpperCase() || '';
  const currentPriority = PRIORITIES.find((p) => p.value === task?.priority) || PRIORITIES[1];

  const slaEval = useMemo(() => {
    if (!task) return null;
    return evaluateTaskSla(
      task.createdAt,
      task.priority,
      Boolean(task.status?.isCompleted || task.status?.isClosed),
      (task.space as any)?.slaPolicy
    );
  }, [task]);

  const contributorsList = useMemo(() => {
    if (!task) return [];
    const contributorMap = new Map<
      string,
      {
        id: string;
        name: string;
        username: string;
        email?: string;
        homeDepartment?: string;
        globalRole?: string;
        tag?: string;
      }
    >();

    if (task.createdBy) {
      contributorMap.set(task.createdBy.id, {
        id: task.createdBy.id,
        name: task.createdBy.name,
        username: task.createdBy.username,
        email: task.createdBy.email,
        homeDepartment:
          task.createdBy.homeDepartment ||
          task.createdBy.spaceMemberships?.[0]?.space?.name ||
          (task.createdBy.globalRole === 'EMPLOYEE' ? 'Employee' : 'General'),
        globalRole: task.createdBy.globalRole,
        tag: 'Creator',
      });
    }

    if (task.assignee) {
      contributorMap.set(task.assignee.id, {
        id: task.assignee.id,
        name: task.assignee.name,
        username: task.assignee.username,
        email: task.assignee.email,
        homeDepartment:
          task.assignee.spaceMemberships?.[0]?.space?.name ||
          task.space?.name ||
          'Staff',
        globalRole: task.assignee.globalRole,
        tag: 'Assignee',
      });
    }

    if (Array.isArray(task.contributors)) {
      for (const c of task.contributors) {
        if (!contributorMap.has(c.id)) {
          contributorMap.set(c.id, {
            id: c.id,
            name: c.name,
            username: c.username,
            email: c.email,
            homeDepartment:
              c.homeDepartment ||
              c.spaceMemberships?.[0]?.space?.name ||
              'Staff',
            globalRole: c.globalRole,
            tag: 'Contributor',
          });
        }
      }
    }

    if (Array.isArray(task.history)) {
      for (const h of task.history) {
        if (h.actor && !contributorMap.has(h.actor.id)) {
          contributorMap.set(h.actor.id, {
            id: h.actor.id,
            name: h.actor.name,
            username: h.actor.username,
            email: h.actor.email,
            homeDepartment:
              h.actor.homeDepartment ||
              h.actor.spaceMemberships?.[0]?.space?.name ||
              'Staff',
            globalRole: h.actor.globalRole,
            tag: 'Hand-off Lead',
          });
        }
      }
    }

    if (Array.isArray(task.comments)) {
      for (const cm of task.comments) {
        if (cm.author && !contributorMap.has(cm.author.id)) {
          contributorMap.set(cm.author.id, {
            id: cm.author.id,
            name: cm.author.name,
            username: cm.author.username,
            email: cm.author.email,
            homeDepartment:
              cm.author.spaceMemberships?.[0]?.space?.name ||
              'Staff',
            globalRole: cm.author.globalRole,
            tag: 'Commenter',
          });
        }
      }
    }

    return Array.from(contributorMap.values());
  }, [task]);

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/60 backdrop-blur-sm flex justify-end animate-in fade-in duration-200">
      {/* Drawer Canvas */}
      <div className="w-full max-w-5xl lg:max-w-6xl xl:max-w-7xl h-full bg-[#F0F4FA] dark:bg-[#12151E] border-l border-[#C8D5E6] dark:border-white/10 shadow-2xl shadow-blue-950/10 flex flex-col text-[#0F172A] dark:text-zinc-100 animate-in slide-in-from-right duration-250">
        {/* Top Control Bar */}
        <div className="flex-shrink-0 px-4 sm:px-6 py-2.5 border-b border-[#C8D5E6] dark:border-white/10 bg-[#EAF0F8] dark:bg-zinc-900/80 flex items-center justify-between gap-3 shrink-0">
          {/* Left Cluster */}
          <div className="flex items-center gap-2.5 min-w-0 flex-1 overflow-hidden">
            {/* Ticket Key Badge (PUR-102) */}
            {task && (
              <div className="px-2.5 py-1 rounded-md text-[#1E3A8A] bg-[#DFECFA] border border-[#B9D3F3] hover:border-[#ADC8EC] dark:text-blue-300 dark:bg-blue-500/10 dark:border-blue-500/30 text-xs font-mono font-bold flex items-center gap-1.5 flex-shrink-0 transition-colors">
                <span>{task.taskKey}</span>
                <button
                  type="button"
                  onClick={handleCopyKey}
                  title="Copy ticket key"
                  className="text-[#1D4ED8] hover:text-[#1E3A8A] dark:text-blue-300/70 dark:hover:text-blue-200 transition-colors p-0.5 rounded cursor-pointer"
                >
                  {hasCopiedKey ? (
                    <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            )}

            {/* Subtle Vertical Divider */}
            <div className="h-3.5 w-px bg-[#C8D5E6] dark:bg-zinc-800 flex-shrink-0" />

            {/* Unified Department & Queue Breadcrumb (No Redundant Repetition) */}
            {task && (() => {
              const isTransferred = Boolean(
                collabInfo?.originSpace?.id &&
                collabInfo.originSpace.id !== task.space.id
              );
              const originSpaceName = collabInfo?.originSpace?.name;
              const currentSpaceName = task.space.name;
              const currentQueueName = task.list.name;

              if (isTransferred && originSpaceName) {
                return (
                  <div className="flex items-center gap-1.5 text-xs min-w-0 truncate">
                    {/* Origin Dept Pill */}
                    <span
                      title={`Originated in ${originSpaceName}`}
                      className="px-2 py-0.5 rounded bg-[#CEDCEC] border border-[#B0C4DE] text-[#1E40AF] dark:bg-indigo-950/50 dark:border-indigo-800/50 dark:text-indigo-300 font-medium flex items-center gap-1 flex-shrink-0"
                    >
                      <GitBranch className="w-3 h-3 text-[#1E40AF] dark:text-indigo-400" />
                      <span>{originSpaceName}</span>
                    </span>
                    <ArrowRight className="w-3 h-3 text-slate-400 dark:text-zinc-500 flex-shrink-0" />
                    {/* Active Dept & Queue */}
                    <span className="text-slate-600 dark:text-zinc-400 font-medium truncate">{currentSpaceName}</span>
                    <span className="text-slate-400 dark:text-zinc-600">/</span>
                    <span className="text-slate-900 dark:text-white font-semibold truncate">{currentQueueName}</span>
                  </div>
                );
              }

              return (
                <div className="flex items-center gap-1.5 text-xs min-w-0 truncate">
                  <span className="text-slate-600 dark:text-zinc-400 font-medium truncate">{currentSpaceName}</span>
                  <span className="text-slate-400 dark:text-zinc-600">/</span>
                  <span className="text-slate-900 dark:text-white font-semibold truncate">{currentQueueName}</span>
                </div>
              );
            })()}

            {/* SLA Status Pill */}
            {slaEval && (
              <div
                className={cn(
                  'px-2.5 py-0.5 text-xs font-medium rounded-lg flex items-center gap-1.5 shrink-0 border ml-1',
                  slaEval.isBreached
                    ? 'bg-rose-950/60 text-rose-300 border-rose-800/60'
                    : slaEval.isWatch
                    ? 'bg-amber-950/60 text-amber-300 border-amber-800/60'
                    : 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60'
                )}
                title={`Elapsed: ${Math.floor(slaEval.elapsedHours)}h / Target: ${slaEval.thresholdHours}h`}
              >
                {slaEval.isBreached ? (
                  <>
                    <AlertTriangle className="w-3 h-3 text-rose-400" />
                    <span>SLA Breached</span>
                  </>
                ) : (
                  <>
                    <Clock className="w-3 h-3 text-emerald-400" />
                    <span>SLA: {Math.max(0, Math.ceil(slaEval.thresholdHours - slaEval.elapsedHours))}h left</span>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Right Action Cluster */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Primary Workflow Action */}
            {canModify && (
              <button
                type="button"
                onClick={() => setIsHandoffModalOpen(true)}
                className="px-3 py-1.5 rounded-lg bg-emerald-950/50 hover:bg-emerald-900/60 text-emerald-300 border border-emerald-700/60 text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm whitespace-nowrap cursor-pointer"
                title="Transfer or resolve this ticket"
              >
                <ArrowLeftRight className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                <span>Transfer / Resolve</span>
              </button>
            )}

            {/* Divider */}
            <div className="h-4 w-px bg-zinc-800 mx-0.5" />

            {/* Framed Delete Button */}
            {isStaffOrAdmin && (
              <button
                type="button"
                onClick={handleDeleteTask}
                disabled={isDeleting}
                title="Delete Ticket"
                className="w-7 h-7 rounded-lg bg-zinc-900/80 hover:bg-rose-950/50 border border-zinc-800 hover:border-rose-800/60 text-zinc-400 hover:text-rose-400 flex items-center justify-center transition-colors cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}

            {/* Framed Close Drawer Button */}
            <button
              type="button"
              onClick={onClose}
              title="Close (Esc)"
              className="w-7 h-7 rounded-lg bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-zinc-400 hover:text-zinc-100 flex items-center justify-center transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content Body: Dual Pane Layout */}
        {isLoading && !task ? (
          <div className="flex-1 flex items-center justify-center text-xs text-zinc-500 gap-2">
            <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
            <span>Loading ticket details...</span>
          </div>
        ) : error && !task ? (
          <div className="flex-1 p-8 text-center space-y-3">
            <AlertCircle className="w-8 h-8 text-red-400 mx-auto" />
            <h3 className="text-sm font-semibold text-zinc-200">Failed to load ticket</h3>
            <p className="text-xs text-zinc-500">{error || 'Task not found'}</p>
          </div>
        ) : !task ? null : (
          <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
            {/* ================================================================= */}
            {/* LEFT MAIN PANE: Ticket Details, Workflow Controls, Checklists, Attachments */}
            {/* ================================================================= */}
            <div className="flex-1 min-w-0 max-w-full h-full overflow-y-auto overflow-x-hidden p-5 sm:p-6 space-y-4">
              {/* 1. Ticket Title and Compact Requester Metadata Strip */}
              <div className="space-y-1 min-w-0 max-w-full">
                {/* Editable Title */}
                {isEditingTitle ? (
                  <div className="flex items-center gap-2 min-w-0 max-w-full">
                    <input
                      type="text"
                      value={titleDraft}
                      onChange={(e) => setTitleDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveTitle();
                        if (e.key === 'Escape') setIsEditingTitle(false);
                      }}
                      autoFocus
                      className="flex-1 min-w-0 max-w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-lg font-bold text-zinc-100 focus:outline-none focus:border-blue-500 break-words [overflow-wrap:anywhere]"
                    />
                    <button
                      type="button"
                      onClick={handleSaveTitle}
                      className="p-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg cursor-pointer shrink-0"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsEditingTitle(false)}
                      className="p-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded-lg cursor-pointer shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div
                    onClick={() => {
                      if (canModify) setIsEditingTitle(true);
                    }}
                    className={cn(
                      'group flex items-start justify-between gap-3 min-w-0 max-w-full',
                      canModify ? 'cursor-pointer' : ''
                    )}
                  >
                    <h1 className="text-xl font-bold text-slate-900 dark:text-white leading-snug group-hover:text-blue-600 dark:group-hover:text-blue-300 transition-colors break-words [overflow-wrap:anywhere] min-w-0 max-w-full">
                      {task.title}
                    </h1>
                    {canModify && (
                      <Edit2 className="w-3.5 h-3.5 text-slate-400 dark:text-zinc-500 opacity-0 group-hover:opacity-100 transition-opacity mt-1.5 shrink-0" />
                    )}
                  </div>
                )}

                {/* Single-Line Submission Metadata Strip */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-slate-500 dark:text-zinc-400 mt-1 pb-3 border-b border-slate-200 dark:border-zinc-800/80">
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-500 dark:text-zinc-500">Requested by</span>
                    <span className="w-4 h-4 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300 text-[10px] font-bold flex items-center justify-center shrink-0">
                      {task.createdBy?.name ? task.createdBy.name[0].toUpperCase() : 'U'}
                    </span>
                    <span className="font-medium text-slate-900 dark:text-white">
                      {task.createdBy?.name || task.createdBy?.username || 'Unknown'}
                    </span>
                    <span className="text-slate-500 dark:text-zinc-500">({task.createdBy?.email || 'no-email'})</span>
                    <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800/50">
                      {collabInfo?.originSpace?.name ||
                        task.createdBy?.homeDepartment ||
                        task.createdBy?.spaceMemberships?.[0]?.space?.name ||
                        (task.createdBy?.globalRole === 'EMPLOYEE' ? 'Employee' : task.space?.name || 'General')}
                    </span>
                  </div>
                  <span>•</span>
                  <span>
                    Submitted{' '}
                    {new Date(task.createdAt).toLocaleString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  <span>•</span>
                  <span>
                    Updated{' '}
                    {new Date(task.updatedAt).toLocaleString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              </div>

              {/* 2. Compact 2-Column / 3-Column Properties Grid (Notion / Linear style) */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 py-3 border-b border-slate-200 dark:border-zinc-800/80">
                {/* 1. Status */}
                <div className="space-y-1 relative z-30" ref={statusDropdownRef}>
                  <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider block">
                    Status
                  </span>
                  <div className="relative">
                    <button
                      type="button"
                      disabled={!canModify}
                      title={!canModify ? 'Only department staff or Superadmins can update status' : undefined}
                      onClick={() => setIsStatusMenuOpen((prev) => !prev)}
                      className={cn(
                        'w-full flex items-center justify-between bg-white border border-slate-200 hover:border-blue-400 dark:bg-[#14171F] dark:border-white/10 rounded-lg pl-2.5 pr-2 py-1.5 text-xs font-medium text-slate-900 dark:text-white transition-colors shadow-2xs',
                        canModify ? 'hover:bg-blue-50/30 dark:hover:bg-zinc-800/80 cursor-pointer' : 'cursor-not-allowed opacity-75'
                      )}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: currentStatusColor }}
                        />
                        <span className="truncate">{currentStatusName}</span>
                      </div>
                      <span className="text-slate-500 dark:text-zinc-500 text-[10px] ml-1.5 shrink-0">▾</span>
                    </button>

                    {isStatusMenuOpen && canModify && (
                      <div className="absolute left-0 top-full mt-1 w-full min-w-[160px] z-50 bg-white border border-slate-200 text-slate-800 shadow-xl dark:bg-[#14171F] dark:border-white/10 dark:text-slate-100 rounded-lg py-1 backdrop-blur-md animate-in fade-in-50 zoom-in-95 duration-100">
                        {availableStatuses.map((st) => {
                          const isSelected = st.id === currentStatusObj?.id || st.id === task.statusId;
                          return (
                            <button
                              key={st.id}
                              type="button"
                              onClick={() => handleChangeStatus(st.id)}
                              className={cn(
                                'w-full flex items-center justify-between px-3 py-1.5 text-xs text-left transition-colors cursor-pointer',
                                isSelected
                                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-600/15 dark:text-blue-200 font-semibold'
                                  : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:text-zinc-300 dark:hover:bg-white/5 dark:hover:text-white'
                              )}
                            >
                              <div className="flex items-center gap-2 truncate">
                                <span
                                  className="w-2 h-2 rounded-full shrink-0"
                                  style={{ backgroundColor: getCanonicalStatusColor(st) }}
                                />
                                <span className="truncate">{st.name}</span>
                              </div>
                              {isSelected && <Check className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0 ml-1.5" />}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {/* 2. Priority */}
                <div className="space-y-1">
                  <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider block">
                    Priority
                  </span>
                  <div className="relative">
                    <select
                      value={task.priority}
                      disabled={!canModify}
                      title={!canModify ? 'Only department staff or Superadmins can update priority' : undefined}
                      onChange={(e) => handleChangePriority(e.target.value as any)}
                      className="w-full appearance-none bg-white border border-slate-200 hover:border-blue-400 dark:bg-[#14171F] dark:border-white/10 rounded-lg pl-6 pr-6 py-1.5 text-xs font-medium text-slate-900 dark:text-white focus:outline-none focus:border-blue-600 cursor-pointer disabled:cursor-not-allowed disabled:opacity-75 shadow-2xs"
                    >
                      {PRIORITIES.map((p) => (
                        <option key={p.value} value={p.value} className="bg-white dark:bg-zinc-900 text-slate-900 dark:text-zinc-200">
                          {p.label}
                        </option>
                      ))}
                    </select>
                    <span
                      className="w-2 h-2 rounded-full absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                      style={{
                        backgroundColor:
                          task.priority === 'URGENT'
                            ? '#ef4444'
                            : task.priority === 'HIGH'
                            ? '#f97316'
                            : task.priority === 'NORMAL'
                            ? '#3b82f6'
                            : '#71717a',
                      }}
                    />
                    <span className="text-slate-500 dark:text-zinc-500 text-[10px] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
                      ▾
                    </span>
                  </div>
                </div>

                {/* 3. Queue List */}
                <div className="space-y-1">
                  <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider block">
                    Queue List
                  </span>
                  <div className="relative">
                    {(() => {
                      const targetSpace = spaces.find((s) => s.id === task.spaceId);
                      const isSuperadmin = currentUser?.globalRole === 'SUPERADMIN';
                      const isHead = Boolean(
                        targetSpace &&
                          currentUser?.id &&
                          (targetSpace.departmentHeadId === currentUser.id ||
                            targetSpace.departmentHead?.id === currentUser.id)
                      );
                      const isMember =
                        isSuperadmin ||
                        isHead ||
                        Boolean(targetSpace?.members?.some((m) => m.userId === currentUser?.id));

                      const availableLists = (
                        task.space?.lists ||
                        targetSpace?.lists ||
                        []
                      ).filter((q: any) => !q.isPrivate || isMember || q.id === task.listId);
                      const uniqueAvailableLists = Array.from(
                        new Map(availableLists.map((queueList) => [queueList.id, queueList])).values()
                      );

                      if (uniqueAvailableLists.length === 0) {
                        return (
                          <div className="px-2.5 py-1.5 bg-white border border-slate-200 dark:bg-[#14171F] dark:border-white/10 rounded-lg text-xs text-slate-900 dark:text-white font-medium">
                            {task.list?.name || 'Default Queue'}
                          </div>
                        );
                      }

                      return (
                        <>
                          <select
                            value={task.listId}
                            disabled={!canModify}
                            title={!canModify ? 'Only department staff or Superadmins can update queue list' : undefined}
                            onChange={(e) => handleChangeList(e.target.value)}
                            className="w-full appearance-none bg-white border border-slate-200 hover:border-blue-400 dark:bg-[#14171F] dark:border-white/10 rounded-lg pl-2.5 pr-6 py-1.5 text-xs font-medium text-slate-900 dark:text-white focus:outline-none focus:border-blue-600 cursor-pointer disabled:cursor-not-allowed disabled:opacity-75 shadow-2xs"
                          >
                            {uniqueAvailableLists.map((queueList) => (
                              <option key={queueList.id} value={queueList.id} className="bg-white dark:bg-zinc-900 text-slate-900 dark:text-zinc-200">
                                {queueList.name}
                              </option>
                            ))}
                          </select>
                          <span className="text-slate-500 dark:text-zinc-500 text-[10px] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
                            ▾
                          </span>
                        </>
                      );
                    })()}
                  </div>
                </div>

                {/* 4. Assignee */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                      Assignee
                    </span>
                    {canModify && task.assignee?.id !== currentUser.id && (
                      <button
                        type="button"
                        onClick={handleAssignToMe}
                        className="text-[10px] text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 font-semibold flex items-center gap-0.5 cursor-pointer"
                      >
                        <UserCheck className="w-2.5 h-2.5" />
                        <span>+ Assign to Me</span>
                      </button>
                    )}
                  </div>
                  <div className="px-2.5 py-1.5 bg-white border border-slate-200 dark:bg-[#14171F] dark:border-white/10 rounded-lg flex items-center gap-2 min-h-[32px] shadow-2xs">
                    <div className="w-4 h-4 rounded-full bg-blue-50 border border-blue-200 dark:bg-zinc-800 dark:border-zinc-700 flex items-center justify-center text-[9px] font-bold text-blue-700 dark:text-zinc-300 shrink-0">
                      {task.assignee?.name ? task.assignee.name[0].toUpperCase() : '?'}
                    </div>
                    <span className="text-xs font-medium text-slate-900 dark:text-white truncate">
                      {task.assignee?.name || 'Unassigned'}
                    </span>
                  </div>
                </div>

                {/* 5. Start & Due Date */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
                      Schedule
                    </span>
                    {canModify &&
                      (startDateDraft !== (task.startDate ? new Date(task.startDate).toISOString().slice(0, 10) : '') ||
                        dueDateDraft !== (task.dueDate ? new Date(task.dueDate).toISOString().slice(0, 10) : '') ||
                        isMilestoneDraft !== Boolean(task.isMilestone)) && (
                        <button
                          type="button"
                          disabled={isSavingSchedule}
                          onClick={handleSaveSchedule}
                          className="text-[10px] text-blue-400 hover:text-blue-300 font-medium cursor-pointer disabled:opacity-50"
                        >
                          {isSavingSchedule ? 'Saving...' : 'Save'}
                        </button>
                      )}
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <input
                      type="date"
                      disabled={!canModify}
                      value={startDateDraft}
                      title="Start Date"
                      onChange={(e) => setStartDateDraft(e.target.value)}
                      className="w-full bg-zinc-900/80 border border-zinc-800 rounded-lg px-2 py-1 text-[11px] text-zinc-200 focus:outline-none focus:border-zinc-700 disabled:opacity-50 cursor-pointer"
                    />
                    <input
                      type="date"
                      disabled={!canModify}
                      value={dueDateDraft}
                      title="Due Date"
                      onChange={(e) => setDueDateDraft(e.target.value)}
                      className="w-full bg-zinc-900/80 border border-zinc-800 rounded-lg px-2 py-1 text-[11px] text-zinc-200 focus:outline-none focus:border-zinc-700 disabled:opacity-50 cursor-pointer"
                    />
                  </div>
                </div>

                {/* 6. Milestone & Contributors */}
                <div className="space-y-1">
                  <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider block">
                    Milestone & Team
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={!canModify}
                      onClick={() => setIsMilestoneDraft(!isMilestoneDraft)}
                      className={cn(
                        'px-2.5 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer disabled:cursor-not-allowed',
                        isMilestoneDraft
                          ? 'bg-amber-950/40 border-amber-800/60 text-amber-300'
                          : 'bg-zinc-900/80 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                      )}
                      title="Toggle Milestone"
                    >
                      <span className={isMilestoneDraft ? 'text-amber-400 font-bold' : 'text-zinc-500'}>◆</span>
                      <span>Milestone</span>
                    </button>

                    {/* Overlapping Contributing Staff Avatars */}
                    <div className="flex items-center -space-x-1.5 overflow-hidden pl-1">
                      {contributorsList.slice(0, 4).map((person) => {
                        const initials = person.name
                          ? person.name
                              .split(' ')
                              .map((n) => n[0])
                              .join('')
                              .substring(0, 2)
                              .toUpperCase()
                          : 'ST';
                        return (
                          <div
                            key={person.id}
                            className="w-6 h-6 rounded-full bg-zinc-800 border-2 border-zinc-950 text-zinc-300 flex items-center justify-center text-[9px] font-bold cursor-help transition-transform hover:scale-110 hover:z-10"
                            title={`${person.name} (@${person.username}) • ${person.homeDepartment || 'Staff'} • ${person.tag?.toUpperCase() || 'CONTRIBUTOR'}`}
                          >
                            {initials}
                          </div>
                        );
                      })}
                      {contributorsList.length > 4 && (
                        <div
                          className="w-6 h-6 rounded-full bg-zinc-800 border-2 border-zinc-950 text-zinc-400 flex items-center justify-center text-[9px] font-bold"
                          title={`+${contributorsList.length - 4} more contributors`}
                        >
                          +{contributorsList.length - 4}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* 3. Description Right Above the Fold */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-slate-600 dark:text-zinc-400 font-medium">
                  <span className="font-semibold text-slate-800 dark:text-slate-200">Description</span>
                  {!isEditingDesc && canModify && (
                    <button
                      type="button"
                      onClick={() => setIsEditingDesc(true)}
                      className="text-[11px] text-slate-500 hover:text-blue-600 dark:text-zinc-500 dark:hover:text-zinc-300 flex items-center gap-1 cursor-pointer"
                    >
                      <Edit2 className="w-3 h-3" />
                      <span>Edit</span>
                    </button>
                  )}
                </div>

                {isEditingDesc ? (
                  <div className="space-y-2 max-w-full">
                    <textarea
                      rows={4}
                      value={descDraft}
                      onChange={(e) => setDescDraft(e.target.value)}
                      className="w-full max-w-full bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 rounded-lg p-3 text-xs text-slate-800 dark:text-zinc-200 focus:outline-none focus:border-blue-600 leading-relaxed font-sans break-words [overflow-wrap:anywhere] whitespace-pre-wrap overflow-x-hidden"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setIsEditingDesc(false)}
                        className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-xs dark:text-zinc-300 rounded-md cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveDesc}
                        className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-xs text-white rounded-md font-medium cursor-pointer"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    onClick={() => {
                      if (canModify) setIsEditingDesc(true);
                    }}
                    className={cn(
                      'p-3 bg-slate-50/90 border border-slate-200 dark:bg-zinc-900/40 dark:border-zinc-800/70 rounded-lg text-sm text-slate-800 dark:text-zinc-200 leading-relaxed whitespace-pre-wrap min-h-[64px] transition-colors break-words [overflow-wrap:anywhere] overflow-x-hidden max-w-full',
                      canModify ? 'cursor-pointer hover:border-blue-300 dark:hover:border-zinc-700' : ''
                    )}
                  >
                    {task.description ? (
                      task.description
                    ) : (
                      <span className="text-slate-400 dark:text-zinc-600 italic text-xs">
                        {canModify ? 'No description provided. Click to add details...' : 'No description provided.'}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* 4. Smart Custom Metadata */}
              {(() => {
                const applicableCustomFields = (task.space?.customFields || []).filter(
                  (field) =>
                    field.spaceId === task.spaceId &&
                    (!field.listId || field.listId === task.listId)
                );

                if (applicableCustomFields.length === 0) {
                  return (
                    <div className="py-2 px-3 rounded-lg bg-slate-50 border border-slate-200 text-slate-500 dark:bg-white/[0.03] dark:border-white/10 dark:text-slate-400 text-xs flex items-center gap-2">
                      <Tag className="w-3.5 h-3.5 text-slate-400 dark:text-zinc-500" />
                      <span>Custom Metadata — No fields configured for this queue</span>
                    </div>
                  );
                }

                return (
                  <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-zinc-800/80">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-semibold text-slate-800 dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                        <Tag className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                        <span>Custom Metadata ({applicableCustomFields.length})</span>
                      </label>

                      {canModify && (
                        <button
                          type="button"
                          disabled={isSavingCustomFields}
                          onClick={handleSaveCustomFields}
                          className="text-[10px] text-blue-400 hover:text-blue-300 font-medium cursor-pointer disabled:opacity-50"
                        >
                          {isSavingCustomFields ? 'Saving...' : 'Save Fields'}
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-zinc-900/40 border border-zinc-800/70 p-3 rounded-xl">
                      {applicableCustomFields.map((field) => {
                        const val = customFieldsDraft[field.id] ?? customFieldsDraft[field.name] ?? '';
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
                              <span className="text-[11px] text-zinc-300 font-medium flex items-center gap-1.5 truncate">
                                <span className="truncate">{field.name}</span>
                                {field.isRequired && (
                                  <span className="text-red-400 font-bold" title="Required field">
                                    *
                                  </span>
                                )}
                                {field.listId && (
                                  <span className="px-1.5 py-0.2 rounded text-[9px] font-semibold bg-indigo-950/60 text-indigo-300 border border-indigo-700/50 shrink-0">
                                    Queue
                                  </span>
                                )}
                              </span>
                              <span className="text-[9px] font-mono uppercase text-zinc-500 shrink-0">
                                {field.fieldType}
                              </span>
                            </div>

                            {field.fieldType === 'SELECT' ? (
                              <select
                                value={val}
                                disabled={!canModify}
                                onChange={(e) =>
                                  setCustomFieldsDraft((prev) => ({
                                    ...prev,
                                    [field.id]: e.target.value,
                                    [field.name]: e.target.value,
                                  }))
                                }
                                className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1 text-xs text-zinc-200 focus:outline-none focus:border-zinc-600 disabled:opacity-50 cursor-pointer"
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
                                  disabled={!canModify}
                                  value={val}
                                  onChange={(e) =>
                                    setCustomFieldsDraft((prev) => ({
                                      ...prev,
                                      [field.id]: e.target.value,
                                      [field.name]: e.target.value,
                                    }))
                                  }
                                  placeholder="0.00"
                                  className="w-full bg-zinc-950 border border-zinc-800 rounded pl-6 pr-2.5 py-1 text-xs text-zinc-200 focus:outline-none focus:border-zinc-600 disabled:opacity-50"
                                />
                              </div>
                            ) : field.fieldType === 'NUMBER' ? (
                              <input
                                type="number"
                                disabled={!canModify}
                                value={val}
                                onChange={(e) =>
                                  setCustomFieldsDraft((prev) => ({
                                    ...prev,
                                    [field.id]: e.target.value,
                                    [field.name]: e.target.value,
                                  }))
                                }
                                placeholder={`Enter ${field.name}`}
                                className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1 text-xs text-zinc-200 focus:outline-none focus:border-zinc-600 disabled:opacity-50"
                              />
                            ) : field.fieldType === 'DATE' ? (
                              <input
                                type="date"
                                disabled={!canModify}
                                value={val}
                                onChange={(e) =>
                                  setCustomFieldsDraft((prev) => ({
                                    ...prev,
                                    [field.id]: e.target.value,
                                    [field.name]: e.target.value,
                                  }))
                                }
                                className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1 text-xs text-zinc-200 focus:outline-none focus:border-zinc-600 disabled:opacity-50"
                              />
                            ) : (
                              <input
                                type="text"
                                disabled={!canModify}
                                value={val}
                                onChange={(e) =>
                                  setCustomFieldsDraft((prev) => ({
                                    ...prev,
                                    [field.id]: e.target.value,
                                    [field.name]: e.target.value,
                                  }))
                                }
                                placeholder={`Enter ${field.name}`}
                                className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1 text-xs text-zinc-200 focus:outline-none focus:border-zinc-600 disabled:opacity-50"
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* 5. Action Checklist */}
              <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-zinc-800/80">
                {(() => {
                  const checklistTotal = checklist.length;
                  const checklistCompleted = checklist.filter((c) => c.isCompleted).length;
                  const percentage = checklistTotal > 0 ? Math.round((checklistCompleted / checklistTotal) * 100) : 0;
                  const isAllComplete = checklistTotal > 0 && checklistCompleted === checklistTotal;

                  return (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
                          <CheckSquare className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                          <span>Action Checklist</span>
                        </div>
                        <span
                          className={cn(
                            'text-[11px] font-mono font-medium px-2 py-0.5 rounded-full border',
                            isAllComplete
                              ? 'text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-950/60 dark:border-emerald-800/60'
                              : 'text-slate-600 bg-slate-100 border-slate-200 dark:text-zinc-400 dark:bg-zinc-900 dark:border-zinc-800'
                          )}
                        >
                          {checklistCompleted}/{checklistTotal} ({percentage}%)
                        </span>
                      </div>

                      {/* Progress Bar */}
                      <div className="h-1.5 w-full rounded-full bg-slate-200 dark:bg-zinc-800 overflow-hidden">
                        <div
                          className={cn(
                            'h-full transition-all duration-300 ease-out',
                            isAllComplete ? 'bg-emerald-500' : 'bg-blue-600'
                          )}
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                  );
                })()}

                {/* Checklist Items */}
                <div className="space-y-1.5">
                  {checklist.map((item) => (
                    <div
                      key={item.id}
                      className="group flex items-center justify-between p-2 rounded-lg bg-slate-50 hover:bg-blue-50/50 border border-slate-200 hover:border-blue-300 dark:bg-zinc-900/40 dark:hover:bg-zinc-900/80 dark:border-zinc-800/60 dark:hover:border-zinc-700/80 transition-all text-xs"
                    >
                      <label className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={item.isCompleted}
                          onChange={() => handleToggleChecklist(item)}
                          className="w-4 h-4 rounded border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-emerald-600 focus:ring-0 focus:ring-offset-0 cursor-pointer accent-emerald-500"
                        />
                        <span
                          className={cn(
                            'transition-all break-words [overflow-wrap:anywhere] min-w-0 flex-1',
                            item.isCompleted ? 'line-through text-slate-400 dark:text-zinc-500' : 'text-slate-800 dark:text-zinc-200'
                          )}
                        >
                          {item.title}
                        </span>
                      </label>
                      <button
                        type="button"
                        onClick={() => handleDeleteChecklist(item.id)}
                        className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:text-zinc-500 dark:hover:text-red-400 dark:hover:bg-zinc-800/60 rounded transition-all cursor-pointer shrink-0 ml-2"
                        title="Delete subtask"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>

                {/* Quick-Add Input Row */}
                <form onSubmit={handleAddChecklist} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newChecklistTitle}
                    onChange={(e) => setNewChecklistTitle(e.target.value)}
                    placeholder="Add a subtask or verification step... (Press Enter)"
                    disabled={isAddingChecklist}
                    className="w-full bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-slate-800 dark:text-zinc-200 placeholder:text-slate-400 dark:placeholder:text-zinc-600 focus:outline-none focus:border-blue-600 disabled:opacity-50"
                  />
                </form>
              </div>

              {/* 6. Attachments & Evidence */}
              <div className="space-y-3 pt-3 border-t border-slate-200 dark:border-zinc-800/80">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs text-slate-800 dark:text-slate-200 font-semibold">
                    <Paperclip className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                    <span>Attachments & Evidence ({task.attachments?.length || 0})</span>
                    <span className="text-[10px] text-slate-500 dark:text-zinc-500 font-normal font-mono ml-1.5">(Up to 100MB)</span>
                  </div>

                  <div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files && e.target.files[0]) {
                          handleUploadFile(e.target.files[0]);
                        }
                      }}
                    />
                    <button
                      type="button"
                      disabled={isUploadingFile}
                      onClick={() => fileInputRef.current?.click()}
                      className="text-[11px] text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 font-semibold flex items-center gap-1 cursor-pointer disabled:opacity-50"
                    >
                      {isUploadingFile ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin" />
                          <span>Uploading... {uploadFileProgress > 0 ? `${uploadFileProgress}%` : ''}</span>
                        </>
                      ) : (
                        <>
                          <UploadCloud className="w-3 h-3" />
                          <span>Upload File</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Compact Drag and Drop Zone */}
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragOverDropzone(true);
                  }}
                  onDragLeave={() => setIsDragOverDropzone(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDragOverDropzone(false);
                    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                      handleUploadFile(e.dataTransfer.files[0]);
                    }
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  className={cn(
                    'py-2.5 px-3.5 border-2 border-dashed rounded-lg flex items-center justify-between text-xs transition-colors cursor-pointer',
                    isDragOverDropzone
                      ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/20 dark:text-blue-300'
                      : 'bg-blue-50/40 hover:bg-blue-50/80 border-blue-200 text-slate-600 dark:bg-white/[0.02] dark:border-white/10 dark:text-slate-400'
                  )}
                >
                  <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
                    <UploadCloud className="w-4 h-4 text-blue-600 dark:text-zinc-400 shrink-0" />
                    <span>Drop files here, click to browse, or paste screenshot with <strong>Ctrl+V</strong></span>
                  </div>
                  <span className="text-[11px] text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 font-semibold shrink-0 ml-2">
                    Browse
                  </span>
                </div>

                {/* Attachments Cards Grid */}
                {task.attachments && task.attachments.length > 0 && (
                  <div className="space-y-2.5">
                    {/* Image Attachments */}
                    {(() => {
                      const imageAttachments = task.attachments.filter((a) => {
                        const type = a.fileType || a.mimeType || '';
                        return type.startsWith('image/');
                      });
                      if (imageAttachments.length === 0) return null;

                      return (
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                          {imageAttachments.map((att) => {
                            const fileName = att.fileName || att.filename || 'image';
                            const fileUrl = att.fileUrl || `/api/attachments/${att.id}`;
                            return (
                              <div
                                key={att.id}
                                className="h-24 rounded-lg border border-zinc-800 overflow-hidden bg-zinc-950 relative group cursor-pointer"
                                onClick={() => setLightboxImage({ url: fileUrl, name: fileName })}
                              >
                                <img
                                  src={fileUrl}
                                  alt={fileName}
                                  className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
                                />
                                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-2">
                                  <div className="flex justify-end">
                                    {canDeleteAttachmentItem(att) && (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleDeleteAttachment(att.id);
                                        }}
                                        className="p-1 bg-black/60 hover:bg-rose-950/80 text-zinc-300 hover:text-rose-300 rounded transition-colors cursor-pointer"
                                        title="Delete attachment"
                                      >
                                        <Trash2 className="w-3 h-3" />
                                      </button>
                                    )}
                                  </div>
                                  <p className="text-[10px] text-zinc-200 truncate font-mono">{fileName}</p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}

                    {/* Document Attachments */}
                    {(() => {
                      const docAttachments = task.attachments.filter((a) => {
                        const type = a.fileType || a.mimeType || '';
                        return !type.startsWith('image/');
                      });
                      if (docAttachments.length === 0) return null;

                      return (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {docAttachments.map((att) => {
                            const fileName = att.fileName || att.filename || 'document';
                            const fileUrl = att.fileUrl || `/api/attachments/${att.id}`;
                            const size = att.fileSize ?? att.size ?? 0;
                            const sizeFormatted = size > 1024 * 1024
                              ? `${(size / (1024 * 1024)).toFixed(1)} MB`
                              : `${Math.round(size / 1024)} KB`;
                            const uploaderName = att.uploadedBy?.username || att.uploader?.username;

                            return (
                              <div
                                key={att.id}
                                className="flex items-center justify-between p-2.5 bg-zinc-900/60 border border-zinc-800 rounded-lg hover:border-zinc-700 transition-all text-xs"
                              >
                                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                  <div className="w-7 h-7 rounded bg-zinc-800 flex items-center justify-center shrink-0">
                                    <FileText className="w-3.5 h-3.5 text-blue-400" />
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <p className="font-mono text-zinc-200 truncate break-words [overflow-wrap:anywhere] min-w-0" title={fileName}>{fileName}</p>
                                    <p className="text-[10px] text-zinc-500 font-mono">
                                      {sizeFormatted} {uploaderName ? `• @${uploaderName}` : ''}
                                    </p>
                                  </div>
                                </div>

                                <div className="flex items-center gap-1 shrink-0 ml-2">
                                  <a
                                    href={fileUrl}
                                    download={fileName}
                                    target="_blank"
                                    rel="noreferrer"
                                    title="Download / Open file"
                                    className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded transition-colors"
                                  >
                                    <Download className="w-3.5 h-3.5" />
                                  </a>
                                  {canDeleteAttachmentItem(att) && (
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteAttachment(att.id)}
                                      title="Delete file"
                                      className="p-1.5 text-zinc-500 hover:text-rose-400 hover:bg-zinc-800 rounded transition-colors cursor-pointer"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>

              {/* 7. People & Stakeholders Combined Card */}
              <div className="pt-2 border-t border-zinc-800/80 space-y-2">
                <label className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-blue-400" />
                  <span>People & Stakeholders</span>
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-xl bg-zinc-900/30 border border-zinc-800/60 shadow-sm">
                  {/* Left Column: Requester / Creator Details */}
                  <div className="space-y-2.5">
                    <div className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1">
                      <UserIcon className="w-3 h-3 text-emerald-400" />
                      <span>Requester / Creator</span>
                    </div>

                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-emerald-950/70 border border-emerald-800/80 flex items-center justify-center text-xs font-bold text-emerald-300 shrink-0">
                        {task.createdBy.name
                          ? task.createdBy.name
                              .split(' ')
                              .map((n) => n[0])
                              .join('')
                              .substring(0, 2)
                              .toUpperCase()
                          : 'RQ'}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-zinc-100 truncate">
                          {task.createdBy.name}{' '}
                          <span className="font-mono text-zinc-400 font-normal">
                            (@{task.createdBy.username})
                          </span>
                        </p>
                        <span className="text-[10px] font-mono uppercase px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-400">
                          {task.createdBy.globalRole}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-1.5 pt-2 border-t border-zinc-800/60 text-xs">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-zinc-500 font-medium flex items-center gap-1">
                          <Building className="w-3 h-3 text-zinc-400" />
                          Home Dept:
                        </span>
                        <span className="px-2 py-0.5 rounded font-medium text-[11px] bg-blue-950/60 border border-blue-800/70 text-blue-300 truncate max-w-[140px]">
                          {collabInfo?.originSpace?.name ||
                            task.createdBy.homeDepartment ||
                            task.createdBy.spaceMemberships?.[0]?.space?.name ||
                            (task.createdBy.globalRole === 'EMPLOYEE'
                              ? 'Organization Employee'
                              : 'General')}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-zinc-500 font-medium">Corporate Email:</span>
                        <span
                          className="text-zinc-300 font-mono text-[10px] truncate max-w-[140px]"
                          title={task.createdBy.email}
                        >
                          {task.createdBy.email}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-zinc-500 font-medium flex items-center gap-1">
                          <Calendar className="w-3 h-3 text-zinc-400" />
                          Submitted:
                        </span>
                        <span className="text-zinc-300 font-mono text-[10px]">
                          {new Date(task.createdAt).toLocaleString(undefined, {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-zinc-500 font-medium flex items-center gap-1">
                          <Clock className="w-3 h-3 text-zinc-400" />
                          Last Update:
                        </span>
                        <span className="text-zinc-400 font-mono text-[10px]">
                          {new Date(task.updatedAt).toLocaleString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Contributing Staff */}
                  <div className="space-y-2.5 sm:border-l sm:border-zinc-800/60 sm:pl-3">
                    <div className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1">
                      <Users className="w-3 h-3 text-blue-400" />
                      <span>Contributing Staff ({contributorsList.length})</span>
                    </div>

                    {contributorsList.length === 0 ? (
                      <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-xl text-xs text-zinc-500 italic">
                        No active contributors recorded.
                      </div>
                    ) : (
                      <div className="space-y-2 divide-y divide-zinc-800/60 max-h-[160px] overflow-y-auto pr-1">
                        {contributorsList.map((person) => {
                          const initials = person.name
                            ? person.name
                                .split(' ')
                                .map((n) => n[0])
                                .join('')
                                .substring(0, 2)
                                .toUpperCase()
                            : 'ST';

                          return (
                            <div
                              key={person.id}
                              className="flex items-center justify-between pt-1.5 first:pt-0"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <div className="w-5 h-5 rounded-full bg-blue-950 border border-blue-800/70 text-blue-300 flex items-center justify-center text-[9px] font-bold shrink-0">
                                  {initials}
                                </div>
                                <div className="min-w-0">
                                  <p className="text-xs font-medium text-zinc-200 truncate">
                                    {person.name}
                                  </p>
                                  <p className="text-[9px] font-mono text-zinc-500 truncate">
                                    @{person.username}
                                  </p>
                                </div>
                              </div>

                              <div className="flex items-center gap-1.5 shrink-0">
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-blue-950/60 border border-blue-800/70 text-blue-300">
                                  {person.homeDepartment ? `${person.homeDepartment}` : 'Staff'}
                                </span>
                                {person.tag && (
                                  <span className="text-[9px] font-mono text-zinc-500 uppercase">
                                    {person.tag}
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* ================================================================= */}
            {/* RIGHT PANE: Dedicated Activity & Comments Chat Panel               */}
            {/* ================================================================= */}
            <div className="w-full lg:w-[420px] xl:w-[460px] flex-shrink-0 h-full border-t lg:border-t-0 lg:border-l border-[#C8D5E6] dark:border-zinc-800 bg-[#E2E8F2] dark:bg-zinc-950/50 flex flex-col overflow-hidden min-w-0">
              {/* Sticky Top Tab Bar */}
              <div className="flex-shrink-0 px-4 py-3 border-b border-[#C8D5E6] dark:border-zinc-800 bg-[#EAF0F8] dark:bg-zinc-900/40 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 p-0.5 bg-[#D8E1EE] border border-[#C4D1E2] dark:bg-white/5 dark:border-white/10 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setActiveMainTab('comments')}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer',
                      activeMainTab === 'comments'
                        ? 'bg-[#F0F4FA] text-[#1D4ED8] shadow-xs ring-1 ring-[#ADC8EC] dark:bg-blue-600 dark:text-white'
                        : 'text-[#334155] hover:text-[#0F172A] hover:bg-[#CAD8EA] dark:text-slate-400 dark:hover:text-white'
                    )}
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>
                      Comments ({comments.length || (isHydratingActivity ? ((task as any)?._count?.comments ?? 0) : 0)})
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveMainTab('history')}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer',
                      activeMainTab === 'history'
                        ? 'bg-[#F0F4FA] text-[#1D4ED8] shadow-xs ring-1 ring-[#ADC8EC] dark:bg-blue-600 dark:text-white'
                        : 'text-[#334155] hover:text-[#0F172A] hover:bg-[#CAD8EA] dark:text-slate-400 dark:hover:text-white'
                    )}
                  >
                    <Clock className="w-3.5 h-3.5" />
                    <span>History ({task.history?.length || 0})</span>
                  </button>
                </div>

                <span className="text-[10px] text-[#475569] dark:text-zinc-500 font-mono hidden xl:inline">
                  Audit Progression Trail
                </span>
              </div>

              {/* Independent Scrollable Feed */}
              <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-4 space-y-3 min-w-0">
                {activeMainTab === 'comments' ? (
                  <>
                    {/* Comment Cards Stream */}
                    <div className="space-y-3">
                      {(() => {
                        const uniqueComments = Array.from(
                          new Map(comments.map((c) => [c.id, c])).values()
                        );
                        if (uniqueComments.length === 0) {
                          if (isHydratingActivity && ((task as any)?._count?.comments ?? 1) > 0) {
                            return (
                              <div className="space-y-2.5 py-4">
                                <div className="flex items-center justify-center gap-2 text-xs text-zinc-500 py-2">
                                  <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-400" />
                                  <span>Syncing comments...</span>
                                </div>
                                <div className="h-16 rounded-xl bg-zinc-900/40 border border-zinc-800/60 animate-pulse" />
                              </div>
                            );
                          }
                          return (
                            <div className="text-center py-12 text-xs text-zinc-600 italic">
                              No comments or updates posted yet.
                            </div>
                          );
                        }
                        return uniqueComments.map((comment, index) => {
                          const isInternal = comment.isInternal;
                          const authorInitials = comment.author?.name
                            ? comment.author.name
                                .split(' ')
                                .map((n) => n[0])
                                .join('')
                                .substring(0, 2)
                                .toUpperCase()
                            : 'US';

                          return (
                            <div
                              key={`${comment.id}-${comment.createdAt || index}`}
                              className={`group/comment relative rounded-xl border p-3.5 space-y-2 transition-all ${
                                isInternal
                                  ? 'bg-amber-950/25 border-amber-800/60 shadow-sm'
                                  : 'bg-zinc-900/50 border-zinc-800'
                              }`}
                            >
                              {/* Comment Header */}
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  {/* Avatar */}
                                  <div
                                    className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                                      isInternal
                                        ? 'bg-amber-800/80 text-amber-200'
                                        : 'bg-zinc-800 text-zinc-300'
                                    }`}
                                  >
                                    {authorInitials}
                                  </div>

                                  <span className="text-xs font-semibold text-zinc-200 truncate max-w-[130px]">
                                    {comment.author?.name || comment.author?.username}
                                  </span>

                                  <span className="text-[10px] px-1.5 py-0.2 rounded font-mono uppercase bg-zinc-800 text-zinc-400">
                                    {comment.author?.globalRole}
                                  </span>

                                  {/* Internal Note Pill */}
                                  {isInternal && (
                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded-full text-[9px] font-bold uppercase tracking-wider bg-amber-900/70 border border-amber-700/80 text-amber-300">
                                      <Lock className="w-2.5 h-2.5" />
                                      <span>INTERNAL NOTE</span>
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center gap-1.5 shrink-0 ml-1">
                                  <span className="text-[10px] text-zinc-500 font-mono">
                                    {new Date(comment.createdAt).toLocaleString(undefined, {
                                      month: 'short',
                                      day: 'numeric',
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })}
                                  </span>

                                  {canDeleteCommentItem(comment) && (
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteComment(comment.id)}
                                      className="opacity-0 group-hover/comment:opacity-100 p-1 text-zinc-500 hover:text-rose-400 hover:bg-zinc-800/80 rounded transition-all cursor-pointer"
                                      title="Delete comment and linked attachments"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              </div>

                              {/* Comment Content with Rich @Mentions */}
                              <div
                                className={`text-xs leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere] min-w-0 max-w-full overflow-hidden ${
                                  isInternal ? 'text-amber-100 font-normal' : 'text-zinc-300'
                                }`}
                              >
                                {renderCommentWithMentions(comment.content, isInternal)}
                              </div>

                              {/* Attached Files & Screenshots Inline Cards */}
                              {(() => {
                                let atts: any[] = [];
                                if (Array.isArray(comment.attachments) && comment.attachments.length > 0) {
                                  atts = comment.attachments;
                                } else if (comment.attachmentsJson) {
                                  try {
                                    atts = JSON.parse(comment.attachmentsJson);
                                  } catch {}
                                }
                                if (!atts || atts.length === 0) return null;

                                return (
                                  <div className="space-y-2 pt-1">
                                    {atts.map((att, attIdx) => {
                                      const isImage =
                                        (att.fileType && att.fileType.startsWith('image/')) ||
                                        /\.(png|jpe?g|webp|gif|svg)$/i.test(att.fileName || att.filename || '');

                                      const fName = att.fileName || att.filename || 'attachment';
                                      const fUrl = att.fileUrl || att.filepath || '#';
                                      const fSize = att.fileSize || att.size || 0;
                                      const formattedSize =
                                        fSize > 1024 * 1024
                                          ? `${(fSize / (1024 * 1024)).toFixed(1)} MB`
                                          : `${Math.round(fSize / 1024)} KB`;

                                      const canDel = canDeleteAttachmentItem(att) || canDeleteCommentItem(comment);

                                      if (isImage) {
                                        return (
                                          <div key={att.id || attIdx} className="relative group/img inline-block">
                                            <img
                                              src={fUrl}
                                              alt={fName}
                                              onClick={() => setLightboxImage({ url: fUrl, name: fName })}
                                              className="max-h-44 rounded-lg border border-zinc-800 object-cover mt-2 cursor-pointer hover:opacity-95 shadow-sm transition-opacity"
                                            />
                                            <div className="absolute bottom-2 left-2 bg-black/70 backdrop-blur-xs px-1.5 py-0.5 rounded text-[9px] text-zinc-300 font-mono pointer-events-none">
                                              {formattedSize}
                                            </div>
                                            <div className="absolute top-3.5 right-2 flex items-center gap-1 opacity-0 group-hover/img:opacity-100 transition-opacity">
                                              <a
                                                href={fUrl}
                                                download={fName}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                onClick={(e) => e.stopPropagation()}
                                                title="Download image"
                                                className="p-1 rounded-md bg-zinc-900/80 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-800 transition-colors cursor-pointer"
                                              >
                                                <Download className="w-3.5 h-3.5" />
                                              </a>
                                              {canDel && (
                                                <button
                                                  type="button"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleDeleteCommentAttachment(comment.id, att);
                                                  }}
                                                  title="Delete attachment"
                                                  className="p-1 rounded-md bg-zinc-900/80 hover:bg-rose-950/80 text-zinc-400 hover:text-rose-400 border border-zinc-800 hover:border-rose-800/60 transition-colors cursor-pointer"
                                                >
                                                  <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                              )}
                                            </div>
                                          </div>
                                        );
                                      }

                                      return (
                                        <div
                                          key={att.id || attIdx}
                                          className="mt-2 p-2 rounded-lg bg-zinc-900/90 border border-zinc-800 hover:border-zinc-700 flex items-center justify-between gap-3 max-w-xs transition-colors group/doc"
                                        >
                                          <a
                                            href={fUrl}
                                            download={fName}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer"
                                          >
                                            <div className="p-1.5 rounded bg-zinc-800/80 text-indigo-400 shrink-0">
                                              <FileText className="w-4 h-4" />
                                            </div>
                                            <div className="min-w-0 flex-1">
                                              <p className="text-xs font-medium text-zinc-200 truncate hover:text-indigo-300 transition-colors break-words [overflow-wrap:anywhere] min-w-0">
                                                {fName}
                                              </p>
                                              <p className="text-[10px] text-zinc-500 font-mono">
                                                {formattedSize}
                                              </p>
                                            </div>
                                          </a>
                                          <div className="flex items-center gap-1 shrink-0">
                                            <a
                                              href={fUrl}
                                              download={fName}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              title="Download file"
                                              className="p-1 rounded-md bg-zinc-900/80 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-800 transition-colors cursor-pointer"
                                            >
                                              <Download className="w-3.5 h-3.5 text-indigo-400" />
                                            </a>
                                            {canDel && (
                                              <button
                                                type="button"
                                                onClick={() => handleDeleteCommentAttachment(comment.id, att)}
                                                title="Delete attachment"
                                                className="p-1 rounded-md bg-zinc-900/80 hover:bg-rose-950/80 text-zinc-400 hover:text-rose-400 border border-zinc-800 hover:border-rose-800/60 transition-colors cursor-pointer"
                                              >
                                                <Trash2 className="w-3.5 h-3.5" />
                                              </button>
                                            )}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                );
                              })()}
                            </div>
                          );
                        });
                      })()}
                    </div>
                    <div ref={commentsEndRef} />
                  </>
                ) : (
                  /* Progression History Timeline */
                  <div className="space-y-4 pt-1">
                    {!task.history || task.history.length === 0 ? (
                      isHydratingActivity ? (
                        <div className="flex items-center justify-center gap-2 py-12 text-xs text-zinc-500">
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-400" />
                          <span>Syncing progression history...</span>
                        </div>
                      ) : (
                        <div className="text-center py-12 text-xs text-zinc-500 italic border border-dashed border-zinc-800/80 rounded-xl">
                          No hand-off or status transitions recorded for this ticket yet.
                        </div>
                      )
                    ) : (
                      <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-3 before:bottom-3 before:w-0.5 before:bg-zinc-800">
                        {task.history.map((record, index) => {
                          const isTransfer = record.actionType === 'HANDOFF_TRANSFER';
                          const isClosed = record.actionType === 'CLOSED';
                          const isCreated = record.actionType === 'CREATED';
                          const isStatusChange = record.actionType === 'STATUS_CHANGE';

                          return (
                            <div key={record.id || index} className="relative group">
                              {/* Timeline Node Dot / Icon */}
                              <div
                                className={`absolute -left-6 top-0.5 w-5 h-5 rounded-full border flex items-center justify-center text-[10px] ${
                                  isTransfer
                                    ? 'bg-blue-950 border-blue-500 text-blue-300 ring-4 ring-zinc-950'
                                    : isClosed
                                    ? 'bg-emerald-950 border-emerald-500 text-emerald-300 ring-4 ring-zinc-950'
                                    : isCreated
                                    ? 'bg-purple-950 border-purple-500 text-purple-300 ring-4 ring-zinc-950'
                                    : 'bg-zinc-900 border-zinc-700 text-zinc-300 ring-4 ring-zinc-950'
                                }`}
                              >
                                {isTransfer && <Building className="w-2.5 h-2.5" />}
                                {isClosed && <CheckCircle2 className="w-2.5 h-2.5" />}
                                {isCreated && <PlusCircle className="w-2.5 h-2.5" />}
                                {isStatusChange && <RefreshCw className="w-2.5 h-2.5" />}
                                {!isTransfer && !isClosed && !isCreated && !isStatusChange && <Clock className="w-2.5 h-2.5" />}
                              </div>

                              {/* Event Box */}
                              <div className="bg-zinc-900/60 border border-zinc-800/90 rounded-xl p-3.5 space-y-2 shadow-xs">
                                <div className="flex items-center justify-between text-xs">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span
                                      className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase border ${
                                        isTransfer
                                          ? 'bg-blue-950/80 text-blue-300 border-blue-800'
                                          : isClosed
                                          ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800'
                                          : isCreated
                                          ? 'bg-purple-950/80 text-purple-300 border-purple-800'
                                          : 'bg-zinc-800 text-zinc-300 border-zinc-700'
                                      }`}
                                    >
                                      {isTransfer
                                        ? 'Hand-off'
                                        : isClosed
                                        ? 'Closed'
                                        : isCreated
                                        ? 'Created'
                                        : 'Status Change'}
                                    </span>
                                    <span className="text-zinc-400 text-[11px] font-medium">
                                      by <span className="text-zinc-200 font-semibold">{record.actor?.name || 'Staff User'}</span>
                                    </span>
                                  </div>
                                  <span className="text-[10px] font-mono text-zinc-500">
                                    {new Date(record.createdAt).toLocaleString(undefined, {
                                      month: 'short',
                                      day: 'numeric',
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })}
                                  </span>
                                </div>

                                {/* Description */}
                                {isCreated && (
                                  <div className="text-xs text-zinc-300 break-words [overflow-wrap:anywhere] min-w-0">
                                    <p>{record.notes || `Ticket created by ${record.actor?.name || 'Staff User'}`}</p>
                                  </div>
                                )}

                                {isTransfer && (
                                  <div className="space-y-1 text-xs text-zinc-300 break-words [overflow-wrap:anywhere] min-w-0">
                                    <p>
                                      Transferred from{' '}
                                      <span className="font-semibold text-blue-300">
                                        {record.fromSpace?.name || 'Previous Department'}
                                      </span>{' '}
                                      {record.fromQueueName && (
                                        <span className="text-zinc-400">({record.fromQueueName})</span>
                                      )}{' '}
                                      to{' '}
                                      <span className="font-semibold text-emerald-300">
                                        {record.toSpace?.name || 'Target Space'}
                                      </span>{' '}
                                      {record.toQueueName && (
                                        <span className="text-zinc-400">({record.toQueueName})</span>
                                      )}
                                    </p>
                                    <div className="flex items-center gap-1 text-[10px] text-zinc-400">
                                      <RefreshCw className="w-2.5 h-2.5 text-emerald-400" />
                                      <span>
                                        Reset to <strong>OPEN</strong> in {record.toSpace?.name || 'new department'}
                                      </span>
                                    </div>
                                  </div>
                                )}

                                {isClosed && (
                                  <div className="text-xs text-zinc-300 break-words [overflow-wrap:anywhere] min-w-0">
                                    <p>
                                      Ticket resolved and closed by{' '}
                                      <span className="font-semibold text-emerald-300">{record.actor?.name}</span>.
                                    </p>
                                  </div>
                                )}

                                {isStatusChange && (
                                  <div className="text-xs text-zinc-300 break-words [overflow-wrap:anywhere] min-w-0">
                                    <p>{record.notes || `Status changed by ${record.actor?.name}`}</p>
                                  </div>
                                )}

                                {record.notes && isTransfer && (
                                  <div className="p-2.5 bg-zinc-950/80 border border-zinc-800 rounded-lg text-xs italic relative pl-3.5 border-l-2 border-l-blue-500 break-words [overflow-wrap:anywhere] min-w-0">
                                    <p className="text-zinc-300">"{record.notes}"</p>
                                  </div>
                                )}
                                {record.notes && isClosed && (
                                  <div className="p-2.5 bg-zinc-950/80 border border-zinc-800 rounded-lg text-xs italic relative pl-3.5 border-l-2 border-l-emerald-500 break-words [overflow-wrap:anywhere] min-w-0">
                                    <p className="text-zinc-300">"{record.notes}"</p>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Sticky Bottom Comment Composer (Permanently pinned at bottom when Comments tab is active) */}
              {activeMainTab === 'comments' && (
                <div
                  className={`flex-shrink-0 border-t border-zinc-800 p-3.5 bg-zinc-900/90 backdrop-blur-sm relative transition-all ${
                    isDraggingOverComment ? 'border-2 border-dashed border-blue-500 bg-blue-950/20' : ''
                  } ${
                    isInternalComment && isStaffOrAdmin
                      ? 'bg-amber-950/20 border-t-amber-700/80'
                      : ''
                  }`}
                  onPaste={handleCommentPaste}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDraggingOverComment(true);
                  }}
                  onDragLeave={() => setIsDraggingOverComment(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDraggingOverComment(false);
                    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                      const dropped = Array.from(e.dataTransfer.files);
                      setStagedFiles((prev) => [...prev, ...dropped]);
                    }
                  }}
                >
                  {/* Mode Selector Tabs (Staff & Admin only) */}
                  {isStaffOrAdmin ? (
                    <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-200 dark:border-zinc-800/80">
                      <div className="flex items-center gap-1 p-0.5 bg-slate-100 dark:bg-zinc-950 rounded-lg border border-slate-200 dark:border-zinc-800">
                        <button
                          type="button"
                          onClick={() => setIsInternalComment(false)}
                          className={`px-2 py-0.5 text-xs font-medium rounded-md transition-all cursor-pointer ${
                            !isInternalComment
                              ? 'bg-white text-blue-600 shadow-xs font-semibold dark:bg-zinc-800 dark:text-zinc-100'
                              : 'text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-zinc-200'
                          }`}
                        >
                          Public Reply
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsInternalComment(true)}
                          className={`flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                            isInternalComment
                              ? 'bg-amber-600 text-white dark:text-amber-950 font-bold shadow-sm'
                              : 'text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300'
                          }`}
                        >
                          <Lock className="w-3 h-3" />
                          <span>Internal Note</span>
                        </button>
                      </div>

                      <span className="text-[10px] text-slate-500 dark:text-zinc-500 font-mono hidden sm:inline">
                        {isInternalComment ? 'Staff & Admin only' : 'Visible to requester'}
                      </span>
                    </div>
                  ) : (
                    <div className="pb-1 text-[11px] text-slate-600 dark:text-zinc-400 font-medium">
                      Public Reply to Support Team
                    </div>
                  )}

                  {/* Comment Textarea & Actions */}
                  <div className="relative">
                    {/* Mention Autocomplete Dropdown */}
                    {showMentionMenu && mentionOptions.length > 0 && (
                      <div className="absolute bottom-full left-0 mb-2 z-30 w-full max-h-56 bg-zinc-900 border border-zinc-700/80 rounded-xl shadow-2xl overflow-y-auto p-1.5 custom-scrollbar animate-in fade-in zoom-in-95 duration-150">
                        <div className="px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-zinc-400 border-b border-zinc-800 mb-1 flex items-center justify-between">
                          <span>Mention in note</span>
                          <span className="text-zinc-500">↑↓ navigate • ↵ select</span>
                        </div>
                        {mentionOptions.map((opt, i) => {
                          const isSelected = i === mentionIndex;
                          return (
                            <button
                              key={opt.id}
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                insertMention(opt);
                              }}
                              className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-xs transition-colors cursor-pointer ${
                                isSelected
                                  ? 'bg-blue-600/30 text-white border border-blue-500/40'
                                  : 'hover:bg-zinc-800 text-zinc-300'
                              }`}
                            >
                              {opt.type === 'everyone' ? (
                                <div className="w-6 h-6 rounded-full bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-[10px] font-bold text-purple-300 shrink-0">
                                  @
                                </div>
                              ) : (
                                <div className="w-6 h-6 rounded-full bg-blue-500/20 border border-blue-500/40 flex items-center justify-center text-[10px] font-bold text-blue-300 shrink-0">
                                  {opt.user?.name ? opt.user.name[0].toUpperCase() : '@'}
                                </div>
                              )}
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-semibold text-xs text-zinc-100 truncate">
                                    {opt.label}
                                  </span>
                                  {opt.type === 'everyone' ? (
                                    <span className="text-[9px] px-1.5 py-0.2 rounded font-mono bg-purple-500/20 text-purple-300 border border-purple-500/30">
                                      ALL
                                    </span>
                                  ) : opt.user?.departmentBadge ? (
                                    <span className="text-[9px] px-1.5 py-0.2 rounded font-mono bg-blue-500/20 text-blue-300 border border-blue-500/30">
                                      {opt.user.departmentBadge}
                                    </span>
                                  ) : null}
                                </div>
                                {opt.subtitle && (
                                  <p className="text-[10px] text-zinc-400 truncate">{opt.subtitle}</p>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* Staged Files Preview Tray */}
                    {stagedFiles.length > 0 && (
                      <div className="flex items-center gap-2 overflow-x-auto pb-2 mb-2 custom-scrollbar border-b border-zinc-800/60">
                        {stagedFiles.map((file, idx) => {
                          const isImg = file.type.startsWith('image/');
                          const fileUrl = isImg ? URL.createObjectURL(file) : null;
                          const formattedSize =
                            file.size > 1024 * 1024
                              ? `${(file.size / (1024 * 1024)).toFixed(1)} MB`
                              : `${Math.round(file.size / 1024)} KB`;

                          return (
                            <div
                              key={`${file.name}-${idx}`}
                              className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 rounded-lg p-1.5 pr-2 shrink-0 max-w-[200px] shadow-xs group"
                            >
                              {isImg && fileUrl ? (
                                <img
                                  src={fileUrl}
                                  alt={file.name}
                                  className="w-10 h-10 rounded object-cover border border-zinc-700 shrink-0"
                                />
                              ) : (
                                <div className="w-10 h-10 rounded bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0 text-zinc-400">
                                  <FileText className="w-5 h-5 text-indigo-400" />
                                </div>
                              )}
                              <div className="min-w-0 flex-1">
                                <p className="text-[11px] font-medium text-zinc-200 truncate">{file.name}</p>
                                <p className="text-[9px] text-zinc-500 font-mono">
                                  {formattedSize}
                                  {commentUploadProgress[`${file.name}-${idx}`] !== undefined
                                    ? ` • ${commentUploadProgress[`${file.name}-${idx}`]}%`
                                    : ''}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => setStagedFiles((prev) => prev.filter((_, i) => i !== idx))}
                                className="p-1 text-zinc-500 hover:text-red-400 rounded transition-colors cursor-pointer shrink-0"
                                title="Remove file"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <textarea
                      ref={commentTextareaRef}
                      rows={3}
                      value={newComment}
                      onChange={handleCommentChange}
                      onKeyDown={handleCommentKeyDown}
                      placeholder={
                        isInternalComment && isStaffOrAdmin
                          ? 'Write an internal staff note (@username, @everyone)...'
                          : 'Write a public reply (@username, @everyone)...'
                      }
                      className={`w-full bg-transparent text-xs placeholder-slate-400 dark:placeholder-zinc-500 focus:outline-none leading-relaxed resize-none ${
                        isInternalComment && isStaffOrAdmin ? 'text-amber-900 dark:text-amber-100' : 'text-slate-800 dark:text-zinc-200'
                      }`}
                    />

                    {commentError && (
                      <p className="text-[11px] text-rose-600 dark:text-red-400 mt-1">{commentError}</p>
                    )}

                    {/* Bottom Actions Bar */}
                    <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-zinc-800/60 mt-1">
                      <div className="flex items-center gap-2">
                        {/* Hidden file input for paperclip */}
                        <input
                          ref={commentFileInputRef}
                          type="file"
                          multiple
                          onChange={handleCommentFileSelect}
                          className="hidden"
                        />
                        <button
                          type="button"
                          onClick={() => commentFileInputRef.current?.click()}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-white hover:bg-blue-50 text-slate-700 hover:text-blue-600 border border-slate-200 dark:bg-white/5 dark:text-slate-300 dark:border-white/10 dark:hover:bg-white/10 transition-colors cursor-pointer"
                          title="Attach files or screenshots"
                        >
                          <Paperclip className="w-3.5 h-3.5 text-slate-500 dark:text-zinc-400" />
                          <span>Attach File</span>
                        </button>

                        <div className="flex items-center gap-1.5 text-[10px] text-slate-500 dark:text-zinc-500 hidden sm:flex">
                          <span>Ctrl+Enter</span>
                          <span>•</span>
                          <span>Ctrl+V paste</span>
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={isSubmittingComment || (!newComment.trim() && stagedFiles.length === 0)}
                        onClick={() => handlePostComment()}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold shadow-sm transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50 ${
                          isInternalComment && isStaffOrAdmin
                            ? 'bg-amber-600 hover:bg-amber-500 text-white dark:text-amber-950 font-bold'
                            : 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-600/20'
                        }`}
                      >
                        {isSubmittingComment ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Send className="w-3.5 h-3.5" />
                        )}
                        <span>
                          {isInternalComment && isStaffOrAdmin ? 'Post Internal Note' : 'Send'}
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Ticket Resolution & Hand-off Intercept Modal */}
        {isHandoffModalOpen && task && (
          <TicketResolutionHandoffModal
            isOpen={isHandoffModalOpen}
            onClose={() => setIsHandoffModalOpen(false)}
            task={{
              id: task.id,
              taskKey: task.taskKey,
              title: task.title,
              spaceId: task.spaceId,
              space: task.space,
              listId: task.listId,
              list: task.list,
            }}
            currentUser={currentUser}
            onSuccess={async (updatedTask, action) => {
              setIsHandoffModalOpen(false);
              await loadTaskDetails(task.id);
              onTaskUpdated?.(updatedTask);
            }}
          />
        )}

        {/* Fullscreen Lightbox Modal */}
        {lightboxImage && (
          <div
            className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-sm flex flex-col items-center justify-center p-4 animate-in fade-in duration-150"
            onClick={() => setLightboxImage(null)}
          >
            <div
              className="relative max-w-4xl w-full max-h-[88vh] flex flex-col bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/80 bg-zinc-950/60">
                <span className="text-xs font-mono text-zinc-200 truncate max-w-lg">{lightboxImage.name}</span>
                <div className="flex items-center gap-2">
                  <a
                    href={lightboxImage.url}
                    download={lightboxImage.name}
                    className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded transition-colors"
                    title="Download image"
                  >
                    <Download className="w-4 h-4" />
                  </a>
                  <button
                    type="button"
                    onClick={() => setLightboxImage(null)}
                    className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded transition-colors cursor-pointer"
                    title="Close (Esc)"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="overflow-auto max-h-[78vh] p-4 flex items-center justify-center bg-black/40">
                <img
                  src={lightboxImage.url}
                  alt={lightboxImage.name}
                  className="max-w-full max-h-[72vh] object-contain rounded"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

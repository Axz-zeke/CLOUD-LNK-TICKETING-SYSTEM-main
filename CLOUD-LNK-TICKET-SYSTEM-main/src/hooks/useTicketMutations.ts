'use client';

import { useState, useCallback, useRef } from 'react';
import { toast } from '@/components/ui/toast';
import { tasksApi } from '@/lib/api';
import type { TaskRecord } from '@/components/views/ListView';
import { useOptionalWorkspace, type TaskStatusItem, type SpaceItem } from '@/context/workspace-context';
import { getStatusCategory, CANONICAL_STATUSES } from '@/lib/status-utils';

interface UseTicketMutationsProps {
  tasks: TaskRecord[];
  setTasks: React.Dispatch<React.SetStateAction<TaskRecord[]>>;
  availableStatuses: TaskStatusItem[];
  spaces?: SpaceItem[];
  currentUserId?: string;
  refreshSpaces?: () => Promise<void>;
}

export function useTicketMutations({
  tasks,
  setTasks,
  availableStatuses,
  spaces,
  currentUserId,
  refreshSpaces,
}: UseTicketMutationsProps) {
  const workspaceCtx = useOptionalWorkspace();
  const [mutatingTaskIds, setMutatingTaskIds] = useState<Record<string, boolean>>({});
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  const setTaskMutating = useCallback((taskId: string, isMutating: boolean) => {
    setMutatingTaskIds((prev) => {
      const next = { ...prev };
      if (isMutating) {
        next[taskId] = true;
      } else {
        delete next[taskId];
      }
      return next;
    });
  }, []);

  /**
   * Status mutation with snapshot rollback & error toast handling
   */
  const handleUpdateStatus = useCallback(
    async (taskId: string, newStatusId: string) => {
      const currentList = tasksRef.current;
      const previousTask = currentList.find((t) => t.id === taskId);
      if (!previousTask) return;
      const previousStatus = previousTask.status;

      if (previousStatus.id === newStatusId) return;

      // 1. Resolve target status object accurately across availableStatuses, spaces, and canonical
      let targetStatusObj: TaskStatusItem | undefined = availableStatuses.find(
        (s) => s.id === newStatusId
      );

      if (!targetStatusObj && spaces) {
        for (const sp of spaces) {
          const st = sp.statuses?.find((s) => s.id === newStatusId);
          if (st) {
            targetStatusObj = st;
            break;
          }
        }
      }

      // If newStatusId is canonical (st-pend, st-prog, etc.), resolve for this ticket's space
      if (newStatusId.startsWith('st-') && spaces) {
        const canonical = CANONICAL_STATUSES.find((s) => s.id === newStatusId);
        const targetCategory = getStatusCategory(canonical || { name: newStatusId });
        const taskSpaceId = (previousTask as any).spaceId || previousTask.space?.id;
        const taskSpace = spaces.find((s) => s.id === taskSpaceId);
        const matchingSpaceStatus = taskSpace?.statuses?.find(
          (st) => getStatusCategory(st) === targetCategory
        );
        if (matchingSpaceStatus) {
          targetStatusObj = matchingSpaceStatus;
        }
      }

      if (!targetStatusObj) {
        targetStatusObj = CANONICAL_STATUSES.find((s) => s.id === newStatusId) || {
          id: newStatusId,
          name: newStatusId,
          color: previousStatus.color || '#3B82F6',
          order: 0,
          isCompleted: false,
          isClosed: false,
          category: getStatusCategory({ name: newStatusId }),
        };
      }

      const targetCategory =
        targetStatusObj.category || getStatusCategory(targetStatusObj);

      // Unified Optimistic Status Handler delegation (updates views & sidebar counts reactively in 0ms)
      if (workspaceCtx?.updateTaskStatusOptimistic) {
        await workspaceCtx.updateTaskStatusOptimistic(taskId, targetStatusObj.id, targetStatusObj);
        return;
      }

      // Lock mutations to prevent background polling from snapping card back
      workspaceCtx?.beginTaskMutation();

      // Snapshot-based optimistic update: update both statusId AND status (including category and normalized name)
      const taskUpdater = (t: TaskRecord) =>
        t.id === taskId
          ? {
            ...t,
            statusId: targetStatusObj!.id,
            status: {
              ...t.status,
              id: targetStatusObj!.id,
              name: targetStatusObj!.name,
              color: targetStatusObj!.color || t.status?.color || '#3B82F6',
              order: targetStatusObj!.order ?? t.status?.order ?? 0,
              isCompleted: Boolean(targetStatusObj!.isCompleted),
              isClosed: Boolean(targetStatusObj!.isClosed),
              category: targetCategory,
            },
          }
          : t;

      setTasks((prev) => prev.map(taskUpdater));
      workspaceCtx?.optimisticUpdateTask(taskId, taskUpdater);

      setTaskMutating(taskId, true);

      try {
        const res = await tasksApi.updateStatus(taskId, targetStatusObj.id);

        if (!res.ok) {
          // Immediately rollback
          setTasks((prev) =>
            prev.map((t) => (t.id === taskId ? previousTask : t))
          );
          workspaceCtx?.optimisticUpdateTask(taskId, () => previousTask);

          if (res.status === 403) {
            toast.error(
              res.error || 'Permission Denied: Only department staff or Superadmins can modify this ticket.',
              'Clearance Denied'
            );
          } else if (res.status === 401) {
            toast.error('Session expired. Redirecting to login...', 'Unauthorized');
            setTimeout(() => {
              window.location.href = '/login';
            }, 1500);
          } else {
            toast.error(
              res.error || 'Failed to update ticket status. Changes rolled back.',
              'Update Failed'
            );
          }
          return;
        }

        // Commit server task state
        if (res.data?.task) {
          const serverTask = res.data.task;
          const serverUpdater = (t: TaskRecord) => (t.id === taskId ? { ...t, ...serverTask } : t);
          setTasks((prev) => prev.map(serverUpdater));
          workspaceCtx?.optimisticUpdateTask(taskId, serverUpdater);
        }
        if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
          try {
            const bc = new BroadcastChannel('ticket_system_realtime');
            bc.postMessage({
              type: 'TASK_MUTATED',
              taskId,
              newStatusId: targetStatusObj.id,
              task: res.data?.task,
            });
            bc.close();
          } catch { }
        }
        if (refreshSpaces) {
          await refreshSpaces();
        }
      } catch (err: any) {
        // Rollback on network / unhandled exception
        console.error('Error updating task status:', err);
        setTasks((prev) =>
          prev.map((t) => (t.id === taskId ? previousTask : t))
        );
        workspaceCtx?.optimisticUpdateTask(taskId, () => previousTask);
        toast.error(err?.message || 'Network error updating ticket status.', 'Network Error');
      } finally {
        setTaskMutating(taskId, false);
        workspaceCtx?.endTaskMutation();
      }
    },
    [availableStatuses, spaces, refreshSpaces, setTasks, setTaskMutating, workspaceCtx]
  );

  /**
   * Priority mutation with snapshot rollback & error toast handling
   */
  const handleUpdatePriority = useCallback(
    async (taskId: string, newPriority: string) => {
      const currentList = tasksRef.current;
      const previousTask = currentList.find((t) => t.id === taskId);
      if (!previousTask || previousTask.priority === newPriority) return;

      // Optimistic update
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId ? { ...t, priority: newPriority as any } : t
        )
      );

      setTaskMutating(taskId, true);

      try {
        const res = await tasksApi.updatePriority(taskId, newPriority);

        if (!res.ok) {
          setTasks((prev) =>
            prev.map((t) => (t.id === taskId ? previousTask : t))
          );
          if (res.status === 403) {
            toast.error(
              res.error || 'Permission Denied: Only department staff or Superadmins can modify this ticket.',
              'Clearance Denied'
            );
          } else {
            toast.error(
              res.error || 'Failed to update priority. Changes rolled back.',
              'Update Failed'
            );
          }
          return;
        }

        if (res.data?.task) {
          setTasks((prev) =>
            prev.map((t) => (t.id === taskId ? { ...t, ...res.data!.task } : t))
          );
        }
      } catch (err: any) {
        console.error('Error updating task priority:', err);
        setTasks((prev) =>
          prev.map((t) => (t.id === taskId ? previousTask : t))
        );
        toast.error(err?.message || 'Network error updating priority.', 'Network Error');
      } finally {
        setTaskMutating(taskId, false);
      }
    },
    [setTasks, setTaskMutating]
  );

  /**
   * Assign-to-me mutation with snapshot rollback & error toast handling
   */
  const handleAssignToMe = useCallback(
    async (taskId: string) => {
      if (!currentUserId) return;
      const currentList = tasksRef.current;
      const previousTask = currentList.find((t) => t.id === taskId);
      if (!previousTask) return;

      setTaskMutating(taskId, true);

      try {
        const res = await tasksApi.assignToUser(taskId, currentUserId);

        if (!res.ok) {
          if (res.status === 403) {
            toast.error(
              res.error || 'Permission Denied: Only department staff or Superadmins can modify this ticket.',
              'Clearance Denied'
            );
          } else {
            toast.error(res.error || 'Failed to assign ticket.', 'Update Failed');
          }
          return;
        }

        if (res.data?.task) {
          setTasks((prev) =>
            prev.map((t) => (t.id === taskId ? { ...t, ...res.data!.task } : t))
          );
        }
        toast.success('Ticket assigned to you successfully.');
      } catch (err: any) {
        console.error('Error assigning task:', err);
        toast.error(err?.message || 'Network error assigning ticket.', 'Network Error');
      } finally {
        setTaskMutating(taskId, false);
      }
    },
    [currentUserId, setTasks, setTaskMutating]
  );

  return {
    handleUpdateStatus,
    handleUpdatePriority,
    handleAssignToMe,
    mutatingTaskIds,
    isTaskMutating: (taskId: string) => Boolean(mutatingTaskIds[taskId]),
  };
}

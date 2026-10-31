'use client';

import { useState, useEffect, useCallback } from 'react';

interface UseBoardDragDropProps {
  onMoveToStatus: (taskId: string, targetStatus: any) => void;
}

export function useBoardDragDrop({ onMoveToStatus }: UseBoardDragDropProps) {
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverStatusId, setDragOverStatusId] = useState<string | null>(null);

  // Global drag listener to guarantee draggedTaskId & dragOverStatusId are reset even if dropped outside or cancelled
  useEffect(() => {
    const handleGlobalDragEnd = () => {
      setDraggedTaskId(null);
      setDragOverStatusId(null);
    };

    window.addEventListener('dragend', handleGlobalDragEnd);
    window.addEventListener('drop', handleGlobalDragEnd);

    return () => {
      window.removeEventListener('dragend', handleGlobalDragEnd);
      window.removeEventListener('drop', handleGlobalDragEnd);
    };
  }, []);

  const handleCardDragStart = useCallback((taskId: string, e: React.DragEvent) => {
    e.dataTransfer.setData('text/plain', taskId);
    e.dataTransfer.effectAllowed = 'move';
    setDraggedTaskId(taskId);
  }, []);

  const handleCardDragEnd = useCallback(() => {
    setDraggedTaskId(null);
    setDragOverStatusId(null);
  }, []);

  const handleColumnDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleColumnDragEnter = useCallback((statusId: string, e: React.DragEvent) => {
    e.preventDefault();
    setDragOverStatusId(statusId);
  }, []);

  const handleColumnDragLeave = useCallback(
    (statusId: string, e: React.DragEvent) => {
      if (e.currentTarget.contains(e.relatedTarget as Node)) return;
      if (dragOverStatusId === statusId) {
        setDragOverStatusId(null);
      }
    },
    [dragOverStatusId]
  );

  const handleColumnDrop = useCallback(
    (status: any, e: React.DragEvent) => {
      e.preventDefault();
      setDragOverStatusId(null);
      const taskId = e.dataTransfer.getData('text/plain') || draggedTaskId;
      setDraggedTaskId(null);
      if (taskId) {
        onMoveToStatus(taskId, status);
      }
    },
    [draggedTaskId, onMoveToStatus]
  );

  const resetDragState = useCallback(() => {
    setDraggedTaskId(null);
    setDragOverStatusId(null);
  }, []);

  return {
    draggedTaskId,
    dragOverStatusId,
    handleCardDragStart,
    handleCardDragEnd,
    handleColumnDragOver,
    handleColumnDragEnter,
    handleColumnDragLeave,
    handleColumnDrop,
    resetDragState,
  };
}

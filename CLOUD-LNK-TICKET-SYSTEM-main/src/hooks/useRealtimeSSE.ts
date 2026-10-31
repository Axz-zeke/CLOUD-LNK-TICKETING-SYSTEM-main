'use client';

import { useEffect, useRef } from 'react';
import { useWorkspace } from '@/context/workspace-context';

export type RealTimeEventCallback = (event: any) => void;

interface UseRealtimeSSEOptions {
  eventTypes?: string[];
  taskId?: string;
  spaceId?: string;
}

export function useRealtimeSSE(
  callback: RealTimeEventCallback,
  options: UseRealtimeSSEOptions = {}
) {
  const { subscribeToRealTimeEvents } = useWorkspace();
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    let isMounted = true;

    const unsubscribe = subscribeToRealTimeEvents((event: any) => {
      if (!isMounted || !event || !event.type) return;

      const opts = optionsRef.current;

      // Filter by event type if specified
      if (opts.eventTypes && opts.eventTypes.length > 0) {
        if (!opts.eventTypes.includes(event.type)) {
          return;
        }
      }

      // Filter by task ID if specified
      if (opts.taskId) {
        const matchesTask =
          event.taskId === opts.taskId ||
          event.task?.id === opts.taskId;
        if (!matchesTask) return;
      }

      // Filter by space ID if specified
      if (opts.spaceId) {
        const matchesSpace =
          event.spaceId === opts.spaceId ||
          event.task?.spaceId === opts.spaceId;
        if (!matchesSpace) return;
      }

      try {
        callbackRef.current(event);
      } catch (err) {
        console.error('[useRealtimeSSE] Error in event callback:', err);
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [subscribeToRealTimeEvents]);
}

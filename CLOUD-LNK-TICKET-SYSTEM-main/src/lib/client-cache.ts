/**
 * Lightweight Client-Side In-Memory Cache & In-Flight Promise Deduplicator
 * 
 * Provides instant 0ms rendering for repeated view switches (stale-while-revalidate)
 * and eliminates duplicate concurrent HTTP network requests across React components.
 */

interface ClientCacheEntry<T> {
  data: T;
  timestamp: number;
}

const clientCache = new Map<string, ClientCacheEntry<any>>();
const inFlightPromises = new Map<string, Promise<any>>();

/**
 * Synchronously retrieves an entry from the client-side in-memory cache in 0ms.
 * If ttlMs is provided, enforces freshness; if omitted, returns any cached value for instant pre-hydration.
 */
export function getClientCache<T = any>(key: string, ttlMs?: number): T | null {
  const entry = clientCache.get(key);
  if (!entry) return null;
  if (typeof ttlMs === 'number' && Date.now() - entry.timestamp > ttlMs) {
    return null;
  }
  return entry.data as T;
}

/**
 * Synchronously stores a value in the client-side in-memory cache.
 */
export function setClientCache<T = any>(key: string, data: T, _ttlMs?: number): void {
  clientCache.set(key, { data, timestamp: Date.now() });
}

export async function fetchWithClientCache<T>(
  url: string,
  options?: {
    ttlMs?: number;
    forceFresh?: boolean;
    onCachedData?: (data: T) => void;
  }
): Promise<T> {
  const ttl = options?.ttlMs ?? 30_000; // 30 seconds default TTL
  const now = Date.now();

  const cached = clientCache.get(url);

  // If fresh cache exists and forceFresh is not set, return immediately
  if (cached && now - cached.timestamp < ttl && !options?.forceFresh) {
    if (options?.onCachedData) {
      options.onCachedData(cached.data);
    }
    return cached.data;
  }

  // Stale-while-revalidate: if stale data exists, serve it immediately to eliminate loading flicker
  if (cached && options?.onCachedData) {
    options.onCachedData(cached.data);
  }

  // If identical request is already traveling on the network (and not forcing fresh), reuse the same promise
  if (!options?.forceFresh && inFlightPromises.has(url)) {
    return inFlightPromises.get(url)!;
  }

  const promise = (async () => {
    try {
      const fetchUrl = options?.forceFresh
        ? `${url}${url.includes('?') ? '&' : '?'}fresh=1`
        : url;
      const res = await fetch(
        fetchUrl,
        options?.forceFresh ? { cache: 'no-store' } : undefined
      );
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      const data = await res.json();
      clientCache.set(url, { data, timestamp: Date.now() });
      return data;
    } finally {
      inFlightPromises.delete(url);
    }
  })();

  inFlightPromises.set(url, promise);
  return promise;
}

/**
 * Invalidates client-side cached entries matching a prefix.
 */
export function invalidateClientCachePrefix(prefix: string): void {
  for (const key of Array.from(clientCache.keys())) {
    if (key.startsWith(prefix)) {
      clientCache.delete(key);
    }
  }
}

/**
 * Invalidates client-side cached entries for tasks.
 */
export function invalidateClientTasksCache(): void {
  invalidateClientCachePrefix('/api/tasks');
}

/**
 * Invalidates client-side cached entries for spaces.
 */
export function invalidateClientSpacesCache(): void {
  invalidateClientCachePrefix('/api/spaces');
}

/**
 * Optimistically updates a task in-place inside all client-side cached /api/tasks entries.
 * Eliminates rubber-banding by keeping cached query results consistent with user actions.
 */
export function updateClientCachedTask(taskId: string, updater: (task: any) => any): void {
  const detailKey = `task:detail:${taskId}`;
  const detailEntry = clientCache.get(detailKey);
  if (detailEntry?.data) {
    detailEntry.data = updater(detailEntry.data);
    detailEntry.timestamp = Date.now();
  }

  for (const [key, entry] of clientCache.entries()) {
    if (key.startsWith('/api/tasks')) {
      if (entry?.data && Array.isArray(entry.data.tasks)) {
        entry.data.tasks = entry.data.tasks.map((t: any) =>
          t.id === taskId ? updater(t) : t
        );
      } else if (Array.isArray(entry?.data)) {
        entry.data = entry.data.map((t: any) =>
          t.id === taskId ? updater(t) : t
        );
      }
    }
  }
}

/**
 * Optimistically prepends a newly created task into all relevant client-side cached /api/tasks entries.
 */
export function prependClientCachedTask(newTask: any): void {
  if (newTask?.id) {
    setClientCache(`task:detail:${newTask.id}`, newTask);
  }
  for (const [key, entry] of clientCache.entries()) {
    if (key.startsWith('/api/tasks')) {
      if (entry?.data && Array.isArray(entry.data.tasks)) {
        const filtered = entry.data.tasks.filter((t: any) => t.id !== newTask.id);
        entry.data.tasks = [newTask, ...filtered];
      } else if (Array.isArray(entry?.data)) {
        const filtered = entry.data.filter((t: any) => t.id !== newTask.id);
        entry.data = [newTask, ...filtered];
      }
    }
  }
}

/**
 * Removes a task from all client-side cached /api/tasks entries.
 */
export function removeClientCachedTask(taskId: string): void {
  clientCache.delete(`task:detail:${taskId}`);
  for (const [key, entry] of clientCache.entries()) {
    if (key.startsWith('/api/tasks')) {
      if (entry?.data && Array.isArray(entry.data.tasks)) {
        entry.data.tasks = entry.data.tasks.filter((t: any) => t.id !== taskId);
      } else if (Array.isArray(entry?.data)) {
        entry.data = entry.data.filter((t: any) => t.id !== taskId);
      }
    }
  }
}

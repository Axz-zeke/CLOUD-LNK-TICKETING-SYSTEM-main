/**
 * High-Speed Server-Side In-Memory Cache with Stale-While-Revalidate (SWR)
 * and In-Flight Promise Deduplication
 * 
 * Attaches to globalThis to survive Next.js dev server hot module reloading.
 * Eliminates redundant network round-trips to Supabase PostgreSQL for high-frequency
 * read paths (auth session checks, spaces, user preferences, and tasks).
 */

export interface CacheEntry<T> {
  value: T;
  freshUntil: number;
  staleUntil: number;
}

export interface GetOrSetCacheOptions {
  swrMs?: number; // Time window during which stale data can be served while refreshing (default: 300,000ms = 5 mins)
  forceFresh?: boolean;
}

interface ServerCacheStore {
  entries: Map<string, CacheEntry<any>>;
  inFlightPromises: Map<string, Promise<any>>;
  invalidatedTimestamps: Map<string, number>;
  hits: number;
  swrHits: number;
  misses: number;
  dedupedCount: number;
}

const GLOBAL_CACHE_KEY = '__lnk_server_cache_v2__';
const IS_VERCEL_SERVERLESS = Boolean(process.env.VERCEL);

/**
 * Dynamic keys that mutate across user actions and must not be held stale
 * across isolated Vercel serverless instances.
 */
function isDynamicCrossInstanceKey(key: string): boolean {
  return (
    key.startsWith('tasks:') ||
    key.startsWith('task:') ||
    key.startsWith('spaces:') ||
    key.startsWith('notifications:')
  );
}

const cacheStore: ServerCacheStore =
  (globalThis as any)[GLOBAL_CACHE_KEY] ||
  ((globalThis as any)[GLOBAL_CACHE_KEY] = {
    entries: new Map(),
    inFlightPromises: new Map(),
    invalidatedTimestamps: new Map(),
    hits: 0,
    swrHits: 0,
    misses: 0,
    dedupedCount: 0,
  });

// Defensive guarantee for hot-module-reloaded instances
if (!cacheStore.invalidatedTimestamps) {
  cacheStore.invalidatedTimestamps = new Map();
}

/**
 * Checks whether a key (or any of its matching prefixes) was explicitly
 * invalidated since a given request was initiated.
 */
function isKeyOrPrefixInvalidatedSince(key: string, requestTime: number): boolean {
  const directTimestamp = cacheStore.invalidatedTimestamps.get(key);
  if (directTimestamp !== undefined && directTimestamp >= requestTime) {
    return true;
  }
  for (const [prefix, timestamp] of cacheStore.invalidatedTimestamps.entries()) {
    if (key.startsWith(prefix) && timestamp >= requestTime) {
      return true;
    }
  }
  return false;
}

/**
 * Gets a cached value or executes the fetcher with in-flight deduplication and SWR.
 * 
 * 1. Fresh hit (now < freshUntil): Returns immediately in < 0.1ms.
 * 2. Stale hit (freshUntil <= now < staleUntil): Returns cached data in < 0.1ms AND
 *    triggers an asynchronous background refresh without blocking the response!
 * 3. Cache miss: Executes fetcher with in-flight deduplication so concurrent requests
 *    share the identical promise instead of duplicate database queries.
 */
export async function getOrSetCache<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
  options?: GetOrSetCacheOptions
): Promise<T> {
  const now = Date.now();
  const requestTime = now;
  const isDynamicOnVercel = IS_VERCEL_SERVERLESS && isDynamicCrossInstanceKey(key);
  const effectiveTtlMs = isDynamicOnVercel ? Math.min(ttlMs, 2_000) : ttlMs;
  const swrMs = isDynamicOnVercel ? 0 : (options?.swrMs ?? 300_000); // Disable stale SWR across isolated Vercel lambdas

  const existing = cacheStore.entries.get(key);

  // 1. Fresh Cache Hit (< 0.1ms)
  if (existing && existing.freshUntil > now && !options?.forceFresh) {
    cacheStore.hits++;
    return existing.value as T;
  }

  // 2. Stale-While-Revalidate Hit (< 0.1ms return + background refresh)
  if (existing && existing.staleUntil > now && !options?.forceFresh && swrMs > 0) {
    cacheStore.swrHits++;

    // Launch background revalidation if not already in-flight
    if (!cacheStore.inFlightPromises.has(key)) {
      const bgPromise = (async () => {
        try {
          const freshResult = await fetcher();
          // Guard: Do not write back if invalidated while fetcher was executing!
          if (!isKeyOrPrefixInvalidatedSince(key, requestTime)) {
            setCache(key, freshResult, effectiveTtlMs, swrMs);
          }
          return freshResult;
        } catch (bgErr) {
          console.warn(`[ServerCache] Background SWR refresh failed for '${key}':`, bgErr);
        } finally {
          cacheStore.inFlightPromises.delete(key);
        }
      })();
      cacheStore.inFlightPromises.set(key, bgPromise);
    }

    return existing.value as T;
  }

  // 3. Check if there's already an active in-flight promise for this exact key (unless forceFresh is explicitly requested)
  if (!options?.forceFresh) {
    const activePromise = cacheStore.inFlightPromises.get(key);
    if (activePromise) {
      cacheStore.dedupedCount++;
      return activePromise as Promise<T>;
    }
  }

  // 4. Cold Cache Miss (or explicit forceFresh): launch fetcher and register in-flight tracker
  cacheStore.misses++;
  const fetchPromise = (async () => {
    try {
      const result = await fetcher();
      // Guard: Do not write back if invalidated while fetcher was executing!
      if (!isKeyOrPrefixInvalidatedSince(key, requestTime)) {
        setCache(key, result, effectiveTtlMs, swrMs);
      }
      return result;
    } finally {
      cacheStore.inFlightPromises.delete(key);
    }
  })();

  cacheStore.inFlightPromises.set(key, fetchPromise);
  return fetchPromise;
}

/**
 * Manually primes or updates a cache key in server memory.
 */
export function setCache<T>(
  key: string,
  value: T,
  ttlMs: number,
  swrMs = 300_000
): void {
  const now = Date.now();
  const isDynamicOnVercel = IS_VERCEL_SERVERLESS && isDynamicCrossInstanceKey(key);
  const effectiveTtlMs = isDynamicOnVercel ? Math.min(ttlMs, 2_000) : ttlMs;
  const effectiveSwrMs = isDynamicOnVercel ? 0 : swrMs;
  cacheStore.entries.set(key, {
    value,
    freshUntil: now + effectiveTtlMs,
    staleUntil: now + effectiveTtlMs + effectiveSwrMs,
  });
}

/**
 * Peeks at a cached value without triggering fetcher or registering misses.
 */
export function peekCache<T>(key: string): T | null {
  const existing = cacheStore.entries.get(key);
  if (!existing) return null;
  if (existing.staleUntil < Date.now()) {
    cacheStore.entries.delete(key);
    return null;
  }
  return existing.value as T;
}

/**
 * Invalidates a single specific cache key.
 */
export function invalidateCacheKey(key: string): void {
  const now = Date.now();
  cacheStore.invalidatedTimestamps.set(key, now);
  cacheStore.entries.delete(key);
  cacheStore.inFlightPromises.delete(key);
}

/**
 * Invalidates all cache entries starting with a specific prefix (e.g. "spaces:", "tasks:").
 */
export function invalidateCachePrefix(prefix: string): void {
  const now = Date.now();
  cacheStore.invalidatedTimestamps.set(prefix, now);
  for (const key of Array.from(cacheStore.entries.keys())) {
    if (key.startsWith(prefix)) {
      cacheStore.entries.delete(key);
    }
  }
  for (const key of Array.from(cacheStore.inFlightPromises.keys())) {
    if (key.startsWith(prefix)) {
      cacheStore.inFlightPromises.delete(key);
    }
  }
}

/**
 * Clears the entire server memory cache.
 */
export function clearServerCache(): void {
  cacheStore.entries.clear();
  cacheStore.inFlightPromises.clear();
  cacheStore.invalidatedTimestamps.clear();
  cacheStore.hits = 0;
  cacheStore.swrHits = 0;
  cacheStore.misses = 0;
  cacheStore.dedupedCount = 0;
}

/**
 * Returns diagnostic statistics of the in-memory cache.
 */
export function getCacheStats() {
  const now = Date.now();
  let freshCount = 0;
  let staleCount = 0;
  for (const [, entry] of cacheStore.entries) {
    if (entry.freshUntil > now) {
      freshCount++;
    } else if (entry.staleUntil > now) {
      staleCount++;
    }
  }

  return {
    freshEntries: freshCount,
    staleEntries: staleCount,
    totalEntries: cacheStore.entries.size,
    inFlightPromises: cacheStore.inFlightPromises.size,
    hits: cacheStore.hits,
    swrHits: cacheStore.swrHits,
    misses: cacheStore.misses,
    dedupedRequests: cacheStore.dedupedCount,
  };
}

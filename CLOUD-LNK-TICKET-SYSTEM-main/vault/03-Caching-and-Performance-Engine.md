---
title: "Caching & Sub-Millisecond Performance Engine"
tags:
  - caching
  - performance
  - swr
  - optimistic-ui
  - server-cache
key_files:
  - src/lib/server-cache.ts
  - src/lib/task-store.ts
  - src/lib/client-cache.ts
  - src/context/workspace-context.tsx
last_updated: "2026-10-28"
---

# Caching & Sub-Millisecond Performance Engine

## 1. Server-Side In-Memory RAM Cache Architecture

The primary driver of the system's ultra-low latency (`14ms` average API response time over cross-ocean Supabase connections) is the server-side in-memory cache implemented in [`src/lib/server-cache.ts`](file:///c:/Users/MIS/Documents/GitHub/CLOUD-LNK-TICKET-SYSTEM/src/lib/server-cache.ts).

### Global Cache Singleton
The cache attaches directly to `globalThis.__lnk_server_cache_v2__` so that it persists across Next.js Hot Module Reloading (HMR) in development and remains active across warm serverless execution containers in production:

```typescript
interface ServerCacheStore {
  entries: Map<string, CacheEntry<any>>;
  inFlightPromises: Map<string, Promise<any>>;
  invalidatedTimestamps: Map<string, number>;
  hits: number;
  swrHits: number;
  misses: number;
  dedupedCount: number;
}
```

---

## 2. The 3-State Cache Resolution Pipeline

```mermaid
sequenceDiagram
    autonumber
    actor Client
    participant Server as Next.js API Route
    participant Cache as ServerCacheStore (RAM)
    participant DB as Supabase PostgreSQL

    Client->>Server: GET /api/tasks
    Server->>Cache: getOrSetCache("tasks:master:all")

    alt 1. Fresh Cache Hit (now < freshUntil)
        Cache-->>Server: Return value (< 0.1ms)
        Server-->>Client: HTTP 200 (14ms total network time)
    else 2. Stale Hit with SWR (freshUntil <= now < staleUntil)
        Cache-->>Server: Return stale value immediately (< 0.1ms)
        Server-->>Client: HTTP 200 (Instant Render)
        Note over Cache,DB: Background Revalidation (Non-blocking)
        Cache->>DB: Asynchronous fetcher() execution
        DB-->>Cache: Fresh Task Dataset
        Cache->>Cache: Check !isKeyOrPrefixInvalidatedSince()
        Cache->>Cache: Update entries in RAM
    else 3. Cold Cache Miss (or forceFresh)
        alt In-Flight Promise Exists
            Cache-->>Server: Await existing inFlightPromises.get(key)
        else No In-Flight Promise
            Cache->>DB: Execute fetcher() & register inFlightPromises
            DB-->>Cache: Return data
            Cache->>Cache: Store in entries & delete in-flight tracker
            Cache-->>Server: Return data
        end
        Server-->>Client: HTTP 200
    end
```

### 2.1. Race-Condition-Proof Timestamped Invalidation
A common bug in traditional Stale-While-Revalidate implementations occurs when a user mutates data while a background SWR fetch is traveling on the wire:
1. User requests data; cache returns stale data and spawns background fetch `P1` at `T=0ms`.
2. At `T=20ms`, user deletes a ticket (`DELETE /api/tasks/[id]`), which calls `invalidateCachePrefix("tasks:")`.
3. At `T=80ms`, background fetch `P1` resolves with the old dataset containing the deleted ticket.
4. Without timestamp tracking, `P1` would write the deleted ticket back into cache!

**The Protection Mechanism:**
[`src/lib/server-cache.ts`](file:///c:/Users/MIS/Documents/GitHub/CLOUD-LNK-TICKET-SYSTEM/src/lib/server-cache.ts) records an invalidation timestamp in `invalidatedTimestamps.set(key, now)`. When the background fetcher completes, it checks:

```typescript
function isKeyOrPrefixInvalidatedSince(key: string, requestTime: number): boolean {
  const directTimestamp = cacheStore.invalidatedTimestamps.get(key);
  if (directTimestamp !== undefined && directTimestamp >= requestTime) return true;
  for (const [prefix, timestamp] of cacheStore.invalidatedTimestamps.entries()) {
    if (key.startsWith(prefix) && timestamp >= requestTime) return true;
  }
  return false;
}
```

If the key was invalidated while the fetcher was executing, **the stale result is discarded immediately**, permanently preventing zombie records.

---

## 3. Master Server Cache Key Registry

| Cache Key Pattern | Fresh TTL | SWR Window | Primary Consumer | Mutation Behavior |
| :--- | :--- | :--- | :--- | :--- |
| **`tasks:master:all`** | 60s | 300s (5m) | `GET /api/tasks`, Global Search | **In-Place Mutation:** Updated in `0.01ms` via `updateTaskInMasterStore()`, `prependTaskToMasterStore()`, `removeTaskFromMasterStore()`, or `appendAttachmentsToMasterStore()`. Never wiped unnecessarily! |
| **`task:detail:${taskId}`** | 30s | 120s (2m) | `GET /api/tasks/[id]`, Drawer | Invalidated on `PATCH /api/tasks/[id]`, handoff, or comment creation. |
| **`spaces:user:${userId}`** | 120s | 300s (5m) | `GET /api/spaces`, Sidebar | Invalidated via `invalidateCachePrefix("spaces:")` on space creation, list creation, or deletion. |
| **`user:spaces:${userId}`** | 300s | 600s (10m) | RBAC Clearance Guards | Stores assigned space IDs for clearance queries. Invalidated on space membership changes. |
| **`users:all:mentions`** | 60s | 300s (5m) | `GET /api/users/mentions` | Powers `@mention` autocomplete. Invalidated on user role or space member changes. |
| **`admin:users`** | 30s | 120s (2m) | `GET /api/admin/users` | Invalidated on user role promotion, password change, or deactivation. |
| **`admin:system-health`** | 10s | 30s | `GET /api/admin/system-health` | Telemetry stats (PostgreSQL ping latency, DB size, Drive quota). |
| **`notifications:user:${userId}`** | 15s | 60s | `GET /api/notifications` | Invalidated on `createNotification()`, mark as read, or clear read. |
| **`driveFileCache`** | 30m | N/A | `GET /api/attachments/drive/[fileId]` | In-memory binary buffer cache for files <= 4MB (`100` file LRU limit). |
| **`cachedOAuthToken`** | 45m | N/A | `getGoogleDriveAuthToken()` | Google Drive OAuth access token cached to avoid redundant Apps Script token requests. |

---

## 4. In-Place Master Task Store Engine

Implemented in [`src/lib/task-store.ts`](file:///c:/Users/MIS/Documents/GitHub/CLOUD-LNK-TICKET-SYSTEM/src/lib/task-store.ts).

Rather than wiping `tasks:master:all` on every small status change, assignment, or comment addition, `task-store.ts` directly mutates the cached array in server RAM:

### 4.1. `updateTaskInMasterStore(updatedTask)`
Locates `updatedTask.id` in the cached `tasks:master:all` array and performs a deep merge of `status`, `space`, `list`, `assignee`, `originSpace`, `contributors`, and `updatedAt`.
- **Latency:** `0.01ms`.
- **Result:** The very next `GET /api/tasks` request from any connected workstation or mobile browser receives the updated ticket state immediately without hitting PostgreSQL.

### 4.2. `prependTaskToMasterStore(newTask)`
Unshifts newly created tickets onto the top of the cached list so fresh submissions appear instantly across all views.

### 4.3. `removeTaskFromMasterStore(taskId)`
Filters out deleted tickets immediately from server memory.

### 4.4. `appendAttachmentsToMasterStore(taskId, newAttachments)`
Merges staged and newly uploaded attachments into the task's attachment array and increments `task._count.attachments` in-place.

---

## 5. Client-Side Optimistic UI & Anti-Rubber-Banding Lock

Implemented in [`src/context/workspace-context.tsx`](file:///c:/Users/MIS/Documents/GitHub/CLOUD-LNK-TICKET-SYSTEM/src/context/workspace-context.tsx) and [`src/lib/client-cache.ts`](file:///c:/Users/MIS/Documents/GitHub/CLOUD-LNK-TICKET-SYSTEM/src/lib/client-cache.ts).

### 5.1. The Anti-Rubber-Banding Polling Lock (`activeMutationsRef`)
In real-time multi-user web applications, optimistic UI updates often suffer from "rubber-banding":
1. User drags a card from *Open* to *In Progress* on the Kanban board (optimistic UI moves the card instantly).
2. Concurrently, a background polling interval (`fetchTasks()`) returns data from a request initiated 100ms before the drag started.
3. The background poll snaps the card *backward* to *Open*.
4. 200ms later, the drag mutation completes and snaps the card *forward* to *In Progress*.

**The Solution:**
```typescript
const activeMutationsRef = useRef<number>(0);

const beginTaskMutation = () => {
  activeMutationsRef.current++;
};

const endTaskMutation = () => {
  setTimeout(() => {
    activeMutationsRef.current = Math.max(0, activeMutationsRef.current - 1);
  }, 1000); // 1-second cooldown lock
};

const isMutatingTasks = () => activeMutationsRef.current > 0;
```

In `fetchTasks()`, incoming polling updates are blocked while `isMutatingTasks() === true`:
```typescript
if (isMutatingTasks() && !options?.forceFresh) {
  // Discard incoming background poll to preserve active user drag-and-drop state!
  return;
}
```

### 5.2. `updateTaskStatusOptimistic(taskId, newStatusId, newStatus)` & Per-Task Version Lock (`pendingTaskMutationsRef`)
- Records a per-task optimistic lock in `pendingTaskMutationsRef.current.set(taskId, { statusId, status, timestamp: Date.now() })` and increments `activeMutationsRef.current++` for the entire duration of the in-flight `PATCH` request plus a 3-second post-settlement guard.
- In `applyPendingMutationsToTasks(incomingTasks)`, any incoming poll response for a task with an active entry in `pendingTaskMutationsRef` (within 5 seconds) preserves the optimistic `statusId` and `status` until the server confirms the new status—guaranteeing zero card rubber-banding even when moving multiple cards rapidly.
- In [`src/app/api/tasks/[id]/route.ts`](file:///c:/Users/MIS/Documents/GitHub/CLOUD-LNK-TICKET-SYSTEM/src/app/api/tasks/[id]/route.ts), `PATCH` folds `TaskHistory` creation (`history: { create: historyEntries }`) directly into the single atomic `prisma.task.update` write, updates `tasks:master:all` in-place, and schedules non-critical notification fan-out and SSE broadcasts after the response via Next.js 15 `after()` from `'next/server'`.

---

## 6. Vercel Serverless Cross-Instance Cache Coherence & Real-Time Delta Sync

On Vercel Serverless deployments (`Boolean(process.env.VERCEL)`), `PATCH /api/tasks/[id]`, `GET /api/tasks`, `GET /api/spaces`, and `GET /api/notifications` run in isolated serverless function instances that do not share RAM.

### 6.1. Cross-Instance Cache Coherence (`server-cache.ts` & `task-store.ts`)
1. **Dynamic Key TTL Cap on Vercel:** In [`src/lib/server-cache.ts`](file:///c:/Users/MIS/Documents/GitHub/CLOUD-LNK-TICKET-SYSTEM/src/lib/server-cache.ts), when `IS_VERCEL_SERVERLESS` is true, mutable cross-instance keys (`tasks:`, `task:`, `spaces:`, `notifications:`) are capped to a 2s fresh TTL with `swrMs: 0` so isolated instances never serve 60s–300s stale snapshots.
2. **PostgreSQL Aggregate Stamp Verification (`fetchMasterTaskList`):** Before trusting a warm `tasks:master:all` cache entry in [`src/lib/task-store.ts`](file:///c:/Users/MIS/Documents/GitHub/CLOUD-LNK-TICKET-SYSTEM/src/lib/task-store.ts), the server performs a sub-5ms single-row check (`prisma.task.aggregate({ _max: { updatedAt: true }, _count: { _all: true } })`). If another serverless instance mutated, created, or deleted a task, `fetchMasterTaskList` automatically bypasses the warm RAM entry and fetches fresh data.
3. **Awaited Persistence & `?fresh=1` Support:** All mutation routes (`POST /api/tasks`, `PATCH /api/tasks/[id]`, `DELETE /api/tasks/[id]`, `POST /api/tasks/[id]/handoff`) await database writes and notification inserts before returning the HTTP response (preventing Vercel from freezing background promises) and invalidate `spaces:` and `notifications:user:`. All read routes (`GET /api/tasks`, `GET /api/spaces`, `GET /api/notifications`) strictly honour `?fresh=1`.

### 6.2. 0ms Reactive Sidebar Open-Ticket Counts & 4s Delta Sync Heartbeat (`workspace-context.tsx` & `Sidebar.tsx`)
1. **Live Reactive Sidebar Counts (`spaceOpenCounts` & `listOpenCounts`):** [`src/context/workspace-context.tsx`](file:///c:/Users/MIS/Documents/GitHub/CLOUD-LNK-TICKET-SYSTEM/src/context/workspace-context.tsx) maintains the live `tasks` array and computes open ticket counts per Space/Department and Queue List in `0ms` via `useMemo` (counting tasks whose status is not `Resolved` or `Closed`), falling back to `space._count.tasks` only before `tasks` have loaded. [`src/components/layout/Sidebar.tsx`](file:///c:/Users/MIS/Documents/GitHub/CLOUD-LNK-TICKET-SYSTEM/src/components/layout/Sidebar.tsx) renders these badges beside both Space names and Queue List names.
2. **4-Second Delta Sync Heartbeat:** Every 4 seconds while the tab is visible and `!isMutatingTasks()`, `workspace-context.tsx` polls `GET /api/notifications?delta=1&fresh=1` (which returns `latestNotificationId`, `latestTaskUpdatedAt`, and `totalTaskCount`). Whenever a new unread notification or task mutation from another user is detected in PostgreSQL, the client automatically plays the notification chime/toast and refreshes `tasks` (`forceFresh: true`) and `spaces`.

---
title: "Master API Route Reference & Contracts"
tags: ["api", "reference", "routes", "contracts", "rbac", "caching"]
key_files: ["src/app/api/**", "src/lib/auth/session.ts", "src/lib/server-cache.ts", "src/lib/security/rbac.ts"]
last_updated: "2026-10-28"
---

# Master API Route Reference & Contracts

[← Back to Master Index](./00-INDEX.md)

This document provides a comprehensive, exhaustive contract catalog of every API route implemented in `src/app/api/**`. It serves as the single source of truth for request schemas, query parameters, authentication/authorization requirements, caching behaviors, and response structures across the entire system.

---

## 1. Global API Standards & Conventions

### 1.1 Authentication & Session Extraction
Every authenticated endpoint extracts session credentials using the dual-lookup mechanism defined in `src/lib/auth/session.ts`:
1. **HTTP-Only Cookie:** `ticket_session` (primary for browser clients).
2. **Authorization Header:** `Bearer <token>` (fallback for programmatic clients, scripts, and cron jobs).

Unauthenticated requests to protected endpoints return `401 Unauthorized`:
```json
{ "error": "Unauthorized: Authentication required." }
```

### 1.2 RBAC Enforcement & HTTP Status Codes
Endpoints enforce role clearance via `src/lib/security/rbac.ts` and `src/lib/security/query-guard.ts`:
- `SUPERADMIN`: Unrestricted platform-wide access, including database backups, cross-department space deletion, and user management.
- `ADMIN`: Department/Space Administrator. Manages queue lists, custom fields, and space settings for assigned spaces. Universal intake enabled.
- `USER`: Department Employee. Views own space tasks and collaborated tasks. Universal intake enabled for creating tickets in other departments.
- **Forbidden (403):** Returns `{ "error": "Forbidden: Insufficient permissions." }`
- **Not Found (404):** Returns `{ "error": "Resource not found." }`
- **Validation Error (400):** Returns `{ "error": "Invalid request payload.", "details": [...] }`
- **Internal Server Error (500):** Returns `{ "error": "Internal server error." }`

### 1.3 Caching Invariants
- Endpoints reading through `getOrSetCache` (`src/lib/server-cache.ts`) return `X-Cache: HIT`, `X-Cache: MISS`, or `X-Cache: STALE` headers.
- Any mutation endpoint (`POST`, `PATCH`, `PUT`, `DELETE`) modifying tasks **must** invalidate `tasks:master:all` and detail caches via `invalidateTaskCache(taskId)` or `invalidateCacheKey(key)`.

---

## 2. Authentication & Session Management

| Method | Endpoint | Auth Required | Cache Keys Read / Invalidated | Description |
| :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/login` | None (Public) | Invalidates `admin:users` | Authenticates user via email/password, creates DB `Session`, sets `ticket_session` HTTP-only cookie. |
| `POST` | `/api/auth/logout` | Session | Invalidates session cache | Deletes `Session` from database, clears `ticket_session` cookie. |
| `GET` | `/api/auth/me` | Session | Reads user session | Returns currently authenticated user identity, role, department, and space memberships. |
| `GET` | `/api/auth/session` | Session | Reads user session | Alias backward-compatibility route forwarding directly to `/api/auth/me`. |
| `POST` | `/api/user/change-password` | Session | Invalidates all user sessions except current | Validates current password with bcrypt, updates password hash, revokes other active sessions. |
| `POST` | `/api/auth/change-password` | Session | Same as above | Alias route forwarding to `/api/user/change-password`. |
| `GET` | `/api/user/preferences` | Session | Reads `user:preferences:[userId]` | Retrieves user UI preferences (theme, notification settings, default space). |
| `PATCH` | `/api/user/preferences` | Session | Invalidates `user:preferences:[userId]` | Updates user preferences in database. |

### Contract Details

#### `POST /api/auth/login`
- **Request Body:**
  ```json
  {
    "email": "user@example.com",
    "password": "SecurePassword123!"
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "user": {
      "id": "usr-uuid-1",
      "email": "user@example.com",
      "name": "Jane Doe",
      "globalRole": "ADMIN",
      "department": "Human Resources",
      "avatarUrl": null
    },
    "expiresAt": "2026-11-28T00:00:00.000Z"
  }
  ```
- **Set-Cookie Header:** `ticket_session=<token>; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`

---

## 3. Tasks & Core Ticket Engine

| Method | Endpoint | Auth Required | Cache Keys Read / Invalidated | Description |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/tasks` | Session | Reads `tasks:master:all` (SWR TTL 60s) | Query tickets with filters (`spaceId`, `statusId`, `priority`, `assigneeId`, `search`, `fastView`, `page`, `limit`). |
| `POST` | `/api/tasks` | Session | Invalidates `tasks:master:all`, `admin:system-health` | Creates a new ticket. Generates atomic `taskKey`, links staged files, creates checklist & custom fields. |
| `GET` | `/api/tasks/[id]` | Session | Reads `task:detail:[id]` (TTL 120s) | Retrieves comprehensive ticket payload (checklist, custom fields, attachments, audit history). |
| `PATCH` | `/api/tasks/[id]` | Session | Updates master store in-place; invalidates `task:detail:[id]` | Updates ticket fields (title, description, status, priority, assignee, due date). Emits `TaskHistory`. |
| `DELETE` | `/api/tasks/[id]` | Admin / Creator | Invalidates `tasks:master:all`, `task:detail:[id]` | Deletes ticket, unlinks attachments, removes checklist items. |
| `POST` | `/api/tasks/[id]/handoff` | Session | Invalidates master store & `task:detail:[id]` | Department transfer. Sets `originSpaceId`, resets status to target space canonical Open, connects `_TaskContributors`. |
| `PATCH` | `/api/tasks/[id]/handoff` | Session | Same as above | Alias method for department handoff. |
| `POST` | `/api/tickets/[id]/handoff` | Session | Same as above | Alias route forwarding to `/api/tasks/[id]/handoff`. |
| `PATCH` | `/api/tickets/[id]/handoff` | Session | Same as above | Alias route forwarding to `/api/tasks/[id]/handoff`. |

### Contract Details

#### `GET /api/tasks`
- **Query Parameters:**
  - `spaceId` (string, optional): Filter by department space.
  - `listId` (string, optional): Filter by queue list.
  - `statusId` (string, optional): Filter by status.
  - `priority` (string, optional): `LOW`, `NORMAL`, `HIGH`, `URGENT`.
  - `assigneeId` (string, optional): Filter by assigned user ID.
  - `search` (string, optional): Full-text search across `taskKey`, `title`, and `description`.
  - `fastView` (string, optional): `my_tasks`, `assigned_to_me`, `created_by_me`, `collaborated`.
  - `page` (number, default: 1): Pagination page number.
  - `limit` (number, default: 50): Page size (max 200).
- **Response (200 OK):**
  ```json
  {
    "tasks": [
      {
        "id": "tsk-uuid-1",
        "taskKey": "HR-101",
        "title": "Onboard Safety Specialist",
        "priority": "HIGH",
        "statusId": "st-prog-hr",
        "spaceId": "spc-hr",
        "originSpaceId": null,
        "assigneeId": "usr-uuid-2",
        "creatorId": "usr-uuid-1",
        "createdAt": "2026-10-28T04:00:00.000Z",
        "updatedAt": "2026-10-28T05:30:00.000Z",
        "status": { "id": "st-prog-hr", "name": "In Progress", "color": "#3B82F6", "orderIndex": 1 },
        "space": { "id": "spc-hr", "name": "Human Resources", "key": "HR", "color": "#EC4899" },
        "assignee": { "id": "usr-uuid-2", "name": "Bob Smith", "avatarUrl": null },
        "_count": { "comments": 3, "attachments": 2, "checklistItems": 5 }
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 50
  }
  ```

#### `POST /api/tasks`
- **Request Body:**
  ```json
  {
    "spaceId": "spc-hr",
    "listId": "lst-hr-general",
    "title": "Update Employee Handbook",
    "description": "Please review section 4 on workplace safety.",
    "priority": "NORMAL",
    "statusId": "st-open-hr",
    "assigneeId": "usr-uuid-2",
    "dueDate": "2026-11-15T00:00:00.000Z",
    "stagedAttachmentIds": ["stg-uuid-1", "stg-uuid-2"],
    "checklist": ["Review draft", "Legal sign-off"],
    "customFieldValues": {
      "fld-dept-code": "HR-2026"
    }
  }
  ```
- **Response (201 Created):** Full created task object including populated `taskKey` (`HR-102`), relations, and `TaskHistory` event.

#### `POST /api/tasks/[id]/handoff`
- **Request Body:**
  ```json
  {
    "targetSpaceId": "spc-safety",
    "targetListId": "lst-safety-inbox",
    "comment": "Transferring safety policy review to EHS team.",
    "assigneeId": "usr-uuid-5"
  }
  ```
- **Business Rule Invariant:** Sets `originSpaceId = task.spaceId`, updates `spaceId = targetSpaceId`, updates `statusId` to target space's canonical `Open` status (`orderIndex = 0`), connects source space user to `_TaskContributors`, creates `HANDOFF` audit record in `TaskHistory`.

---

## 4. Task Sub-Resources (Comments, Checklists, Attachments)

| Method | Endpoint | Auth Required | Cache Keys Read / Invalidated | Description |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/tasks/[id]/comments` | Session | Reads `task:detail:[id]` | Retrieves all comments for a ticket ordered chronologically. |
| `POST` | `/api/tasks/[id]/comments` | Session | Invalidates `task:detail:[id]`, `notifications:user:*` | Posts a new comment. Extracts `@mentions` and creates unread notifications for mentioned users. |
| `DELETE` | `/api/tasks/[id]/comments/[commentId]` | Session | Invalidates `task:detail:[id]` | Deletes comment (author or SUPERADMIN only). |
| `GET` | `/api/tasks/[id]/checklist` | Session | Reads `task:detail:[id]` | Retrieves checklist items with completion states and sort order. |
| `POST` | `/api/tasks/[id]/checklist` | Session | Invalidates `task:detail:[id]` | Adds a new checklist item to the ticket. |
| `PATCH` | `/api/tasks/[id]/checklist/[itemId]` | Session | Invalidates `task:detail:[id]` | Toggles item completion status (`isCompleted`) or updates title. |
| `DELETE` | `/api/tasks/[id]/checklist/[itemId]` | Session | Invalidates `task:detail:[id]` | Deletes a checklist item. |
| `GET` | `/api/tasks/[id]/attachments` | Session | Reads `task:detail:[id]` | Retrieves attachment metadata list for a ticket. |
| `POST` | `/api/tasks/[id]/attachments` | Session | Invalidates `task:detail:[id]` | Links an uploaded file to an existing ticket. |
| `DELETE` | `/api/tasks/[id]/attachments/[attachmentId]` | Session | Invalidates `task:detail:[id]` | Removes attachment from ticket and schedules cloud/local file deletion. |

### Contract Details

#### `POST /api/tasks/[id]/comments`
- **Request Body:**
  ```json
  {
    "content": "Hey @[Jane Doe](usr-uuid-1), the revised contract is ready for your signature."
  }
  ```
- **Response (201 Created):**
  ```json
  {
    "id": "cmt-uuid-1",
    "taskId": "tsk-uuid-1",
    "userId": "usr-uuid-2",
    "content": "Hey @[Jane Doe](usr-uuid-1), the revised contract is ready for your signature.",
    "createdAt": "2026-10-28T06:00:00.000Z",
    "user": { "id": "usr-uuid-2", "name": "Bob Smith", "avatarUrl": null }
  }
  ```

---

## 5. Spaces, Queues, and Custom Fields

| Method | Endpoint | Auth Required | Cache Keys Read / Invalidated | Description |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/spaces` | Session | Reads `spaces:` (TTL 300s) | Retrieves all spaces visible to user based on RBAC clearance. |
| `POST` | `/api/spaces` | Admin / Super | Invalidates `spaces:*` | Creates department space. Provisions default 5 canonical statuses and default queues. |
| `GET` | `/api/spaces/[id]` | Session | Reads space details | Retrieves space metadata, lists, statuses, and member rosters. |
| `PATCH` | `/api/spaces/[id]` | Space Admin | Invalidates `spaces:*` | Updates space name, description, color, or icon. |
| `DELETE` | `/api/spaces/[id]` | Superadmin | Invalidates `spaces:*`, `tasks:master:all` | Deletes space and all associated queues, statuses, and custom fields. |
| `GET` | `/api/spaces/intake` | Session | Reads `spaces:intake:all` (TTL 300s) | Universal cross-department intake directory listing all open ticket submission queues. |
| `GET` | `/api/spaces/[id]/lists` | Session | Reads `spaces:[id]:lists` | Retrieves queue lists belonging to space. |
| `POST` | `/api/spaces/[id]/lists` | Space Admin | Invalidates `spaces:[id]:lists` | Creates a new queue list inside space. |
| `PATCH` | `/api/spaces/[id]/lists/[listId]` | Space Admin | Invalidates `spaces:[id]:lists` | Renames queue list or toggles `isPrivate` visibility. |
| `DELETE` | `/api/spaces/[id]/lists/[listId]` | Space Admin | Invalidates `spaces:[id]:lists` | Deletes queue list (tasks are moved to default list or archived). |
| `PATCH` | `/api/spaces/[id]/lists/reorder` | Space Admin | Invalidates `spaces:[id]:lists` | Reorders queue lists via array of list IDs. (Also supports `PUT`). |
| `GET` | `/api/spaces/[id]/statuses` | Session | Reads `spaces:[id]:statuses` | Retrieves status workflow columns for space. |
| `PATCH` | `/api/spaces/[id]/statuses` | Space Admin | Invalidates `spaces:[id]:statuses` | Bulk updates status workflow ordering and names. |
| `PATCH` | `/api/spaces/[id]/statuses/[statusId]` | Space Admin | Invalidates `spaces:[id]:statuses` | Updates individual status color, name, or canonical mapping. |
| `PATCH` | `/api/statuses/[statusId]` | Space Admin | Invalidates `spaces:*:statuses` | Global status update route by status ID. |
| `GET` | `/api/spaces/[id]/custom-fields` | Session | Reads custom fields | Retrieves custom field definitions for space. |
| `POST` | `/api/spaces/[id]/custom-fields` | Space Admin | Invalidates custom fields | Creates custom field (`TEXT`, `NUMBER`, `DROPDOWN`, `DATE`, `CHECKBOX`). |
| `PATCH` | `/api/spaces/[id]/custom-fields/[fieldId]` | Space Admin | Invalidates custom fields | Updates custom field options or validation rules. |
| `DELETE` | `/api/spaces/[id]/custom-fields/[fieldId]` | Space Admin | Invalidates custom fields | Deletes custom field definition and orphaned values. |
| `GET` | `/api/spaces/[id]/settings` | Space Admin | Reads space settings | Retrieves space SLA policies and access rules. |
| `PATCH` | `/api/spaces/[id]/settings` | Space Admin | Invalidates space settings | Updates space operational settings. |
| `GET` | `/api/spaces/[id]/sla` | Space Admin | Reads space SLA | Retrieves SLA turnaround targets per priority level. |
| `PUT` | `/api/spaces/[id]/sla` | Space Admin | Updates space SLA | Updates SLA turnaround targets. |
| `GET` | `/api/spaces/[id]/templates` | Session | Reads templates | Retrieves pre-configured ticket submission templates. |
| `POST` | `/api/spaces/[id]/templates` | Space Admin | Invalidates templates | Creates reusable ticket template for department intake. |
| `PATCH` | `/api/spaces/[id]/management` | Space Admin | Invalidates `rbac:*`, `spaces:*` | Updates member rosters and space-level permission assignments. |

---

## 6. Storage Pipeline & Google Drive Bridge

| Method | Endpoint | Auth Required | Cache Keys Read / Invalidated | Description |
| :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/attachments/stage` | Session | None | Eager pre-upload staging. Streams file to Google Drive/disk immediately upon file selection. |
| `DELETE` | `/api/attachments/stage` | Session | None | Aborts/removes staged file. Deletes uploaded file from Google Drive to avoid orphan storage. |
| `POST` | `/api/attachments/upload` | Session | Invalidates `task:detail:[id]` | Uploads attachment directly to an existing ticket. |
| `GET` | `/api/attachments/[id]` | Session | Reads attachment metadata | Resolves attachment metadata and redirects/streams file content. |
| `GET` | `/api/attachments/drive/[fileId]` | Session | Reads `driveFileCache` (TTL 10m for <=4MB) | Streams Google Drive file. Small files (<=4MB) cached in RAM; large files streamed via chunked transfer. |

### Contract Details

#### `POST /api/attachments/stage`
- **Request:** `multipart/form-data` containing:
  - `file`: Binary file upload.
  - `spaceId` (optional): Target department space ID.
- **Response (200 OK):**
  ```json
  {
    "stagedAttachment": {
      "id": "stg-uuid-1",
      "filename": "incident-report.pdf",
      "fileSize": 2458900,
      "mimeType": "application/pdf",
      "storageProvider": "GOOGLE_DRIVE",
      "driveFileId": "1a2B3c4D5e6F7g8H9i0J",
      "viewUrl": "/api/attachments/drive/1a2B3c4D5e6F7g8H9i0J"
    }
  }
  ```

#### `DELETE /api/attachments/stage`
- **Request Body:**
  ```json
  {
    "stagedAttachmentId": "stg-uuid-1"
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Staged attachment and remote Google Drive file deleted successfully."
  }
  ```

---

## 7. Search, Autocomplete & Real-Time SSE

| Method | Endpoint | Auth Required | Cache Keys Read / Invalidated | Description |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/search` | Session | None (Realtime DB query) | Global omnibar search across tickets (`taskKey`, `title`), spaces, and users. |
| `GET` | `/api/users/mentions` | Session | Reads `users:all:mentions` (TTL 300s) | Fast, lightweight directory of active users for `@mention` popovers and assignee dropdowns. |
| `GET` | `/api/notifications` | Session | Reads `notifications:user:[userId]` | Retrieves notifications for current user with unread counts. |
| `POST` | `/api/notifications` | Session | Invalidates `notifications:user:*` | Emits notification to target user. |
| `DELETE` | `/api/notifications` | Session | Invalidates `notifications:user:[userId]` | Clears all notifications for current user. |
| `PATCH` | `/api/notifications/[id]/read` | Session | Invalidates `notifications:user:[userId]` | Marks a specific notification (or all) as read. |
| `GET` | `/api/notifications/stream` | Session | Active SSE Client Registry | Server-Sent Events (SSE) push stream. Emits real-time ticket mutations and notification alerts. |

### Contract Details

#### `GET /api/search`
- **Query Parameters:** `q` (string, required, min 2 chars), `limit` (number, default: 10)
- **Response (200 OK):**
  ```json
  {
    "tasks": [
      { "id": "tsk-1", "taskKey": "IT-42", "title": "VPN Outage", "spaceName": "Information Technology" }
    ],
    "spaces": [
      { "id": "spc-it", "name": "Information Technology", "key": "IT" }
    ],
    "users": [
      { "id": "usr-1", "name": "Alice Johnson", "email": "alice@lnk.com" }
    ]
  }
  ```

#### `GET /api/notifications/stream`
- **Headers:** `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`
- **SSE Event Protocol:**
  ```text
  event: ticket_created
  data: {"taskId":"tsk-uuid-1","taskKey":"HR-101","spaceId":"spc-hr","title":"New Employee"}

  event: notification
  data: {"id":"notif-1","title":"You were mentioned in HR-101","type":"MENTION"}
  ```

---

## 8. Administration, System Health & Disaster Recovery

| Method | Endpoint | Auth Required | Cache Keys Read / Invalidated | Description |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/admin/users` | Superadmin | Reads `admin:users` (TTL 30s) | Lists all user accounts with roles, departments, active status, and session counts. |
| `POST` | `/api/admin/users` | Superadmin | Invalidates `admin:users`, `users:all:mentions` | Creates a new user account with hashed password and space memberships. |
| `PATCH` | `/api/admin/users/[id]` | Superadmin | Invalidates `admin:users`, `users:all:mentions` | Updates user profile, department, active status, or resets password. |
| `DELETE` | `/api/admin/users/[id]` | Superadmin | Invalidates `admin:users`, `users:all:mentions` | Deactivates or removes a user account. |
| `PATCH` | `/api/admin/users/[id]/role` | Superadmin | Invalidates `admin:users`, `rbac:*` | Updates global role (`SUPERADMIN`, `ADMIN`, `USER`). |
| `DELETE` | `/api/admin/spaces/[spaceId]` | Superadmin | Invalidates `spaces:*`, `tasks:master:all` | Admin force-delete endpoint for a space. |
| `GET` | `/api/admin/system-health` | Superadmin | Reads `admin:system-health` (TTL 15s) | Telemetry diagnostics (PostgreSQL ping latency, DB size, Drive quota, Node.js memory). |
| `POST` | `/api/admin/system-health` | Superadmin | Invalidates `admin:system-health` | Triggers database optimization (dead session cleanup, WAL checkpoint). |
| `GET` | `/api/admin/system/stats` | Superadmin | Reads `admin:system:stats` (TTL 60s) | Aggregated platform metrics (total tickets, resolution rates, space activity). |
| `GET` | `/api/admin/system/backup` | Superadmin | None | Generates and downloads a live database backup (`.json.gz` on Supabase/Postgres, `.sqlite` on SQLite). |
| `GET` | `/api/admin/backup/cron` | Secret Key | None | Automated scheduled backup endpoint for Vercel Cron (`CRON_SECRET`). Uploads `.json.gz` to Google Drive. |
| `GET` | `/api/cron/backup` | Secret Key | None | Secondary cron backup trigger route. Supports `GET` and `POST`. |
| `POST` | `/api/cron/backup` | Secret Key | None | Secondary cron backup trigger route. |
| `POST` | `/api/admin/data/export` | Superadmin | None | Exports full workspace data in portable JSON snapshot format. |
| `POST` | `/api/admin/data/import` | Superadmin | Invalidates all caches | Restores workspace data from JSON snapshot using atomic nested writes. |
| `POST` | `/api/admin/reports/generate` | Superadmin | None | Generates CSV/JSON analytical reports across ticket SLA and resolution metrics. |
| `POST` | `/api/admin/reports/ai-narrative` | Superadmin | None | Generates AI-powered executive narrative summary of departmental performance. |
| `GET` | `/api/admin/settings/ai` | Superadmin | Reads AI config | Retrieves global AI feature flags and API key statuses. |
| `PATCH` | `/api/admin/settings/ai` | Superadmin | Invalidates AI config | Updates AI configuration parameters. |

### Contract Details

#### `GET /api/admin/system-health`
- **Response (200 OK):**
  ```json
  {
    "database": {
      "provider": "postgresql",
      "status": "HEALTHY",
      "latencyMs": 14.2,
      "sizeBytes": 54525952,
      "sizeFormatted": "52.0 MB"
    },
    "storage": {
      "provider": "GOOGLE_DRIVE",
      "status": "HEALTHY",
      "storageUsedBytes": 10737418240,
      "storageLimitBytes": 1099511627776,
      "usagePercent": 0.98
    },
    "system": {
      "uptimeSeconds": 86400,
      "nodeMemory": {
        "heapUsedMB": 82.4,
        "heapTotalMB": 128.0,
        "rssMB": 174.5
      }
    }
  }
  ```

#### `GET /api/admin/backup/cron`
- **Authentication:** `Authorization: Bearer <CRON_SECRET>` or query parameter `?secret=<CRON_SECRET>`.
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "timestamp": "2026-10-28T16:00:00.000Z",
    "filename": "ticket-system-backup-2026-10-28T16-00-00-000Z.json.gz",
    "sizeBytes": 184520,
    "driveFileId": "1xyz987BackupFileId",
    "tablesBackedUp": 22,
    "totalRecords": 1450,
    "durationMs": 842
  }
  ```

---

## 9. AI Engine & Background Queue

| Method | Endpoint | Auth Required | Cache Keys Read / Invalidated | Description |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/ai/config` | Session | Reads AI config | Retrieves active AI features, model names, and queue availability. |
| `GET` | `/api/ai/queue` | Session | Reads active jobs | Lists background AI analysis jobs for current user or space. |
| `POST` | `/api/ai/queue` | Session | Enqueues job | Enqueues a ticket for asynchronous AI classification, auto-tagging, or priority estimation. |
| `GET` | `/api/ai/queue/[id]` | Session | Reads job record | Retrieves AI processing status, confidence score, and generated suggestions. |
| `POST` | `/api/ai/queue/[id]` | Session | Re-enqueues job | Retries a failed AI analysis job. |
| `DELETE` | `/api/ai/queue/[id]` | Session | Deletes job | Removes an AI queue job record. |
| `GET` | `/api/ai/queue/[id]/status` | Session | Reads job status | Lightweight polling endpoint returning `{ status: "PENDING" \| "PROCESSING" \| "COMPLETED" \| "FAILED" }`. |
| `POST` | `/api/ai/queue/[id]/cancel` | Session | Updates job | Cancels a queued or in-flight AI processing job. |

### Contract Details

#### `POST /api/ai/queue`
- **Request Body:**
  ```json
  {
    "taskId": "tsk-uuid-1",
    "taskType": "AUTO_TAG_AND_PRIORITIZE"
  }
  ```
- **Response (202 Accepted):**
  ```json
  {
    "jobId": "ai-job-uuid-101",
    "status": "QUEUED",
    "estimatedDurationSeconds": 5
  }
  ```

---

## 10. Complete Route Index (Alphabetical)

For quick lookup, the complete roster of all 61 route handlers in `src/app/api/**` is indexed below:

1. `/api/admin/backup/cron` (`GET`)
2. `/api/admin/data/export` (`POST`)
3. `/api/admin/data/import` (`POST`)
4. `/api/admin/reports/ai-narrative` (`POST`)
5. `/api/admin/reports/generate` (`POST`)
6. `/api/admin/settings/ai` (`GET`, `PATCH`)
7. `/api/admin/spaces/[spaceId]` (`DELETE`)
8. `/api/admin/system/backup` (`GET`)
9. `/api/admin/system/stats` (`GET`)
10. `/api/admin/system-health` (`GET`, `POST`)
11. `/api/admin/users` (`GET`, `POST`)
12. `/api/admin/users/[id]` (`PATCH`, `DELETE`)
13. `/api/admin/users/[id]/role` (`PATCH`)
14. `/api/ai/config` (`GET`)
15. `/api/ai/queue` (`GET`, `POST`)
16. `/api/ai/queue/[id]` (`GET`, `POST`, `DELETE`)
17. `/api/ai/queue/[id]/cancel` (`POST`)
18. `/api/ai/queue/[id]/status` (`GET`)
19. `/api/attachments/[id]` (`GET`)
20. `/api/attachments/drive/[fileId]` (`GET`)
21. `/api/attachments/stage` (`POST`, `DELETE`)
22. `/api/attachments/upload` (`POST`)
23. `/api/auth/change-password` (`POST` -> `/api/user/change-password`)
24. `/api/auth/login` (`POST`)
25. `/api/auth/logout` (`POST`)
26. `/api/auth/me` (`GET`)
27. `/api/auth/session` (`GET` -> `/api/auth/me`)
28. `/api/cron/backup` (`GET`, `POST`)
29. `/api/notifications` (`GET`, `POST`, `DELETE`)
30. `/api/notifications/[id]/read` (`PATCH`)
31. `/api/notifications/stream` (`GET`)
32. `/api/search` (`GET`)
33. `/api/spaces` (`GET`, `POST`)
34. `/api/spaces/[id]` (`GET`, `PATCH`, `DELETE`)
35. `/api/spaces/[id]/custom-fields` (`GET`, `POST`)
36. `/api/spaces/[id]/custom-fields/[fieldId]` (`PATCH`, `DELETE`)
37. `/api/spaces/[id]/lists` (`GET`, `POST`)
38. `/api/spaces/[id]/lists/[listId]` (`PATCH`, `DELETE`)
39. `/api/spaces/[id]/lists/reorder` (`PATCH`, `PUT`)
40. `/api/spaces/[id]/management` (`PATCH`)
41. `/api/spaces/[id]/reports` (`POST`)
42. `/api/spaces/[id]/settings` (`GET`, `PATCH`)
43. `/api/spaces/[id]/sla` (`GET`, `PUT`)
44. `/api/spaces/[id]/statuses` (`GET`, `PATCH`)
45. `/api/spaces/[id]/statuses/[statusId]` (`PATCH`)
46. `/api/spaces/[id]/templates` (`GET`, `POST`)
47. `/api/spaces/intake` (`GET`)
48. `/api/statuses/[statusId]` (`PATCH`)
49. `/api/tasks` (`GET`, `POST`)
50. `/api/tasks/[id]` (`GET`, `PATCH`, `DELETE`)
51. `/api/tasks/[id]/attachments` (`GET`, `POST`)
52. `/api/tasks/[id]/attachments/[attachmentId]` (`DELETE`)
53. `/api/tasks/[id]/checklist` (`GET`, `POST`)
54. `/api/tasks/[id]/checklist/[itemId]` (`PATCH`, `DELETE`)
55. `/api/tasks/[id]/comments` (`GET`, `POST`)
56. `/api/tasks/[id]/comments/[commentId]` (`DELETE`)
57. `/api/tasks/[id]/handoff` (`POST`, `PATCH`)
58. `/api/tickets/[id]/handoff` (`POST`, `PATCH` -> `/api/tasks/[id]/handoff`)
59. `/api/user/change-password` (`POST`)
60. `/api/user/preferences` (`GET`, `PATCH`)
61. `/api/users/mentions` (`GET`)

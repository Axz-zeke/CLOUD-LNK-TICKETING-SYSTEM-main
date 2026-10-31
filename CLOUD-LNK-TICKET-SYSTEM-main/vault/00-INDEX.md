---
title: "Master System Blueprint & AI Architecture Vault"
tags:
  - architecture
  - documentation
  - ai-onboarding
  - system-index
key_files:
  - prisma/schema.prisma
  - src/lib/server-cache.ts
  - src/lib/task-store.ts
  - src/lib/google-drive-bridge.ts
  - src/context/workspace-context.tsx
last_updated: "2026-10-28"
---

# CLOUD-LNK-TICKET-SYSTEM — Master Architecture Vault

> [!IMPORTANT]
> **AI AGENT MANDATORY BRIEFING**
> If you are an AI assistant or software engineer joining this codebase with zero prior context, this vault is your **ground-truth source of architectural law**.
> Every table, cache key, storage protocol, permission check, and lifecycle event in this repository is designed around strict invariants. Read this index before attempting code refactoring or bug fixes.

---

## 1. Quick-Start 60-Second Executive Summary

`CLOUD-LNK-TICKET-SYSTEM` is an enterprise-grade, high-performance Ticketing and Workflow Operations platform engineered for **L&K Industries Philippine, Inc.**.

- **Frontend & App Framework:** Next.js 15.2.0 (App Router, Server Components + Client Views, React 19, TailwindCSS, Lucide Icons, Radix UI).
- **Primary Cloud Database:** **Supabase PostgreSQL** (`aws-0-ap-southeast-1.pooler.supabase.com`) using **Supavisor Transaction Pooler (`:6543`)** for serverless requests and Session Pooler (`:5432`) for Prisma CLI migrations.
- **Dual-Mode Portability:** Operates transparently in **Cloud Mode** (Vercel + Supabase + Google Drive) or **On-Premise Air-Gapped Mode** (Local Server + PostgreSQL/SQLite + Local Disk Storage) controlled entirely via environment variables.
- **Enterprise Storage Provider:** **Google Workspace Drive v3 Apps Script Bridge** (`GOOGLE_DRIVE_BRIDGE_URL`) supporting zero-credential, corporate-compliant streaming for 50MB–100MB+ documents, images, videos, and compressed database backups.
- **Sub-Millisecond Read Latency:** Server-side in-memory RAM cache (`src/lib/server-cache.ts` & `src/lib/task-store.ts`) with Stale-While-Revalidate (SWR) and in-flight promise deduplication serving API reads in `< 0.1ms` (benchmarked at `14ms` end-to-end network latency).
- **Instant Optimistic UI:** Kanban, List, Gantt, and Drawer status changes update instantly in `0ms` with polling locks (`activeMutationsRef`) preventing card rubber-banding.

---

## 2. Full Repository Directory Map

```tree
CLOUD-LNK-TICKET-SYSTEM/
├── .env.example                       # Documented environment template for Cloud & On-Premise
├── vercel.json                        # Vercel deployment config, 60s maxDuration, midnight Cron
├── next.config.mjs                    # Next.js 15 config (serverExternalPackages for Prisma/bcryptjs)
├── package.json                       # Scripts: build, postinstall, seed, sync:drive, migrate:supabase
├── prisma/
│   ├── schema.prisma                  # 22 relational models with relationJoins preview
│   └── seed.ts                        # Clean database seed script
├── scripts/
│   ├── google-drive-bridge.gs         # Standalone Google Apps Script source code
│   ├── migrate-sqlite-to-supabase.ts  # Bi-directional migration & portability engine
│   └── sync-attachments-with-drive.ts # Push/Pull attachments between Google Drive & local disk
├── src/
│   ├── app/
│   │   ├── admin/                     # Superadmin UI (Users, System Health, Backups)
│   │   ├── api/                       # 58 API endpoints (Auth, Tasks, Spaces, Drive, Cron, AI)
│   │   ├── layout.tsx                 # Root layout with Toast, SWR, and Theme providers
│   │   ├── page.tsx                   # Main workspace page loading AppShell
│   │   └── settings/                  # User personal settings & notification preferences
│   ├── components/
│   │   ├── admin/                     # Admin health cards, user tables, audit logs
│   │   ├── drawers/                   # TaskDetailDrawer (Notion-style detail inspection)
│   │   ├── layout/                    # AppShell, Sidebar, Header, Global Search
│   │   ├── modals/                    # CreateTicketModal, TicketResolutionHandoffModal, CreateSpaceModal
│   │   └── views/                     # ListView, BoardView (Kanban), GanttView, DashboardView
│   ├── context/
│   │   └── workspace-context.tsx      # Global React Context, Realtime Events, Optimistic Handlers
│   └── lib/
│       ├── ai/                        # OpenCode / OpenAI-compatible report narrative engines
│       ├── auth/                      # Session token generation, verification, and cookie handling
│       ├── collaboration.ts           # Cross-department routing, filter builders, and notifications
│       ├── collaboration-utils.ts     # Pure route string tracing & origin space calculation
│       ├── db.ts                      # Prisma client factory, connection pooler, withDbRetry
│       ├── google-drive-bridge.ts     # Google Drive Apps Script client, resumable streaming, RAM cache
│       ├── notifications.ts           # In-app notifications & SSE trigger pipeline
│       ├── security/                  # RBAC matrix, permission evaluators, and query-guards
│       ├── server-cache.ts            # High-speed in-memory RAM cache with SWR & in-flight deduplication
│       ├── sla.ts                     # Business hours SLA evaluator & warning calculations
│       ├── sse-broker.ts              # Server-Sent Events broker for real-time LAN pushes
│       ├── status-utils.ts            # Canonical 5-status resolver & cross-department mapper
│       └── task-store.ts              # Master in-memory task store & in-place mutation engine
└── vault/                             # Obsidian Architecture & AI Knowledge Brain
    ├── 00-INDEX.md                    # (You are here) Entrypoint & Golden Rules
    ├── 01-Architecture-and-Cloud-Portability.md
    ├── 02-Database-Schema-and-Prisma-Patterns.md
    ├── 03-Caching-and-Performance-Engine.md
    ├── 04-Ticket-Lifecycle-and-Collaboration-Flow.md
    ├── 05-Storage-Pipeline-and-Google-Drive-Bridge.md
    ├── 06-Frontend-Views-and-Component-Contracts.md
    ├── 07-Security-RBAC-and-Realtime-Notifications.md
    ├── 08-Superadmin-and-Disaster-Recovery.md
    └── 09-API-Route-Reference.md
```

---

## 3. Vault Navigation & Knowledge Directory

| Vault Document | Core Subject Matter | When an AI Agent Must Consult |
| :--- | :--- | :--- |
| **[01-Architecture-and-Cloud-Portability](./01-Architecture-and-Cloud-Portability.md)** | Dual-environment topology, Supabase `:6543` vs `:5432`, SQLite fallback, data migration | Modifying database connections, environment variables, or migration utilities. |
| **[02-Database-Schema-and-Prisma-Patterns](./02-Database-Schema-and-Prisma-Patterns.md)** | All 22 Prisma tables, relationJoins, Zero P2028 policy, atomic nested writes | Creating migrations, writing Prisma queries, or touching relations. |
| **[03-Caching-and-Performance-Engine](./03-Caching-and-Performance-Engine.md)** | In-memory RAM cache, SWR, deduplication, timestamped invalidation, client cache | Modifying API response speeds, invalidation keys, or optimistic UI logic. |
| **[04-Ticket-Lifecycle-and-Collaboration-Flow](./04-Ticket-Lifecycle-and-Collaboration-Flow.md)** | Ticket creation, 5 canonical statuses, Handoff rule, `@mentions`, checklists | Editing ticket creation, status changes, transfer handoffs, or SLA calculations. |
| **[05-Storage-Pipeline-and-Google-Drive-Bridge](./05-Storage-Pipeline-and-Google-Drive-Bridge.md)** | Google Apps Script bridge, resumable uploads up to 100MB, RAM buffer caching | Modifying file attachments, upload modals, or Google Drive endpoints. |
| **[06-Frontend-Views-and-Component-Contracts](./06-Frontend-Views-and-Component-Contracts.md)** | AppShell, ListView, BoardView, GanttView, DashboardView, Drawer contracts | Modifying UI components, drag-and-drop, date parsing, or layout state. |
| **[07-Security-RBAC-and-Realtime-Notifications](./07-Security-RBAC-and-Realtime-Notifications.md)** | RBAC clearance matrix, session validation, SSE streams, broadcast events | Editing user permissions, department clearance, or real-time event broadcasting. |
| **[08-Superadmin-and-Disaster-Recovery](./08-Superadmin-and-Disaster-Recovery.md)** | Hot backups (`.json.gz`), multi-schedule cron, system health telemetry | Modifying backup routines, cron schedules, or superadmin health metrics. |
| **[09-API-Route-Reference](./09-API-Route-Reference.md)** | Complete catalog of all 58 REST & streaming endpoints with request/response schemas | Calling or authoring backend API routes. |

---

## 4. Golden Rules & Architectural Invariants (DO NOT BREAK)

Any developer or AI agent modifying this codebase **must strictly enforce the following rules**:

### Rule 1: Zero Interactive Transactions over PgBouncer (`P2028` Ban)
- **NEVER** use interactive loops inside `prisma.$transaction(async (tx) => { ... })` for ticket creation or space creation.
- **Why:** Supabase Transaction Pooler (`:6543`) operates in PgBouncer transaction pooling mode. Sequential client-side loops holding an open connection across high-latency cross-ocean links cause fatal Prisma `P2028` transaction timeouts.
- **Enforcement:** Always use **Single Atomic Nested Writes** (e.g. `prisma.task.create({ data: { ..., checklistItems: { createMany: ... } } })`).

### Rule 2: Strict Cross-Department Collaboration Invariant
- **Creating a ticket directly in another department (`POST /api/tasks`) leaves `originSpaceId = null`.**
- **Why:** If an HR employee files a ticket with MIS, it is currently an *intake ticket belonging to MIS*, NOT a cross-department collaborated ticket.
- **Enforcement:** A ticket **ONLY** becomes `Collaborated` when it is formally **Handed Off / Transferred** (`POST /api/tasks/[id]/handoff`), which sets `originSpaceId` to the transferring space and wires the transferring space staff into `_TaskContributors`. Never set `originSpaceId` on initial creation unless transferring.

### Rule 3: Timestamped Cache Invalidation Invariant
- **NEVER** write a background SWR fetch result back to `server-cache` without verifying `!isKeyOrPrefixInvalidatedSince(key, requestTime)`.
- **Why:** When a mutation invalidates a cache key while a background SWR promise is in flight, an unguarded SWR write would resurrect deleted or stale data.

### Rule 4: Optimistic Status Polling Lock (`activeMutationsRef`)
- In `workspace-context.tsx`, changing a task status or dragging a card must increment `activeMutationsRef.current++` during the transition.
- **Why:** Background polling intervals (`fetchTasks()`) fetching from the server must be locked out until the mutation settles, preventing cards from rubber-banding backward during user drag-and-drop.

### Rule 5: 5 Canonical Workflow Status Guarantee
- The 5 canonical states (`Open`, `In Progress`, `Pending`, `Resolved`, `Closed`) with IDs `st-open`, `st-prog`, `st-pend`, `st-reso`, `st-clos` must **ALWAYS** be present and selectable in `TaskDetailDrawer.tsx` and `ListView.tsx`, even if the ticket's space has custom statuses or empty status arrays.

### Rule 6: Large File Resumable Streaming
- Files `<= 4MB` use fast direct uploads. Files `> 4MB` up to `100MB` **must bypass Vercel's 4.5MB serverless body limit** by acquiring a Google Drive v3 Resumable Upload session (`INIT_RESUMABLE_UPLOAD`) and streaming chunks directly from the client.

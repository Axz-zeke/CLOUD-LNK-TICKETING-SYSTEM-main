---
title: "Frontend Views & Component Contracts"
tags:
  - frontend
  - components
  - kanban
  - gantt
  - listview
  - dashboard
key_files:
  - src/components/layout/AppShell.tsx
  - src/components/layout/Sidebar.tsx
  - src/components/views/ListView.tsx
  - src/components/views/BoardView.tsx
  - src/components/views/GanttView.tsx
  - src/components/views/DashboardView.tsx
  - src/components/drawers/TaskDetailDrawer.tsx
  - src/components/modals/CreateTicketModal.tsx
  - src/components/modals/CreateSpaceModal.tsx
last_updated: "2026-10-28"
---

# Frontend Views & Component Contracts

## 1. Shell & Navigation Architecture

The visual layout is anchored by [`AppShell.tsx`](file:///c:/Users/MIS/Documents/GitHub/CLOUD-LNK-TICKET-SYSTEM/src/components/layout/AppShell.tsx) and [`Sidebar.tsx`](file:///c:/Users/MIS/Documents/GitHub/CLOUD-LNK-TICKET-SYSTEM/src/components/layout/Sidebar.tsx), communicating via [`workspace-context.tsx`](file:///c:/Users/MIS/Documents/GitHub/CLOUD-LNK-TICKET-SYSTEM/src/context/workspace-context.tsx).

### 1.1. Navigation Modes & Active Scope
The workspace context maintains two modes of navigation via `ActiveScope`:
1. **Department Space Scope (`{ type: 'space', spaceId, listId? }`):**
   - Filters tasks strictly to a specific department (e.g. `Safety`) or a specific queue list (e.g. `Emergency Evacuations`).
2. **Global Fast Views Scope (`{ type: 'fastView', fastViewId }`):**
   - `all` / `everything`: Global view across all department spaces.
   - `assigned` / `assigned_to_me`: Tickets assigned to the active user.
   - `created` / `created_by_me`: Tickets submitted by the active user.
   - `collaborated`: Tickets transferred between departments or where the user is an explicit contributor.

### 1.2. Space Expansion, Queue List Open Badges & UX Safeguards ([`Sidebar.tsx`](file:///c:/Users/MIS/Documents/GitHub/CLOUD-LNK-TICKET-SYSTEM/src/components/layout/Sidebar.tsx), [`CreateSpaceModal.tsx`](file:///c:/Users/MIS/Documents/GitHub/CLOUD-LNK-TICKET-SYSTEM/src/components/modals/CreateSpaceModal.tsx))
- **Sidebar Queue-Only `"Open"` Ticket Count Badges:**
  - Parent Space / Department header rows in [`Sidebar.tsx`](file:///c:/Users/MIS/Documents/GitHub/CLOUD-LNK-TICKET-SYSTEM/src/components/layout/Sidebar.tsx) do **not** display a ticket count badge (showing only the Space icon, name, settings gear, and expand chevron).
  - Ticket count badges appear exclusively on nested **Queue List** rows (`listOpenCounts[listId]`) and strictly count ONLY tickets whose status is `"Open"` (`getStatusCategory(task.status) === 'OPEN'` / `st-open`, via `isTaskStrictlyOpen` in [`workspace-context.tsx`](file:///c:/Users/MIS/Documents/GitHub/CLOUD-LNK-TICKET-SYSTEM/src/context/workspace-context.tsx) and `OPEN_ONLY_TASK_STATUS_FILTER` in [`status-utils.ts`](file:///c:/Users/MIS/Documents/GitHub/CLOUD-LNK-TICKET-SYSTEM/src/lib/status-utils.ts)). Moving a ticket to `In Progress`, `Pending`, `Resolved`, or `Closed` immediately decrements the queue list's badge in `0ms`.
- **Auto-Committing Uncommitted Queue Input:** In `CreateSpaceModal.tsx`, if a user types a queue name into the input field (e.g., *"Urgent Repairs"*) but clicks **Create Space** without clicking the "+" button, lines 256–263 automatically commit `newListName.trim()` into `committedLists` before sending `POST /api/spaces`.
- **Instant Optimistic Tree Update:** Creating or deleting a space triggers `refreshSpaces()`, which immediately updates the sidebar hierarchy without requiring a full browser reload.

---

## 2. The 4 Interactive Workspace Views

Users can toggle between 4 views (`list`, `board`, `gantt`, `dashboard`) with zero loss of filter state.

### 2.1. `ListView.tsx` (Table & Bulk Operations View)
- **High-Density Tabular Layout:** Renders tickets with Key, Title, Employee/Department badge, Status select, Priority select, Assignee, and Submission timestamp.
- **Status Select Fallback:** Wraps the status select in `CANONICAL_STATUSES`. If `task.status.id` is not present in the current space's status list, synthesizes a fallback option so the table cell **never renders blank**.
- **Interactive Badges:**
  - **SLA Breach / Watch:** Renders an animated pulse pill showing `% elapsed` and hours remaining before breach.
  - **Collaboration Route Pill:** Shows originating department and transfer path (e.g. `📍 Safety · from Human Resources`).
  - **Checklist Ratio:** Displays `completed/total` checkmarks (e.g. `3/5`).

### 2.2. `BoardView.tsx` & `TaskCard.tsx` (Kanban Board)
- **Cross-Space Canonical Column Aggregation:**
  - In global views (`view === 'all'` or `fastView === 'collaborated'`), different departments have different status IDs.
  - `BoardView.tsx` maps every ticket to one of the 5 canonical columns (`Open`, `In Progress`, `Pending`, `Resolved`, `Closed`) via [`getStatusCategory()`](file:///c:/Users/MIS/Documents/GitHub/CLOUD-LNK-TICKET-SYSTEM/src/lib/status-utils.ts).
  - **Guaranteed Result:** Zero dropped cards; every ticket in the organization finds its corresponding column.
- **Configurable Grid Density:** Supports 3, 4, 5, or 6 columns based on `UserPreference.boardDensity`.
- **HTML5 Drag-and-Drop:**
  - `onDragStart` stages the task ID.
  - `onDrop` calls `updateTaskStatusOptimistic(taskId, targetStatus.id, targetStatus)`.
  - Polling lock `activeMutationsRef.current++` prevents incoming server polls from snapping the card backward.

### 2.3. `GanttView.tsx` (Timeline & Roadmap View)
- **Bulletproof Date Fallback Chain:**
  If a ticket lacks an explicit `startDate` or `dueDate`, `GanttView.tsx` evaluates:
  ```typescript
  let s = t.startDate ? new Date(t.startDate).getTime() : NaN;
  if (isNaN(s)) s = t.createdAt ? new Date(t.createdAt).getTime() : NaN;
  if (isNaN(s)) s = today.getTime();

  let d = t.dueDate ? new Date(t.dueDate).getTime() : NaN;
  if (isNaN(d)) d = s + 3 * 86400000; // Default 3-day window
  ```
  - **Guaranteed Result:** Completely prevents `NaNpx` CSS `left` and `width` values, rendering crisp horizontal timeline bars for every ticket.
- **Milestone Marker:** Tasks with `isMilestone: true` render as tilted diamond markers instead of capsules.
- **Zoom Scales:** Supports `day` (28px/day), `week` (140px/week), and `month` (280px/month) with auto-centering on Today.

### 2.4. `DashboardView.tsx` (Analytics & SLA Compliance View)
- **Division-by-Zero Guard:** All percentage KPI calculations guard against empty datasets:
  ```typescript
  const safeTotal = tasks.length || 1;
  const resolutionRate = (completedTasks.length / safeTotal) * 100;
  ```
  Prevents `NaN%` or `Infinity%` in empty spaces.
- **SLA Compliance Metric:** Evaluates target resolution hours against actual elapsed business time using [`evaluateTaskSla()`](file:///c:/Users/MIS/Documents/GitHub/CLOUD-LNK-TICKET-SYSTEM/src/lib/sla.ts).
- **Workload Heatmaps:** Charts ticket intake vs resolution by department and queue.

---

## 3. Drawers & Modals

### 3.1. `TaskDetailDrawer.tsx` (Notion / Linear-Style Inspection Drawer)
- **0ms Instant Pre-Hydration (Zero Blocking Spinner):**
  - When a ticket is clicked in `ListView`, `BoardView`, or `GanttView`, `TaskDetailDrawer.tsx` synchronously seeds its initial state on frame `0` (`0ms`) via `resolveAndNormalizeSeededTask(taskId, initialTask, workspaceTasks, spaces)`, combining live workspace task attributes with any cached `task:detail:${taskId}` entry in [`client-cache.ts`](file:///c:/Users/MIS/Documents/GitHub/CLOUD-LNK-TICKET-SYSTEM/src/lib/client-cache.ts).
  - Never renders the full-drawer `"Loading ticket details..."` blocking spinner when a cached/live task exists (`isLoading && !task`). The ticket header, status, priority, queue, assignee, description, checklist, custom fields, and attachments render immediately in `0ms`.
  - Hydrates full `comments` and `history` in the background via `GET /api/tasks/${taskId}` (which executes `getAuthenticatedUser` and a single `relationLoadStrategy: 'join'` query in parallel via `Promise.all` and validates RBAC clearance in memory), storing the result in `setClientCache('task:detail:' + taskId, fetchedTask, 60_000)` and caching `/api/users/mentions` for 5 minutes (`300_000ms`).
- **Custom Dark Status Popover:**
  - Replaced native OS select with a dark-themed popover:
    `z-50 bg-[#14171F] border border-white/10 rounded-lg shadow-2xl py-1 backdrop-blur-md`
  - Floats cleanly on a `relative z-30` parent over the `Assignee` field without clipping.
  - Always renders all 5 canonical statuses with colored dots and checkmarks.
- **Inline Autosave Title & Description:** Clicking the title or description enters edit mode; pressing Enter or clicking the checkmark saves via `PATCH /api/tasks/[id]`.
- **File Lightbox Modal:** Fullscreen modal with image zoom and download controls for image attachments.
- **Real-Time Event Listener:** Subscribes to `subscribeToRealTimeEvents` to append comments and update task status live when other users modify the ticket.

### 3.2. `CreateTicketModal.tsx` (Universal Intake Modal)
- Department space selector, queue list selector, priority toggle.
- **Streamlined Direct Intake:** Removed legacy "Quick Fill Templates" banner to simplify the intake flow and reduce modal clutter.
- **Eager Attachment Staging:** Uploads files immediately upon drop, providing XHR percentage progress bars (`0%` -> `100%`) before submission.

### 3.3. `TicketResolutionHandoffModal.tsx`
- Supports two operations:
  1. **Transfer (`TRANSFER`):** Moves ticket to a new department space and queue with handoff notes, tagging `originSpaceId`.
  2. **Resolution (`CLOSE`):** Closes the ticket with handover resolution notes.
- **State Initialization Guard (`wasOpenRef` & `initializedTaskIdRef`):** Only initializes `action` (`'CLOSE'` vs `'TRANSFER'`), `selectedSpaceId`, `selectedListId`, and `notes` when the modal transitions from closed to open (`!wasOpenRef.current && isOpen`) or when `task.id` changes to a different ticket. Also holds `beginTaskMutation()` while open so background delta-sync polling never resets the user's radio selection.

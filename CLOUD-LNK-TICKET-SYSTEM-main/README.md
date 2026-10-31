# L&K Industries Enterprise Ticketing Platform

An on-premise, 100% offline, air-gapped ClickUp-style service desk and workflow orchestration engine designed for local company networks.

---
## Core System Modules

### 1. 4-Mode Workspace Views
- **Board View (Default Kanban)**: Automatically detects statuses in the active space (5 canonical columns up to 6 custom columns), interactive column density toggle (`3 | 4 | 5`), subtask progress pills (`☑ X/Y`), comment counters, and one-click `< >` status movement.
- **List View (High-Density Grid)**: `table-fixed` tabular queue with status grouping, custom status renaming, priority badges, and inline triage.
- **Gantt View (Roadmap Timeline)**: Distraction-free single-canvas visual roadmap with task capsule bars, milestone diamond markers (`◆`), floating avatars, and sticky two-tier calendar header with `TODAY` indicator.
- **Dashboard View (Executive Analytics)**: Live KPI cards, SLA compliance metrics, pure CSS/SVG workload charts, SLA breach watchlist, and team capacity tables.

### 2. ViewToolbar & Historical Date Range Filter
- Real-time search across ticket keys (`MIS-101`) and titles.
- Multi-parameter filter dropdowns (`Status`, `Priority`, `Assignee`).
- Custom 2-column Date Range Filter with one-click presets (`All Time`, `Today`, `Last 7 Days`, `Last 30 Days`, `Last 90 Days`, `This Year`) and custom start/end date calendar picker.

### 3. Department Isolation & Collaborations
- Granular clearance matrix across Superadmins, Department Leads (`👑`), Staff, and Requesters.
- Isolated department queues (`Accounting`, `Facilities`, `HR`, `MIS`, `Purchasing`, `QA`, `Safety`).
- Seamless cross-department ticket transfers and resolution handoffs tracked under the **Collaborated** view.

### 4. Dual Theme Engine
- **Dark Mode**: High-contrast deep slate/zinc theme (`#09090B` / `#18181B`).
- **Soft Daylight Light Mode**: Low-glare 4-tier muted cool-stone palette (`#E2E6EE` shell, `#EAEEF4` canvas, `#F4F6F9` cards, `#E5E9F0` inputs) engineered to prevent screen flashbang and eye strain.

---

## CLI Execution & Verification Commands

```bash
# Push Prisma schema to SQLite
npm run prisma:push

# Seed demo users, spaces, and tickets
npm run seed

# Run date range filter & historical query scoping tests (27 tests)
npx tsx scripts/test-date-range-filter.ts

# Run Gantt roadmap & executive dashboard tests (35 tests)
npx tsx scripts/test-gantt-dashboard.ts

# Run subtask checklists, LAN attachments & templates tests (31 tests)
npx tsx scripts/test-checklists-attachments-templates.ts

# Run theme engine persistence & user preferences test
npx tsx scripts/test-theme-engine.ts

# Run Kanban board density tests (17 tests)
npx tsx scripts/test-board-view-density.ts

# Run Phase 1 security verification tests (7 tests)
npm run test:security

# Run Phase 2 authentication and user management tests (5 tests)
npm run test:auth

# Run Phase 3 ClickUp shell and navigation tests (6 tests)
npm run test:navigation

# View security audit logs recorded during unauthorized attempts
npm run audit:view

# Run TypeScript compilation check
npx tsc --noEmit

# Start local Next.js development server
npm run dev
```

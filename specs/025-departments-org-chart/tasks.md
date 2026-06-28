# Tasks: Departments Org Chart V2

**Branch**: `025-departments-org-chart` | **Date**: 2026-03-19  
**Plan**: [plan.md](./plan.md) | **Spec**: [spec.md](./spec.md)

## Phase 1: Setup

- [X] T1.1 — Install `@xyflow/react` and `@dagrejs/dagre` in `frontend/apps/web` via pnpm

## Phase 2: Core Components

- [X] T2.1 — Create `DepartmentOrgNode.tsx` (custom React Flow node)
  - Display department name (bold), manager section (lazy-loaded), member/child counts
  - Hover-reveal action buttons: Edit, Move, Add Sub-dept, Add Employee, Assign Manager
  - All `data-testid` attributes
  - All colors via `useThemeColors()` — no hardcoded hex/rgb
  - No manager warning (amber "⚠ No manager" when `managerCount === 0`)

- [X] T2.2 — Create `DepartmentOrgChart.tsx` (React Flow canvas + dagre layout)
  - Import `ReactFlow`, `Background`, `Controls`, `MiniMap` from `@xyflow/react`
  - Import `dagre` from `@dagrejs/dagre`
  - Accept `departments: department.Department[]` and action callbacks as props
  - Run dagre layout (TB direction, nodesep: 80, ranksep: 120)
  - Compute `nodes[]` and `edges[]` from departments
  - Handle empty state ("No departments yet")
  - Register `DepartmentOrgNode` as custom node type
  - `fitView` on initial load and data changes

## Phase 3: Integration

- [X] T3.1 — Modify `DepartmentsTab.tsx`
  - Add `useMediaQuery` (or equivalent) to detect mobile (< 768px)
  - Add `forceListView` state
  - Compute `showListView = isMobile || forceListView`
  - Add view toggle button in action bar ("Switch to List View" / "Switch to Org Chart")
  - Conditionally render `DepartmentOrgChart` vs. `DepartmentTreeView`
  - Pass all dialog handlers to `DepartmentOrgChart`
  - Keep all existing dialog logic unchanged

- [X] T3.2 — Add expand-to-show-members feature to org chart nodes
  - Clickable "N members" toggle at bottom of each node to expand/collapse member list
  - Expanded node shows scrollable member list (managers with MGR badge first, then regular members)
  - Dynamic dagre layout recomputes node heights when expanded
  - Max 5 visible members before scroll
  - Uses existing `getDepartmentMembers` lazy query
  - Chevron icon (ExpandMore/ExpandLess) indicates expand state

## Phase 4: Verification

- [X] T4.1 — Run TypeScript type check: `cd frontend && pnpm --filter web exec tsc --noEmit`
- [X] T4.2 — Run lint: `cd frontend && pnpm --filter web lint`
- [ ] T4.3 — Manual verification walkthrough (acceptance scenarios S1.1–S2.7, E1–E4)
- [ ] T4.4 — Backend regression check: `cd backend && go test ./integration/... -timeout 120s`

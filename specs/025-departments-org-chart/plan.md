# Implementation Plan: Departments Org Chart V2

**Branch**: `025-departments-org-chart` | **Date**: 2026-03-19 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/025-departments-org-chart/spec.md`

## Summary

Replace the existing collapsible tree-list view for department management with a visual, node-based organizational chart. The org chart renders departments as rectangular nodes connected by edges showing parent-child relationships, supports fluid pan/zoom navigation, shows department names and assigned managers within nodes, and exposes all existing CRUD actions from inline hover buttons on each node. On mobile screens (< 768px), the existing list-view automatically serves as the fallback. **No backend changes are required** — all existing `DepartmentService` RPC methods are fully adequate. Two new frontend components will be added: `DepartmentOrgChart` (React Flow canvas with dagre hierarchical layout) and `DepartmentOrgNode` (custom node). `DepartmentsTab` will be updated to add a view toggle and render the new chart.

## Technical Context

**Language/Version**: TypeScript 5.x  
**Primary Dependencies**:
- `@xyflow/react` (v12+) — React Flow: interactive node-based canvas with pan/zoom
- `@dagrejs/dagre` (v1+) — hierarchical layout algorithm (TB direction for org charts)
- `@tanstack/react-query` (v5, already installed) — data fetching and cache
- `tailwindcss` v4 (already installed) — utility styling
- `useThemeColors` hook (already present) — theme system compliance

**Storage**: N/A — pure frontend

**Testing**: No new backend integration tests (exclusion justified — see Constitution Check). Manual + visual testing via dev server.

**Target Platform**: Web browser (Next.js 15 App Router, React 19). Desktop-first with mobile fallback.

**Project Type**: Web application (frontend-only change)

**Performance Goals**: Render 100+ department nodes at 60fps with React Flow virtualization (SC-003). Sub-100ms layout computation via dagre.

**Constraints**:
- All colors MUST use `useThemeColors()` hook — no hardcoded hex/rgb values (Principle VII)  
- All interactive elements MUST have `data-testid` attributes (Principle VII)  
- No new backend APIs or proto changes  
- Must reuse existing dialog components for CRUD actions  
- Must use `DepartmentMemberRole` constant when filtering members — no string literals (Principle VIII)

**Scale/Scope**: Typical org: 20–100 departments. Maximum tested: 500+ nodes (React Flow virtualization handles this).

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
frontend/
└── apps/
    └── web/
        └── src/
            └── app/
                └── workspace/
                    └── organization/
                        └── components/
                            ├── DepartmentsTab.tsx       # MODIFY: add view toggle + render OrgChart
                            ├── DepartmentOrgChart.tsx   # NEW: React Flow canvas + dagre layout
                            ├── DepartmentOrgNode.tsx    # NEW: custom node component
                            ├── DepartmentTreeView.tsx   # KEEP: mobile/list-view fallback
                            ├── DepartmentNode.tsx       # KEEP: mobile/list-view fallback
                            ├── CreateDepartmentDialog.tsx  # KEEP unchanged
                            ├── EditDepartmentDialog.tsx    # KEEP unchanged
                            ├── MoveDepartmentDialog.tsx    # KEEP unchanged
                            ├── AssignManagerDialog.tsx     # KEEP unchanged
                            └── AddEmployeeDialog.tsx       # KEEP unchanged
```

**Structure Decision**: Frontend-only web application (Option 2 collapsed to frontend-only). No backend source changes. New components added alongside existing components in the organization features directory.

## Constitution Check

### Principle I — Data Governance (N/A)
✅ No database or backend changes. Existing `organization.department` schema unchanged.

### Principle II — Scenario-First Integration Testing

**⚠ Exclusion Documented**:
- **User Story 1** (View Org Chart) — Describes frontend visualization only. The underlying data contract is proven by the existing `TestDepartment` integration test exercising `GetDepartmentTree`. No new backend test needed.
- **User Story 2** (Manage Departments within Org Chart) — Describes frontend UI actions only. All backend CRUD behaviors (`CreateDepartment`, `UpdateDepartment`, `DeleteDepartment`, `MoveDepartment`, `AssignEmployeeToDepartment`) are already covered by `TestDepartment` in `backend/integration/department_test.go`.
- **No new RPC endpoints** are added; **no new backend business logic** is introduced.
- **Justification**: This feature is a pure frontend UI redesign. Backend behavioral contract is fully established by existing tests. Adding redundant integration tests would test React rendering behavior, not backend correctness — this is outside the scope of backend integration testing.

### Principle III — Two-Layer Architecture (N/A)
✅ No new backend services or proto definitions.

### Principle IV — Cross-Domain Integration (N/A)
✅ No cross-domain data access changes.

### Principle V — Observability (N/A)
✅ No backend logic changes. Frontend uses standard console telemetry via React Query DevTools.

### Principle VII — Frontend API Wrapper Pattern ✅
- New components import from `apis` package only, never direct `rpc` imports
- `getDepartmentTree()` and `getDepartmentMembers()` wrapper functions already exist in `packages/apis/src/department.ts`
- All interactive elements MUST have `data-testid` attributes — enforced in `DepartmentOrgNode`
- All colors MUST use `useThemeColors()` hook — enforced in both new components

### Principle VIII — Cross-Stack Constant Synchronization ✅
- `DepartmentMemberRole` constant already defined in `packages/apis/src/department.ts`
- New components use `DepartmentMemberRole` type when filtering managers — no string literals

### Principle IX — UUID & Pagination (N/A)
✅ No new query parameters or UUID handling.

### Principle X — Structured Errors (N/A)
✅ No new error scenarios introduced.

### Principle XI — Distributed-First Architecture (N/A)
✅ Pure frontend; no stateful backend resources.

### Principle XII — Architecture Documentation (N/A)
✅ No backend domain, service layer, or cross-domain dependency changes. Frontend component restructuring does not require architecture document updates.

**Post-Design Gate**: ✅ PASS — No constitutional violations. Pure frontend feature with documented integration test exclusion.

---

## Test Scenarios (Behavioral Contract)

*These scenarios are derived from User Stories and FR-XXX requirements. Because this is a pure frontend UI redesign with no new backend behavior, no `backend/integration/` test file is created. The exclusion is documented above in Principle II. These scenarios serve as the manual/visual acceptance checklist.*

### User Story 1 — View Organization Hierarchy (FR-001, FR-002, FR-003)

| # | Scenario | Acceptance Criteria |
|---|---|---|
| S1.1 | Departments tab loads and displays org chart canvas | A rectangular node appears for each department; nodes are connected by edges showing parent-child relationships; no flat list is shown |
| S1.2 | Pan navigation works | User can click-drag on empty canvas area to pan; chart position shifts accordingly |
| S1.3 | Zoom navigation works | Scroll wheel zooms in and out; buttons (+/-) visible on canvas also zoom; Ctrl+scroll also works |
| S1.4 | Each node shows department name | Department name is visible in bold text within the node |
| S1.5 | Each node shows manager name when assigned | Manager's name appears below the department name |
| S1.6 | Unmanaged departments show warning indicator | Nodes with `managerCount === 0` show "⚠ No manager" in amber text |
| S1.7 | Root departments appear at the top of the hierarchy | Root departments (no parent) are positioned at the top row of the dagre layout |
| S1.8 | Deep hierarchies render correctly | A 3-level deep hierarchy renders with 3 rows of nodes; edges correctly connect parent to children |
| S1.9 | 100+ node chart renders without stuttering | SC-003: Navigating (pan/zoom) a 100+ node chart maintains smooth interaction |

### User Story 2 — Manage Departments within Org Chart (FR-004)

| # | Scenario | Acceptance Criteria |
|---|---|---|
| S2.1 | Hovering a node reveals action buttons | Edit, Move, Add Sub-dept, and Add Employee buttons appear on node hover |
| S2.2 | Edit action opens Edit dialog | Clicking "Edit" on a node opens `EditDepartmentDialog` pre-populated with department name/description |
| S2.3 | Add Sub-dept action opens Create dialog with parent pre-set | Clicking "Add Sub-dept" opens `CreateDepartmentDialog` with `parentDepartmentId` set to the hovered department |
| S2.4 | Add Employee action opens employee assignment dialog | Clicking "Add Employee" opens `AddEmployeeDialog` for the correct department |
| S2.5 | Move action opens Move dialog | Clicking "Move" opens `MoveDepartmentDialog` for the correct department |
| S2.6 | After creating a sub-department, org chart updates | React Query cache invalidated; new node appears under its parent connected by an edge |
| S2.7 | After deleting a department, org chart updates | Deleted node disappears from canvas; tree re-layouts |

### Edge Cases (FR-005, spec edge cases)

| # | Scenario | Acceptance Criteria |
|---|---|---|
| E1 | Mobile screen (< 768px) auto-switches to list view | `DepartmentTreeView` component renders instead of React Flow canvas |
| E2 | Manual view toggle on desktop | "Switch to List View" button shows list; "Switch to Org Chart" shows canvas |
| E3 | Empty organization (no departments) | Empty state message shown: "No departments yet" with create prompt |
| E4 | Single root department | One node renders at center of canvas with no edges |

---

## Phase 2 Planning (for `/speckit-tasks`)

When `tasks.md` is generated, the task breakdown should cover:

1. **Install dependencies** — Add `@xyflow/react` and `@dagrejs/dagre` to `frontend/apps/web/package.json` via pnpm; verify TypeScript types resolve
2. **Create `DepartmentOrgNode` component** — Custom React Flow node; display name, manager section, member count, action buttons on hover; all `data-testid` attributes; all colors via `useThemeColors()`
3. **Create `DepartmentOrgChart` component** — React Flow canvas; run dagre layout on department tree data; compute `nodes[]` and `edges[]`; handle empty state; expose React Flow `fitView` on data change
4. **Modify `DepartmentsTab`** — Add `showListView` state + responsive detection; add view toggle button; conditionally render `DepartmentOrgChart` vs `DepartmentTreeView`; pass all dialog handlers down
5. **Style integration** — Apply `useThemeColors()` to all newly created elements; verify dark mode works on both org chart and node components
6. **Manual verification** — Walk through all acceptance scenarios S1.1–S2.7 and E1–E4 in dev environment; confirm 100+ node performance (SC-003)
7. **Regression check** — Run `cd backend && go test ./integration/... -timeout 120s` to verify zero regressions

---

## Artifacts

| Artifact | Path | Status |
|---|---|---|
| Feature Spec | `specs/025-departments-org-chart/spec.md` | ✅ |
| Implementation Plan | `specs/025-departments-org-chart/plan.md` | ✅ (this file) |
| Research | `specs/025-departments-org-chart/research.md` | ✅ |
| Data Model | `specs/025-departments-org-chart/data-model.md` | ✅ |
| Contracts | `specs/025-departments-org-chart/contracts/README.md` | ✅ (N/A — no new APIs) |
| Quickstart | `specs/025-departments-org-chart/quickstart.md` | ✅ |
| Tasks | `specs/025-departments-org-chart/tasks.md` | ⏳ (Phase 2 — run `/speckit-tasks`) |

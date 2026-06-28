# Quickstart: Departments Org Chart V2

**Feature**: Departments Org Chart V2 (spec-025)  
**Date**: 2026-03-19  
**Purpose**: Developer guide for running and verifying the org chart feature

## Prerequisites

No backend changes — only frontend development required.

## Setup

```bash
# Install new frontend dependencies
cd frontend
pnpm --filter web add @xyflow/react @dagrejs/dagre

# Start dev server
pnpm --filter web dev
```

## Navigating to the Org Chart

1. Log in with an owner or operator account
2. Navigate to **Workspace → Organization** (sidebar)
3. Click the **Departments** tab

The org chart is displayed on the Departments tab. If you are on a mobile screen (< 768px), the fallback list view will be shown automatically.

## Toggle Between Views

On the Departments tab header, a toggle button ("Switch to List View" / "Switch to Org Chart") allows switching between the new org chart and the original tree list view at any screen size.

## Seeding Test Data

Use the dev environment to create departments with hierarchy:

```typescript
// In browser console or via existing test setup:
// Create Engineering (root)
// Create Frontend (under Engineering)  
// Create Backend (under Engineering)
// Create QA (root)
// Assign employees and managers
```

Or use the existing integration test fixtures — run the backend integration tests which create department hierarchies as part of the test setup:

```bash
cd backend
go test ./integration/... -run TestDepartment -v
```

## Verifying Org Chart Renders Correctly

After seeding data:

1. **FR-001**: Departments appear as rectangular nodes connected by edges (not a flat list)
2. **FR-002**: You can drag on the canvas to pan; use scroll wheel to zoom in/out; use the minimap in the bottom-right corner
3. **FR-003**: Each node shows department name (bold) and manager name (or "⚠ No manager" in amber)
4. **FR-004**: Hover over any node to reveal action buttons: Edit, Move, Add Sub-dept, Add Employee

## Verifying Mobile Fallback (FR-005)

Resize the browser to < 768px width (or use DevTools mobile emulation). The page automatically switches to the list view. The "Switch to Org Chart" toggle button remains visible so users can manually enable the chart even on small screens.

## New Component Locations

| File | Purpose |
|---|---|
| `frontend/apps/web/src/app/workspace/organization/components/DepartmentOrgChart.tsx` | React Flow canvas with dagre layout |
| `frontend/apps/web/src/app/workspace/organization/components/DepartmentOrgNode.tsx` | Custom node component |
| `frontend/apps/web/src/app/workspace/organization/components/DepartmentsTab.tsx` | Modified to add view toggle |

## Useful Commands

```bash
# Type check frontend
cd frontend && pnpm --filter web exec tsc --noEmit

# Lint frontend
cd frontend && pnpm --filter web lint

# Run full backend integration suite (regression check)
cd backend && go test ./integration/... -v -timeout 120s
```

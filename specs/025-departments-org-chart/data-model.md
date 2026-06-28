# Data Model: Departments Org Chart V2

**Feature**: Departments Org Chart V2 (spec-025)  
**Date**: 2026-03-19  
**Status**: Complete

## Overview

This feature introduces **no database or API changes**. The existing `organization.department` table and `DepartmentService` RPC definitions are fully adequate. This document captures the frontend component data contracts and state shape.

---

## Backend Data (No Changes)

### Source of Truth: `GetDepartmentTree` Response

The org chart consumes `GetDepartmentTreeResponse` from the existing API. Each `Department` message includes:

```protobuf
message Department {
  string id = 1;                        // UUID v7 — React Flow node ID
  string organization_id = 2;           // Tenant isolation (not displayed)
  string name = 3;                      // Displayed as node title
  string description = 4;               // Displayed as node subtitle/tooltip
  string parent_department_id = 5;      // Used to build dagre edges
  int32 member_count = 6;               // Displayed in node footer
  int32 manager_count = 7;              // Used to show "No manager" warning
  int32 child_count = 8;                // Displayed in node footer
  string updated_at = 9;                // Not displayed in org chart
  repeated string path = 10;            // Not used by org chart (used by list view)
  int32 depth = 11;                     // Used by list-view fallback
  string full_path = 12;                // Not used by org chart
}
```

Manager names are fetched lazily per-node via `GetDepartmentMembers` (already implemented in `DepartmentNode.tsx`).

---

## Frontend Component Data Contracts

### `DepartmentOrgChart` Component Props

```typescript
interface DepartmentOrgChartProps {
  /** Flat list of departments returned by GetDepartmentTree */
  departments: department.Department[];
  /** Called when user requests to create a new sub-department */
  onCreateChild: (parentId: string) => void;
  /** Called when user requests to edit a department */
  onEdit: (departmentId: string) => void;
  /** Called when user requests to move a department */
  onMove: (departmentId: string) => void;
  /** Called when user requests to add an employee */
  onAddEmployee: (departmentId: string) => void;
  /** Called when user requests to assign a manager */
  onAssignManager: (departmentId: string) => void;
}
```

### `DepartmentOrgNode` Custom Node Data

React Flow custom nodes receive data via the `data` field. The shape for `DepartmentOrgNode`:

```typescript
interface DepartmentNodeData {
  /** The full Department proto message */
  department: department.Department;
  /** Action callbacks (passed through from DepartmentOrgChart) */
  onEdit: (departmentId: string) => void;
  onMove: (departmentId: string) => void;
  onAddEmployee: (departmentId: string) => void;
  onAssignManager: (departmentId: string) => void;
  onCreateChild: (parentId: string) => void;
}
```

### Layout Computation Output

After `dagre.layout()` runs, each department node gets an `(x, y)` position:

```typescript
interface ComputedLayout {
  nodes: Node<DepartmentNodeData>[];   // @xyflow/react Node type
  edges: Edge[];                        // @xyflow/react Edge type
}
```

**Node dimensions used for layout**: `NODE_WIDTH = 220`, `NODE_HEIGHT = 96` — these are constants, not dynamic, so dagre can space them correctly.

---

## State Management

No new global state is required. State lives in the component tree:

| State | Location | Type | Purpose |
|---|---|---|---|
| `departments` | `DepartmentsTab` | React Query cache | Source data from GetDepartmentTree |
| `showListView` | `DepartmentsTab` | `boolean` | Toggle between org chart and list view |
| `selectedDepartmentId` | `DepartmentsTab` | `string \| null` | Which department dialog is open for |
| `reactFlowNodes` | `DepartmentOrgChart` | `Node[]` | Computed from `departments` + dagre |
| `reactFlowEdges` | `DepartmentOrgChart` | `Edge[]` | Derived: parent → child relationships |
| `memberData` | `DepartmentOrgNode` | React Query cache | Lazy-loaded via getDepartmentMembers |

---

## Constants (No Changes to Existing)

The following existing constants remain unchanged and must be referenced by the new components:

```typescript
// packages/apis/src/department.ts — already defined
export type DepartmentMemberRole = 'member' | 'manager';
```

The new components MUST use `DepartmentMemberRole` when filtering members:
```typescript
const managers = members.filter(m => m.role === ('manager' satisfies DepartmentMemberRole));
```

---

## No Data Migrations Required

Since this is a pure frontend change, there are no schema migrations, no sqlc regeneration, and no protobuf regeneration required.

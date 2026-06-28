# Contracts: Departments Org Chart V2

**Feature**: Departments Org Chart V2 (spec-025)  
**Status**: N/A — No new contracts

## Why No New Contracts

This feature is a **pure frontend UI redesign**. It introduces no new RPC endpoints, no new API surface, and no changes to existing proto definitions. All department management operations use the existing `DepartmentService` RPC methods unchanged.

The existing API contracts are documented in:
- `backend/rpc/v1/department.proto` — Full service definition
- `frontend/packages/apis/src/department.ts` — Frontend wrapper functions

## Existing API Surface (Unchanged)

All the following methods remain unchanged and are reused by the new org chart UI:

| Method | Used by Org Chart for |
|---|---|
| `GetDepartmentTree` | Fetching all departments to render as nodes |
| `GetDepartmentMembers` | Lazy-loading manager names for nodes |
| `CreateDepartment` | "Add Sub-department" action on nodes |
| `UpdateDepartment` | "Edit" action on nodes |
| `MoveDepartment` | "Move" action on nodes |
| `DeleteDepartment` | "Delete" action on nodes |
| `AssignEmployeeToDepartment` | "Add Employee" action on nodes |
| `SetDepartmentManager` | "Assign Manager" action on nodes |
| `ClearDepartmentManager` | "Remove Manager" action on nodes |

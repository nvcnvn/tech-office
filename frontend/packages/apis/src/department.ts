/**
 * Department API functions
 * ConnectRPC-based API calls for department management
 */

import { departmentClient } from "./rpc";
import rpcCall from "./rpcWrapper";
import { department } from "rpc";

// Type aliases for RPC responses
type GetDepartmentTreeResponse = department.GetDepartmentTreeResponse;
type GetDepartmentResponse = department.GetDepartmentResponse;
type GetDepartmentMembersResponse = department.GetDepartmentMembersResponse;
type GetUnassignedEmployeesResponse = department.GetUnassignedEmployeesResponse;
type CreateDepartmentResponse = department.CreateDepartmentResponse;
type UpdateDepartmentResponse = department.UpdateDepartmentResponse;
type MoveDepartmentResponse = department.MoveDepartmentResponse;
type DeleteDepartmentResponse = department.DeleteDepartmentResponse;
type AssignEmployeeToDepartmentResponse = department.AssignEmployeeToDepartmentResponse;
type RemoveEmployeeFromDepartmentResponse = department.RemoveEmployeeFromDepartmentResponse;
type SetDepartmentManagerResponse = department.SetDepartmentManagerResponse;
type ClearDepartmentManagerResponse = department.ClearDepartmentManagerResponse;

/**
 * Department member role constants.
 * 
 * MUST align with:
 * - Database CHECK constraint: organization.department_member.role
 * - Backend Go constants: internal/department/constants.go
 * 
 * When adding/removing values:
 * 1. Update database CHECK constraint in backend/database/scripts/schema.sql
 * 2. Update backend Go constants
 * 3. Update this TypeScript type
 * 4. Submit all changes in single PR with alignment verification
 */
export type DepartmentMemberRole = 'member' | 'manager';


/**
 * Get the full department hierarchy tree for the current organization.
 * Returns departments in depth-first order with path and depth information.
 */
export async function getDepartmentTree(): Promise<GetDepartmentTreeResponse> {
	return rpcCall(async () => {
		const resp = await departmentClient.getDepartmentTree({});
		return resp as GetDepartmentTreeResponse;
	});
}

/**
 * Get a single department by ID with member/manager counts.
 */
export async function getDepartment(departmentId: string): Promise<GetDepartmentResponse> {
	return rpcCall(async () => {
		const resp = await departmentClient.getDepartment({ departmentId });
		return resp as GetDepartmentResponse;
	});
}

/**
 * Get all employees in a department (managers first, then alphabetically sorted).
 */
export async function getDepartmentMembers(departmentId: string): Promise<GetDepartmentMembersResponse> {
	return rpcCall(async () => {
		const resp = await departmentClient.getDepartmentMembers({ departmentId });
		return resp as GetDepartmentMembersResponse;
	});
}

/**
 * Get employees not assigned to any department.
 */
export async function getUnassignedEmployees(): Promise<GetUnassignedEmployeesResponse> {
	return rpcCall(async () => {
		const resp = await departmentClient.getUnassignedEmployees({});
		return resp as GetUnassignedEmployeesResponse;
	});
}

/**
 * Create a new department with optional parent (for nesting).
 * Only OWNER and OPERATOR can create departments.
 */
export async function createDepartment(params: {
	name: string;
	description?: string;
	parentDepartmentId?: string;
}): Promise<CreateDepartmentResponse> {
	return rpcCall(async () => {
		const resp = await departmentClient.createDepartment(params);
		return resp as CreateDepartmentResponse;
	});
}

/**
 * Update department name and/or description.
 * Only OWNER and OPERATOR can update departments.
 */
export async function updateDepartment(params: {
	departmentId: string;
	name: string;
	description?: string;
}): Promise<UpdateDepartmentResponse> {
	return rpcCall(async () => {
		const resp = await departmentClient.updateDepartment(params);
		return resp as UpdateDepartmentResponse;
	});
}

/**
 * Move a department to a new parent (restructuring hierarchy).
 * Validates against circular references.
 * Only OWNER and OPERATOR can move departments.
 */
export async function moveDepartment(params: {
	departmentId: string;
	newParentId?: string;
}): Promise<MoveDepartmentResponse> {
	return rpcCall(async () => {
		const resp = await departmentClient.moveDepartment(params);
		return resp as MoveDepartmentResponse;
	});
}

/**
 * Delete a department (must have no members or children).
 * Only OWNER and OPERATOR can delete departments.
 */
export async function deleteDepartment(departmentId: string): Promise<DeleteDepartmentResponse> {
	return rpcCall(async () => {
		const resp = await departmentClient.deleteDepartment({ departmentId });
		return resp as DeleteDepartmentResponse;
	});
}

/**
 * Assign an employee to a department as member or manager.
 * OWNER/OPERATOR can assign anyone; managers can only assign unassigned employees to their own department.
 */
export async function assignEmployeeToDepartment(params: {
	departmentId: string;
	employeeId: string;
	role: string;
}): Promise<AssignEmployeeToDepartmentResponse> {
	return rpcCall(async () => {
		const resp = await departmentClient.assignEmployeeToDepartment(params);
		return resp as AssignEmployeeToDepartmentResponse;
	});
}

/**
 * Remove an employee from their current department.
 * Only OWNER and OPERATOR can remove employees.
 */
export async function removeEmployeeFromDepartment(employeeId: string): Promise<RemoveEmployeeFromDepartmentResponse> {
	return rpcCall(async () => {
		const resp = await departmentClient.removeEmployeeFromDepartment({ employeeId });
		return resp as RemoveEmployeeFromDepartmentResponse;
	});
}

/**
 * Designate an employee as manager of a department.
 * Employee must already be a member of the department.
 * Only OWNER and OPERATOR can set managers.
 */
export async function setDepartmentManager(params: {
	departmentId: string;
	employeeId: string;
}): Promise<SetDepartmentManagerResponse> {
	return rpcCall(async () => {
		const resp = await departmentClient.setDepartmentManager(params);
		return resp as SetDepartmentManagerResponse;
	});
}

/**
 * Remove manager designation from a department.
 * Employee remains a member of the department.
 * Only OWNER and OPERATOR can clear managers.
 */
export async function clearDepartmentManager(departmentId: string): Promise<ClearDepartmentManagerResponse> {
	return rpcCall(async () => {
		const resp = await departmentClient.clearDepartmentManager({ departmentId });
		return resp as ClearDepartmentManagerResponse;
	});
}

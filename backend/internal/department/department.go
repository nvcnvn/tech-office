package department

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/nvcnvn/tech-office/backend/database"
	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/internal/converter"
	"github.com/nvcnvn/tech-office/backend/internal/interceptor"
	v1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/nvcnvn/tech-office/backend/rpc/v1/rpcv1connect"
)

// DepartmentService manages organizational departments with hierarchical tree structure.
// Uses TenantPool for all user-facing operations (enforces organization context).
// Uses AdminPool only for system-level operations (documented per method).
type DepartmentService struct {
	rpcv1connect.UnimplementedDepartmentServiceHandler
	AdminPool  database.AdminDatabaseConnector  // System operations (background cleanup)
	TenantPool database.TenantDatabaseConnector // User operations (tenant-isolated)
	Queries    *database.Queries
}

// NewDepartmentService creates a new DepartmentService instance.
func NewDepartmentService(
	adminPool database.AdminDatabaseConnector,
	tenantPool database.TenantDatabaseConnector,
	queries *database.Queries,
) *DepartmentService {
	return &DepartmentService{
		AdminPool:  adminPool,
		TenantPool: tenantPool,
		Queries:    queries,
	}
}

// GetDepartmentTree retrieves the full department hierarchy for an organization.
// Uses TenantPool for read-only, tenant-isolated access.
func (s *DepartmentService) GetDepartmentTree(ctx context.Context, req *connect.Request[v1.GetDepartmentTreeRequest]) (*connect.Response[v1.GetDepartmentTreeResponse], error) {
	// Extract organization_id from auth context
	userOrgID, ok := interceptor.UserOrgIDFromContext(ctx)
	if !ok {
		slog.ErrorContext(ctx, "GetDepartmentTree: missing organization context")
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("missing organization context"))
	}

	orgUUID, err := dbuuid.Parse(userOrgID)
	if err != nil {
		slog.ErrorContext(ctx, "GetDepartmentTree: invalid organization ID", "error", err)
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid organization ID"))
	}

	// Query department tree (TenantPool ensures tenant isolation)
	departments, err := s.Queries.GetDepartmentTree(ctx, s.TenantPool, orgUUID)
	if err != nil {
		slog.ErrorContext(ctx, "GetDepartmentTree: query failed", "error", err)
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to fetch department tree"))
	}

	// Convert to proto
	protoDepts := make([]*v1.Department, len(departments))
	for i, dept := range departments {
		protoDepts[i] = converter.DepartmentTreeRowToProto(dept)
	}

	return connect.NewResponse(&v1.GetDepartmentTreeResponse{
		Departments: protoDepts,
	}), nil
}

// GetDepartment retrieves a single department by ID.
// Uses TenantPool for tenant-isolated access.
func (s *DepartmentService) GetDepartment(ctx context.Context, req *connect.Request[v1.GetDepartmentRequest]) (*connect.Response[v1.GetDepartmentResponse], error) {
	// Extract organization_id from auth context
	userOrgID, ok := interceptor.UserOrgIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("missing organization context"))
	}

	orgUUID, err := dbuuid.Parse(userOrgID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid organization ID"))
	}

	deptUUID, err := dbuuid.Parse(req.Msg.DepartmentId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid department ID"))
	}

	// Query department
	dept, err := s.Queries.GetDepartmentByID(ctx, s.TenantPool, &database.GetDepartmentByIDParams{
		ID:             deptUUID,
		OrganizationID: orgUUID,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("department not found"))
	}

	return connect.NewResponse(&v1.GetDepartmentResponse{
		Department: converter.DepartmentToProto(dept),
	}), nil
}

// GetDepartmentMembers lists all employees in a department.
// Uses TenantPool for tenant-isolated access.
func (s *DepartmentService) GetDepartmentMembers(ctx context.Context, req *connect.Request[v1.GetDepartmentMembersRequest]) (*connect.Response[v1.GetDepartmentMembersResponse], error) {
	// Extract organization_id from auth context
	userOrgID, ok := interceptor.UserOrgIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("missing organization context"))
	}

	orgUUID, err := dbuuid.Parse(userOrgID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid organization ID"))
	}

	deptUUID, err := dbuuid.Parse(req.Msg.DepartmentId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid department ID"))
	}

	// Query members
	members, err := s.Queries.GetDepartmentMembers(ctx, s.TenantPool, &database.GetDepartmentMembersParams{
		DepartmentID:   deptUUID,
		OrganizationID: orgUUID,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to fetch department members"))
	}

	// Convert to proto
	protoMembers := make([]*v1.DepartmentMember, len(members))
	for i, member := range members {
		protoMembers[i] = converter.DepartmentMemberToProto(member)
	}

	return connect.NewResponse(&v1.GetDepartmentMembersResponse{
		Members: protoMembers,
	}), nil
}

// GetUnassignedEmployees lists employees not assigned to any department.
// Uses TenantPool for tenant-isolated access.
func (s *DepartmentService) GetUnassignedEmployees(ctx context.Context, req *connect.Request[v1.GetUnassignedEmployeesRequest]) (*connect.Response[v1.GetUnassignedEmployeesResponse], error) {
	// Extract organization_id from auth context
	userOrgID, ok := interceptor.UserOrgIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("missing organization context"))
	}

	orgUUID, err := dbuuid.Parse(userOrgID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid organization ID"))
	}

	// Query unassigned employees
	employees, err := s.Queries.GetUnassignedEmployees(ctx, s.TenantPool, orgUUID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to fetch unassigned employees"))
	}

	// Convert to proto
	protoEmployees := make([]*v1.UnassignedEmployee, len(employees))
	for i, emp := range employees {
		protoEmployees[i] = converter.UnassignedEmployeeToProto(emp)
	}

	return connect.NewResponse(&v1.GetUnassignedEmployeesResponse{
		Employees: protoEmployees,
	}), nil
}

// CreateDepartment creates a new department with optional parent.
// Uses TenantPool for tenant-isolated write operation.
// Only OWNER and OPERATOR can create departments (enforced by proto access_control).
func (s *DepartmentService) CreateDepartment(ctx context.Context, req *connect.Request[v1.CreateDepartmentRequest]) (*connect.Response[v1.CreateDepartmentResponse], error) {
	// Extract organization_id from auth context
	userOrgID, ok := interceptor.UserOrgIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("missing organization context"))
	}

	orgUUID, err := dbuuid.Parse(userOrgID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid organization ID"))
	}

	// Validate input
	if req.Msg.Name == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("department name is required"))
	}

	// Prepare create params
	params := &database.CreateDepartmentParams{
		OrganizationID: orgUUID,
		Name:           req.Msg.Name,
		Description:    pgtype.Text{String: req.Msg.Description, Valid: req.Msg.Description != ""},
	}

	// Parse parent_department_id if provided
	var parentUUID dbuuid.UUID
	hasParent := false
	if req.Msg.ParentDepartmentId != "" {
		var err error
		parentUUID, err = dbuuid.Parse(req.Msg.ParentDepartmentId)
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid parent department ID"))
		}

		// Verify parent exists and belongs to same organization
		parentDept, err := s.Queries.GetDepartmentByID(ctx, s.TenantPool, &database.GetDepartmentByIDParams{
			ID:             parentUUID,
			OrganizationID: orgUUID,
		})
		if err != nil {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("parent department not found"))
		}

		params.ParentDepartmentID = dbuuid.UUIDToNullUUID(parentDept.ID)
		hasParent = true
	}

	// Create department
	dept, err := s.Queries.CreateDepartment(ctx, s.TenantPool, params)
	if err != nil {
		slog.ErrorContext(ctx, "CreateDepartment: failed", "error", err)
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to create department"))
	}

	// Increment parent's child_count if department has a parent
	if hasParent {
		err = s.Queries.IncrementDepartmentChildCount(ctx, s.TenantPool, &database.IncrementDepartmentChildCountParams{
			OrganizationID: orgUUID,
			DepartmentID:   parentUUID,
		})
		if err != nil {
			slog.ErrorContext(ctx, "CreateDepartment: failed to increment parent child_count",
				"error", err,
				"parent_id", parentUUID,
				"department_id", dept.ID)
			// Don't fail the request, count can be fixed later
		}

		slog.InfoContext(ctx, "CreateDepartment: department created with parent",
			"department_id", dept.ID,
			"parent_id", parentUUID)
	} else {
		slog.InfoContext(ctx, "CreateDepartment: root department created",
			"department_id", dept.ID)
	}

	return connect.NewResponse(&v1.CreateDepartmentResponse{
		Department: converter.DepartmentToProto(dept),
	}), nil
}

// UpdateDepartment updates department name and/or description.
// Uses TenantPool for tenant-isolated write operation.
func (s *DepartmentService) UpdateDepartment(ctx context.Context, req *connect.Request[v1.UpdateDepartmentRequest]) (*connect.Response[v1.UpdateDepartmentResponse], error) {
	// Extract organization_id from auth context
	userOrgID, ok := interceptor.UserOrgIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("missing organization context"))
	}

	orgUUID, err := dbuuid.Parse(userOrgID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid organization ID"))
	}

	deptUUID, err := dbuuid.Parse(req.Msg.DepartmentId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid department ID"))
	}

	// Validate department exists
	_, err = s.Queries.GetDepartmentByID(ctx, s.TenantPool, &database.GetDepartmentByIDParams{
		ID:             deptUUID,
		OrganizationID: orgUUID,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("department not found"))
	}

	// Update department
	dept, err := s.Queries.UpdateDepartment(ctx, s.TenantPool, &database.UpdateDepartmentParams{
		ID:             deptUUID,
		OrganizationID: orgUUID,
		Name:           req.Msg.Name,
		Description:    pgtype.Text{String: req.Msg.Description, Valid: req.Msg.Description != ""},
	})
	if err != nil {
		slog.ErrorContext(ctx, "UpdateDepartment: failed", "error", err)
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to update department"))
	}

	return connect.NewResponse(&v1.UpdateDepartmentResponse{
		Department: converter.DepartmentToProto(dept),
	}), nil
}

// MoveDepartment changes a department's parent (restructuring hierarchy).
// Validates against circular references before moving.
// Uses TenantPool with transaction for atomic update.
func (s *DepartmentService) MoveDepartment(ctx context.Context, req *connect.Request[v1.MoveDepartmentRequest]) (*connect.Response[v1.MoveDepartmentResponse], error) {
	if err := s.validateMoveDepartmentRequest(ctx, req); err != nil {
		return nil, err
	}

	if err := s.checkCircularReference(ctx, req); err != nil {
		return nil, err
	}

	dept, err := s.moveDepartmentToNewParent(ctx, req)
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&v1.MoveDepartmentResponse{
		Department: converter.DepartmentToProto(dept),
	}), nil
}

// validateMoveDepartmentRequest validates the move request parameters
func (s *DepartmentService) validateMoveDepartmentRequest(ctx context.Context, req *connect.Request[v1.MoveDepartmentRequest]) error {
	userOrgID, ok := interceptor.UserOrgIDFromContext(ctx)
	if !ok {
		return connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("missing organization context"))
	}

	orgUUID, err := dbuuid.Parse(userOrgID)
	if err != nil {
		return connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid organization ID"))
	}

	deptUUID, err := dbuuid.Parse(req.Msg.DepartmentId)
	if err != nil {
		return connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid department ID"))
	}

	// Validate department exists
	_, err = s.Queries.GetDepartmentByID(ctx, s.TenantPool, &database.GetDepartmentByIDParams{
		ID:             deptUUID,
		OrganizationID: orgUUID,
	})
	if err != nil {
		return connect.NewError(connect.CodeNotFound, fmt.Errorf("department not found"))
	}

	return nil
}

// checkCircularReference validates that moving would not create a circular reference
func (s *DepartmentService) checkCircularReference(ctx context.Context, req *connect.Request[v1.MoveDepartmentRequest]) error {
	if req.Msg.NewParentId == "" {
		return nil // Moving to root is always safe
	}

	userOrgID, _ := interceptor.UserOrgIDFromContext(ctx)
	orgUUID, _ := dbuuid.Parse(userOrgID)
	deptUUID, _ := dbuuid.Parse(req.Msg.DepartmentId)
	newParentUUID, err := dbuuid.Parse(req.Msg.NewParentId)
	if err != nil {
		return connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid new parent ID"))
	}

	// Check if new parent is a descendant of the department being moved
	isDescendant, err := s.Queries.IsDepartmentDescendant(ctx, s.TenantPool, &database.IsDepartmentDescendantParams{
		ID:             deptUUID,
		OrganizationID: orgUUID,
		ID_2:           newParentUUID,
	})
	if err != nil {
		slog.ErrorContext(ctx, "MoveDepartment: circular check failed", "error", err)
		return connect.NewError(connect.CodeInternal, fmt.Errorf("failed to validate move"))
	}

	if isDescendant {
		return connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("cannot move department under its own descendant (circular reference)"))
	}

	return nil
}

// moveDepartmentToNewParent executes the move operation
// This method handles updating child_count for old and new parent departments.
func (s *DepartmentService) moveDepartmentToNewParent(ctx context.Context, req *connect.Request[v1.MoveDepartmentRequest]) (*database.OrganizationDepartment, error) {
	userOrgID, _ := interceptor.UserOrgIDFromContext(ctx)
	orgUUID, _ := dbuuid.Parse(userOrgID)
	deptUUID, _ := dbuuid.Parse(req.Msg.DepartmentId)

	var newParentUUID dbuuid.UUID
	hasNewParent := false
	if req.Msg.NewParentId != "" {
		var err error
		newParentUUID, err = dbuuid.Parse(req.Msg.NewParentId)
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid new parent ID"))
		}

		// Verify new parent exists
		_, err = s.Queries.GetDepartmentByID(ctx, s.TenantPool, &database.GetDepartmentByIDParams{
			ID:             newParentUUID,
			OrganizationID: orgUUID,
		})
		if err != nil {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("new parent department not found"))
		}
		hasNewParent = true
	}

	// Prepare nullable parent value for DB: use NULL when moving to root
	var parentNull dbuuid.NullUUID
	if hasNewParent {
		parentNull = dbuuid.UUIDToNullUUID(newParentUUID)
	} else {
		parentNull = dbuuid.NullUUID{} // Valid=false -> SQL NULL
	}

	// Move department (returns old parent ID)
	movedDept, err := s.Queries.MoveDepartment(ctx, s.TenantPool, &database.MoveDepartmentParams{
		ID:                 deptUUID,
		OrganizationID:     orgUUID,
		ParentDepartmentID: parentNull,
	})
	if err != nil {
		slog.ErrorContext(ctx, "MoveDepartment: move failed", "error", err)
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to move department"))
	}

	// Update child_count for old parent (if exists)
	if movedDept.OldParentID.Valid {
		oldParentID := dbuuid.NullUUIDToUUID(movedDept.OldParentID)
		err = s.Queries.DecrementDepartmentChildCount(ctx, s.TenantPool, &database.DecrementDepartmentChildCountParams{
			OrganizationID: orgUUID,
			DepartmentID:   oldParentID,
		})
		if err != nil {
			slog.ErrorContext(ctx, "MoveDepartment: failed to decrement old parent child_count",
				"error", err,
				"old_parent_id", oldParentID)
			// Don't fail the request, count can be fixed later
		}
	}

	// Update child_count for new parent (if exists)
	if hasNewParent {
		err = s.Queries.IncrementDepartmentChildCount(ctx, s.TenantPool, &database.IncrementDepartmentChildCountParams{
			OrganizationID: orgUUID,
			DepartmentID:   newParentUUID,
		})
		if err != nil {
			slog.ErrorContext(ctx, "MoveDepartment: failed to increment new parent child_count",
				"error", err,
				"new_parent_id", newParentUUID)
			// Don't fail the request, count can be fixed later
		}
	}

	// Log new_parent_id as nil when moving to root
	var newParentLog any
	if hasNewParent {
		newParentLog = newParentUUID
	} else {
		newParentLog = nil
	}

	slog.InfoContext(ctx, "MoveDepartment: department moved",
		"department_id", deptUUID,
		"old_parent_id", movedDept.OldParentID,
		"new_parent_id", newParentLog)

	// Convert MoveDepartmentRow to OrganizationDepartment for return
	return &database.OrganizationDepartment{
		ID:                 movedDept.ID,
		OrganizationID:     movedDept.OrganizationID,
		Name:               movedDept.Name,
		Description:        movedDept.Description,
		ParentDepartmentID: movedDept.ParentDepartmentID,
		MemberCount:        movedDept.MemberCount,
		ManagerCount:       movedDept.ManagerCount,
		ChildCount:         movedDept.ChildCount,
		UpdatedAt:          movedDept.UpdatedAt,
	}, nil
}

// DeleteDepartment removes a department.
// Fails if department has members or children.
// Uses TenantPool for tenant-isolated write operation.
func (s *DepartmentService) DeleteDepartment(ctx context.Context, req *connect.Request[v1.DeleteDepartmentRequest]) (*connect.Response[v1.DeleteDepartmentResponse], error) {
	if err := s.validateDepartmentDeletion(ctx, req); err != nil {
		return nil, err
	}

	if err := s.executeDepartmentDeletion(ctx, req); err != nil {
		return nil, err
	}

	return connect.NewResponse(&v1.DeleteDepartmentResponse{
		Success: true,
	}), nil
}

// validateDepartmentDeletion checks if department can be deleted
func (s *DepartmentService) validateDepartmentDeletion(ctx context.Context, req *connect.Request[v1.DeleteDepartmentRequest]) error {
	userOrgID, ok := interceptor.UserOrgIDFromContext(ctx)
	if !ok {
		return connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("missing organization context"))
	}

	orgUUID, err := dbuuid.Parse(userOrgID)
	if err != nil {
		return connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid organization ID"))
	}

	deptUUID, err := dbuuid.Parse(req.Msg.DepartmentId)
	if err != nil {
		return connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid department ID"))
	}

	// Validate department exists and check counts
	dept, err := s.Queries.GetDepartmentByID(ctx, s.TenantPool, &database.GetDepartmentByIDParams{
		ID:             deptUUID,
		OrganizationID: orgUUID,
	})
	if err != nil {
		return connect.NewError(connect.CodeNotFound, fmt.Errorf("department not found"))
	}

	if dept.MemberCount > 0 {
		return connect.NewError(connect.CodeFailedPrecondition, fmt.Errorf("cannot delete department with members (migrate employees out first)"))
	}

	if dept.ChildCount > 0 {
		return connect.NewError(connect.CodeFailedPrecondition, fmt.Errorf("cannot delete department with child departments (restructure hierarchy first)"))
	}

	return nil
}

// executeDepartmentDeletion performs the deletion
func (s *DepartmentService) executeDepartmentDeletion(ctx context.Context, req *connect.Request[v1.DeleteDepartmentRequest]) error {
	userOrgID, _ := interceptor.UserOrgIDFromContext(ctx)
	orgUUID, _ := dbuuid.Parse(userOrgID)
	deptUUID, _ := dbuuid.Parse(req.Msg.DepartmentId)

	err := s.Queries.DeleteDepartment(ctx, s.TenantPool, &database.DeleteDepartmentParams{
		ID:             deptUUID,
		OrganizationID: orgUUID,
	})
	if err != nil {
		slog.ErrorContext(ctx, "DeleteDepartment: deletion failed", "error", err)
		return connect.NewError(connect.CodeInternal, fmt.Errorf("failed to delete department"))
	}

	return nil
}

// AssignEmployeeToDepartment adds an employee to a department.
// OWNER/OPERATOR can assign anyone; managers can only assign unassigned employees to their own department.
// This method handles count updates for department member_count and manager_count.
func (s *DepartmentService) AssignEmployeeToDepartment(ctx context.Context, req *connect.Request[v1.AssignEmployeeToDepartmentRequest]) (*connect.Response[v1.AssignEmployeeToDepartmentResponse], error) {
	// TODO: Implement custom permission logic for managers
	// For now, allowing OWNER/OPERATOR only (enforced by proto access_control)

	if !IsValidDepartmentRole(req.Msg.Role) {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid department role"))
	}

	userOrgID, ok := interceptor.UserOrgIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("missing organization context"))
	}

	orgUUID, err := dbuuid.Parse(userOrgID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid organization ID"))
	}

	deptUUID, err := dbuuid.Parse(req.Msg.DepartmentId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid department ID"))
	}

	empUUID, err := dbuuid.Parse(req.Msg.EmployeeId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid employee ID"))
	}

	// Check if employee already has a department assignment
	oldMembership, err := s.Queries.GetEmployeeCurrentDepartment(ctx, s.TenantPool, &database.GetEmployeeCurrentDepartmentParams{
		OrganizationID: orgUUID,
		EmployeeID:     empUUID,
	})
	// err is expected if employee has no current department (not an error case)
	hasOldDepartment := err == nil

	slog.DebugContext(ctx, "AssignEmployeeToDepartment: checked existing membership",
		"employee_id", empUUID,
		"has_old_department", hasOldDepartment)

	// Assign employee (ON CONFLICT handles moves automatically)
	member, err := s.Queries.AssignEmployeeToDepartment(ctx, s.TenantPool, &database.AssignEmployeeToDepartmentParams{
		OrganizationID: orgUUID,
		DepartmentID:   deptUUID,
		EmployeeID:     empUUID,
		Role:           req.Msg.Role, // 'member' or 'manager'
		UpdatedAt:      pgtype.Timestamptz{Time: time.Now(), Valid: true},
	})
	if err != nil {
		slog.ErrorContext(ctx, "AssignEmployeeToDepartment: failed", "error", err)
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to assign employee"))
	}

	// Update department counts based on what changed
	if hasOldDepartment {
		// Employee moved from old department to new department
		if oldMembership.DepartmentID != deptUUID {
			// Decrement old department counts
			err = s.Queries.DecrementDepartmentMemberCount(ctx, s.TenantPool, &database.DecrementDepartmentMemberCountParams{
				OrganizationID: orgUUID,
				DepartmentID:   oldMembership.DepartmentID,
				IsManager:      oldMembership.Role == DepartmentRoleManager,
			})
			if err != nil {
				slog.ErrorContext(ctx, "AssignEmployeeToDepartment: failed to decrement old department counts",
					"error", err,
					"old_department_id", oldMembership.DepartmentID)
				// Don't fail the request, count can be fixed later
			}

			// Increment new department counts
			err = s.Queries.IncrementDepartmentMemberCount(ctx, s.TenantPool, &database.IncrementDepartmentMemberCountParams{
				OrganizationID: orgUUID,
				DepartmentID:   deptUUID,
				IsManager:      req.Msg.Role == DepartmentRoleManager,
			})
			if err != nil {
				slog.ErrorContext(ctx, "AssignEmployeeToDepartment: failed to increment new department counts",
					"error", err,
					"department_id", deptUUID)
				// Don't fail the request, count can be fixed later
			}

			slog.InfoContext(ctx, "AssignEmployeeToDepartment: employee moved between departments",
				"employee_id", empUUID,
				"old_department_id", oldMembership.DepartmentID,
				"new_department_id", deptUUID)
		} else if oldMembership.Role != req.Msg.Role {
			// Employee stayed in same department but role changed
			delta := 0
			if req.Msg.Role == DepartmentRoleManager && oldMembership.Role == DepartmentRoleMember {
				delta = 1 // Promoted to manager
			} else if req.Msg.Role == DepartmentRoleMember && oldMembership.Role == DepartmentRoleManager {
				delta = -1 // Demoted to member
			}

			if delta != 0 {
				err = s.Queries.AdjustDepartmentManagerCount(ctx, s.TenantPool, &database.AdjustDepartmentManagerCountParams{
					OrganizationID: orgUUID,
					DepartmentID:   deptUUID,
					Delta:          int32(delta),
				})
				if err != nil {
					slog.ErrorContext(ctx, "AssignEmployeeToDepartment: failed to adjust manager count",
						"error", err,
						"department_id", deptUUID,
						"delta", delta)
					// Don't fail the request, count can be fixed later
				}

				slog.InfoContext(ctx, "AssignEmployeeToDepartment: employee role changed",
					"employee_id", empUUID,
					"old_role", oldMembership.Role,
					"new_role", req.Msg.Role)
			}
		}
	} else {
		// Employee newly assigned (was unassigned before)
		err = s.Queries.IncrementDepartmentMemberCount(ctx, s.TenantPool, &database.IncrementDepartmentMemberCountParams{
			OrganizationID: orgUUID,
			DepartmentID:   deptUUID,
			IsManager:      req.Msg.Role == DepartmentRoleManager,
		})
		if err != nil {
			slog.ErrorContext(ctx, "AssignEmployeeToDepartment: failed to increment department counts",
				"error", err,
				"department_id", deptUUID)
			// Don't fail the request, count can be fixed later
		}

		slog.InfoContext(ctx, "AssignEmployeeToDepartment: employee newly assigned",
			"employee_id", empUUID,
			"department_id", deptUUID)
	}

	return connect.NewResponse(&v1.AssignEmployeeToDepartmentResponse{
		Member: converter.OrganizationDepartmentMemberToProto(member),
	}), nil
}

// RemoveEmployeeFromDepartment unassigns an employee from their department.
// This method handles decrementing department member_count and manager_count.
func (s *DepartmentService) RemoveEmployeeFromDepartment(ctx context.Context, req *connect.Request[v1.RemoveEmployeeFromDepartmentRequest]) (*connect.Response[v1.RemoveEmployeeFromDepartmentResponse], error) {
	userOrgID, ok := interceptor.UserOrgIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("missing organization context"))
	}

	orgUUID, err := dbuuid.Parse(userOrgID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid organization ID"))
	}

	empUUID, err := dbuuid.Parse(req.Msg.EmployeeId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid employee ID"))
	}

	// Remove employee and get the deleted row for count updates
	deletedMember, err := s.Queries.RemoveEmployeeFromDepartment(ctx, s.TenantPool, &database.RemoveEmployeeFromDepartmentParams{
		OrganizationID: orgUUID,
		EmployeeID:     empUUID,
	})
	if err != nil {
		slog.ErrorContext(ctx, "RemoveEmployeeFromDepartment: failed", "error", err)
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to remove employee"))
	}

	// Decrement department counts
	err = s.Queries.DecrementDepartmentMemberCount(ctx, s.TenantPool, &database.DecrementDepartmentMemberCountParams{
		OrganizationID: orgUUID,
		DepartmentID:   deletedMember.DepartmentID,
		IsManager:      deletedMember.Role == DepartmentRoleManager,
	})
	if err != nil {
		slog.ErrorContext(ctx, "RemoveEmployeeFromDepartment: failed to decrement counts",
			"error", err,
			"department_id", deletedMember.DepartmentID)
		// Don't fail the request, count can be fixed later
	}

	slog.InfoContext(ctx, "RemoveEmployeeFromDepartment: employee removed",
		"employee_id", empUUID,
		"department_id", deletedMember.DepartmentID,
		"role", deletedMember.Role)

	return connect.NewResponse(&v1.RemoveEmployeeFromDepartmentResponse{
		Success: true,
	}), nil
}

// SetDepartmentManager designates an employee as manager.
// Employee must be a member of the department.
func (s *DepartmentService) SetDepartmentManager(ctx context.Context, req *connect.Request[v1.SetDepartmentManagerRequest]) (*connect.Response[v1.SetDepartmentManagerResponse], error) {
	if err := s.validateManagerDesignation(ctx, req); err != nil {
		return nil, err
	}

	manager, err := s.setManagerRole(ctx, req)
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&v1.SetDepartmentManagerResponse{
		Manager: converter.OrganizationDepartmentMemberToProto(manager),
	}), nil
}

// validateManagerDesignation checks if employee can be made manager
func (s *DepartmentService) validateManagerDesignation(ctx context.Context, req *connect.Request[v1.SetDepartmentManagerRequest]) error {
	userOrgID, ok := interceptor.UserOrgIDFromContext(ctx)
	if !ok {
		return connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("missing organization context"))
	}

	orgUUID, err := dbuuid.Parse(userOrgID)
	if err != nil {
		return connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid organization ID"))
	}

	deptUUID, err := dbuuid.Parse(req.Msg.DepartmentId)
	if err != nil {
		return connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid department ID"))
	}

	empUUID, err := dbuuid.Parse(req.Msg.EmployeeId)
	if err != nil {
		return connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid employee ID"))
	}

	// Check if employee is a member of the department
	members, err := s.Queries.GetDepartmentMembers(ctx, s.TenantPool, &database.GetDepartmentMembersParams{
		DepartmentID:   deptUUID,
		OrganizationID: orgUUID,
	})
	if err != nil {
		return connect.NewError(connect.CodeInternal, fmt.Errorf("failed to fetch department members"))
	}

	isMember := false
	for _, member := range members {
		if member.EmployeeID == empUUID {
			isMember = true
			break
		}
	}

	if !isMember {
		return connect.NewError(connect.CodeFailedPrecondition, fmt.Errorf("employee must be a member of the department before being designated as manager"))
	}

	return nil
}

// setManagerRole updates the employee's role to manager
// This method handles incrementing manager_count if the role actually changed.
func (s *DepartmentService) setManagerRole(ctx context.Context, req *connect.Request[v1.SetDepartmentManagerRequest]) (*database.OrganizationDepartmentMember, error) {
	userOrgID, _ := interceptor.UserOrgIDFromContext(ctx)
	orgUUID, _ := dbuuid.Parse(userOrgID)
	deptUUID, _ := dbuuid.Parse(req.Msg.DepartmentId)
	empUUID, _ := dbuuid.Parse(req.Msg.EmployeeId)

	manager, err := s.Queries.SetDepartmentManager(ctx, s.TenantPool, &database.SetDepartmentManagerParams{
		OrganizationID: orgUUID,
		DepartmentID:   deptUUID,
		EmployeeID:     empUUID,
	})
	if err != nil {
		slog.ErrorContext(ctx, "SetDepartmentManager: failed", "error", err)
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to set manager"))
	}

	// If a row was returned, the role was actually changed (query filters out already-managers)
	// Increment manager count
	err = s.Queries.AdjustDepartmentManagerCount(ctx, s.TenantPool, &database.AdjustDepartmentManagerCountParams{
		OrganizationID: orgUUID,
		DepartmentID:   deptUUID,
		Delta:          1, // Promote to manager
	})
	if err != nil {
		slog.ErrorContext(ctx, "SetDepartmentManager: failed to adjust manager count",
			"error", err,
			"department_id", deptUUID)
		// Don't fail the request, count can be fixed later
	}

	slog.InfoContext(ctx, "SetDepartmentManager: employee promoted to manager",
		"employee_id", empUUID,
		"department_id", deptUUID)

	return manager, nil
}

// ClearDepartmentManager removes manager designation from all managers in department.
// This method handles decrementing the manager_count by the number of demoted managers.
func (s *DepartmentService) ClearDepartmentManager(ctx context.Context, req *connect.Request[v1.ClearDepartmentManagerRequest]) (*connect.Response[v1.ClearDepartmentManagerResponse], error) {
	userOrgID, ok := interceptor.UserOrgIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("missing organization context"))
	}

	orgUUID, err := dbuuid.Parse(userOrgID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid organization ID"))
	}

	deptUUID, err := dbuuid.Parse(req.Msg.DepartmentId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid department ID"))
	}

	// Clear all managers and get count of demoted managers
	demotedCount, err := s.Queries.ClearDepartmentManager(ctx, s.TenantPool, &database.ClearDepartmentManagerParams{
		OrganizationID: orgUUID,
		DepartmentID:   deptUUID,
	})
	if err != nil {
		slog.ErrorContext(ctx, "ClearDepartmentManager: failed", "error", err)
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to clear manager"))
	}

	// Adjust manager count if any managers were demoted
	if demotedCount > 0 {
		err = s.Queries.AdjustDepartmentManagerCount(ctx, s.TenantPool, &database.AdjustDepartmentManagerCountParams{
			OrganizationID: orgUUID,
			DepartmentID:   deptUUID,
			Delta:          -demotedCount, // Negative delta to decrement
		})
		if err != nil {
			slog.ErrorContext(ctx, "ClearDepartmentManager: failed to adjust manager count",
				"error", err,
				"department_id", deptUUID,
				"demoted_count", demotedCount)
			// Don't fail the request, count can be fixed later
		}

		slog.InfoContext(ctx, "ClearDepartmentManager: managers demoted",
			"department_id", deptUUID,
			"demoted_count", demotedCount)
	}

	return connect.NewResponse(&v1.ClearDepartmentManagerResponse{
		Success: true,
	}), nil
}

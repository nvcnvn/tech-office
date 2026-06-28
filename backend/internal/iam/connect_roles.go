package iam

import (
	"context"
	"fmt"

	"connectrpc.com/connect"

	"github.com/nvcnvn/tech-office/backend/database"
	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/database/txn"
	"github.com/nvcnvn/tech-office/backend/internal/interceptor"
	v1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// === Permission & Role Management RPCs ===

func (s *IAMServiceConnect) ListPermissions(
	ctx context.Context,
	req *connect.Request[v1.ListPermissionsRequest],
) (*connect.Response[v1.ListPermissionsResponse], error) {
	var domain *string
	if req.Msg.Domain != nil {
		domain = req.Msg.Domain
	}

	perms, err := s.logic.ListAllPermissions(ctx, s.adminPool, domain)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to list permissions: %w", err))
	}

	// Group permissions by domain
	groupMap := make(map[string]*v1.PermissionGroup)
	var groupOrder []string
	for _, p := range perms {
		g, ok := groupMap[p.Domain]
		if !ok {
			g = &v1.PermissionGroup{Domain: p.Domain}
			groupMap[p.Domain] = g
			groupOrder = append(groupOrder, p.Domain)
		}
		g.Permissions = append(g.Permissions, &v1.Permission{
			Id:          p.ID,
			Domain:      p.Domain,
			Description: p.Description,
		})
	}

	groups := make([]*v1.PermissionGroup, 0, len(groupOrder))
	for _, d := range groupOrder {
		groups = append(groups, groupMap[d])
	}

	return connect.NewResponse(&v1.ListPermissionsResponse{
		Groups:     groups,
		TotalCount: int32(len(perms)),
	}), nil
}

func (s *IAMServiceConnect) CreateRole(
	ctx context.Context,
	req *connect.Request[v1.CreateRoleRequest],
) (*connect.Response[v1.CreateRoleResponse], error) {
	orgID, err := orgIDFromContext(ctx)
	if err != nil {
		return nil, err
	}

	if req.Msg.Name == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("role name is required"))
	}

	var role *database.IamRole
	err = txn.WithTxn(ctx, s.adminPool, func(ctx context.Context, tx database.DBTX) error {
		var createErr error
		role, createErr = s.logic.CreateRole(ctx, tx, orgID, req.Msg.Name, req.Msg.Description, req.Msg.PermissionIds)
		return createErr
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to create role: %w", err))
	}

	return connect.NewResponse(&v1.CreateRoleResponse{
		Role: roleToOrgRoleProto(role, req.Msg.PermissionIds, 0),
	}), nil
}

func (s *IAMServiceConnect) UpdateRole(
	ctx context.Context,
	req *connect.Request[v1.UpdateRoleRequest],
) (*connect.Response[v1.UpdateRoleResponse], error) {
	orgID, err := orgIDFromContext(ctx)
	if err != nil {
		return nil, err
	}

	roleID, err := dbuuid.Parse(req.Msg.RoleId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid role_id: %w", err))
	}

	var role *database.IamRole
	var permIDs []string
	var count int64
	err = txn.WithTxn(ctx, s.adminPool, func(ctx context.Context, tx database.DBTX) error {
		var updateErr error
		role, updateErr = s.logic.UpdateRole(ctx, tx, orgID, roleID, req.Msg.Name, req.Msg.Description, req.Msg.PermissionIds, req.Msg.UpdatePermissions)
		if updateErr != nil {
			return updateErr
		}
		// Fetch final state for response
		role, permIDs, count, updateErr = s.logic.GetRole(ctx, tx, orgID, roleID)
		return updateErr
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to update role: %w", err))
	}

	return connect.NewResponse(&v1.UpdateRoleResponse{
		Role: roleToOrgRoleProto(role, permIDs, int32(count)),
	}), nil
}

func (s *IAMServiceConnect) DeleteRole(
	ctx context.Context,
	req *connect.Request[v1.DeleteRoleRequest],
) (*connect.Response[v1.DeleteRoleResponse], error) {
	orgID, err := orgIDFromContext(ctx)
	if err != nil {
		return nil, err
	}

	roleID, err := dbuuid.Parse(req.Msg.RoleId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid role_id: %w", err))
	}

	err = txn.WithTxn(ctx, s.adminPool, func(ctx context.Context, tx database.DBTX) error {
		return s.logic.DeleteRole(ctx, tx, orgID, roleID)
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to delete role: %w", err))
	}

	return connect.NewResponse(&v1.DeleteRoleResponse{
		Message: "Role deleted successfully.",
	}), nil
}

func (s *IAMServiceConnect) ListRoles(
	ctx context.Context,
	req *connect.Request[v1.ListRolesRequest],
) (*connect.Response[v1.ListRolesResponse], error) {
	orgID, err := orgIDFromContext(ctx)
	if err != nil {
		return nil, err
	}

	roles, err := s.logic.ListRoles(ctx, s.adminPool, orgID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to list roles: %w", err))
	}

	protoRoles := make([]*v1.OrgRole, 0, len(roles))
	for _, r := range roles {
		_, perms, count, err := s.logic.GetRole(ctx, s.adminPool, orgID, r.ID)
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to get details for role %s: %w", r.ID, err))
		}
		protoRoles = append(protoRoles, roleToOrgRoleProto(r, perms, int32(count)))
	}

	return connect.NewResponse(&v1.ListRolesResponse{
		Roles: protoRoles,
	}), nil
}

func (s *IAMServiceConnect) GetRole(
	ctx context.Context,
	req *connect.Request[v1.GetRoleRequest],
) (*connect.Response[v1.GetRoleResponse], error) {
	orgID, err := orgIDFromContext(ctx)
	if err != nil {
		return nil, err
	}

	roleID, err := dbuuid.Parse(req.Msg.RoleId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid role_id: %w", err))
	}

	pool := s.adminPool
	role, perms, count, err := s.logic.GetRole(ctx, pool, orgID, roleID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to get role: %w", err))
	}

	return connect.NewResponse(&v1.GetRoleResponse{
		Role: roleToOrgRoleProto(role, perms, int32(count)),
	}), nil
}

func (s *IAMServiceConnect) AssignRole(
	ctx context.Context,
	req *connect.Request[v1.AssignRoleRequest],
) (*connect.Response[v1.AssignRoleResponse], error) {
	orgID, err := orgIDFromContext(ctx)
	if err != nil {
		return nil, err
	}

	assignerID, err := userIDFromContext(ctx)
	if err != nil {
		return nil, err
	}

	employeeID, err := dbuuid.Parse(req.Msg.EmployeeId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid employee_id: %w", err))
	}

	roleID, err := dbuuid.Parse(req.Msg.RoleId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid role_id: %w", err))
	}

	err = txn.WithTxn(ctx, s.adminPool, func(ctx context.Context, tx database.DBTX) error {
		return s.logic.AssignRoleToEmployee(ctx, tx, orgID, employeeID, roleID, assignerID)
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to assign role: %w", err))
	}

	return connect.NewResponse(&v1.AssignRoleResponse{
		Message: "Role assigned successfully.",
	}), nil
}

func (s *IAMServiceConnect) RevokeRole(
	ctx context.Context,
	req *connect.Request[v1.RevokeRoleRequest],
) (*connect.Response[v1.RevokeRoleResponse], error) {
	orgID, err := orgIDFromContext(ctx)
	if err != nil {
		return nil, err
	}

	employeeID, err := dbuuid.Parse(req.Msg.EmployeeId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid employee_id: %w", err))
	}

	roleID, err := dbuuid.Parse(req.Msg.RoleId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid role_id: %w", err))
	}

	err = txn.WithTxn(ctx, s.adminPool, func(ctx context.Context, tx database.DBTX) error {
		return s.logic.RevokeRoleFromEmployee(ctx, tx, orgID, employeeID, roleID)
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to revoke role: %w", err))
	}

	return connect.NewResponse(&v1.RevokeRoleResponse{
		Message: "Role revoked successfully.",
	}), nil
}

func (s *IAMServiceConnect) ListEmployeeRoles(
	ctx context.Context,
	req *connect.Request[v1.ListEmployeeRolesRequest],
) (*connect.Response[v1.ListEmployeeRolesResponse], error) {
	orgID, err := orgIDFromContext(ctx)
	if err != nil {
		return nil, err
	}

	employeeID, err := dbuuid.Parse(req.Msg.EmployeeId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid employee_id: %w", err))
	}

	roles, err := s.logic.ListEmployeeRoles(ctx, s.adminPool, orgID, employeeID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to list employee roles: %w", err))
	}

	protoRoles := make([]*v1.OrgRole, 0, len(roles))
	for _, r := range roles {
		protoRoles = append(protoRoles, &v1.OrgRole{
			Id:          r.ID.String(),
			Name:        r.Name,
			Description: r.Description.String,
			IsSystem:    r.IsSystem,
		})
	}

	return connect.NewResponse(&v1.ListEmployeeRolesResponse{
		Roles: protoRoles,
	}), nil
}

func (s *IAMServiceConnect) GetEmployeePermissions(
	ctx context.Context,
	req *connect.Request[v1.GetEmployeePermissionsRequest],
) (*connect.Response[v1.GetEmployeePermissionsResponse], error) {
	orgID, err := orgIDFromContext(ctx)
	if err != nil {
		return nil, err
	}

	employeeID, err := dbuuid.Parse(req.Msg.EmployeeId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid employee_id: %w", err))
	}

	perms, err := s.logic.GetEmployeePermissions(ctx, s.adminPool, orgID, employeeID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to get employee permissions: %w", err))
	}

	return connect.NewResponse(&v1.GetEmployeePermissionsResponse{
		PermissionIds: perms,
	}), nil
}

// === Helpers ===

func orgIDFromContext(ctx context.Context) (dbuuid.UUID, error) {
	orgIDStr, ok := interceptor.UserOrgIDFromContext(ctx)
	if !ok || orgIDStr == "" {
		return dbuuid.UUID{}, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("missing organization context"))
	}
	orgID, err := dbuuid.Parse(orgIDStr)
	if err != nil {
		return dbuuid.UUID{}, connect.NewError(connect.CodeInternal, fmt.Errorf("invalid org ID in token: %w", err))
	}
	return orgID, nil
}

func roleToOrgRoleProto(role *database.IamRole, permissionIDs []string, employeeCount int32) *v1.OrgRole {
	desc := ""
	if role.Description.Valid {
		desc = role.Description.String
	}
	return &v1.OrgRole{
		Id:            role.ID.String(),
		Name:          role.Name,
		Description:   desc,
		IsSystem:      role.IsSystem,
		PermissionIds: permissionIDs,
		EmployeeCount: employeeCount,
	}
}

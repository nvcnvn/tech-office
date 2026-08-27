package compliance

import (
	"context"
	"errors"
	"fmt"

	"connectrpc.com/connect"
	"github.com/nvcnvn/tech-office/backend/database"
	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/internal/interceptor"
	"github.com/nvcnvn/tech-office/backend/rpc/v1/rpcv1connect"
)

// ServiceConnect is the transport layer. It owns transaction boundaries and
// nothing else; every business rule lives in Logic (Constitution Principle III).
type ServiceConnect struct {
	rpcv1connect.UnimplementedComplianceServiceHandler

	Logic      *Logic
	TenantPool database.TenantDatabaseConnector
}

func NewServiceConnect(logic *Logic, tenantPool database.TenantDatabaseConnector) *ServiceConnect {
	return &ServiceConnect{Logic: logic, TenantPool: tenantPool}
}

// extractAuthContext pulls the caller's identity from the interceptor context.
// organization_id is never read from a request message (Principle I).
func extractAuthContext(ctx context.Context) (employeeID, organizationID dbuuid.UUID, err error) {
	userID, ok := interceptor.UserIDFromContext(ctx)
	if !ok || userID == "" {
		return dbuuid.UUID{}, dbuuid.UUID{}, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("user ID not found in context"))
	}
	orgID, ok := interceptor.UserOrgIDFromContext(ctx)
	if !ok || orgID == "" {
		return dbuuid.UUID{}, dbuuid.UUID{}, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("organization ID not found in context"))
	}
	// iam.user.id, iam.identity.id and organization.employee.id are the same UUID
	// for a person (research.md R2), so the JWT's user id is the employee id.
	employeeID, err = dbuuid.Parse(userID)
	if err != nil {
		return dbuuid.UUID{}, dbuuid.UUID{}, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("invalid user ID: %w", err))
	}
	organizationID, err = dbuuid.Parse(orgID)
	if err != nil {
		return dbuuid.UUID{}, dbuuid.UUID{}, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("invalid organization ID: %w", err))
	}
	return employeeID, organizationID, nil
}

func handleError(err error, metadata map[string]string) error {
	var connectErr *connect.Error
	if errors.As(err, &connectErr) {
		return connectErr
	}
	return ToConnectError(err, metadata)
}

// parseOptionalUUID turns an empty cursor into "start at the newest" rather than
// an error (Constitution Principle IX: cursors are nullable).
func parseOptionalUUID(s string) (dbuuid.NullUUID, error) {
	if s == "" {
		return dbuuid.NullUUID{}, nil
	}
	parsed, err := dbuuid.Parse(s)
	if err != nil {
		return dbuuid.NullUUID{}, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid cursor: %w", err))
	}
	return nullUUID(parsed), nil
}

const (
	defaultPageLimit = 25
	maxPageLimit     = 100
)

func clampLimit(requested int32) int32 {
	switch {
	case requested <= 0:
		return defaultPageLimit
	case requested > maxPageLimit:
		return maxPageLimit
	default:
		return requested
	}
}

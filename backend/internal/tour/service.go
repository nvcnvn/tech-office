package tour

import (
	"context"
	"fmt"
	"log/slog"

	"connectrpc.com/connect"
	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/database/txn"
	"github.com/nvcnvn/tech-office/backend/internal/interceptor"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/nvcnvn/tech-office/backend/rpc/v1/rpcv1connect"
)

// TourServiceServer implements the TourService RPC interface.
type TourServiceServer struct {
	TenantPool database.TenantDatabaseConnector
	logic      TourLogic
}

// NewService creates a new TourServiceServer.
func NewService(tenantPool database.TenantDatabaseConnector, logic TourLogic) rpcv1connect.TourServiceHandler {
	return &TourServiceServer{
		TenantPool: tenantPool,
		logic:      logic,
	}
}

// caller is the identity every RPC here works from: organization, employee and the
// permission set the auth interceptor already resolved. No id comes off the request.
type caller struct {
	orgID       dbuuid.UUID
	employeeID  dbuuid.UUID
	permissions map[string]struct{}
}

func callerFromContext(ctx context.Context) (caller, error) {
	orgIDStr, ok := interceptor.UserOrgIDFromContext(ctx)
	if !ok {
		return caller{}, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("organization ID not found in context"))
	}
	orgID, err := dbuuid.Parse(orgIDStr)
	if err != nil {
		return caller{}, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid organization ID: %w", err))
	}

	employeeIDStr, ok := interceptor.UserIDFromContext(ctx)
	if !ok {
		return caller{}, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("employee ID not found in context"))
	}
	employeeID, err := dbuuid.Parse(employeeIDStr)
	if err != nil {
		return caller{}, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid employee ID: %w", err))
	}

	// A caller with no permissions at all still reaches here — the interceptor has
	// already enforced tour.view or tour.update, so an empty set means only that the
	// worker tour will filter down to very little.
	permissions, _ := interceptor.UserPermissionsFromContext(ctx)

	return caller{
		orgID:       orgID,
		employeeID:  employeeID,
		permissions: PermissionSet(permissions),
	}, nil
}

// GetTour returns the caller's tour, already selected, filtered and platform-adapted,
// together with their progress and whether it should be offered.
func (s *TourServiceServer) GetTour(
	ctx context.Context,
	req *connect.Request[rpcv1.GetTourRequest],
) (*connect.Response[rpcv1.GetTourResponse], error) {
	c, err := callerFromContext(ctx)
	if err != nil {
		return nil, err
	}

	if req.Msg.Platform == rpcv1.TourPlatform_TOUR_PLATFORM_UNSPECIFIED {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("platform is required"))
	}

	slog.DebugContext(ctx, "GetTour RPC called",
		"organization_id", c.orgID,
		"employee_id", c.employeeID,
		"platform", req.Msg.Platform.String())

	var resolved *ResolvedTour
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		resolved, txErr = s.logic.ResolveTour(ctx, tx, ResolveParams{
			OrganizationID: c.orgID,
			EmployeeID:     c.employeeID,
			Permissions:    c.permissions,
			Platform:       req.Msg.Platform,
		})
		return txErr
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to resolve tour",
			"error", err,
			"organization_id", c.orgID,
			"employee_id", c.employeeID)
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("resolve tour: %w", err))
	}

	stops := make([]*rpcv1.TourStop, 0, len(resolved.Stops))
	for _, stop := range resolved.Stops {
		stops = append(stops, &rpcv1.TourStop{
			Key:         stop.Key,
			Title:       stop.Title,
			Body:        stop.Body,
			ActionLabel: stop.ActionLabel,
			Target:      stop.Target,
		})
	}

	return connect.NewResponse(&rpcv1.GetTourResponse{
		Audience:       resolved.Audience,
		TourId:         resolved.TourID,
		ContentVersion: ContentVersion,
		Stops:          stops,
		Status:         statusToProto(resolved.Status),
		CurrentStop:    resolved.CurrentStop,
		ShouldOffer:    resolved.ShouldOffer,
	}), nil
}

// UpdateTourProgress records where the caller got to. The tour id is derived from their
// audience rather than sent by the client, so nobody can write progress for a tour they
// are not being served.
func (s *TourServiceServer) UpdateTourProgress(
	ctx context.Context,
	req *connect.Request[rpcv1.UpdateTourProgressRequest],
) (*connect.Response[rpcv1.UpdateTourProgressResponse], error) {
	c, err := callerFromContext(ctx)
	if err != nil {
		return nil, err
	}

	status, err := statusFromProto(req.Msg.Status)
	if err != nil {
		return nil, err
	}

	definition, _ := SelectTour(c.permissions)

	// The stop index is validated against the caller's own filtered list, since that is
	// what it addresses. Platform is irrelevant here: filtering by platform changes a
	// stop's body and target, never how many stops there are.
	stopCount := len(FilterStops(definition, c.permissions, rpcv1.TourPlatform_TOUR_PLATFORM_WEB))

	currentStop := req.Msg.CurrentStop
	if currentStop < 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("current_stop must not be negative"))
	}
	if int(currentStop) > stopCount {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			fmt.Errorf("current_stop %d is past the end of the %d-stop tour", currentStop, stopCount))
	}

	// current_stop is only meaningful while the tour is in progress. Completing it means
	// the whole sequence is behind you; dismissing it means the position stops mattering.
	switch status {
	case StatusCompleted:
		currentStop = int32(stopCount)
	case StatusDismissed:
		// Keep whatever the client sent: a dismissal from mid-tour records where the
		// person gave up, which is the only thing that position is still good for.
	}

	slog.DebugContext(ctx, "UpdateTourProgress RPC called",
		"organization_id", c.orgID,
		"employee_id", c.employeeID,
		"tour_id", definition.ID,
		"status", status,
		"current_stop", currentStop)

	var progress *database.IamTourProgress
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		progress, txErr = s.logic.UpsertProgress(ctx, tx, UpsertProgressParams{
			OrganizationID: c.orgID,
			EmployeeID:     c.employeeID,
			TourID:         definition.ID,
			Status:         status,
			CurrentStop:    currentStop,
		})
		return txErr
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to update tour progress",
			"error", err,
			"organization_id", c.orgID,
			"employee_id", c.employeeID,
			"tour_id", definition.ID)
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("update tour progress: %w", err))
	}

	return connect.NewResponse(&rpcv1.UpdateTourProgressResponse{
		Status:      statusToProto(progress.Status),
		CurrentStop: progress.CurrentStop,
	}), nil
}

// statusToProto maps a stored status to the wire enum. The empty string is the absence
// of a row, which is NOT_STARTED.
func statusToProto(status string) rpcv1.TourStatus {
	switch status {
	case StatusInProgress:
		return rpcv1.TourStatus_TOUR_STATUS_IN_PROGRESS
	case StatusCompleted:
		return rpcv1.TourStatus_TOUR_STATUS_COMPLETED
	case StatusDismissed:
		return rpcv1.TourStatus_TOUR_STATUS_DISMISSED
	default:
		return rpcv1.TourStatus_TOUR_STATUS_NOT_STARTED
	}
}

// statusFromProto maps the wire enum to a stored status. NOT_STARTED is rejected: it is
// the absence of a row, so it cannot be written.
func statusFromProto(status rpcv1.TourStatus) (string, error) {
	switch status {
	case rpcv1.TourStatus_TOUR_STATUS_IN_PROGRESS:
		return StatusInProgress, nil
	case rpcv1.TourStatus_TOUR_STATUS_COMPLETED:
		return StatusCompleted, nil
	case rpcv1.TourStatus_TOUR_STATUS_DISMISSED:
		return StatusDismissed, nil
	default:
		return "", connect.NewError(connect.CodeInvalidArgument,
			fmt.Errorf("status must be in_progress, completed or dismissed"))
	}
}

package tour

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// ResolvedTour is what a caller should see: the tour chosen for them, its stops already
// filtered to their permissions and adapted to their platform, and where they got to.
type ResolvedTour struct {
	Audience rpcv1.TourAudience
	TourID   string
	Stops    []Stop

	// Status is StatusInProgress, StatusCompleted, StatusDismissed, or "" for a person
	// with no stored row — the absence of a row is "not started".
	Status string

	// CurrentStop is clamped to Stops and is safe to index with, except for a completed
	// tour where it is len(Stops) as usual.
	CurrentStop int32

	// ShouldOffer is the whole of the automatic-offer rule (FR-007, FR-024). It is
	// deliberately independent of platform: a tour completed on web is not offered on
	// mobile.
	ShouldOffer bool
}

// TourLogic is the pure logic layer: pool-agnostic, taking tx on every call so the
// caller owns the transaction (Constitution III).
type TourLogic interface {
	// ResolveTour selects, filters and adapts the caller's tour and reads their progress.
	ResolveTour(ctx context.Context, tx database.DBTX, params ResolveParams) (*ResolvedTour, error)

	// UpsertProgress records where the caller got to.
	UpsertProgress(ctx context.Context, tx database.DBTX, params UpsertProgressParams) (*database.IamTourProgress, error)
}

// ResolveParams are the inputs to ResolveTour.
type ResolveParams struct {
	OrganizationID dbuuid.UUID
	EmployeeID     dbuuid.UUID
	Permissions    map[string]struct{}
	Platform       rpcv1.TourPlatform
}

// UpsertProgressParams are the inputs to UpsertProgress.
type UpsertProgressParams struct {
	OrganizationID dbuuid.UUID
	EmployeeID     dbuuid.UUID
	TourID         string
	Status         string
	CurrentStop    int32
}

type tourLogic struct {
	queries *database.Queries
}

// NewLogic creates a TourLogic instance.
func NewLogic(queries *database.Queries) TourLogic {
	return &tourLogic{queries: queries}
}

// PermissionSet turns the permission slice the auth interceptor puts in the request
// context into a set, which is what the filtering below wants.
func PermissionSet(permissions []string) map[string]struct{} {
	set := make(map[string]struct{}, len(permissions))
	for _, p := range permissions {
		set[p] = struct{}{}
	}
	return set
}

// SelectTour decides which tour a permission set earns. Holding iam.inviteUser selects
// the administrator tour; everyone else gets the worker tour. The caller cannot ask for
// the other one — there is no audience field on the request (FR-002).
func SelectTour(permissions map[string]struct{}) (Tour, rpcv1.TourAudience) {
	if _, ok := permissions[PermissionInviteUser]; ok {
		return administratorTour, rpcv1.TourAudience_TOUR_AUDIENCE_ADMINISTRATOR
	}
	return workerTour, rpcv1.TourAudience_TOUR_AUDIENCE_WORKER
}

// FilterStops applies the two display rules, in order:
//
//  1. Drop stops whose RequiredPermission the caller lacks. Dropped, not disabled — the
//     returned slice is the authoritative list and current_stop indexes it, so the
//     remaining stops are renumbered from zero with no gap (FR-006, FR-011).
//  2. On mobile, a web-only stop gets its MobileNote as its body and loses its target and
//     action label, so no client can render an action that cannot work (FR-023).
func FilterStops(tour Tour, permissions map[string]struct{}, platform rpcv1.TourPlatform) []Stop {
	stops := make([]Stop, 0, len(tour.Stops))
	for _, stop := range tour.Stops {
		if stop.RequiredPermission != "" {
			if _, ok := permissions[stop.RequiredPermission]; !ok {
				continue
			}
		}
		if stop.WebOnly && platform == rpcv1.TourPlatform_TOUR_PLATFORM_MOBILE {
			stop.Body = stop.MobileNote
			stop.Target = rpcv1.TourTarget_TOUR_TARGET_NONE
			stop.ActionLabel = ""
		}
		stops = append(stops, stop)
	}
	return stops
}

// clampStop holds the stored position inside the filtered list.
//
// The stored index addresses the filtered list, and filtering depends on permissions,
// which can change between one call and the next. Revoking a permission shortens the list
// and can leave the stored index past its end, so a client that trusted it would index
// out of bounds. The clamp is applied to the response only and never written back: the
// permission may be restored, and the person should return to where they actually were
// (FR-015a).
//
// A completed tour is exempt — it reports len(stops) as normal.
func clampStop(stored int32, stopCount int, completed bool) int32 {
	if completed {
		return int32(stopCount)
	}
	if stopCount == 0 {
		return 0
	}
	if stored < 0 {
		return 0
	}
	if int(stored) > stopCount-1 {
		return int32(stopCount - 1)
	}
	return stored
}

func (l *tourLogic) ResolveTour(ctx context.Context, tx database.DBTX, params ResolveParams) (*ResolvedTour, error) {
	definition, audience := SelectTour(params.Permissions)
	stops := FilterStops(definition, params.Permissions, params.Platform)

	slog.DebugContext(ctx, "TourLogic.ResolveTour selected tour",
		"organization_id", params.OrganizationID,
		"employee_id", params.EmployeeID,
		"tour_id", definition.ID,
		"audience", audience.String(),
		"platform", params.Platform.String(),
		"stop_count", len(stops))

	progress, err := l.queries.GetTourProgress(ctx, tx, &database.GetTourProgressParams{
		OrganizationID: params.OrganizationID,
		EmployeeID:     params.EmployeeID,
		TourID:         definition.ID,
	})
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			slog.ErrorContext(ctx, "failed to get tour progress",
				"error", err,
				"organization_id", params.OrganizationID,
				"employee_id", params.EmployeeID,
				"tour_id", definition.ID)
			return nil, fmt.Errorf("get tour progress: %w", err)
		}
		// No row is "not started". Reading the tour never writes one — that is what keeps
		// workspace entry a read path and keeps the completion-rate denominator honest.
		return &ResolvedTour{
			Audience:    audience,
			TourID:      definition.ID,
			Stops:       stops,
			Status:      "",
			CurrentStop: 0,
			ShouldOffer: true,
		}, nil
	}

	return &ResolvedTour{
		Audience:    audience,
		TourID:      definition.ID,
		Stops:       stops,
		Status:      progress.Status,
		CurrentStop: clampStop(progress.CurrentStop, len(stops), progress.Status == StatusCompleted),
		ShouldOffer: progress.Status == StatusInProgress,
	}, nil
}

func (l *tourLogic) UpsertProgress(ctx context.Context, tx database.DBTX, params UpsertProgressParams) (*database.IamTourProgress, error) {
	slog.DebugContext(ctx, "TourLogic.UpsertProgress",
		"organization_id", params.OrganizationID,
		"employee_id", params.EmployeeID,
		"tour_id", params.TourID,
		"status", params.Status,
		"current_stop", params.CurrentStop)

	progress, err := l.queries.UpsertTourProgress(ctx, tx, &database.UpsertTourProgressParams{
		ID:             dbuuid.Must(),
		OrganizationID: params.OrganizationID,
		EmployeeID:     params.EmployeeID,
		TourID:         params.TourID,
		Status:         params.Status,
		CurrentStop:    params.CurrentStop,
		ContentVersion: ContentVersion,
		UpdatedAt:      pgtype.Timestamptz{Time: time.Now(), Valid: true},
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to upsert tour progress",
			"error", err,
			"organization_id", params.OrganizationID,
			"employee_id", params.EmployeeID,
			"tour_id", params.TourID)
		return nil, fmt.Errorf("upsert tour progress: %w", err)
	}

	if params.Status == StatusCompleted {
		slog.InfoContext(ctx, "feature tour completed",
			"organization_id", params.OrganizationID,
			"employee_id", params.EmployeeID,
			"tour_id", params.TourID,
			"content_version", ContentVersion)
	}

	return progress, nil
}

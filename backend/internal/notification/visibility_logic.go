package notification

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
)

// SetPresenceVisibilityParams captures visibility update inputs.
type SetPresenceVisibilityParams struct {
	Mode        string
	StatusText  *string
	StatusEmoji *string
}

// VisibilityLogic encapsulates presence visibility rules.
type VisibilityLogic interface {
	SetPresenceVisibility(ctx context.Context, tx database.DBTX, employeeID, organizationID dbuuid.UUID, params *SetPresenceVisibilityParams) (*database.NotificationPresenceVisibility, error)
	GetPresenceVisibility(ctx context.Context, tx database.DBTX, employeeID, organizationID dbuuid.UUID) (*database.NotificationPresenceVisibility, error)
	FilterVisiblePresence(ctx context.Context, tx database.DBTX, presences []*EmployeePresence, viewerEmployeeID dbuuid.UUID, organizationID dbuuid.UUID) ([]*EmployeePresence, error)
}

type visibilityLogicImpl struct {
	queries     *database.Queries
	nowSupplier func() time.Time
}

// NewVisibilityLogic constructs VisibilityLogic implementation.
func NewVisibilityLogic(queries *database.Queries) VisibilityLogic {
	return &visibilityLogicImpl{
		queries:     queries,
		nowSupplier: time.Now,
	}
}

func (l *visibilityLogicImpl) SetPresenceVisibility(ctx context.Context, tx database.DBTX, employeeID, organizationID dbuuid.UUID, params *SetPresenceVisibilityParams) (*database.NotificationPresenceVisibility, error) {
	if params == nil {
		return nil, fmt.Errorf("visibility parameters required")
	}

	mode := params.Mode
	if mode == "" {
		mode = VisibilityModeEveryone
	}
	if !IsValidVisibilityMode(mode) {
		return nil, fmt.Errorf("invalid visibility mode: %s", mode)
	}

	slog.DebugContext(ctx, "setting presence visibility",
		"function", "VisibilityLogic.SetPresenceVisibility",
		"employee_id", employeeID.String(),
		"organization_id", organizationID.String(),
		"mode", mode,
	)

	result, err := l.queries.UpsertPresenceVisibility(ctx, tx, &database.UpsertPresenceVisibilityParams{
		OrganizationID:    organizationID,
		EmployeeID:        employeeID,
		VisibilityMode:    mode,
		CustomStatusText:  textToPG(params.StatusText),
		CustomStatusEmoji: textToPG(params.StatusEmoji),
		UpdatedAt:         timestamptzFromTime(l.nowSupplier()),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to upsert presence visibility: %w", err)
	}
	return result, nil
}

func (l *visibilityLogicImpl) GetPresenceVisibility(ctx context.Context, tx database.DBTX, employeeID, organizationID dbuuid.UUID) (*database.NotificationPresenceVisibility, error) {
	visibility, err := l.queries.GetPresenceVisibility(ctx, tx, &database.GetPresenceVisibilityParams{
		OrganizationID: organizationID,
		EmployeeID:     employeeID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return defaultVisibility(organizationID, employeeID), nil
		}
		return nil, fmt.Errorf("failed to fetch presence visibility: %w", err)
	}
	if !IsValidVisibilityMode(visibility.VisibilityMode) {
		visibility.VisibilityMode = VisibilityModeEveryone
	}
	return visibility, nil
}

// FilterVisiblePresence applies an employee's visibility preference to what a viewer
// sees.
//
// Ordering constraint (FR-015): this runs on the READ path only, after presence has
// been aggregated, and its result never reaches routing. Choosing to appear offline
// changes what colleagues see; it must not change whether a notification can be
// delivered live, because the person is in fact still there answering pings. Calling
// this from RoutingLogic would silently push every hidden employee onto the push path.
func (l *visibilityLogicImpl) FilterVisiblePresence(ctx context.Context, tx database.DBTX, presences []*EmployeePresence, viewerEmployeeID dbuuid.UUID, organizationID dbuuid.UUID) ([]*EmployeePresence, error) {
	if len(presences) == 0 {
		return presences, nil
	}
	if viewerEmployeeID == (dbuuid.UUID{}) {
		return presences, nil
	}

	sharedCache := make(map[dbuuid.UUID]bool)

	for _, presence := range presences {
		if presence == nil {
			continue
		}
		if presence.EmployeeID == viewerEmployeeID {
			continue
		}

		visibility := presence.Visibility
		if visibility == nil {
			visibility = defaultVisibility(organizationID, presence.EmployeeID)
			presence.Visibility = visibility
		}

		switch visibility.VisibilityMode {
		case VisibilityModeEveryone:
			continue
		case VisibilityModeOffline:
			presence.Status = PresenceStatusOffline
		case VisibilityModeDepartments:
			shared, cached := sharedCache[presence.EmployeeID]
			if !cached {
				var err error
				shared, err = l.queries.SharesDepartment(ctx, tx, &database.SharesDepartmentParams{
					OrganizationID: organizationID,
					EmployeeID:     presence.EmployeeID,
					EmployeeID_2:   viewerEmployeeID,
				})
				if err != nil {
					return nil, fmt.Errorf("failed to evaluate department visibility: %w", err)
				}
				sharedCache[presence.EmployeeID] = shared
			}
			if !shared {
				presence.Status = PresenceStatusOffline
			}
		default:
			presence.Status = PresenceStatusOffline
		}
	}

	return presences, nil
}

func textToPG(value *string) pgtype.Text {
	if value == nil {
		return pgtype.Text{}
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: trimmed, Valid: true}
}

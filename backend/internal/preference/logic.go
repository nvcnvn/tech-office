package preference

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
)

// PreferenceLogic defines the business logic interface for user preferences
// This layer is pool-agnostic and accepts tx parameter for all DB operations
type PreferenceLogic interface {
	GetUserPreference(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID) (*database.IamUserPreference, bool, error)
	UpsertUserPreference(ctx context.Context, tx database.DBTX, params UpsertPreferenceParams) (*database.IamUserPreference, error)
	DeleteUserPreference(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID) error
}

// UpsertPreferenceParams contains parameters for upserting user preference
type UpsertPreferenceParams struct {
	OrganizationID        dbuuid.UUID
	EmployeeID            dbuuid.UUID
	ThemeMode             string
	PreferenceSource      string
	AdditionalPreferences []byte // JSONB as bytes
}

type preferenceLogic struct {
	queries *database.Queries
}

// NewLogic creates a new PreferenceLogic instance
func NewLogic(queries *database.Queries) PreferenceLogic {
	return &preferenceLogic{
		queries: queries,
	}
}

// GetUserPreference retrieves user preference or returns nil if not found
// Returns (preference, exists, error)
func (l *preferenceLogic) GetUserPreference(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID) (*database.IamUserPreference, bool, error) {
	slog.DebugContext(ctx, "PreferenceLogic.GetUserPreference",
		"organization_id", orgID,
		"employee_id", employeeID)

	pref, err := l.queries.GetUserPreference(ctx, tx, &database.GetUserPreferenceParams{
		OrganizationID: orgID,
		EmployeeID:     employeeID,
	})

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			slog.DebugContext(ctx, "user preference not found (returning defaults)",
				"organization_id", orgID,
				"employee_id", employeeID)
			return nil, false, nil
		}
		slog.ErrorContext(ctx, "failed to get user preference",
			"error", err,
			"organization_id", orgID,
			"employee_id", employeeID)
		return nil, false, fmt.Errorf("get user preference: %w", err)
	}

	slog.DebugContext(ctx, "user preference found",
		"organization_id", orgID,
		"employee_id", employeeID,
		"theme_mode", pref.ThemeMode,
		"preference_source", pref.PreferenceSource)

	return pref, true, nil
}

// UpsertUserPreference inserts or updates user preference
func (l *preferenceLogic) UpsertUserPreference(ctx context.Context, tx database.DBTX, params UpsertPreferenceParams) (*database.IamUserPreference, error) {
	slog.DebugContext(ctx, "PreferenceLogic.UpsertUserPreference",
		"organization_id", params.OrganizationID,
		"employee_id", params.EmployeeID,
		"theme_mode", params.ThemeMode,
		"preference_source", params.PreferenceSource)

	// Validate inputs
	if !IsValidThemeMode(params.ThemeMode) {
		return nil, fmt.Errorf("invalid theme mode: %s", params.ThemeMode)
	}
	if !IsValidPreferenceSource(params.PreferenceSource) {
		return nil, fmt.Errorf("invalid preference source: %s", params.PreferenceSource)
	}

	// Generate new ID for insert (will be ignored on conflict)
	id := dbuuid.Must()
	now := pgtype.Timestamptz{Time: time.Now(), Valid: true}

	pref, err := l.queries.UpsertUserPreference(ctx, tx, &database.UpsertUserPreferenceParams{
		ID:                    id,
		OrganizationID:        params.OrganizationID,
		EmployeeID:            params.EmployeeID,
		ThemeMode:             params.ThemeMode,
		PreferenceSource:      params.PreferenceSource,
		AdditionalPreferences: params.AdditionalPreferences,
		UpdatedAt:             now,
	})

	if err != nil {
		slog.ErrorContext(ctx, "failed to upsert user preference",
			"error", err,
			"organization_id", params.OrganizationID,
			"employee_id", params.EmployeeID)
		return nil, fmt.Errorf("upsert user preference: %w", err)
	}

	slog.InfoContext(ctx, "user preference upserted successfully",
		"organization_id", params.OrganizationID,
		"employee_id", params.EmployeeID,
		"theme_mode", pref.ThemeMode,
		"preference_source", pref.PreferenceSource)

	return pref, nil
}

// DeleteUserPreference deletes user preference record
func (l *preferenceLogic) DeleteUserPreference(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID) error {
	slog.DebugContext(ctx, "PreferenceLogic.DeleteUserPreference",
		"organization_id", orgID,
		"employee_id", employeeID)

	err := l.queries.DeleteUserPreference(ctx, tx, &database.DeleteUserPreferenceParams{
		OrganizationID: orgID,
		EmployeeID:     employeeID,
	})

	if err != nil {
		slog.ErrorContext(ctx, "failed to delete user preference",
			"error", err,
			"organization_id", orgID,
			"employee_id", employeeID)
		return fmt.Errorf("delete user preference: %w", err)
	}

	slog.InfoContext(ctx, "user preference deleted successfully",
		"organization_id", orgID,
		"employee_id", employeeID)

	return nil
}

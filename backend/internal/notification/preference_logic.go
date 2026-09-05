package notification

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
)

// ErrInvalidPreference marks a rejected preference update. The connect layer
// translates it to CodeInvalidArgument; the message names the offending value so
// the person is told which one it was.
var ErrInvalidPreference = errors.New("invalid notification preference")

// NotificationPreferences is the whole stored preference record, or the
// documented defaults when nothing has been stored.
type NotificationPreferences struct {
	InAppAlertsEnabled bool
	MutedDomains       []string
	DndEnabled         bool
	// DndStart and DndEnd are "HH:MM", or empty when unset.
	DndStart  string
	DndEnd    string
	UpdatedAt time.Time
	// Exists is false when no record is stored and the defaults are being returned.
	Exists bool
}

// defaultNotificationPreferences is what a person who has never saved anything
// reads. These match the column defaults exactly, so the first update creates a
// row whose untouched fields hold the values the caller was already shown.
func defaultNotificationPreferences() *NotificationPreferences {
	return &NotificationPreferences{
		InAppAlertsEnabled: true,
		MutedDomains:       []string{},
	}
}

// PreferenceLogic owns the personal notification preference record. Pool-agnostic
// by Principle III: every method takes the transaction the connect layer opened.
type PreferenceLogic interface {
	GetNotificationPreferences(ctx context.Context, tx database.DBTX, employeeID, organizationID dbuuid.UUID) (*NotificationPreferences, error)
	UpdateNotificationPreferences(ctx context.Context, tx database.DBTX, employeeID, organizationID dbuuid.UUID, params *NotificationPreferences) (*NotificationPreferences, error)
}

type preferenceLogicImpl struct {
	queries *database.Queries
}

// NewPreferenceLogic constructs the PreferenceLogic implementation.
func NewPreferenceLogic(queries *database.Queries) PreferenceLogic {
	return &preferenceLogicImpl{queries: queries}
}

func (l *preferenceLogicImpl) GetNotificationPreferences(ctx context.Context, tx database.DBTX, employeeID, organizationID dbuuid.UUID) (*NotificationPreferences, error) {
	row, err := l.queries.GetPersonalPreference(ctx, tx, &database.GetPersonalPreferenceParams{
		OrganizationID: organizationID,
		EmployeeID:     employeeID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return defaultNotificationPreferences(), nil
		}
		return nil, fmt.Errorf("failed to fetch notification preferences: %w", err)
	}
	return rowToPreferences(row), nil
}

func (l *preferenceLogicImpl) UpdateNotificationPreferences(ctx context.Context, tx database.DBTX, employeeID, organizationID dbuuid.UUID, params *NotificationPreferences) (*NotificationPreferences, error) {
	if params == nil {
		return nil, fmt.Errorf("%w: preferences required", ErrInvalidPreference)
	}

	// Validation runs in full before the write, so a refused request stores nothing.
	muted, err := normalizeMutedDomains(params.MutedDomains)
	if err != nil {
		return nil, err
	}
	dndStart, err := parseDayTime("dnd_start", params.DndStart)
	if err != nil {
		return nil, err
	}
	dndEnd, err := parseDayTime("dnd_end", params.DndEnd)
	if err != nil {
		return nil, err
	}

	row, err := l.queries.UpsertPersonalPreference(ctx, tx, &database.UpsertPersonalPreferenceParams{
		OrganizationID:     organizationID,
		EmployeeID:         employeeID,
		InAppAlertsEnabled: params.InAppAlertsEnabled,
		DndEnabled:         params.DndEnabled,
		DndStart:           dndStart,
		DndEnd:             dndEnd,
		MutedDomains:       muted,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to upsert notification preferences: %w", err)
	}
	return rowToPreferences(row), nil
}

// rowToPreferences projects a stored row onto the wire shape, filtering the mute
// list to domains the system still recognises (see filterKnownDomains).
func rowToPreferences(row *database.NotificationPersonalPreference) *NotificationPreferences {
	prefs := &NotificationPreferences{
		InAppAlertsEnabled: row.InAppAlertsEnabled,
		MutedDomains:       filterKnownDomains(row.MutedDomains),
		DndEnabled:         row.DndEnabled,
		DndStart:           formatDayTime(row.DndStart),
		DndEnd:             formatDayTime(row.DndEnd),
		Exists:             true,
	}
	if row.UpdatedAt.Valid {
		prefs.UpdatedAt = row.UpdatedAt.Time
	}
	return prefs
}

// filterKnownDomains drops stored domains the system no longer recognises,
// preserving the order of the rest.
//
// The read is deliberately allowed to differ from storage. A record naming a
// removed domain must not stop the person reading or saving their preferences,
// and the client must never be handed a value it would fail to send back — so
// the entry is dropped here and disappears on the next whole-record save.
//
// Unreachable through any supported write path today, because muted_domains_valid
// refuses unknown values; it becomes reachable the moment a migration narrows
// that list.
func filterKnownDomains(domains []string) []string {
	known := make([]string, 0, len(domains))
	for _, d := range domains {
		if IsValidSourceDomain(d) {
			known = append(known, d)
		}
	}
	return known
}

// normalizeMutedDomains rejects the first unrecognised domain by name, then
// deduplicates and sorts, so two clients sending the same set store the same
// array.
func normalizeMutedDomains(domains []string) ([]string, error) {
	for _, d := range domains {
		if !IsValidSourceDomain(d) {
			return nil, fmt.Errorf("%w: unknown notification area %q", ErrInvalidPreference, d)
		}
	}
	normalized := slices.Clone(domains)
	slices.Sort(normalized)
	normalized = slices.Compact(normalized)
	if normalized == nil {
		normalized = []string{}
	}
	return normalized, nil
}

// parseDayTime accepts "HH:MM" or the empty string. The stored column is
// `time without time zone`, so there is no timezone and no seconds to carry.
func parseDayTime(field, value string) (pgtype.Time, error) {
	if value == "" {
		return pgtype.Time{}, nil
	}
	parsed, err := time.Parse("15:04", value)
	if err != nil {
		return pgtype.Time{}, fmt.Errorf("%w: %s must be HH:MM, got %q", ErrInvalidPreference, field, value)
	}
	micros := int64(parsed.Hour())*int64(time.Hour/time.Microsecond) +
		int64(parsed.Minute())*int64(time.Minute/time.Microsecond)
	return pgtype.Time{Microseconds: micros, Valid: true}, nil
}

func formatDayTime(value pgtype.Time) string {
	if !value.Valid {
		return ""
	}
	minutes := value.Microseconds / int64(time.Minute/time.Microsecond)
	return fmt.Sprintf("%02d:%02d", minutes/60, minutes%60)
}

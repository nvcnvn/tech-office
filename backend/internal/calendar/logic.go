package calendar

import (
	"context"
	"errors"
	"time"

	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// Common errors for calendar operations.
var (
	ErrEventNotFound        = errors.New("calendar event not found")
	ErrAttendeeNotFound     = errors.New("event attendee not found")
	ErrResourceNotFound     = errors.New("calendar resource not found")
	ErrBookingLinkNotFound  = errors.New("booking link not found")
	ErrDelegationNotFound   = errors.New("calendar delegation not found")
	ErrCheckInNotFound      = errors.New("check-in record not found")
	ErrAccessDenied         = errors.New("access denied")
	ErrResourceConflict     = errors.New("resource has a conflicting booking for the requested time")
	ErrBookingLinkExpired   = errors.New("booking link has expired or is not active")
	ErrDelegationExpired    = errors.New("delegation has expired")
)

// NotificationPublisher defines the interface for publishing calendar notifications.
// Implemented by notification.NotificationService.
type NotificationPublisher interface {
	PublishNotification(ctx context.Context, tx database.DBTX, req *rpcv1.PublishNotificationRequest) (*rpcv1.PublishNotificationResponse, error)
}

// PresenceUpdater defines the interface for updating employee presence status.
// Implemented by notification.PresenceLogic.
type PresenceUpdater interface {
	UpdatePresenceStatus(ctx context.Context, tx database.DBTX, params *PresenceUpdateParams) error
}

// PresenceUpdateParams holds the parameters required for a presence update.
type PresenceUpdateParams struct {
	OrganizationID dbuuid.UUID
	EmployeeID     dbuuid.UUID
	ConnectionID   dbuuid.UUID
	Status         string
}

// CollaborationOverlayReader returns overlay items from the collaboration domain.
// Implemented by collaboration.Logic.
type CollaborationOverlayReader interface {
	GetTasksDueInRange(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, from, to time.Time) ([]*rpcv1.OverlayItem, error)
	GetRitualInstancesInRange(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, from, to time.Time) ([]*rpcv1.OverlayItem, error)
}

// DocsOverlayReader returns overlay items from the docs domain.
// Implemented by docs.Logic (will be wired when feature is connected).
type DocsOverlayReader interface {
	GetDocDeadlinesInRange(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, from, to time.Time) ([]*rpcv1.OverlayItem, error)
}

// OverlayOptions controls which overlay domains are included in ListOverlayItems.
type OverlayOptions struct {
	IncludeTasks        bool
	IncludeRituals      bool
	IncludeDocDeadlines bool
}

// CreateEventParams holds validated inputs for event creation.
type CreateEventParams struct {
	Title                 string
	Description           string
	EventType             string
	Visibility            string
	StartTime             time.Time
	EndTime               time.Time
	AllDay                bool
	LocationText          string
	VirtualLink           string
	RecurrenceRule        string
	RequiredAttendeeIDs   []dbuuid.UUID
	OptionalAttendeeIDs   []dbuuid.UUID
	ResourceIDs           []dbuuid.UUID
	RequiresCheckIn       bool
	RequiresEvidence      bool
	OrganizerOverrideID   dbuuid.NullUUID
}

// UpdateEventParams holds optional update fields (zero values are ignored).
type UpdateEventParams struct {
	Title              string
	Description        string
	EventType          string
	Visibility         string
	StartTime          *time.Time
	EndTime            *time.Time
	AllDay             *bool
	LocationText       *string
	VirtualLink        *string
	RequiredAttendeeIDs []dbuuid.UUID
	OptionalAttendeeIDs []dbuuid.UUID
	ResourceIDs        []dbuuid.UUID
}

// EditSeriesParams holds inputs for EditEventSeries.
type EditSeriesParams struct {
	InstanceStartTime   time.Time
	ChangeScope         string
	Title               string
	Description         string
	StartTime           *time.Time
	EndTime             *time.Time
	LocationText        *string
	VirtualLink         *string
	RequiredAttendeeIDs []dbuuid.UUID
	OptionalAttendeeIDs []dbuuid.UUID
	SkipInstance        bool
}

// ResourceFilter holds optional filters for ListResources.
type ResourceFilter struct {
	ResourceType string
	CheckFrom    *time.Time
	CheckUntil   *time.Time
	MinCapacity  int32
}

// CreateResourceParams holds inputs for CreateResource.
type CreateResourceParams struct {
	Name         string
	ResourceType string
	Location     string
	Capacity     int32
}

// UpdateResourceParams holds inputs for UpdateResource.
type UpdateResourceParams struct {
	Name     *string
	Location *string
	Capacity *int32
	IsActive *bool
}

// CreateBookingLinkParams holds inputs for CreateBookingLink.
type CreateBookingLinkParams struct {
	Title           string
	DurationMinutes int32
	ValidFrom       string // ISO date
	ValidUntil      string // ISO date
	ExpiresAt       time.Time
	AvailableWindows []*rpcv1.BookingWindow
}

// SearchEventsParams holds inputs for SearchEvents.
type SearchEventsParams struct {
	Query      string
	EventType  string
	ResourceID dbuuid.NullUUID
	AttendeeID dbuuid.NullUUID
	From       *time.Time
	Until      *time.Time
	Limit      int32
	Cursor     dbuuid.NullUUID
}

// Logic defines the full calendar API surface.
// All methods receive ctx + tx so the connect layer manages transactions.
type Logic interface {
	// ── Event CRUD ───────────────────────────────────────────────────────────
	CreateEvent(ctx context.Context, tx database.DBTX, orgID, actorID dbuuid.UUID, req *CreateEventParams) (*rpcv1.CalendarEvent, error)
	GetEvent(ctx context.Context, tx database.DBTX, orgID, actorID, eventID dbuuid.UUID) (*rpcv1.CalendarEvent, error)
	ListEvents(ctx context.Context, tx database.DBTX, orgID, actorID dbuuid.UUID, from, to time.Time, targetEmployeeID dbuuid.NullUUID) ([]*rpcv1.CalendarEvent, error)
	UpdateEvent(ctx context.Context, tx database.DBTX, orgID, actorID, eventID dbuuid.UUID, req *UpdateEventParams) (*rpcv1.CalendarEvent, error)
	CancelEvent(ctx context.Context, tx database.DBTX, orgID, actorID, eventID dbuuid.UUID) error
	EditEventSeries(ctx context.Context, tx database.DBTX, orgID, actorID, eventID dbuuid.UUID, req *EditSeriesParams) (*rpcv1.CalendarEvent, error)

	// ── RSVP ─────────────────────────────────────────────────────────────────
	RespondToInvite(ctx context.Context, tx database.DBTX, orgID, actorID, eventID dbuuid.UUID, rsvp string, note string) (*rpcv1.EventAttendee, error)
	ListEventAttendees(ctx context.Context, tx database.DBTX, orgID, actorID, eventID dbuuid.UUID) ([]*rpcv1.EventAttendee, error)

	// ── Working Hours ─────────────────────────────────────────────────────────
	GetWorkingHours(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID) ([]*rpcv1.WorkingHours, error)
	SetWorkingHours(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, hours []*rpcv1.WorkingHours) ([]*rpcv1.WorkingHours, error)

	// ── Scheduling Assistant ──────────────────────────────────────────────────
	GetFreeBusy(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, employeeIDs []dbuuid.UUID, from, to time.Time) ([]*rpcv1.EmployeeFreeBusy, error)
	SuggestSlots(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, employeeIDs []dbuuid.UUID, duration time.Duration, from, to time.Time, max int) ([]*rpcv1.FreeBusySlot, error)

	// ── Resources ─────────────────────────────────────────────────────────────
	ListResources(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, filter *ResourceFilter) ([]*rpcv1.CalendarResource, error)
	CreateResource(ctx context.Context, tx database.DBTX, orgID, actorID dbuuid.UUID, req *CreateResourceParams) (*rpcv1.CalendarResource, error)
	UpdateResource(ctx context.Context, tx database.DBTX, orgID, actorID, resourceID dbuuid.UUID, req *UpdateResourceParams) (*rpcv1.CalendarResource, error)
	SetResourceACL(ctx context.Context, tx database.DBTX, orgID, actorID, resourceID dbuuid.UUID, entries []*rpcv1.ResourceACLEntry) error

	// ── Booking Links ─────────────────────────────────────────────────────────
	CreateBookingLink(ctx context.Context, tx database.DBTX, orgID, actorID dbuuid.UUID, req *CreateBookingLinkParams) (*rpcv1.BookingLink, string, error)
	GetBookingLinkByToken(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, token string) (*rpcv1.BookingLink, []*rpcv1.FreeBusySlot, error)
	ClaimBookingSlot(ctx context.Context, tx database.DBTX, orgID, claimerID dbuuid.UUID, token string, slotStart time.Time) (*rpcv1.CalendarEvent, error)

	// ── Delegation ────────────────────────────────────────────────────────────
	GrantDelegation(ctx context.Context, tx database.DBTX, orgID, ownerID, delegateID dbuuid.UUID, expiresAt *time.Time) error
	ListDelegations(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID) ([]*rpcv1.CalendarDelegation, []*rpcv1.CalendarDelegation, error)
	RevokeDelegation(ctx context.Context, tx database.DBTX, orgID, ownerID, delegateID dbuuid.UUID) error
	VerifyDelegation(ctx context.Context, tx database.DBTX, orgID, ownerID, delegateID dbuuid.UUID) (bool, error)

	// ── Compliance ────────────────────────────────────────────────────────────
	CheckInToEvent(ctx context.Context, tx database.DBTX, orgID, actorID, eventID dbuuid.UUID) (*rpcv1.CalendarCheckIn, error)
	SubmitCheckInEvidence(ctx context.Context, tx database.DBTX, orgID, actorID, eventID dbuuid.UUID, fileIDs []dbuuid.UUID) (*rpcv1.CalendarCheckIn, error)
	ListAuditEntries(ctx context.Context, tx database.DBTX, orgID, eventID dbuuid.UUID, cursor dbuuid.NullUUID, limit int) ([]*rpcv1.CalendarAuditEntry, dbuuid.NullUUID, error)
	WriteAuditEntry(ctx context.Context, tx database.DBTX, orgID, eventID, actorID dbuuid.UUID, delegateID dbuuid.NullUUID, action string, diff any) error

	// ── Cross-Domain Overlays ─────────────────────────────────────────────────
	ListOverlayItems(ctx context.Context, tx database.DBTX, orgID, actorID dbuuid.UUID, from, to time.Time, opts *OverlayOptions) ([]*rpcv1.OverlayItem, error)

	// ── Search ────────────────────────────────────────────────────────────────
	SearchEvents(ctx context.Context, tx database.DBTX, orgID, actorID dbuuid.UUID, req *SearchEventsParams) ([]*rpcv1.CalendarEvent, dbuuid.NullUUID, error)
}

// logicImpl implements Logic.
type logicImpl struct {
	queries               *database.Queries
	notificationPublisher NotificationPublisher
	collaborationReader   CollaborationOverlayReader
	docsReader            DocsOverlayReader
}

// NewLogic constructs the calendar logic implementation.
func NewLogic(
	queries *database.Queries,
	notificationPublisher NotificationPublisher,
	collaborationReader CollaborationOverlayReader,
	docsReader DocsOverlayReader,
) Logic {
	return &logicImpl{
		queries:               queries,
		notificationPublisher: notificationPublisher,
		collaborationReader:   collaborationReader,
		docsReader:            docsReader,
	}
}

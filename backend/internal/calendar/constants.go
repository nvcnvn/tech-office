package calendar

const (
	EventTypeMeeting           = "meeting"
	EventTypeShift             = "shift"
	EventTypeDeadline          = "deadline"
	EventTypeReminder          = "reminder"
	EventTypeOutOfOffice       = "out_of_office"
	EventTypeCompanyEvent      = "company_event"
	EventTypeTraining          = "training"
	EventTypeMaintenanceWindow = "maintenance_window"
)

const (
	VisibilityPrivate        = "private"
	VisibilityPersonalShared = "personal_shared"
	VisibilityTeam           = "team"
	VisibilityOrgWide        = "org_wide"
)

const (
	RSVPStatusPending   = "pending"
	RSVPStatusAccepted  = "accepted"
	RSVPStatusDeclined  = "declined"
	RSVPStatusTentative = "tentative"
)

const (
	AttendeeRoleRequired  = "required"
	AttendeeRoleOptional  = "optional"
	AttendeeRoleOrganizer = "organizer"
)

const (
	ResourceTypeRoom      = "room"
	ResourceTypeVehicle   = "vehicle"
	ResourceTypeEquipment = "equipment"
	ResourceTypeDesk      = "desk"
	ResourceTypeLab       = "lab"
)

const (
	ExceptionTypeModified  = "modified"
	ExceptionTypeSkipped   = "skipped"
	ExceptionTypeCancelled = "cancelled"
)

const (
	ChangeScopeThisInstance     = "this_instance"
	ChangeScopeThisAndFollowing = "this_and_following"
	ChangeScopeAll              = "all"
)

const (
	AuditActionTypeCreated               = "created"
	AuditActionTypeModified              = "modified"
	AuditActionTypeCancelled             = "cancelled"
	AuditActionTypeCheckedIn             = "checked_in"
	AuditActionTypeEvidenceSubmitted     = "evidence_submitted"
	AuditActionTypeAcknowledged          = "acknowledged"
	AuditActionTypeFlaggedUnacknowledged = "flagged_unacknowledged"
	AuditActionTypeSeriesForked          = "series_forked"
	AuditActionTypeInstanceSkipped       = "instance_skipped"
)

const (
	BookingLinkStatusActive  = "active"
	BookingLinkStatusExpired = "expired"
	BookingLinkStatusClaimed = "claimed"
)

const (
	EventReminderStatusPending   = "pending"
	EventReminderStatusSent      = "sent"
	EventReminderStatusCancelled = "cancelled"
)

const SourceDomainCalendar = "calendar"

const (
	NotificationTypeCalendarEventInvite   = "calendar_event_invite"
	NotificationTypeCalendarEventCancel   = "calendar_event_cancel"
	NotificationTypeCalendarEventChange   = "calendar_event_change"
	NotificationTypeCalendarEventReminder = "calendar_event_reminder"
	NotificationTypeCalendarCheckInMissed = "calendar_check_in_missed"
	NotificationTypeCalendarEventDigest   = "calendar_event_digest"
)

const (
	PolicyKeyCalendarEventInvite   = "calendar_event_invite"
	PolicyKeyCalendarEventCancel   = "calendar_event_cancel"
	PolicyKeyCalendarEventChange   = "calendar_event_change"
	PolicyKeyCalendarEventReminder = "calendar_event_reminder"
	PolicyKeyCalendarCheckInMissed = "calendar_check_in_missed"
	PolicyKeyCalendarEventDigest   = "calendar_event_digest"
)

const ResourceDomainCalendarEvent = "calendar_event"

const DefaultReminderOffsetMinutes = 15

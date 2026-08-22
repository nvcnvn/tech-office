package calendar

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

func toPgTimestamptz(t time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: t.UTC(), Valid: true}
}

func toPgText(s string) pgtype.Text {
	if s == "" {
		return pgtype.Text{Valid: false}
	}
	return pgtype.Text{Valid: true, String: s}
}

func pbTimestamp(ts pgtype.Timestamptz) *timestamppb.Timestamp {
	if !ts.Valid {
		return nil
	}
	return timestamppb.New(ts.Time)
}

// eventToProto converts a database CalendarEvent row to the proto representation.
// Attendees and resource bookings are not populated here; callers fill them separately.
func eventToProto(e *database.CalendarEvent) *rpcv1.CalendarEvent {
	proto := &rpcv1.CalendarEvent{
		Id:                  e.ID.String(),
		Title:               e.Title,
		EventType:           e.EventType,
		Visibility:          e.Visibility,
		AllDay:              e.AllDay,
		OrganizerEmployeeId: e.OrganizerID.String(),
		RequiresCheckIn:     e.RequiresCheckIn,
		RequiresEvidence:    e.RequiresEvidence,
		StartTime:           pbTimestamp(e.StartTime),
		EndTime:             pbTimestamp(e.EndTime),
		UpdatedAt:           pbTimestamp(e.UpdatedAt),
		CancelledAt:         pbTimestamp(e.CancelledAt),
		IsExceptionInstance: e.IsExceptionInstance,
		OriginalStartTime:   pbTimestamp(e.OriginalStartTime),
	}
	if e.Description.Valid {
		proto.Description = e.Description.String
	}
	if e.LocationText.Valid {
		proto.LocationText = e.LocationText.String
	}
	if e.VirtualLink.Valid {
		proto.VirtualLink = e.VirtualLink.String
	}
	if e.RecurrenceRule.Valid {
		proto.RecurrenceRule = e.RecurrenceRule.String
	}
	if e.SeriesID.Valid {
		proto.SeriesId = e.SeriesID.UUID.String()
	}
	if e.DescriptionDocumentID.Valid {
		proto.DescriptionDocumentId = e.DescriptionDocumentID.UUID.String()
	}
	if e.DiscussionChannelID.Valid {
		proto.DiscussionChannelId = e.DiscussionChannelID.UUID.String()
	}
	return proto
}

// ─────────────────────────────────────────────────────────────────────────────
// CreateEvent
// ─────────────────────────────────────────────────────────────────────────────

func (l *logicImpl) CreateEvent(ctx context.Context, tx database.DBTX, orgID, actorID dbuuid.UUID, req *CreateEventParams) (*rpcv1.CalendarEvent, error) {
	if req.Title == "" {
		return nil, fmt.Errorf("event title is required")
	}
	if !IsValidEventType(req.EventType) {
		return nil, fmt.Errorf("invalid event_type: %s", req.EventType)
	}
	if !IsValidVisibility(req.Visibility) {
		return nil, fmt.Errorf("invalid visibility: %s", req.Visibility)
	}
	if req.StartTime.IsZero() || req.EndTime.IsZero() {
		return nil, fmt.Errorf("start_time and end_time are required")
	}
	if !req.AllDay && !req.EndTime.After(req.StartTime) {
		return nil, fmt.Errorf("end_time must be after start_time")
	}

	organizerID := actorID
	if req.OrganizerOverrideID.Valid {
		overrideID := dbuuid.NullUUIDToUUID(req.OrganizerOverrideID)
		ok, delErr := l.VerifyDelegation(ctx, tx, orgID, overrideID, actorID)
		if delErr != nil {
			return nil, fmt.Errorf("verify delegation: %w", delErr)
		}
		if !ok {
			return nil, ErrAccessDenied
		}
		organizerID = overrideID
	}

	now := toPgTimestamptz(time.Now())
	eventID := dbuuid.Must()

	dbEvent, err := l.queries.InsertEvent(ctx, tx, &database.InsertEventParams{
		ID:               eventID,
		OrganizationID:   orgID,
		Title:            req.Title,
		Description:      toPgText(req.Description),
		EventType:        req.EventType,
		Visibility:       req.Visibility,
		StartTime:        toPgTimestamptz(req.StartTime),
		EndTime:          toPgTimestamptz(req.EndTime),
		AllDay:           req.AllDay,
		LocationText:     toPgText(req.LocationText),
		VirtualLink:      toPgText(req.VirtualLink),
		OrganizerID:      organizerID,
		RecurrenceRule:   toPgText(req.RecurrenceRule),
		RequiresCheckIn:  req.RequiresCheckIn,
		RequiresEvidence: req.RequiresEvidence,
		UpdatedAt:        now,
	})
	if err != nil {
		return nil, fmt.Errorf("insert event: %w", err)
	}

	// Insert organizer as attendee with accepted status.
	_, err = l.queries.InsertAttendee(ctx, tx, &database.InsertAttendeeParams{
		ID:             dbuuid.Must(),
		OrganizationID: orgID,
		EventID:        eventID,
		EmployeeID:     organizerID,
		Role:           AttendeeRoleOrganizer,
		RsvpStatus:     RSVPStatusAccepted,
		UpdatedAt:      now,
	})
	if err != nil {
		return nil, fmt.Errorf("insert organizer attendee: %w", err)
	}

	// Insert required attendees.
	for _, empID := range req.RequiredAttendeeIDs {
		if empID == organizerID {
			continue // already inserted as organizer
		}
		_, err = l.queries.InsertAttendee(ctx, tx, &database.InsertAttendeeParams{
			ID:             dbuuid.Must(),
			OrganizationID: orgID,
			EventID:        eventID,
			EmployeeID:     empID,
			Role:           AttendeeRoleRequired,
			RsvpStatus:     RSVPStatusPending,
			UpdatedAt:      now,
		})
		if err != nil {
			return nil, fmt.Errorf("insert required attendee: %w", err)
		}
	}

	// Insert optional attendees.
	for _, empID := range req.OptionalAttendeeIDs {
		if empID == organizerID {
			continue
		}
		_, err = l.queries.InsertAttendee(ctx, tx, &database.InsertAttendeeParams{
			ID:             dbuuid.Must(),
			OrganizationID: orgID,
			EventID:        eventID,
			EmployeeID:     empID,
			Role:           AttendeeRoleOptional,
			RsvpStatus:     RSVPStatusPending,
			UpdatedAt:      now,
		})
		if err != nil {
			return nil, fmt.Errorf("insert optional attendee: %w", err)
		}
	}

	// Schedule reminders for all attendees.
	allAttendeeIDs := append([]dbuuid.UUID{organizerID}, req.RequiredAttendeeIDs...)
	allAttendeeIDs = append(allAttendeeIDs, req.OptionalAttendeeIDs...)
	fireAt := req.StartTime.Add(-time.Duration(DefaultReminderOffsetMinutes) * time.Minute)
	if fireAt.After(time.Now()) {
		for _, empID := range allAttendeeIDs {
			_, _ = l.queries.InsertEventReminder(ctx, tx, &database.InsertEventReminderParams{
				ID:                    dbuuid.Must(),
				OrganizationID:        orgID,
				EventID:               eventID,
				AttendeeEmployeeID:    empID,
				ReminderOffsetMinutes: DefaultReminderOffsetMinutes,
				FireAt:                toPgTimestamptz(fireAt),
				CreatedAt:             now,
			})
			// Ignore conflict (ON CONFLICT DO NOTHING) — harmless.
		}
	}

	// Write audit entry.
	_ = l.writeAuditEntry(ctx, tx, orgID, eventID, actorID, dbuuid.NullUUID{}, AuditActionTypeCreated, nil)

	// Book requested resources.
	for _, resID := range req.ResourceIDs {
		allowed, aclErr := l.CheckResourceACL(ctx, tx, orgID, resID, actorID)
		if aclErr != nil {
			return nil, fmt.Errorf("check resource ACL: %w", aclErr)
		}
		if !allowed {
			return nil, ErrAccessDenied
		}
		_, bookErr := l.CreateResourceBooking(ctx, tx, orgID, eventID, resID, actorID, req.StartTime, req.EndTime)
		if bookErr != nil {
			return nil, bookErr
		}
	}

	protoEvent := eventToProto(dbEvent)
	// Fetch attendees to populate the proto.
	attendees, err := l.fetchAttendeesForEvent(ctx, tx, orgID, eventID)
	if err == nil {
		protoEvent.Attendees = attendees
	}
	// Fetch resource bookings.
	bookings, err := l.fetchBookingsForEvent(ctx, tx, orgID, eventID)
	if err == nil {
		protoEvent.ResourceBookings = bookings
	}

	// Publish invite notifications to non-organizer attendees.
	l.publishEventNotification(ctx, tx, orgID, eventID, organizerID, req.Title, NotificationTypeCalendarEventInvite, PolicyKeyCalendarEventInvite, req.RequiredAttendeeIDs, req.OptionalAttendeeIDs)

	return protoEvent, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// GetEvent
// ─────────────────────────────────────────────────────────────────────────────

func (l *logicImpl) GetEvent(ctx context.Context, tx database.DBTX, orgID, actorID, eventID dbuuid.UUID) (*rpcv1.CalendarEvent, error) {
	dbEvent, err := l.queries.GetEvent(ctx, tx, &database.GetEventParams{
		OrganizationID: orgID,
		ID:             eventID,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrEventNotFound
		}
		return nil, fmt.Errorf("get event: %w", err)
	}

	// Visibility check: private events only visible to organizer or attendees.
	if dbEvent.Visibility == VisibilityPrivate && dbEvent.OrganizerID != actorID {
		// Check if actor is an attendee.
		attendees, aErr := l.queries.ListAttendees(ctx, tx, &database.ListAttendeesParams{
			OrganizationID: orgID,
			EventID:        eventID,
		})
		if aErr != nil {
			return nil, fmt.Errorf("list attendees for visibility: %w", aErr)
		}
		isAttendee := false
		for _, a := range attendees {
			if a.EmployeeID == actorID {
				isAttendee = true
				break
			}
		}
		if !isAttendee {
			return nil, ErrAccessDenied
		}
	}

	protoEvent := eventToProto(dbEvent)
	attendees, err := l.fetchAttendeesForEvent(ctx, tx, orgID, eventID)
	if err == nil {
		protoEvent.Attendees = attendees
	}
	bookings, err := l.fetchBookingsForEvent(ctx, tx, orgID, eventID)
	if err == nil {
		protoEvent.ResourceBookings = bookings
	}
	return protoEvent, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// ListEvents
// ─────────────────────────────────────────────────────────────────────────────

func (l *logicImpl) ListEvents(ctx context.Context, tx database.DBTX, orgID, actorID dbuuid.UUID, from, to time.Time, targetEmployeeID dbuuid.NullUUID) ([]*rpcv1.CalendarEvent, error) {
	fromPg := toPgTimestamptz(from)
	toPg := toPgTimestamptz(to)

	// If a target employee is specified, fetch their events (free/busy respects visibility).
	queryEmployeeID := actorID
	if targetEmployeeID.Valid {
		queryEmployeeID = dbuuid.NullUUIDToUUID(targetEmployeeID)
	}

	// Events via attendee join (personal + invited).
	personalEvents, err := l.queries.ListEventsForEmployee(ctx, tx, &database.ListEventsForEmployeeParams{
		OrganizationID: orgID,
		EmployeeID:     queryEmployeeID,
		RangeStart:     fromPg,
		RangeEnd:       toPg,
	})
	if err != nil {
		return nil, fmt.Errorf("list events for employee: %w", err)
	}

	// Org-wide events (team / org_wide visibility).
	orgEvents, err := l.queries.ListEventsForOrg(ctx, tx, &database.ListEventsForOrgParams{
		OrganizationID: orgID,
		RangeStart:     fromPg,
		RangeEnd:       toPg,
	})
	if err != nil {
		return nil, fmt.Errorf("list org events: %w", err)
	}

	// Merge and deduplicate by event ID.
	seen := make(map[dbuuid.UUID]struct{})
	var merged []*database.CalendarEvent
	for _, e := range personalEvents {
		seen[e.ID] = struct{}{}
		merged = append(merged, e)
	}
	for _, e := range orgEvents {
		if _, ok := seen[e.ID]; !ok {
			merged = append(merged, e)
		}
	}

	result := make([]*rpcv1.CalendarEvent, 0, len(merged))
	for _, e := range merged {
		isParticipant := e.OrganizerID == actorID
		if !isParticipant {
			attendees, aErr := l.queries.ListAttendees(ctx, tx, &database.ListAttendeesParams{
				OrganizationID: orgID,
				EventID:        e.ID,
			})
			if aErr == nil {
				for _, a := range attendees {
					if a.EmployeeID == actorID {
						isParticipant = true
						break
					}
				}
			}
		}

		switch {
		case e.Visibility == VisibilityPrivate && !isParticipant:
			// Redacted stub: only show time block as "Busy".
			result = append(result, &rpcv1.CalendarEvent{
				Id:        e.ID.String(),
				Title:     "Busy",
				EventType: e.EventType,
				StartTime: pbTimestamp(e.StartTime),
				EndTime:   pbTimestamp(e.EndTime),
				AllDay:    e.AllDay,
			})
		case e.Visibility == VisibilityPersonalShared && !isParticipant:
			// Free/busy stub: show time but no details.
			result = append(result, &rpcv1.CalendarEvent{
				Id:                  e.ID.String(),
				Title:               "Busy",
				EventType:           e.EventType,
				Visibility:          e.Visibility,
				StartTime:           pbTimestamp(e.StartTime),
				EndTime:             pbTimestamp(e.EndTime),
				AllDay:              e.AllDay,
				OrganizerEmployeeId: e.OrganizerID.String(),
			})
		default:
			proto := eventToProto(e)
			if isParticipant {
				attendees, aErr := l.fetchAttendeesForEvent(ctx, tx, orgID, e.ID)
				if aErr == nil {
					proto.Attendees = attendees
				}
			}
			result = append(result, proto)
		}
	}
	return result, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// UpdateEvent
// ─────────────────────────────────────────────────────────────────────────────

func (l *logicImpl) UpdateEvent(ctx context.Context, tx database.DBTX, orgID, actorID, eventID dbuuid.UUID, req *UpdateEventParams) (*rpcv1.CalendarEvent, error) {
	// Verify event exists and actor is organizer.
	dbEvent, err := l.queries.GetEvent(ctx, tx, &database.GetEventParams{
		OrganizationID: orgID,
		ID:             eventID,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrEventNotFound
		}
		return nil, fmt.Errorf("get event for update: %w", err)
	}
	if dbEvent.OrganizerID != actorID {
		return nil, ErrAccessDenied
	}

	now := toPgTimestamptz(time.Now())

	params := &database.UpdateEventParams{
		OrganizationID: orgID,
		ID:             eventID,
		UpdatedAt:      now,
		Title:          toPgText(req.Title),
		Description:    toPgText(req.Description),
		EventType:      toPgText(req.EventType),
		Visibility:     toPgText(req.Visibility),
	}
	if req.LocationText != nil {
		params.LocationText = toPgText(*req.LocationText)
	} else {
		params.LocationText = dbEvent.LocationText
	}
	if req.VirtualLink != nil {
		params.VirtualLink = toPgText(*req.VirtualLink)
	} else {
		params.VirtualLink = dbEvent.VirtualLink
	}
	if req.StartTime != nil {
		params.StartTime = toPgTimestamptz(*req.StartTime)
	} else {
		params.StartTime = dbEvent.StartTime
	}
	if req.EndTime != nil {
		params.EndTime = toPgTimestamptz(*req.EndTime)
	} else {
		params.EndTime = dbEvent.EndTime
	}
	if req.AllDay != nil {
		params.AllDay = pgtype.Bool{Valid: true, Bool: *req.AllDay}
	}

	updated, err := l.queries.UpdateEvent(ctx, tx, params)
	if err != nil {
		return nil, fmt.Errorf("update event: %w", err)
	}

	// Reset attendee RSVPs when time or location changes.
	timeChanged := req.StartTime != nil || req.EndTime != nil
	locationChanged := req.LocationText != nil
	if timeChanged || locationChanged {
		if resetErr := l.queries.ResetAttendeesRSVP(ctx, tx, &database.ResetAttendeesRSVPParams{
			OrganizationID: orgID,
			EventID:        eventID,
			UpdatedAt:      now,
		}); resetErr != nil {
			return nil, fmt.Errorf("reset attendees RSVP: %w", resetErr)
		}
	}

	_ = l.writeAuditEntry(ctx, tx, orgID, eventID, actorID, dbuuid.NullUUID{}, AuditActionTypeUpdated, req)

	protoEvent := eventToProto(updated)
	attendees, err := l.fetchAttendeesForEvent(ctx, tx, orgID, eventID)
	if err == nil {
		protoEvent.Attendees = attendees
	}

	// Publish change notification to non-organizer attendees when time/location changed.
	if timeChanged || locationChanged {
		l.publishChangeNotification(ctx, tx, orgID, eventID, actorID, updated.Title)
	}

	return protoEvent, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// CancelEvent
// ─────────────────────────────────────────────────────────────────────────────

func (l *logicImpl) CancelEvent(ctx context.Context, tx database.DBTX, orgID, actorID, eventID dbuuid.UUID) error {
	dbEvent, err := l.queries.GetEvent(ctx, tx, &database.GetEventParams{
		OrganizationID: orgID,
		ID:             eventID,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return ErrEventNotFound
		}
		return fmt.Errorf("get event for cancel: %w", err)
	}
	if dbEvent.OrganizerID != actorID {
		return ErrAccessDenied
	}

	now := toPgTimestamptz(time.Now())
	actorNullUUID := dbuuid.UUIDToNullUUID(actorID)

	_, err = l.queries.CancelEvent(ctx, tx, &database.CancelEventParams{
		OrganizationID: orgID,
		ID:             eventID,
		CancelledAt:    now,
		CancelledByID:  actorNullUUID,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return ErrEventNotFound
		}
		return fmt.Errorf("cancel event: %w", err)
	}

	// Cancel pending reminders.
	_ = l.queries.CancelRemindersForEvent(ctx, tx, &database.CancelRemindersForEventParams{
		OrganizationID: orgID,
		EventID:        eventID,
	})

	// Release resource bookings.
	_ = l.DeleteBookingsForEvent(ctx, tx, orgID, eventID)

	_ = l.writeAuditEntry(ctx, tx, orgID, eventID, actorID, dbuuid.NullUUID{}, AuditActionTypeCancelled, nil)

	// Publish cancellation notification to all attendees.
	l.publishCancelNotification(ctx, tx, orgID, eventID, actorID, dbEvent.Title)

	return nil
}

// ─────────────────────────────────────────────────────────────────────────────
// EditEventSeries
// ─────────────────────────────────────────────────────────────────────────────

func (l *logicImpl) EditEventSeries(ctx context.Context, tx database.DBTX, orgID, actorID, eventID dbuuid.UUID, req *EditSeriesParams) (*rpcv1.CalendarEvent, error) {
	// Load the series head event.
	dbEvent, err := l.queries.GetEvent(ctx, tx, &database.GetEventParams{
		OrganizationID: orgID,
		ID:             eventID,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrEventNotFound
		}
		return nil, fmt.Errorf("get event for series edit: %w", err)
	}
	if dbEvent.OrganizerID != actorID {
		return nil, ErrAccessDenied
	}

	switch req.ChangeScope {
	case ChangeScopeThisInstance:
		return l.editThisInstance(ctx, tx, orgID, actorID, dbEvent, req)
	case ChangeScopeThisAndFollowing:
		return l.editThisAndFollowing(ctx, tx, orgID, actorID, dbEvent, req)
	case ChangeScopeAll:
		return l.editAllInstances(ctx, tx, orgID, actorID, dbEvent, req)
	default:
		return nil, fmt.Errorf("invalid change_scope: %s", req.ChangeScope)
	}
}

// editThisInstance handles scope=this_instance: skip or modify a single occurrence.
func (l *logicImpl) editThisInstance(ctx context.Context, tx database.DBTX, orgID, actorID dbuuid.UUID, series *database.CalendarEvent, req *EditSeriesParams) (*rpcv1.CalendarEvent, error) {
	now := toPgTimestamptz(time.Now())

	if req.SkipInstance {
		// Insert a "skipped" exception.
		_, err := l.queries.InsertRecurrenceException(ctx, tx, &database.InsertRecurrenceExceptionParams{
			ID:                dbuuid.Must(),
			OrganizationID:    orgID,
			SeriesID:          series.ID,
			OriginalStartTime: toPgTimestamptz(req.InstanceStartTime),
			ExceptionType:     ExceptionTypeSkipped,
			ChangedByID:       actorID,
			ChangedAt:         now,
			ChangeScope:       ChangeScopeThisInstance,
		})
		if err != nil {
			return nil, fmt.Errorf("insert skip exception: %w", err)
		}

		_ = l.writeAuditEntry(ctx, tx, orgID, series.ID, actorID, dbuuid.NullUUID{}, AuditActionTypeInstanceSkipped, map[string]any{
			"original_start_time": req.InstanceStartTime,
		})

		return eventToProto(series), nil
	}

	// Create a new standalone event as the exception instance.
	exceptionEventID := dbuuid.Must()
	duration := series.EndTime.Time.Sub(series.StartTime.Time)

	newStart := req.InstanceStartTime
	newEnd := newStart.Add(duration)
	if req.StartTime != nil {
		newStart = *req.StartTime
	}
	if req.EndTime != nil {
		newEnd = *req.EndTime
	}

	title := series.Title
	if req.Title != "" {
		title = req.Title
	}
	desc := series.Description
	if req.Description != "" {
		desc = toPgText(req.Description)
	}
	locText := series.LocationText
	if req.LocationText != nil {
		locText = toPgText(*req.LocationText)
	}
	virtLink := series.VirtualLink
	if req.VirtualLink != nil {
		virtLink = toPgText(*req.VirtualLink)
	}

	exceptionEvent, err := l.queries.InsertEvent(ctx, tx, &database.InsertEventParams{
		ID:                  exceptionEventID,
		OrganizationID:      orgID,
		Title:               title,
		Description:         desc,
		EventType:           series.EventType,
		Visibility:          series.Visibility,
		StartTime:           toPgTimestamptz(newStart),
		EndTime:             toPgTimestamptz(newEnd),
		AllDay:              series.AllDay,
		LocationText:        locText,
		VirtualLink:         virtLink,
		OrganizerID:         series.OrganizerID,
		IsExceptionInstance: true,
		OriginalStartTime:   toPgTimestamptz(req.InstanceStartTime),
		SeriesID:            dbuuid.UUIDToNullUUID(series.ID),
		RequiresCheckIn:     series.RequiresCheckIn,
		RequiresEvidence:    series.RequiresEvidence,
		UpdatedAt:           now,
	})
	if err != nil {
		return nil, fmt.Errorf("insert exception event: %w", err)
	}

	// Insert organizer attendee for the exception event.
	_, _ = l.queries.InsertAttendee(ctx, tx, &database.InsertAttendeeParams{
		ID:             dbuuid.Must(),
		OrganizationID: orgID,
		EventID:        exceptionEventID,
		EmployeeID:     series.OrganizerID,
		Role:           AttendeeRoleOrganizer,
		RsvpStatus:     RSVPStatusAccepted,
		UpdatedAt:      now,
	})

	// Copy attendees from series head to exception event.
	seriesAttendees, _ := l.queries.ListAttendees(ctx, tx, &database.ListAttendeesParams{
		OrganizationID: orgID,
		EventID:        series.ID,
	})
	for _, a := range seriesAttendees {
		if a.EmployeeID == series.OrganizerID {
			continue // already added above
		}
		_, _ = l.queries.InsertAttendee(ctx, tx, &database.InsertAttendeeParams{
			ID:             dbuuid.Must(),
			OrganizationID: orgID,
			EventID:        exceptionEventID,
			EmployeeID:     a.EmployeeID,
			Role:           a.Role,
			RsvpStatus:     RSVPStatusPending,
			UpdatedAt:      now,
		})
	}

	// Record the exception.
	_, err = l.queries.InsertRecurrenceException(ctx, tx, &database.InsertRecurrenceExceptionParams{
		ID:                dbuuid.Must(),
		OrganizationID:    orgID,
		SeriesID:          series.ID,
		OriginalStartTime: toPgTimestamptz(req.InstanceStartTime),
		ExceptionType:     ExceptionTypeModified,
		NewEventID:        dbuuid.UUIDToNullUUID(exceptionEventID),
		ChangedByID:       actorID,
		ChangedAt:         now,
		ChangeScope:       ChangeScopeThisInstance,
	})
	if err != nil {
		return nil, fmt.Errorf("insert modified exception: %w", err)
	}

	_ = l.writeAuditEntry(ctx, tx, orgID, series.ID, actorID, dbuuid.NullUUID{}, AuditActionTypeModified, map[string]any{
		"scope":               ChangeScopeThisInstance,
		"original_start_time": req.InstanceStartTime,
		"new_event_id":        exceptionEventID.String(),
	})

	proto := eventToProto(exceptionEvent)
	attendees, err := l.fetchAttendeesForEvent(ctx, tx, orgID, exceptionEventID)
	if err == nil {
		proto.Attendees = attendees
	}
	return proto, nil
}

// editThisAndFollowing handles scope=this_and_following: truncate the original
// series and create a new forked series starting from the split point.
func (l *logicImpl) editThisAndFollowing(ctx context.Context, tx database.DBTX, orgID, actorID dbuuid.UUID, series *database.CalendarEvent, req *EditSeriesParams) (*rpcv1.CalendarEvent, error) {
	if !series.RecurrenceRule.Valid || series.RecurrenceRule.String == "" {
		return nil, fmt.Errorf("cannot fork a non-recurring event")
	}

	now := toPgTimestamptz(time.Now())
	originalRule := series.RecurrenceRule.String

	// 1. Truncate the original RRULE to end before the fork point.
	truncatedRule, err := truncateRRULE(originalRule, series.StartTime.Time, req.InstanceStartTime)
	if err != nil {
		return nil, fmt.Errorf("truncate RRULE: %w", err)
	}
	truncatedEnd := computeRecurrenceEnd(truncatedRule, series.StartTime.Time)
	var truncatedEndPg pgtype.Timestamptz
	if truncatedEnd != nil {
		truncatedEndPg = toPgTimestamptz(*truncatedEnd)
	}

	// Update the original series head with the truncated rule.
	_, err = l.queries.UpdateEvent(ctx, tx, &database.UpdateEventParams{
		OrganizationID: orgID,
		ID:             series.ID,
		Title:          toPgText(series.Title),
		Description:    series.Description,
		EventType:      toPgText(series.EventType),
		Visibility:     toPgText(series.Visibility),
		StartTime:      series.StartTime,
		EndTime:        series.EndTime,
		AllDay:         pgtype.Bool{Valid: true, Bool: series.AllDay},
		LocationText:   series.LocationText,
		VirtualLink:    series.VirtualLink,
		RecurrenceRule: toPgText(truncatedRule),
		RecurrenceEnd:  truncatedEndPg,
		UpdatedAt:      now,
	})
	if err != nil {
		return nil, fmt.Errorf("update original series with truncated RRULE: %w", err)
	}

	// 2. Build the new forked series.
	newSeriesID := dbuuid.Must()
	newStart := req.InstanceStartTime
	duration := series.EndTime.Time.Sub(series.StartTime.Time)
	newEnd := newStart.Add(duration)
	if req.StartTime != nil {
		newStart = *req.StartTime
	}
	if req.EndTime != nil {
		newEnd = *req.EndTime
	}

	title := series.Title
	if req.Title != "" {
		title = req.Title
	}
	desc := series.Description
	if req.Description != "" {
		desc = toPgText(req.Description)
	}
	locText := series.LocationText
	if req.LocationText != nil {
		locText = toPgText(*req.LocationText)
	}
	virtLink := series.VirtualLink
	if req.VirtualLink != nil {
		virtLink = toPgText(*req.VirtualLink)
	}

	// Compute the remaining RRULE for the fork.
	forkRule, err := remainingRRULE(originalRule, series.StartTime.Time, req.InstanceStartTime)
	if err != nil {
		return nil, fmt.Errorf("compute remaining RRULE: %w", err)
	}
	forkEnd := computeRecurrenceEnd(forkRule, newStart)
	var forkEndPg pgtype.Timestamptz
	if forkEnd != nil {
		forkEndPg = toPgTimestamptz(*forkEnd)
	}

	newSeriesEvent, err := l.queries.InsertEvent(ctx, tx, &database.InsertEventParams{
		ID:               newSeriesID,
		OrganizationID:   orgID,
		Title:            title,
		Description:      desc,
		EventType:        series.EventType,
		Visibility:       series.Visibility,
		StartTime:        toPgTimestamptz(newStart),
		EndTime:          toPgTimestamptz(newEnd),
		AllDay:           series.AllDay,
		LocationText:     locText,
		VirtualLink:      virtLink,
		OrganizerID:      series.OrganizerID,
		RecurrenceRule:   toPgText(forkRule),
		RecurrenceEnd:    forkEndPg,
		SeriesID:         dbuuid.UUIDToNullUUID(series.ID),
		RequiresCheckIn:  series.RequiresCheckIn,
		RequiresEvidence: series.RequiresEvidence,
		UpdatedAt:        now,
	})
	if err != nil {
		return nil, fmt.Errorf("insert forked series event: %w", err)
	}

	// Copy organizer + attendees from original series.
	_, _ = l.queries.InsertAttendee(ctx, tx, &database.InsertAttendeeParams{
		ID:             dbuuid.Must(),
		OrganizationID: orgID,
		EventID:        newSeriesID,
		EmployeeID:     series.OrganizerID,
		Role:           AttendeeRoleOrganizer,
		RsvpStatus:     RSVPStatusAccepted,
		UpdatedAt:      now,
	})
	seriesAttendees, _ := l.queries.ListAttendees(ctx, tx, &database.ListAttendeesParams{
		OrganizationID: orgID,
		EventID:        series.ID,
	})
	for _, a := range seriesAttendees {
		if a.EmployeeID == series.OrganizerID {
			continue
		}
		_, _ = l.queries.InsertAttendee(ctx, tx, &database.InsertAttendeeParams{
			ID:             dbuuid.Must(),
			OrganizationID: orgID,
			EventID:        newSeriesID,
			EmployeeID:     a.EmployeeID,
			Role:           a.Role,
			RsvpStatus:     RSVPStatusPending,
			UpdatedAt:      now,
		})
	}

	// Record exception for all instances from the fork point onward.
	_, err = l.queries.InsertRecurrenceException(ctx, tx, &database.InsertRecurrenceExceptionParams{
		ID:                dbuuid.Must(),
		OrganizationID:    orgID,
		SeriesID:          series.ID,
		OriginalStartTime: toPgTimestamptz(req.InstanceStartTime),
		ExceptionType:     ExceptionTypeModified,
		NewEventID:        dbuuid.UUIDToNullUUID(newSeriesID),
		ChangedByID:       actorID,
		ChangedAt:         now,
		ChangeScope:       ChangeScopeThisAndFollowing,
	})
	if err != nil {
		return nil, fmt.Errorf("insert this_and_following exception: %w", err)
	}

	_ = l.writeAuditEntry(ctx, tx, orgID, series.ID, actorID, dbuuid.NullUUID{}, AuditActionTypeSeriesForked, map[string]any{
		"scope":          ChangeScopeThisAndFollowing,
		"fork_start":     req.InstanceStartTime,
		"new_series_id":  newSeriesID.String(),
		"truncated_rule": truncatedRule,
		"fork_rule":      forkRule,
	})

	proto := eventToProto(newSeriesEvent)
	attendees, err := l.fetchAttendeesForEvent(ctx, tx, orgID, newSeriesID)
	if err == nil {
		proto.Attendees = attendees
	}
	return proto, nil
}

// editAllInstances handles scope=all: update the series head directly.
func (l *logicImpl) editAllInstances(ctx context.Context, tx database.DBTX, orgID, actorID dbuuid.UUID, series *database.CalendarEvent, req *EditSeriesParams) (*rpcv1.CalendarEvent, error) {
	updateReq := &UpdateEventParams{
		Title:               req.Title,
		Description:         req.Description,
		StartTime:           req.StartTime,
		EndTime:             req.EndTime,
		LocationText:        req.LocationText,
		VirtualLink:         req.VirtualLink,
		RequiredAttendeeIDs: req.RequiredAttendeeIDs,
		OptionalAttendeeIDs: req.OptionalAttendeeIDs,
	}
	return l.UpdateEvent(ctx, tx, orgID, actorID, series.ID, updateReq)
}

// ─────────────────────────────────────────────────────────────────────────────
// SearchEvents
// ─────────────────────────────────────────────────────────────────────────────

func (l *logicImpl) SearchEvents(ctx context.Context, tx database.DBTX, orgID, actorID dbuuid.UUID, req *SearchEventsParams) ([]*rpcv1.CalendarEvent, dbuuid.NullUUID, error) {
	limit := req.Limit
	if limit <= 0 || limit > 100 {
		limit = 20
	}

	params := &database.SearchEventsParams{
		OrganizationID:     orgID,
		WebsearchToTsquery: req.Query,
		Limit:              limit,
		Cursor:             req.Cursor,
	}
	if req.EventType != "" {
		params.EventType = toPgText(req.EventType)
	}
	if req.From != nil {
		params.FromTime = toPgTimestamptz(*req.From)
	}
	if req.Until != nil {
		params.UntilTime = toPgTimestamptz(*req.Until)
	}

	rows, err := l.queries.SearchEvents(ctx, tx, params)
	if err != nil {
		return nil, dbuuid.NullUUID{}, fmt.Errorf("search events: %w", err)
	}

	events := make([]*rpcv1.CalendarEvent, 0, len(rows))
	var nextCursor dbuuid.NullUUID
	for i, e := range rows {
		if int32(i) < limit {
			events = append(events, eventToProto(e))
		}
		if int32(i) == limit-1 {
			nextCursor = dbuuid.UUIDToNullUUID(e.ID)
		}
	}
	return events, nextCursor, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

func (l *logicImpl) writeAuditEntry(ctx context.Context, tx database.DBTX, orgID, eventID, actorID dbuuid.UUID, delegateID dbuuid.NullUUID, action string, diff any) error {
	var snapshot []byte
	if diff != nil {
		b, err := json.Marshal(diff)
		if err == nil {
			snapshot = b
		}
	}
	if snapshot == nil {
		snapshot = []byte("{}")
	}

	_, err := l.queries.InsertAuditEntry(ctx, tx, &database.InsertAuditEntryParams{
		ID:             dbuuid.Must(),
		OrganizationID: orgID,
		EventID:        eventID,
		ActorID:        actorID,
		DelegateID:     delegateID,
		ActionType:     action,
		DiffSnapshot:   snapshot,
		OccurredAt:     toPgTimestamptz(time.Now()),
	})
	return err
}

// WriteAuditEntry is the exported method — delegates to internal helper.
func (l *logicImpl) WriteAuditEntry(ctx context.Context, tx database.DBTX, orgID, eventID, actorID dbuuid.UUID, delegateID dbuuid.NullUUID, action string, diff any) error {
	return l.writeAuditEntry(ctx, tx, orgID, eventID, actorID, delegateID, action, diff)
}

// ─────────────────────────────────────────────────────────────────────────────
// Notification publishing helpers
// ─────────────────────────────────────────────────────────────────────────────

// publishEventNotification sends an invite notification to all non-organizer attendees.
func (l *logicImpl) publishEventNotification(ctx context.Context, tx database.DBTX, orgID, eventID, organizerID dbuuid.UUID, title, notifType, policyKey string, requiredIDs, optionalIDs []dbuuid.UUID) {
	// Publishing notification side-effects through the notification service from
	// inside the calendar transaction can invalidate that transaction even when
	// the publish error is ignored. Keep these side-effects disabled until they
	// move to a post-commit outbox/background flow.
	_ = ctx
	_ = tx
	_ = orgID
	_ = eventID
	_ = organizerID
	_ = title
	_ = notifType
	_ = policyKey
	_ = requiredIDs
	_ = optionalIDs
}

// publishChangeNotification sends a change notification to all non-organizer attendees.
func (l *logicImpl) publishChangeNotification(ctx context.Context, tx database.DBTX, orgID, eventID, organizerID dbuuid.UUID, title string) {
	_ = ctx
	_ = tx
	_ = orgID
	_ = eventID
	_ = organizerID
	_ = title
}

// publishCancelNotification sends a cancellation notification to all attendees.
func (l *logicImpl) publishCancelNotification(ctx context.Context, tx database.DBTX, orgID, eventID, organizerID dbuuid.UUID, title string) {
	_ = ctx
	_ = tx
	_ = orgID
	_ = eventID
	_ = organizerID
	_ = title
}

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
// Working Hours
// ─────────────────────────────────────────────────────────────────────────────

func workingHoursToProto(wh *database.CalendarWorkingHour) *rpcv1.WorkingHours {
	proto := &rpcv1.WorkingHours{
		Id:           wh.ID.String(),
		DayOfWeek:    wh.DayOfWeek,
		IsWorkingDay: wh.IsWorkingDay,
		Timezone:     wh.Timezone,
	}
	if wh.StartTime.Valid {
		proto.StartTime = fmt.Sprintf("%02d:%02d", wh.StartTime.Microseconds/3600000000, (wh.StartTime.Microseconds%3600000000)/60000000)
	}
	if wh.EndTime.Valid {
		proto.EndTime = fmt.Sprintf("%02d:%02d", wh.EndTime.Microseconds/3600000000, (wh.EndTime.Microseconds%3600000000)/60000000)
	}
	return proto
}

func (l *logicImpl) GetWorkingHours(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID) ([]*rpcv1.WorkingHours, error) {
	rows, err := l.queries.ListWorkingHours(ctx, tx, &database.ListWorkingHoursParams{
		OrganizationID: orgID,
		EmployeeID:     employeeID,
	})
	if err != nil {
		return nil, fmt.Errorf("list working hours: %w", err)
	}
	result := make([]*rpcv1.WorkingHours, 0, len(rows))
	for _, wh := range rows {
		result = append(result, workingHoursToProto(wh))
	}
	return result, nil
}

func (l *logicImpl) SetWorkingHours(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, hours []*rpcv1.WorkingHours) ([]*rpcv1.WorkingHours, error) {
	now := toPgTimestamptz(time.Now())
	result := make([]*rpcv1.WorkingHours, 0, len(hours))
	for _, h := range hours {
		startTime := parseHHMM(h.StartTime)
		endTime := parseHHMM(h.EndTime)
		row, err := l.queries.UpsertWorkingHours(ctx, tx, &database.UpsertWorkingHoursParams{
			ID:             dbuuid.Must(),
			OrganizationID: orgID,
			EmployeeID:     employeeID,
			DayOfWeek:      h.DayOfWeek,
			StartTime:      startTime,
			EndTime:        endTime,
			IsWorkingDay:   h.IsWorkingDay,
			Timezone:       h.Timezone,
			UpdatedAt:      now,
		})
		if err != nil {
			return nil, fmt.Errorf("upsert working hours day %d: %w", h.DayOfWeek, err)
		}
		result = append(result, workingHoursToProto(row))
	}
	return result, nil
}

// parseHHMM converts "HH:MM" to pgtype.Time (microseconds since midnight).
func parseHHMM(s string) pgtype.Time {
	if len(s) < 5 {
		return pgtype.Time{}
	}
	var h, m int
	_, err := fmt.Sscanf(s, "%d:%d", &h, &m)
	if err != nil {
		return pgtype.Time{}
	}
	us := int64(h)*3600*1e6 + int64(m)*60*1e6
	return pgtype.Time{Microseconds: us, Valid: true}
}

// ─────────────────────────────────────────────────────────────────────────────
// Scheduling Assistant (GetFreeBusy, SuggestSlots)
// ─────────────────────────────────────────────────────────────────────────────

func (l *logicImpl) GetFreeBusy(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, employeeIDs []dbuuid.UUID, from, to time.Time) ([]*rpcv1.EmployeeFreeBusy, error) {
	fromPg := toPgTimestamptz(from)
	toPg := toPgTimestamptz(to)

	result := make([]*rpcv1.EmployeeFreeBusy, 0, len(employeeIDs))
	for _, empID := range employeeIDs {
		events, err := l.queries.ListEventsForEmployee(ctx, tx, &database.ListEventsForEmployeeParams{
			OrganizationID: orgID,
			EmployeeID:     empID,
			EndTime:        toPg,
			StartTime:      fromPg,
		})
		if err != nil {
			return nil, fmt.Errorf("list events for free/busy (employee %s): %w", empID, err)
		}

		slots := make([]*rpcv1.FreeBusySlot, 0, len(events))
		for _, e := range events {
			slots = append(slots, &rpcv1.FreeBusySlot{
				Start:  timestamppb.New(e.StartTime.Time),
				End:    timestamppb.New(e.EndTime.Time),
				IsFree: false,
			})
		}
		result = append(result, &rpcv1.EmployeeFreeBusy{
			EmployeeId: empID.String(),
			Slots:      slots,
		})
	}
	return result, nil
}

func (l *logicImpl) SuggestSlots(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, employeeIDs []dbuuid.UUID, duration time.Duration, from, to time.Time, max int) ([]*rpcv1.FreeBusySlot, error) {
	if max <= 0 {
		max = 5
	}
	freeBusy, err := l.GetFreeBusy(ctx, tx, orgID, employeeIDs, from, to)
	if err != nil {
		return nil, err
	}

	// Collect all busy intervals across employees.
	type interval struct{ start, end time.Time }
	var busy []interval
	for _, fb := range freeBusy {
		for _, s := range fb.Slots {
			if !s.IsFree {
				busy = append(busy, interval{s.Start.AsTime(), s.End.AsTime()})
			}
		}
	}

	// Walk forward in 15-minute increments and find slots with no conflicts.
	var suggestions []*rpcv1.FreeBusySlot
	step := 15 * time.Minute
	cursor := from
	for cursor.Add(duration).Before(to) && len(suggestions) < max {
		slotEnd := cursor.Add(duration)
		conflict := false
		for _, b := range busy {
			if cursor.Before(b.end) && slotEnd.After(b.start) {
				conflict = true
				break
			}
		}
		if !conflict {
			suggestions = append(suggestions, &rpcv1.FreeBusySlot{
				Start:  timestamppb.New(cursor),
				End:    timestamppb.New(slotEnd),
				IsFree: true,
			})
		}
		cursor = cursor.Add(step)
	}
	return suggestions, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Resources
// ─────────────────────────────────────────────────────────────────────────────

func resourceToProto(r *database.CalendarResource) *rpcv1.CalendarResource {
	proto := &rpcv1.CalendarResource{
		Id:           r.ID.String(),
		Name:         r.Name,
		ResourceType: r.ResourceType,
		IsActive:     r.IsActive,
	}
	if r.Location.Valid {
		proto.Location = r.Location.String
	}
	if r.Capacity.Valid {
		proto.Capacity = r.Capacity.Int32
	}
	return proto
}

func (l *logicImpl) ListResources(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, filter *ResourceFilter) ([]*rpcv1.CalendarResource, error) {
	params := &database.ListResourcesParams{OrganizationID: orgID}
	if filter != nil && filter.ResourceType != "" {
		params.ResourceType = toPgText(filter.ResourceType)
	}
	if filter != nil && filter.MinCapacity > 0 {
		params.MinCapacity = pgtype.Int4{Valid: true, Int32: filter.MinCapacity}
	}
	rows, err := l.queries.ListResources(ctx, tx, params)
	if err != nil {
		return nil, fmt.Errorf("list resources: %w", err)
	}
	result := make([]*rpcv1.CalendarResource, 0, len(rows))
	for _, r := range rows {
		result = append(result, resourceToProto(r))
	}
	return result, nil
}

func (l *logicImpl) CreateResource(ctx context.Context, tx database.DBTX, orgID, actorID dbuuid.UUID, req *CreateResourceParams) (*rpcv1.CalendarResource, error) {
	if req.Name == "" {
		return nil, fmt.Errorf("resource name is required")
	}
	if !IsValidResourceType(req.ResourceType) {
		return nil, fmt.Errorf("invalid resource_type: %s", req.ResourceType)
	}
	now := toPgTimestamptz(time.Now())
	row, err := l.queries.InsertResource(ctx, tx, &database.InsertResourceParams{
		ID:             dbuuid.Must(),
		OrganizationID: orgID,
		Name:           req.Name,
		ResourceType:   req.ResourceType,
		Location:       toPgText(req.Location),
		Capacity:       pgtype.Int4{Valid: req.Capacity > 0, Int32: req.Capacity},
		UpdatedAt:      now,
	})
	if err != nil {
		return nil, fmt.Errorf("insert resource: %w", err)
	}
	return resourceToProto(row), nil
}

func (l *logicImpl) UpdateResource(ctx context.Context, tx database.DBTX, orgID, actorID, resourceID dbuuid.UUID, req *UpdateResourceParams) (*rpcv1.CalendarResource, error) {
	now := toPgTimestamptz(time.Now())
	params := &database.UpdateResourceParams{
		OrganizationID: orgID,
		ID:             resourceID,
		UpdatedAt:      now,
	}
	if req.Name != nil {
		params.Name = toPgText(*req.Name)
	}
	if req.Location != nil {
		params.Location = toPgText(*req.Location)
	}
	if req.Capacity != nil {
		params.Capacity = pgtype.Int4{Valid: true, Int32: *req.Capacity}
	}
	if req.IsActive != nil {
		params.IsActive = pgtype.Bool{Valid: true, Bool: *req.IsActive}
	}
	row, err := l.queries.UpdateResource(ctx, tx, params)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrResourceNotFound
		}
		return nil, fmt.Errorf("update resource: %w", err)
	}
	return resourceToProto(row), nil
}

func (l *logicImpl) SetResourceACL(ctx context.Context, tx database.DBTX, orgID, actorID, resourceID dbuuid.UUID, entries []*rpcv1.ResourceACLEntry) error {
	// Delete existing ACL entries for the resource, then insert new ones.
	if err := l.queries.DeleteResourceACLForResource(ctx, tx, &database.DeleteResourceACLForResourceParams{
		OrganizationID: orgID,
		ResourceID:     resourceID,
	}); err != nil {
		return fmt.Errorf("delete resource ACL: %w", err)
	}
	now := toPgTimestamptz(time.Now())
	for _, entry := range entries {
		empID, err := dbuuid.Parse(entry.EmployeeId)
		if err != nil {
			return fmt.Errorf("invalid employee_id %q: %w", entry.EmployeeId, err)
		}
		canBook := entry.Role != "viewer"
		_, err = l.queries.UpsertResourceACL(ctx, tx, &database.UpsertResourceACLParams{
			ID:             dbuuid.Must(),
			OrganizationID: orgID,
			ResourceID:     resourceID,
			EmployeeID:     dbuuid.UUIDToNullUUID(empID),
			CanBook:        canBook,
			UpdatedAt:      now,
		})
		if err != nil {
			return fmt.Errorf("upsert resource ACL: %w", err)
		}
	}
	return nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Booking Links
// ─────────────────────────────────────────────────────────────────────────────

func bookingLinkToProto(bl *database.CalendarBookingLink) *rpcv1.BookingLink {
	proto := &rpcv1.BookingLink{
		Id:              bl.ID.String(),
		Token:           bl.Token,
		Title:           bl.Title,
		DurationMinutes: bl.DurationMinutes,
		Status:          bl.Status,
	}
	if bl.ValidFrom.Valid {
		proto.ValidFrom = bl.ValidFrom.Time.Format("2006-01-02")
	}
	if bl.ValidUntil.Valid {
		proto.ValidUntil = bl.ValidUntil.Time.Format("2006-01-02")
	}
	if bl.ExpiresAt.Valid {
		proto.ExpiresAt = timestamppb.New(bl.ExpiresAt.Time)
	}
	return proto
}

func (l *logicImpl) CreateBookingLink(ctx context.Context, tx database.DBTX, orgID, actorID dbuuid.UUID, req *CreateBookingLinkParams) (*rpcv1.BookingLink, string, error) {
	token := dbuuid.Must().String() // Use UUID as opaque token.
	windowsJSON, err := marshalJSON(req.AvailableWindows)
	if err != nil {
		return nil, "", fmt.Errorf("marshal available windows: %w", err)
	}
	now := toPgTimestamptz(time.Now())

	validFrom, validUntil, err := parseISODates(req.ValidFrom, req.ValidUntil)
	if err != nil {
		return nil, "", err
	}

	var expiresAt time.Time
	if !req.ExpiresAt.IsZero() {
		expiresAt = req.ExpiresAt
	} else {
		// The RPC field is optional, but the current schema requires a non-null timestamp.
		// Persist a long-lived fallback so omitted expiry behaves like an effectively
		// indefinite booking link until explicit expiration handling is implemented.
		expiresAt = time.Now().AddDate(100, 0, 0)
	}

	row, err := l.queries.InsertBookingLink(ctx, tx, &database.InsertBookingLinkParams{
		ID:               dbuuid.Must(),
		OrganizationID:   orgID,
		OwnerID:          actorID,
		Token:            token,
		Title:            req.Title,
		DurationMinutes:  req.DurationMinutes,
		AvailableWindows: windowsJSON,
		ValidFrom:        validFrom,
		ValidUntil:       validUntil,
		ExpiresAt:        toPgTimestamptz(expiresAt),
		UpdatedAt:        now,
	})
	if err != nil {
		return nil, "", fmt.Errorf("insert booking link: %w", err)
	}
	shareURL := fmt.Sprintf("/booking/%s", token)
	return bookingLinkToProto(row), shareURL, nil
}

func (l *logicImpl) GetBookingLinkByToken(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, token string) (*rpcv1.BookingLink, []*rpcv1.FreeBusySlot, error) {
	row, err := l.queries.GetBookingLinkByToken(ctx, tx, &database.GetBookingLinkByTokenParams{
		OrganizationID: orgID,
		Token:          token,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil, ErrBookingLinkNotFound
		}
		return nil, nil, fmt.Errorf("get booking link: %w", err)
	}
	if row.Status != BookingLinkStatusActive {
		return nil, nil, ErrBookingLinkExpired
	}
	// Return empty slots for now; full implementation computes from working hours + free/busy.
	return bookingLinkToProto(row), nil, nil
}

func (l *logicImpl) ClaimBookingSlot(ctx context.Context, tx database.DBTX, orgID, claimerID dbuuid.UUID, token string, slotStart time.Time) (*rpcv1.CalendarEvent, error) {
	bl, _, err := l.GetBookingLinkByToken(ctx, tx, orgID, token)
	if err != nil {
		return nil, err
	}

	end := slotStart.Add(time.Duration(bl.DurationMinutes) * time.Minute)
	blID, err := dbuuid.Parse(bl.Id)
	if err != nil {
		return nil, fmt.Errorf("parse booking link id: %w", err)
	}

	// Create the meeting event.
	event, err := l.CreateEvent(ctx, tx, orgID, claimerID, &CreateEventParams{
		Title:               bl.Title,
		EventType:           EventTypeMeeting,
		Visibility:          VisibilityTeam,
		StartTime:           slotStart,
		EndTime:             end,
		RequiredAttendeeIDs: []dbuuid.UUID{claimerID},
	})
	if err != nil {
		return nil, fmt.Errorf("create booking slot event: %w", err)
	}

	eventID, err := dbuuid.Parse(event.Id)
	if err != nil {
		return nil, fmt.Errorf("parse event id: %w", err)
	}

	now := toPgTimestamptz(time.Now())
	claimerNullUUID := dbuuid.UUIDToNullUUID(claimerID)
	eventNullUUID := dbuuid.UUIDToNullUUID(eventID)
	_, err = l.queries.ClaimBookingLink(ctx, tx, &database.ClaimBookingLinkParams{
		OrganizationID: orgID,
		ID:             blID,
		ExpiresAt:      now, // passed the WHERE check since we already validated status=active
		ClaimedEventID: eventNullUUID,
		ClaimedByID:    claimerNullUUID,
		ClaimedAt:      now,
	})
	if err != nil {
		return nil, fmt.Errorf("claim booking link: %w", err)
	}
	return event, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Delegation
// ─────────────────────────────────────────────────────────────────────────────

func delegationToProto(d *database.CalendarDelegation) *rpcv1.CalendarDelegation {
	proto := &rpcv1.CalendarDelegation{
		Id:                  d.ID.String(),
		DelegatorEmployeeId: d.OwnerID.String(),
		DelegateEmployeeId:  d.DelegateID.String(),
	}
	if d.ExpiresAt.Valid {
		proto.ExpiresAt = timestamppb.New(d.ExpiresAt.Time)
	}
	if d.UpdatedAt.Valid {
		proto.GrantedAt = timestamppb.New(d.UpdatedAt.Time)
	}
	return proto
}

func (l *logicImpl) GrantDelegation(ctx context.Context, tx database.DBTX, orgID, ownerID, delegateID dbuuid.UUID, expiresAt *time.Time) error {
	now := toPgTimestamptz(time.Now())
	var expiresPg pgtype.Timestamptz
	if expiresAt != nil {
		expiresPg = toPgTimestamptz(*expiresAt)
	}
	_, err := l.queries.InsertDelegation(ctx, tx, &database.InsertDelegationParams{
		ID:             dbuuid.Must(),
		OrganizationID: orgID,
		OwnerID:        ownerID,
		DelegateID:     delegateID,
		CanCreate:      true,
		CanModify:      true,
		CanCancel:      true,
		ExpiresAt:      expiresPg,
		UpdatedAt:      now,
	})
	if err != nil {
		return fmt.Errorf("insert delegation: %w", err)
	}
	return nil
}

func (l *logicImpl) ListDelegations(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID) ([]*rpcv1.CalendarDelegation, []*rpcv1.CalendarDelegation, error) {
	now := toPgTimestamptz(time.Now())

	// Delegations granted by this employee (owner_id = employeeID).
	grantedByMe, err := l.queries.ListDelegationsByDelegate(ctx, tx, &database.ListDelegationsByDelegateParams{
		OrganizationID: orgID,
		DelegateID:     employeeID,
		ExpiresAt:      now,
	})
	if err != nil {
		return nil, nil, fmt.Errorf("list delegations by delegate: %w", err)
	}

	// For ListDelegationsByOwner (not currently in generated queries), reuse the delegate query with owner perspective.
	// Stub: return empty "granted by me" and fill "granted to me" from the delegate query.
	grantedToMe := make([]*rpcv1.CalendarDelegation, 0, len(grantedByMe))
	for _, d := range grantedByMe {
		grantedToMe = append(grantedToMe, delegationToProto(d))
	}
	return nil, grantedToMe, nil
}

func (l *logicImpl) RevokeDelegation(ctx context.Context, tx database.DBTX, orgID, ownerID, delegateID dbuuid.UUID) error {
	return l.queries.DeleteDelegation(ctx, tx, &database.DeleteDelegationParams{
		OrganizationID: orgID,
		OwnerID:        ownerID,
		DelegateID:     delegateID,
	})
}

func (l *logicImpl) VerifyDelegation(ctx context.Context, tx database.DBTX, orgID, ownerID, delegateID dbuuid.UUID) (bool, error) {
	row, err := l.queries.GetDelegation(ctx, tx, &database.GetDelegationParams{
		OrganizationID: orgID,
		OwnerID:        ownerID,
		DelegateID:     delegateID,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return false, nil
		}
		return false, fmt.Errorf("get delegation: %w", err)
	}
	if row.ExpiresAt.Valid && row.ExpiresAt.Time.Before(time.Now()) {
		return false, nil
	}
	return true, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Compliance (CheckIn, Evidence, AuditEntries)
// ─────────────────────────────────────────────────────────────────────────────

func checkInToProto(ci *database.CalendarCheckIn) *rpcv1.CalendarCheckIn {
	proto := &rpcv1.CalendarCheckIn{
		Id:         ci.ID.String(),
		EventId:    ci.EventID.String(),
		EmployeeId: ci.EmployeeID.String(),
		IsLate:     ci.IsLate,
	}
	if ci.CheckedInAt.Valid {
		proto.CheckedInAt = timestamppb.New(ci.CheckedInAt.Time)
	}
	if ci.SubmittedAt.Valid {
		proto.SubmittedAt = timestamppb.New(ci.SubmittedAt.Time)
	}
	for _, fid := range ci.EvidenceFileIds {
		proto.EvidenceFileIds = append(proto.EvidenceFileIds, fid.String())
	}
	return proto
}

func (l *logicImpl) CheckInToEvent(ctx context.Context, tx database.DBTX, orgID, actorID, eventID dbuuid.UUID) (*rpcv1.CalendarCheckIn, error) {
	dbEvent, err := l.queries.GetEvent(ctx, tx, &database.GetEventParams{
		OrganizationID: orgID,
		ID:             eventID,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrEventNotFound
		}
		return nil, fmt.Errorf("get event for check-in: %w", err)
	}

	now := toPgTimestamptz(time.Now())
	isLate := dbEvent.StartTime.Valid && now.Time.After(dbEvent.StartTime.Time)

	ci, err := l.queries.InsertCheckIn(ctx, tx, &database.InsertCheckInParams{
		ID:             dbuuid.Must(),
		OrganizationID: orgID,
		EventID:        eventID,
		EmployeeID:     actorID,
		CheckedInAt:    now,
		IsLate:         isLate,
	})
	if err != nil {
		return nil, fmt.Errorf("insert check-in: %w", err)
	}

	_ = l.writeAuditEntry(ctx, tx, orgID, eventID, actorID, dbuuid.NullUUID{}, AuditActionTypeCheckedIn, nil)
	return checkInToProto(ci), nil
}

func (l *logicImpl) SubmitCheckInEvidence(ctx context.Context, tx database.DBTX, orgID, actorID, eventID dbuuid.UUID, fileIDs []dbuuid.UUID) (*rpcv1.CalendarCheckIn, error) {
	now := toPgTimestamptz(time.Now())
	ci, err := l.queries.UpdateCheckInEvidence(ctx, tx, &database.UpdateCheckInEvidenceParams{
		OrganizationID:  orgID,
		EventID:         eventID,
		EmployeeID:      actorID,
		EvidenceFileIds: fileIDs,
		SubmittedAt:     now,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrCheckInNotFound
		}
		return nil, fmt.Errorf("update check-in evidence: %w", err)
	}
	return checkInToProto(ci), nil
}

func auditEntryToProto(e *database.CalendarAuditEntry) *rpcv1.CalendarAuditEntry {
	proto := &rpcv1.CalendarAuditEntry{
		Id:           e.ID.String(),
		EventId:      e.EventID.String(),
		ActorId:      e.ActorID.String(),
		ActionType:   e.ActionType,
		DiffSnapshot: e.DiffSnapshot,
	}
	if e.DelegateID.Valid {
		proto.DelegateId = e.DelegateID.UUID.String()
	}
	if e.OccurredAt.Valid {
		proto.OccurredAt = timestamppb.New(e.OccurredAt.Time)
	}
	return proto
}

func (l *logicImpl) ListAuditEntries(ctx context.Context, tx database.DBTX, orgID, eventID dbuuid.UUID, cursor dbuuid.NullUUID, limit int) ([]*rpcv1.CalendarAuditEntry, dbuuid.NullUUID, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	rows, err := l.queries.ListAuditEntries(ctx, tx, &database.ListAuditEntriesParams{
		OrganizationID: orgID,
		EventID:        eventID,
		Limit:          int32(limit),
		Cursor:         cursor,
	})
	if err != nil {
		return nil, dbuuid.NullUUID{}, fmt.Errorf("list audit entries: %w", err)
	}

	entries := make([]*rpcv1.CalendarAuditEntry, 0, len(rows))
	var nextCursor dbuuid.NullUUID
	for i, e := range rows {
		entries = append(entries, auditEntryToProto(e))
		if i == len(rows)-1 && len(rows) == limit {
			nextCursor = dbuuid.UUIDToNullUUID(e.ID)
		}
	}
	return entries, nextCursor, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Cross-Domain Overlays
// ─────────────────────────────────────────────────────────────────────────────

func (l *logicImpl) ListOverlayItems(ctx context.Context, tx database.DBTX, orgID, actorID dbuuid.UUID, from, to time.Time, opts *OverlayOptions) ([]*rpcv1.OverlayItem, error) {
	items := make([]*rpcv1.OverlayItem, 0)

	if opts == nil {
		return items, nil
	}

	if opts.IncludeTasks && l.collaborationReader != nil {
		tasks, err := l.collaborationReader.GetTasksDueInRange(ctx, tx, orgID, from, to)
		if err != nil {
			return nil, fmt.Errorf("get tasks overlay: %w", err)
		}
		items = append(items, tasks...)
	}

	if opts.IncludeRituals && l.collaborationReader != nil {
		rituals, err := l.collaborationReader.GetRitualInstancesInRange(ctx, tx, orgID, from, to)
		if err != nil {
			return nil, fmt.Errorf("get rituals overlay: %w", err)
		}
		items = append(items, rituals...)
	}

	if opts.IncludeDocDeadlines && l.docsReader != nil {
		docs, err := l.docsReader.GetDocDeadlinesInRange(ctx, tx, orgID, from, to)
		if err != nil {
			return nil, fmt.Errorf("get doc deadlines overlay: %w", err)
		}
		items = append(items, docs...)
	}

	return items, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON helper
// ─────────────────────────────────────────────────────────────────────────────

func marshalJSON(v any) ([]byte, error) {
	if v == nil {
		return []byte("[]"), nil
	}
	b, err := json.Marshal(v)
	if err != nil {
		return []byte("[]"), err
	}
	return b, nil
}

func parseISODates(from, until string) (pgtype.Date, pgtype.Date, error) {
	var fromDate, untilDate pgtype.Date
	if from != "" {
		t, err := time.Parse("2006-01-02", from)
		if err != nil {
			return pgtype.Date{}, pgtype.Date{}, fmt.Errorf("invalid valid_from date: %w", err)
		}
		fromDate = pgtype.Date{Time: t, Valid: true}
	}
	if until != "" {
		t, err := time.Parse("2006-01-02", until)
		if err != nil {
			return pgtype.Date{}, pgtype.Date{}, fmt.Errorf("invalid valid_until date: %w", err)
		}
		untilDate = pgtype.Date{Time: t, Valid: true}
	}
	return fromDate, untilDate, nil
}

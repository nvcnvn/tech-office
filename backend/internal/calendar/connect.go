package calendar

import (
	"context"
	"errors"
	"fmt"
	"time"

	"connectrpc.com/connect"
	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/database/txn"
	"github.com/nvcnvn/tech-office/backend/internal/interceptor"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/nvcnvn/tech-office/backend/rpc/v1/rpcv1connect"
)

// ============================================================================
// Calendar Service Connect Layer
// ============================================================================

// CalendarServiceServer is the RPC handler layer for calendar operations.
// It owns TenantPool, manages transactions, extracts auth context,
// and delegates to the Logic layer.
type CalendarServiceServer struct {
	rpcv1connect.UnimplementedCalendarServiceHandler

	Logic      Logic
	TenantPool database.TenantDatabaseConnector
}

// NewCalendarServiceServer creates a new calendar service server.
func NewCalendarServiceServer(logic Logic, tenantPool database.TenantDatabaseConnector) *CalendarServiceServer {
	return &CalendarServiceServer{
		Logic:      logic,
		TenantPool: tenantPool,
	}
}

// extractCalendarAuthContext extracts employee ID and organization ID from context.
func extractCalendarAuthContext(ctx context.Context) (employeeID, organizationID dbuuid.UUID, err error) {
	userID, ok := interceptor.UserIDFromContext(ctx)
	if !ok || userID == "" {
		return dbuuid.UUID{}, dbuuid.UUID{}, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("user ID not found in context"))
	}
	orgIDStr, ok := interceptor.UserOrgIDFromContext(ctx)
	if !ok || orgIDStr == "" {
		return dbuuid.UUID{}, dbuuid.UUID{}, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("organization ID not found in context"))
	}
	employeeID = dbuuid.MustParse(userID)
	organizationID = dbuuid.MustParse(orgIDStr)
	return employeeID, organizationID, nil
}

// handleCalendarError converts logic errors to Connect errors.
func handleCalendarError(err error) error {
	var connectErr *connect.Error
	if errors.As(err, &connectErr) {
		return connectErr
	}
	switch {
	case errors.Is(err, ErrEventNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, ErrAttendeeNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, ErrResourceNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, ErrBookingLinkNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, ErrDelegationNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, ErrCheckInNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, ErrAccessDenied):
		return connect.NewError(connect.CodePermissionDenied, err)
	case errors.Is(err, ErrResourceConflict):
		return connect.NewError(connect.CodeAlreadyExists, err)
	case errors.Is(err, ErrBookingLinkExpired):
		return connect.NewError(connect.CodeFailedPrecondition, err)
	case errors.Is(err, ErrDelegationExpired):
		return connect.NewError(connect.CodeFailedPrecondition, err)
	default:
		return connect.NewError(connect.CodeInternal, err)
	}
}

// rsvpToString converts the RSVPResponse proto enum to the DB string constant.
func rsvpToString(r rpcv1.RSVPResponse) string {
	switch r {
	case rpcv1.RSVPResponse_RSVP_RESPONSE_ACCEPTED:
		return RSVPStatusAccepted
	case rpcv1.RSVPResponse_RSVP_RESPONSE_DECLINED:
		return RSVPStatusDeclined
	case rpcv1.RSVPResponse_RSVP_RESPONSE_TENTATIVE:
		return RSVPStatusTentative
	default:
		return RSVPStatusPending
	}
}

// editScopeToString converts the EventEditScope proto enum to the DB string constant.
func editScopeToString(scope rpcv1.EventEditScope) string {
	switch scope {
	case rpcv1.EventEditScope_EVENT_EDIT_SCOPE_THIS_INSTANCE:
		return ChangeScopeThisInstance
	case rpcv1.EventEditScope_EVENT_EDIT_SCOPE_THIS_AND_FOLLOWING:
		return ChangeScopeThisAndFollowing
	case rpcv1.EventEditScope_EVENT_EDIT_SCOPE_ALL:
		return ChangeScopeAll
	default:
		return ChangeScopeAll
	}
}

// parseAttendeeIDs converts a slice of string UUIDs to []dbuuid.UUID.
// Invalid/empty IDs are silently skipped.
func parseAttendeeIDs(ids []string) []dbuuid.UUID {
	result := make([]dbuuid.UUID, 0, len(ids))
	for _, s := range ids {
		if s == "" {
			continue
		}
		id, err := dbuuid.Parse(s)
		if err == nil {
			result = append(result, id)
		}
	}
	return result
}

// ============================================================================
// Event RPC Handlers
// ============================================================================

func (s *CalendarServiceServer) CreateEvent(
	ctx context.Context,
	req *connect.Request[rpcv1.CreateEventRequest],
) (*connect.Response[rpcv1.CreateEventResponse], error) {
	empID, orgID, err := extractCalendarAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	msg := req.Msg
	params := &CreateEventParams{
		Title:               msg.GetTitle(),
		Description:         msg.GetDescription(),
		EventType:           msg.GetEventType(),
		Visibility:          msg.GetVisibility(),
		AllDay:              msg.GetAllDay(),
		LocationText:        msg.GetLocationText(),
		VirtualLink:         msg.GetVirtualLink(),
		RecurrenceRule:      msg.GetRecurrenceRule(),
		RequiresCheckIn:     msg.GetRequiresCheckIn(),
		RequiresEvidence:    msg.GetRequiresEvidence(),
		RequiredAttendeeIDs: parseAttendeeIDs(msg.GetRequiredAttendeeIds()),
		OptionalAttendeeIDs: parseAttendeeIDs(msg.GetOptionalAttendeeIds()),
		ResourceIDs:         parseAttendeeIDs(msg.GetResourceIds()),
	}
	if msg.GetStartTime() != nil {
		params.StartTime = msg.GetStartTime().AsTime()
	}
	if msg.GetEndTime() != nil {
		params.EndTime = msg.GetEndTime().AsTime()
	}
	if oid := msg.GetOrganizerOverrideId(); oid != "" {
		id, parseErr := dbuuid.Parse(oid)
		if parseErr == nil {
			params.OrganizerOverrideID = dbuuid.UUIDToNullUUID(id)
		}
	}

	var event *rpcv1.CalendarEvent
	if err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var logicErr error
		event, logicErr = s.Logic.CreateEvent(ctx, tx, orgID, empID, params)
		return logicErr
	}); err != nil {
		return nil, handleCalendarError(err)
	}
	return connect.NewResponse(&rpcv1.CreateEventResponse{Event: event}), nil
}

func (s *CalendarServiceServer) GetEvent(
	ctx context.Context,
	req *connect.Request[rpcv1.GetEventRequest],
) (*connect.Response[rpcv1.GetEventResponse], error) {
	empID, orgID, err := extractCalendarAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	eventID, err := dbuuid.Parse(req.Msg.GetEventId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid event_id: %w", err))
	}

	var event *rpcv1.CalendarEvent
	if err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var logicErr error
		event, logicErr = s.Logic.GetEvent(ctx, tx, orgID, empID, eventID)
		return logicErr
	}); err != nil {
		return nil, handleCalendarError(err)
	}
	return connect.NewResponse(&rpcv1.GetEventResponse{Event: event}), nil
}

func (s *CalendarServiceServer) ListEvents(
	ctx context.Context,
	req *connect.Request[rpcv1.ListEventsRequest],
) (*connect.Response[rpcv1.ListEventsResponse], error) {
	empID, orgID, err := extractCalendarAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	msg := req.Msg
	from := time.Now().Add(-30 * 24 * time.Hour) // default: last 30 days
	to := time.Now().Add(90 * 24 * time.Hour)    // default: next 90 days
	if msg.GetStart() != nil {
		from = msg.GetStart().AsTime()
	}
	if msg.GetEnd() != nil {
		to = msg.GetEnd().AsTime()
	}

	var targetEmpID dbuuid.NullUUID
	if tid := msg.GetTargetEmployeeId(); tid != "" {
		id, parseErr := dbuuid.Parse(tid)
		if parseErr == nil {
			targetEmpID = dbuuid.UUIDToNullUUID(id)
		}
	}

	var events []*rpcv1.CalendarEvent
	if err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var logicErr error
		events, logicErr = s.Logic.ListEvents(ctx, tx, orgID, empID, from, to, targetEmpID)
		return logicErr
	}); err != nil {
		return nil, handleCalendarError(err)
	}
	return connect.NewResponse(&rpcv1.ListEventsResponse{Events: events}), nil
}

func (s *CalendarServiceServer) UpdateEvent(
	ctx context.Context,
	req *connect.Request[rpcv1.UpdateEventRequest],
) (*connect.Response[rpcv1.UpdateEventResponse], error) {
	empID, orgID, err := extractCalendarAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	msg := req.Msg
	eventID, err := dbuuid.Parse(msg.GetEventId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid event_id: %w", err))
	}

	params := &UpdateEventParams{
		Title:               msg.GetTitle(),
		Description:         msg.GetDescription(),
		EventType:           msg.GetEventType(),
		Visibility:          msg.GetVisibility(),
		RequiredAttendeeIDs: parseAttendeeIDs(msg.GetRequiredAttendeeIds()),
		OptionalAttendeeIDs: parseAttendeeIDs(msg.GetOptionalAttendeeIds()),
	}
	if msg.GetStartTime() != nil {
		t := msg.GetStartTime().AsTime()
		params.StartTime = &t
	}
	if msg.GetEndTime() != nil {
		t := msg.GetEndTime().AsTime()
		params.EndTime = &t
	}
	if loc := msg.GetLocationText(); loc != "" {
		params.LocationText = &loc
	}
	if vl := msg.GetVirtualLink(); vl != "" {
		params.VirtualLink = &vl
	}

	var event *rpcv1.CalendarEvent
	if err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var logicErr error
		event, logicErr = s.Logic.UpdateEvent(ctx, tx, orgID, empID, eventID, params)
		return logicErr
	}); err != nil {
		return nil, handleCalendarError(err)
	}
	return connect.NewResponse(&rpcv1.UpdateEventResponse{Event: event}), nil
}

func (s *CalendarServiceServer) CancelEvent(
	ctx context.Context,
	req *connect.Request[rpcv1.CancelEventRequest],
) (*connect.Response[rpcv1.CancelEventResponse], error) {
	empID, orgID, err := extractCalendarAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	eventID, err := dbuuid.Parse(req.Msg.GetEventId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid event_id: %w", err))
	}

	if err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		return s.Logic.CancelEvent(ctx, tx, orgID, empID, eventID)
	}); err != nil {
		return nil, handleCalendarError(err)
	}
	return connect.NewResponse(&rpcv1.CancelEventResponse{Success: true}), nil
}

func (s *CalendarServiceServer) EditEventSeries(
	ctx context.Context,
	req *connect.Request[rpcv1.EditEventSeriesRequest],
) (*connect.Response[rpcv1.EditEventSeriesResponse], error) {
	empID, orgID, err := extractCalendarAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	msg := req.Msg
	eventID, err := dbuuid.Parse(msg.GetEventId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid event_id: %w", err))
	}

	params := &EditSeriesParams{
		Title:               msg.GetTitle(),
		Description:         msg.GetDescription(),
		SkipInstance:        msg.GetSkipInstance(),
		ChangeScope:         editScopeToString(msg.GetChangeScope()),
		RequiredAttendeeIDs: parseAttendeeIDs(msg.GetRequiredAttendeeIds()),
		OptionalAttendeeIDs: parseAttendeeIDs(msg.GetOptionalAttendeeIds()),
	}
	if msg.GetInstanceStartTime() != nil {
		params.InstanceStartTime = msg.GetInstanceStartTime().AsTime()
	}
	if msg.GetStartTime() != nil {
		t := msg.GetStartTime().AsTime()
		params.StartTime = &t
	}
	if msg.GetEndTime() != nil {
		t := msg.GetEndTime().AsTime()
		params.EndTime = &t
	}
	if loc := msg.GetLocationText(); loc != "" {
		params.LocationText = &loc
	}
	if vl := msg.GetVirtualLink(); vl != "" {
		params.VirtualLink = &vl
	}

	var event *rpcv1.CalendarEvent
	if err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var logicErr error
		event, logicErr = s.Logic.EditEventSeries(ctx, tx, orgID, empID, eventID, params)
		return logicErr
	}); err != nil {
		return nil, handleCalendarError(err)
	}
	return connect.NewResponse(&rpcv1.EditEventSeriesResponse{Event: event}), nil
}

// ============================================================================
// RSVP RPC Handlers
// ============================================================================

func (s *CalendarServiceServer) RespondToInvite(
	ctx context.Context,
	req *connect.Request[rpcv1.RespondToInviteRequest],
) (*connect.Response[rpcv1.RespondToInviteResponse], error) {
	empID, orgID, err := extractCalendarAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	msg := req.Msg
	eventID, err := dbuuid.Parse(msg.GetEventId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid event_id: %w", err))
	}
	rsvp := rsvpToString(msg.GetRsvpStatus())

	var attendee *rpcv1.EventAttendee
	if err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var logicErr error
		attendee, logicErr = s.Logic.RespondToInvite(ctx, tx, orgID, empID, eventID, rsvp, msg.GetResponseNote())
		return logicErr
	}); err != nil {
		return nil, handleCalendarError(err)
	}
	return connect.NewResponse(&rpcv1.RespondToInviteResponse{Attendee: attendee}), nil
}

func (s *CalendarServiceServer) ListEventAttendees(
	ctx context.Context,
	req *connect.Request[rpcv1.ListEventAttendeesRequest],
) (*connect.Response[rpcv1.ListEventAttendeesResponse], error) {
	empID, orgID, err := extractCalendarAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	eventID, err := dbuuid.Parse(req.Msg.GetEventId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid event_id: %w", err))
	}

	var attendees []*rpcv1.EventAttendee
	if err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var logicErr error
		attendees, logicErr = s.Logic.ListEventAttendees(ctx, tx, orgID, empID, eventID)
		return logicErr
	}); err != nil {
		return nil, handleCalendarError(err)
	}
	return connect.NewResponse(&rpcv1.ListEventAttendeesResponse{Attendees: attendees}), nil
}

// ============================================================================
// Working Hours RPC Handlers
// ============================================================================

func (s *CalendarServiceServer) GetWorkingHours(
	ctx context.Context,
	req *connect.Request[rpcv1.GetWorkingHoursRequest],
) (*connect.Response[rpcv1.GetWorkingHoursResponse], error) {
	empID, orgID, err := extractCalendarAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var hours []*rpcv1.WorkingHours
	if err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var logicErr error
		hours, logicErr = s.Logic.GetWorkingHours(ctx, tx, orgID, empID)
		return logicErr
	}); err != nil {
		return nil, handleCalendarError(err)
	}
	return connect.NewResponse(&rpcv1.GetWorkingHoursResponse{WorkingHours: hours}), nil
}

func (s *CalendarServiceServer) SetWorkingHours(
	ctx context.Context,
	req *connect.Request[rpcv1.SetWorkingHoursRequest],
) (*connect.Response[rpcv1.SetWorkingHoursResponse], error) {
	empID, orgID, err := extractCalendarAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var hours []*rpcv1.WorkingHours
	if err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var logicErr error
		hours, logicErr = s.Logic.SetWorkingHours(ctx, tx, orgID, empID, req.Msg.GetWorkingHours())
		return logicErr
	}); err != nil {
		return nil, handleCalendarError(err)
	}
	return connect.NewResponse(&rpcv1.SetWorkingHoursResponse{WorkingHours: hours}), nil
}

// ============================================================================
// Scheduling Assistant RPC Handlers
// ============================================================================

func (s *CalendarServiceServer) GetFreeBusy(
	ctx context.Context,
	req *connect.Request[rpcv1.GetFreeBusyRequest],
) (*connect.Response[rpcv1.GetFreeBusyResponse], error) {
	_, orgID, err := extractCalendarAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	msg := req.Msg
	empIDs := parseAttendeeIDs(msg.GetEmployeeIds())
	var from, to time.Time
	if msg.GetStart() != nil {
		from = msg.GetStart().AsTime()
	}
	if msg.GetEnd() != nil {
		to = msg.GetEnd().AsTime()
	}

	var freeBusy []*rpcv1.EmployeeFreeBusy
	if err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var logicErr error
		freeBusy, logicErr = s.Logic.GetFreeBusy(ctx, tx, orgID, empIDs, from, to)
		return logicErr
	}); err != nil {
		return nil, handleCalendarError(err)
	}
	return connect.NewResponse(&rpcv1.GetFreeBusyResponse{FreeBusy: freeBusy}), nil
}

func (s *CalendarServiceServer) SuggestSlots(
	ctx context.Context,
	req *connect.Request[rpcv1.SuggestSlotsRequest],
) (*connect.Response[rpcv1.SuggestSlotsResponse], error) {
	_, orgID, err := extractCalendarAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	msg := req.Msg
	empIDs := parseAttendeeIDs(msg.GetEmployeeIds())
	duration := time.Duration(msg.GetDurationMinutes()) * time.Minute
	var from, to time.Time
	if msg.GetSearchFrom() != nil {
		from = msg.GetSearchFrom().AsTime()
	}
	if msg.GetSearchUntil() != nil {
		to = msg.GetSearchUntil().AsTime()
	}
	maxSuggestions := int(msg.GetMaxSuggestions())

	var slots []*rpcv1.FreeBusySlot
	if err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var logicErr error
		slots, logicErr = s.Logic.SuggestSlots(ctx, tx, orgID, empIDs, duration, from, to, maxSuggestions)
		return logicErr
	}); err != nil {
		return nil, handleCalendarError(err)
	}
	return connect.NewResponse(&rpcv1.SuggestSlotsResponse{SuggestedSlots: slots}), nil
}

// ============================================================================
// Resource RPC Handlers
// ============================================================================

func (s *CalendarServiceServer) ListResources(
	ctx context.Context,
	req *connect.Request[rpcv1.ListResourcesRequest],
) (*connect.Response[rpcv1.ListResourcesResponse], error) {
	_, orgID, err := extractCalendarAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	msg := req.Msg
	filter := &ResourceFilter{
		ResourceType: msg.GetResourceType(),
		MinCapacity:  msg.GetMinCapacity(),
	}
	if msg.GetCheckFrom() != nil {
		t := msg.GetCheckFrom().AsTime()
		filter.CheckFrom = &t
	}
	if msg.GetCheckUntil() != nil {
		t := msg.GetCheckUntil().AsTime()
		filter.CheckUntil = &t
	}

	var resources []*rpcv1.CalendarResource
	if err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var logicErr error
		resources, logicErr = s.Logic.ListResources(ctx, tx, orgID, filter)
		return logicErr
	}); err != nil {
		return nil, handleCalendarError(err)
	}
	return connect.NewResponse(&rpcv1.ListResourcesResponse{Resources: resources}), nil
}

func (s *CalendarServiceServer) CreateResource(
	ctx context.Context,
	req *connect.Request[rpcv1.CreateResourceRequest],
) (*connect.Response[rpcv1.CreateResourceResponse], error) {
	empID, orgID, err := extractCalendarAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	msg := req.Msg
	params := &CreateResourceParams{
		Name:         msg.GetName(),
		ResourceType: msg.GetResourceType(),
		Location:     msg.GetLocation(),
		Capacity:     msg.GetCapacity(),
	}

	var resource *rpcv1.CalendarResource
	if err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var logicErr error
		resource, logicErr = s.Logic.CreateResource(ctx, tx, orgID, empID, params)
		return logicErr
	}); err != nil {
		return nil, handleCalendarError(err)
	}
	return connect.NewResponse(&rpcv1.CreateResourceResponse{Resource: resource}), nil
}

func (s *CalendarServiceServer) UpdateResource(
	ctx context.Context,
	req *connect.Request[rpcv1.UpdateResourceRequest],
) (*connect.Response[rpcv1.UpdateResourceResponse], error) {
	empID, orgID, err := extractCalendarAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	msg := req.Msg
	resourceID, err := dbuuid.Parse(msg.GetResourceId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid resource_id: %w", err))
	}

	params := &UpdateResourceParams{}
	if n := msg.GetName(); n != "" {
		params.Name = &n
	}
	if loc := msg.GetLocation(); loc != "" {
		params.Location = &loc
	}
	if cap := msg.GetCapacity(); cap > 0 {
		params.Capacity = &cap
	}
	isActive := msg.GetIsActive()
	params.IsActive = &isActive

	var resource *rpcv1.CalendarResource
	if err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var logicErr error
		resource, logicErr = s.Logic.UpdateResource(ctx, tx, orgID, empID, resourceID, params)
		return logicErr
	}); err != nil {
		return nil, handleCalendarError(err)
	}
	return connect.NewResponse(&rpcv1.UpdateResourceResponse{Resource: resource}), nil
}

func (s *CalendarServiceServer) SetResourceACL(
	ctx context.Context,
	req *connect.Request[rpcv1.SetResourceACLRequest],
) (*connect.Response[rpcv1.SetResourceACLResponse], error) {
	empID, orgID, err := extractCalendarAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	msg := req.Msg
	resourceID, err := dbuuid.Parse(msg.GetResourceId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid resource_id: %w", err))
	}

	if err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		return s.Logic.SetResourceACL(ctx, tx, orgID, empID, resourceID, msg.GetEntries())
	}); err != nil {
		return nil, handleCalendarError(err)
	}
	return connect.NewResponse(&rpcv1.SetResourceACLResponse{Success: true}), nil
}

// ============================================================================
// Booking Link RPC Handlers
// ============================================================================

func (s *CalendarServiceServer) CreateBookingLink(
	ctx context.Context,
	req *connect.Request[rpcv1.CreateBookingLinkRequest],
) (*connect.Response[rpcv1.CreateBookingLinkResponse], error) {
	empID, orgID, err := extractCalendarAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	msg := req.Msg
	params := &CreateBookingLinkParams{
		Title:            msg.GetTitle(),
		DurationMinutes:  msg.GetDurationMinutes(),
		ValidFrom:        msg.GetValidFrom(),
		ValidUntil:       msg.GetValidUntil(),
		AvailableWindows: msg.GetAvailableWindows(),
	}
	if msg.GetExpiresAt() != nil {
		params.ExpiresAt = msg.GetExpiresAt().AsTime()
	}

	var (
		bl       *rpcv1.BookingLink
		shareURL string
	)
	if err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var logicErr error
		bl, shareURL, logicErr = s.Logic.CreateBookingLink(ctx, tx, orgID, empID, params)
		return logicErr
	}); err != nil {
		return nil, handleCalendarError(err)
	}
	return connect.NewResponse(&rpcv1.CreateBookingLinkResponse{
		BookingLink: bl,
		ShareUrl:    shareURL,
	}), nil
}

func (s *CalendarServiceServer) GetBookingLinkByToken(
	ctx context.Context,
	req *connect.Request[rpcv1.GetBookingLinkByTokenRequest],
) (*connect.Response[rpcv1.GetBookingLinkByTokenResponse], error) {
	_, orgID, err := extractCalendarAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var (
		bl             *rpcv1.BookingLink
		availableSlots []*rpcv1.FreeBusySlot
	)
	if err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var logicErr error
		bl, availableSlots, logicErr = s.Logic.GetBookingLinkByToken(ctx, tx, orgID, req.Msg.GetToken())
		return logicErr
	}); err != nil {
		return nil, handleCalendarError(err)
	}
	return connect.NewResponse(&rpcv1.GetBookingLinkByTokenResponse{
		BookingLink:    bl,
		AvailableSlots: availableSlots,
	}), nil
}

func (s *CalendarServiceServer) ClaimBookingSlot(
	ctx context.Context,
	req *connect.Request[rpcv1.ClaimBookingSlotRequest],
) (*connect.Response[rpcv1.ClaimBookingSlotResponse], error) {
	empID, orgID, err := extractCalendarAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	msg := req.Msg
	var slotStart time.Time
	if msg.GetSlotStart() != nil {
		slotStart = msg.GetSlotStart().AsTime()
	}

	var event *rpcv1.CalendarEvent
	if err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var logicErr error
		event, logicErr = s.Logic.ClaimBookingSlot(ctx, tx, orgID, empID, msg.GetToken(), slotStart)
		return logicErr
	}); err != nil {
		return nil, handleCalendarError(err)
	}
	return connect.NewResponse(&rpcv1.ClaimBookingSlotResponse{Event: event}), nil
}

// ============================================================================
// Delegation RPC Handlers
// ============================================================================

func (s *CalendarServiceServer) GrantDelegation(
	ctx context.Context,
	req *connect.Request[rpcv1.GrantDelegationRequest],
) (*connect.Response[rpcv1.GrantDelegationResponse], error) {
	empID, orgID, err := extractCalendarAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	msg := req.Msg
	delegateID, err := dbuuid.Parse(msg.GetDelegateId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid delegate_id: %w", err))
	}

	var expiresAt *time.Time
	if msg.GetExpiresAt() != nil {
		t := msg.GetExpiresAt().AsTime()
		expiresAt = &t
	}

	if err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		return s.Logic.GrantDelegation(ctx, tx, orgID, empID, delegateID, expiresAt)
	}); err != nil {
		return nil, handleCalendarError(err)
	}
	return connect.NewResponse(&rpcv1.GrantDelegationResponse{Success: true}), nil
}

func (s *CalendarServiceServer) ListDelegations(
	ctx context.Context,
	req *connect.Request[rpcv1.ListDelegationsRequest],
) (*connect.Response[rpcv1.ListDelegationsResponse], error) {
	empID, orgID, err := extractCalendarAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var grantedByMe, grantedToMe []*rpcv1.CalendarDelegation
	if err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var logicErr error
		grantedByMe, grantedToMe, logicErr = s.Logic.ListDelegations(ctx, tx, orgID, empID)
		return logicErr
	}); err != nil {
		return nil, handleCalendarError(err)
	}
	return connect.NewResponse(&rpcv1.ListDelegationsResponse{
		GrantedByMe: grantedByMe,
		GrantedToMe: grantedToMe,
	}), nil
}

func (s *CalendarServiceServer) RevokeDelegation(
	ctx context.Context,
	req *connect.Request[rpcv1.RevokeDelegationRequest],
) (*connect.Response[rpcv1.RevokeDelegationResponse], error) {
	empID, orgID, err := extractCalendarAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	delegateID, err := dbuuid.Parse(req.Msg.GetDelegateId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid delegate_id: %w", err))
	}

	if err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		return s.Logic.RevokeDelegation(ctx, tx, orgID, empID, delegateID)
	}); err != nil {
		return nil, handleCalendarError(err)
	}
	return connect.NewResponse(&rpcv1.RevokeDelegationResponse{Success: true}), nil
}

// ============================================================================
// Compliance RPC Handlers
// ============================================================================

func (s *CalendarServiceServer) CheckInToEvent(
	ctx context.Context,
	req *connect.Request[rpcv1.CheckInToEventRequest],
) (*connect.Response[rpcv1.CheckInToEventResponse], error) {
	empID, orgID, err := extractCalendarAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	eventID, err := dbuuid.Parse(req.Msg.GetEventId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid event_id: %w", err))
	}

	var checkIn *rpcv1.CalendarCheckIn
	if err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var logicErr error
		checkIn, logicErr = s.Logic.CheckInToEvent(ctx, tx, orgID, empID, eventID)
		return logicErr
	}); err != nil {
		return nil, handleCalendarError(err)
	}
	return connect.NewResponse(&rpcv1.CheckInToEventResponse{CheckIn: checkIn}), nil
}

func (s *CalendarServiceServer) SubmitCheckInEvidence(
	ctx context.Context,
	req *connect.Request[rpcv1.SubmitCheckInEvidenceRequest],
) (*connect.Response[rpcv1.SubmitCheckInEvidenceResponse], error) {
	empID, orgID, err := extractCalendarAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	msg := req.Msg
	eventID, err := dbuuid.Parse(msg.GetEventId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid event_id: %w", err))
	}

	fileIDs := parseAttendeeIDs(msg.GetFileIds())

	var checkIn *rpcv1.CalendarCheckIn
	if err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var logicErr error
		checkIn, logicErr = s.Logic.SubmitCheckInEvidence(ctx, tx, orgID, empID, eventID, fileIDs)
		return logicErr
	}); err != nil {
		return nil, handleCalendarError(err)
	}
	return connect.NewResponse(&rpcv1.SubmitCheckInEvidenceResponse{CheckIn: checkIn}), nil
}

func (s *CalendarServiceServer) ListAuditEntries(
	ctx context.Context,
	req *connect.Request[rpcv1.ListAuditEntriesRequest],
) (*connect.Response[rpcv1.ListAuditEntriesResponse], error) {
	_, orgID, err := extractCalendarAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	msg := req.Msg
	eventID, err := dbuuid.Parse(msg.GetEventId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid event_id: %w", err))
	}

	var cursor dbuuid.NullUUID
	if c := msg.GetCursor(); c != "" {
		id, parseErr := dbuuid.Parse(c)
		if parseErr == nil {
			cursor = dbuuid.UUIDToNullUUID(id)
		}
	}

	var entries []*rpcv1.CalendarAuditEntry
	var nextCursor dbuuid.NullUUID
	if err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var logicErr error
		entries, nextCursor, logicErr = s.Logic.ListAuditEntries(ctx, tx, orgID, eventID, cursor, int(msg.GetLimit()))
		return logicErr
	}); err != nil {
		return nil, handleCalendarError(err)
	}

	nextCursorStr := ""
	if nextCursor.Valid {
		nextCursorStr = dbuuid.NullUUIDToUUID(nextCursor).String()
	}
	return connect.NewResponse(&rpcv1.ListAuditEntriesResponse{
		Entries:    entries,
		NextCursor: nextCursorStr,
	}), nil
}

// ============================================================================
// Overlay & Search RPC Handlers
// ============================================================================

func (s *CalendarServiceServer) ListOverlayItems(
	ctx context.Context,
	req *connect.Request[rpcv1.ListOverlayItemsRequest],
) (*connect.Response[rpcv1.ListOverlayItemsResponse], error) {
	empID, orgID, err := extractCalendarAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	msg := req.Msg
	var from, to time.Time
	if msg.GetStart() != nil {
		from = msg.GetStart().AsTime()
	}
	if msg.GetEnd() != nil {
		to = msg.GetEnd().AsTime()
	}

	opts := &OverlayOptions{
		IncludeTasks:        msg.GetIncludeTasks(),
		IncludeRituals:      msg.GetIncludeRituals(),
		IncludeDocDeadlines: msg.GetIncludeDocDeadlines(),
	}

	var items []*rpcv1.OverlayItem
	if err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var logicErr error
		items, logicErr = s.Logic.ListOverlayItems(ctx, tx, orgID, empID, from, to, opts)
		return logicErr
	}); err != nil {
		return nil, handleCalendarError(err)
	}
	return connect.NewResponse(&rpcv1.ListOverlayItemsResponse{Items: items}), nil
}

func (s *CalendarServiceServer) SearchEvents(
	ctx context.Context,
	req *connect.Request[rpcv1.SearchEventsRequest],
) (*connect.Response[rpcv1.SearchEventsResponse], error) {
	empID, orgID, err := extractCalendarAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	msg := req.Msg
	params := &SearchEventsParams{
		Query:     msg.GetQuery(),
		EventType: msg.GetEventType(),
		Limit:     msg.GetLimit(),
	}
	if rid := msg.GetResourceId(); rid != "" {
		id, parseErr := dbuuid.Parse(rid)
		if parseErr == nil {
			params.ResourceID = dbuuid.UUIDToNullUUID(id)
		}
	}
	if aid := msg.GetAttendeeId(); aid != "" {
		id, parseErr := dbuuid.Parse(aid)
		if parseErr == nil {
			params.AttendeeID = dbuuid.UUIDToNullUUID(id)
		}
	}
	if msg.GetFrom() != nil {
		t := msg.GetFrom().AsTime()
		params.From = &t
	}
	if msg.GetUntil() != nil {
		t := msg.GetUntil().AsTime()
		params.Until = &t
	}
	if c := msg.GetCursor(); c != "" {
		id, parseErr := dbuuid.Parse(c)
		if parseErr == nil {
			params.Cursor = dbuuid.UUIDToNullUUID(id)
		}
	}

	var events []*rpcv1.CalendarEvent
	var nextCursor dbuuid.NullUUID
	if err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var logicErr error
		events, nextCursor, logicErr = s.Logic.SearchEvents(ctx, tx, orgID, empID, params)
		return logicErr
	}); err != nil {
		return nil, handleCalendarError(err)
	}

	nextCursorStr := ""
	if nextCursor.Valid {
		nextCursorStr = dbuuid.NullUUIDToUUID(nextCursor).String()
	}
	return connect.NewResponse(&rpcv1.SearchEventsResponse{
		Events:     events,
		NextCursor: nextCursorStr,
	}), nil
}

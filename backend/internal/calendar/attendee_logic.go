package calendar

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// attendeeToProto converts a database CalendarAttendee to the proto representation.
func attendeeToProto(a *database.CalendarAttendee) *rpcv1.EventAttendee {
	proto := &rpcv1.EventAttendee{
		Id:         a.ID.String(),
		EmployeeId: a.EmployeeID.String(),
		Role:       a.Role,
		RsvpStatus: a.RsvpStatus,
	}
	if a.ResponseTime.Valid {
		proto.ResponseTime = timestamppb.New(a.ResponseTime.Time)
	}
	if a.ResponseNote.Valid {
		proto.ResponseNote = a.ResponseNote.String
	}
	return proto
}

// fetchAttendeesForEvent fetches all attendees for an event and converts them to proto.
func (l *logicImpl) fetchAttendeesForEvent(ctx context.Context, tx database.DBTX, orgID, eventID dbuuid.UUID) ([]*rpcv1.EventAttendee, error) {
	rows, err := l.queries.ListAttendees(ctx, tx, &database.ListAttendeesParams{
		OrganizationID: orgID,
		EventID:        eventID,
	})
	if err != nil {
		return nil, fmt.Errorf("list attendees: %w", err)
	}
	result := make([]*rpcv1.EventAttendee, 0, len(rows))
	for _, a := range rows {
		result = append(result, attendeeToProto(a))
	}
	return result, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// RespondToInvite
// ─────────────────────────────────────────────────────────────────────────────

func (l *logicImpl) RespondToInvite(ctx context.Context, tx database.DBTX, orgID, actorID, eventID dbuuid.UUID, rsvp string, note string) (*rpcv1.EventAttendee, error) {
	if !IsValidRSVPStatus(rsvp) {
		return nil, fmt.Errorf("invalid rsvp_status: %s", rsvp)
	}

	// Ensure the event exists.
	_, err := l.queries.GetEvent(ctx, tx, &database.GetEventParams{
		OrganizationID: orgID,
		ID:             eventID,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrEventNotFound
		}
		return nil, fmt.Errorf("get event for RSVP: %w", err)
	}

	now := toPgTimestamptz(time.Now())
	updated, err := l.queries.UpdateAttendeeRSVP(ctx, tx, &database.UpdateAttendeeRSVPParams{
		OrganizationID: orgID,
		EventID:        eventID,
		EmployeeID:     actorID,
		RsvpStatus:     rsvp,
		ResponseTime:   now,
		ResponseNote:   pgtype.Text{Valid: note != "", String: note},
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrAttendeeNotFound
		}
		return nil, fmt.Errorf("update attendee RSVP: %w", err)
	}

	return attendeeToProto(updated), nil
}

// ─────────────────────────────────────────────────────────────────────────────
// ListEventAttendees
// ─────────────────────────────────────────────────────────────────────────────

func (l *logicImpl) ListEventAttendees(ctx context.Context, tx database.DBTX, orgID, actorID, eventID dbuuid.UUID) ([]*rpcv1.EventAttendee, error) {
	// Event must exist.
	_, err := l.queries.GetEvent(ctx, tx, &database.GetEventParams{
		OrganizationID: orgID,
		ID:             eventID,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrEventNotFound
		}
		return nil, fmt.Errorf("get event for list attendees: %w", err)
	}
	return l.fetchAttendeesForEvent(ctx, tx, orgID, eventID)
}

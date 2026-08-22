package calendar

import (
	"context"
	"fmt"
	"time"

	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// CreateResourceBooking checks for conflicts using SELECT FOR UPDATE, then inserts a booking.
// Returns ErrResourceConflict if the resource is already booked in the requested window.
func (l *logicImpl) CreateResourceBooking(ctx context.Context, tx database.DBTX, orgID, eventID, resourceID, bookedByID dbuuid.UUID, start, end time.Time) (*rpcv1.ResourceBooking, error) {
	// Detect conflict with pessimistic lock.
	conflicts, err := l.queries.DetectResourceConflict(ctx, tx, &database.DetectResourceConflictParams{
		OrganizationID: orgID,
		ResourceID:     resourceID,
		RangeStart:     toPgTimestamptz(start),
		RangeEnd:       toPgTimestamptz(end),
		EventID:        eventID,
	})
	if err != nil {
		return nil, fmt.Errorf("detect resource conflict: %w", err)
	}
	if len(conflicts) > 0 {
		return nil, ErrResourceConflict
	}

	now := toPgTimestamptz(time.Now())
	row, err := l.queries.InsertResourceBooking(ctx, tx, &database.InsertResourceBookingParams{
		ID:             dbuuid.Must(),
		OrganizationID: orgID,
		ResourceID:     resourceID,
		EventID:        eventID,
		StartTime:      toPgTimestamptz(start),
		EndTime:        toPgTimestamptz(end),
		BookedByID:     bookedByID,
		UpdatedAt:      now,
	})
	if err != nil {
		return nil, fmt.Errorf("insert resource booking: %w", err)
	}
	return bookingToProto(row), nil
}

// DeleteBookingsForEvent removes all resource bookings for a given event.
func (l *logicImpl) DeleteBookingsForEvent(ctx context.Context, tx database.DBTX, orgID, eventID dbuuid.UUID) error {
	return l.queries.DeleteResourceBookingsForEvent(ctx, tx, &database.DeleteResourceBookingsForEventParams{
		OrganizationID: orgID,
		EventID:        eventID,
	})
}

// CheckResourceACL returns true if the employee is allowed to book the resource.
// If no ACL rows exist for the resource, booking is open to everyone.
func (l *logicImpl) CheckResourceACL(ctx context.Context, tx database.DBTX, orgID, resourceID, employeeID dbuuid.UUID) (bool, error) {
	entries, err := l.queries.ListResourceACLEntries(ctx, tx, &database.ListResourceACLEntriesParams{
		OrganizationID: orgID,
		ResourceID:     resourceID,
	})
	if err != nil {
		return false, fmt.Errorf("list resource ACL: %w", err)
	}
	// No ACL entries means open access.
	if len(entries) == 0 {
		return true, nil
	}
	for _, entry := range entries {
		if entry.EmployeeID.Valid && dbuuid.NullUUIDToUUID(entry.EmployeeID) == employeeID && entry.CanBook {
			return true, nil
		}
	}
	return false, nil
}

func bookingToProto(b *database.CalendarResourceBooking) *rpcv1.ResourceBooking {
	proto := &rpcv1.ResourceBooking{
		Id:         b.ID.String(),
		ResourceId: b.ResourceID.String(),
		EventId:    b.EventID.String(),
		BookedById: b.BookedByID.String(),
	}
	if b.StartTime.Valid {
		proto.StartTime = timestamppb.New(b.StartTime.Time)
	}
	if b.EndTime.Valid {
		proto.EndTime = timestamppb.New(b.EndTime.Time)
	}
	return proto
}

// fetchBookingsForEvent retrieves all resource bookings for an event and converts them to proto.
func (l *logicImpl) fetchBookingsForEvent(ctx context.Context, tx database.DBTX, orgID, eventID dbuuid.UUID) ([]*rpcv1.ResourceBooking, error) {
	rows, err := l.queries.ListResourceBookingsForEvent(ctx, tx, &database.ListResourceBookingsForEventParams{
		OrganizationID: orgID,
		EventID:        eventID,
	})
	if err != nil {
		return nil, fmt.Errorf("list bookings for event: %w", err)
	}
	result := make([]*rpcv1.ResourceBooking, 0, len(rows))
	for _, row := range rows {
		proto := &rpcv1.ResourceBooking{
			Id:           row.ID.String(),
			ResourceId:   row.ResourceID.String(),
			ResourceName: row.ResourceName,
			EventId:      row.EventID.String(),
			BookedById:   row.BookedByID.String(),
		}
		if row.StartTime.Valid {
			proto.StartTime = timestamppb.New(row.StartTime.Time)
		}
		if row.EndTime.Valid {
			proto.EndTime = timestamppb.New(row.EndTime.Time)
		}
		result = append(result, proto)
	}
	return result, nil
}

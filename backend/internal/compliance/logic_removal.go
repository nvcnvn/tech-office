package compliance

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/nvcnvn/tech-office/backend/database"
	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/internal/notification"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// RequestAccountRemoval records an admin-provisioned worker's request to be
// removed from an organization and tells the organization's owners about it.
//
// Repeating the request returns the outstanding one rather than erroring: a second
// tap on a small screen is a person checking, not a person asking twice (FR-007c).
func (l *Logic) RequestAccountRemoval(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID dbuuid.UUID,
	note string,
) (request *database.ComplianceRemovalRequest, alreadyOutstanding bool, err error) {
	existing, err := l.Queries.GetOutstandingRemovalRequest(ctx, tx, &database.GetOutstandingRemovalRequestParams{
		OrganizationID: orgID,
		EmployeeID:     employeeID,
	})
	if err == nil && existing != nil {
		return existing, true, nil
	}
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, false, fmt.Errorf("check outstanding removal request: %w", err)
	}

	created, err := l.Queries.CreateRemovalRequest(ctx, tx, &database.CreateRemovalRequestParams{
		OrganizationID: orgID,
		EmployeeID:     employeeID,
		Note:           nullText(note),
	})
	if err != nil {
		return nil, false, fmt.Errorf("create removal request: %w", err)
	}

	// The notification shares this transaction, so a failure here rolls the request
	// back rather than being swallowed. That is deliberate: a recorded request that
	// no owner ever hears about is the off-app dead end both stores reject, and a
	// person who sees an error can try again, whereas a silent one cannot.
	if err := l.notifyOwnersOfRemovalRequest(ctx, tx, orgID, employeeID); err != nil {
		return nil, false, fmt.Errorf("notify owners of removal request: %w", err)
	}
	return created, false, nil
}

func (l *Logic) notifyOwnersOfRemovalRequest(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID) error {
	if l.Notifier == nil || l.Owners == nil {
		return nil
	}
	owners, err := l.Owners.ListOwnerEmployeeIDs(ctx, tx, orgID)
	if err != nil {
		return err
	}
	employee, err := l.Queries.GetEmployeeByID(ctx, tx, &database.GetEmployeeByIDParams{
		OrganizationID: orgID,
		ID:             employeeID,
	})
	if err != nil {
		return err
	}
	name := employee.GivenName + " " + employee.FamilyName

	for _, ownerID := range owners {
		if ownerID == employeeID {
			continue
		}
		if _, err := l.Notifier.PublishNotification(ctx, tx, &rpcv1.PublishNotificationRequest{
			OrganizationId:      orgID.String(),
			Recipients:          &rpcv1.NotificationRecipients{EmployeeIds: []string{ownerID.String()}},
			SourceDomain:        notification.SourceDomainSystem,
			NotificationType:    notification.NotificationTypeAccountRemovalRequested,
			Title:               "Account removal requested",
			Message:             name + " has asked to be removed from this workspace.",
			PublishingServiceId: "compliance",
		}); err != nil {
			return err
		}
	}
	return nil
}

// DecideRemovalRequest grants or declines a request.
//
// Granting ends the membership through the ordinary erase path: the employee row
// becomes a de-identified tombstone and, when this was the person's last
// membership, their global identity data goes too (FR-007e).
func (l *Logic) DecideRemovalRequest(
	ctx context.Context,
	tx database.DBTX,
	orgID, deciderID, requestID dbuuid.UUID,
	decision string,
) (decided *database.ComplianceRemovalRequest, globalPurgeEnqueued bool, err error) {
	if !IsRemovalDecision(decision) {
		return nil, false, ErrInvalidDecision
	}

	row, err := l.Queries.DecideRemovalRequest(ctx, tx, &database.DecideRemovalRequestParams{
		OrganizationID:      orgID,
		ID:                  requestID,
		Status:              decision,
		DecidedByEmployeeID: nullUUID(deciderID),
		DecidedAt:           nowTS(time.Now()),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		if _, getErr := l.Queries.GetRemovalRequest(ctx, tx, &database.GetRemovalRequestParams{
			OrganizationID: orgID,
			ID:             requestID,
		}); getErr == nil {
			return nil, false, ErrRemovalAlreadyClosed
		}
		return nil, false, ErrRemovalNotFound
	}
	if err != nil {
		return nil, false, fmt.Errorf("decide removal request: %w", err)
	}

	if decision != RemovalStatusGranted {
		return row, false, nil
	}

	deletion, err := l.EnqueueAccountErase(ctx, tx, orgID, row.EmployeeID, DeletionTriggerRemovalRequestGranted)
	if err != nil {
		return nil, false, err
	}
	slog.InfoContext(ctx, "removal request granted, erase enqueued",
		"request_id", requestID.String(),
		"deletion_id", deletion.ID.String(),
	)
	return row, true, nil
}

// ResolveOutstandingRemovalRequests closes any request an offboarded worker had
// open, so it does not linger in the owner queue after the administrator has
// already done what it asked (spec edge case).
func (l *Logic) ResolveOutstandingRemovalRequests(ctx context.Context, tx database.DBTX, orgID, employeeID, actorID dbuuid.UUID) error {
	if err := l.Queries.ResolveOutstandingRemovalRequestsForEmployee(ctx, tx, &database.ResolveOutstandingRemovalRequestsForEmployeeParams{
		OrganizationID:      orgID,
		EmployeeID:          employeeID,
		DecidedByEmployeeID: nullUUID(actorID),
		DecidedAt:           nowTS(time.Now()),
	}); err != nil {
		return fmt.Errorf("resolve outstanding removal requests: %w", err)
	}
	return nil
}

// LatestRemovalRequest returns the person's most recent request whatever its
// status, so a declined worker sees the decision rather than an empty screen.
func (l *Logic) LatestRemovalRequest(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID) (*database.ComplianceRemovalRequest, error) {
	row, err := l.Queries.GetLatestRemovalRequestForEmployee(ctx, tx, &database.GetLatestRemovalRequestForEmployeeParams{
		OrganizationID: orgID,
		EmployeeID:     employeeID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get latest removal request: %w", err)
	}
	return row, nil
}

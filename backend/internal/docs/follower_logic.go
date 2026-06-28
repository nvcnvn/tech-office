package docs

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
	"github.com/nvcnvn/tech-office/backend/internal/notification"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// ============================================================================
// Follower Methods
// ============================================================================

func (l *documentLogicImpl) FollowDocument(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID, docID dbuuid.UUID,
) error {
	slog.DebugContext(ctx, "DocumentLogic.FollowDocument",
		"docID", docID,
		"employeeID", employeeID,
	)

	// Check if document exists
	_, err := l.Queries.GetDocumentByID(ctx, tx, &database.GetDocumentByIDParams{
		OrganizationID: orgID,
		ID:             docID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrDocumentNotFound
		}
		return fmt.Errorf("failed to get document: %w", err)
	}

	if err := l.ensureDocumentManualSubscription(ctx, tx, orgID, employeeID, docID); err != nil {
		return fmt.Errorf("failed to sync document manual subscription: %w", err)
	}

	return nil
}

func (l *documentLogicImpl) UnfollowDocument(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID, docID dbuuid.UUID,
) error {
	slog.DebugContext(ctx, "DocumentLogic.UnfollowDocument",
		"docID", docID,
		"employeeID", employeeID,
	)

	if err := l.markDocumentSubscriptionUnfollowed(ctx, tx, orgID, employeeID, docID); err != nil {
		return fmt.Errorf("failed to sync document unfollowed state: %w", err)
	}

	return nil
}

func (l *documentLogicImpl) upsertDocumentResourceSubscription(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID, docID dbuuid.UUID,
	state string,
) (*database.NotificationResourceSubscription, error) {
	preferenceLevel := notification.NotificationPreferenceAll
	existing, err := l.Queries.GetResourceSubscriptionByEmployee(ctx, tx, &database.GetResourceSubscriptionByEmployeeParams{
		OrganizationID: orgID,
		EmployeeID:     employeeID,
		ResourceDomain: notification.ResourceDomainDocument,
		ResourceID:     docID,
	})
	if err == nil {
		preferenceLevel = existing.PreferenceLevel
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("failed to load existing document subscription: %w", err)
	}

	return l.Queries.UpsertResourceSubscription(ctx, tx, &database.UpsertResourceSubscriptionParams{
		OrganizationID:    orgID,
		EmployeeID:        employeeID,
		ResourceDomain:    notification.ResourceDomainDocument,
		ResourceID:        docID,
		SubscriptionState: state,
		PreferenceLevel:   preferenceLevel,
		UpdatedAt:         pgtype.Timestamptz{Time: time.Now(), Valid: true},
	})
}

func (l *documentLogicImpl) syncDocumentSubscriptionReason(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID, docID dbuuid.UUID,
	reasonType string,
	remove bool,
) error {
	if remove {
		subscription, err := l.Queries.GetResourceSubscriptionByEmployee(ctx, tx, &database.GetResourceSubscriptionByEmployeeParams{
			OrganizationID: orgID,
			EmployeeID:     employeeID,
			ResourceDomain: notification.ResourceDomainDocument,
			ResourceID:     docID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil
			}
			return fmt.Errorf("failed to load document subscription for reason removal: %w", err)
		}
		return l.Queries.DeleteResourceSubscriptionReason(ctx, tx, &database.DeleteResourceSubscriptionReasonParams{
			OrganizationID: subscription.OrganizationID,
			SubscriptionID: subscription.ID,
			ReasonType:     reasonType,
			ReasonRefType:  pgtype.Text{},
			ReasonRefID:    dbuuid.NullUUID{},
		})
	}

	subscription, err := l.upsertDocumentResourceSubscription(ctx, tx, orgID, employeeID, docID, notification.ResourceSubscriptionStateActive)
	if err != nil {
		return err
	}

	return l.Queries.AddResourceSubscriptionReason(ctx, tx, &database.AddResourceSubscriptionReasonParams{
		OrganizationID: subscription.OrganizationID,
		SubscriptionID: subscription.ID,
		ReasonType:     reasonType,
		ReasonRefType:  pgtype.Text{},
		ReasonRefID:    dbuuid.NullUUID{},
		CreatedAt:      pgtype.Timestamptz{Time: time.Now(), Valid: true},
	})
}

func (l *documentLogicImpl) ensureDocumentManualSubscription(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID, docID dbuuid.UUID,
) error {
	if _, err := l.upsertDocumentResourceSubscription(ctx, tx, orgID, employeeID, docID, notification.ResourceSubscriptionStateActive); err != nil {
		return err
	}
	return l.syncDocumentSubscriptionReason(ctx, tx, orgID, employeeID, docID, notification.ResourceSubscriptionReasonManualFollow, false)
}

func (l *documentLogicImpl) ensureDocumentCreatorSubscription(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID, docID dbuuid.UUID,
) error {
	if _, err := l.upsertDocumentResourceSubscription(ctx, tx, orgID, employeeID, docID, notification.ResourceSubscriptionStateActive); err != nil {
		return err
	}
	return l.syncDocumentSubscriptionReason(ctx, tx, orgID, employeeID, docID, notification.ResourceSubscriptionReasonCreator, false)
}

func (l *documentLogicImpl) ensureDocumentCommentedSubscription(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID, docID dbuuid.UUID,
) error {
	if _, err := l.upsertDocumentResourceSubscription(ctx, tx, orgID, employeeID, docID, notification.ResourceSubscriptionStateActive); err != nil {
		return err
	}
	return l.syncDocumentSubscriptionReason(ctx, tx, orgID, employeeID, docID, notification.ResourceSubscriptionReasonCommented, false)
}

func (l *documentLogicImpl) markDocumentSubscriptionUnfollowed(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID, docID dbuuid.UUID,
) error {
	if _, err := l.upsertDocumentResourceSubscription(ctx, tx, orgID, employeeID, docID, notification.ResourceSubscriptionStateUnfollowed); err != nil {
		return err
	}
	return l.syncDocumentSubscriptionReason(ctx, tx, orgID, employeeID, docID, notification.ResourceSubscriptionReasonManualFollow, true)
}

func (l *documentLogicImpl) ListFollowedDocuments(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID dbuuid.UUID,
	cursor *dbuuid.UUID,
	limit int32,
) ([]*rpcv1.DocumentSummary, error) {
	slog.DebugContext(ctx, "DocumentLogic.ListFollowedDocuments",
		"employeeID", employeeID,
		"limit", limit,
	)

	var cursorUUID dbuuid.NullUUID
	if cursor != nil {
		cursorUUID = dbuuid.UUIDToNullUUID(*cursor)
	}

	docs, err := l.Queries.ListFollowedDocumentsBySubscription(ctx, tx, &database.ListFollowedDocumentsBySubscriptionParams{
		OrganizationID: orgID,
		EmployeeID:     employeeID,
		Cursor:         cursorUUID,
		DocLimit:       limit,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list followed documents: %w", err)
	}

	result := make([]*rpcv1.DocumentSummary, len(docs))
	for i, d := range docs {
		result[i] = &rpcv1.DocumentSummary{
			Id:         dbuuid.UUID(d.ID).String(),
			Title:      d.Title,
			Slug:       d.Slug,
			Status:     statusToProto(d.Status),
			Visibility: visibilityToProto(d.Visibility),
			ChildCount: d.ChildCount,
			UpdatedAt:  timestamppb.New(d.UpdatedAt.Time),
		}
	}

	return result, nil
}

func (l *documentLogicImpl) IsFollowing(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID, docID dbuuid.UUID,
) (bool, error) {
	sub, err := l.Queries.GetResourceSubscriptionByEmployee(ctx, tx, &database.GetResourceSubscriptionByEmployeeParams{
		OrganizationID: orgID,
		EmployeeID:     employeeID,
		ResourceDomain: notification.ResourceDomainDocument,
		ResourceID:     docID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	return sub.SubscriptionState == notification.ResourceSubscriptionStateActive, nil
}

func (l *documentLogicImpl) GetDocumentFollowers(
	ctx context.Context,
	tx database.DBTX,
	orgID, docID dbuuid.UUID,
) ([]dbuuid.UUID, error) {
	subs, err := l.Queries.ListActiveResourceSubscriptionsByResource(ctx, tx, &database.ListActiveResourceSubscriptionsByResourceParams{
		OrganizationID: orgID,
		ResourceDomain: notification.ResourceDomainDocument,
		ResourceID:     docID,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get document followers: %w", err)
	}

	result := make([]dbuuid.UUID, len(subs))
	for i, s := range subs {
		result[i] = s.EmployeeID
	}
	return result, nil
}

// notifyDocFollowers resolves all eligible recipients for a document notification
// from V2 resource subscriptions. Recipients are deduplicated and the actor is
// excluded. A typed NavigationTarget and explicit policy metadata are set on every
// notification.
func (l *documentLogicImpl) notifyDocFollowers(
	ctx context.Context,
	tx database.DBTX,
	orgID, docID, actorID dbuuid.UUID,
	notificationType string,
	priority int32,
	isMention bool,
	title, message string,
) {
	if l.NotificationPublisher == nil {
		return
	}

	// Determine policy key and source category from notification type
	policyKey, sourceCategory := docNotificationPolicy(notificationType, isMention)

	// V2: Resolve recipients from resource_subscription table instead of legacy document_follower.
	subscribers, err := l.Queries.ListActiveResourceSubscriptionsByResource(ctx, tx, &database.ListActiveResourceSubscriptionsByResourceParams{
		OrganizationID: orgID,
		ResourceDomain: notification.ResourceDomainDocument,
		ResourceID:     docID,
	})
	if err != nil {
		slog.WarnContext(ctx, "failed to list document subscribers for notification",
			"error", err, "docID", docID.String(),
		)
		return
	}

	// Build recipient set from active subscribers, excluding the actor.
	recipientIDs := make([]string, 0, len(subscribers))
	for _, sub := range subscribers {
		empID := dbuuid.UUID(sub.EmployeeID)
		if empID == actorID {
			slog.DebugContext(ctx, "recipient excluded: actor",
				"employeeID", empID.String(), "docID", docID.String())
			continue
		}
		// Respect V2 preference level.
		switch sub.PreferenceLevel {
		case notification.NotificationPreferenceMuted:
			slog.DebugContext(ctx, "recipient excluded: muted",
				"employeeID", empID.String(), "docID", docID.String())
			continue
		case notification.NotificationPreferenceMentions:
			if !isMention {
				slog.DebugContext(ctx, "recipient excluded: mentions-only, not a mention",
					"employeeID", empID.String(), "docID", docID.String())
				continue
			}
		}
		recipientIDs = append(recipientIDs, sub.EmployeeID.String())
	}

	slog.DebugContext(ctx, "document notification recipient resolution",
		"docID", docID.String(),
		"notificationType", notificationType,
		"totalSubscribers", len(subscribers),
		"eligibleRecipients", len(recipientIDs),
	)

	if len(recipientIDs) == 0 {
		return
	}

	_, err = l.NotificationPublisher.PublishNotification(ctx, tx, &rpcv1.PublishNotificationRequest{
		Recipients: &rpcv1.NotificationRecipients{
			EmployeeIds: recipientIDs,
		},
		OrganizationId:   orgID.String(),
		SourceDomain:     notification.SourceDomainDocs,
		NotificationType: notificationType,
		Priority:         priority,
		Title:            title,
		Message:          message,
		PolicyKey:        policyKey,
		DeliveryClass:    notification.DeliveryClassPersistent,
		SourceCategory:   sourceCategory,
		NavigationTarget: &rpcv1.NavigationTarget{
			Domain:       notification.SourceDomainDocs,
			ResourceType: "document",
			ResourceId:   docID.String(),
		},
	})
	if err != nil {
		slog.WarnContext(ctx, "failed to publish doc notification",
			"error", err, "docID", docID.String())
	}
}

// docNotificationPolicy maps a notification type to the appropriate policy key and source category.
func docNotificationPolicy(notificationType string, isMention bool) (policyKey, sourceCategory string) {
	if isMention {
		return notification.PolicyKeyDocumentMention, notification.SourceCategoryMention
	}
	switch notificationType {
	case notification.NotificationTypeDocCommented:
		return notification.PolicyKeyDocumentComment, notification.SourceCategoryActivity
	case notification.NotificationTypeDocUpdated:
		return notification.PolicyKeyDocumentUpdate, notification.SourceCategoryActivity
	default:
		return notification.PolicyKeyPersistentDefault, notification.SourceCategoryActivity
	}
}

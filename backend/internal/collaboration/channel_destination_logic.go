package collaboration

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// The project a chat channel's tasks default to.
//
// A channel's first conversion writes this, so the second conversion in the same channel
// needs only a title and a confirmation. It is a convenience, never an authority: the
// person converting can always pick a different project for one task, and doing so does
// not change what the channel remembers.
//
// The row is never deleted because the project became archived or unreachable. FR-018
// requires those to be *treated* as unset at read time, with a reason; deleting the row
// would silently lose the setting if the project were later unarchived.

// GetChannelTaskDestination reports the channel's remembered project, resolved against
// what the caller can actually use right now. An archived project, or one this caller
// cannot write to, comes back unset with the reason why — so the client can explain the
// empty picker in one line rather than showing an unexplained blank.
func (l *logicImpl) GetChannelTaskDestination(
	ctx context.Context,
	tx database.DBTX,
	orgID, actorID dbuuid.UUID,
	channelID dbuuid.UUID,
) (*rpcv1.GetChannelTaskDestinationResponse, error) {
	// Reading through chat is the channel access check: someone who cannot read the
	// channel has no business knowing where its tasks go.
	if _, _, err := l.ChatLogic.GetChannel(ctx, tx, orgID, actorID, channelID); err != nil {
		return nil, ErrAccessDenied
	}

	row, err := l.Queries.GetChannelTaskDestination(ctx, tx, &database.GetChannelTaskDestinationParams{
		OrganizationID: orgID,
		ChannelID:      channelID,
	})
	if err != nil {
		return unsetDestination(rpcv1.ChannelDestinationUnsetReason_CHANNEL_DESTINATION_UNSET_REASON_NEVER_SET), nil
	}

	// The project foreign key cascades, so a row whose project has gone should not
	// exist. Reporting it rather than trusting that keeps a manual deletion legible.
	if !row.ResolvedProjectID.Valid {
		return unsetDestination(rpcv1.ChannelDestinationUnsetReason_CHANNEL_DESTINATION_UNSET_REASON_PROJECT_DELETED), nil
	}
	if row.ProjectIsArchived.Bool {
		return unsetDestination(rpcv1.ChannelDestinationUnsetReason_CHANNEL_DESTINATION_UNSET_REASON_PROJECT_ARCHIVED), nil
	}

	// "Usable" means the caller could actually create a task there, so a viewer sees the
	// same empty picker as a non-member — with a reason that says why.
	role, roleErr := l.GetProjectMemberRole(ctx, tx, orgID, row.ProjectID, actorID)
	if roleErr != nil || role == ProjectMemberRoleViewer {
		return unsetDestination(rpcv1.ChannelDestinationUnsetReason_CHANNEL_DESTINATION_UNSET_REASON_NO_ACCESS), nil
	}

	return &rpcv1.GetChannelTaskDestinationResponse{
		IsSet:       true,
		ProjectId:   row.ProjectID.String(),
		ProjectName: row.ProjectName.String,
		ProjectKey:  row.ProjectKey.String,
	}, nil
}

// SetChannelTaskDestination changes or clears what a channel remembers. An absent
// project id clears it.
//
// Beyond the collab.createTask permission the interceptor checks, this requires the
// caller to administer the channel — the same shape as ritual definition management,
// which requires a project role above its permission. Where a channel's work lands is a
// decision about the channel, not about any one task in it (FR-017).
func (l *logicImpl) SetChannelTaskDestination(
	ctx context.Context,
	tx database.DBTX,
	orgID, actorID dbuuid.UUID,
	channelID dbuuid.UUID,
	projectID *string,
) (*rpcv1.GetChannelTaskDestinationResponse, error) {
	channel, _, err := l.ChatLogic.GetChannel(ctx, tx, orgID, actorID, channelID)
	if err != nil {
		return nil, ErrAccessDenied
	}
	if !channel.GetCurrentUserMembership().GetIsAdmin() {
		return nil, ErrChannelAdminRequired
	}

	if projectID == nil || *projectID == "" {
		if err := l.Queries.ClearChannelTaskDestination(ctx, tx, &database.ClearChannelTaskDestinationParams{
			OrganizationID: orgID,
			ChannelID:      channelID,
		}); err != nil {
			return nil, fmt.Errorf("failed to clear channel task destination: %w", err)
		}
		slog.InfoContext(ctx, "channel task destination cleared", "channelID", channelID)
		return unsetDestination(rpcv1.ChannelDestinationUnsetReason_CHANNEL_DESTINATION_UNSET_REASON_NEVER_SET), nil
	}

	target, err := parseUUID(*projectID)
	if err != nil {
		return nil, ErrProjectNotFound
	}
	// The same check a conversion makes, so an administrator cannot pin a channel to a
	// project they could not create a task in themselves.
	if err := l.assertDestinationUsable(ctx, tx, orgID, actorID, target); err != nil {
		return nil, err
	}

	if err := l.Queries.SetChannelTaskDestination(ctx, tx, &database.SetChannelTaskDestinationParams{
		OrganizationID:  orgID,
		ChannelID:       channelID,
		ProjectID:       target,
		SetByEmployeeID: actorID,
	}); err != nil {
		return nil, fmt.Errorf("failed to set channel task destination: %w", err)
	}
	slog.InfoContext(ctx, "channel task destination set",
		"channelID", channelID, "projectID", target, "setBy", actorID)

	return l.GetChannelTaskDestination(ctx, tx, orgID, actorID, channelID)
}

// unsetDestination is the shape every "no usable destination" answer takes: is_set false
// plus the reason the client turns into its one-line explanation.
func unsetDestination(reason rpcv1.ChannelDestinationUnsetReason) *rpcv1.GetChannelTaskDestinationResponse {
	return &rpcv1.GetChannelTaskDestinationResponse{IsSet: false, UnsetReason: reason}
}

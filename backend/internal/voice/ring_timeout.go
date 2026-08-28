package voice

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/tech-office/backend/database"
	"github.com/nvcnvn/tech-office/backend/database/txn"
	"github.com/nvcnvn/tech-office/backend/internal/notification"
)

// The ring timeout sweep ends calls nobody answered.
//
// Before this, a ringing call ended only when LiveKit reported its room finished — and
// with no participant ever joining, that report never came, so the call rang without
// bound. The sweep is what makes "rings out and is recorded as missed" a thing that
// actually happens (US1 scenario 5, SC-006).

// ringTimeoutSweepInterval is how often expired ringing calls are looked for. One
// second matches the rescue push worker's tick, and it is the resolution the 45-second
// deadline is worth: a call that ends one tick late is indistinguishable to a caller.
const ringTimeoutSweepInterval = time.Second

// ringTimeoutBatchSize bounds one sweep so a backlog cannot hold a transaction open.
const ringTimeoutBatchSize = 100

// StartRingTimeoutWorker sweeps expired ringing calls until ctx is cancelled.
//
// Safe to run on every instance (Constitution XI): the claim and the end are one
// UPDATE, so two instances sweeping the same call serialise on the row and only the
// one whose UPDATE matched sees it — which is what keeps the terminal wake and the
// voice_call_missed chat message from being published twice.
func (l *Logic) StartRingTimeoutWorker(ctx context.Context, adminPool database.AdminDatabaseConnector) {
	ticker := time.NewTicker(ringTimeoutSweepInterval)
	defer ticker.Stop()

	slog.InfoContext(ctx, "starting voice ring timeout worker",
		"interval", ringTimeoutSweepInterval.String(),
		"ring_timeout", RingTimeout.String(),
	)

	for {
		select {
		case <-ctx.Done():
			slog.InfoContext(ctx, "stopping voice ring timeout worker")
			return
		case <-ticker.C:
			if err := l.sweepExpiredRingingCalls(ctx, adminPool); err != nil {
				if ctx.Err() != nil {
					return
				}
				slog.ErrorContext(ctx, "voice ring timeout sweep failed", "error", err)
			}
		}
	}
}

func (l *Logic) sweepExpiredRingingCalls(ctx context.Context, adminPool database.AdminDatabaseConnector) error {
	now := pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true}

	// Organizations first, then a transaction per organization: every write stays
	// inside one tenant's shard, and one organization's backlog cannot stall another's
	// ring timeouts.
	orgIDs, err := l.Queries.ListOrganizationsWithExpiredRingingCalls(ctx, adminPool, now)
	if err != nil {
		return err
	}

	for _, orgID := range orgIDs {
		if err := txn.WithTxn(ctx, adminPool, func(ctx context.Context, tx database.DBTX) error {
			expired, err := l.Queries.ClaimExpiredRingingCalls(ctx, tx, &database.ClaimExpiredRingingCallsParams{
				OrganizationID: orgID,
				NowAt:          now,
				BatchLimit:     ringTimeoutBatchSize,
			})
			if err != nil {
				return err
			}

			for _, call := range expired {
				slog.InfoContext(ctx, "voice call rang out",
					"call_id", call.ID.String(),
					"organization_id", orgID.String(),
					"channel_id", call.ChannelID.String(),
				)

				// Stop every device that is still ringing. This runs before the chat
				// message so a phone is released as early as possible in the tick.
				l.emitTerminalCallWake(ctx, tx, orgID, call, terminalWakeEventForOutcome(CallOutcomeMissed))

				if err := l.acknowledgeVoiceCallNotificationsForCall(ctx, tx, orgID, call.ID); err != nil {
					return err
				}
				// The same announcement the webhook path makes, so a call that rang out
				// is indistinguishable in the conversation from one LiveKit reported
				// missed — one missed-call record, written by one code path.
				if err := l.announceVoiceCallEnded(ctx, tx, orgID, call.InitiatorEmployeeID, call.ChannelID, call.ID, CallOutcomeMissed); err != nil {
					return err
				}

				session, err := l.callToProto(ctx, tx, call)
				if err != nil {
					return err
				}
				l.publishVoiceCallEvent(ctx, tx, orgID, notification.NotificationTypeVoiceCallEnded, "ended", session, map[string]string{
					"outcome": CallOutcomeMissed,
					"reason":  "ring_timeout",
				})
			}
			return nil
		}); err != nil {
			if ctx.Err() != nil {
				return err
			}
			slog.WarnContext(ctx, "failed to sweep expired ringing calls for organization",
				"organization_id", orgID.String(), "error", err)
		}
	}

	return nil
}

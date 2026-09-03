package collaboration

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
)

// RitualReconciliationCounts is what one organization's pass changed (FR-012).
type RitualReconciliationCounts struct {
	InstancesExamined int
	MarkedOverdue     int
	MarkedMissed      int
}

// ReconcileOverdueRitualInstances applies the lateness rules to one organization's late
// ritual instances.
//
// It deliberately loops calling reconcileRitualTaskStateForTask rather than issuing one
// set-based UPDATE. A bulk update would have to re-implement the evidence rules in SQL,
// and a second implementation of those rules is exactly the divergence FR-007 forbids:
// the state an instance lands in must not depend on whether an evidence write or the
// sweep last touched it.
//
// ponytail: one instance costs a project-state list, an evidence snapshot and a definition
// read. Cost is linear in late instances, which is bounded per pass at
// ritualReconciliationInstanceLimit. If a pass becomes measurably slow, cache the
// per-project state list and per-definition grace window for the duration of one pass —
// both are stable across the instances of a single organization.
func (l *logicImpl) ReconcileOverdueRitualInstances(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	now time.Time,
) (RitualReconciliationCounts, error) {
	var counts RitualReconciliationCounts

	instances, err := l.Queries.ListRitualInstancesForReconciliation(ctx, tx, &database.ListRitualInstancesForReconciliationParams{
		OrganizationID: orgID,
		Now:            pgtype.Timestamptz{Time: now, Valid: true},
		InstanceLimit:  ritualReconciliationInstanceLimit,
	})
	if err != nil {
		return counts, fmt.Errorf("failed to list ritual instances for reconciliation: %w", err)
	}

	for _, task := range instances {
		counts.InstancesExamined++

		outcome, reconcileErr := l.reconcileRitualTaskStateForTask(ctx, tx, orgID, task, now)
		if reconcileErr != nil {
			// FR-011: one instance must not cost the organization its remaining work.
			slog.ErrorContext(ctx, "ritual reconciliation: instance failed",
				"error", reconcileErr,
				"orgID", orgID,
				"taskID", task.ID,
			)
			continue
		}

		if !outcome.Changed {
			continue
		}

		switch outcome.To {
		case StateCategoryOverdue:
			counts.MarkedOverdue++
		case StateCategoryMissed:
			counts.MarkedMissed++
		}
	}

	return counts, nil
}

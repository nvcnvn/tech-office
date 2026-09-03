package collaboration

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/flows"

	"github.com/nvcnvn/tech-office/backend/database"
)

// RitualReconciliationInput is empty by design: the sweep discovers its own work.
type RitualReconciliationInput struct{}

// RitualReconciliationOutput reports what one pass covered (FR-012). A pass that examined
// forty instances and moved none is deliberately distinguishable from one that found
// nothing to examine — the two have very different causes.
type RitualReconciliationOutput struct {
	OrganizationsProcessed int `json:"organizations_processed"`
	InstancesExamined      int `json:"instances_examined"`
	MarkedOverdue          int `json:"marked_overdue"`
	MarkedMissed           int `json:"marked_missed"`
}

// RitualReconciliationWorkflow is the platform-wide job that makes overdue and missed real
// states rather than something a client computes. Without it nothing writes either state,
// and an owner only learns a checklist was skipped by opening a health report.
//
// It runs on a fixed cadence and needs no user or client action (FR-008). Discovery goes
// through late *instances* rather than active *definitions*, so an instance outlives its
// definition's archival and is still reconciled (FR-009).
type RitualReconciliationWorkflow struct {
	Logic     Logic
	Queries   *database.Queries
	AdminPool database.AdminDatabaseConnector
}

func (w *RitualReconciliationWorkflow) Name() string { return "ritual_reconciliation_sweep" }

func (w *RitualReconciliationWorkflow) Run(ctx context.Context, wf *flows.Context, in *RitualReconciliationInput) (*RitualReconciliationOutput, error) {
	return flows.Execute(ctx, wf, "reconcile_all_organizations/v1",
		func(ctx context.Context, _ *RitualReconciliationInput) (*RitualReconciliationOutput, error) {
			return w.Sweep(ctx, time.Now())
		},
		in,
		flows.RetryPolicy{MaxRetries: 2},
	)
}

// Sweep runs one reconciliation cycle across every organization holding late instances.
// Exported so integration tests can drive a cycle without standing up a flows worker, and
// so now can be injected rather than slept for.
//
// The pass is idempotent: it holds no state between runs, its cursor is the state column of
// the instances themselves, and an instance already in its target state is neither
// rewritten nor re-notified (FR-010). A retried pass is therefore safe.
func (w *RitualReconciliationWorkflow) Sweep(ctx context.Context, now time.Time) (*RitualReconciliationOutput, error) {
	orgIDs, err := w.Queries.ListOrganizationIDsWithReconcilableRitualInstances(ctx, w.AdminPool,
		pgtype.Timestamptz{Time: now, Valid: true})
	if err != nil {
		return nil, fmt.Errorf("ritual reconciliation sweep: failed to list organizations: %w", err)
	}

	out := &RitualReconciliationOutput{}
	for _, orgID := range orgIDs {
		out.OrganizationsProcessed++

		counts, reconcileErr := w.Logic.ReconcileOverdueRitualInstances(ctx, w.AdminPool, orgID, now)
		if reconcileErr != nil {
			// FR-011: one organization must not abort the run, and the run output must
			// name the organization responsible.
			slog.ErrorContext(ctx, "ritual reconciliation sweep: organization failed",
				"orgID", orgID,
				"error", reconcileErr,
			)
			continue
		}

		out.InstancesExamined += counts.InstancesExamined
		out.MarkedOverdue += counts.MarkedOverdue
		out.MarkedMissed += counts.MarkedMissed
	}

	slog.InfoContext(ctx, "ritual reconciliation sweep complete",
		"organizations_processed", out.OrganizationsProcessed,
		"instances_examined", out.InstancesExamined,
		"marked_overdue", out.MarkedOverdue,
		"marked_missed", out.MarkedMissed,
	)

	return out, nil
}

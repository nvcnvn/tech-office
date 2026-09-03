package collaboration

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/nvcnvn/flows"

	"github.com/nvcnvn/tech-office/backend/database"
)

// RitualShiftResolutionInput is empty by design: the sweep discovers its own work.
type RitualShiftResolutionInput struct{}

// RitualShiftResolutionOutput reports what one pass covered. Every counter is separate
// because they have different causes: a pass that reassigned forty slots means the rota
// churned, and a pass that escalated forty means nobody published one.
type RitualShiftResolutionOutput struct {
	OrganizationsProcessed int `json:"organizations_processed"`
	SlotsExamined          int `json:"slots_examined"`
	SlotsAssigned          int `json:"slots_assigned"`
	SlotsReassigned        int `json:"slots_reassigned"`
	SlotsWithdrawn         int `json:"slots_withdrawn"`
	SlotsEscalated         int `json:"slots_escalated"`
}

// RitualShiftResolutionWorkflow is the third platform-wide collaboration job. Generation
// creates ritual instances; reconciliation makes overdue and missed real states; this one
// is what makes on-shift assignment late-bound.
//
// It has to exist because instances are materialised 30 days ahead while rotas are
// published a week or two ahead: at generation time most on-shift slots have nobody
// rostered yet, and without this pass they would stay unassigned forever.
type RitualShiftResolutionWorkflow struct {
	Logic     Logic
	Queries   *database.Queries
	AdminPool database.AdminDatabaseConnector
}

func (w *RitualShiftResolutionWorkflow) Name() string { return "ritual_shift_resolution_sweep" }

func (w *RitualShiftResolutionWorkflow) Run(ctx context.Context, wf *flows.Context, in *RitualShiftResolutionInput) (*RitualShiftResolutionOutput, error) {
	return flows.Execute(ctx, wf, "resolve_all_organizations/v1",
		func(ctx context.Context, _ *RitualShiftResolutionInput) (*RitualShiftResolutionOutput, error) {
			return w.Sweep(ctx, time.Now())
		},
		in,
		flows.RetryPolicy{MaxRetries: 2},
	)
}

// Sweep runs one resolution cycle across every organization holding a live slot row.
// Exported for the same reason the other two sweeps export theirs: integration tests drive
// a cycle with an injected clock instead of standing up a flows worker and sleeping.
//
// A failing organization logs its ID and the run continues, so one broken tenant cannot
// stop the platform's rota from being followed.
func (w *RitualShiftResolutionWorkflow) Sweep(ctx context.Context, now time.Time) (*RitualShiftResolutionOutput, error) {
	orgIDs, err := w.Queries.ListOrganizationIDsWithResolvableRitualPoolAssignments(ctx, w.AdminPool)
	if err != nil {
		return nil, fmt.Errorf("ritual shift resolution sweep: failed to list organizations: %w", err)
	}

	out := &RitualShiftResolutionOutput{}
	for _, orgID := range orgIDs {
		out.OrganizationsProcessed++

		counts, resolveErr := w.Logic.ResolveRitualShiftAssignments(ctx, w.AdminPool, orgID, now)
		if resolveErr != nil {
			slog.ErrorContext(ctx, "ritual shift resolution sweep: organization failed",
				"orgID", orgID,
				"error", resolveErr,
			)
			continue
		}

		out.SlotsExamined += counts.SlotsExamined
		out.SlotsAssigned += counts.SlotsAssigned
		out.SlotsReassigned += counts.SlotsReassigned
		out.SlotsWithdrawn += counts.SlotsWithdrawn
		out.SlotsEscalated += counts.SlotsEscalated
	}

	slog.InfoContext(ctx, "ritual shift resolution sweep complete",
		"organizations_processed", out.OrganizationsProcessed,
		"slots_examined", out.SlotsExamined,
		"slots_assigned", out.SlotsAssigned,
		"slots_reassigned", out.SlotsReassigned,
		"slots_withdrawn", out.SlotsWithdrawn,
		"slots_escalated", out.SlotsEscalated,
	)

	return out, nil
}

package collaboration

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/nvcnvn/flows"

	"github.com/nvcnvn/tech-office/backend/database"
)

// RitualGenerationInput is the input for the global ritual generation sweep. It is empty
// by design: the sweep discovers its own work, and carrying an organization or definition
// identifier is exactly what made the per-definition design redundant.
type RitualGenerationInput struct{}

// RitualGenerationOutput reports what one sweep covered (FR-014).
type RitualGenerationOutput struct {
	OrganizationsProcessed int `json:"organizations_processed"`
	DefinitionsProcessed   int `json:"definitions_processed"`
	TotalGenerated         int `json:"total_generated"`
}

// RitualGenerationWorkflow is the single platform-wide ritual generation job. It runs on a
// fixed one-minute cadence and generates due ritual instances for every organization that
// holds at least one unarchived ritual definition.
//
// It deliberately wraps Logic.GenerateRitualInstances rather than reimplementing it: the
// dates a definition produces are a pure function of its stored recurrence rule, timezone,
// last_generated_date and generation_window_days, never of when a timer fired. Reusing the
// generation function unmodified is what makes the sweep's output identical to the
// per-definition scheduler's by construction.
type RitualGenerationWorkflow struct {
	Logic     Logic
	Queries   *database.Queries
	AdminPool database.AdminDatabaseConnector
}

func (w *RitualGenerationWorkflow) Name() string { return "ritual_generation_sweep" }

func (w *RitualGenerationWorkflow) Run(ctx context.Context, wf *flows.Context, in *RitualGenerationInput) (*RitualGenerationOutput, error) {
	return flows.Execute(ctx, wf, "sweep_all_organizations/v1",
		func(ctx context.Context, _ *RitualGenerationInput) (*RitualGenerationOutput, error) {
			return w.Sweep(ctx, time.Now())
		},
		in,
		flows.RetryPolicy{MaxRetries: 2},
	)
}

// Sweep runs one generation cycle across every organization with active ritual definitions.
// Exported so integration tests can drive a cycle without standing up a flows worker.
func (w *RitualGenerationWorkflow) Sweep(ctx context.Context, now time.Time) (*RitualGenerationOutput, error) {
	orgs, err := w.Queries.ListOrganizationIDsWithActiveRitualDefinitions(ctx, w.AdminPool)
	if err != nil {
		return nil, fmt.Errorf("ritual generation sweep: failed to list organizations: %w", err)
	}

	out := &RitualGenerationOutput{}
	for _, org := range orgs {
		out.OrganizationsProcessed++
		out.DefinitionsProcessed += int(org.DefinitionCount)

		n, genErr := w.Logic.GenerateRitualInstances(ctx, w.AdminPool, org.OrganizationID, now)
		if genErr != nil {
			// FR-008: one organization must not abort the run, and the run output must
			// name the organization responsible. Per-definition isolation (FR-009) is
			// inherited from GenerateRitualInstances and is not reimplemented here.
			slog.ErrorContext(ctx, "ritual generation sweep: organization failed",
				"orgID", org.OrganizationID,
				"error", genErr,
			)
			continue
		}
		out.TotalGenerated += n
	}

	slog.InfoContext(ctx, "ritual generation sweep complete",
		"organizations_processed", out.OrganizationsProcessed,
		"definitions_processed", out.DefinitionsProcessed,
		"total_generated", out.TotalGenerated,
	)

	return out, nil
}

package collaboration

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/nvcnvn/flows"

	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
)

// RitualSchedulerInput is the per-definition input for the ritual scheduler workflow.
type RitualSchedulerInput struct {
	OrgID        dbuuid.UUID `json:"org_id"`
	DefinitionID dbuuid.UUID `json:"definition_id"`
}

// RitualSchedulerOutput captures how many instances were generated in the run.
type RitualSchedulerOutput struct {
	TotalGenerated int `json:"total_generated"`
}

// RitualSchedulerWorkflow is a flows.Workflow that generates ritual task instances
// for a single ritual definition. Each definition gets its own flows schedule.
type RitualSchedulerWorkflow struct {
	Logic     Logic
	AdminPool database.AdminDatabaseConnector
}

func (w *RitualSchedulerWorkflow) Name() string { return "ritual_scheduler" }

func (w *RitualSchedulerWorkflow) Run(ctx context.Context, wf *flows.Context, in *RitualSchedulerInput) (*RitualSchedulerOutput, error) {
	type generateOutput struct {
		TotalGenerated int `json:"total_generated"`
	}

	out, err := flows.Execute(ctx, wf, "generate_for_definition/v1",
		func(ctx context.Context, input *RitualSchedulerInput) (*generateOutput, error) {
			slog.InfoContext(ctx, "ritual scheduler: running for definition",
				"orgID", input.OrgID,
				"definitionID", input.DefinitionID,
			)

			now := time.Now()
			n, err := w.Logic.GenerateRitualInstances(ctx, w.AdminPool, input.OrgID, now)
			if err != nil {
				return nil, fmt.Errorf("ritual scheduler: generation failed for definition %v: %w", input.DefinitionID, err)
			}

			slog.InfoContext(ctx, "ritual scheduler: generation complete",
				"orgID", input.OrgID,
				"definitionID", input.DefinitionID,
				"generated", n,
			)
			return &generateOutput{TotalGenerated: n}, nil
		},
		in,
		flows.RetryPolicy{MaxRetries: 2},
	)
	if err != nil {
		return nil, err
	}

	return &RitualSchedulerOutput{TotalGenerated: out.TotalGenerated}, nil
}

// RitualScheduleID returns the flows schedule ID for a ritual definition.
func RitualScheduleID(defID dbuuid.UUID) string {
	return "ritual_def_" + defID.String()
}

// RecurrenceRuleToSchedule converts a recurrence rule JSON blob to a flows.Schedule.
func RecurrenceRuleToSchedule(ruleJSON []byte) (flows.Schedule, error) {
	rule, err := parseRecurrenceRule(ruleJSON)
	if err != nil {
		return nil, fmt.Errorf("failed to parse recurrence rule: %w", err)
	}

	hour, minute := parseTimeOfDay(rule.TimeOfDay)

	switch rule.Type {
	case RecurrenceTypeDaily:
		// Every N days at the specified time. For interval=1, cron is simplest.
		if rule.Interval <= 1 {
			expr := fmt.Sprintf("%d %d * * *", minute, hour)
			return flows.ParseCron(expr)
		}
		// For multi-day intervals, use flows.Every.
		return flows.Every(time.Duration(rule.Interval) * 24 * time.Hour), nil

	case RecurrenceTypeWeekly:
		if len(rule.DaysOfWeek) == 0 {
			return flows.ParseCron(fmt.Sprintf("%d %d * * *", minute, hour))
		}
		// Convert ISO weekdays (1=Mon..7=Sun) to cron weekdays (0=Sun..6=Sat).
		cronDays := make([]string, len(rule.DaysOfWeek))
		for i, iso := range rule.DaysOfWeek {
			cronDays[i] = fmt.Sprintf("%d", isoDayToCron(iso))
		}
		expr := fmt.Sprintf("%d %d * * %s", minute, hour, strings.Join(cronDays, ","))
		return flows.ParseCron(expr)

	case RecurrenceTypeMonthly:
		dom := rule.DayOfMonth
		if dom <= 0 {
			dom = 1
		}
		if dom > 28 {
			dom = 28 // safe cap for cron
		}
		expr := fmt.Sprintf("%d %d %d * *", minute, hour, dom)
		return flows.ParseCron(expr)

	case RecurrenceTypeCustomInterval:
		days := rule.Interval
		if days <= 0 {
			days = 1
		}
		return flows.Every(time.Duration(days) * 24 * time.Hour), nil

	case RecurrenceTypeEveryMinute:
		return flows.Every(1 * time.Minute), nil

	case RecurrenceTypeEveryTwoMinutes:
		return flows.Every(2 * time.Minute), nil

	default:
		// Fallback: daily at specified time
		expr := fmt.Sprintf("%d %d * * *", minute, hour)
		return flows.ParseCron(expr)
	}
}

// parseTimeOfDay extracts hour and minute from a "HH:MM" string.
// Returns (0, 0) if the string is empty or invalid.
func parseTimeOfDay(tod string) (hour, minute int) {
	if tod == "" {
		return 0, 0
	}
	parts := strings.SplitN(tod, ":", 2)
	if len(parts) != 2 {
		return 0, 0
	}
	var h, m int
	if _, err := fmt.Sscanf(parts[0], "%d", &h); err != nil {
		return 0, 0
	}
	if _, err := fmt.Sscanf(parts[1], "%d", &m); err != nil {
		return 0, 0
	}
	return h, m
}

// isoDayToCron converts ISO weekday (1=Mon..7=Sun) to cron weekday (0=Sun..6=Sat).
func isoDayToCron(iso int) int {
	if iso == 7 {
		return 0 // Sunday
	}
	return iso // Mon=1..Sat=6 map directly
}

// RecurrenceRuleFromDefinition extracts the recurrence rule JSON from a definition
// for use with RecurrenceRuleToSchedule.
func RecurrenceRuleFromDefinition(recurrenceRule json.RawMessage) []byte {
	return []byte(recurrenceRule)
}

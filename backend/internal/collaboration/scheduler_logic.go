package collaboration

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
)

// GenerateRitualInstances generates ritual task instances for all active definitions.
// This is called by the background scheduler using AdminPool (cross-org).
func (l *logicImpl) GenerateRitualInstances(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	now time.Time,
) (int, error) {
	slog.InfoContext(ctx, "GenerateRitualInstances starting",
		"orgID", orgID,
		"now", now,
	)

	defs, err := l.Queries.ListActiveRitualDefinitionsForGeneration(ctx, tx, &database.ListActiveRitualDefinitionsForGenerationParams{
		OrganizationID: orgID,
		TargetDate:     pgtype.Date{Time: now, Valid: true},
	})
	if err != nil {
		return 0, fmt.Errorf("failed to list active definitions: %w", err)
	}

	totalCreated := 0

	for _, def := range defs {
		defID := dbuuid.UUID(def.ID)

		// Parse recurrence rule
		rule, err := parseRecurrenceRule(def.RecurrenceRule)
		if err != nil {
			slog.WarnContext(ctx, "failed to parse recurrence rule",
				"error", err,
				"defID", defID,
			)
			continue
		}

		// Determine timezone — supports IANA names and UTC±N offset strings (e.g. "UTC+8", "UTC-5")
		loc := loadTimezone(def.Timezone)

		// Determine start date for generation
		var lastGenerated time.Time
		if def.LastGeneratedDate.Valid {
			lastGenerated = def.LastGeneratedDate.Time
		} else {
			lastGenerated = now.AddDate(0, 0, -1) // start from yesterday
		}

		// Compute dates to generate
		dates := computeDatesInWindow(rule, lastGenerated, int(def.GenerationWindowDays), loc, now)

		// Get individual assignees for this definition
		assignees, err := l.Queries.ListRitualDefinitionAssignees(ctx, tx, &database.ListRitualDefinitionAssigneesParams{
			OrganizationID:     orgID,
			RitualDefinitionID: defID,
		})
		if err != nil {
			slog.WarnContext(ctx, "failed to list assignees", "error", err, "defID", defID)
		}

		// Get department pools and pre-load round-robin member lists.
		type deptPoolState struct {
			pool            *database.ListRitualDefinitionDepartmentPoolsRow
			members         []dbuuid.UUID // sorted, used for round_robin
			lastAssignedIdx int           // current waterline index in members slice
		}
		rawPools, _ := l.Queries.ListRitualDefinitionDepartmentPools(ctx, tx, &database.ListRitualDefinitionDepartmentPoolsParams{
			OrganizationID:     orgID,
			RitualDefinitionID: defID,
		})
		poolStates := make([]deptPoolState, 0, len(rawPools))
		for _, p := range rawPools {
			ps := deptPoolState{pool: p, lastAssignedIdx: -1}
			if p.AssignmentStrategy == "round_robin" {
				members, _ := l.Queries.ListActiveDepartmentMembers(ctx, tx, &database.ListActiveDepartmentMembersParams{
					OrganizationID: orgID,
					DepartmentID:   dbuuid.UUID(p.DepartmentID),
				})
				ps.members = members
				// Advance waterline to the last assigned employee.
				if p.LastAssignedEmployeeID.Valid {
					lastEmpID := dbuuid.UUID(p.LastAssignedEmployeeID.UUID)
					for i, m := range members {
						if m == lastEmpID {
							ps.lastAssignedIdx = i
							break
						}
					}
				}
			}
			poolStates = append(poolStates, ps)
		}

		// Track per-employee assignment counts for post-loop summary notifications.
		// This avoids sending N individual notifications when N instances are generated.
		assignmentCounts := make(map[dbuuid.UUID]int)

		for _, date := range dates {
			// Check idempotency
			exists, err := l.Queries.CheckRitualInstanceExists(ctx, tx, &database.CheckRitualInstanceExistsParams{
				OrganizationID:     orgID,
				RitualDefinitionID: dbuuid.UUIDToNullUUID(defID),
				ScheduledDate:      pgtype.Date{Time: date, Valid: true},
			})
			if err != nil {
				slog.WarnContext(ctx, "failed to check instance exists", "error", err)
				continue
			}
			if exists {
				continue
			}

			// Compute completion deadline
			deadline := date.In(loc).Add(time.Duration(def.CompletionWindowHours) * time.Hour)

			// Get initial state for this project
			initialState, err := l.Queries.GetInitialState(ctx, tx, &database.GetInitialStateParams{
				OrganizationID: orgID,
				ProjectID:      dbuuid.UUID(def.ProjectID),
			})
			if err != nil {
				slog.WarnContext(ctx, "failed to get initial state", "error", err)
				continue
			}

			// Get first level
			levels, err := l.Queries.ListTaskLevels(ctx, tx, &database.ListTaskLevelsParams{
				OrganizationID: orgID,
				ProjectID:      dbuuid.UUID(def.ProjectID),
			})
			if err != nil || len(levels) == 0 {
				slog.WarnContext(ctx, "failed to get task levels", "error", err)
				continue
			}

			// Get next task number
			taskNumberResult, err := l.Queries.IncrementProjectTaskNumber(ctx, tx, &database.IncrementProjectTaskNumberParams{
				OrganizationID: orgID,
				ID:             dbuuid.UUID(def.ProjectID),
				UpdatedAt:      pgtype.Timestamptz{Time: now, Valid: true},
			})
			if err != nil {
				slog.WarnContext(ctx, "failed to increment task number", "error", err)
				continue
			}

			identifier := fmt.Sprintf("%s-%d", taskNumberResult.Key, taskNumberResult.NextTaskNumber)
			title := fmt.Sprintf("%s — %s", def.Name, date.Format("2006-01-02"))

			// Create chat channel for ritual instance comments
			// Lazy resource creation: do NOT create channel or document here.
			// They will be created on first user interaction via EnsureTaskResources.
			var channelID dbuuid.NullUUID
			var descriptionDocID dbuuid.NullUUID

			taskID := dbuuid.Must()
			_, err = l.Queries.CreateTask(ctx, tx, &database.CreateTaskParams{
				ID:                    taskID,
				OrganizationID:        orgID,
				ProjectID:             dbuuid.UUID(def.ProjectID),
				Identifier:            identifier,
				Title:                 title,
				Depth:                 0,
				Path:                  []dbuuid.UUID{},
				LevelID:               dbuuid.UUID(levels[0].ID),
				StateID:               dbuuid.UUID(initialState.ID),
				ReporterEmployeeID:    dbuuid.UUID(def.CreatedByEmployeeID),
				ChannelID:             channelID,
				DescriptionDocumentID: descriptionDocID,
				StartDate:             pgtype.Date{Time: date, Valid: true},
				TaskKind:              TaskKindRitualInstance,
				RitualDefinitionID:    dbuuid.UUIDToNullUUID(defID),
				ScheduledDate:         pgtype.Date{Time: date, Valid: true},
				CompletionDeadline:    pgtype.Timestamptz{Time: deadline, Valid: true},
				DueDate:               pgtype.Date{Time: date, Valid: true},
			})
			if err != nil {
				slog.WarnContext(ctx, "failed to create ritual instance",
					"error", err,
					"defID", defID,
					"date", date,
				)
				continue
			}

			// Assign to individual default assignees (silent: no per-task notification).
			for _, a := range assignees {
				empID := dbuuid.UUID(a.EmployeeID)
				_, err := l.assignTaskSilent(ctx, tx, orgID, dbuuid.UUID(def.CreatedByEmployeeID), taskID, empID, TaskAssigneeRoleAssignee)
				if err != nil {
					slog.WarnContext(ctx, "failed to assign ritual instance", "error", err)
				} else {
					assignmentCounts[empID]++
				}
			}

			// Assign one employee per department pool (silent: no per-task notification).
			since90 := now.AddDate(0, 0, -90)
			for i, ps := range poolStates {
				var empID dbuuid.UUID
				var resolved bool

				switch ps.pool.AssignmentStrategy {
				case "round_robin":
					if len(ps.members) == 0 {
						continue
					}
					nextIdx := (ps.lastAssignedIdx + 1) % len(ps.members)
					empID = ps.members[nextIdx]
					poolStates[i].lastAssignedIdx = nextIdx
					resolved = true
				case "least_assigned":
					result, err := l.Queries.GetLeastAssignedDepartmentEmployee(ctx, tx, &database.GetLeastAssignedDepartmentEmployeeParams{
						OrganizationID: orgID,
						Since:          pgtype.Timestamptz{Time: since90, Valid: true},
						DepartmentID:   dbuuid.UUID(ps.pool.DepartmentID),
					})
					if err != nil {
						slog.WarnContext(ctx, "failed to get least assigned employee", "error", err)
						continue
					}
					empID = result
					resolved = true
				}

				if resolved {
					_, err := l.assignTaskSilent(ctx, tx, orgID, dbuuid.UUID(def.CreatedByEmployeeID), taskID, empID, TaskAssigneeRoleAssignee)
					if err != nil {
						slog.WarnContext(ctx, "failed to assign pool employee to ritual instance", "error", err)
					} else {
						assignmentCounts[empID]++
					}
					// Persist updated waterline for round_robin (also advance for least_assigned for visibility).
					_ = l.Queries.UpdateDepartmentPoolLastAssigned(ctx, tx, &database.UpdateDepartmentPoolLastAssignedParams{
						OrganizationID:         orgID,
						ID:                     dbuuid.UUID(ps.pool.ID),
						LastAssignedEmployeeID: dbuuid.UUIDToNullUUID(empID),
						UpdatedAt:              pgtype.Timestamptz{Time: now, Valid: true},
					})
				}
			}
			// No per-instance notification here. Summary notifications are sent after the loop.

			// Increment project task count
			_ = l.Queries.IncrementProjectTaskCount(ctx, tx, &database.IncrementProjectTaskCountParams{
				OrganizationID: orgID,
				ID:             dbuuid.UUID(def.ProjectID),
				UpdatedAt:      pgtype.Timestamptz{Time: now, Valid: true},
			})

			totalCreated++
		}

		// Send one summary notification per employee that was assigned at least one instance.
		for empID, count := range assignmentCounts {
			l.notifyRitualInstancesScheduled(ctx, tx, orgID, empID, count, def.Name)
		}

		// Update last generated date to the latest date we generated
		if len(dates) > 0 {
			latestDate := dates[len(dates)-1]
			err = l.Queries.UpdateRitualDefinitionLastGenerated(ctx, tx, &database.UpdateRitualDefinitionLastGeneratedParams{
				OrganizationID:    orgID,
				ID:                defID,
				LastGeneratedDate: pgtype.Date{Time: latestDate, Valid: true},
				UpdatedAt:         pgtype.Timestamptz{Time: now, Valid: true},
			})
			if err != nil {
				slog.WarnContext(ctx, "failed to update last generated date", "error", err)
			}
		}
	}

	slog.InfoContext(ctx, "GenerateRitualInstances completed",
		"orgID", orgID,
		"totalCreated", totalCreated,
	)

	return totalCreated, nil
}

// ============================================================================
// Recurrence Computation
// ============================================================================

type recurrenceRule struct {
	Type       string `json:"type"`
	Interval   int    `json:"interval"`
	DaysOfWeek []int  `json:"days_of_week"`
	DayOfMonth int    `json:"day_of_month"`
	NthWeekday *nthWD `json:"nth_weekday"`
	TimeOfDay  string `json:"time_of_day"`
}

type nthWD struct {
	Week int `json:"week"`
	Day  int `json:"day"`
}

func parseRecurrenceRule(data []byte) (*recurrenceRule, error) {
	var r recurrenceRule
	if err := json.Unmarshal(data, &r); err != nil {
		return nil, err
	}
	if r.Interval <= 0 {
		r.Interval = 1
	}
	return &r, nil
}

func computeDatesInWindow(rule *recurrenceRule, lastGenerated time.Time, windowDays int, loc *time.Location, now time.Time) []time.Time {
	endDate := now.In(loc).AddDate(0, 0, windowDays)
	startDate := lastGenerated.In(loc).AddDate(0, 0, 1) // day after last generated

	if startDate.Before(now.In(loc).AddDate(0, 0, -windowDays)) {
		startDate = now.In(loc).AddDate(0, 0, -windowDays)
	}

	var dates []time.Time

	switch rule.Type {
	case RecurrenceTypeDaily:
		for d := startDate; !d.After(endDate); d = d.AddDate(0, 0, rule.Interval) {
			dates = append(dates, d)
		}

	case RecurrenceTypeWeekly:
		if len(rule.DaysOfWeek) == 0 {
			rule.DaysOfWeek = []int{int(startDate.Weekday())}
		}
		daySet := make(map[time.Weekday]bool)
		for _, d := range rule.DaysOfWeek {
			// Convert 1=Mon..7=Sun to Go's Sunday=0..Saturday=6
			wd := isoToGoWeekday(d)
			daySet[wd] = true
		}
		for d := startDate; !d.After(endDate); d = d.AddDate(0, 0, 1) {
			if daySet[d.Weekday()] {
				dates = append(dates, d)
			}
		}

	case RecurrenceTypeMonthly:
		if rule.DayOfMonth > 0 {
			for d := startDate; !d.After(endDate); {
				target := time.Date(d.Year(), d.Month(), min(rule.DayOfMonth, daysInMonth(d.Year(), d.Month())), 0, 0, 0, 0, loc)
				if !target.Before(startDate) && !target.After(endDate) {
					dates = append(dates, target)
				}
				d = time.Date(d.Year(), d.Month()+1, 1, 0, 0, 0, 0, loc)
			}
		}

	case RecurrenceTypeCustomInterval:
		for d := startDate; !d.After(endDate); d = d.AddDate(0, 0, rule.Interval) {
			dates = append(dates, d)
		}
	}

	return dates
}

func isoToGoWeekday(iso int) time.Weekday {
	// ISO: 1=Mon..7=Sun → Go: 0=Sun..6=Sat
	if iso == 7 {
		return time.Sunday
	}
	return time.Weekday(iso)
}

func daysInMonth(year int, month time.Month) int {
	return time.Date(year, month+1, 0, 0, 0, 0, 0, time.UTC).Day()
}

// loadTimezone parses a timezone string into a *time.Location.
// Supports standard IANA names (e.g. "Asia/Tokyo") and UTC offset strings
// in the form "UTC+8", "UTC-5" (whole hours only). Falls back to time.UTC.
func loadTimezone(tz string) *time.Location {
	if tz == "" || tz == "UTC" || tz == "UTC+0" || tz == "UTC-0" {
		return time.UTC
	}
	// Try IANA first (handles Etc/GMT-8, America/New_York, etc.)
	if loc, err := time.LoadLocation(tz); err == nil {
		return loc
	}
	// Parse "UTC+N" / "UTC-N" offset strings
	if strings.HasPrefix(tz, "UTC+") || strings.HasPrefix(tz, "UTC-") {
		sign := 1
		rest := tz[4:] // chars after "UTC+"/"UTC-"
		if tz[3] == '-' {
			sign = -1
		}
		if hours, err := strconv.Atoi(rest); err == nil {
			offsetSecs := sign * hours * 3600
			return time.FixedZone(tz, offsetSecs)
		}
	}
	return time.UTC
}

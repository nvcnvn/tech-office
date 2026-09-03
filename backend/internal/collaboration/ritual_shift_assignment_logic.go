package collaboration

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// ritualAssignmentLookbackDays is the trailing window the least-assigned tiebreak counts
// ritual assignments over. It matches the window the least_assigned strategy already uses
// at generation time, so switching a pool between the two strategies does not change what
// "fewest assignments" means.
const ritualAssignmentLookbackDays = 90

// ritualDayBounds converts a ritual instance's scheduled date into the half-open pair of
// UTC instants that bound that date in the ritual definition's own timezone.
//
// This is the whole of the timezone rule for this feature, and it lives here rather than
// in the calendar: the calendar answers a pure overlap question about instants, so a
// ritual in Asia/Tokyo and a shift stored in UTC agree without either domain learning the
// other's rules.
func ritualDayBounds(scheduledDate time.Time, loc *time.Location) (dayStart, dayEnd time.Time) {
	y, m, d := scheduledDate.Date()
	dayStart = time.Date(y, m, d, 0, 0, 0, 0, loc)
	dayEnd = dayStart.AddDate(0, 0, 1)
	return dayStart, dayEnd
}

// onShiftCandidates returns the department members the calendar reports as rostered for
// the date, in ascending UUID order, or false when nobody is.
//
// "Nobody" covers three cases that mean the same thing to every caller: an empty result, a
// nil shift coverage reader, and any error the reader returns. All three leave the slot
// awaiting resolution. There is deliberately no fallback to another strategy — falling
// back is the defect this feature exists to remove.
func (l *logicImpl) onShiftCandidates(
	ctx context.Context,
	tx database.DBTX,
	orgID, departmentID dbuuid.UUID,
	dayStart, dayEnd time.Time,
) ([]dbuuid.UUID, bool) {
	if l.shiftCoverage == nil {
		slog.WarnContext(ctx, "on-shift ritual assignment: no shift coverage reader is wired, leaving the slot awaiting resolution",
			"orgID", orgID,
			"departmentID", departmentID,
		)
		return nil, false
	}

	members, err := l.Queries.ListActiveDepartmentMembers(ctx, tx, &database.ListActiveDepartmentMembersParams{
		OrganizationID: orgID,
		DepartmentID:   departmentID,
	})
	if err != nil {
		slog.ErrorContext(ctx, "on-shift ritual assignment: failed to list department members",
			"error", err,
			"orgID", orgID,
			"departmentID", departmentID,
		)
		return nil, false
	}
	if len(members) == 0 {
		return nil, false
	}

	covered, err := l.shiftCoverage.EmployeesOnShift(ctx, tx, orgID, members, dayStart, dayEnd)
	if err != nil {
		// A calendar the sweep cannot read is indistinguishable from a rota nobody has
		// published yet: in both cases the only safe answer is to wait.
		slog.ErrorContext(ctx, "on-shift ritual assignment: failed to read shift coverage, leaving the slot awaiting resolution",
			"error", err,
			"orgID", orgID,
			"departmentID", departmentID,
			"dayStart", dayStart,
		)
		return nil, false
	}
	if len(covered) == 0 {
		return nil, false
	}
	return covered, true
}

// pickLeastAssignedCandidate breaks a tie among equally-rostered people by fewest ritual
// assignments in the trailing 90 days, then by lowest employee UUID.
//
// This is only ever used to fill an *empty* slot. A slot that already holds a rostered
// person keeps them: re-picking on every pass would hand the checklist to whoever is
// currently least loaded and so move it every two minutes, which is churn, not fairness.
func (l *logicImpl) pickLeastAssignedCandidate(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	candidates []dbuuid.UUID,
	now time.Time,
) (dbuuid.UUID, bool) {
	winner, err := l.Queries.GetLeastAssignedEmployeeAmongCandidates(ctx, tx, &database.GetLeastAssignedEmployeeAmongCandidatesParams{
		OrganizationID: orgID,
		CandidateIds:   candidates,
		Since:          pgtype.Timestamptz{Time: now.AddDate(0, 0, -ritualAssignmentLookbackDays), Valid: true},
	})
	if err != nil {
		slog.ErrorContext(ctx, "on-shift ritual assignment: failed to break the tie among rostered candidates",
			"error", err,
			"orgID", orgID,
		)
		return dbuuid.UUID{}, false
	}
	return winner, true
}

// resolveOnShiftAssignee picks the department member who should hold an on-shift pool
// slot for one scheduled date, or reports that nobody should.
//
// The candidate set is the intersection of the department's active members and whoever
// the calendar reports as rostered for the date. Ties are broken by fewest ritual
// assignments in the trailing 90 days, then by lowest employee UUID, so resolving twice
// over unchanged data returns the same person.
//
// "No candidate" is returned for an empty result, for a nil shift coverage reader and for
// any error the reader returns. All three mean the same thing to every caller: leave the
// slot awaiting resolution. There is deliberately no fallback to another strategy —
// falling back is the defect this feature exists to remove.
func (l *logicImpl) resolveOnShiftAssignee(
	ctx context.Context,
	tx database.DBTX,
	orgID, departmentID dbuuid.UUID,
	dayStart, dayEnd time.Time,
	now time.Time,
) (dbuuid.UUID, bool) {
	candidates, ok := l.onShiftCandidates(ctx, tx, orgID, departmentID, dayStart, dayEnd)
	if !ok {
		return dbuuid.UUID{}, false
	}
	return l.pickLeastAssignedCandidate(ctx, tx, orgID, candidates, now)
}

// recordOnShiftPoolSlot is generation's half of the on-shift strategy: resolve the slot
// against today's rota if one is published, and record the slot either way.
//
// Recording the slot is the point. Instances are materialised 30 days ahead and rotas are
// published a week or two ahead, so most slots are created with nobody rostered yet. The
// row is what lets the resolution sweep bind them later, and what lets the instance
// explain to a manager that it is waiting rather than broken.
//
// resolve_by is the start of the scheduled date in the definition's own timezone. It
// carries two jobs at once: resolution is attempted only while now < resolve_by, and
// escalation fires once now >= resolve_by.
func (l *logicImpl) recordOnShiftPoolSlot(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	pool *database.ListRitualDefinitionDepartmentPoolsRow,
	def *database.CollaborationRitualDefinition,
	taskID dbuuid.UUID,
	scheduledDate time.Time,
	loc *time.Location,
	now time.Time,
	assignmentCounts map[dbuuid.UUID]int,
) {
	dayStart, dayEnd := ritualDayBounds(scheduledDate, loc)

	empID, resolved := l.resolveOnShiftAssignee(ctx, tx, orgID, dbuuid.UUID(pool.DepartmentID), dayStart, dayEnd, now)

	params := &database.UpsertRitualPoolAssignmentParams{
		OrganizationID:  orgID,
		TaskID:          taskID,
		PoolID:          dbuuid.UUID(pool.ID),
		ResolutionState: PoolAssignmentStateAwaitingShift,
		ResolveBy:       pgtype.Timestamptz{Time: dayStart, Valid: true},
		UpdatedAt:       pgtype.Timestamptz{Time: now, Valid: true},
	}

	if resolved {
		if _, err := l.assignTaskSilent(ctx, tx, orgID, dbuuid.UUID(def.CreatedByEmployeeID), taskID, empID, TaskAssigneeRoleAssignee); err != nil {
			slog.WarnContext(ctx, "failed to assign on-shift employee to ritual instance",
				"error", err, "taskID", taskID, "employeeID", empID)
			// Fall through and record the slot as awaiting: the sweep retries, and a
			// half-written assignment must never look resolved.
		} else {
			assignmentCounts[empID]++
			params.ResolutionState = PoolAssignmentStateResolved
			params.AssignedEmployeeID = dbuuid.UUIDToNullUUID(empID)
			params.ResolvedAt = pgtype.Timestamptz{Time: now, Valid: true}
		}
	}

	// ON CONFLICT DO NOTHING, so a generation re-run over an instance that already has a
	// slot row leaves the sweep's work alone. pgx reports the skipped insert as no rows.
	if _, err := l.Queries.UpsertRitualPoolAssignment(ctx, tx, params); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		slog.WarnContext(ctx, "failed to record on-shift ritual pool slot",
			"error", err, "taskID", taskID, "poolID", pool.ID)
	}

	// last_assigned_employee_id is deliberately not advanced: the waterline has no
	// meaning when the candidate set changes shape every day, and advancing it would
	// corrupt the round-robin cycle if the pool were ever switched back.
}

// poolAssignmentStateRank orders the resolution states from least to most progressed. An
// instance carrying several pools reports the least-progressed one, so a pool still
// waiting for the rota is never hidden behind one that resolved.
func poolAssignmentStateRank(state string) int {
	switch state {
	case PoolAssignmentStateAwaitingShift:
		return 0
	case PoolAssignmentStateClosedUnresolved:
		return 1
	case PoolAssignmentStateResolved:
		return 2
	default:
		return 3
	}
}

// applyPoolAssignmentStates fills in Task.pool_assignment_state for a page of tasks with
// one query, never one per task.
//
// Tasks that are not on-shift ritual instances simply have no row and keep the zero value,
// UNSPECIFIED, which is what tells a client there is nothing to explain.
func (l *logicImpl) applyPoolAssignmentStates(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	tasks []*rpcv1.Task,
) {
	if len(tasks) == 0 {
		return
	}

	byID := make(map[dbuuid.UUID]*rpcv1.Task, len(tasks))
	taskIDs := make([]dbuuid.UUID, 0, len(tasks))
	for _, t := range tasks {
		if t.GetTaskKind() != rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE {
			continue
		}
		id, err := dbuuid.Parse(t.GetId())
		if err != nil {
			continue
		}
		byID[id] = t
		taskIDs = append(taskIDs, id)
	}
	if len(taskIDs) == 0 {
		return
	}

	rows, err := l.Queries.ListRitualPoolAssignmentStatesForTasks(ctx, tx, &database.ListRitualPoolAssignmentStatesForTasksParams{
		OrganizationID: orgID,
		TaskIds:        taskIDs,
	})
	if err != nil {
		// The state is an explanation, not the task. A read failure leaves it
		// UNSPECIFIED rather than failing the whole page.
		slog.WarnContext(ctx, "failed to read ritual pool assignment states for tasks",
			"error", err, "orgID", orgID)
		return
	}

	best := make(map[dbuuid.UUID]string, len(rows))
	for _, row := range rows {
		if existing, ok := best[row.TaskID]; ok &&
			poolAssignmentStateRank(existing) <= poolAssignmentStateRank(row.ResolutionState) {
			continue
		}
		best[row.TaskID] = row.ResolutionState
	}

	for taskID, state := range best {
		if t, ok := byID[taskID]; ok {
			t.PoolAssignmentState = PoolAssignmentStateToProto(state)
		}
	}
}

package collaboration

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
)

// RitualShiftResolutionCounts is what one organization's resolution pass changed.
// A pass that examined forty slots and moved none is deliberately distinguishable from
// one that found nothing to examine: the two have very different causes.
type RitualShiftResolutionCounts struct {
	SlotsExamined   int
	SlotsAssigned   int
	SlotsReassigned int
	SlotsWithdrawn  int
	SlotsEscalated  int
}

// ResolveRitualShiftAssignments runs one organization's on-shift resolution pass: it binds
// slots that were waiting for a rota, follows shift swaps, withdraws assignments whose
// cover disappeared, hands slots over when a pool's strategy changes, and escalates slots
// whose scheduled date arrived with nobody rostered.
//
// Every state write is a compare-and-set against the state the decision was made from, and
// every notification is published only when its compare-and-set reported a changed row.
// That is what makes two overlapping passes assign once and notify once, and it is why the
// pass holds no state between runs — its cursor is the resolution_state column itself.
//
// A failing slot logs its task ID and the organization's remaining slots are still
// processed. Only a failure to read the work at all aborts the pass.
func (l *logicImpl) ResolveRitualShiftAssignments(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	now time.Time,
) (RitualShiftResolutionCounts, error) {
	var counts RitualShiftResolutionCounts

	// The floor is a coarse prefilter: one day before the escalation horizon, because no
	// timezone on earth moves a date by more than a day. The exact tests — now <
	// resolve_by for resolution, resolve_by <= now for escalation — are applied below and
	// in the escalation query.
	floor := now.Add(-ritualShiftEscalationBackfillHorizon).AddDate(0, 0, -1)

	slots, err := l.Queries.ListRitualPoolSlotsForResolution(ctx, tx, &database.ListRitualPoolSlotsForResolutionParams{
		OrganizationID:     orgID,
		ScheduledDateFloor: pgtype.Date{Time: floor, Valid: true},
		SlotLimit:          ritualShiftResolutionSlotLimit,
	})
	if err != nil {
		return counts, fmt.Errorf("failed to list ritual pool slots for resolution: %w", err)
	}

	for _, slot := range slots {
		counts.SlotsExamined++

		if slotErr := l.resolveOnePoolSlot(ctx, tx, orgID, slot, now, &counts); slotErr != nil {
			slog.ErrorContext(ctx, "ritual shift resolution: slot failed",
				"error", slotErr,
				"orgID", orgID,
				"taskID", slot.TaskID,
				"poolID", slot.PoolID,
			)
			continue
		}
	}

	escalated, err := l.escalateUnresolvedRitualPoolSlots(ctx, tx, orgID, now)
	if err != nil {
		return counts, err
	}
	counts.SlotsEscalated = escalated

	return counts, nil
}

// resolveOnePoolSlot applies the whole decision tree to a single (instance, pool) slot.
func (l *logicImpl) resolveOnePoolSlot(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	slot *database.ListRitualPoolSlotsForResolutionRow,
	now time.Time,
	counts *RitualShiftResolutionCounts,
) error {
	// A pool that has moved to another strategy still owns any slot row this feature
	// left behind. Hand the slot over under the pool's current strategy, then remove the
	// row: it has nothing left to describe.
	if slot.AssignmentStrategy != AssignmentStrategyOnShift {
		return l.handOverPoolSlot(ctx, tx, orgID, slot, now)
	}

	loc := loadTimezone(slot.Timezone)
	dayStart, dayEnd := ritualDayBounds(slot.ScheduledDate.Time, loc)

	// The freeze rules. An instance whose date has arrived, or that somebody has already
	// started evidencing, is nobody's to move any more — the escalation pass is what
	// finishes the story for those.
	if !now.Before(dayStart) {
		return nil
	}
	if slot.HasEvidence {
		return nil
	}

	// A pool that has just switched TO on_shift has instances with no slot row at all.
	// Adopt them, then treat them exactly like a slot that was created awaiting.
	assignmentID := slot.AssignmentID
	state := slot.ResolutionState.String
	if !assignmentID.Valid {
		adopted, err := l.Queries.UpsertRitualPoolAssignment(ctx, tx, &database.UpsertRitualPoolAssignmentParams{
			OrganizationID:  orgID,
			TaskID:          slot.TaskID,
			PoolID:          slot.PoolID,
			ResolutionState: PoolAssignmentStateAwaitingShift,
			ResolveBy:       pgtype.Timestamptz{Time: dayStart, Valid: true},
			UpdatedAt:       pgtype.Timestamptz{Time: now, Valid: true},
		})
		if err != nil {
			// A concurrent pass adopted it first. Nothing to do: that pass owns it.
			if errors.Is(err, pgx.ErrNoRows) {
				return nil
			}
			return fmt.Errorf("adopt pool slot: %w", err)
		}
		assignmentID = dbuuid.UUIDToNullUUID(adopted.ID)
		state = PoolAssignmentStateAwaitingShift
	}

	if state == PoolAssignmentStateResolved {
		return l.rebindResolvedPoolSlot(ctx, tx, orgID, slot, dbuuid.UUID(assignmentID.UUID), dayStart, dayEnd, now, counts)
	}

	// Awaiting: bind as soon as somebody covers the date.
	empID, resolved := l.resolveOnShiftAssignee(ctx, tx, orgID, slot.DepartmentID, dayStart, dayEnd, now)
	if !resolved {
		return nil
	}

	if _, err := l.assignTaskSilent(ctx, tx, orgID, slot.CreatedByEmployeeID, slot.TaskID, empID, TaskAssigneeRoleAssignee); err != nil {
		return fmt.Errorf("assign rostered employee: %w", err)
	}

	if _, err := l.Queries.ResolveRitualPoolAssignment(ctx, tx, &database.ResolveRitualPoolAssignmentParams{
		OrganizationID:     orgID,
		ID:                 dbuuid.UUID(assignmentID.UUID),
		ExpectedState:      PoolAssignmentStateAwaitingShift,
		AssignedEmployeeID: dbuuid.UUIDToNullUUID(empID),
		Now:                pgtype.Timestamptz{Time: now, Valid: true},
	}); err != nil {
		// Another pass got there first. Its notification is the one that counts.
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return fmt.Errorf("record resolved pool slot: %w", err)
	}

	counts.SlotsAssigned++
	l.notifyRitualSlotParty(ctx, tx, orgID, slot, empID, dbuuid.NullUUID{})
	return nil
}

// rebindResolvedPoolSlot re-runs the resolver for a slot that already holds an assignee
// and applies whatever the rota now says.
func (l *logicImpl) rebindResolvedPoolSlot(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	slot *database.ListRitualPoolSlotsForResolutionRow,
	assignmentID dbuuid.UUID,
	dayStart, dayEnd time.Time,
	now time.Time,
	counts *RitualShiftResolutionCounts,
) error {
	if !slot.AssignedEmployeeID.Valid {
		// The CHECK constraint forbids this. Treat it as data this pass should not touch.
		return nil
	}
	current := dbuuid.UUID(slot.AssignedEmployeeID.UUID)

	// The manual-override freeze. If the employee this feature put in the slot is no
	// longer assigned, a person changed it, and closed_unresolved is terminal so the next
	// pass cannot undo their decision.
	stillAssigned, err := l.Queries.TaskAssigneeExists(ctx, tx, &database.TaskAssigneeExistsParams{
		OrganizationID: orgID,
		TaskID:         slot.TaskID,
		EmployeeID:     current,
	})
	if err != nil {
		return fmt.Errorf("check manual override: %w", err)
	}
	if !stillAssigned {
		if _, err := l.Queries.CloseRitualPoolAssignment(ctx, tx, &database.CloseRitualPoolAssignmentParams{
			OrganizationID: orgID,
			ID:             assignmentID,
			ExpectedState:  PoolAssignmentStateResolved,
			ClosedReason:   pgtype.Text{String: PoolAssignmentClosedReasonManualOverride, Valid: true},
			Now:            pgtype.Timestamptz{Time: now, Valid: true},
		}); err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("close manually overridden pool slot: %w", err)
		}
		// No notification: a person made this change and already knows about it.
		return nil
	}

	candidates, covered := l.onShiftCandidates(ctx, tx, orgID, slot.DepartmentID, dayStart, dayEnd)

	// The overwhelmingly common case: whoever holds the slot is still rostered for the
	// date. No write, no notification.
	//
	// The test is "is the current holder still covered", NOT "would the resolver pick
	// them again". Re-picking on every pass would move the checklist to whoever is
	// currently least loaded every two minutes, which is churn dressed up as fairness —
	// and it would defeat the swap notifications by sending them constantly.
	if covered {
		for _, c := range candidates {
			if c == current {
				return nil
			}
		}
	}

	if !covered {
		// Nobody covers the date any more. Withdraw and go back to waiting rather than
		// leaving work with somebody who is off.
		if _, err := l.Queries.WithdrawRitualPoolAssignment(ctx, tx, &database.WithdrawRitualPoolAssignmentParams{
			OrganizationID: orgID,
			ID:             assignmentID,
			Now:            pgtype.Timestamptz{Time: now, Valid: true},
		}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil
			}
			return fmt.Errorf("withdraw pool slot: %w", err)
		}
		if err := l.UnassignTask(ctx, tx, orgID, slot.TaskID, current, TaskAssigneeRoleAssignee); err != nil {
			slog.WarnContext(ctx, "ritual shift resolution: failed to unassign withdrawn slot",
				"error", err, "taskID", slot.TaskID, "employeeID", current)
		}
		counts.SlotsWithdrawn++
		l.notifyRitualSlotParty(ctx, tx, orgID, slot, dbuuid.UUID{}, dbuuid.UUIDToNullUUID(current))
		return nil
	}

	// A swap: the holder is off and somebody else covers the date now.
	winner, picked := l.pickLeastAssignedCandidate(ctx, tx, orgID, candidates, now)
	if !picked {
		return nil
	}

	if _, err := l.Queries.ResolveRitualPoolAssignment(ctx, tx, &database.ResolveRitualPoolAssignmentParams{
		OrganizationID:     orgID,
		ID:                 assignmentID,
		ExpectedState:      PoolAssignmentStateResolved,
		AssignedEmployeeID: dbuuid.UUIDToNullUUID(winner),
		Now:                pgtype.Timestamptz{Time: now, Valid: true},
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return fmt.Errorf("rebind pool slot: %w", err)
	}

	if _, err := l.assignTaskSilent(ctx, tx, orgID, slot.CreatedByEmployeeID, slot.TaskID, winner, TaskAssigneeRoleAssignee); err != nil {
		return fmt.Errorf("assign swapped-in employee: %w", err)
	}
	if err := l.UnassignTask(ctx, tx, orgID, slot.TaskID, current, TaskAssigneeRoleAssignee); err != nil {
		slog.WarnContext(ctx, "ritual shift resolution: failed to unassign swapped-out employee",
			"error", err, "taskID", slot.TaskID, "employeeID", current)
	}

	counts.SlotsReassigned++
	l.notifyRitualSlotParty(ctx, tx, orgID, slot, winner, dbuuid.UUIDToNullUUID(current))
	return nil
}

// handOverPoolSlot deals with a pool that is no longer on-shift. A slot still waiting is
// assigned under the pool's current strategy first, so switching away does not strand the
// instance unassigned; then the row is deleted.
func (l *logicImpl) handOverPoolSlot(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	slot *database.ListRitualPoolSlotsForResolutionRow,
	now time.Time,
) error {
	if !slot.AssignmentID.Valid {
		return nil
	}

	if slot.ResolutionState.String == PoolAssignmentStateAwaitingShift {
		if empID, ok := l.assignUnderPoolStrategy(ctx, tx, orgID, slot, now); ok {
			if _, err := l.assignTaskSilent(ctx, tx, orgID, slot.CreatedByEmployeeID, slot.TaskID, empID, TaskAssigneeRoleAssignee); err != nil {
				return fmt.Errorf("assign under the pool's new strategy: %w", err)
			}
			if err := l.Queries.UpdateDepartmentPoolLastAssigned(ctx, tx, &database.UpdateDepartmentPoolLastAssignedParams{
				OrganizationID:         orgID,
				ID:                     slot.PoolID,
				LastAssignedEmployeeID: dbuuid.UUIDToNullUUID(empID),
				UpdatedAt:              pgtype.Timestamptz{Time: now, Valid: true},
			}); err != nil {
				slog.WarnContext(ctx, "ritual shift resolution: failed to advance the pool waterline on handover",
					"error", err, "poolID", slot.PoolID)
			}
		}
	}

	return l.Queries.DeleteRitualPoolAssignment(ctx, tx, &database.DeleteRitualPoolAssignmentParams{
		OrganizationID: orgID,
		ID:             dbuuid.UUID(slot.AssignmentID.UUID),
	})
}

// assignUnderPoolStrategy picks an assignee the way generation would for a round-robin or
// least-assigned pool. Used only on the handover path.
func (l *logicImpl) assignUnderPoolStrategy(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	slot *database.ListRitualPoolSlotsForResolutionRow,
	now time.Time,
) (dbuuid.UUID, bool) {
	switch slot.AssignmentStrategy {
	case AssignmentStrategyRoundRobin:
		members, err := l.Queries.ListActiveDepartmentMembers(ctx, tx, &database.ListActiveDepartmentMembersParams{
			OrganizationID: orgID,
			DepartmentID:   slot.DepartmentID,
		})
		if err != nil || len(members) == 0 {
			return dbuuid.UUID{}, false
		}
		next := 0
		if slot.LastAssignedEmployeeID.Valid {
			last := dbuuid.UUID(slot.LastAssignedEmployeeID.UUID)
			for i, m := range members {
				if m == last {
					next = (i + 1) % len(members)
					break
				}
			}
		}
		return members[next], true

	case AssignmentStrategyLeastAssigned:
		empID, err := l.Queries.GetLeastAssignedDepartmentEmployee(ctx, tx, &database.GetLeastAssignedDepartmentEmployeeParams{
			OrganizationID: orgID,
			DepartmentID:   slot.DepartmentID,
			Since:          pgtype.Timestamptz{Time: now.AddDate(0, 0, -ritualAssignmentLookbackDays), Valid: true},
		})
		if err != nil {
			return dbuuid.UUID{}, false
		}
		return empID, true
	}

	return dbuuid.UUID{}, false
}

// escalateUnresolvedRitualPoolSlots closes every slot whose scheduled date has arrived
// with nobody rostered and alerts the project's owners and admins.
//
// The alert is published if and only if the compare-and-set reported a changed row, which
// is what makes two overlapping passes alert once. The backfill horizon suppresses the
// alert — never the state change — for dates far enough in the past that alerting on them
// would be the first deployment shouting about history.
func (l *logicImpl) escalateUnresolvedRitualPoolSlots(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	now time.Time,
) (int, error) {
	due, err := l.Queries.ListRitualPoolAssignmentsDueEscalation(ctx, tx, &database.ListRitualPoolAssignmentsDueEscalationParams{
		OrganizationID: orgID,
		Now:            pgtype.Timestamptz{Time: now, Valid: true},
		SlotLimit:      ritualShiftResolutionSlotLimit,
	})
	if err != nil {
		return 0, fmt.Errorf("failed to list ritual pool slots due escalation: %w", err)
	}

	escalated := 0
	for _, row := range due {
		alert := now.Sub(row.ResolveBy.Time) <= ritualShiftEscalationBackfillHorizon

		escalatedAt := pgtype.Timestamptz{}
		if alert {
			escalatedAt = pgtype.Timestamptz{Time: now, Valid: true}
		}

		if _, err := l.Queries.CloseRitualPoolAssignment(ctx, tx, &database.CloseRitualPoolAssignmentParams{
			OrganizationID: orgID,
			ID:             row.ID,
			ExpectedState:  PoolAssignmentStateAwaitingShift,
			ClosedReason:   pgtype.Text{String: PoolAssignmentClosedReasonNoRoster, Valid: true},
			EscalatedAt:    escalatedAt,
			Now:            pgtype.Timestamptz{Time: now, Valid: true},
		}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				continue
			}
			slog.ErrorContext(ctx, "ritual shift resolution: failed to close an unresolved slot",
				"error", err, "orgID", orgID, "taskID", row.TaskID)
			continue
		}

		escalated++
		if !alert {
			continue
		}

		task, err := l.Queries.GetTask(ctx, tx, &database.GetTaskParams{OrganizationID: orgID, ID: row.TaskID})
		if err != nil {
			slog.WarnContext(ctx, "ritual shift resolution: failed to load the task for an unassigned alert",
				"error", err, "taskID", row.TaskID)
			continue
		}
		l.notifyRitualInstanceUnassigned(ctx, tx, orgID, task, ritualNameOrFallback(row.RitualName))
	}

	return escalated, nil
}

// notifyRitualSlotParty tells whoever the resolution actually affected. Both notifications
// need the task row, so it is loaded once here rather than by each caller.
func (l *logicImpl) notifyRitualSlotParty(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	slot *database.ListRitualPoolSlotsForResolutionRow,
	newAssignee dbuuid.UUID,
	previousAssignee dbuuid.NullUUID,
) {
	if l.NotificationPublisher == nil {
		return
	}

	task, err := l.Queries.GetTask(ctx, tx, &database.GetTaskParams{OrganizationID: orgID, ID: slot.TaskID})
	if err != nil {
		slog.WarnContext(ctx, "ritual shift resolution: failed to load the task for a slot notification",
			"error", err, "taskID", slot.TaskID)
		return
	}

	if previousAssignee.Valid {
		l.notifyRitualSlotWithdrawn(ctx, tx, orgID, task, dbuuid.UUID(previousAssignee.UUID), slot.RitualName)
	}
	if newAssignee != (dbuuid.UUID{}) {
		l.notifyRitualSlotAssigned(ctx, tx, orgID, task, newAssignee, slot.RitualName)
	}
}

// ritualNameOrFallback keeps a notification body readable when the definition behind an
// instance has been removed: the instance outlives it and must still escalate.
func ritualNameOrFallback(name pgtype.Text) string {
	if name.Valid && name.String != "" {
		return name.String
	}
	return "This ritual"
}

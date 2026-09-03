package calendar

import (
	"context"
	"fmt"
	"sort"
	"time"

	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
)

// maxShiftDuration bounds how far before the requested interval a shift may start and
// still cover it. It exists only to widen the recurring-series prefilter, whose
// recurrence_end column stores the last occurrence's *start*: without the widening, a
// series whose final occurrence begins at 22:00 on Friday would be filtered out of a
// query for Saturday even though it runs until 06:00. Exactness is restored in Go by the
// overlap test, so this constant can only ever cost an extra row, never a wrong answer.
//
// ponytail: a shift longer than a day is not a shift. Raise this if one ever is.
const maxShiftDuration = 24 * time.Hour

// EmployeesOnShift reports which of candidateEmployeeIDs has a shift covering the
// half-open interval [dayStart, dayEnd).
//
// It implements collaboration.ShiftCoverageReader. The caller has already resolved the
// interval from the ritual definition's timezone and has already applied department
// membership, so this method narrows the candidate list and never widens it.
//
// Coverage means a non-cancelled event of type `shift` whose span overlaps the interval,
// with the employee as an attendee who has not declined. A concrete event answers
// directly; a recurring series is expanded with the RRULE helpers in recurrence.go and
// its stored exceptions applied, so a skipped or cancelled occurrence covers nobody and a
// moved occurrence counts on its new date only — its replacement is a concrete event that
// the direct query already returns.
//
// The result is deduplicated and sorted ascending so a caller's tiebreak over it is
// reproducible. The method is read-only: it never creates, modifies or deletes an event.
func (l *logicImpl) EmployeesOnShift(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	candidateEmployeeIDs []dbuuid.UUID,
	dayStart, dayEnd time.Time,
) ([]dbuuid.UUID, error) {
	// No candidates, no query. An empty department is a common state, not an error.
	if len(candidateEmployeeIDs) == 0 {
		return []dbuuid.UUID{}, nil
	}

	covered := make(map[dbuuid.UUID]struct{}, len(candidateEmployeeIDs))

	direct, err := l.queries.ListShiftCoverageDirect(ctx, tx, &database.ListShiftCoverageDirectParams{
		OrganizationID: orgID,
		RangeStart:     toPgTimestamptz(dayStart),
		RangeEnd:       toPgTimestamptz(dayEnd),
		CandidateIds:   candidateEmployeeIDs,
	})
	if err != nil {
		return nil, fmt.Errorf("list direct shift coverage: %w", err)
	}
	for _, empID := range direct {
		covered[empID] = struct{}{}
	}

	seriesRows, err := l.queries.ListShiftCoverageSeries(ctx, tx, &database.ListShiftCoverageSeriesParams{
		OrganizationID: orgID,
		RangeStart:     toPgTimestamptz(dayStart.Add(-maxShiftDuration)),
		RangeEnd:       toPgTimestamptz(dayEnd),
		CandidateIds:   candidateEmployeeIDs,
	})
	if err != nil {
		return nil, fmt.Errorf("list recurring shift coverage: %w", err)
	}

	if len(seriesRows) > 0 {
		if err := l.markRecurringShiftCoverage(ctx, tx, orgID, seriesRows, dayStart, dayEnd, covered); err != nil {
			return nil, err
		}
	}

	out := make([]dbuuid.UUID, 0, len(covered))
	for empID := range covered {
		out = append(out, empID)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].String() < out[j].String() })
	return out, nil
}

// markRecurringShiftCoverage expands each recurring shift series that could reach the
// interval and marks its non-declined candidate attendees as covered when one of its
// occurrences actually overlaps.
func (l *logicImpl) markRecurringShiftCoverage(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	rows []*database.ListShiftCoverageSeriesRow,
	dayStart, dayEnd time.Time,
	covered map[dbuuid.UUID]struct{},
) error {
	// One row per (series head, attendee). Collapse to one head with its attendees.
	type seriesHead struct {
		row       *database.ListShiftCoverageSeriesRow
		attendees []dbuuid.UUID
	}
	heads := make(map[dbuuid.UUID]*seriesHead, len(rows))
	order := make([]dbuuid.UUID, 0, len(rows))
	for _, r := range rows {
		h, ok := heads[r.ID]
		if !ok {
			h = &seriesHead{row: r}
			heads[r.ID] = h
			order = append(order, r.ID)
		}
		h.attendees = append(h.attendees, r.EmployeeID)
	}

	// The exception rows are keyed by the series head's own id, which is what
	// InsertRecurrenceException stores as series_id.
	exceptionRows, err := l.queries.ListRecurrenceExceptionsForSeries(ctx, tx, &database.ListRecurrenceExceptionsForSeriesParams{
		OrganizationID: orgID,
		SeriesIds:      order,
	})
	if err != nil {
		return fmt.Errorf("list recurrence exceptions for shift series: %w", err)
	}
	exceptions := make(map[dbuuid.UUID]map[time.Time]exceptionInfo, len(order))
	for _, e := range exceptionRows {
		byTime, ok := exceptions[e.SeriesID]
		if !ok {
			byTime = map[time.Time]exceptionInfo{}
			exceptions[e.SeriesID] = byTime
		}
		byTime[e.OriginalStartTime.Time.UTC()] = exceptionInfo{Type: e.ExceptionType}
	}

	for _, headID := range order {
		h := heads[headID]
		duration := h.row.EndTime.Time.Sub(h.row.StartTime.Time)
		if duration <= 0 {
			// Defensive: chk_event_end_after_start allows end == start for all-day rows.
			duration = time.Nanosecond
		}

		// Widen the expansion window backwards by the series' own duration so an
		// occurrence that starts before dayStart but ends inside the interval — the
		// overnight shift — is not missed.
		occurrences, err := expandInstances(
			h.row.RecurrenceRule.String,
			h.row.StartTime.Time,
			dayStart.Add(-duration),
			dayEnd,
		)
		if err != nil {
			// A malformed RRULE covers nobody rather than failing the whole read: the
			// other series in this pass are still answerable.
			continue
		}
		occurrences = applyExceptions(occurrences, exceptions[headID])

		for _, occStart := range occurrences {
			if occStart.Before(dayEnd) && occStart.Add(duration).After(dayStart) {
				for _, empID := range h.attendees {
					covered[empID] = struct{}{}
				}
				break
			}
		}
	}

	return nil
}

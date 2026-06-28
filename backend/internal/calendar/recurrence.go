package calendar

import (
	"fmt"
	"time"

	"github.com/teambition/rrule-go"
)

// expandInstances parses an RFC 5545 RRULE string and returns all occurrence
// start times within the [from, to) window. dtstart is the series head's
// original start_time.
func expandInstances(rule string, dtstart time.Time, from, to time.Time) ([]time.Time, error) {
	opt, err := rrule.StrToROption(rule)
	if err != nil {
		return nil, fmt.Errorf("parse RRULE: %w", err)
	}
	opt.Dtstart = dtstart.UTC()

	r, err := rrule.NewRRule(*opt)
	if err != nil {
		return nil, fmt.Errorf("create RRULE: %w", err)
	}

	instances := r.Between(from.UTC(), to.UTC(), true)
	return instances, nil
}

// applyExceptions filters expanded instances by removing skipped/cancelled
// dates and replacing modified dates with their new start time.
// Returns the filtered list of instance start times.
//
// exceptionMap: original_start_time → exceptionInfo
func applyExceptions(instances []time.Time, exceptions map[time.Time]exceptionInfo) []time.Time {
	if len(exceptions) == 0 {
		return instances
	}

	result := make([]time.Time, 0, len(instances))
	for _, inst := range instances {
		exc, ok := exceptions[inst.UTC()]
		if !ok {
			result = append(result, inst)
			continue
		}
		switch exc.Type {
		case ExceptionTypeSkipped, ExceptionTypeCancelled:
			// Omit this instance.
			continue
		case ExceptionTypeModified:
			// The exception event replaces this instance — omit the original
			// so the exception event (queried separately) appears instead.
			continue
		default:
			result = append(result, inst)
		}
	}
	return result
}

// exceptionInfo holds the minimal info needed by applyExceptions.
type exceptionInfo struct {
	Type       string    // ExceptionTypeModified | ExceptionTypeSkipped | ExceptionTypeCancelled
	NewStartAt time.Time // Only meaningful for ExceptionTypeModified
}

// computeRecurrenceEnd calculates the final occurrence of an RRULE so it can
// be stored in calendar.event.recurrence_end for efficient range queries.
// Returns nil when the rule repeats forever (no UNTIL or COUNT).
func computeRecurrenceEnd(rule string, dtstart time.Time) *time.Time {
	opt, err := rrule.StrToROption(rule)
	if err != nil {
		return nil
	}
	opt.Dtstart = dtstart.UTC()

	r, err := rrule.NewRRule(*opt)
	if err != nil {
		return nil
	}

	// If no bounding, rule repeats forever.
	if opt.Until.IsZero() && opt.Count == 0 {
		return nil
	}

	// Get all instances and take the last one.
	all := r.All()
	if len(all) == 0 {
		return nil
	}
	last := all[len(all)-1].UTC()
	return &last
}

// truncateRRULE modifies an RRULE so that it ends before a given cutoff date.
// Used when forking a recurring series with "this and following": the original
// series head gets its RRULE truncated to end before the fork point.
//
// Returns the updated RRULE string with an UNTIL clause.
func truncateRRULE(rule string, dtstart time.Time, beforeDate time.Time) (string, error) {
	opt, err := rrule.StrToROption(rule)
	if err != nil {
		return "", fmt.Errorf("parse RRULE for truncation: %w", err)
	}
	opt.Dtstart = dtstart.UTC()

	// Set UNTIL to 1 second before the fork point.
	newUntil := beforeDate.Add(-1 * time.Second).UTC()

	// Remove COUNT if present; UNTIL takes precedence.
	opt.Count = 0
	opt.Until = newUntil

	r, err := rrule.NewRRule(*opt)
	if err != nil {
		return "", fmt.Errorf("create truncated RRULE: %w", err)
	}
	return r.OrigOptions.RRuleString(), nil
}

// remainingRRULE builds a new RRULE string for the "this and following" fork.
// It computes how many instances remain from the split point to the end of the
// original series, or preserves UNTIL if the original used it.
func remainingRRULE(rule string, oldDtstart time.Time, splitFrom time.Time) (string, error) {
	opt, err := rrule.StrToROption(rule)
	if err != nil {
		return "", fmt.Errorf("parse RRULE for remaining: %w", err)
	}
	opt.Dtstart = oldDtstart.UTC()

	if opt.Count > 0 {
		// Compute how many instances occur before splitFrom.
		r, rErr := rrule.NewRRule(*opt)
		if rErr != nil {
			return "", fmt.Errorf("create RRULE for count: %w", rErr)
		}
		before := r.Between(oldDtstart.UTC(), splitFrom.UTC(), false)
		remaining := opt.Count - len(before)
		if remaining <= 0 {
			remaining = 1
		}
		opt.Count = remaining
	}
	// If UNTIL is used, keep it as-is (the new series starts later but ends at the same UNTIL).

	// Reset dtstart to the new split point — rrule-go uses Dtstart internally.
	opt.Dtstart = splitFrom.UTC()

	r, err := rrule.NewRRule(*opt)
	if err != nil {
		return "", fmt.Errorf("create remaining RRULE: %w", err)
	}
	return r.OrigOptions.RRuleString(), nil
}

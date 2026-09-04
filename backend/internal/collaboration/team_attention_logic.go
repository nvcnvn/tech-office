package collaboration

import (
	"context"
	"fmt"
	"time"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// Bounds for the supervisor's Team block.
//
// The limits are the ones the neighbouring surfaces already use —
// defaultAssignedWorkSummaryLimit / maxAssignedWorkSummaryLimit in context_rail_logic.go
// and reviewQueueCountCap in evidence_review_queue_logic.go — so the block behaves like its
// neighbours and needs no tuning story of its own.
//
// The count cap is applied inside SQL, so a workspace with a 5 000-instance backlog costs
// the same to summarise as a healthy one. A ceiling of 20 rows per category does not need
// cursor pagination; "show more" is a refetch with a larger limit.
const (
	defaultTeamAttentionLimit = 5
	maxTeamAttentionLimit     = 20
	teamAttentionCountCap     = 100
)

// teamAttentionDateLayout is the wire format of `as_of_date`. ISO only: a caller who
// believes they asked about one day must not be answered about another.
const teamAttentionDateLayout = "2006-01-02"

// clampTeamAttentionLimit turns the request's optional limit into a bound the query can
// take. An absent, zero or negative limit is the default; an over-large one is clamped
// rather than rejected, because asking for too much is not a client error the supervisor
// can act on.
func clampTeamAttentionLimit(requested int32) int32 {
	if requested <= 0 {
		return defaultTeamAttentionLimit
	}
	if requested > maxTeamAttentionLimit {
		return maxTeamAttentionLimit
	}
	return requested
}

// parseAsOfDate resolves the date the unassigned category is scoped to.
//
// Absent or empty means the server's current date, so a caller that omits it still gets a
// sane answer. A present-but-unparseable value is InvalidArgument with a BadRequest field
// violation naming `as_of_date` (Principle X) rather than a silent fallback.
func parseAsOfDate(raw string, now time.Time) (pgtype.Date, error) {
	if raw == "" {
		return pgtype.Date{Time: now.Truncate(24 * time.Hour), Valid: true}, nil
	}
	parsed, err := time.Parse(teamAttentionDateLayout, raw)
	if err != nil {
		return pgtype.Date{}, fieldViolation(
			connect.CodeInvalidArgument,
			err,
			"as_of_date",
			"as_of_date must be an ISO date, YYYY-MM-DD",
		)
	}
	return pgtype.Date{Time: parsed, Valid: true}, nil
}

// GetTeamAttentionSummary answers "is the store OK" for one supervisor: which ritual
// instances across every project they own or administer are overdue, and which are
// scheduled for `as_of_date` with nobody on them.
//
// The `collab.reviewEvidence` check lives at the Connect layer, which returns an empty
// summary rather than an error when it is absent; by the time this runs the caller holds
// it, so `can_supervise` here is purely about scope.
func (l *logicImpl) GetTeamAttentionSummary(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID dbuuid.UUID,
	req *rpcv1.GetTeamAttentionSummaryRequest,
) (*rpcv1.GetTeamAttentionSummaryResponse, error) {
	asOfDate, err := parseAsOfDate(req.GetAsOfDate(), time.Now())
	if err != nil {
		return nil, err
	}

	counts, err := l.Queries.CountTeamAttention(ctx, tx, &database.CountTeamAttentionParams{
		OrganizationID:   orgID,
		CallerEmployeeID: employeeID,
		CountCap:         teamAttentionCountCap,
		AsOfDate:         asOfDate,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to count team attention: %w", err)
	}

	// No supervisory scope means the block renders nothing at all, so there is nothing to
	// list and no reason to pay for the item query.
	if counts.SupervisedProjectCount == 0 {
		return &rpcv1.GetTeamAttentionSummaryResponse{}, nil
	}

	rows, err := l.Queries.ListTeamAttentionItems(ctx, tx, &database.ListTeamAttentionItemsParams{
		OrganizationID:   orgID,
		CallerEmployeeID: employeeID,
		ItemLimit:        clampTeamAttentionLimit(req.GetLimit()),
		AsOfDate:         asOfDate,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list team attention items: %w", err)
	}

	items, err := l.resolveTeamAttentionItems(ctx, tx, orgID, rows)
	if err != nil {
		return nil, err
	}

	return &rpcv1.GetTeamAttentionSummaryResponse{
		CanSupervise:           true,
		SupervisedProjectCount: counts.SupervisedProjectCount,
		OverdueCount:           counts.OverdueCount,
		UnassignedCount:        counts.UnassignedCount,
		Items:                  items,
	}, nil
}

// resolveTeamAttentionItems turns query rows into wire items, naming each row's assignee.
//
// Exactly one batched lookup for the whole response — never a per-row call and never a
// cross-schema SQL join (Constitution IV). An id that does not resolve leaves the name
// absent and KEEPS the row: a departed or archived assignee is precisely the situation the
// supervisor needs to see, and `additional_assignee_count` alongside an absent name is what
// tells the client "somebody is on it and we could not name them" rather than "nobody is".
// A nil lookup — the seeder, and tests that wire no organization logic — behaves the same
// way.
func (l *logicImpl) resolveTeamAttentionItems(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	rows []*database.ListTeamAttentionItemsRow,
) ([]*rpcv1.TeamAttentionItem, error) {
	names := map[dbuuid.UUID]string{}
	if l.employeeNames != nil {
		ids := make([]dbuuid.UUID, 0, len(rows))
		for _, row := range rows {
			if row.AssigneeCount > 0 {
				ids = append(ids, row.PrimaryAssigneeID)
			}
		}
		resolved, err := l.employeeNames.ListEmployeeNames(ctx, tx, orgID, ids)
		if err != nil {
			return nil, fmt.Errorf("failed to resolve team attention assignee names: %w", err)
		}
		names = resolved
	}

	items := make([]*rpcv1.TeamAttentionItem, 0, len(rows))
	for _, row := range rows {
		item := &rpcv1.TeamAttentionItem{
			TaskId:      row.TaskID.String(),
			ProjectId:   row.ProjectID.String(),
			ProjectName: row.ProjectName,
			Title:       row.Title,
			Category:    teamAttentionCategory(row.AttentionRank),
		}
		if row.SortDate.Valid {
			due := row.SortDate.Time.Format(teamAttentionDateLayout)
			item.DueDate = &due
		}
		if row.AssigneeCount > 0 {
			if name, ok := names[row.PrimaryAssigneeID]; ok && name != "" {
				item.AssigneeDisplayName = &name
			}
			item.AdditionalAssigneeCount = row.AssigneeCount - 1
		}
		items = append(items, item)
	}
	return items, nil
}

// teamAttentionCategory derives the wire enum from the query's rank column. The rank is
// the ordering authority; deriving the enum from it is what stops the two disagreeing.
func teamAttentionCategory(rank int32) rpcv1.TeamAttentionCategory {
	if rank == 0 {
		return rpcv1.TeamAttentionCategory_TEAM_ATTENTION_CATEGORY_OVERDUE
	}
	return rpcv1.TeamAttentionCategory_TEAM_ATTENTION_CATEGORY_UNASSIGNED
}

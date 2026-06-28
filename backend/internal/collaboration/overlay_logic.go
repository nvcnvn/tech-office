package collaboration

import (
	"context"
	"fmt"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// GetTasksDueInRange returns tasks with due dates in [from, to) as overlay items.
// Used by the calendar service for overlay rendering.
func (l *logicImpl) GetTasksDueInRange(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	from, to time.Time,
) ([]*rpcv1.OverlayItem, error) {
	const q = `
SELECT t.id, t.title, t.due_date, ps.name AS state_name, p.key AS project_identifier
FROM collaboration.task t
JOIN collaboration.project_state ps ON ps.organization_id = t.organization_id AND ps.id = t.state_id
JOIN collaboration.project p ON p.organization_id = t.organization_id AND p.id = t.project_id
WHERE t.organization_id = $1
  AND t.due_date >= $2::date
  AND t.due_date < $3::date
  AND t.is_deleted = FALSE
  AND t.task_kind = 'standard'
ORDER BY t.due_date
`
	rows, err := tx.Query(ctx, q, orgID, from, to)
	if err != nil {
		return nil, fmt.Errorf("query tasks due in range: %w", err)
	}
	defer rows.Close()

	var items []*rpcv1.OverlayItem
	for rows.Next() {
		var (
			id        dbuuid.UUID
			title     string
			dueDate   time.Time
			stateName string
			projectID string
		)
		if err := rows.Scan(&id, &title, &dueDate, &stateName, &projectID); err != nil {
			return nil, fmt.Errorf("scan task overlay row: %w", err)
		}
		items = append(items, &rpcv1.OverlayItem{
			SourceId:     id.String(),
			SourceDomain: "task",
			Title:        title,
			DueAt:        timestamppb.New(dueDate),
			Status:       stateName,
			UrlPath:      fmt.Sprintf("/workspace/projects/%s/tasks/%s", projectID, id.String()),
		})
	}
	return items, rows.Err()
}

// GetRitualInstancesInRange returns ritual instances in [from, to) as overlay items.
// Used by the calendar service for overlay rendering.
func (l *logicImpl) GetRitualInstancesInRange(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	from, to time.Time,
) ([]*rpcv1.OverlayItem, error) {
	const q = `
SELECT t.id, t.title, t.scheduled_date, ps.name AS state_name, rd.name AS ritual_title
FROM collaboration.task t
JOIN collaboration.project_state ps ON ps.organization_id = t.organization_id AND ps.id = t.state_id
JOIN collaboration.ritual_definition rd ON rd.organization_id = t.organization_id AND rd.id = t.ritual_definition_id
WHERE t.organization_id = $1
  AND t.scheduled_date >= $2::date
  AND t.scheduled_date < $3::date
  AND t.is_deleted = FALSE
  AND t.task_kind = 'ritual_instance'
  AND t.detached_from_ritual = FALSE
ORDER BY t.scheduled_date
`
	rows, err := tx.Query(ctx, q, orgID, from, to)
	if err != nil {
		return nil, fmt.Errorf("query ritual instances in range: %w", err)
	}
	defer rows.Close()

	var items []*rpcv1.OverlayItem
	for rows.Next() {
		var (
			id            dbuuid.UUID
			title         string
			scheduledDate time.Time
			stateName     string
			ritualTitle   string
		)
		if err := rows.Scan(&id, &title, &scheduledDate, &stateName, &ritualTitle); err != nil {
			return nil, fmt.Errorf("scan ritual overlay row: %w", err)
		}
		items = append(items, &rpcv1.OverlayItem{
			SourceId:     id.String(),
			SourceDomain: "ritual",
			Title:        fmt.Sprintf("[%s] %s", ritualTitle, title),
			DueAt:        timestamppb.New(scheduledDate),
			Status:       stateName,
			UrlPath:      fmt.Sprintf("/workspace/rituals/%s", id.String()),
		})
	}
	return items, rows.Err()
}

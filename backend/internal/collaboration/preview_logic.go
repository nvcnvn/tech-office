package collaboration

import (
	"context"
	"log/slog"

	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/internal/linking"
)

// EmployeeNameLookup resolves employee display names for the assignee line of a task card.
//
// It is declared here rather than imported from internal/organization because
// organization already imports collaboration for default project creation; declaring the
// interface on the consumer side is the repository's existing way out of that cycle
// (compare organization.CollaborationLogic).
type EmployeeNameLookup interface {
	ListEmployeeNames(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, ids []dbuuid.UUID) (map[dbuuid.UUID]string, error)
}

// ---------------------------------------------------------------------------
// Task
// ---------------------------------------------------------------------------

type taskPreviewProvider struct {
	queries       *database.Queries
	employeeNames EmployeeNameLookup
}

// NewTaskPreviewProvider builds the task card: title, identifier, current state and the
// assignee. Everything comes from the task's own rows, scoped to the reader by the same
// project-access predicate ListTasksBySourceMessages uses.
func NewTaskPreviewProvider(queries *database.Queries, employeeNames EmployeeNameLookup) linking.PreviewProvider {
	return &taskPreviewProvider{queries: queries, employeeNames: employeeNames}
}

func (p *taskPreviewProvider) Handles(resourceType linking.ResourceType) bool {
	return resourceType == linking.ResourceTypeTaskInstance
}

func (p *taskPreviewProvider) Preview(
	ctx context.Context,
	tx database.DBTX,
	reader linking.PreviewReader,
	targets []linking.PreviewTarget,
) (map[string]*linking.LinkPreviewMetadata, error) {
	ids, byID := previewTargetIDs(targets)
	results := make(map[string]*linking.LinkPreviewMetadata, len(targets))
	if len(ids) == 0 {
		return results, nil
	}

	rows, err := p.queries.ListTaskPreviews(ctx, tx, &database.ListTaskPreviewsParams{
		OrganizationID: reader.OrganizationID,
		TaskIds:        ids,
		EmployeeID:     reader.EmployeeID,
	})
	if err != nil {
		return nil, err
	}

	// One name lookup for the whole page, never one per card.
	assigneeIDs := make([]dbuuid.UUID, 0, len(rows))
	for _, row := range rows {
		if row.AssigneeCount > 0 {
			assigneeIDs = append(assigneeIDs, row.PrimaryAssigneeID)
		}
	}
	names := map[dbuuid.UUID]string{}
	if len(assigneeIDs) > 0 && p.employeeNames != nil {
		names, err = p.employeeNames.ListEmployeeNames(ctx, tx, reader.OrganizationID, assigneeIDs)
		if err != nil {
			// A card without an assignee line is still a useful card; losing the whole
			// page because a name could not be read is not.
			slog.WarnContext(ctx, "task preview assignee names unavailable", "error", err)
			names = map[dbuuid.UUID]string{}
		}
	}

	for _, row := range rows {
		target, ok := byID[row.ID]
		if !ok {
			continue
		}
		preview := &linking.LinkPreviewMetadata{
			// Title, then identifier, then the type name. A uuid is never a candidate.
			Title:         firstNonEmpty(row.Title, row.Identifier, "Task"),
			ResourceType:  linking.ResourceTypeTaskInstance,
			Badge:         "Task",
			Href:          target.CanonicalURL,
			Identifier:    row.Identifier,
			StateName:     row.StateName,
			StateCategory: row.StateCategory,
		}
		if row.AssigneeCount > 0 {
			preview.AssigneeName = names[row.PrimaryAssigneeID]
			preview.AssigneeCount = int(row.AssigneeCount)
		}
		results[target.Key] = preview
	}
	return results, nil
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

type projectPreviewProvider struct {
	queries *database.Queries
}

// NewProjectPreviewProvider builds the project card: the project's name, with its key as
// the identifier and the supporting line.
func NewProjectPreviewProvider(queries *database.Queries) linking.PreviewProvider {
	return &projectPreviewProvider{queries: queries}
}

func (p *projectPreviewProvider) Handles(resourceType linking.ResourceType) bool {
	return resourceType == linking.ResourceTypeProjectDestination
}

func (p *projectPreviewProvider) Preview(
	ctx context.Context,
	tx database.DBTX,
	reader linking.PreviewReader,
	targets []linking.PreviewTarget,
) (map[string]*linking.LinkPreviewMetadata, error) {
	ids, byID := previewTargetIDs(targets)
	results := make(map[string]*linking.LinkPreviewMetadata, len(targets))
	if len(ids) == 0 {
		return results, nil
	}

	rows, err := p.queries.ListProjectPreviews(ctx, tx, &database.ListProjectPreviewsParams{
		OrganizationID: reader.OrganizationID,
		ProjectIds:     ids,
		EmployeeID:     reader.EmployeeID,
	})
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		target, ok := byID[row.ID]
		if !ok {
			continue
		}
		results[target.Key] = &linking.LinkPreviewMetadata{
			Title:        firstNonEmpty(row.Name, row.Key, "Project"),
			Subtitle:     row.Key,
			ResourceType: linking.ResourceTypeProjectDestination,
			Badge:        "Project",
			Href:         target.CanonicalURL,
			Identifier:   row.Key,
		}
	}
	return results, nil
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

// previewTargetIDs turns a provider's targets into the id array its query takes, dropping
// any resource id that is not a uuid. A malformed id is simply not looked up, which the
// caller reports as "unavailable" like every other failure.
func previewTargetIDs(targets []linking.PreviewTarget) ([]dbuuid.UUID, map[dbuuid.UUID]linking.PreviewTarget) {
	ids := make([]dbuuid.UUID, 0, len(targets))
	byID := make(map[dbuuid.UUID]linking.PreviewTarget, len(targets))
	for _, target := range targets {
		parsed, err := dbuuid.Parse(target.Target.ResourceID)
		if err != nil {
			continue
		}
		if _, seen := byID[parsed]; seen {
			continue
		}
		byID[parsed] = target
		ids = append(ids, parsed)
	}
	return ids, byID
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

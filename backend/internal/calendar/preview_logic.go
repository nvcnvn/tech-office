package calendar

import (
	"context"
	"time"

	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/internal/linking"
)

type eventPreviewProvider struct {
	queries *database.Queries
}

// NewEventPreviewProvider builds the calendar card: the event's title and its start as an
// instant. The instant is deliberately not formatted here — the reader's time zone is only
// known on the client, so a server-rendered wall clock would be wrong for anyone
// travelling.
//
// Access is the organiser-or-attendee-or-team/org_wide predicate SearchEvents owns, and a
// cancelled event has nothing to preview.
func NewEventPreviewProvider(queries *database.Queries) linking.PreviewProvider {
	return &eventPreviewProvider{queries: queries}
}

func (p *eventPreviewProvider) Handles(resourceType linking.ResourceType) bool {
	return resourceType == linking.ResourceTypeCalendarEvent
}

func (p *eventPreviewProvider) Preview(
	ctx context.Context,
	tx database.DBTX,
	reader linking.PreviewReader,
	targets []linking.PreviewTarget,
) (map[string]*linking.LinkPreviewMetadata, error) {
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

	results := make(map[string]*linking.LinkPreviewMetadata, len(targets))
	if len(ids) == 0 {
		return results, nil
	}

	rows, err := p.queries.ListEventPreviews(ctx, tx, &database.ListEventPreviewsParams{
		OrganizationID: reader.OrganizationID,
		EventIds:       ids,
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
		title := row.Title
		if title == "" {
			title = "Calendar event"
		}
		preview := &linking.LinkPreviewMetadata{
			Title:        title,
			ResourceType: linking.ResourceTypeCalendarEvent,
			Badge:        "Calendar",
			Href:         target.CanonicalURL,
			AllDay:       row.AllDay,
		}
		if row.StartTime.Valid {
			preview.StartTime = row.StartTime.Time.UTC().Format(time.RFC3339)
		}
		results[target.Key] = preview
	}
	return results, nil
}

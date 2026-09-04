package docs

import (
	"context"

	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/internal/linking"
)

// RootDocumentContainer names where a root document lives. There is no space entity in
// docs — documents nest — so a document with no parent names the workspace rather than
// inventing a container it is not in.
const RootDocumentContainer = "Workspace docs"

type documentPreviewProvider struct {
	queries *database.Queries
}

// NewDocumentPreviewProvider builds the document card: the document's title, plus the
// parent it lives under as the supporting line.
//
// Access is decided in SQL by the same COALESCE precedence chain SearchDocuments owns,
// deny-grant included, so a document the reader may not read is never loaded here.
func NewDocumentPreviewProvider(queries *database.Queries) linking.PreviewProvider {
	return &documentPreviewProvider{queries: queries}
}

func (p *documentPreviewProvider) Handles(resourceType linking.ResourceType) bool {
	return resourceType == linking.ResourceTypeDocumentPage
}

func (p *documentPreviewProvider) Preview(
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

	rows, err := p.queries.ListDocumentPreviews(ctx, tx, &database.ListDocumentPreviewsParams{
		OrganizationID: reader.OrganizationID,
		DocumentIds:    ids,
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
		// The parent contributes a name, never access: a visible child inside a parent the
		// reader cannot open still says which space it is in.
		container := RootDocumentContainer
		if row.ParentTitle.Valid && row.ParentTitle.String != "" {
			container = row.ParentTitle.String
		}
		title := row.Title
		if title == "" {
			title = "Document"
		}
		results[target.Key] = &linking.LinkPreviewMetadata{
			Title:        title,
			Subtitle:     container,
			ResourceType: linking.ResourceTypeDocumentPage,
			Badge:        "Document",
			Href:         target.CanonicalURL,
		}
	}
	return results, nil
}

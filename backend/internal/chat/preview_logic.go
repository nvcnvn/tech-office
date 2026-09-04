package chat

import (
	"context"

	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/internal/linking"
)

type chatPreviewProvider struct {
	queries *database.Queries
}

// NewChatPreviewProvider builds both chat cards: a channel names itself, and a thread
// names the channel it lives in and says that it is a thread.
//
// Each reads exactly one row and never touches a message body, which is what closes the
// "a channel linked inside the channel being read" recursion by construction rather than
// by a depth check.
func NewChatPreviewProvider(queries *database.Queries) linking.PreviewProvider {
	return &chatPreviewProvider{queries: queries}
}

func (p *chatPreviewProvider) Handles(resourceType linking.ResourceType) bool {
	return resourceType == linking.ResourceTypeChatChannel || resourceType == linking.ResourceTypeChatThread
}

func (p *chatPreviewProvider) Preview(
	ctx context.Context,
	tx database.DBTX,
	reader linking.PreviewReader,
	targets []linking.PreviewTarget,
) (map[string]*linking.LinkPreviewMetadata, error) {
	channelIDs, channelsByID := previewIDs(targets, linking.ResourceTypeChatChannel)
	threadIDs, threadsByID := previewIDs(targets, linking.ResourceTypeChatThread)
	results := make(map[string]*linking.LinkPreviewMetadata, len(targets))

	if len(channelIDs) > 0 {
		rows, err := p.queries.ListChannelPreviews(ctx, tx, &database.ListChannelPreviewsParams{
			OrganizationID: reader.OrganizationID,
			ChannelIds:     channelIDs,
			EmployeeID:     reader.EmployeeID,
		})
		if err != nil {
			return nil, err
		}
		for _, row := range rows {
			target, ok := channelsByID[row.ID]
			if !ok {
				continue
			}
			results[target.Key] = &linking.LinkPreviewMetadata{
				Title:        channelName(row.DisplayName, row.TitleSlug),
				ResourceType: linking.ResourceTypeChatChannel,
				Badge:        "Chat",
				Href:         target.CanonicalURL,
			}
		}
	}

	if len(threadIDs) > 0 {
		rows, err := p.queries.ListThreadPreviews(ctx, tx, &database.ListThreadPreviewsParams{
			OrganizationID: reader.OrganizationID,
			RootMessageIds: threadIDs,
			EmployeeID:     reader.EmployeeID,
		})
		if err != nil {
			return nil, err
		}
		for _, row := range rows {
			target, ok := threadsByID[row.RootMessageID]
			if !ok {
				continue
			}
			results[target.Key] = &linking.LinkPreviewMetadata{
				Title:        channelName(row.DisplayName, row.TitleSlug),
				Subtitle:     "Thread",
				ResourceType: linking.ResourceTypeChatThread,
				Badge:        "Thread",
				Href:         target.CanonicalURL,
			}
		}
	}

	return results, nil
}

func previewIDs(targets []linking.PreviewTarget, resourceType linking.ResourceType) ([]dbuuid.UUID, map[dbuuid.UUID]linking.PreviewTarget) {
	ids := make([]dbuuid.UUID, 0, len(targets))
	byID := make(map[dbuuid.UUID]linking.PreviewTarget, len(targets))
	for _, target := range targets {
		if target.Target.ResourceType != resourceType {
			continue
		}
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

func channelName(displayName, titleSlug string) string {
	if displayName != "" {
		return displayName
	}
	if titleSlug != "" {
		return titleSlug
	}
	return "Channel"
}

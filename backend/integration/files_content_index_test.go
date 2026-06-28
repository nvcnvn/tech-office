package integration

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

// TestContentIndexing covers text file indexing and search-by-content after indexing.
func TestContentIndexing(t *testing.T) {
	w := newTestWorld(t)
	owner := w.withOwner()
	chID := w.createChannel(owner, "Indexing", false)

	t.Run("when uploading a text file with searchable content", func(t *testing.T) {
		slug := uniqueSlug("IDX")
		content := slug + " quarterly sales performance report"
		fileID := w.uploadChannelFile(owner, chID, slug+"-report.txt", "text/plain", []byte(content))

		// Allow indexing time
		time.Sleep(5 * time.Second)

		t.Run("the file is findable by content keywords", func(t *testing.T) {
			resp := w.searchFiles(owner, slug, 10)
			found := false
			for _, r := range resp.Results {
				if r.FileId == fileID {
					found = true
				}
			}
			assert.True(t, found, "file should be findable by content")
		})
	})

	t.Run("when uploading a markdown file", func(t *testing.T) {
		slug := uniqueSlug("MD")
		md := "# " + slug + " Architecture\n\n- WebSocket integration\n- Real-time updates"
		fileID := w.uploadChannelFile(owner, chID, slug+"-arch.md", "text/markdown", []byte(md))

		time.Sleep(5 * time.Second)

		t.Run("the markdown content is searchable", func(t *testing.T) {
			resp := w.searchFiles(owner, slug, 10)
			found := false
			for _, r := range resp.Results {
				if r.FileId == fileID {
					found = true
				}
			}
			assert.True(t, found)
		})
	})

	t.Run("when searching content across organizations", func(t *testing.T) {
		_, otherUser := w.withUsersFromDifferentOrgs()

		slug := uniqueSlug("XORG")
		w.uploadChannelFile(owner, chID, slug+"-secret.txt", "text/plain", []byte(slug+" project phoenix data"))
		time.Sleep(5 * time.Second)

		t.Run("the other org cannot find the file", func(t *testing.T) {
			resp := w.searchFiles(otherUser, slug, 10)
			assert.Empty(t, resp.Results)
		})
	})
}

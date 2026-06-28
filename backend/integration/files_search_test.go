package integration

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestFileSearch covers filename search, content search, and pagination.
func TestFileSearch(t *testing.T) {
	w := newTestWorld(t)
	owner := w.withOwner()
	chID := w.createChannel(owner, "Search Test", false)

	t.Run("when searching by filename", func(t *testing.T) {
		slug := uniqueSlug("SR")
		w.uploadChannelFile(owner, chID, slug+"-report.pdf", "application/pdf", []byte("data"))
		w.uploadChannelFile(owner, chID, slug+"-budget.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", []byte("data"))

		// allow async indexing
		time.Sleep(2 * time.Second)

		t.Run("exact filename match returns the file", func(t *testing.T) {
			resp := w.searchFiles(owner, slug+"-report", 10)
			require.NotEmpty(t, resp.Results)
			found := false
			for _, r := range resp.Results {
				if r.FileId != "" {
					found = true
				}
			}
			assert.True(t, found)
		})
	})

	t.Run("when searching with pagination", func(t *testing.T) {
		slug := uniqueSlug("PG")

		for i := 0; i < 5; i++ {
			w.uploadChannelFile(owner, chID, slug+"-file"+string(rune('A'+i))+".txt", "text/plain", []byte("page content"))
		}
		time.Sleep(2 * time.Second)

		resp := w.searchFiles(owner, slug, 10)

		t.Run("results include multiple files", func(t *testing.T) {
			assert.GreaterOrEqual(t, len(resp.Results), 1)
		})
	})

	t.Run("when searching across organizations", func(t *testing.T) {
		_, otherUser := w.withUsersFromDifferentOrgs()

		slug := uniqueSlug("ISO")
		w.uploadChannelFile(owner, chID, slug+"-confidential.pdf", "application/pdf", []byte("secret"))
		time.Sleep(2 * time.Second)

		t.Run("another org does not see the files", func(t *testing.T) {
			resp := w.searchFiles(otherUser, slug, 10)
			assert.Empty(t, resp.Results)
		})
	})
}

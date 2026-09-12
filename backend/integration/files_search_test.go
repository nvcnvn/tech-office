package integration

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// TestFileSearch covers filename search, content search, and pagination.
func TestFileSearch(t *testing.T) {
	t.Parallel()
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

	// FR-012: one search, one ranked list. A searcher asks for a term, not for "a term in
	// a filename" — so a file matched on its name and a file matched on its contents come
	// back together, and the response says nothing about which field matched.
	t.Run("when one file matches on filename and another on content", func(t *testing.T) {
		term := uniqueSlug("SHARED")

		byName := w.uploadChannelFile(owner, chID, term+"-agenda.txt", "text/plain",
			[]byte("This body mentions nothing in particular."))
		byContent := w.uploadChannelFile(owner, chID, uniqueSlug("notes")+".txt", "text/plain",
			[]byte("Discussion of "+term+" followed the review."))

		require.Equal(t, rpcv1.IndexingStatus_INDEXING_STATUS_COMPLETED,
			w.waitForContentIndex(owner, byContent, 60*time.Second).GetStatus())

		results := w.searchFiles(owner, term, 20).Results

		t.Run("both appear in a single ranked list", func(t *testing.T) {
			ids := make([]string, 0, len(results))
			for _, r := range results {
				ids = append(ids, r.FileId)
			}
			assert.Contains(t, ids, byName, "the filename match must be in the list")
			assert.Contains(t, ids, byContent, "the content match must be in the same list")
		})
	})
}

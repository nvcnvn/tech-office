package integration

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestDocumentVersion covers version history and diff between versions.
func TestDocumentVersion(t *testing.T) {
	w := newTestWorld(t)
	owner := w.withOwner()

	v1 := `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Line 1"}]}]}`
	v2 := `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Line 1"}]},{"type":"paragraph","content":[{"type":"text","text":"Line 2"}]}]}`
	v3 := `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Line 1 modified"}]},{"type":"paragraph","content":[{"type":"text","text":"Line 2"}]}]}`

	docID := w.createDocument(owner, "Versioned Doc", v1)
	w.updateDocument(owner, docID, v2)
	w.updateDocument(owner, docID, v3)

	t.Run("when getting diff between v1 and v2", func(t *testing.T) {
		changes := w.getVersionDiff(owner, docID, 1, 2)

		t.Run("it shows added content", func(t *testing.T) {
			require.NotEmpty(t, changes)
		})
	})

	t.Run("when getting diff between v1 and v3", func(t *testing.T) {
		changes := w.getVersionDiff(owner, docID, 1, 3)

		t.Run("it shows modifications across multiple versions", func(t *testing.T) {
			assert.NotEmpty(t, changes)
		})
	})
}

package integration

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestDocumentDiff covers paragraph-level diff tracking including hard breaks.
func TestDocumentDiff(t *testing.T) {
	w := newTestWorld(t)
	owner := w.withOwner()

	t.Run("when diffing a basic paragraph addition", func(t *testing.T) {
		v1 := `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Line 1"}]},{"type":"paragraph","content":[{"type":"text","text":"Line 2"}]}]}`
		v2 := `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Line 1"}]},{"type":"paragraph","content":[{"type":"text","text":"Line 2"}]},{"type":"paragraph","content":[{"type":"text","text":"Line 3"}]}]}`

		docID := w.createDocument(owner, "Diff Basic", v1)
		w.updateDocument(owner, docID, v2)

		changes := w.getVersionDiff(owner, docID, 1, 2)

		t.Run("it detects the added paragraph", func(t *testing.T) {
			require.NotEmpty(t, changes)
			hasAdded := false
			for _, c := range changes {
				if c.ChangeType == "added" || c.ChangeType == "add" {
					hasAdded = true
				}
			}
			assert.True(t, hasAdded, "should have at least one added change")
		})
	})

	t.Run("when diffing content with hard breaks", func(t *testing.T) {
		v1 := `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"First"},{"type":"hardBreak"},{"type":"text","text":"Second"}]}]}`
		v2 := `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"First"},{"type":"hardBreak"},{"type":"text","text":"Second"},{"type":"hardBreak"},{"type":"text","text":"Third"}]}]}`

		docID := w.createDocument(owner, "Diff HardBreak", v1)
		w.updateDocument(owner, docID, v2)

		changes := w.getVersionDiff(owner, docID, 1, 2)

		t.Run("it captures the inline addition", func(t *testing.T) {
			assert.NotEmpty(t, changes)
		})
	})
}

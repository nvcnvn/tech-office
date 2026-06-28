package integration

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestDocumentCRUD covers create, update, list, delete lifecycle for documents.
func TestDocumentCRUD(t *testing.T) {
	w := newTestWorld(t)
	owner := w.withOwner()

	content1 := `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Hello World"}]}]}`
	content2 := `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Updated Content"}]}]}`

	t.Run("when creating a document", func(t *testing.T) {
		docID := w.createDocument(owner, "Test Doc", content1)

		t.Run("it returns a non-empty ID", func(t *testing.T) {
			assert.NotEmpty(t, docID)
		})

		t.Run("it appears in the document list", func(t *testing.T) {
			docs := w.listDocuments(owner, 50)
			found := findDocument(docs, docID)
			require.NotNil(t, found)
			assert.Equal(t, "Test Doc", found.Title)
		})
	})

	t.Run("when updating a document", func(t *testing.T) {
		docID := w.createDocument(owner, "Update Me", content1)
		w.updateDocument(owner, docID, content2)

		t.Run("the content is updated (new version created)", func(t *testing.T) {
			// Verify via version diff — v1 → v2 should have changes
			changes := w.getVersionDiff(owner, docID, 1, 2)
			assert.NotEmpty(t, changes)
		})
	})

	t.Run("when deleting a document", func(t *testing.T) {
		docID := w.createDocument(owner, "Delete Me", content1)
		w.deleteDocument(owner, docID)

		t.Run("it no longer appears in the list", func(t *testing.T) {
			docs := w.listDocuments(owner, 50)
			assert.Nil(t, findDocument(docs, docID))
		})
	})

	t.Run("when listing documents with nil cursor", func(t *testing.T) {
		// Regression: nil cursor should return results, not empty list
		w.createDocument(owner, "Cursor Test", content1)

		t.Run("documents are returned", func(t *testing.T) {
			docs := w.listDocuments(owner, 10)
			assert.NotEmpty(t, docs)
		})
	})
}

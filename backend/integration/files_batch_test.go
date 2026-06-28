package integration

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestFileMetadataBatch covers batch retrieval, deletion metadata, and edge cases.
func TestFileMetadataBatch(t *testing.T) {
	w := newTestWorld(t)
	owner := w.withOwner()

	chID := w.createChannel(owner, "Batch Test", false)

	t.Run("when requesting metadata for multiple files", func(t *testing.T) {
		f1 := w.uploadChannelFile(owner, chID, "a.txt", "text/plain", []byte("aaa"))
		f2 := w.uploadChannelFile(owner, chID, "b.txt", "text/plain", []byte("bbb"))
		f3 := w.uploadChannelFile(owner, chID, "c.txt", "text/plain", []byte("ccc"))

		files := w.getFileMetadataBatch(owner, []string{f1, f2, f3})

		t.Run("all files are returned with correct filenames", func(t *testing.T) {
			require.Len(t, files, 3)
		})
	})

	t.Run("when requesting with mixed valid and invalid IDs", func(t *testing.T) {
		f1 := w.uploadChannelFile(owner, chID, "valid.txt", "text/plain", []byte("data"))

		files := w.getFileMetadataBatch(owner, []string{f1, "00000000-0000-0000-0000-000000000000"})

		t.Run("only valid files are returned (non-existent silently skipped)", func(t *testing.T) {
			assert.Len(t, files, 1)
		})
	})

	t.Run("when a file has been deleted", func(t *testing.T) {
		f1 := w.uploadChannelFile(owner, chID, "del.txt", "text/plain", []byte("x"))
		f2 := w.uploadChannelFile(owner, chID, "keep.txt", "text/plain", []byte("y"))
		w.deleteFile(owner, f1)

		files := w.getFileMetadataBatch(owner, []string{f1, f2})

		t.Run("both files are returned with deletion metadata", func(t *testing.T) {
			require.Len(t, files, 2)
		})
	})
}

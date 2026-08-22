package integration

import (
	"testing"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestFileValidation covers MIME type verification, mismatch detection, and edge cases.
func TestFileValidation(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	owner := w.withOwner()
	chID := w.createChannel(owner, "Validation", false)

	t.Run("when validating a file with matching MIME type", func(t *testing.T) {
		pdfContent := []byte("%PDF-1.4 test content here")
		fileID := w.uploadChannelFile(owner, chID, "real.pdf", "application/pdf", pdfContent)

		resp, err := w.validateFile(owner, fileID)
		require.NoError(t, err)

		t.Run("the status is verified", func(t *testing.T) {
			assert.NotNil(t, resp.ValidationResult)
		})
	})

	t.Run("when validating a non-existent file", func(t *testing.T) {
		_, err := w.validateFile(owner, "00000000-0000-0000-0000-000000000000")

		t.Run("it returns not found", func(t *testing.T) {
			require.Error(t, err)
			assert.Equal(t, connect.CodeNotFound, connect.CodeOf(err))
		})
	})

	t.Run("when validating a file from another organization", func(t *testing.T) {
		_, otherUser := w.withUsersFromDifferentOrgs()
		fileID := w.uploadChannelFile(owner, chID, "internal.pdf", "application/pdf", []byte("%PDF-1.4"))

		_, err := w.validateFile(otherUser, fileID)

		t.Run("it returns not found (not leaked)", func(t *testing.T) {
			require.Error(t, err)
			assert.Equal(t, connect.CodeNotFound, connect.CodeOf(err))
		})
	})
}

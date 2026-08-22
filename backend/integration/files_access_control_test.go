package integration

import (
	"testing"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestFileAccessControl covers upload permissions, channel-scoped access, batch filtering,
// and multi-tenant isolation for files.
func TestFileAccessControl(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	owner := w.withOwner()
	employee := w.withEmployee()

	t.Run("when uploading to a private channel", func(t *testing.T) {
		chID := w.createChannel(owner, "Private Files", true)
		fileID := w.uploadChannelFile(owner, chID, "secret.pdf", "application/pdf", []byte("%PDF-1.4 test"))

		t.Run("the uploader can access the file", func(t *testing.T) {
			hasAccess, _ := w.checkFileAccess(owner, fileID)
			assert.True(t, hasAccess)
		})

		t.Run("a non-member cannot access the file", func(t *testing.T) {
			hasAccess, reason := w.checkFileAccess(employee, fileID)
			assert.False(t, hasAccess)
			assert.NotEmpty(t, reason)
		})

		t.Run("after being invited the member can access", func(t *testing.T) {
			w.inviteToChannel(owner, chID, employee.ID)
			hasAccess, _ := w.checkFileAccess(employee, fileID)
			assert.True(t, hasAccess)
		})
	})

	t.Run("when a non-member tries to upload to a private channel", func(t *testing.T) {
		chID := w.createChannel(owner, "Upload Denied", true)

		t.Run("the upload is rejected with permission denied", func(t *testing.T) {
			err := w.requestChannelFileUploadError(employee, chID, "nope.txt", "text/plain", 100)
			require.Error(t, err)
			assert.Equal(t, connect.CodePermissionDenied, connect.CodeOf(err))
		})
	})

	t.Run("when requesting file metadata in batch", func(t *testing.T) {
		chID := w.createChannel(owner, "Batch Channel", true)
		f1 := w.uploadChannelFile(owner, chID, "one.txt", "text/plain", []byte("one"))
		f2 := w.uploadChannelFile(owner, chID, "two.txt", "text/plain", []byte("two"))

		t.Run("the owner sees all files", func(t *testing.T) {
			files := w.getFileMetadataBatch(owner, []string{f1, f2})
			assert.Len(t, files, 2)
		})

		t.Run("a non-member sees none (silent filtering)", func(t *testing.T) {
			files := w.getFileMetadataBatch(employee, []string{f1, f2})
			assert.Empty(t, files)
		})
	})

	t.Run("when accessing files across organizations", func(t *testing.T) {
		_, otherUser := w.withUsersFromDifferentOrgs()

		chID := w.createChannel(owner, "Org Boundary", false)
		fileID := w.uploadChannelFile(owner, chID, "internal.pdf", "application/pdf", []byte("data"))

		t.Run("another org cannot access via download URL", func(t *testing.T) {
			_, err := w.getDownloadURL(otherUser, fileID)
			require.Error(t, err)
			// Server returns NotFound to avoid leaking file existence to other orgs
			assert.Equal(t, connect.CodeNotFound, connect.CodeOf(err))
		})
	})
}

// TestFileUploadPublicChannel covers upload to public channels.
func TestFileUploadPublicChannel(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	owner := w.withOwner()
	employee := w.withEmployee()

	t.Run("when uploading to a public channel", func(t *testing.T) {
		chID := w.createChannel(owner, "Public Files", false)
		fileID := w.uploadChannelFile(owner, chID, "public.pdf", "application/pdf", []byte("data"))

		t.Run("any org member can access the file", func(t *testing.T) {
			hasAccess, _ := w.checkFileAccess(employee, fileID)
			assert.True(t, hasAccess)
		})

		t.Run("a download URL is provided", func(t *testing.T) {
			url, err := w.getDownloadURL(employee, fileID)
			require.NoError(t, err)
			assert.NotEmpty(t, url)
		})
	})
}

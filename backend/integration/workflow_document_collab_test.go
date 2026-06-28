package integration

import (
	"testing"

	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestDocumentCollaborationWorkflow simulates the full document collaboration
// lifecycle as the frontend orchestrates it:
// - Author creates document -> grants access to collaborators
// - Collaborators join for editing -> author sees active editors
// - Collaborators follow the document -> follow list tracks subscriptions
// - Content updates create versions -> version diff is viewable
// - Access revocation prevents further interaction
func TestDocumentCollaborationWorkflow(t *testing.T) {
	w := newTestWorld(t)
	users := w.withEmployees(3)
	author, editor, viewer := users[0], users[1], users[2]

	content1 := `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Initial draft of the RFC"}]}]}`
	content2 := `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Updated RFC with feedback incorporated"}]}]}`

	t.Run("when an author creates a document and shares it", func(t *testing.T) {
		docID := w.createDocument(author, "RFC: New Auth System", content1)

		t.Run("the author has owner access", func(t *testing.T) {
			level, isOwner := w.checkDocumentAccess(author, docID)
			assert.True(t, isOwner)
			assert.Equal(t, rpcv1.AccessLevel_ACCESS_LEVEL_WRITE_UPDATE, level)
		})

		w.setDocumentAccess(author, docID, editor.ID.String(), rpcv1.AccessLevel_ACCESS_LEVEL_WRITE_UPDATE)
		w.setDocumentAccess(author, docID, viewer.ID.String(), rpcv1.AccessLevel_ACCESS_LEVEL_READ_COMMENT)

		t.Run("the editor has write access", func(t *testing.T) {
			level, isOwner := w.checkDocumentAccess(editor, docID)
			assert.False(t, isOwner)
			assert.Equal(t, rpcv1.AccessLevel_ACCESS_LEVEL_WRITE_UPDATE, level)
		})

		t.Run("the viewer has read-only access", func(t *testing.T) {
			level, isOwner := w.checkDocumentAccess(viewer, docID)
			assert.False(t, isOwner)
			assert.Equal(t, rpcv1.AccessLevel_ACCESS_LEVEL_READ_COMMENT, level)
		})

		t.Run("the document appears in the document list for shared users", func(t *testing.T) {
			docs := w.listDocuments(editor, 50)
			found := findDocument(docs, docID)
			require.NotNil(t, found, "editor should see the shared document")
			assert.Equal(t, "RFC: New Auth System", found.Title)
		})

		t.Run("when collaborators join the editing session", func(t *testing.T) {
			authorConnID, _ := w.joinDocument(author, docID)
			editorConnID, editors := w.joinDocument(editor, docID)

			t.Run("both users appear as active editors", func(t *testing.T) {
				require.GreaterOrEqual(t, len(editors), 1, "editor should see author already editing")
			})

			t.Run("listing active editors shows all participants", func(t *testing.T) {
				activeEditors := w.listActiveEditors(author, docID)
				assert.GreaterOrEqual(t, len(activeEditors), 2, "should show both author and editor")
			})

			w.leaveDocument(author, docID, authorConnID)
			w.leaveDocument(editor, docID, editorConnID)
		})

		t.Run("when the editor updates the document content", func(t *testing.T) {
			w.updateDocument(editor, docID, content2)

			t.Run("the updated content is visible to the author", func(t *testing.T) {
				docResp := w.getDocument(author, docID)
				assert.Contains(t, docResp.Document.ContentJson, "feedback incorporated")
			})

			t.Run("a version diff shows the changes", func(t *testing.T) {
				changes := w.getVersionDiff(author, docID, 1, 2)
				assert.NotEmpty(t, changes, "diff from v1 to v2 should have changes")
			})
		})

		t.Run("when users follow the document", func(t *testing.T) {
			w.followDocument(editor, docID)
			w.followDocument(viewer, docID)

			t.Run("the document appears in the follower followed list", func(t *testing.T) {
				followedDocs := w.listFollowedDocuments(editor)
				found := findDocument(followedDocs, docID)
				require.NotNil(t, found, "followed document should appear in list")
			})

			t.Run("after unfollowing it disappears from the list", func(t *testing.T) {
				w.unfollowDocument(editor, docID)
				followedDocs := w.listFollowedDocuments(editor)
				found := findDocument(followedDocs, docID)
				assert.Nil(t, found, "unfollowed document should not appear in list")
			})
		})

		t.Run("when access is revoked", func(t *testing.T) {
			revokeDocID := w.createDocument(author, "Revocable Doc", content1)
			w.setDocumentAccess(author, revokeDocID, viewer.ID.String(), rpcv1.AccessLevel_ACCESS_LEVEL_READ_COMMENT)

			level, _ := w.checkDocumentAccess(viewer, revokeDocID)
			assert.Equal(t, rpcv1.AccessLevel_ACCESS_LEVEL_READ_COMMENT, level)

			w.setDocumentAccess(author, revokeDocID, viewer.ID.String(), rpcv1.AccessLevel_ACCESS_LEVEL_NONE)

			t.Run("the viewer can no longer access the document", func(t *testing.T) {
				err := w.getDocumentError(viewer, revokeDocID)
				require.Error(t, err, "viewer should be denied after revocation")
			})
		})
	})
}

// TestDocumentWithTaskIntegration tests that tasks automatically get a description
// document and that both the task and its document work together.
func TestDocumentWithTaskIntegration(t *testing.T) {
	w := newTestWorld(t)
	users := w.withEmployees(2)
	manager, dev := users[0], users[1]

	t.Run("when a task is created, its description document is functional", func(t *testing.T) {
		proj := w.createProject(manager, "Doc Integration", uniqueProjectKey("DOCI"))
		level0 := levelByDepth(proj.Levels, 0)
		require.NotNil(t, level0)

		w.addProjectMember(manager, proj.ID, dev.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)

		task := w.createTask(manager, proj.ID, "Feature: OAuth Login", level0.Id)
		require.NotNil(t, task.DescriptionDocumentId, "task should have a description document")

		descDocID := *task.DescriptionDocumentId

		t.Run("the task description document is accessible by team members", func(t *testing.T) {
			docResp := w.getDocument(dev, descDocID)
			assert.NotNil(t, docResp.Document)
		})

		t.Run("a team member can update the task description document", func(t *testing.T) {
			descContent := `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Acceptance criteria: 1. Support Google SSO 2. Handle token refresh"}]}]}`
			w.updateDocument(dev, descDocID, descContent)

			updated := w.getDocument(manager, descDocID)
			assert.Contains(t, updated.Document.ContentJson, "Acceptance criteria")
		})
	})
}

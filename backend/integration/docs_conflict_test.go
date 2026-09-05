package integration

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Feature 049: Document Edit Conflict Protection — behavioural contract.
//
// The rule the whole file turns on: a save carries the version number the editing
// session loaded, and is refused unless that is still the document's current version.
// Refused means refused entirely — no content, no title, no version, no slug history,
// no notification. Staleness is defined by another save landing, never by elapsed time
// and never by who is saving.

// ---------------------------------------------------------------------------
// Act: saving a document from a named base version
// ---------------------------------------------------------------------------

// saveDocument is one editing session's save: a title, a body, and the version the
// session loaded. It returns the outcome so a scenario can assert on a refusal.
func (w *testWorld) saveDocument(
	actor testUser,
	docID, title, contentJSON string,
	baseVersion int32,
) (*rpcv1.UpdateDocumentResponse, error) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.UpdateDocumentRequest{
		Id:          docID,
		Title:       title,
		ContentJson: contentJSON,
		BaseVersion: baseVersion,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.doc.UpdateDocument(context.Background(), req)
	if err != nil {
		return nil, err
	}
	return resp.Msg, nil
}

func (w *testWorld) listDocumentVersions(actor testUser, docID string) []*rpcv1.DocumentVersion {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.ListVersionsRequest{DocumentId: docID, Limit: 100})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.docVersion.ListVersions(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Versions
}

func (w *testWorld) updateDocumentStatus(actor testUser, docID string, status rpcv1.DocumentStatus) error {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.UpdateDocumentStatusRequest{Id: docID, Status: status})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.doc.UpdateDocumentStatus(context.Background(), req)
	return err
}

func (w *testWorld) resolveSlug(actor testUser, slug string) (*rpcv1.ResolveSlugResponse, error) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.ResolveSlugRequest{Slug: slug})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.doc.ResolveSlug(context.Background(), req)
	if err != nil {
		return nil, err
	}
	return resp.Msg, nil
}

// ---------------------------------------------------------------------------
// Assert: reading the conflict off the refusal
// ---------------------------------------------------------------------------

// versionConflictDetail returns the DocumentVersionConflict a refusal carries, or nil if
// the error is not a conflict or carries no such detail. This is exactly what a client
// does to tell "someone else saved" from "you were logged out".
func versionConflictDetail(t *testing.T, err error) *rpcv1.DocumentVersionConflict {
	t.Helper()
	var connectErr *connect.Error
	if !errors.As(err, &connectErr) {
		return nil
	}
	for _, d := range connectErr.Details() {
		msg, valueErr := d.Value()
		if valueErr != nil {
			continue
		}
		if conflict, ok := msg.(*rpcv1.DocumentVersionConflict); ok {
			return conflict
		}
	}
	return nil
}

func docBody(text string) string {
	return `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"` + text + `"}]}]}`
}

// currentVersion is what an editing session that has just loaded the document would
// send back as its base version.
func (w *testWorld) currentVersion(actor testUser, docID string) int32 {
	w.t.Helper()
	return w.getDocument(actor, docID).Document.VersionCount
}

// ---------------------------------------------------------------------------
// TestDocumentEditConflict covers optimistic concurrency on DocumentService.UpdateDocument.
// Feature 049. Traces FR-001..FR-008, FR-013.
// ---------------------------------------------------------------------------

func TestDocumentEditConflict(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	owner := w.withOwner()
	colleague := w.withEmployee() // granted write access per document below

	// grantWritableDoc creates a document owned by the owner that the colleague may edit.
	grantWritableDoc := func(title, body string) string {
		docID := w.createDocument(owner, title, docBody(body))
		w.setDocumentAccess(owner, docID, colleague.ID.String(), rpcv1.AccessLevel_ACCESS_LEVEL_WRITE_UPDATE)
		return docID
	}

	t.Run("when the only person editing a document saves from the current version", func(t *testing.T) {
		// FR-008, FR-001 — the common path is unchanged.
		docID := w.createDocument(owner, "Solo doc", docBody("First draft"))
		base := w.currentVersion(owner, docID)
		resp, err := w.saveDocument(owner, docID, "Solo doc", docBody("Second draft"), base)

		t.Run("the save is accepted and the document moves to the next version", func(t *testing.T) {
			require.NoError(t, err)
			require.NotNil(t, resp)
			assert.Equal(t, base+1, resp.Document.VersionCount,
				"a save from the current version advances the document by exactly one")
		})

		t.Run("the new content is what a reader now sees", func(t *testing.T) {
			require.NoError(t, err)
			assert.Contains(t, w.getDocument(owner, docID).Document.ContentJson, "Second draft")
		})

		t.Run("a version is created with the saving person as its author", func(t *testing.T) {
			require.NoError(t, err)
			versions := w.listDocumentVersions(owner, docID)
			require.NotEmpty(t, versions)
			var latest *rpcv1.DocumentVersion
			for _, v := range versions {
				if latest == nil || v.VersionNumber > latest.VersionNumber {
					latest = v
				}
			}
			require.NotNil(t, latest)
			assert.Equal(t, owner.ID.String(), latest.AuthorEmployeeId)
		})

		t.Run("the version number returned is the base version for the next save", func(t *testing.T) {
			require.NoError(t, err)
			_, nextErr := w.saveDocument(owner, docID, "Solo doc", docBody("Third draft"), resp.NewVersionNumber)
			assert.NoError(t, nextErr,
				"the version number a save returns must be accepted as the next save's base version")
		})
	})

	t.Run("when a second person saves from a version someone else has already replaced", func(t *testing.T) {
		// User Story 1, acceptance scenario 1. FR-002.
		docID := grantWritableDoc("Shared doc", "Original")
		staleBase := w.currentVersion(colleague, docID)

		// The owner gets there first.
		_, firstErr := w.saveDocument(owner, docID, "Shared doc", docBody("Owner content"), staleBase)
		require.NoError(t, firstErr)
		versionsAfterFirst := len(w.listDocumentVersions(owner, docID))
		versionCountAfterFirst := w.currentVersion(owner, docID)

		// The colleague saves from the version they loaded, which is now behind.
		_, staleErr := w.saveDocument(colleague, docID, "Shared doc", docBody("Colleague content"), staleBase)

		t.Run("the save is refused as a conflict rather than applied", func(t *testing.T) {
			require.Error(t, staleErr)
			assert.Equal(t, connect.CodeAborted, connect.CodeOf(staleErr))
		})

		t.Run("the stored document still holds the first person's content", func(t *testing.T) {
			content := w.getDocument(owner, docID).Document.ContentJson
			assert.Contains(t, content, "Owner content")
			assert.NotContains(t, content, "Colleague content")
		})

		t.Run("no new version is created", func(t *testing.T) {
			assert.Len(t, w.listDocumentVersions(owner, docID), versionsAfterFirst)
		})

		t.Run("the document's version number is unchanged", func(t *testing.T) {
			assert.Equal(t, versionCountAfterFirst, w.currentVersion(owner, docID))
		})
	})

	t.Run("when a refused save had also changed the title", func(t *testing.T) {
		// User Story 1, acceptance scenario 4. FR-002 — protection covers the whole update.
		docID := grantWritableDoc("Quarterly plan", "Original")
		staleBase := w.currentVersion(colleague, docID)

		_, firstErr := w.saveDocument(owner, docID, "Quarterly plan", docBody("Owner content"), staleBase)
		require.NoError(t, firstErr)

		slugBefore := w.getDocument(owner, docID).Document.Slug
		_, staleErr := w.saveDocument(colleague, docID, "Renamed by colleague", docBody("Colleague content"), staleBase)

		t.Run("the save is refused as a conflict", func(t *testing.T) {
			require.Error(t, staleErr)
			assert.Equal(t, connect.CodeAborted, connect.CodeOf(staleErr))
		})

		t.Run("the document keeps its previous title and slug", func(t *testing.T) {
			doc := w.getDocument(owner, docID).Document
			assert.Equal(t, "Quarterly plan", doc.Title)
			assert.Equal(t, slugBefore, doc.Slug)
		})

		t.Run("no slug-history entry is written for the rename that did not happen", func(t *testing.T) {
			resolved, err := w.resolveSlug(owner, slugBefore)
			require.NoError(t, err)
			assert.False(t, resolved.IsRedirect,
				"the document's slug is still current, so resolving it must not be a redirect")
		})

		t.Run("the old slug still resolves to the document", func(t *testing.T) {
			resolved, err := w.resolveSlug(owner, slugBefore)
			require.NoError(t, err)
			assert.Equal(t, docID, resolved.DocumentId)
		})
	})

	t.Run("when a save claims a base version that does not exist yet", func(t *testing.T) {
		// User Story 1, acceptance scenario 3. FR-003.
		docID := w.createDocument(owner, "Ahead doc", docBody("Original"))
		current := w.currentVersion(owner, docID)

		_, err := w.saveDocument(owner, docID, "Ahead doc", docBody("From the future"), current+5)

		t.Run("a base version ahead of the current one is refused", func(t *testing.T) {
			require.Error(t, err)
			assert.Equal(t, connect.CodeAborted, connect.CodeOf(err))
		})

		t.Run("the document is left untouched", func(t *testing.T) {
			doc := w.getDocument(owner, docID).Document
			assert.Contains(t, doc.ContentJson, "Original")
			assert.Equal(t, current, doc.VersionCount)
		})
	})

	t.Run("when a save omits the base version entirely", func(t *testing.T) {
		// FR-003 and the "old client" edge case — a client cannot opt back into last-write-wins.
		docID := w.createDocument(owner, "Omitted doc", docBody("Original"))
		current := w.currentVersion(owner, docID)

		// An omitted base_version arrives as 0, which is never a real version number.
		_, err := w.saveDocument(owner, docID, "Omitted doc", docBody("From an old client"), 0)

		t.Run("the save is refused as a conflict", func(t *testing.T) {
			require.Error(t, err)
			assert.Equal(t, connect.CodeAborted, connect.CodeOf(err))
		})

		t.Run("the document is left untouched", func(t *testing.T) {
			doc := w.getDocument(owner, docID).Document
			assert.Contains(t, doc.ContentJson, "Original")
			assert.Equal(t, current, doc.VersionCount)
		})
	})

	t.Run("when a save is refused as a conflict", func(t *testing.T) {
		// FR-004, FR-005, FR-006 — the error-detail round trip.
		docID := grantWritableDoc("Detail doc", "Original")
		staleBase := w.currentVersion(colleague, docID)

		// The colleague saves first, so the owner's stale save names the colleague.
		winner, firstErr := w.saveDocument(colleague, docID, "Detail doc", docBody("Colleague got here first"), staleBase)
		require.NoError(t, firstErr)

		_, staleErr := w.saveDocument(owner, docID, "Detail doc", docBody("Owner is behind"), staleBase)
		require.Error(t, staleErr)
		detail := versionConflictDetail(t, staleErr)

		t.Run("the outcome is reported as ABORTED, distinct from not-found and permission-denied", func(t *testing.T) {
			code := connect.CodeOf(staleErr)
			assert.Equal(t, connect.CodeAborted, code)
			assert.NotEqual(t, connect.CodeNotFound, code)
			assert.NotEqual(t, connect.CodePermissionDenied, code)
		})

		t.Run("it carries a DocumentVersionConflict detail", func(t *testing.T) {
			require.NotNil(t, detail, "a conflict must be machine-recognisable without parsing prose")
		})

		t.Run("the detail states the document's current version number", func(t *testing.T) {
			require.NotNil(t, detail)
			assert.Equal(t, winner.NewVersionNumber, detail.CurrentVersionNumber,
				"the detail must name the version the client has to reload")
		})

		t.Run("the detail names the person whose save caused the conflict", func(t *testing.T) {
			require.NotNil(t, detail)
			assert.NotEmpty(t, strings.TrimSpace(detail.ConflictingAuthorName))
		})

		t.Run("the detail says when that conflicting change was saved", func(t *testing.T) {
			require.NotNil(t, detail)
			require.NotNil(t, detail.ConflictingChangedAt)
			assert.False(t, detail.ConflictingChangedAt.AsTime().IsZero())
		})
	})

	t.Run("when a person's own second session saves from a stale version", func(t *testing.T) {
		// Edge case: the rule is per-document, not per-person.
		docID := w.createDocument(owner, "Two tabs doc", docBody("Original"))
		bothTabsLoaded := w.currentVersion(owner, docID)

		_, firstErr := w.saveDocument(owner, docID, "Two tabs doc", docBody("Saved from the first tab"), bothTabsLoaded)
		require.NoError(t, firstErr)

		_, secondErr := w.saveDocument(owner, docID, "Two tabs doc", docBody("Saved from the second tab"), bothTabsLoaded)

		t.Run("it is refused exactly like a colleague's stale save", func(t *testing.T) {
			require.Error(t, secondErr)
			assert.Equal(t, connect.CodeAborted, connect.CodeOf(secondErr))
			assert.NotNil(t, versionConflictDetail(t, secondErr))
			assert.Contains(t, w.getDocument(owner, docID).Document.ContentJson, "Saved from the first tab")
		})
	})

	t.Run("when two saves race from the same base version", func(t *testing.T) {
		// User Story 1, acceptance scenario 5. FR-007, SC-006. Two concurrent goroutines.
		docID := grantWritableDoc("Race doc", "Original")
		sharedBase := w.currentVersion(owner, docID)
		versionsBefore := len(w.listDocumentVersions(owner, docID))

		type outcome struct {
			who string
			err error
		}
		results := make([]outcome, 2)
		var wg sync.WaitGroup
		var start sync.WaitGroup
		start.Add(1)
		racers := []struct {
			actor testUser
			text  string
		}{
			{owner, "Owner wrote this"},
			{colleague, "Colleague wrote this"},
		}
		for i, racer := range racers {
			wg.Add(1)
			go func() {
				defer wg.Done()
				start.Wait()
				_, err := w.saveDocument(racer.actor, docID, "Race doc", docBody(racer.text), sharedBase)
				results[i] = outcome{who: racer.text, err: err}
			}()
		}
		start.Done()
		wg.Wait()

		var winners, losers []outcome
		for _, r := range results {
			if r.err == nil {
				winners = append(winners, r)
			} else {
				losers = append(losers, r)
			}
		}

		t.Run("exactly one save succeeds", func(t *testing.T) {
			assert.Len(t, winners, 1, "two saves from the same base version must not both be applied")
		})

		t.Run("the other is refused as a conflict", func(t *testing.T) {
			require.Len(t, losers, 1)
			assert.Equal(t, connect.CodeAborted, connect.CodeOf(losers[0].err))
			assert.NotNil(t, versionConflictDetail(t, losers[0].err),
				"the loser of a race gets the same conflict a stale save gets")
		})

		t.Run("exactly one new version exists afterwards", func(t *testing.T) {
			assert.Len(t, w.listDocumentVersions(owner, docID), versionsBefore+1)
			assert.Equal(t, sharedBase+1, w.currentVersion(owner, docID))
		})

		t.Run("the surviving content is the winner's, in full", func(t *testing.T) {
			require.Len(t, winners, 1)
			require.Len(t, losers, 1)
			content := w.getDocument(owner, docID).Document.ContentJson
			assert.Contains(t, content, winners[0].who)
			assert.NotContains(t, content, losers[0].who,
				"the refused save must leave no trace — nothing is merged")
		})
	})

	t.Run("when the same base version is saved after a very long gap with no other save", func(t *testing.T) {
		// Edge case: staleness is defined by another save landing, never by elapsed time.
		docID := w.createDocument(owner, "Long gap doc", docBody("Original"))
		loadedLongAgo := w.currentVersion(owner, docID)

		// Nothing else touches the document in between; reads and comments do not age it.
		w.getDocument(owner, docID)
		w.addDocumentComment(owner, docID, "Still thinking about this one.")

		_, err := w.saveDocument(owner, docID, "Long gap doc", docBody("Finally written up"), loadedLongAgo)

		t.Run("the save is accepted", func(t *testing.T) {
			assert.NoError(t, err)
			assert.Contains(t, w.getDocument(owner, docID).Document.ContentJson, "Finally written up")
		})
	})

	t.Run("when a person who may not edit the document saves a stale version", func(t *testing.T) {
		// Edge case: a permission failure is reported as a permission failure.
		docID := w.createDocument(owner, "Read-only doc", docBody("Original"))
		w.setDocumentAccess(owner, docID, colleague.ID.String(), rpcv1.AccessLevel_ACCESS_LEVEL_READ_COMMENT)
		staleBase := w.currentVersion(colleague, docID)

		_, firstErr := w.saveDocument(owner, docID, "Read-only doc", docBody("Owner content"), staleBase)
		require.NoError(t, firstErr)

		_, readerErr := w.saveDocument(colleague, docID, "Read-only doc", docBody("Reader content"), staleBase)

		t.Run("the refusal is permission-denied, not a conflict", func(t *testing.T) {
			require.Error(t, readerErr)
			assert.Equal(t, connect.CodePermissionDenied, connect.CodeOf(readerErr))
		})

		t.Run("it carries no DocumentVersionConflict detail", func(t *testing.T) {
			assert.Nil(t, versionConflictDetail(t, readerErr),
				"a person who may not edit must never learn who edited")
		})
	})

	t.Run("when a person reloads after a conflict and saves again", func(t *testing.T) {
		// User Story 2, acceptance scenario 2. FR-012 at the service boundary.
		docID := grantWritableDoc("Recovery doc", "Original")
		staleBase := w.currentVersion(colleague, docID)

		_, firstErr := w.saveDocument(owner, docID, "Recovery doc", docBody("Owner content"), staleBase)
		require.NoError(t, firstErr)

		_, conflictErr := w.saveDocument(colleague, docID, "Recovery doc", docBody("Colleague content"), staleBase)
		require.Error(t, conflictErr)

		reloaded := w.getDocument(colleague, docID).Document

		t.Run("the re-read document reports the current version number", func(t *testing.T) {
			detail := versionConflictDetail(t, conflictErr)
			require.NotNil(t, detail)
			assert.Equal(t, detail.CurrentVersionNumber, reloaded.VersionCount,
				"reloading gives exactly the version the conflict said to reload")
		})

		t.Run("a save based on that version is accepted", func(t *testing.T) {
			_, err := w.saveDocument(colleague, docID, "Recovery doc", docBody("Colleague content reapplied"), reloaded.VersionCount)
			require.NoError(t, err)
		})

		t.Run("the accepted content is the person's, not a merge of both", func(t *testing.T) {
			// FR-013
			content := w.getDocument(colleague, docID).Document.ContentJson
			assert.Contains(t, content, "Colleague content reapplied")
			assert.NotContains(t, content, "Owner content",
				"the system stores what the person saved and never merges the two texts")
		})
	})

	t.Run("when a conflict is refused on a document with followers", func(t *testing.T) {
		// FR-002 — a refusal must produce no side effects at all.
		docID := grantWritableDoc("Followed doc", "Original")
		follower := w.withEmployee()
		w.setDocumentAccess(owner, docID, follower.ID.String(), rpcv1.AccessLevel_ACCESS_LEVEL_READ_COMMENT)
		w.followDocument(follower, docID)

		staleBase := w.currentVersion(colleague, docID)
		_, firstErr := w.saveDocument(owner, docID, "Followed doc", docBody("Owner content"), staleBase)
		require.NoError(t, firstErr)

		// Let the accepted save's notification settle, then count from there.
		before := len(w.waitForNotificationCountStable(follower, false, 500*time.Millisecond, 10*time.Second))

		_, staleErr := w.saveDocument(colleague, docID, "Followed doc", docBody("Colleague content"), staleBase)
		require.Error(t, staleErr)

		t.Run("no document-updated notification is delivered", func(t *testing.T) {
			after := len(w.waitForNotificationCountStable(follower, false, 500*time.Millisecond, 10*time.Second))
			assert.Equal(t, before, after,
				"a refused save writes nothing, so it must not notify anybody")
		})
	})

	t.Run("when reading and non-editing surfaces are used", func(t *testing.T) {
		// Edge case: reading surfaces are unaffected.
		docID := grantWritableDoc("Reading doc", "Original")

		t.Run("getting the document carries the version number an editor would send back", func(t *testing.T) {
			// FR-009
			doc := w.getDocument(colleague, docID).Document
			require.NotZero(t, doc.VersionCount)
			_, err := w.saveDocument(colleague, docID, "Reading doc", docBody("Saved from what GetDocument reported"), doc.VersionCount)
			assert.NoError(t, err)
		})

		t.Run("commenting on the document needs no base version and still succeeds", func(t *testing.T) {
			assert.NotEmpty(t, w.addDocumentComment(colleague, docID, "Looks good to me."))
		})

		t.Run("changing the document's status needs no base version and still succeeds", func(t *testing.T) {
			assert.NoError(t, w.updateDocumentStatus(owner, docID, rpcv1.DocumentStatus_DOCUMENT_STATUS_OUTDATED))
		})

		t.Run("reading a ritual procedure document is unaffected", func(t *testing.T) {
			pw := newTestWorld(t)
			s := pw.newProcedureWorld()
			pw.attachProcedure(s.owner, s.definitionID, s.workspaceDoc)

			resolved := pw.getRitualProcedure(s.worker, s.definitionID)
			require.NotNil(t, resolved.Procedure)
			assert.True(t, resolved.Procedure.IsAvailable,
				"a reader resolving a procedure never supplies a base version and is unaffected")
		})
	})
}

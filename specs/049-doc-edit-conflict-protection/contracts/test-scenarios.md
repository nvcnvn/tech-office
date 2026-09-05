# Behavioural Contract: Document Edit Conflict Protection

Constitution II requires these scenarios to be written and agreed **before** tasks are
generated and before any code is written. They are the contract; the implementations
come later. Every User Story and every user-observable FR is traced below.

- Backend scenarios → `backend/integration/docs_conflict_test.go` (testWorld pattern,
  nested `t.Run`, arrange/act/assert).
- Browser scenarios → `frontend/apps/web/e2e/document-conflict.spec.ts` (arrange via
  API, act via UI, assert via UI).
- User Story 3 is excluded from scope with justification recorded in `plan.md`; it has
  no scenario here.

---

## Backend — `TestDocumentEditConflict`

```go
// TestDocumentEditConflict covers optimistic concurrency on DocumentService.UpdateDocument.
// Feature 049. Traces FR-001..FR-008, FR-013.
func TestDocumentEditConflict(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	owner := w.withOwner()
	colleague := w.withEmployee() // granted write access per document below

	t.Run("when the only person editing a document saves from the current version", func(t *testing.T) {
		// FR-008, FR-001 — the common path is unchanged.
		t.Run("the save is accepted and the document moves to the next version", func(t *testing.T) {})
		t.Run("the new content is what a reader now sees", func(t *testing.T) {})
		t.Run("a version is created with the saving person as its author", func(t *testing.T) {})
		t.Run("the version number returned is the base version for the next save", func(t *testing.T) {})
	})

	t.Run("when a second person saves from a version someone else has already replaced", func(t *testing.T) {
		// User Story 1, acceptance scenario 1. FR-002.
		t.Run("the save is refused as a conflict rather than applied", func(t *testing.T) {})
		t.Run("the stored document still holds the first person's content", func(t *testing.T) {})
		t.Run("no new version is created", func(t *testing.T) {})
		t.Run("the document's version number is unchanged", func(t *testing.T) {})
	})

	t.Run("when a refused save had also changed the title", func(t *testing.T) {
		// User Story 1, acceptance scenario 4. FR-002 — protection covers the whole update.
		t.Run("the save is refused as a conflict", func(t *testing.T) {})
		t.Run("the document keeps its previous title and slug", func(t *testing.T) {})
		t.Run("no slug-history entry is written for the rename that did not happen", func(t *testing.T) {})
		t.Run("the old slug still resolves to the document", func(t *testing.T) {})
	})

	t.Run("when a save claims a base version that does not exist yet", func(t *testing.T) {
		// User Story 1, acceptance scenario 3. FR-003.
		t.Run("a base version ahead of the current one is refused", func(t *testing.T) {})
		t.Run("the document is left untouched", func(t *testing.T) {})
	})

	t.Run("when a save omits the base version entirely", func(t *testing.T) {
		// FR-003 and the "old client" edge case — a client cannot opt back into last-write-wins.
		t.Run("the save is refused as a conflict", func(t *testing.T) {})
		t.Run("the document is left untouched", func(t *testing.T) {})
	})

	t.Run("when a save is refused as a conflict", func(t *testing.T) {
		// FR-004, FR-005, FR-006 — the error-detail round trip.
		t.Run("the outcome is reported as ABORTED, distinct from not-found and permission-denied", func(t *testing.T) {})
		t.Run("it carries a DocumentVersionConflict detail", func(t *testing.T) {})
		t.Run("the detail states the document's current version number", func(t *testing.T) {})
		t.Run("the detail names the person whose save caused the conflict", func(t *testing.T) {})
		t.Run("the detail says when that conflicting change was saved", func(t *testing.T) {})
	})

	t.Run("when a person's own second session saves from a stale version", func(t *testing.T) {
		// Edge case: the rule is per-document, not per-person.
		t.Run("it is refused exactly like a colleague's stale save", func(t *testing.T) {})
	})

	t.Run("when two saves race from the same base version", func(t *testing.T) {
		// User Story 1, acceptance scenario 5. FR-007, SC-006. Two concurrent goroutines.
		t.Run("exactly one save succeeds", func(t *testing.T) {})
		t.Run("the other is refused as a conflict", func(t *testing.T) {})
		t.Run("exactly one new version exists afterwards", func(t *testing.T) {})
		t.Run("the surviving content is the winner's, in full", func(t *testing.T) {})
	})

	t.Run("when the same base version is saved after a very long gap with no other save", func(t *testing.T) {
		// Edge case: staleness is defined by another save landing, never by elapsed time.
		t.Run("the save is accepted", func(t *testing.T) {})
	})

	t.Run("when a person who may not edit the document saves a stale version", func(t *testing.T) {
		// Edge case: a permission failure is reported as a permission failure.
		t.Run("the refusal is permission-denied, not a conflict", func(t *testing.T) {})
		t.Run("it carries no DocumentVersionConflict detail", func(t *testing.T) {})
	})

	t.Run("when a person reloads after a conflict and saves again", func(t *testing.T) {
		// User Story 2, acceptance scenario 2. FR-012 at the service boundary.
		t.Run("the re-read document reports the current version number", func(t *testing.T) {})
		t.Run("a save based on that version is accepted", func(t *testing.T) {})
		t.Run("the accepted content is the person's, not a merge of both", func(t *testing.T) {}) // FR-013
	})

	t.Run("when a conflict is refused on a document with followers", func(t *testing.T) {
		// FR-002 — a refusal must produce no side effects at all.
		t.Run("no document-updated notification is delivered", func(t *testing.T) {})
	})

	t.Run("when reading and non-editing surfaces are used", func(t *testing.T) {
		// Edge case: reading surfaces are unaffected.
		t.Run("getting the document carries the version number an editor would send back", func(t *testing.T) {}) // FR-009
		t.Run("commenting on the document needs no base version and still succeeds", func(t *testing.T) {})
		t.Run("changing the document's status needs no base version and still succeeds", func(t *testing.T) {})
		t.Run("reading a ritual procedure document is unaffected", func(t *testing.T) {})
	})
}
```

---

## Web E2E — `document-conflict.spec.ts`

```ts
// Feature 049 — the conflict as a person experiences it.
// Arrange via API, act via UI, assert via UI. Traces User Story 2, FR-010..FR-012.
test.describe('Document edit conflict', () => {

  test.describe('when a colleague saves while someone is still typing', () => {
    test('the save is refused with a notice that says someone else changed the document', () => {});   // FR-004
    test('the notice names the colleague who saved and when', () => {});                               // FR-006, SC-004
    test('the notice reads differently from an ordinary save failure', () => {});                      // FR-004
    test('the text the person typed is still in the editor', () => {});                                // FR-010, SC-002
    test('the document is not silently replaced with the colleague’s version', () => {});              // FR-010
  });

  test.describe('when the person chooses not to reload yet', () => {
    test('they can keep editing and their text is not discarded', () => {});                           // US2-3
    test('they can copy their changes out of the editor', () => {});                                   // SC-003
  });

  test.describe('when the person chooses to load the current version', () => {
    test('the editor shows the colleague’s current content', () => {});                                // US2-2
    test('re-applying their change and saving succeeds', () => {});                                    // FR-012, SC-003
    test('the conflict notice is gone after the successful save', () => {});
  });

  test.describe('when the same person has the document open in two tabs', () => {
    test('the second tab’s save is refused just like a colleague’s', () => {});                        // edge case
  });

  test.describe('when a person edits, switches away from the tab and comes back', () => {
    // Guards the pre-existing refetch-on-focus hole this feature closes (research D7).
    test('their unsaved text is still in the editor', () => {});                                       // FR-010
  });

  test.describe('when one person edits a document alone', () => {
    test('saving works exactly as before, with no extra step', () => {});                              // SC-005
  });
});
```

---

## Requirement traceability

| Requirement | Covered by |
|---|---|
| FR-001 base version travels with an update | backend: common path; the request cannot be built without it |
| FR-002 refuse stale; change nothing | backend: "already replaced", "had also changed the title", followers |
| FR-003 refuse missing / non-existent base version | backend: "does not exist yet", "omits the base version" |
| FR-004 distinct, machine-recognisable conflict | backend: "reported as ABORTED…"; e2e: "reads differently" |
| FR-005 conflict states the current version | backend: detail scenarios |
| FR-006 conflict names who and when | backend: detail scenarios; e2e: "names the colleague" |
| FR-007 atomic check-and-write | backend: "two saves race" |
| FR-008 current base version behaves as before | backend: "the only person editing"; e2e: "edits a document alone" |
| FR-009 reader supplies the version number | backend: "getting the document carries the version number" |
| FR-010 editor keeps unsaved content | e2e: "text is still in the editor", "not silently replaced", "switches away and comes back" |
| FR-011 distinct notice, author and time, reload action | e2e: notice and reload groups |
| FR-012 next save after reload is accepted | backend: "reloads after a conflict"; e2e: "re-applying their change" |
| FR-013 never merge | backend: "the accepted content is the person's, not a merge" |
| SC-001..SC-006 | SC-001 backend conflict groups; SC-002/003 e2e keep-and-copy; SC-004 e2e names; SC-005 backend + e2e solo path; SC-006 backend race |
| User Story 3 | **Excluded from scope**, justified in `plan.md` |

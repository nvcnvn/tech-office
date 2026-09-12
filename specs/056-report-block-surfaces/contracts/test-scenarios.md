# Contract: Behavioural scenarios

**Feature**: 056-report-block-surfaces

This is the behavioural contract required by Constitution Principle II. The scenario
names below are the contract; they are written as `t.Run` / `test` stubs before any
implementation and reviewed as part of this plan. Implementation replaces the stubs;
no stub may remain skipped when the feature is done.

---

## 1. Backend integration — `backend/integration/compliance_report_test.go`

Extends the existing `TestContentReporting`. The file currently exercises
`chat_message` and `direct_message` only, because those were the only reachable
kinds. The two kinds this feature makes reachable have never been executed by a test.

```go
// FR-015: US3 — a file is reportable, and the server resolves its uploader
t.Run("when a person reports an uploaded file", func(t *testing.T) {
    t.Run("it is recorded with the file target kind", func(t *testing.T) {})
    t.Run("the reported author is the person who uploaded it", func(t *testing.T) {})
    t.Run("the snapshot names the file rather than quoting a message", func(t *testing.T) {})
    t.Run("it appears in the owner's report queue alongside message reports", func(t *testing.T) {})
})

// FR-019: US3 acceptance 5 — the file is gone by the time the reason is chosen
t.Run("when a person reports a file that no longer exists", func(t *testing.T) {
    t.Run("it is refused as a target that could not be found", func(t *testing.T) {})
    t.Run("the refusal carries the target-not-found reason, not a raw error", func(t *testing.T) {})
})

// FR-017: US4 — a document comment is reportable
t.Run("when a person reports a document comment", func(t *testing.T) {
    t.Run("it is recorded with the document-comment target kind", func(t *testing.T) {})
    t.Run("the reported author is the person who wrote the comment", func(t *testing.T) {})
    t.Run("the snapshot is the comment text as it stood", func(t *testing.T) {})
})

// FR-002: US1 acceptance 3 — a reply inside a direct conversation's thread
t.Run("when a person reports a reply inside a direct conversation's thread", func(t *testing.T) {
    t.Run("it is recorded with the direct-message target kind", func(t *testing.T) {})
})
```

**Arrange helpers.** `addDocumentComment` and `createDocument` already exist in
`helper_test.go`; `replyToMessage` already exists. One helper is new:

```go
// seedFile inserts a files.file_metadata row directly, the way
// voice_communication_test.go already seeds call artifacts — a real upload needs
// object storage the integration suite does not run.
func (w *testWorld) seedFile(uploader testUser, filename string) string
```

**Excluded, with justification.** No new backend scenario for blocking.
`compliance_block_test.go` already asserts that a block is recorded, that the blocked
person is notified of nothing, that no RPC reveals the block, that direct contact is
refused in both directions, that shared-channel visibility is untouched, and that
unblocking is idempotent. A block filed from a profile is byte-identical to one filed
from a message — US2 adds an entry point, not a behaviour — so a new scenario would
assert the same RPC a second time. SC-005's silence claim is already carried by
`"the blocked person is not notified"` in that file, which is the automated check
SC-005 asks for.

---

## 2. Web E2E — Playwright

### `frontend/apps/web/e2e/compliance-report.spec.ts` (extend)

Mirrors the backend names, per Principle II.

```typescript
// FR-016, FR-017: US4 — reporting a document comment
test.describe('when a person reports a document comment', () => {
    test('the comment offers a report control and the dialog names the comment', async ({ page }) => {});
    test('choosing a reason files the report and confirms', async ({ page }) => {});
    test('the report appears in the owner queue with the comment text as its snapshot', async ({ page }) => {});
});

// FR-016: a person does not report their own comment
test.describe('when a person opens the actions on their own comment', () => {
    test('no report control is offered', async ({ page }) => {});
});

// FR-014, FR-015: US3 — reporting a file from the web files page
test.describe('when a person reports a file from the files page', () => {
    test('the row offers a report control and the dialog names the file', async ({ page }) => {});
    test('the report is recorded against the file and reaches the owner queue', async ({ page }) => {});
});

// FR-019: the refusal is readable and in place
test.describe('when a person reports something they have already reported', () => {
    test('the dialog stays open and states that it is already reported', async ({ page }) => {});
});
```

**Arrange via API, act via UI, assert via UI**: the document, its comment and the file
row are created through `helpers/api.ts`; only the reporting itself is driven through
the browser.

---

## 3. Mobile — Maestro (`frontend/apps/mobile/.maestro/compliance/`)

### `report-thread-message.yaml` (new)

US1, FR-001, FR-004. Mirrors `report-message.yaml`, one screen deeper: sign in, open a
channel, post a probe message, open its thread, post a reply, long-press the reply,
`message-action-report`, `report-reason-harassment`, assert
`report-sheet-confirmation`. Posting its own message and its own reply is what makes
it deterministic — the existing flow's header records why acting on whatever happens
to be in a shared simulator account does not work.

### `block-from-profile.yaml` (new)

US2, FR-005, FR-006, FR-008, FR-011. Sign in, open **People**, open a colleague who is
not the signed-in person, assert `person-block-button` is visible, tap it, assert
`block-confirm` states the scope, confirm, and assert `person-unblock-button` is now
visible **without leaving the screen** — which is FR-008 expressed as an assertion.
Then unblock, to leave the shared account as it was found.

The flow ends by restoring state deliberately: the simulator account is shared between
flows, and a block left behind would refuse a later flow's direct conversation.

### `report-file.yaml` (new)

US3, FR-012. Sign in, **More → Files**, tap the report control on the first row,
choose a reason, assert the confirmation.

---

## 4. Traceability

| Requirement | Covered by |
|---|---|
| FR-001, FR-004 | `report-thread-message.yaml`; surface-controls rows 3–4 |
| FR-002 | backend "a reply inside a direct conversation's thread" |
| FR-003 | surface-controls rows 9–10 predicate; asserted by the absence assertion in `report-thread-message.yaml` (own reply offers no block) |
| FR-005…FR-008, FR-011 | `block-from-profile.yaml` |
| FR-009 | `block-from-profile.yaml` scope assertion; existing `block-person.yaml` |
| FR-010 | existing backend `"the blocked person is not notified"` |
| FR-012, FR-013 | `report-file.yaml`; backend "when a person reports an uploaded file" |
| FR-014, FR-015 | Playwright "reports a file from the files page"; backend file scenarios |
| FR-016, FR-017 | Playwright comment scenarios; backend "reports a document comment" |
| FR-018 | surface-controls "Shared forms"; verified by inspection in quickstart §5 |
| FR-019 | backend "a file that no longer exists"; Playwright "already reported" |
| FR-020 | unchanged server-side resolution; backend author-resolution assertions |
| FR-021 | every control in surface-controls carries a test id and appears in a flow above |
| FR-022 | no migration, proto or permission file is touched; verified in quickstart §6 |
| SC-001 | surface-controls table has no surface without a control |
| SC-002 | `block-from-profile.yaml` |
| SC-003 | quickstart §5 counts forms per client |
| SC-004 | `docs/compliance/reviewer-notes.md` walkthrough, quickstart §4 |
| SC-005 | existing backend notification-count scenario |
| SC-006 | Playwright "already reported"; backend target-not-found refusal |

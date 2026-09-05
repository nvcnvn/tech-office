# Quickstart: Validating Document Edit Conflict Protection

How to run and prove this feature end to end. Details of the contract live in
[contracts/document-update.md](./contracts/document-update.md); the scenarios being
run are listed in [contracts/test-scenarios.md](./contracts/test-scenarios.md).

---

## Prerequisites

```bash
make infra-up                                  # PostgreSQL + supporting services
cd backend && ./scripts/migrate.sh             # DATABASE_URL must be set
```

No new migration ships with this feature — `./scripts/migrate.sh` is here only so a
fresh database is at the current schema. `docs.document.version_count` already exists.

Then, in separate terminals, the backend and the web app as the repository's own dev
tooling starts them (see `backend/scripts/dev/` and the Makefile header).

## Regenerating the contract

The proto change touches Go and TypeScript from one place:

```bash
cd backend && buf generate     # writes backend/rpc/v1/*.pb.go and frontend/packages/rpc
cd backend && sqlc generate    # picks up the new @base_version parameter
make lint-tenancy              # the changed query must stay tenancy-clean
```

`backend/database/scripts/schema.sql` is **not** regenerated: this feature adds no
DDL, and that file is a generated snapshot that must never be hand-edited.

---

## 1. Backend behavioural contract

```bash
make test-backend-one T=TestDocumentEditConflict
```

**Expect**: every scenario in `TestDocumentEditConflict` passes, and `go test -v`
output reads as a description of the behaviour — a stale save refused, the stored
content unchanged, no version created, `ABORTED` with a populated
`DocumentVersionConflict`, and exactly one winner when two saves race.

The pre-existing document suites must stay green, because the common save path is
unchanged apart from carrying a base version:

```bash
make test-backend-one T='TestDocumentCRUD|TestDocumentVersion|TestDocumentDiff|TestWorkflowDocumentCollab|TestRitualProcedure'
```

**Expect**: all pass. If one fails to compile, it is a call site that still builds an
`UpdateDocumentRequest` without a base version — fix the call, not the rule.

## 2. Browser behavioural contract

```bash
make test-frontend-one F=document-conflict
```

**Expect**: the conflict notice appears, names the colleague, keeps the typed text,
and the copy-then-reload-then-save path ends in a successful save.

Regression on the surfaces that embed the same editor:

```bash
make test-frontend-one F=document-collab
make test-frontend-one F=task-lifecycle
```

## 3. Manual walkthrough — the scenario the feature exists for

1. Sign in as the owner and open a document under `/workspace/docs`.
2. Open the same document in a second browser profile as a colleague who has write
   access, and start editing there too. Leave both editors open.
3. In the **first** window, type a change and save. It succeeds; the version number
   advances.
4. In the **second** window, type a different change and save.

**Expect**:

- The save is refused with a notice distinct from an ordinary error, naming the person
  who saved in step 3 and when.
- The text typed in step 4 is still in the editor — nothing was replaced or cleared.
- Choosing not to reload leaves the editor usable and the text intact.
- Copying the changes, then loading the current version, shows step 3's content.
- Pasting the change back in and saving now succeeds.

Then check the two supporting cases:

- **Solo save (SC-005)**: with only one window open, edit and save repeatedly. Every
  save succeeds with no extra prompt, no extra click and no perceptible delay.
- **Two tabs, one person**: repeat steps 1–4 in two tabs of the *same* session. The
  second tab is refused exactly like the colleague's was.
- **Tab switching (FR-010)**: type an unsaved change, switch to another browser tab,
  wait past 30 seconds, and switch back. The typed text must still be there — the
  background refetch must not have replaced it.

## 4. Manual check of the atomicity guarantee

Two simultaneous saves from the same base version, straight at the RPC:

```bash
# Read the current version first (Document.version_count from GetDocument), then fire
# two UpdateDocument calls with that same base_version at once and compare outcomes.
```

**Expect**: one `200` and one `409 ABORTED`, never two of either, and exactly one new
row in `docs.document_version`. This is also covered automatically by the "two saves
race" scenario, which is the authoritative check; the manual version is for
confidence against a real deployment.

---

## Definition of done

- [ ] `make test-backend` green
- [ ] `make test-frontend` green
- [ ] `make lint-tenancy` green
- [ ] Mobile still builds and the read-only document screens still open
- [ ] `docs/domain/docs-knowledge.md` no longer says concurrent edits are resolved
      last-write-wins, and describes the refusal instead
- [ ] `backend/docs/SYSTEM-ARCHITECTURE.md` records the concurrency-control rule

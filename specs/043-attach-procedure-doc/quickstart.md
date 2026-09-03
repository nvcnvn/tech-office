# Quickstart: Validating The Procedure Document Attachment

How to prove this feature works end to end. Run in order — the backend suite is the
behavioural contract, the browser and device runs check that the contract reaches a person.

See [contracts/ritual-procedure.proto](./contracts/ritual-procedure.proto) for the RPC
surface and [data-model.md](./data-model.md) for the column, constraint and validation rules;
neither is repeated here.

---

## Prerequisites

Standard repository tooling only — no bespoke setup. Per the project's convention, use the
supported targets rather than improvising local equivalents.

```bash
make infra-up                 # PostgreSQL + supporting services (docker compose)
cd backend && ./scripts/migrate.sh   # apply forward migrations, DATABASE_URL set
```

The migration to apply is
`backend/database/migrations/20260904000002_ritual_procedure_document.up.sql`.

---

## 1. Schema and tenancy

The one gate that cannot be retrofitted. Run it before anything else, because a foreign key
that is not organization-leading is a schema change to undo, not a bug to patch.

```bash
backend/scripts/regen-schema.sh    # regenerate the snapshot; never hand-edit schema.sql
make lint-tenancy
```

**Expected**: `lint-tenancy` green. Confirm by eye in the regenerated
`backend/database/scripts/schema.sql` that the new constraint reads
`FOREIGN KEY (organization_id, procedure_document_id) REFERENCES docs.document(organization_id, id)`
— organization-leading, composite, `ON DELETE RESTRICT`. A single-column
`REFERENCES docs.document(id)` is a failure even if the linter is silent.

Also confirm `git status` shows `schema.sql` changed **only** in the ways the migration
implies. A hand-edit here is discarded on the next regeneration and is the classic way this
change goes wrong.

---

## 2. Code generation

```bash
cd backend && buf generate          # proto → Go + TS
cd backend && sqlc generate         # queries → typed Go
```

**Expected**: `RitualProcedure`, `GetRitualProcedureRequest/Response`,
`Document.document_type` and `DocumentType` appear in `backend/rpc/v1/*.pb.go` and in the
generated TypeScript the `apis` package consumes. No manual editing of generated files.

---

## 3. Backend integration suite — the behavioural contract

```bash
make test-backend-one T=TestRitualProcedureDocument
```

**Expected**: every scenario named in [plan.md](./plan.md#the-behavioural-contract-constitution-ii)
passes. `go test -v` output should read like the spec: a non-technical reader must be able to
match each line to a user story or an FR.

The scenarios that matter most, because they are the ones most likely to pass for the wrong
reason:

- **`an assigned worker with no document access grant can read the attached procedure`** —
  set up the worker with *no* `docs.document_access` row and the document `private`. If this
  passes because the test worker happens to own the document or the org grants blanket read,
  it proves nothing. FR-018.
- **`the implicit read does not put the document in the reader's document tree`** and its
  search and comment siblings — the same worker, immediately after reading the procedure,
  calling `GetDocumentTree`, `SearchDocuments`, `AddComment` and `UpdateDocument`. Tree and
  search must not contain it; comment and update must be refused. FR-019, FR-021.
- **`removing the attachment immediately ends the implicit read`** — read the procedure,
  detach, read again, expect `PermissionDenied`/absent with no intervening job, cache flush
  or delay. FR-020.
- **`attaching a procedure creates, deletes and detaches no instances and bumps no schedule
  version`** — count instances and record `schedule_version` before and after. FR-010,
  SC-006.
- **`a project member who is not owner or admin cannot attach, replace or remove`** — this
  one currently *fails against `main`*, because `UpdateRitualDefinition` performs no
  owner/admin resource check today. It is the pre-existing gap this feature closes; see
  [research.md D9](./research.md#d9-the-authorization-gap-on-updateritualdefinition).
- **`a deleted procedure document reports unavailable rather than disappearing`** followed by
  **`evidence can still be submitted, approved and rejected when the procedure is
  unavailable`** — soft-delete the document mid-instance and drive a full submit → approve
  cycle. FR-022, FR-023, SC-005.

Then run the surrounding suites, because this feature touches shared write paths:

```bash
make test-backend-one T='TestRitual|TestEvidence|TestDocs'
```

**Expected**: no regression. In particular `UpdateRitualDefinition`'s new resource check must
not break existing ritual tests — if it does, the test was relying on a member editing a
definition, which is the behaviour being corrected.

---

## 4. Web E2E

```bash
make test-frontend-one F=ritual-procedure-doc
```

**Expected**: all seven scenarios pass. The two that carry the feature's promise:

- **Manager attaches from the definition editor** and is shown the access warning *before*
  confirming (FR-008). The assertion is on the warning appearing before the write, not merely
  existing somewhere on the page.
- **Opening the procedure from the evidence capture form keeps the already-attached file and
  the typed note** (FR-013). Attach a file, type a note, open the procedure, close it, and
  assert both survived. This passes trivially with the overlay design and would be the first
  thing to break if someone later converts the entry point into a route — which is exactly
  why it is asserted rather than assumed.

Then the neighbouring suites:

```bash
make test-frontend-one F=ritual-submission-flow
make test-frontend-one F=collaboration-evidence-review-queue
```

**Expected**: unchanged. Specifically, a ritual with **no** procedure must render exactly as
before — no empty entry point, no placeholder, no layout shift (FR-017, SC-007).

---

## 5. Mobile

```bash
make test-mobile-one F=ritual-procedure-doc
```

Run it on **both** an Android emulator and an iOS simulator. The habitual test device here is
an iPhone SE, so a narrow-Android regression or an iOS-only prop goes unnoticed if only one
is checked.

**Expected**: the entry point is visible and labelled with the document title on the instance
screen; tapping it renders the procedure read-only; closing returns to the instance
unchanged; a photo attached before opening the procedure is still attached after closing.

Confirm by inspection that **no attachment control exists anywhere in the mobile app**
(FR-011) — mobile reads the procedure and never configures it.

```bash
make test-mobile-one F=ritual-submission-flow
```

**Expected**: unchanged.

---

## 6. Manual walkthrough — the promise, end to end

Worth doing once by hand, because it is the thing the spec actually asked for and no assertion
quite captures it.

1. **Web, as an owner**: create a workspace document "Store closing procedure" with real
   content. Open a ritual definition → attach it → observe the access warning → confirm.
   Time this: SC-002 says under a minute without creating or copying anything.
2. **Mobile, as an assigned worker with no grant on that document**: open today's instance of
   that ritual. The procedure is one tap from the instance and one tap from inside evidence
   capture (SC-001).
3. **Web, as the owner**: correct one line in the document. **Mobile, as the worker**: reopen
   the procedure — the correction is there, with no manager action and no instance
   regeneration (SC-003).
4. **Web, as the owner**: assign the ritual to a *different* worker who has never been near
   the document. They can read it immediately, with no per-person access administration
   (SC-004).
5. **Web, as the owner**: delete the document. The instance shows an explicit "procedure
   unavailable" state — not a missing entry point — and the worker can still submit evidence
   and complete the instance (SC-005).
6. **Web, as the owner**: attach the same document to a ritual in a second project. Permitted,
   not an error (FR-004).

---

## 7. Definition of Done

Beyond green tests, this change set is not done until:

- `docs/domain/rituals-tasks.md` describes the attachment, the read path, the access rule and
  the unavailable state — and `docs/domain/docs-knowledge.md` records that documents are now
  readable through a ritual by a path that does not touch `docs.document_access`. Both are
  part of this change set, not a follow-up.
- `backend/docs/SYSTEM-ARCHITECTURE.md` shows `DocsLogic.GetDocument` on the existing
  collaboration → docs edge.
- The drift register in `docs/domain/README.md` records that the procedure entry point does
  **not** use canonical resource links (feature 030), and why — see
  [research.md D5](./research.md#d5-how-the-procedure-is-presented). The spec expected it to;
  recording the disagreement is how that stays honest.
- `make lint-tenancy`, `make test-backend`, `make test-frontend` and `make test-mobile` are
  all green.

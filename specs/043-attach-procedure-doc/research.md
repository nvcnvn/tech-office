# Phase 0 Research: Procedure Document On A Ritual Definition

The spec left no `[NEEDS CLARIFICATION]` markers — it resolved its own ambiguities in the
Assumptions block. What follows are the **design** decisions the plan needs, each verified
against the code rather than against the numbered specs, per the repository's rule that
`docs/domain/` and the code are the record of behaviour.

---

## D1. Where the read is served from

**Decision**: a new `CollaborationService.GetRitualProcedure` RPC. `DocumentService` is not
touched and never learns that a ritual exists.

**Rationale**: FR-018 requires a read that ignores `docs.document_access`. Only two places
can grant it. If `DocumentService.GetDocument` were taught to accept a ritual-derived grant,
`internal/docs` would have to ask collaboration "does this employee reach this document
through a ritual?" — inverting the dependency. `internal/collaboration` already declares a
`DocsLogic` interface and calls docs (`task_logic.go:489` creates task description
documents), and `backend/docs/SYSTEM-ARCHITECTURE.md` puts the arrow that way round. Serving
the read from collaboration keeps the existing direction and adds one method to an interface
that already exists.

It also happens to be what makes FR-021 free. Because `docs.document_access` is never
written, there is no grant row for `ListRootDocuments`, `SearchDocuments` or
`ListFollowedDocuments` to pick up — those queries are unchanged and cannot see the
attachment. The same fact makes FR-020 free: clearing the column ends the access with
nothing to revoke.

**Alternatives considered**:

- *Write a real `docs.document_access` row per reader.* Rejected: assignees change every day
  under round-robin, least-assigned and on-shift pools, so the grant set would have to be
  maintained by a background job that has no natural trigger, and FR-021 would then be
  violated — a real grant row is exactly what puts a document in the reader's tree.
- *Write a grant row for the whole project.* Same FR-021 violation, and it would survive
  detachment until something noticed.
- *Deep-link to `/workspace/docs/{slug}` and let docs decide.* Rejected: that is precisely
  the "worker holds the checklist and is refused the procedure" failure the feature exists to
  remove.

## D2. The access bar for reading

**Decision**: `CheckProjectAccess(orgID, definition.project_id, employeeID, nil)` — no
required roles — plus `collab.viewTask` declared on the RPC.

**Rationale**: FR-018's bar is "anyone who can see an instance of the ritual". Instances are
`collaboration.task` rows in the definition's project, and task visibility is project
visibility. `CheckProjectAccess` with an empty `requiredRoles` returns true for a public
project and for any membership including `viewer`
(`internal/collaboration/membership_logic.go:322`), which is exactly the set that can see an
instance. Reviewers hold `collab.viewTask` too, so the review-queue path needs no second bar.

**Alternative considered**: "is the caller an assignee of some instance of this definition".
Rejected: it is a more expensive query and a *narrower* set than the one that can see the
instance, so a project admin looking at a worker's checklist would be refused the procedure
that explains it.

## D3. Where the title comes from

**Decision**: `RitualDefinition.procedure` — a resolved `RitualProcedure {document_id, title,
status, is_available}` — filled by `GetRitualDefinition` and `ListRitualDefinitions`.

**Rationale**: every ritual-instance detail surface on both clients already calls
`getRitualDefinition` through `hydrateRitualTask`
(`frontend/packages/apis/src/collaboration-ritual.ts:537`), so the entry point and its label
cost **no new client request** on Story 1's surfaces. The cost on the server is one point
read of `docs.document` by primary key per definition, and only when the column is non-null.

**Alternatives considered**:

- *Put `procedure` on `Task`.* Rejected: `ListTasks` would pay a batched document read per
  page for a label that list rows do not show, and the clients already have the definition
  in hand on the surfaces that do.
- *Return only the id and let the client fetch the title.* Rejected: the client cannot fetch
  it — `DocumentService` would refuse a worker without a grant, which is the whole problem.

## D4. What the review queue carries

**Decision**: `ReviewQueueEntry.procedure_document_id` — the raw id, no title — selected from
the `ritual_definition` join the queue already performs. The reviewer's decision surface
labels the control "Procedure" and fetches title and content from `GetRitualProcedure` when
it is opened.

**Rationale**: `ListEvidenceReviewQueue` is described in `docs/domain/rituals-tasks.md` as a
projection deliberately joined to everything a reviewer needs "without a second request", and
it already joins `collaboration.ritual_definition` for `ritual_name`. Adding one column to
that select costs nothing. Resolving the *title* would cost a document read per distinct
definition per page, and FR-014 — unlike FR-012 — does not require the entry point on the
review surface to be labelled with the document's title.

[ASSUMPTION: FR-012's "labelled with the document's current title" is scoped to surfaces that
show a ritual **instance** (task detail on web and mobile, and the evidence capture flow).
The review queue shows a *submission*, and FR-014 asks only that the entry point be present
there, so it is labelled "Procedure". This keeps a 25-entry page at zero extra document reads
and is what a careful reviewer of the two requirements side by side would conclude.]

[ASSUMPTION: the entry point is required on instance **detail** surfaces, not on every list
row that mentions an instance. A procedure chip on each row of a ritual worklist would be
noise, would cost a batched document read per page, and no acceptance scenario asks for it.]

## D5. How the procedure is presented

**Decision**: an overlay on the surface it was opened from — a MUI `Dialog` on web, a
full-screen `Modal` on mobile — never a navigation.

**Rationale**: FR-013 and FR-014 forbid discarding captured evidence, typed text and the
reviewer's queue position. An overlay does not unmount the surface underneath, so there is no
state to preserve and no way to get the preservation wrong. Navigating away and restoring
state would need a draft store on three surfaces and would still lose an in-flight file
selection. The "way back" FR-015 asks for is the dialog's close control.

The spec's Dependencies note expects the entry point to reuse canonical resource links
(feature 030). It does not: canonical links resolve to a *route*, and there is no route that
can render this document for a reader without a docs grant. The entry point is a control on
the instance, not a link to a page. This is recorded in the drift register rather than
silently ignored.

**Alternative considered**: a dedicated route, e.g. `/workspace/tasks/{id}/procedure`.
Rejected for the state-loss reason above, and because a route implies a shareable URL for a
document whose readability depends on the ritual it was reached through.

## D6. Rendering the content

**Decision**: reuse what each client already has.

- Web: a small `ProcedureDialog` using `useEditor({ editable: false })` with the same
  `StarterKit` / `Underline` / `Link` extensions the docs editor uses, fed the `content_json`
  string from `GetRitualProcedure`. It deliberately does **not** reuse
  `workspace/docs/components/DocumentEditor.tsx`, which carries save mutations, embeds,
  markdown mode, version history and a `getDocument` call — all of which are either
  forbidden here (FR-019) or would re-enter the docs access path.
- Mobile: the read-only TipTap-JSON renderer that already exists inline in
  `app/(app)/(more)/docs/[slug].tsx` is extracted to
  `src/components/docs/document-content.tsx` and used by both the docs viewer and the
  procedure sheet. Extraction, not duplication.

**Rationale**: rung 2 of the repository's laziness ladder — a renderer for this exact content
shape already lives a few files over.

## D7. Detecting "unavailable"

**Decision**: derived, never stored. `DocsLogic.GetDocument` returns `ErrDocumentNotFound`
and the resolver returns `RitualProcedure{document_id, is_available: false}` with an empty
title.

**Rationale**: `SoftDeleteDocument` sets `is_deleted = TRUE` and `GetDocumentByID` filters
`is_deleted = FALSE` (`backend/database/scripts/docs.query.sql:21,47`), so a deleted document
is simultaneously (a) still present as a row, which keeps the foreign key valid, and (b)
invisible to every read path. FR-022's unavailable state is therefore a failed point read,
with no reconciliation job, no `is_available` column and no risk of a stored flag drifting
from the truth.

The foreign key is `ON DELETE RESTRICT`, matching `fk_task_description`. Because the product
only soft-deletes documents, the restriction never fires in normal operation; it exists so
that a future hard delete cannot leave a dangling reference.

## D8. What "attachable" means

**Decision**: `document_type = 'workspace_doc'`, same organization, not soft-deleted. Any
`status` — including `archived` — is accepted.

**Rationale**: FR-003 and the "task description or project brief" edge case. The other two
types are owned by a task or a project and are reached through their owner; the docs tree
already filters them out for the same reason. Archived documents are explicitly accepted by
FR-024. The check needs the document's type, which the `Document` proto does not currently
carry, so one field — `DocumentType document_type = 16` — is added to it and populated in
`documentToProto`. That is smaller than a bespoke `DocsLogic` method returning a type, and it
is generally useful.

## D9. The authorization gap on `UpdateRitualDefinition`

**Decision**: add the project owner/admin resource check, and change the logic signature from
`(orgID, defID, req)` to `(orgID, employeeID, defID, req)`.

**Rationale**: `CreateRitualDefinition` checks `GetProjectMemberRole` for admin-or-owner
(`ritual_logic.go:35`) and `ChangeRitualDefinitionSchedule` calls `authorizeScheduleChange`
(`ritual_logic.go:541`), but `UpdateRitualDefinition` checks nothing above the interceptor's
`collab.manageRitualDefinition` permission — the parameter in its position is the definition
id and the employee id is never read. `docs/domain/rituals-tasks.md` already documents the
intended rule ("Ritual definition management requires `admin` or `owner` on the project —
that is a *resource* check inside the logic layer"), so the code is the outlier. Story 2 AC5
and FR-006 require the refusal on the attach path, and adding the check only for the
procedure field while leaving `name` and `recurrence_rule` open would be indefensible.

[ASSUMPTION: the check is added to the whole `UpdateRitualDefinition` call, not just to the
procedure field. Guarding one field of a request while the rest of it stays open is not a
security boundary. This makes the RPC stricter for existing callers — an org-wide
permission holder who is only a project `member` loses the ability to rename a ritual — which
is the documented intent and the same bar `CreateRitualDefinition` already applies.]

## D10. Schedule-change neutrality (FR-010, SC-006)

**Decision**: nothing to implement. Verified rather than assumed.

`UpdateRitualDefinition`'s connect handler ends with an explicit comment that a changed
recurrence rule needs no scheduling work, and its logic body writes columns and re-syncs
assignees and pools with no call into generation, no `schedule_version` increment and no
notification (`ritual_connect.go:134`, `ritual_logic.go:191`). Instance regeneration lives
only in `ChangeRitualDefinitionSchedule`, which this feature does not touch. The integration
scenario asserting zero instance churn therefore guards a property the code already has
against a future change, which is the right reason for it to exist.

## D11. Clearing the attachment over the wire

**Decision**: `optional string procedure_document_id` on `UpdateRitualDefinitionRequest`.
Absent → unchanged. Present and empty → detach. Present and non-empty → attach or replace.

**Rationale**: this is the convention the message's other `optional` fields already use, and
proto3 field presence makes "not mentioned" and "cleared" distinguishable without a
`FieldMask` or a separate `RemoveRitualProcedure` RPC. FR-001's "never a list" is enforced by
the field being singular — a definition cannot carry two procedures because there is nowhere
to put a second one.

## D12. The attach-time warning (FR-008)

**Decision**: client-side, in the web ritual definition editor, shown before the choice is
confirmed. No server involvement.

**Rationale**: it is a statement about what the system will do, not a fact the server holds,
and it must appear *before* the write. The Playwright scenario asserts it, which is what
stops it being quietly dropped in a later redesign of the editor.

[ASSUMPTION: the warning is a confirmation step in the chooser rather than a persisted
acknowledgement. Nothing in the spec asks for a record of who was warned, and storing one
would be a compliance feature nobody requested.]

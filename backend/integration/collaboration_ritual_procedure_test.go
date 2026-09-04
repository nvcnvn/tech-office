package integration

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/internal/collaboration"
	"github.com/nvcnvn/tech-office/backend/internal/docs"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Feature 043: Procedure Document On A Ritual Definition — behavioural contract.
//
// Each t.Run name is a sentence about observable behaviour; the trailing comment maps it
// to the requirement it proves. Read top to bottom, `go test -v` output reads like the
// spec.
//
// The one distinction the whole feature turns on and every scenario here respects:
// ABSENT (no procedure was ever attached, so a client renders nothing) is not the same
// state as UNAVAILABLE (a procedure is attached and can no longer be resolved, so a
// client renders an explicit unavailable state). Never tell them apart by testing the
// content for emptiness — use IsAvailable.

// ---------------------------------------------------------------------------
// Arrange: a ritual project, a manager, an ungranted worker, and documents
// ---------------------------------------------------------------------------

// procedureWorld is one ritual project with a live instance plus the cast of documents
// and people the scenarios need.
//
// The assigned worker deliberately holds NO docs.document_access row on the procedure
// document, and the document is private. Without both of those the reading scenarios
// prove nothing: they would pass on the reader's own grant rather than on the attachment.
type procedureWorld struct {
	owner    testUser
	admin    testUser
	member   testUser // a project member who is neither owner nor admin
	worker   testUser // assigned to the instance, no grant on any document
	outsider testUser // in the organization, not in the project

	projectID     string
	definitionID  string
	requirementID string
	taskID        string

	workspaceDoc    string // a private workspace_doc, the legitimate procedure
	secondDoc       string // a second workspace_doc, for replacement
	taskDescDoc     string // a task_description document, not attachable
	projectBriefDoc string // a project_brief document, not attachable
}

func (w *testWorld) newProcedureWorld() procedureWorld {
	w.t.Helper()

	owner := w.withOwner()
	admin := w.withEmployee()
	member := w.withEmployee()
	worker := w.withEmployee()
	outsider := w.withEmployee()

	proj := w.createProjectWithMode(owner, "Procedure Project", uniqueProjectKey("PROC"),
		rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL)
	w.addProjectMember(owner, proj.ID, admin.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_ADMIN)
	w.addProjectMember(owner, proj.ID, member.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
	w.addProjectMember(owner, proj.ID, worker.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)

	def := w.createRitualDefinitionWithAssigneesRequirementsAndWindow(
		owner, proj.ID, "Closing checks", dailyRecurrenceRule(), 8,
		[]string{worker.ID.String()},
		[]*rpcv1.CreateEvidenceRequirementInput{{
			Name:          "Gate note",
			EvidenceTypes: []rpcv1.EvidenceType{rpcv1.EvidenceType_EVIDENCE_TYPE_TEXT_NOTE},
			IsRequired:    true,
			ApprovalMode:  rpcv1.ApprovalMode_APPROVAL_MODE_MANUAL,
		}},
	)
	require.NotEmpty(w.t, def.EvidenceRequirements)

	w.generateRitualInstances(owner)
	instances := w.listTasksWithKind(owner, proj.ID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE))
	require.NotEmpty(w.t, instances, "expected the definition to generate at least one instance")
	kept := instances[0]
	for _, extra := range instances[1:] {
		w.detachRitualInstanceFromSweep(extra.Id)
	}

	// The owner's own documents. Private, and never shared with the worker.
	workspaceDoc := w.createDocument(owner, "Closing procedure", procedureContent("Lock the back door."))
	secondDoc := w.createDocument(owner, "Revised closing procedure", procedureContent("Lock both doors."))

	// The project admin is shared into both, because a manager may only attach a document
	// they can already read themselves (FR-007). This is what a real workspace looks like:
	// the people who configure the ritual have been given the procedure. The worker is
	// deliberately left out — every read scenario depends on them having no grant at all.
	w.setDocumentAccess(owner, workspaceDoc, admin.ID.String(), rpcv1.AccessLevel_ACCESS_LEVEL_READ_COMMENT)
	w.setDocumentAccess(owner, secondDoc, admin.ID.String(), rpcv1.AccessLevel_ACCESS_LEVEL_READ_COMMENT)

	// A task_description document, provisioned the way the product provisions one.
	plainTask := w.createTask(owner, proj.ID, "A plain task", proj.Levels[0].Id)
	opened := w.openTask(owner, plainTask)
	require.NotNil(w.t, opened.DescriptionDocumentId)

	// A project_brief document. No RPC creates one, so the type is set directly; the row
	// shape is what matters, not how it got there.
	projectBriefDoc := w.createDocument(owner, "Project brief", procedureContent("Why we exist."))
	w.setDocumentType(projectBriefDoc, "project_brief")

	return procedureWorld{
		owner:           owner,
		admin:           admin,
		member:          member,
		worker:          worker,
		outsider:        outsider,
		projectID:       proj.ID,
		definitionID:    def.Id,
		requirementID:   def.EvidenceRequirements[0].Id,
		taskID:          kept.Id,
		workspaceDoc:    workspaceDoc,
		secondDoc:       secondDoc,
		taskDescDoc:     *opened.DescriptionDocumentId,
		projectBriefDoc: projectBriefDoc,
	}
}

func procedureContent(text string) string {
	return `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"` + text + `"}]}]}`
}

// setDocumentType rewrites a document's type. Written directly because no RPC creates a
// project_brief document, and the refusal under test is about the stored type.
func (w *testWorld) setDocumentType(docID, docType string) {
	w.t.Helper()
	_, err := globalDB.Exec(context.Background(),
		`UPDATE docs.document SET document_type = $2 WHERE id = $1`,
		dbuuid.MustParse(docID), docType)
	require.NoError(w.t, err)
}

// setDocumentStatus archives or otherwise restatuses a document directly.
func (w *testWorld) setDocumentStatus(docID, status string) {
	w.t.Helper()
	_, err := globalDB.Exec(context.Background(),
		`UPDATE docs.document SET status = $2 WHERE id = $1`,
		dbuuid.MustParse(docID), status)
	require.NoError(w.t, err)
}

// renameDocument changes a document's title directly, which is what a manager editing it
// in the documents feature does.
func (w *testWorld) renameDocument(docID, title string) {
	w.t.Helper()
	_, err := globalDB.Exec(context.Background(),
		`UPDATE docs.document SET title = $2 WHERE id = $1`,
		dbuuid.MustParse(docID), title)
	require.NoError(w.t, err)
}

// documentAccessRowCount counts a reader's explicit grants on a document. The reading
// scenarios assert it stays zero: the implicit read is a path, not a row, which is the
// whole reason it cannot leak into the tree, search or the followed list.
func (w *testWorld) documentAccessRowCount(docID string, employeeID dbuuid.UUID) int {
	w.t.Helper()
	var n int
	err := globalDB.QueryRow(context.Background(),
		`SELECT count(*) FROM docs.document_access WHERE document_id = $1 AND grantee_id = $2`,
		dbuuid.MustParse(docID), employeeID,
	).Scan(&n)
	require.NoError(w.t, err)
	return n
}

// ---------------------------------------------------------------------------
// Act: attaching and reading a procedure
// ---------------------------------------------------------------------------

func (w *testWorld) attachProcedure(actor testUser, defID, docID string) *rpcv1.RitualDefinition {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.UpdateRitualDefinitionRequest{
		RitualDefinitionId:  defID,
		ProcedureDocumentId: ptr(docID),
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.collab.UpdateRitualDefinition(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.RitualDefinition
}

func (w *testWorld) attachProcedureError(actor testUser, defID, docID string) error {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.UpdateRitualDefinitionRequest{
		RitualDefinitionId:  defID,
		ProcedureDocumentId: ptr(docID),
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.collab.UpdateRitualDefinition(context.Background(), req)
	return err
}

func (w *testWorld) getRitualProcedure(actor testUser, defID string) *rpcv1.GetRitualProcedureResponse {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.GetRitualProcedureRequest{RitualDefinitionId: defID})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.collab.GetRitualProcedure(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg
}

func (w *testWorld) getRitualProcedureError(actor testUser, defID string) error {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.GetRitualProcedureRequest{RitualDefinitionId: defID})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.collab.GetRitualProcedure(context.Background(), req)
	return err
}

// ritualDefinitionColumns reads the two columns a schedule change would move, so
// "attaching is not a schedule change" can be asserted rather than assumed.
func (w *testWorld) ritualScheduleVersion(defID string) int32 {
	w.t.Helper()
	var v int32
	err := globalDB.QueryRow(context.Background(),
		`SELECT schedule_version FROM collaboration.ritual_definition WHERE id = $1`,
		dbuuid.MustParse(defID),
	).Scan(&v)
	require.NoError(w.t, err)
	return v
}

// ===========================================================================
// User Story 2 — attach, replace and remove (FR-001…FR-010)
// ===========================================================================

func TestRitualProcedureDocumentAttachment(t *testing.T) {
	w := newTestWorld(t)
	s := w.newProcedureWorld()

	t.Run("manager attaches a workspace document and the definition reports it as its procedure", func(t *testing.T) {
		// FR-001, FR-002, FR-012
		def := w.attachProcedure(s.owner, s.definitionID, s.workspaceDoc)
		require.NotNil(t, def.Procedure, "an attached procedure must be reported on the definition")
		assert.Equal(t, s.workspaceDoc, def.Procedure.DocumentId)
		assert.Equal(t, "Closing procedure", def.Procedure.Title, "the entry point is labelled with the document's title")
		assert.True(t, def.Procedure.IsAvailable)

		reread := w.getRitualDefinition(s.owner, s.definitionID)
		require.NotNil(t, reread.Procedure)
		assert.Equal(t, s.workspaceDoc, reread.Procedure.DocumentId)
	})

	t.Run("attaching a second document replaces the first rather than accumulating", func(t *testing.T) {
		// FR-001 — the field is singular, so a second procedure has nowhere to go.
		def := w.attachProcedure(s.owner, s.definitionID, s.secondDoc)
		require.NotNil(t, def.Procedure)
		assert.Equal(t, s.secondDoc, def.Procedure.DocumentId)
		assert.Equal(t, "Revised closing procedure", def.Procedure.Title)
	})

	t.Run("removing the attachment leaves the document intact in the workspace", func(t *testing.T) {
		// FR-009 — detaching is a write to the ritual, never to the document.
		w.attachProcedure(s.owner, s.definitionID, s.workspaceDoc)

		req := connect.NewRequest(&rpcv1.UpdateRitualDefinitionRequest{
			RitualDefinitionId:  s.definitionID,
			ProcedureDocumentId: ptr(""),
		})
		req.Header().Set("Authorization", "Bearer "+s.owner.Token)
		resp, err := w.collab.UpdateRitualDefinition(context.Background(), req)
		require.NoError(t, err)
		assert.Nil(t, resp.Msg.RitualDefinition.Procedure, "a detached definition reports no procedure at all")

		doc := w.getDocument(s.owner, s.workspaceDoc)
		require.NotNil(t, doc.Document)
		assert.Equal(t, "Closing procedure", doc.Document.Title, "the document is untouched by the detach")
	})

	t.Run("attaching a document from another organization is refused with a field violation", func(t *testing.T) {
		// FR-003 — and indistinguishable from a document that does not exist, by design.
		other := newTestWorld(t)
		otherOwner := other.withOwner()
		foreignDoc := other.createDocument(otherOwner, "Someone else's procedure", procedureContent("Not yours."))

		err := w.attachProcedureError(s.owner, s.definitionID, foreignDoc)
		require.Error(t, err)
		assert.Equal(t, connect.CodeInvalidArgument, connect.CodeOf(err))
		assert.Contains(t, fieldViolations(t, err), "procedure_document_id")
	})

	t.Run("attaching a document the manager cannot read themselves is refused with a field violation", func(t *testing.T) {
		// FR-007 — attaching grants sight of the document to everyone who can see an
		// instance of the ritual, so the manager must be able to open it themselves first.
		// The document belongs to another employee in the same organization and is private;
		// the admin has no grant on it. It is refused exactly like a nonexistent one, so the
		// refusal does not disclose that it exists.
		privateToSomeoneElse := w.createDocument(s.worker, "The worker's own notes",
			procedureContent("Not shared with anyone."))
		require.Error(t, w.getDocumentError(s.admin, privateToSomeoneElse),
			"the admin must not be able to read it, or the scenario is vacuous")

		err := w.attachProcedureError(s.admin, s.definitionID, privateToSomeoneElse)
		require.Error(t, err)
		assert.Equal(t, connect.CodeInvalidArgument, connect.CodeOf(err))
		assert.Contains(t, fieldViolations(t, err), "procedure_document_id")
	})

	t.Run("attaching a task_description document is refused with a field violation", func(t *testing.T) {
		// FR-003 — it is owned by a task and reached through its task.
		err := w.attachProcedureError(s.owner, s.definitionID, s.taskDescDoc)
		require.Error(t, err)
		assert.Equal(t, connect.CodeInvalidArgument, connect.CodeOf(err))
		assert.Contains(t, fieldViolations(t, err), "procedure_document_id")
	})

	t.Run("attaching a project_brief document is refused with a field violation", func(t *testing.T) {
		// FR-003 — it is owned by a project and reached through its project.
		err := w.attachProcedureError(s.owner, s.definitionID, s.projectBriefDoc)
		require.Error(t, err)
		assert.Equal(t, connect.CodeInvalidArgument, connect.CodeOf(err))
		assert.Contains(t, fieldViolations(t, err), "procedure_document_id")
	})

	t.Run("a project member who is not owner or admin cannot attach, replace or remove", func(t *testing.T) {
		// FR-006 — a bare PermissionDenied with no detail: naming the project would
		// disclose it. Before this feature UpdateRitualDefinition checked nothing at all.
		err := w.attachProcedureError(s.member, s.definitionID, s.workspaceDoc)
		require.Error(t, err)
		assert.Equal(t, connect.CodePermissionDenied, connect.CodeOf(err))
		assert.Empty(t, fieldViolations(t, err), "the refusal must carry no detail")

		// A project admin may.
		def := w.attachProcedure(s.admin, s.definitionID, s.workspaceDoc)
		require.NotNil(t, def.Procedure)
		assert.Equal(t, s.workspaceDoc, def.Procedure.DocumentId)
	})

	t.Run("attaching a procedure creates, deletes and detaches no instances and bumps no schedule version", func(t *testing.T) {
		// FR-010, SC-006 — attaching is not a schedule change.
		before := w.listTasksWithKind(s.owner, s.projectID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE))
		versionBefore := w.ritualScheduleVersion(s.definitionID)

		w.attachProcedure(s.owner, s.definitionID, s.secondDoc)

		after := w.listTasksWithKind(s.owner, s.projectID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE))
		assert.Len(t, after, len(before), "no instance is created or removed")
		assert.Equal(t, versionBefore, w.ritualScheduleVersion(s.definitionID), "schedule_version is untouched")
	})

	t.Run("attaching a procedure notifies nobody", func(t *testing.T) {
		// FR-010 — a worker sees the procedure next time they open the instance.
		before := w.countNotificationsForEmployee(s.worker.ID)
		w.attachProcedure(s.owner, s.definitionID, s.workspaceDoc)
		assert.Equal(t, before, w.countNotificationsForEmployee(s.worker.ID))
	})

	t.Run("one document can be the procedure of several definitions across several projects", func(t *testing.T) {
		// FR-004 — the attachment is a reference, so there is no uniqueness to violate.
		second := w.createProjectWithMode(s.owner, "Second Procedure Project", uniqueProjectKey("PRC2"),
			rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL)
		otherDef := w.createRitualDefinition(s.owner, second.ID, "Opening checks", dailyRecurrenceRule())

		w.attachProcedure(s.owner, s.definitionID, s.workspaceDoc)
		w.attachProcedure(s.owner, otherDef.Id, s.workspaceDoc)

		first := w.getRitualDefinition(s.owner, s.definitionID)
		other := w.getRitualDefinition(s.owner, otherDef.Id)
		require.NotNil(t, first.Procedure)
		require.NotNil(t, other.Procedure)
		assert.Equal(t, s.workspaceDoc, first.Procedure.DocumentId)
		assert.Equal(t, s.workspaceDoc, other.Procedure.DocumentId)
	})

	t.Run("an update that omits procedure_document_id leaves the existing attachment alone", func(t *testing.T) {
		// FR-001 — absent, present-empty and present-non-empty are three different
		// requests, and only the last two touch the column.
		w.attachProcedure(s.owner, s.definitionID, s.workspaceDoc)

		renamed := w.updateRitualDefinition(s.owner, s.definitionID, ptr("Closing checks v2"))
		assert.Equal(t, "Closing checks v2", renamed.Name)
		require.NotNil(t, renamed.Procedure, "an unrelated edit must not detach the procedure")
		assert.Equal(t, s.workspaceDoc, renamed.Procedure.DocumentId)
	})
}

// ===========================================================================
// User Story 1 — reading the procedure (FR-012, FR-015…FR-021)
// ===========================================================================

func TestRitualProcedureDocumentReading(t *testing.T) {
	w := newTestWorld(t)
	s := w.newProcedureWorld()
	w.attachProcedure(s.owner, s.definitionID, s.workspaceDoc)

	t.Run("an assigned worker with no document access grant can read the attached procedure", func(t *testing.T) {
		// FR-018 — the attachment IS the grant. The document is private and the worker
		// holds no docs.document_access row; without both this scenario proves nothing.
		require.Zero(t, w.documentAccessRowCount(s.workspaceDoc, s.worker.ID),
			"the worker must hold no explicit grant, or the scenario is vacuous")
		require.Error(t, w.getDocumentError(s.worker, s.workspaceDoc),
			"the worker must not be able to read the document through the docs service")

		got := w.getRitualProcedure(s.worker, s.definitionID)
		require.NotNil(t, got.Procedure)
		assert.True(t, got.Procedure.IsAvailable)
		assert.Equal(t, "Closing procedure", got.Procedure.Title)
		assert.Contains(t, got.ContentJson, "Lock the back door.")
	})

	t.Run("a project viewer who can see the instance can read the attached procedure", func(t *testing.T) {
		// FR-018 — "can see an instance" is exactly "can see the project", so no role is
		// required beyond membership.
		viewer := w.withEmployee()
		w.addProjectMember(s.owner, s.projectID, viewer.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_VIEWER)

		got := w.getRitualProcedure(viewer, s.definitionID)
		require.NotNil(t, got.Procedure)
		assert.True(t, got.Procedure.IsAvailable)
	})

	t.Run("the definition reports the document's current title after the document is renamed", func(t *testing.T) {
		// FR-012 — the title is resolved on every read, never snapshotted.
		w.renameDocument(s.workspaceDoc, "Closing procedure (rev C)")
		defer w.renameDocument(s.workspaceDoc, "Closing procedure")

		def := w.getRitualDefinition(s.worker, s.definitionID)
		require.NotNil(t, def.Procedure)
		assert.Equal(t, "Closing procedure (rev C)", def.Procedure.Title)
	})

	t.Run("editing the procedure document changes what an open instance resolves, with no snapshot", func(t *testing.T) {
		// FR-016 — correcting the procedure corrects every open and future instance at
		// once, because there is no copy anywhere to go stale.
		w.updateDocument(s.owner, s.workspaceDoc, procedureContent("Lock the back door AND the gate."))

		got := w.getRitualProcedure(s.worker, s.definitionID)
		assert.Contains(t, got.ContentJson, "AND the gate.")
	})

	t.Run("the implicit read does not put the document in the reader's document tree", func(t *testing.T) {
		// FR-021 — nothing is written to docs.document_access, so the read leaves the
		// reader's tree byte-for-byte where it was. The assertion is before-and-after
		// rather than "absent from the list": DocumentService.ListDocuments returns every
		// workspace document in the organization without consulting the caller's grants,
		// which is pre-existing docs behaviour this feature neither uses nor changes (see
		// the drift register in docs/domain/README.md). Asserting absence would test that
		// unrelated gap; asserting no change tests what this feature controls.
		before := documentIDs(w.listDocuments(s.worker, 100))
		require.Zero(t, w.documentAccessRowCount(s.workspaceDoc, s.worker.ID))

		w.getRitualProcedure(s.worker, s.definitionID)

		assert.Zero(t, w.documentAccessRowCount(s.workspaceDoc, s.worker.ID),
			"the implicit read must not write a grant row — a path, never a row")
		assert.Equal(t, before, documentIDs(w.listDocuments(s.worker, 100)),
			"reading the procedure must not change what the reader's tree contains")
	})

	t.Run("the implicit read does not put the document in the reader's search results", func(t *testing.T) {
		// FR-021
		w.getRitualProcedure(s.worker, s.definitionID)
		for _, r := range w.searchDocuments(s.worker, "Closing procedure") {
			assert.NotEqual(t, s.workspaceDoc, r.GetDocument().GetId(),
				"the procedure must not appear in the reader's search results")
		}
	})

	t.Run("the implicit read does not let the reader comment on, react to or update the document", func(t *testing.T) {
		// FR-019 — commenting, reacting and editing stay on DocumentService, where the
		// reader's own access decides. The procedure path grants reading and nothing else.
		w.getRitualProcedure(s.worker, s.definitionID)

		assert.Error(t, w.addDocumentCommentError(s.worker, s.workspaceDoc, "Can we change this?"))
		assert.Error(t, w.updateDocumentError(s.worker, s.workspaceDoc, procedureContent("Rewritten by a reader.")))
		assert.Error(t, w.getDocumentError(s.worker, s.workspaceDoc))
	})

	t.Run("the implicit read does not extend to the attached document's child pages", func(t *testing.T) {
		// FR-019 — the grant is on the attached document, not on a subtree.
		child := w.createChildDocument(s.owner, s.workspaceDoc, "Appendix A", procedureContent("Serial numbers."))
		assert.Error(t, w.getDocumentError(s.worker, child),
			"a child of the procedure is not reachable through the ritual")
	})

	t.Run("removing the attachment immediately ends the implicit read", func(t *testing.T) {
		// FR-020 — the access disappears the instant the column is cleared, because there
		// is nothing to revoke.
		w.detachProcedure(s.owner, s.definitionID)

		got := w.getRitualProcedure(s.worker, s.definitionID)
		assert.Nil(t, got.Procedure, "a detached definition reports no procedure")
		assert.Empty(t, got.ContentJson)

		w.attachProcedure(s.owner, s.definitionID, s.workspaceDoc)
	})

	t.Run("deleting the definition immediately ends the implicit read", func(t *testing.T) {
		// FR-020 — deleting the definition takes the column with it.
		doomedProj := w.createProjectWithMode(s.owner, "Doomed Procedure Project", uniqueProjectKey("DOOM"),
			rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL)
		w.addProjectMember(s.owner, doomedProj.ID, s.worker.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
		doomed := w.createRitualDefinition(s.owner, doomedProj.ID, "Doomed ritual", dailyRecurrenceRule())
		w.attachProcedure(s.owner, doomed.Id, s.workspaceDoc)
		require.NotNil(t, w.getRitualProcedure(s.worker, doomed.Id).Procedure)

		w.deleteRitualDefinitionDirect(doomed.Id)

		err := w.getRitualProcedureError(s.worker, doomed.Id)
		require.Error(t, err, "a deleted definition grants nothing")
		assert.Equal(t, connect.CodeNotFound, connect.CodeOf(err))
	})

	t.Run("an employee outside the definition's project cannot read the procedure", func(t *testing.T) {
		// FR-018 — a bare PermissionDenied with no detail: naming the project or the
		// ritual would disclose work the caller may not know exists.
		private := w.createProject(s.owner, "Private Procedure Project", uniqueProjectKey("PRIV"))
		w.setProjectVisibilityPrivate(private.ID)
		privateDef := w.createRitualDefinition(s.owner, private.ID, "Private ritual", dailyRecurrenceRule())
		w.attachProcedure(s.owner, privateDef.Id, s.workspaceDoc)

		err := w.getRitualProcedureError(s.outsider, privateDef.Id)
		require.Error(t, err)
		assert.Equal(t, connect.CodePermissionDenied, connect.CodeOf(err))
		assert.Empty(t, fieldViolations(t, err), "the refusal must carry no detail")
	})

	t.Run("a definition with no procedure reports none and GetRitualProcedure returns none", func(t *testing.T) {
		// FR-017 — absent renders nothing at all. No empty entry point, no placeholder.
		bare := w.createRitualDefinition(s.owner, s.projectID, "Ritual with no procedure", dailyRecurrenceRule())

		assert.Nil(t, w.getRitualDefinition(s.worker, bare.Id).Procedure)
		got := w.getRitualProcedure(s.worker, bare.Id)
		assert.Nil(t, got.Procedure)
		assert.Empty(t, got.ContentJson)
	})
}

// ===========================================================================
// Degradation — an unavailable procedure never blocks the work (FR-022…FR-024)
// ===========================================================================

func TestRitualProcedureDocumentDegradation(t *testing.T) {
	w := newTestWorld(t)
	s := w.newProcedureWorld()
	w.attachProcedure(s.owner, s.definitionID, s.workspaceDoc)

	t.Run("a deleted procedure document reports unavailable rather than disappearing", func(t *testing.T) {
		// FR-022 — attached-but-unresolvable is NOT the same state as never-attached, and
		// a client must never tell them apart by testing the content for emptiness.
		gone := w.createDocument(s.owner, "Doomed procedure", procedureContent("About to vanish."))
		def := w.createRitualDefinition(s.owner, s.projectID, "Ritual with a doomed procedure", dailyRecurrenceRule())
		w.attachProcedure(s.owner, def.Id, gone)
		w.deleteDocument(s.owner, gone)

		reread := w.getRitualDefinition(s.worker, def.Id)
		require.NotNil(t, reread.Procedure, "the attachment is still recorded")
		assert.Equal(t, gone, reread.Procedure.DocumentId, "the id survives so 'deleted' can be told from 'never attached'")
		assert.False(t, reread.Procedure.IsAvailable)
		assert.Empty(t, reread.Procedure.Title)
		assert.Equal(t, rpcv1.DocumentStatus_DOCUMENT_STATUS_UNSPECIFIED, reread.Procedure.Status)

		got := w.getRitualProcedure(s.worker, def.Id)
		require.NotNil(t, got.Procedure)
		assert.False(t, got.Procedure.IsAvailable)
		assert.Empty(t, got.ContentJson)
	})

	t.Run("evidence can still be submitted, approved and rejected when the procedure is unavailable", func(t *testing.T) {
		// FR-023 — the procedure is a reference, never a gate.
		gone := w.createDocument(s.owner, "Second doomed procedure", procedureContent("Also vanishing."))
		w.attachProcedure(s.owner, s.definitionID, gone)
		w.deleteDocument(s.owner, gone)

		sub := w.submitTextEvidence(s.worker, s.taskID, s.requirementID, "Doors locked.")
		rejected := w.rejectEvidence(s.owner, sub.Id, "Photo missing.")
		assert.Equal(t, rpcv1.ApprovalStatus_APPROVAL_STATUS_REJECTED, rejected.ApprovalStatus)

		resub := w.submitTextEvidence(s.worker, s.taskID, s.requirementID, "Doors locked, photo attached.")
		approved := w.approveEvidence(s.owner, resub.Id, "Fine.")
		assert.Equal(t, rpcv1.ApprovalStatus_APPROVAL_STATUS_APPROVED, approved.ApprovalStatus)
	})

	t.Run("an instance whose procedure is unavailable still reaches verified", func(t *testing.T) {
		// FR-023 — an unavailable procedure blocks no state transition.
		assert.Equal(t, "verified", w.ritualStateCategory(s.taskID))
	})

	t.Run("an archived procedure document is still readable and reports its archived status", func(t *testing.T) {
		// FR-024 — an archived procedure is usually one somebody forgot to unarchive, and
		// is still better than none. Any status is accepted on attach, archived included.
		archived := w.createDocument(s.owner, "Archived procedure", procedureContent("Old but true."))
		w.setDocumentStatus(archived, "archived")

		def := w.createRitualDefinition(s.owner, s.projectID, "Ritual with an archived procedure", dailyRecurrenceRule())
		attached := w.attachProcedure(s.owner, def.Id, archived)
		require.NotNil(t, attached.Procedure, "an archived document is a legitimate procedure")

		got := w.getRitualProcedure(s.worker, def.Id)
		require.NotNil(t, got.Procedure)
		assert.True(t, got.Procedure.IsAvailable)
		assert.Equal(t, rpcv1.DocumentStatus_DOCUMENT_STATUS_ARCHIVED, got.Procedure.Status)
		assert.Contains(t, got.ContentJson, "Old but true.")
	})

	t.Run("an instance detached from its ritual reports no procedure", func(t *testing.T) {
		// FR-017 — an instance resolves through its definition, so one with no definition
		// has nothing to resolve through. No code implements this; it falls out.
		def := w.createRitualDefinition(s.owner, s.projectID, "Ritual to detach from", dailyRecurrenceRule())
		w.attachProcedure(s.owner, def.Id, s.workspaceDoc)
		w.generateRitualInstances(s.owner)
		instances := w.listTasksWithKind(s.owner, s.projectID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE))

		var detached *rpcv1.Task
		for _, inst := range instances {
			if inst.RitualDefinitionId == def.Id {
				w.detachRitualInstanceFromSweep(inst.Id)
				detached = w.getTask(s.owner, inst.Id)
				break
			}
		}
		require.NotNil(t, detached, "expected the definition to generate an instance")
		assert.True(t, detached.DetachedFromRitual,
			"a detached instance is flagged detached — this is the flag every procedure entry point gates on")
	})

	t.Run("an archived definition keeps its attachment and reports it again on unarchive", func(t *testing.T) {
		// FR-017 — archiving does not touch the column, so unarchiving restores nothing
		// because nothing was removed.
		def := w.createRitualDefinition(s.owner, s.projectID, "Ritual to archive", dailyRecurrenceRule())
		w.attachProcedure(s.owner, def.Id, s.workspaceDoc)

		_, err := w.archiveRitualDefinition(s.owner, def.Id, true)
		require.NoError(t, err)
		archived := w.getRitualDefinition(s.owner, def.Id)
		require.NotNil(t, archived.Procedure, "archiving keeps the attachment")
		assert.Equal(t, s.workspaceDoc, archived.Procedure.DocumentId)

		_, err = w.archiveRitualDefinition(s.owner, def.Id, false)
		require.NoError(t, err)
		restored := w.getRitualDefinition(s.owner, def.Id)
		require.NotNil(t, restored.Procedure)
		assert.Equal(t, s.workspaceDoc, restored.Procedure.DocumentId)
	})
}

// ===========================================================================
// User Story 3 — deciding evidence against the procedure (FR-014)
// ===========================================================================

func TestRitualProcedureDocumentReviewQueue(t *testing.T) {
	w := newTestWorld(t)
	s := w.newProcedureWorld()
	w.attachProcedure(s.owner, s.definitionID, s.workspaceDoc)

	sub := w.submitTextEvidence(s.worker, s.taskID, s.requirementID, "Doors locked.")
	require.NotEmpty(t, sub.Id)

	t.Run("a queue entry for a ritual with a procedure carries the procedure document id", func(t *testing.T) {
		// FR-014 — the id only, from the join the queue already performs. Zero extra
		// queries per page; the reviewer's control fetches title and content when opened.
		entry := w.findQueueEntry(s.owner, sub.Id)
		require.NotNil(t, entry, "the submission should be in the reviewer's queue")
		assert.Equal(t, s.workspaceDoc, entry.ProcedureDocumentId)
	})

	t.Run("a queue entry for a ritual without a procedure carries none", func(t *testing.T) {
		// FR-017 — absent stays absent all the way to the decision surface.
		bareProj := w.createProjectWithMode(s.owner, "Bare Procedure Project", uniqueProjectKey("BARE"),
			rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL)
		w.addProjectMember(s.owner, bareProj.ID, s.worker.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
		bare := w.newProcedurelessSubmission(s.owner, s.worker, bareProj.ID)

		entry := w.findQueueEntry(s.owner, bare)
		require.NotNil(t, entry)
		assert.Empty(t, entry.ProcedureDocumentId)
	})

	t.Run("a reviewer can read the procedure for a submission they may decide", func(t *testing.T) {
		// FR-014 — the reviewer reaches the procedure by the same path as the worker.
		got := w.getRitualProcedure(s.owner, s.definitionID)
		require.NotNil(t, got.Procedure)
		assert.True(t, got.Procedure.IsAvailable)
		assert.Contains(t, got.ContentJson, "Lock the back door.")
	})
}

// ---------------------------------------------------------------------------
// Helpers the scenarios above need and no other feature had a use for
// ---------------------------------------------------------------------------

// detachProcedure clears the attachment. Present-and-empty is the detach request; absent
// would leave the column alone, which is a different request entirely.
func (w *testWorld) detachProcedure(actor testUser, defID string) *rpcv1.RitualDefinition {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.UpdateRitualDefinitionRequest{
		RitualDefinitionId:  defID,
		ProcedureDocumentId: ptr(""),
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.collab.UpdateRitualDefinition(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.RitualDefinition
}

// countNotificationsForEmployee counts every notification an employee has received, of
// any type. The attach scenario asserts the total does not move, which is stronger than
// asserting one type is absent: it also catches a new type nobody thought to exclude.
func (w *testWorld) countNotificationsForEmployee(employeeID dbuuid.UUID) int {
	w.t.Helper()
	var count int
	err := globalDB.QueryRow(context.Background(),
		`SELECT count(*) FROM notification.notification_recipient WHERE employee_id = $1`,
		employeeID).Scan(&count)
	require.NoError(w.t, err)
	return count
}

// deleteRitualDefinitionDirect removes a definition outright. No RPC deletes one —
// archiving is the product action — but FR-020 is about what happens when the row that
// carries the attachment stops existing.
func (w *testWorld) deleteRitualDefinitionDirect(defID string) {
	w.t.Helper()
	id := dbuuid.MustParse(defID)
	_, err := globalDB.Exec(context.Background(),
		`DELETE FROM collaboration.task WHERE ritual_definition_id = $1`, id)
	require.NoError(w.t, err)
	_, err = globalDB.Exec(context.Background(),
		`DELETE FROM collaboration.ritual_definition WHERE id = $1`, id)
	require.NoError(w.t, err)
}

// setProjectVisibilityPrivate closes a project, so that a non-member is genuinely outside
// it. A public project is readable by the whole organization, which would make the
// out-of-project refusal scenario vacuous.
func (w *testWorld) setProjectVisibilityPrivate(projectID string) {
	w.t.Helper()
	_, err := globalDB.Exec(context.Background(),
		`UPDATE collaboration.project SET visibility = 'private' WHERE id = $1`,
		dbuuid.MustParse(projectID))
	require.NoError(w.t, err)
}

func (w *testWorld) searchDocuments(actor testUser, query string) []*rpcv1.SearchResult {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.SearchDocumentsRequest{Query: query, Limit: 50})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.doc.SearchDocuments(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Results
}

func (w *testWorld) createChildDocument(actor testUser, parentID, title, contentJSON string) string {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.CreateDocumentRequest{
		Title:            title,
		ParentDocumentId: parentID,
		ContentJson:      contentJSON,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.doc.CreateDocument(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Document.Id
}

func (w *testWorld) addDocumentCommentError(actor testUser, docID, text string) error {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.AddCommentRequest{DocumentId: docID, CommentText: text})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.docComment.AddComment(context.Background(), req)
	return err
}

func (w *testWorld) updateDocumentError(actor testUser, docID, contentJSON string) error {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.UpdateDocumentRequest{Id: docID, ContentJson: contentJSON})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.doc.UpdateDocument(context.Background(), req)
	return err
}

// findQueueEntry pages the reviewer's queue for one submission. The queue is shared across
// a reviewer's whole organization, so a scenario must find its own entry rather than
// assume position.
func (w *testWorld) findQueueEntry(reviewer testUser, submissionID string) *rpcv1.ReviewQueueEntry {
	w.t.Helper()
	var cursor *string
	for range 20 {
		page := w.listEvidenceReviewQueue(reviewer, &rpcv1.ListEvidenceReviewQueueRequest{
			Cursor:   cursor,
			PageSize: 50,
		})
		for _, entry := range page.Entries {
			if entry.EvidenceSubmissionId == submissionID {
				return entry
			}
		}
		if page.NextCursor == nil || *page.NextCursor == "" {
			return nil
		}
		cursor = page.NextCursor
	}
	return nil
}

// newProcedurelessSubmission puts one pending submission on a ritual that has no
// procedure, so the "carries none" half of the queue contract has something to assert on.
func (w *testWorld) newProcedurelessSubmission(owner, submitter testUser, projectID string) string {
	w.t.Helper()
	def := w.createRitualDefinitionWithAssigneesRequirementsAndWindow(
		owner, projectID, "Ritual with no procedure", dailyRecurrenceRule(), 8,
		[]string{submitter.ID.String()},
		[]*rpcv1.CreateEvidenceRequirementInput{{
			Name:          "Gate note",
			EvidenceTypes: []rpcv1.EvidenceType{rpcv1.EvidenceType_EVIDENCE_TYPE_TEXT_NOTE},
			IsRequired:    true,
			ApprovalMode:  rpcv1.ApprovalMode_APPROVAL_MODE_MANUAL,
		}},
	)
	w.generateRitualInstances(owner)
	instances := w.listTasksWithKind(owner, projectID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE))
	require.NotEmpty(w.t, instances)
	kept := instances[0]
	for _, extra := range instances[1:] {
		w.detachRitualInstanceFromSweep(extra.Id)
	}
	return w.submitTextEvidence(submitter, kept.Id, def.EvidenceRequirements[0].Id, "Done.").Id
}

// documentIDs reduces a document listing to the ids it contains, so a scenario can assert
// a listing is unchanged without depending on counts or ordering.
func documentIDs(docs []*rpcv1.DocumentSummary) []string {
	ids := make([]string, 0, len(docs))
	for _, d := range docs {
		ids = append(ids, d.Id)
	}
	return ids
}

// TestDocumentTypeConstantsMatch pins the one string collaboration duplicates from docs.
//
// The dependency runs collaboration -> docs through the DocsLogic interface, so
// collaboration cannot import internal/docs to reach the constant. The value is fixed by a
// CHECK constraint on docs.document.document_type; this asserts the two Go copies and the
// proto enum say the same thing, so a rename cannot silently make every task-description
// document attachable as a ritual procedure.
func TestDocumentTypeConstantsMatch(t *testing.T) {
	t.Parallel()
	assert.Equal(t, docs.DocumentTypeTaskDescription, collaboration.DocumentTypeTaskDescription)
	assert.ElementsMatch(t,
		[]string{docs.DocumentTypeWorkspaceDoc, docs.DocumentTypeTaskDescription, docs.DocumentTypeProjectBrief},
		[]string{"workspace_doc", "task_description", "project_brief"},
		"the Go constants must match the docs.document.document_type CHECK constraint")
	assert.Len(t, rpcv1.DocumentType_name, 4, "the proto enum carries UNSPECIFIED plus one value per document type")
}

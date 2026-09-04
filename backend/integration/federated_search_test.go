package integration

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// ---------------------------------------------------------------------------
// Act: federated search
// ---------------------------------------------------------------------------

func (w *testWorld) federatedSearch(actor testUser, query string) *rpcv1.SearchResponse {
	w.t.Helper()
	resp, err := w.federatedSearchResult(actor, query, rpcv1.SearchKind_SEARCH_KIND_UNSPECIFIED, 0)
	require.NoError(w.t, err, "federated search %q", query)
	return resp
}

func (w *testWorld) federatedSearchNarrowed(actor testUser, query string, kind rpcv1.SearchKind, limit int32) *rpcv1.SearchResponse {
	w.t.Helper()
	resp, err := w.federatedSearchResult(actor, query, kind, limit)
	require.NoError(w.t, err, "federated search %q narrowed to %s", query, kind)
	return resp
}

func (w *testWorld) federatedSearchError(actor testUser, query string) error {
	w.t.Helper()
	_, err := w.federatedSearchResult(actor, query, rpcv1.SearchKind_SEARCH_KIND_UNSPECIFIED, 0)
	return err
}

func (w *testWorld) federatedSearchResult(actor testUser, query string, kind rpcv1.SearchKind, limit int32) (*rpcv1.SearchResponse, error) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.SearchRequest{Query: query, KindFilter: kind, Limit: limit})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.search.Search(context.Background(), req)
	if err != nil {
		return nil, err
	}
	return resp.Msg, nil
}

// ---------------------------------------------------------------------------
// Assert: reading a search response
// ---------------------------------------------------------------------------

func hitsOfKind(resp *rpcv1.SearchResponse, kind rpcv1.SearchKind) []*rpcv1.SearchHit {
	var out []*rpcv1.SearchHit
	for _, h := range resp.GetHits() {
		if h.GetKind() == kind {
			out = append(out, h)
		}
	}
	return out
}

// hitTitled finds a hit of a kind whose title contains the substring, so a scenario can
// name the fixture row it is about rather than an index into a ranked list.
func hitTitled(resp *rpcv1.SearchResponse, kind rpcv1.SearchKind, titleFragment string) *rpcv1.SearchHit {
	for _, h := range hitsOfKind(resp, kind) {
		if strings.Contains(strings.ToLower(h.GetTitle()), strings.ToLower(titleFragment)) {
			return h
		}
	}
	return nil
}

func outcomeFor(resp *rpcv1.SearchResponse, kind rpcv1.SearchKind) *rpcv1.SourceOutcome {
	for _, o := range resp.GetOutcomes() {
		if o.GetKind() == kind {
			return o
		}
	}
	return nil
}

func hitOrder(resp *rpcv1.SearchResponse) []string {
	out := make([]string, 0, len(resp.GetHits()))
	for _, h := range resp.GetHits() {
		out = append(out, fmt.Sprintf("%s/%s", h.GetKind(), h.GetTitle()))
	}
	return out
}

// allSearchKinds is the closed set, in the fixed source-priority order the outcomes are
// always reported in.
var allSearchKinds = []rpcv1.SearchKind{
	rpcv1.SearchKind_SEARCH_KIND_PERSON,
	rpcv1.SearchKind_SEARCH_KIND_CHANNEL,
	rpcv1.SearchKind_SEARCH_KIND_DOCUMENT,
	rpcv1.SearchKind_SEARCH_KIND_WORK_ITEM,
	rpcv1.SearchKind_SEARCH_KIND_EVENT,
	rpcv1.SearchKind_SEARCH_KIND_FILE,
	rpcv1.SearchKind_SEARCH_KIND_DEPARTMENT,
	rpcv1.SearchKind_SEARCH_KIND_MESSAGE,
}

// ---------------------------------------------------------------------------
// Arrange: extra fixture helpers this feature needs
// ---------------------------------------------------------------------------

func (w *testWorld) createDocumentWithVisibility(actor testUser, title, contentJSON string, vis rpcv1.DocumentVisibility) *rpcv1.Document {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.CreateDocumentRequest{
		Title:       title,
		ContentJson: contentJSON,
		Visibility:  vis,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.doc.CreateDocument(context.Background(), req)
	require.NoError(w.t, err, "create document %q", title)
	return resp.Msg.Document
}

func (w *testWorld) getDocumentBySlug(actor testUser, slug string) (*rpcv1.Document, error) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.GetDocumentRequest{
		Identifier: &rpcv1.GetDocumentRequest_Slug{Slug: slug},
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.doc.GetDocument(context.Background(), req)
	if err != nil {
		return nil, err
	}
	return resp.Msg.Document, nil
}

// renameEmployee sets the employee's name directly. The invite→accept flow gives every
// test employee the same display name, and this fixture needs one person findable by a
// distinctive word.
func (w *testWorld) renameEmployee(actor testUser, given, family string) {
	w.t.Helper()
	_, err := globalDB.Exec(context.Background(),
		`UPDATE organization.employee SET given_name = $3, family_name = $4
		 WHERE organization_id = $1 AND id = $2`,
		actor.OrgID, actor.ID, given, family)
	require.NoError(w.t, err, "rename employee")
}

func (w *testWorld) calCreateEventWithVisibility(
	actor testUser,
	title string,
	start, end time.Time,
	visibility string,
	attendeeIDs []string,
) *rpcv1.CalendarEvent {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.CreateEventRequest{
		Title:               title,
		EventType:           "meeting",
		Visibility:          visibility,
		StartTime:           timestamppb.New(start),
		EndTime:             timestamppb.New(end),
		RequiredAttendeeIds: attendeeIDs,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.cal.CreateEvent(context.Background(), req)
	require.NoError(w.t, err, "create %s event %q", visibility, title)
	return resp.Msg.Event
}

func (w *testWorld) searchChannels(actor testUser, query string, limit int32) []*rpcv1.ChannelSearchResult {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.SearchChannelsRequest{QueryText: query, Limit: limit})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.chat.SearchChannels(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Results
}

// restrictToPermissions strips every role the employee holds and gives them one custom
// role carrying exactly the listed permissions.
func (w *testWorld) restrictToPermissions(owner, target testUser, name string, permissionIDs []string) {
	w.t.Helper()
	for _, r := range w.listEmployeeRoles(owner, target.ID.String()) {
		w.revokeRole(owner, target.ID.String(), r.Id)
	}
	role := w.createRole(owner, name, "feature 045 permission fixture", permissionIDs)
	w.assignRole(owner, target.ID.String(), role.Id)
}

// keepOneRitualInstance soft-deletes every generated ritual instance but the earliest,
// so the fixture holds exactly one ritual work item.
func (w *testWorld) keepOneRitualInstance(actor testUser) {
	w.t.Helper()
	_, err := globalDB.Exec(context.Background(),
		`UPDATE collaboration.task SET is_deleted = TRUE
		   WHERE organization_id = $1
		     AND task_kind = 'ritual_instance'
		     AND is_deleted = FALSE
		     AND id <> (SELECT id FROM collaboration.task
		                 WHERE organization_id = $1 AND task_kind = 'ritual_instance' AND is_deleted = FALSE
		                 ORDER BY scheduled_date ASC, id ASC LIMIT 1)`,
		actor.OrgID)
	require.NoError(w.t, err, "trim ritual instances")
}

// ---------------------------------------------------------------------------
// The world
// ---------------------------------------------------------------------------

// zarquonWorld is one workspace in which every one of the eight sources holds something
// matching the same distinctive word, plus the rows each access rule must withhold.
type zarquonWorld struct {
	w *testWorld

	owner    testUser
	member   testUser
	outsider testUser

	privateDoc    *rpcv1.Document // owned by owner
	publicDoc     *rpcv1.Document
	deniedDoc     *rpcv1.Document // public, explicit 'none' grant to member
	vietnameseDoc *rpcv1.Document

	publicProject  projectResult
	privateProject projectResult
	publicTask     *rpcv1.Task
	privateTask    *rpcv1.Task
	archivedTask   *rpcv1.Task

	orgWideEvent   *rpcv1.CalendarEvent
	privateEvent   *rpcv1.CalendarEvent
	sharedEvent    *rpcv1.CalendarEvent // personal_shared, member attends
	cancelledEvent *rpcv1.CalendarEvent

	publicChannelID  string
	privateChannelID string
	fileID           string
	departmentID     string
}

const zarquon = "zarquon"

// buildZarquonWorld builds the whole fixture once. Every scenario below reads it; none
// of them mutates it.
func buildZarquonWorld(t *testing.T, w *testWorld) *zarquonWorld {
	t.Helper()

	f := &zarquonWorld{w: w}
	f.owner = w.withOwner()
	f.member = w.withEmployee()
	f.outsider = w.withEmployee()

	// 17. a person whose own name is the distinctive word
	w.renameEmployee(f.member, "Zarquon", "Nguyen")

	// 16. a department named for it
	f.departmentID = w.createDepartment(f.owner, "Zarquon Logistics", "")

	// 4, 5, 6, 18. documents
	f.privateDoc = w.createDocumentWithVisibility(f.owner, "Zarquon Closing Procedure",
		docContent("How to close the zarquon shop"), rpcv1.DocumentVisibility_DOCUMENT_VISIBILITY_PRIVATE)
	f.publicDoc = w.createDocumentWithVisibility(f.owner, "Zarquon Public Notice",
		docContent("Everyone may read this zarquon notice"), rpcv1.DocumentVisibility_DOCUMENT_VISIBILITY_PUBLIC)
	f.deniedDoc = w.createDocumentWithVisibility(f.owner, "Zarquon Denied Notice",
		docContent("Public but denied to one zarquon reader"), rpcv1.DocumentVisibility_DOCUMENT_VISIBILITY_PUBLIC)
	// The precedence case: an explicit employee grant of 'none' is a deny that stops the
	// chain, even on a public document.
	w.setDocumentAccess(f.owner, f.deniedDoc.Id, f.member.ID.String(), rpcv1.AccessLevel_ACCESS_LEVEL_NONE)
	f.vietnameseDoc = w.createDocumentWithVisibility(f.owner, "Quy trình đóng cửa zarquon",
		docContent("Quy trình đóng cửa cuối ngày"), rpcv1.DocumentVisibility_DOCUMENT_VISIBILITY_PUBLIC)

	// 8, 9, 10, 11. work items across four projects
	f.publicProject = w.createProject(f.owner, "Zarquon Ops", uniqueProjectKey("ZQO"))
	publicLevel := levelByDepth(f.publicProject.Levels, 0)
	require.NotNil(t, publicLevel)
	f.publicTask = w.createTask(f.owner, f.publicProject.ID, "Restock the zarquon freezer", publicLevel.Id)

	f.privateProject = w.createPrivateProject(f.owner, "Zarquon Secrets", uniqueProjectKey("ZQS"))
	privateLevel := levelByDepth(f.privateProject.Levels, 0)
	require.NotNil(t, privateLevel)
	f.privateTask = w.createTask(f.owner, f.privateProject.ID, "Secret zarquon audit", privateLevel.Id)

	archivedProject := w.createProject(f.owner, "Zarquon Attic", uniqueProjectKey("ZQA"))
	archivedLevel := levelByDepth(archivedProject.Levels, 0)
	require.NotNil(t, archivedLevel)
	f.archivedTask = w.createTask(f.owner, archivedProject.ID, "Archived zarquon cleanup", archivedLevel.Id)
	_, err := w.archiveProject(f.owner, archivedProject.ID, true)
	require.NoError(t, err, "archive project")

	// 10. a ritual instance, which is a work item like any other. Generation looks ahead
	// several days and would otherwise fill the work-item source's per-source cap with
	// near-identical instances, hiding the ordinary task this fixture is also about.
	w.createRitualDefinition(f.owner, f.publicProject.ID, "Zarquon opening checklist", dailyRecurrenceRule())
	w.generateRitualInstances(f.owner)
	w.keepOneRitualInstance(f.owner)

	// 12, 13, 14. events
	start := time.Now().Add(48 * time.Hour).Truncate(time.Hour)
	f.orgWideEvent = w.calCreateEventWithVisibility(f.owner, "Quarterly zarquon stocktake", start, start.Add(time.Hour), "org_wide", nil)
	f.privateEvent = w.calCreateEventWithVisibility(f.owner, "Zarquon private review", start, start.Add(time.Hour), "private", nil)
	f.sharedEvent = w.calCreateEventWithVisibility(f.owner, "Zarquon shared planning", start, start.Add(time.Hour), "personal_shared",
		[]string{f.member.ID.String()})
	f.cancelledEvent = w.calCreateEventWithVisibility(f.owner, "Zarquon cancelled offsite", start, start.Add(time.Hour), "org_wide", nil)
	w.calCancelEvent(f.owner, f.cancelledEvent.Id)

	// 15. a public channel with a matching message
	f.publicChannelID = w.createChannel(f.owner, "zarquon-ops", false)
	w.sendMessage(f.owner, f.publicChannelID, "the zarquon delivery is running late")

	// 7. a file in a private channel the owner and the member are in
	f.privateChannelID = w.createChannel(f.owner, "zarquon-private", true)
	w.inviteToChannel(f.owner, f.privateChannelID, f.member.ID)
	f.fileID = w.uploadChannelFile(f.owner, f.privateChannelID, "zarquon-invoice-august.pdf",
		"application/pdf", []byte("zarquon invoice contents"))

	return f
}

func docContent(text string) string {
	return fmt.Sprintf(`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":%q}]}]}`, text)
}

// ---------------------------------------------------------------------------
// TestFederatedSearch
// ---------------------------------------------------------------------------

func TestFederatedSearch(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	f := buildZarquonWorld(t, w)

	t.Run("US1 — one request finds the thing by typing its name", func(t *testing.T) {
		resp := w.federatedSearch(f.owner, zarquon)

		// FR-001: every source answers one request.
		t.Run("it returns a Document hit for the closing procedure", func(t *testing.T) {
			hit := hitTitled(resp, rpcv1.SearchKind_SEARCH_KIND_DOCUMENT, "Zarquon Closing Procedure")
			require.NotNil(t, hit, "expected the private document the owner owns, got %v", hitOrder(resp))
			assert.Equal(t, "Document", hit.GetContextLine())
		})

		t.Run("it returns a Work item hit for the freezer task, naming its project", func(t *testing.T) {
			hit := hitTitled(resp, rpcv1.SearchKind_SEARCH_KIND_WORK_ITEM, "Restock the zarquon freezer")
			require.NotNil(t, hit, "expected the public project's task, got %v", hitOrder(resp))
			assert.Contains(t, hit.GetContextLine(), "Zarquon Ops")
			assert.Contains(t, hit.GetContextLine(), "Task")
		})

		t.Run("it returns an Event hit for the stocktake, carrying its start date", func(t *testing.T) {
			hit := hitTitled(resp, rpcv1.SearchKind_SEARCH_KIND_EVENT, "Quarterly zarquon stocktake")
			require.NotNil(t, hit, "expected the org-wide event, got %v", hitOrder(resp))
			assert.NotEmpty(t, hit.GetContextLine(), "an event row says when it starts")
		})

		t.Run("it returns a File hit for the invoice, naming where it was uploaded", func(t *testing.T) {
			hit := hitTitled(resp, rpcv1.SearchKind_SEARCH_KIND_FILE, "zarquon-invoice-august.pdf")
			require.NotNil(t, hit, "expected the channel file, got %v", hitOrder(resp))
			assert.NotEmpty(t, hit.GetContextLine())
		})

		// FR-002: the four sources that already worked keep working, in the same list.
		t.Run("it returns Person, Department, Channel and Message hits alongside them", func(t *testing.T) {
			assert.NotNil(t, hitTitled(resp, rpcv1.SearchKind_SEARCH_KIND_PERSON, "Zarquon"), "person")
			assert.NotNil(t, hitTitled(resp, rpcv1.SearchKind_SEARCH_KIND_DEPARTMENT, "Zarquon Logistics"), "department")
			assert.NotNil(t, hitTitled(resp, rpcv1.SearchKind_SEARCH_KIND_CHANNEL, "zarquon-ops"), "channel")
			assert.NotEmpty(t, hitsOfKind(resp, rpcv1.SearchKind_SEARCH_KIND_MESSAGE), "message")
		})

		// FR-003: a row carries everything needed to open it.
		t.Run("every hit carries a title, a context line and a target that identifies it", func(t *testing.T) {
			for _, h := range resp.GetHits() {
				assert.NotEmpty(t, h.GetTitle(), "%s hit has no title", h.GetKind())
				assert.NotEmpty(t, h.GetContextLine(), "%s %q has no context line", h.GetKind(), h.GetTitle())
				require.NotNil(t, h.GetTarget(), "%s %q has no target", h.GetKind(), h.GetTitle())
				assert.NotEmpty(t, targetIdentifier(h), "%s %q has an empty target", h.GetKind(), h.GetTitle())
			}
		})

		t.Run("the Document hit carries a slug, not only an id", func(t *testing.T) {
			hit := hitTitled(resp, rpcv1.SearchKind_SEARCH_KIND_DOCUMENT, "Zarquon Closing Procedure")
			require.NotNil(t, hit)
			assert.NotEmpty(t, hit.GetTarget().GetDocumentSlug(), "an id-only target pushes /docs/undefined")
			assert.Equal(t, f.privateDoc.Slug, hit.GetTarget().GetDocumentSlug())
		})

		t.Run("the Work item hit carries both a project id and a task id", func(t *testing.T) {
			hit := hitTitled(resp, rpcv1.SearchKind_SEARCH_KIND_WORK_ITEM, "Restock the zarquon freezer")
			require.NotNil(t, hit)
			assert.Equal(t, f.publicProject.ID, hit.GetTarget().GetProjectId(), "both task routes are project-scoped")
			assert.Equal(t, f.publicTask.Id, hit.GetTarget().GetTaskId())
		})

		// FR-013, SC-007: the order is a property of the answer, not of the client.
		t.Run("running the identical request twice returns the identical order", func(t *testing.T) {
			again := w.federatedSearch(f.owner, zarquon)
			assert.Equal(t, hitOrder(resp), hitOrder(again))
		})

		// Edge case: a ritual instance and an ordinary task are both work items, and each
		// row says which it is.
		t.Run("a ritual instance and an ordinary task are both Work item hits, each saying which", func(t *testing.T) {
			narrowed := w.federatedSearchNarrowed(f.owner, zarquon, rpcv1.SearchKind_SEARCH_KIND_WORK_ITEM, 50)
			var sawTask, sawRitual bool
			for _, h := range narrowed.GetHits() {
				if strings.HasSuffix(h.GetContextLine(), "· Task") {
					sawTask = true
				}
				if strings.HasSuffix(h.GetContextLine(), "· Ritual") {
					sawRitual = true
				}
			}
			assert.True(t, sawTask, "expected an ordinary task, got %v", hitOrder(narrowed))
			assert.True(t, sawRitual, "expected a ritual instance, got %v", hitOrder(narrowed))
		})
	})

	t.Run("US2 — nothing in the list is a door I cannot open", func(t *testing.T) {
		// FR-007: documents
		t.Run("the outsider gets no Document hit for a private document, and no snippet of it", func(t *testing.T) {
			resp := w.federatedSearch(f.outsider, zarquon)
			assert.Nil(t, hitTitled(resp, rpcv1.SearchKind_SEARCH_KIND_DOCUMENT, "Zarquon Closing Procedure"))
			for _, h := range resp.GetHits() {
				assert.NotContains(t, h.GetSnippet(), "close the zarquon shop",
					"a withheld document's content leaked through a snippet")
			}
		})

		t.Run("an explicit 'none' grant denies a public document, overriding its visibility", func(t *testing.T) {
			resp := w.federatedSearch(f.member, zarquon)
			assert.Nil(t, hitTitled(resp, rpcv1.SearchKind_SEARCH_KIND_DOCUMENT, "Zarquon Denied Notice"),
				"an employee grant of 'none' is a deny that stops the chain")
		})

		t.Run("a public document with no grant against the caller is returned", func(t *testing.T) {
			resp := w.federatedSearch(f.member, zarquon)
			assert.NotNil(t, hitTitled(resp, rpcv1.SearchKind_SEARCH_KIND_DOCUMENT, "Zarquon Public Notice"))
		})

		t.Run("the owner finds the document they own privately", func(t *testing.T) {
			resp := w.federatedSearch(f.owner, zarquon)
			assert.NotNil(t, hitTitled(resp, rpcv1.SearchKind_SEARCH_KIND_DOCUMENT, "Zarquon Closing Procedure"))
		})

		// FR-009: work items
		t.Run("the outsider gets no Work item hit for a private project's task, and no count discloses it", func(t *testing.T) {
			resp := w.federatedSearch(f.outsider, zarquon)
			assert.Nil(t, hitTitled(resp, rpcv1.SearchKind_SEARCH_KIND_WORK_ITEM, "Secret zarquon audit"))

			outcome := outcomeFor(resp, rpcv1.SearchKind_SEARCH_KIND_WORK_ITEM)
			require.NotNil(t, outcome)
			assert.Equal(t, int32(len(hitsOfKind(resp, rpcv1.SearchKind_SEARCH_KIND_WORK_ITEM))), outcome.GetHitCount(),
				"hit_count must count returned rows only — there is no 'and N more you cannot see'")
		})

		t.Run("a member finds a public project's task", func(t *testing.T) {
			resp := w.federatedSearch(f.member, zarquon)
			assert.NotNil(t, hitTitled(resp, rpcv1.SearchKind_SEARCH_KIND_WORK_ITEM, "Restock the zarquon freezer"))
		})

		t.Run("nobody finds an archived project's task", func(t *testing.T) {
			for name, actor := range map[string]testUser{"owner": f.owner, "member": f.member, "outsider": f.outsider} {
				resp := w.federatedSearchNarrowed(actor, zarquon, rpcv1.SearchKind_SEARCH_KIND_WORK_ITEM, 50)
				assert.Nil(t, hitTitled(resp, rpcv1.SearchKind_SEARCH_KIND_WORK_ITEM, "Archived zarquon cleanup"),
					"%s found work in an archived project", name)
			}
		})

		// FR-008: events
		t.Run("a member gets no Event hit for a private event they neither organise nor attend", func(t *testing.T) {
			resp := w.federatedSearchNarrowed(f.member, zarquon, rpcv1.SearchKind_SEARCH_KIND_EVENT, 50)
			assert.Nil(t, hitTitled(resp, rpcv1.SearchKind_SEARCH_KIND_EVENT, "Zarquon private review"))
		})

		t.Run("the organiser finds their own private event", func(t *testing.T) {
			resp := w.federatedSearchNarrowed(f.owner, zarquon, rpcv1.SearchKind_SEARCH_KIND_EVENT, 50)
			assert.NotNil(t, hitTitled(resp, rpcv1.SearchKind_SEARCH_KIND_EVENT, "Zarquon private review"))
		})

		t.Run("an attendee finds a personal_shared event they attend", func(t *testing.T) {
			resp := w.federatedSearchNarrowed(f.member, zarquon, rpcv1.SearchKind_SEARCH_KIND_EVENT, 50)
			assert.NotNil(t, hitTitled(resp, rpcv1.SearchKind_SEARCH_KIND_EVENT, "Zarquon shared planning"))
		})

		t.Run("an outsider does not find a personal_shared event they do not attend", func(t *testing.T) {
			resp := w.federatedSearchNarrowed(f.outsider, zarquon, rpcv1.SearchKind_SEARCH_KIND_EVENT, 50)
			assert.Nil(t, hitTitled(resp, rpcv1.SearchKind_SEARCH_KIND_EVENT, "Zarquon shared planning"),
				"personal_shared means organiser and attendees only")
		})

		t.Run("nobody finds a cancelled event", func(t *testing.T) {
			for name, actor := range map[string]testUser{"owner": f.owner, "member": f.member, "outsider": f.outsider} {
				resp := w.federatedSearchNarrowed(actor, zarquon, rpcv1.SearchKind_SEARCH_KIND_EVENT, 50)
				assert.Nil(t, hitTitled(resp, rpcv1.SearchKind_SEARCH_KIND_EVENT, "Zarquon cancelled offsite"),
					"%s found a cancelled event", name)
			}
		})

		// FR-010: files
		t.Run("the outsider gets no File hit for a file in a channel they are not in", func(t *testing.T) {
			resp := w.federatedSearch(f.outsider, zarquon)
			assert.Nil(t, hitTitled(resp, rpcv1.SearchKind_SEARCH_KIND_FILE, "zarquon-invoice-august.pdf"))
		})

		t.Run("a channel member finds that file", func(t *testing.T) {
			resp := w.federatedSearch(f.member, zarquon)
			assert.NotNil(t, hitTitled(resp, rpcv1.SearchKind_SEARCH_KIND_FILE, "zarquon-invoice-august.pdf"))
		})

		// FR-011: the four existing sources return the same sets as their own RPCs.
		t.Run("the four existing sources return the same sets through federated search as through their own RPCs", func(t *testing.T) {
			for name, actor := range map[string]testUser{"owner": f.owner, "member": f.member, "outsider": f.outsider} {
				federated := w.federatedSearchNarrowed(actor, zarquon, rpcv1.SearchKind_SEARCH_KIND_CHANNEL, 50)
				direct := w.searchChannels(actor, zarquon, 50)

				federatedIDs := map[string]bool{}
				for _, h := range federated.GetHits() {
					federatedIDs[h.GetTarget().GetChannelId()] = true
				}
				for _, c := range direct {
					assert.True(t, federatedIDs[c.GetId()],
						"%s: channel %q is returned by SearchChannels but not by federated search", name, c.GetDisplayName())
				}
				assert.Len(t, federated.GetHits(), len(direct), "%s: channel sets differ in size", name)
			}
		})

		// SC-002 / SC-003: nothing in any list refuses on open.
		t.Run("every hit returned to every caller can be fetched by its own identifiers", func(t *testing.T) {
			for name, actor := range map[string]testUser{"owner": f.owner, "member": f.member, "outsider": f.outsider} {
				resp := w.federatedSearch(actor, zarquon)
				for _, h := range resp.GetHits() {
					assertTargetOpens(t, w, actor, h, name)
				}
			}
		})
	})

	t.Run("US3 — the search box does not half-fail in silence", func(t *testing.T) {
		// FR-004: every source reports, whatever happened.
		t.Run("every source reports an outcome, in the fixed order, when all are healthy", func(t *testing.T) {
			resp := w.federatedSearch(f.owner, zarquon)
			require.Len(t, resp.GetOutcomes(), len(allSearchKinds))
			for i, kind := range allSearchKinds {
				assert.Equal(t, kind, resp.GetOutcomes()[i].GetKind(), "outcome %d out of order", i)
				assert.Equal(t, rpcv1.SourceStatus_SOURCE_STATUS_OK, resp.GetOutcomes()[i].GetStatus(),
					"%s should be OK, detail=%q", kind, resp.GetOutcomes()[i].GetDetail())
			}
		})

		// FR-004: OK-with-zero is not UNAVAILABLE. That distinction is the whole point.
		t.Run("a source that matches nothing is OK with hit_count zero, not UNAVAILABLE", func(t *testing.T) {
			resp := w.federatedSearch(f.owner, "quuxzzzqq")
			assert.Empty(t, resp.GetHits())
			for _, o := range resp.GetOutcomes() {
				assert.Equal(t, rpcv1.SourceStatus_SOURCE_STATUS_OK, o.GetStatus(), "%s", o.GetKind())
				assert.Zero(t, o.GetHitCount(), "%s", o.GetKind())
			}
		})

		// FR-006, SC-004: the answer arrives inside the overall budget.
		t.Run("the search returns well inside its overall budget", func(t *testing.T) {
			start := time.Now()
			w.federatedSearch(f.owner, zarquon)
			assert.Less(t, time.Since(start), 5*time.Second, "eight concurrent sources should not take seconds")
		})

		// FR-012: a permission gap is a skip, not a failure.
		t.Run("a caller without docs.view still gets a successful search, with documents marked not permitted", func(t *testing.T) {
			restricted := w.withEmployee()
			w.restrictToPermissions(f.owner, restricted, "Zarquon No Docs "+shortID(), []string{
				"org.searchEmployees", "org.searchDepartments", "chat.search", "files.search", "collab.viewTask",
			})

			resp := w.federatedSearch(restricted, zarquon)

			docs := outcomeFor(resp, rpcv1.SearchKind_SEARCH_KIND_DOCUMENT)
			require.NotNil(t, docs)
			assert.Equal(t, rpcv1.SourceStatus_SOURCE_STATUS_NOT_PERMITTED, docs.GetStatus())
			assert.Contains(t, docs.GetDetail(), "docs.view")
			assert.Empty(t, hitsOfKind(resp, rpcv1.SearchKind_SEARCH_KIND_DOCUMENT))

			for _, o := range resp.GetOutcomes() {
				if o.GetKind() == rpcv1.SearchKind_SEARCH_KIND_DOCUMENT {
					continue
				}
				assert.Equal(t, rpcv1.SourceStatus_SOURCE_STATUS_OK, o.GetStatus(),
					"%s stopped answering because another source was denied", o.GetKind())
			}
		})

		t.Run("a caller permitted to search nothing gets a successful empty answer, not an error", func(t *testing.T) {
			restricted := w.withEmployee()
			w.restrictToPermissions(f.owner, restricted, "Zarquon Nothing "+shortID(), []string{"profile.view"})

			resp, err := w.federatedSearchResult(restricted, zarquon, rpcv1.SearchKind_SEARCH_KIND_UNSPECIFIED, 0)
			require.NoError(t, err, "nothing is broken — it is just not theirs")

			for _, o := range resp.GetOutcomes() {
				// Events carry no permission: calendar search is any-authenticated, and
				// the events themselves are visibility-filtered per row.
				if o.GetKind() == rpcv1.SearchKind_SEARCH_KIND_EVENT {
					continue
				}
				assert.Equal(t, rpcv1.SourceStatus_SOURCE_STATUS_NOT_PERMITTED, o.GetStatus(), "%s", o.GetKind())
			}
			assert.Empty(t, hitsOfKind(resp, rpcv1.SearchKind_SEARCH_KIND_DOCUMENT))
			assert.Empty(t, hitsOfKind(resp, rpcv1.SearchKind_SEARCH_KIND_MESSAGE))
		})
	})

	t.Run("US4 — narrow to one kind", func(t *testing.T) {
		// FR-014: no source crowds the first screen.
		t.Run("no source contributes more than the per-source cap to the mixed list", func(t *testing.T) {
			resp := w.federatedSearch(f.owner, zarquon)
			for _, kind := range allSearchKinds {
				assert.LessOrEqual(t, len(hitsOfKind(resp, kind)), 5, "%s exceeded the per-source cap", kind)
			}
		})

		// FR-014, SC-006: one matching document sits inside the first screen even against
		// a wall of matching messages.
		t.Run("a single matching document appears within the first eight hits against a hundred matching messages", func(t *testing.T) {
			noisy := w.withOwner()
			channelID := w.createChannel(noisy, "quibble-noise", false)
			for i := range 100 {
				w.sendMessage(noisy, channelID, fmt.Sprintf("quibblequibble note number %d", i))
			}
			doc := w.createDocumentWithVisibility(noisy, "Quibblequibble Handbook",
				docContent("the quibblequibble handbook"), rpcv1.DocumentVisibility_DOCUMENT_VISIBILITY_PUBLIC)

			resp := w.federatedSearch(noisy, "quibblequibble")
			position := -1
			for i, h := range resp.GetHits() {
				if h.GetKind() == rpcv1.SearchKind_SEARCH_KIND_DOCUMENT && h.GetTarget().GetDocumentSlug() == doc.Slug {
					position = i
					break
				}
			}
			require.NotEqual(t, -1, position, "the document was not in the list at all: %v", hitOrder(resp))
			assert.Less(t, position, 8, "the document was pushed off the first screen: %v", hitOrder(resp))
		})

		// FR-016: the answer is bounded whatever is asked for.
		t.Run("the total number of hits never exceeds the maximum", func(t *testing.T) {
			resp := w.federatedSearchNarrowed(f.owner, zarquon, rpcv1.SearchKind_SEARCH_KIND_UNSPECIFIED, 5000)
			assert.LessOrEqual(t, len(resp.GetHits()), 80)
		})

		// FR-015, US4 AC1: narrowing goes deeper.
		t.Run("narrowing to documents returns only documents, and more of them than the mixed list held", func(t *testing.T) {
			mixed := w.federatedSearch(f.owner, zarquon)
			narrowed := w.federatedSearchNarrowed(f.owner, zarquon, rpcv1.SearchKind_SEARCH_KIND_DOCUMENT, 0)

			for _, h := range narrowed.GetHits() {
				assert.Equal(t, rpcv1.SearchKind_SEARCH_KIND_DOCUMENT, h.GetKind())
			}
			assert.GreaterOrEqual(t, len(narrowed.GetHits()), len(hitsOfKind(mixed, rpcv1.SearchKind_SEARCH_KIND_DOCUMENT)))
			assert.Greater(t, len(narrowed.GetHits()), 0)
		})

		t.Run("an over-large narrowed limit is clamped to the narrowed maximum", func(t *testing.T) {
			resp := w.federatedSearchNarrowed(f.owner, zarquon, rpcv1.SearchKind_SEARCH_KIND_DOCUMENT, 5000)
			assert.LessOrEqual(t, len(resp.GetHits()), 50)
		})
	})

	t.Run("edge cases", func(t *testing.T) {
		// R15: a one-character query would fan out to eight sources and match most of
		// every table.
		t.Run("a one-character query is refused", func(t *testing.T) {
			err := w.federatedSearchError(f.owner, "z")
			require.Error(t, err)
			assert.Equal(t, connect.CodeInvalidArgument, connect.CodeOf(err))
		})

		t.Run("a whitespace-padded query is trimmed, not refused", func(t *testing.T) {
			resp := w.federatedSearch(f.owner, "  "+zarquon+"  ")
			assert.NotEmpty(t, resp.GetHits())
		})

		// SC-008: a Vietnamese title comes back the same way an English one does.
		t.Run("a Vietnamese title is found by searching it in Vietnamese", func(t *testing.T) {
			resp := w.federatedSearchNarrowed(f.owner, "đóng cửa", rpcv1.SearchKind_SEARCH_KIND_DOCUMENT, 50)
			assert.NotNil(t, hitTitled(resp, rpcv1.SearchKind_SEARCH_KIND_DOCUMENT, "đóng cửa"),
				"got %v", hitOrder(resp))
		})
	})
}

// targetIdentifier is the identifier the hit's own kind is opened by.
func targetIdentifier(h *rpcv1.SearchHit) string {
	t := h.GetTarget()
	switch h.GetKind() {
	case rpcv1.SearchKind_SEARCH_KIND_PERSON:
		return t.GetEmployeeId()
	case rpcv1.SearchKind_SEARCH_KIND_DEPARTMENT:
		return t.GetDepartmentId()
	case rpcv1.SearchKind_SEARCH_KIND_CHANNEL:
		return t.GetChannelId()
	case rpcv1.SearchKind_SEARCH_KIND_MESSAGE:
		return t.GetMessageId()
	case rpcv1.SearchKind_SEARCH_KIND_DOCUMENT:
		return t.GetDocumentSlug()
	case rpcv1.SearchKind_SEARCH_KIND_FILE:
		return t.GetFileId()
	case rpcv1.SearchKind_SEARCH_KIND_WORK_ITEM:
		return t.GetTaskId()
	case rpcv1.SearchKind_SEARCH_KIND_EVENT:
		return t.GetEventId()
	}
	return ""
}

// assertTargetOpens fetches the thing a hit points at, using only the identifiers the hit
// carries. A row that refuses on open is a row that should never have been listed.
func assertTargetOpens(t *testing.T, w *testWorld, actor testUser, h *rpcv1.SearchHit, who string) {
	t.Helper()
	switch h.GetKind() {
	case rpcv1.SearchKind_SEARCH_KIND_DOCUMENT:
		_, err := w.getDocumentBySlug(actor, h.GetTarget().GetDocumentSlug())
		assert.NoError(t, err, "%s: document %q was listed but will not open", who, h.GetTitle())
	case rpcv1.SearchKind_SEARCH_KIND_WORK_ITEM:
		req := connect.NewRequest(&rpcv1.GetTaskRequest{TaskId: h.GetTarget().GetTaskId()})
		req.Header().Set("Authorization", "Bearer "+actor.Token)
		_, err := w.collab.GetTask(context.Background(), req)
		assert.NoError(t, err, "%s: work item %q was listed but will not open", who, h.GetTitle())
	case rpcv1.SearchKind_SEARCH_KIND_EVENT:
		req := connect.NewRequest(&rpcv1.GetEventRequest{EventId: h.GetTarget().GetEventId()})
		req.Header().Set("Authorization", "Bearer "+actor.Token)
		_, err := w.cal.GetEvent(context.Background(), req)
		assert.NoError(t, err, "%s: event %q was listed but will not open", who, h.GetTitle())
	case rpcv1.SearchKind_SEARCH_KIND_FILE:
		hasAccess, reason := w.checkFileAccess(actor, h.GetTarget().GetFileId())
		assert.True(t, hasAccess, "%s: file %q was listed but access is denied: %s", who, h.GetTitle(), reason)
	case rpcv1.SearchKind_SEARCH_KIND_CHANNEL, rpcv1.SearchKind_SEARCH_KIND_MESSAGE:
		req := connect.NewRequest(&rpcv1.GetChannelRequest{ChannelId: h.GetTarget().GetChannelId()})
		req.Header().Set("Authorization", "Bearer "+actor.Token)
		_, err := w.chat.GetChannel(context.Background(), req)
		assert.NoError(t, err, "%s: channel behind %q was listed but will not open", who, h.GetTitle())
	case rpcv1.SearchKind_SEARCH_KIND_DEPARTMENT:
		req := connect.NewRequest(&rpcv1.GetDepartmentRequest{DepartmentId: h.GetTarget().GetDepartmentId()})
		req.Header().Set("Authorization", "Bearer "+actor.Token)
		_, err := w.dept.GetDepartment(context.Background(), req)
		assert.NoError(t, err, "%s: department %q was listed but will not open", who, h.GetTitle())
	case rpcv1.SearchKind_SEARCH_KIND_PERSON:
		// People are org-scoped by design; the identifier is all a client needs and
		// there is no per-person fetch that can refuse.
		assert.NotEmpty(t, h.GetTarget().GetEmployeeId())
	}
}

func shortID() string {
	return strings.ReplaceAll(dbuuid.Must().String(), "-", "")[:8]
}

package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/internal/calendar"
	"github.com/nvcnvn/tech-office/backend/internal/chat"
	"github.com/nvcnvn/tech-office/backend/internal/collaboration"
	"github.com/nvcnvn/tech-office/backend/internal/docs"
	"github.com/nvcnvn/tech-office/backend/internal/linking"
	"github.com/nvcnvn/tech-office/backend/internal/organization"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// ---------------------------------------------------------------------------
// Feature 046 — link previews in chat.
//
// The endpoint under test answers a whole page of canonical links in one request and
// composes each card from the linked resource's own rows, scoped to the reader. The
// behaviour these scenarios pin down is in specs/046-chat-link-previews/.
// ---------------------------------------------------------------------------

type previewsResponse struct {
	Items []previewItem `json:"items"`
}

type previewItem struct {
	URL     string                 `json:"url"`
	Status  string                 `json:"status"`
	Preview *previewCardAssertions `json:"preview"`
}

// previewCardAssertions mirrors linking.LinkPreviewMetadata over the wire. It is declared
// here rather than reused so a field silently disappearing from the JSON tags is a test
// failure rather than an invisible change.
type previewCardAssertions struct {
	Title         string               `json:"title"`
	Subtitle      string               `json:"subtitle"`
	ResourceType  linking.ResourceType `json:"resourceType"`
	Badge         string               `json:"badge"`
	Href          string               `json:"href"`
	Identifier    string               `json:"identifier"`
	StateName     string               `json:"stateName"`
	StateCategory string               `json:"stateCategory"`
	AssigneeName  string               `json:"assigneeName"`
	AssigneeCount int                  `json:"assigneeCount"`
	StartTime     string               `json:"startTime"`
	AllDay        bool                 `json:"allDay"`
}

// postPreviews calls the batch endpoint and returns the decoded body plus the raw bytes,
// because SC-004 asserts that a denied and a missing resource answer byte-identically.
func postPreviews(t *testing.T, bearerToken string, urls []string) (int, previewsResponse, []byte) {
	t.Helper()
	body, err := json.Marshal(map[string]any{"urls": urls})
	require.NoError(t, err)

	req, err := http.NewRequest(http.MethodPost, serverBaseURL+"/api/linking/previews", bytes.NewReader(body))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	if bearerToken != "" {
		req.Header.Set("Authorization", "Bearer "+bearerToken)
	}

	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	require.NoError(t, err)

	var payload previewsResponse
	if resp.StatusCode == http.StatusOK {
		require.NoError(t, json.Unmarshal(raw, &payload), "decode previews body: %s", raw)
	}
	return resp.StatusCode, payload, raw
}

// previewOne is the common case: one url, one item, 200.
func previewOne(t *testing.T, bearerToken, url string) previewItem {
	t.Helper()
	status, payload, _ := postPreviews(t, bearerToken, []string{url})
	require.Equal(t, http.StatusOK, status)
	require.Len(t, payload.Items, 1)
	require.Equal(t, url, payload.Items[0].URL, "the item must echo the url as sent")
	return payload.Items[0]
}

// requireUnavailable asserts the one answer every failure mode collapses to: no preview
// body at all, so a client cannot tell denied from missing (FR-010).
func requireUnavailable(t *testing.T, item previewItem) {
	t.Helper()
	require.Equal(t, "unavailable", item.Status)
	require.Nil(t, item.Preview)
}

func requireOK(t *testing.T, item previewItem) *previewCardAssertions {
	t.Helper()
	require.Equal(t, "ok", item.Status, "expected a preview for %s", item.URL)
	require.NotNil(t, item.Preview)
	return item.Preview
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

type previewWorld struct {
	w         *testWorld
	tenantKey string

	owner    testUser
	member   testUser
	outsider testUser
	assignee testUser

	assigneeName string

	publicProject  projectResult
	privateProject projectResult

	task            *rpcv1.Task
	twoAssigneeTask *rpcv1.Task
	privateTask     *rpcv1.Task
	deletedTask     *rpcv1.Task
	untitledTask    *rpcv1.Task

	rootDocumentID   string
	childDocumentID  string
	deniedDocumentID string

	orgWideEvent   *rpcv1.CalendarEvent
	privateEvent   *rpcv1.CalendarEvent
	cancelledEvent *rpcv1.CalendarEvent
	eventStart     time.Time

	publicChannelID     string
	privateChannelID    string
	threadRootID        string
	privateThreadRootID string

	foreignTenantKey string
	foreignTaskID    string
}

// canonical generates the canonical URL for one resource, the same way a client's
// copy-link does.
func (p *previewWorld) canonical(resourceType linking.ResourceType, resourceID string) string {
	return postCanonicalGenerate(p.w.t, linking.CanonicalLinkTarget{
		TenantKey:    p.tenantKey,
		ResourceType: resourceType,
		ResourceID:   resourceID,
	}).CanonicalURL
}

func (p *previewWorld) taskURL(id string) string {
	return p.canonical(linking.ResourceTypeTaskInstance, id)
}
func (p *previewWorld) documentURL(id string) string {
	return p.canonical(linking.ResourceTypeDocumentPage, id)
}
func (p *previewWorld) eventURL(id string) string {
	return p.canonical(linking.ResourceTypeCalendarEvent, id)
}
func (p *previewWorld) projectURL(id string) string {
	return p.canonical(linking.ResourceTypeProjectDestination, id)
}
func (p *previewWorld) channelURL(id string) string {
	return p.canonical(linking.ResourceTypeChatChannel, id)
}
func (p *previewWorld) threadURL(id string) string {
	return p.canonical(linking.ResourceTypeChatThread, id)
}

// setEmployeeName renames an employee directly so a card's assignee line can be asserted
// against a distinctive value rather than the generic invite-flow default.
func setEmployeeName(t *testing.T, orgID, employeeID dbuuid.UUID, given, family string) {
	t.Helper()
	_, err := globalDB.Exec(context.Background(),
		`UPDATE organization.employee SET given_name = $3, family_name = $4
		  WHERE organization_id = $1 AND id = $2`,
		orgID, employeeID, given, family)
	require.NoError(t, err, "rename employee")
}

// setTaskTitle writes a task title directly. The RPC refuses an empty title, and the
// empty-title case is exactly what the identifier fallback exists for.
func setTaskTitle(t *testing.T, orgID dbuuid.UUID, taskID, title string) {
	t.Helper()
	parsed, err := dbuuid.Parse(taskID)
	require.NoError(t, err)
	_, err = globalDB.Exec(context.Background(),
		`UPDATE collaboration.task SET title = $3 WHERE organization_id = $1 AND id = $2`,
		orgID, parsed, title)
	require.NoError(t, err, "set task title")
}

// setEventVisibility writes an event's visibility directly: CreateEvent does not accept
// 'private', and a private event is the case the visibility predicate must exclude.
func setEventVisibility(t *testing.T, orgID dbuuid.UUID, eventID, visibility string) {
	t.Helper()
	parsed, err := dbuuid.Parse(eventID)
	require.NoError(t, err)
	_, err = globalDB.Exec(context.Background(),
		`UPDATE calendar.event SET visibility = $3 WHERE organization_id = $1 AND id = $2`,
		orgID, parsed, visibility)
	require.NoError(t, err, "set event visibility")
}

func clearEventAttendees(t *testing.T, orgID dbuuid.UUID, eventID string) {
	t.Helper()
	parsed, err := dbuuid.Parse(eventID)
	require.NoError(t, err)
	_, err = globalDB.Exec(context.Background(),
		`DELETE FROM calendar.attendee WHERE organization_id = $1 AND event_id = $2`, orgID, parsed)
	require.NoError(t, err, "clear event attendees")
}

// newPreviewWorld builds the world every scenario below reads. Titles carry "gasket" so
// nothing seeded elsewhere collides with them.
func newPreviewWorld(t *testing.T) *previewWorld {
	t.Helper()
	w := newTestWorld(t)
	p := &previewWorld{w: w}

	p.owner = w.withOwner()
	p.tenantKey = w.orgSubdomain()
	p.member = w.withEmployee()
	p.outsider = w.withEmployee()
	p.assignee = w.withEmployee()

	p.assigneeName = "Mai Anh Nguyen"
	setEmployeeName(t, p.owner.OrgID, p.assignee.ID, "Mai Anh", "Nguyen")

	// Projects: one public (member and assignee can read through it), one private to the
	// owner alone.
	p.publicProject = w.createProject(p.owner, "Gasket Operations", "GOPS")
	p.privateProject = w.createPrivateProject(p.owner, "Gasket Board", "GBRD")

	// Tasks.
	p.task = w.createTask(p.owner, p.publicProject.ID, "Replace the walk-in gasket", p.publicProject.Levels[0].Id)
	w.assignTask(p.owner, p.task.Id, p.assignee.ID, rpcv1.TaskAssigneeRole_TASK_ASSIGNEE_ROLE_ASSIGNEE)

	p.twoAssigneeTask = w.createTask(p.owner, p.publicProject.ID, "Second gasket task", p.publicProject.Levels[0].Id)
	w.assignTask(p.owner, p.twoAssigneeTask.Id, p.assignee.ID, rpcv1.TaskAssigneeRole_TASK_ASSIGNEE_ROLE_ASSIGNEE)
	w.assignTask(p.owner, p.twoAssigneeTask.Id, p.member.ID, rpcv1.TaskAssigneeRole_TASK_ASSIGNEE_ROLE_ASSIGNEE)

	p.privateTask = w.createTask(p.owner, p.privateProject.ID, "Confidential gasket audit", p.privateProject.Levels[0].Id)

	p.deletedTask = w.createTask(p.owner, p.publicProject.ID, "Deleted gasket task", p.publicProject.Levels[0].Id)

	p.untitledTask = w.createTask(p.owner, p.publicProject.ID, "Untitled gasket task", p.publicProject.Levels[0].Id)
	setTaskTitle(t, p.owner.OrgID, p.untitledTask.Id, "")

	// Documents: a public root, a public child under it, and a public document the member
	// is explicitly denied — the deny that a naive OR-chain predicate would lose.
	root := w.createDocumentWithVisibility(p.owner, "Gasket Handbook", "{}", rpcv1.DocumentVisibility_DOCUMENT_VISIBILITY_PUBLIC)
	p.rootDocumentID = root.Id
	p.childDocumentID = w.createChildDocument(p.owner, p.rootDocumentID, "Gasket Procedure", "{}")
	setDocumentVisibility(t, p.owner.OrgID, p.childDocumentID, "public")

	denied := w.createDocumentWithVisibility(p.owner, "Gasket Denied Notice", "{}", rpcv1.DocumentVisibility_DOCUMENT_VISIBILITY_PUBLIC)
	p.deniedDocumentID = denied.Id
	w.setDocumentAccess(p.owner, p.deniedDocumentID, p.member.ID.String(), rpcv1.AccessLevel_ACCESS_LEVEL_NONE)

	// Events.
	p.eventStart = time.Now().Add(48 * time.Hour).Truncate(time.Minute)
	p.orgWideEvent = w.calCreateEvent(p.owner, "Gasket stocktake", p.eventStart, p.eventStart.Add(time.Hour))
	setEventVisibility(t, p.owner.OrgID, p.orgWideEvent.Id, "org_wide")

	p.privateEvent = w.calCreateEvent(p.owner, "Gasket private review", p.eventStart, p.eventStart.Add(time.Hour))
	setEventVisibility(t, p.owner.OrgID, p.privateEvent.Id, "private")
	clearEventAttendees(t, p.owner.OrgID, p.privateEvent.Id)

	p.cancelledEvent = w.calCreateEvent(p.owner, "Gasket cancelled offsite", p.eventStart, p.eventStart.Add(time.Hour))
	setEventVisibility(t, p.owner.OrgID, p.cancelledEvent.Id, "org_wide")
	w.calCancelEvent(p.owner, p.cancelledEvent.Id)

	// Channels and a thread root.
	p.publicChannelID = w.createChannel(p.owner, "gasket-ops", false)
	p.privateChannelID = w.createChannel(p.owner, "gasket-secret", true)
	p.threadRootID = w.sendMessage(p.owner, p.publicChannelID, "Gasket thread root, the message a thread hangs from")
	p.privateThreadRootID = w.sendMessage(p.owner, p.privateChannelID, "Gasket secret thread root")

	// A second organization, for the cross-tenant case.
	foreignOwnerOrgID, foreignOwnerID, foreignOwnerToken := w.mustRegisterNewOrg()
	foreignOwner := testUser{ID: foreignOwnerID, OrgID: foreignOwnerOrgID, Token: foreignOwnerToken}
	foreignProject := w.createProject(foreignOwner, "Foreign Gasket", "FGSK")
	foreignTask := w.createTask(foreignOwner, foreignProject.ID, "Foreign gasket task", foreignProject.Levels[0].Id)
	p.foreignTaskID = foreignTask.Id
	p.foreignTenantKey = organizationSubdomain(t, foreignOwnerOrgID)

	return p
}

// setDocumentVisibility writes visibility directly: CreateDocument with a parent does not
// take the flag, and a child that inherits 'private' would defeat the parent-title case.
func setDocumentVisibility(t *testing.T, orgID dbuuid.UUID, documentID, visibility string) {
	t.Helper()
	parsed, err := dbuuid.Parse(documentID)
	require.NoError(t, err)
	_, err = globalDB.Exec(context.Background(),
		`UPDATE docs.document SET visibility = $3 WHERE organization_id = $1 AND id = $2`,
		orgID, parsed, visibility)
	require.NoError(t, err, "set document visibility")
}

func organizationSubdomain(t *testing.T, orgID dbuuid.UUID) string {
	t.Helper()
	var subdomain string
	require.NoError(t, globalDB.QueryRow(context.Background(),
		`SELECT subdomain FROM public.organization WHERE id = $1`, orgID).Scan(&subdomain))
	return subdomain
}

// setEventAllDay flips the all-day flag directly: CreateEvent does not expose it and the
// all-day card is the one that must not imply a wall clock.
func setEventAllDay(t *testing.T, orgID dbuuid.UUID, eventID string) {
	t.Helper()
	parsed, err := dbuuid.Parse(eventID)
	require.NoError(t, err)
	_, err = globalDB.Exec(context.Background(),
		`UPDATE calendar.event SET all_day = TRUE WHERE organization_id = $1 AND id = $2`, orgID, parsed)
	require.NoError(t, err, "set event all_day")
}

func stateByName(t *testing.T, project projectResult, name string) *rpcv1.ProjectState {
	t.Helper()
	for _, state := range project.States {
		if state.Name == name {
			return state
		}
	}
	t.Fatalf("no project state named %q", name)
	return nil
}

func otherProjectState(t *testing.T, project projectResult, current string) *rpcv1.ProjectState {
	t.Helper()
	for _, state := range project.States {
		if state.Name != current {
			return state
		}
	}
	t.Fatalf("project has only one state, cannot move off %q", current)
	return nil
}

// replaceURL blanks the echoed url so two responses about different resources can be
// compared byte for byte on everything else.
func replaceURL(t *testing.T, body []byte, url string) string {
	t.Helper()
	encoded, err := json.Marshal(url)
	require.NoError(t, err)
	return strings.ReplaceAll(string(body), string(encoded), `"<url>"`)
}

// previewProviderCalls runs the shipped aggregator over the given canonical urls and
// returns how many provider calls it took. A request costs one call per distinct resource
// *type* present, never one per link (SC-005).
func previewProviderCalls(t *testing.T, p *previewWorld, urls []string) int {
	t.Helper()
	orgLogic := organization.NewOrganizationLogic(globalQ, "")
	aggregator := linking.NewPreviewAggregator(
		collaboration.NewTaskPreviewProvider(globalQ, orgLogic),
		collaboration.NewProjectPreviewProvider(globalQ),
		docs.NewDocumentPreviewProvider(globalQ),
		calendar.NewEventPreviewProvider(globalQ),
		chat.NewChatPreviewProvider(globalQ),
		linking.NewBookingPreviewProvider(),
	)

	targets := make([]linking.PreviewTarget, 0, len(urls))
	for _, raw := range urls {
		normalized, err := linking.Normalize(raw)
		require.NoError(t, err)
		targets = append(targets, linking.PreviewTarget{
			Key:          linking.PreviewKey(normalized.Target.ResourceType, normalized.Target.ResourceID),
			Target:       normalized.Target,
			CanonicalURL: raw,
		})
	}

	reader := linking.PreviewReader{EmployeeID: p.member.ID, OrganizationID: p.member.OrgID}
	previews, calls := aggregator.Preview(t.Context(), globalDB, reader, targets)
	require.Len(t, previews, len(targets), "every distinct target should resolve for this reader")
	return calls
}

func TestChatLinkPreviews(t *testing.T) {
	t.Parallel()
	p := newPreviewWorld(t)

	// ---------------------------------------------------------------------------
	// US1 — recognize the linked work without opening it
	// ---------------------------------------------------------------------------

	t.Run("when a task link is previewed by someone who can see the task", func(t *testing.T) {
		// FR-001 FR-006 SC-002
		t.Run("it returns the task title, not an identifier", func(t *testing.T) {
			card := requireOK(t, previewOne(t, p.member.Token, p.taskURL(p.task.Id)))
			require.Equal(t, "Replace the walk-in gasket", card.Title)
			require.NotContains(t, card.Title, p.task.Id, "a card must never name a resource by its uuid")
		})
		// FR-001 SC-007
		t.Run("it returns the human-readable identifier, the state and the assignee", func(t *testing.T) {
			card := requireOK(t, previewOne(t, p.member.Token, p.taskURL(p.task.Id)))
			require.Equal(t, p.task.Identifier, card.Identifier)
			require.NotEmpty(t, card.Identifier)
			require.NotEmpty(t, card.StateName)
			require.NotEmpty(t, card.StateCategory)
			require.Equal(t, p.assigneeName, card.AssigneeName)
		})
		// FR-008
		t.Run("it returns a resource type indication a client can badge", func(t *testing.T) {
			card := requireOK(t, previewOne(t, p.member.Token, p.taskURL(p.task.Id)))
			require.Equal(t, linking.ResourceTypeTaskInstance, card.ResourceType)
			require.NotEmpty(t, card.Badge)
		})
		// FR-001 — the card names one assignee and counts the rest rather than listing them.
		t.Run("it names the second assignee count rather than listing everyone", func(t *testing.T) {
			card := requireOK(t, previewOne(t, p.member.Token, p.taskURL(p.twoAssigneeTask.Id)))
			require.Equal(t, 2, card.AssigneeCount)
			require.NotEmpty(t, card.AssigneeName)
			require.NotContains(t, card.AssigneeName, ",", "the extra assignees are a count, not a list")
		})
		// FR-007
		t.Run("it reflects the task's current state after the state changes", func(t *testing.T) {
			before := requireOK(t, previewOne(t, p.member.Token, p.taskURL(p.task.Id)))
			target := otherProjectState(t, p.publicProject, before.StateName)
			p.w.moveTask(p.owner, p.task.Id, target.Id)
			t.Cleanup(func() { p.w.moveTask(p.owner, p.task.Id, stateByName(t, p.publicProject, before.StateName).Id) })

			after := requireOK(t, previewOne(t, p.member.Token, p.taskURL(p.task.Id)))
			require.Equal(t, target.Name, after.StateName)
			require.NotEqual(t, before.StateName, after.StateName)
		})
		// FR-006 — title, then identifier, then the type name. Never the uuid.
		t.Run("it falls back to the identifier when the task has no title", func(t *testing.T) {
			card := requireOK(t, previewOne(t, p.member.Token, p.taskURL(p.untitledTask.Id)))
			require.Equal(t, p.untitledTask.Identifier, card.Title)
			require.NotContains(t, card.Title, p.untitledTask.Id)
		})
	})

	t.Run("when a document link is previewed", func(t *testing.T) {
		// FR-002
		t.Run("it returns the document title and the parent it lives under", func(t *testing.T) {
			card := requireOK(t, previewOne(t, p.member.Token, p.documentURL(p.childDocumentID)))
			require.Equal(t, "Gasket Procedure", card.Title)
			require.Equal(t, "Gasket Handbook", card.Subtitle)
		})
		// FR-002
		t.Run("it names the workspace when the document is a root document", func(t *testing.T) {
			card := requireOK(t, previewOne(t, p.member.Token, p.documentURL(p.rootDocumentID)))
			require.Equal(t, "Gasket Handbook", card.Title)
			require.Equal(t, docs.RootDocumentContainer, card.Subtitle)
		})
	})

	t.Run("when a calendar event link is previewed", func(t *testing.T) {
		// FR-003
		t.Run("it returns the event title and an instant the client can localise", func(t *testing.T) {
			card := requireOK(t, previewOne(t, p.member.Token, p.eventURL(p.orgWideEvent.Id)))
			require.Equal(t, "Gasket stocktake", card.Title)
			parsed, err := time.Parse(time.RFC3339, card.StartTime)
			require.NoError(t, err, "startTime must be an RFC3339 instant, got %q", card.StartTime)
			require.WithinDuration(t, p.eventStart, parsed, time.Minute)
		})
		// FR-003
		t.Run("it marks an all-day event so no wall-clock time is implied", func(t *testing.T) {
			allDay := p.w.calCreateEvent(p.owner, "Gasket all-day audit", p.eventStart, p.eventStart.Add(time.Hour))
			setEventVisibility(t, p.owner.OrgID, allDay.Id, "org_wide")
			setEventAllDay(t, p.owner.OrgID, allDay.Id)

			card := requireOK(t, previewOne(t, p.member.Token, p.eventURL(allDay.Id)))
			require.True(t, card.AllDay)
		})
		// FR-003 FR-010
		t.Run("it returns nothing for a cancelled event", func(t *testing.T) {
			requireUnavailable(t, previewOne(t, p.member.Token, p.eventURL(p.cancelledEvent.Id)))
		})
	})

	t.Run("when a project, channel or thread link is previewed", func(t *testing.T) {
		// FR-004
		t.Run("it returns the project name for a project link", func(t *testing.T) {
			card := requireOK(t, previewOne(t, p.member.Token, p.projectURL(p.publicProject.ID)))
			require.Equal(t, "Gasket Operations", card.Title)
			require.Equal(t, "GOPS", card.Identifier)
		})
		// FR-005
		t.Run("it returns the channel name for a channel link", func(t *testing.T) {
			card := requireOK(t, previewOne(t, p.member.Token, p.channelURL(p.publicChannelID)))
			require.Equal(t, "gasket-ops", card.Title)
			require.Equal(t, linking.ResourceTypeChatChannel, card.ResourceType)
		})
		// FR-005
		t.Run("it returns the parent channel name and a thread indication for a thread", func(t *testing.T) {
			card := requireOK(t, previewOne(t, p.member.Token, p.threadURL(p.threadRootID)))
			require.Equal(t, "gasket-ops", card.Title)
			require.Equal(t, linking.ResourceTypeChatThread, card.ResourceType)
			require.Equal(t, "Thread", card.Badge)
		})
		// FR-005 — previewing a thread must not render the conversation it points at,
		// which is also what closes the "channel linked inside the channel being read"
		// recursion by construction.
		t.Run("it returns nothing drawn from the thread's messages", func(t *testing.T) {
			card := requireOK(t, previewOne(t, p.member.Token, p.threadURL(p.threadRootID)))
			body, err := json.Marshal(card)
			require.NoError(t, err)
			require.NotContains(t, string(body), "Gasket thread root")
		})
	})

	t.Run("when the reader is not entitled to the linked resource", func(t *testing.T) {
		// FR-009 SC-004
		t.Run("a task in a private project the reader is not in returns nothing", func(t *testing.T) {
			requireUnavailable(t, previewOne(t, p.outsider.Token, p.taskURL(p.privateTask.Id)))
		})
		// FR-009 — an explicit 'none' grant is a deny that outranks the public visibility.
		t.Run("a document with an explicit deny grant returns nothing", func(t *testing.T) {
			requireUnavailable(t, previewOne(t, p.member.Token, p.documentURL(p.deniedDocumentID)))
		})
		// FR-009
		t.Run("a private event the reader neither organises nor attends returns nothing", func(t *testing.T) {
			requireUnavailable(t, previewOne(t, p.outsider.Token, p.eventURL(p.privateEvent.Id)))
		})
		// FR-009
		t.Run("a private channel the reader is not in returns nothing", func(t *testing.T) {
			requireUnavailable(t, previewOne(t, p.outsider.Token, p.channelURL(p.privateChannelID)))
		})
		// FR-010
		t.Run("a deleted task returns nothing", func(t *testing.T) {
			deleteTask(t, p.w, p.owner, p.deletedTask.Id)
			requireUnavailable(t, previewOne(t, p.member.Token, p.taskURL(p.deletedTask.Id)))
		})
		// FR-010
		t.Run("a resource that never existed returns nothing", func(t *testing.T) {
			requireUnavailable(t, previewOne(t, p.member.Token, p.taskURL(dbuuid.Must().String())))
		})
		// FR-010 SC-004 — the property a behavioural test can pass while the
		// implementation is subtly wrong: a length, ordering or stray-field difference
		// between these two bodies is a disclosure oracle.
		t.Run("the denied and the missing cases are byte-identical responses", func(t *testing.T) {
			for _, pair := range []struct {
				name    string
				reader  testUser
				denied  string
				missing string
			}{
				{"task", p.outsider, p.taskURL(p.privateTask.Id), p.taskURL(dbuuid.Must().String())},
				{"document", p.member, p.documentURL(p.deniedDocumentID), p.documentURL(dbuuid.Must().String())},
				{"event", p.outsider, p.eventURL(p.privateEvent.Id), p.eventURL(dbuuid.Must().String())},
				{"channel", p.outsider, p.channelURL(p.privateChannelID), p.channelURL(dbuuid.Must().String())},
				{"thread", p.outsider, p.threadURL(p.privateThreadRootID), p.threadURL(dbuuid.Must().String())},
			} {
				t.Run(pair.name, func(t *testing.T) {
					_, _, deniedBody := postPreviews(t, pair.reader.Token, []string{pair.denied})
					_, _, missingBody := postPreviews(t, pair.reader.Token, []string{pair.missing})
					require.Equal(t,
						replaceURL(t, deniedBody, pair.denied),
						replaceURL(t, missingBody, pair.missing),
						"denied and missing must be indistinguishable once the echoed url is normalised out")
				})
			}
		})

		// FR-010
		t.Run("an unauthenticated request returns nothing for every url", func(t *testing.T) {
			status, payload, _ := postPreviews(t, "", []string{
				p.taskURL(p.task.Id),
				p.documentURL(p.rootDocumentID),
			})
			require.Equal(t, http.StatusOK, status, "signed out is not an error, it is an empty answer")
			require.Len(t, payload.Items, 2)
			for _, item := range payload.Items {
				requireUnavailable(t, item)
			}
		})
		// FR-012
		t.Run("a link bearing another organization's tenant key returns nothing", func(t *testing.T) {
			foreign := postCanonicalGenerate(t, linking.CanonicalLinkTarget{
				TenantKey:    p.foreignTenantKey,
				ResourceType: linking.ResourceTypeTaskInstance,
				ResourceID:   p.foreignTaskID,
			}).CanonicalURL
			requireUnavailable(t, previewOne(t, p.owner.Token, foreign))
		})
	})

	// FR-011
	t.Run("when two readers request the same link", func(t *testing.T) {
		t.Run("each sees the outcome their own access allows", func(t *testing.T) {
			url := p.taskURL(p.privateTask.Id)
			requireOK(t, previewOne(t, p.owner.Token, url))
			requireUnavailable(t, previewOne(t, p.outsider.Token, url))
		})
	})

	// ---------------------------------------------------------------------------
	// US2 — see every resource a message links
	// ---------------------------------------------------------------------------

	t.Run("when one request carries several links", func(t *testing.T) {
		// FR-020 SC-005
		t.Run("every accessible link is resolved in one request", func(t *testing.T) {
			status, payload, _ := postPreviews(t, p.member.Token, []string{
				p.taskURL(p.task.Id),
				p.documentURL(p.rootDocumentID),
				p.eventURL(p.orgWideEvent.Id),
				p.projectURL(p.publicProject.ID),
				p.channelURL(p.publicChannelID),
			})
			require.Equal(t, http.StatusOK, status)
			require.Len(t, payload.Items, 5)
			for _, item := range payload.Items {
				requireOK(t, item)
			}
		})
		// FR-013
		t.Run("the items come back in request order, echoing each url", func(t *testing.T) {
			urls := []string{
				p.eventURL(p.orgWideEvent.Id),
				p.taskURL(p.task.Id),
				p.documentURL(p.rootDocumentID),
			}
			_, payload, _ := postPreviews(t, p.member.Token, urls)
			require.Len(t, payload.Items, len(urls))
			for i, url := range urls {
				require.Equal(t, url, payload.Items[i].URL, "item %d must echo the url as sent", i)
			}
			require.Equal(t, "Gasket stocktake", payload.Items[0].Preview.Title)
			require.Equal(t, "Replace the walk-in gasket", payload.Items[1].Preview.Title)
		})
		// FR-013 SC-008
		t.Run("an accessible and an inaccessible link are answered independently", func(t *testing.T) {
			_, payload, _ := postPreviews(t, p.outsider.Token, []string{
				p.taskURL(p.task.Id),
				p.taskURL(p.privateTask.Id),
			})
			require.Len(t, payload.Items, 2)
			requireOK(t, payload.Items[0])
			requireUnavailable(t, payload.Items[1])
		})
		// FR-023
		t.Run("a malformed url is unavailable and does not fail the batch", func(t *testing.T) {
			_, payload, _ := postPreviews(t, p.member.Token, []string{
				"not-a-url-at-all",
				p.taskURL(p.task.Id),
			})
			require.Len(t, payload.Items, 2)
			requireUnavailable(t, payload.Items[0])
			requireOK(t, payload.Items[1])
		})
		// FR-023 — 'workspace' describes no resource of its own and was never previewable.
		t.Run("a link to an unsupported resource type is unavailable", func(t *testing.T) {
			_, payload, _ := postPreviews(t, p.member.Token, []string{
				p.canonical(linking.ResourceTypeWorkspace, p.tenantKey),
				p.taskURL(p.task.Id),
			})
			require.Len(t, payload.Items, 2)
			requireUnavailable(t, payload.Items[0])
			requireOK(t, payload.Items[1])
		})
		// FR-024 — over the bound is a rejection, not a truncation: the clients hold the
		// same constant, so exceeding it is a client bug rather than a user action.
		t.Run("more urls than the request bound is rejected outright", func(t *testing.T) {
			urls := make([]string, linking.MaxPreviewURLsPerRequest+1)
			taskURL := p.taskURL(p.task.Id)
			for i := range urls {
				urls[i] = taskURL
			}
			status, _, _ := postPreviews(t, p.member.Token, urls)
			require.Equal(t, http.StatusBadRequest, status)
		})
		// FR-014
		t.Run("the same url twice is looked up once and answered twice", func(t *testing.T) {
			taskURL := p.taskURL(p.task.Id)
			_, payload, _ := postPreviews(t, p.member.Token, []string{taskURL, taskURL})
			require.Len(t, payload.Items, 2)
			first := requireOK(t, payload.Items[0])
			second := requireOK(t, payload.Items[1])
			require.Equal(t, first, second)
		})
	})

	// ---------------------------------------------------------------------------
	// US3 — cost
	// ---------------------------------------------------------------------------

	// SC-005: the cost of a request is one provider call per distinct resource *type*
	// present, not one per link. The count is observed through the aggregator's own log
	// line rather than a test-only hook, so the assertion cannot drift from what ships.
	t.Run("when one request carries twenty links over five resources of three types", func(t *testing.T) {
		t.Run("it resolves in three provider calls", func(t *testing.T) {
			distinct := []string{
				p.taskURL(p.task.Id),
				p.taskURL(p.twoAssigneeTask.Id),
				p.documentURL(p.rootDocumentID),
				p.documentURL(p.childDocumentID),
				p.eventURL(p.orgWideEvent.Id),
			}
			urls := make([]string, linking.MaxPreviewURLsPerRequest)
			for i := range urls {
				urls[i] = distinct[i%len(distinct)]
			}

			status, payload, _ := postPreviews(t, p.member.Token, urls)
			require.Equal(t, http.StatusOK, status)
			require.Len(t, payload.Items, linking.MaxPreviewURLsPerRequest)
			for _, item := range payload.Items {
				requireOK(t, item)
			}

			// The request resolved; now assert what it cost. The aggregator's grouping is
			// the thing under test, so it is driven directly here with the same providers
			// cmd/server.go wires — no production code grows a test-only hook, and the
			// number asserted is the number the aggregator's own slog line reports.
			require.Equal(t, 3, previewProviderCalls(t, p, distinct), "three resource types, three provider calls")
		})
	})

	// The fixture itself is the Phase 2 checkpoint: the endpoint answers, and the one
	// resource type that reads no row resolves.
	t.Run("when the resource type is booking", func(t *testing.T) {
		// FR-008
		t.Run("it keeps its generic card without reading a row", func(t *testing.T) {
			item := previewOne(t, p.owner.Token, p.canonical(linking.ResourceTypeBookingItem, dbuuid.Must().String()))
			card := requireOK(t, item)
			require.Equal(t, "Booking", card.Title)
			require.Equal(t, linking.ResourceTypeBookingItem, card.ResourceType)
		})
	})
}

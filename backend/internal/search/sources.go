package search

import (
	"context"
	"fmt"
	"strings"

	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/internal/calendar"
	"github.com/nvcnvn/tech-office/backend/internal/chat"
	"github.com/nvcnvn/tech-office/backend/internal/collaboration"
	"github.com/nvcnvn/tech-office/backend/internal/docs"
	"github.com/nvcnvn/tech-office/backend/internal/files"
	"github.com/nvcnvn/tech-office/backend/internal/organization"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// Permission ids, one per source. Every one of them is already in the catalogue; this
// feature introduces none. Events have no entry because calendar search is
// any-authenticated today and the events themselves are visibility-filtered per row —
// inventing a calendar.search permission would be a scope change nobody asked for.
const (
	PermissionSearchEmployees   = "org.searchEmployees"
	PermissionSearchDepartments = "org.searchDepartments"
	PermissionSearchChat        = "chat.search"
	PermissionViewDocuments     = "docs.view"
	PermissionSearchFiles       = "files.search"
	PermissionViewTask          = "collab.viewTask"
)

// Deps are the six domains' logic-layer interfaces. This package holds no Queries field
// and has no .query.sql file of its own (Constitution IV).
type Deps struct {
	Organization  organization.OrganizationLogic
	Chat          chat.ChatLogic
	Docs          docs.DocumentLogic
	Files         files.SearchLogic
	Collaboration collaboration.Logic
	Calendar      calendar.Logic
}

// sourceQuery is what every adapter is handed: the caller, what they typed, and how many
// rows this source is allowed to contribute.
type sourceQuery struct {
	orgID      dbuuid.UUID
	employeeID dbuuid.UUID
	text       string
	limit      int32
}

// adapter turns one domain's rows into SearchHits, in that domain's own rank order.
type adapter func(ctx context.Context, db database.DBTX, q sourceQuery) ([]*rpcv1.SearchHit, error)

type source struct {
	kind rpcv1.SearchKind
	// priority breaks ties between hits of equal within-source rank. People are first
	// because a name typed into a search box is most often a person's; messages are last
	// because they are the noisiest source and the least likely to be the thing somebody
	// typed a *name* to find.
	priority   int
	permission string
	fetch      adapter
}

// buildSources is the eight-entry descriptor table, in the fixed source order the
// outcomes are always reported in.
func buildSources(d Deps) []source {
	table := []source{
		{kind: rpcv1.SearchKind_SEARCH_KIND_PERSON, permission: PermissionSearchEmployees, fetch: personAdapter(d.Organization)},
		{kind: rpcv1.SearchKind_SEARCH_KIND_CHANNEL, permission: PermissionSearchChat, fetch: channelAdapter(d.Chat)},
		{kind: rpcv1.SearchKind_SEARCH_KIND_DOCUMENT, permission: PermissionViewDocuments, fetch: documentAdapter(d.Docs)},
		{kind: rpcv1.SearchKind_SEARCH_KIND_WORK_ITEM, permission: PermissionViewTask, fetch: workItemAdapter(d.Collaboration)},
		{kind: rpcv1.SearchKind_SEARCH_KIND_EVENT, permission: "", fetch: eventAdapter(d.Calendar)},
		{kind: rpcv1.SearchKind_SEARCH_KIND_FILE, permission: PermissionSearchFiles, fetch: fileAdapter(d.Files)},
		{kind: rpcv1.SearchKind_SEARCH_KIND_DEPARTMENT, permission: PermissionSearchDepartments, fetch: departmentAdapter(d.Organization)},
		{kind: rpcv1.SearchKind_SEARCH_KIND_MESSAGE, permission: PermissionSearchChat, fetch: messageAdapter(d.Chat)},
	}
	for i := range table {
		table[i].priority = i
	}
	return table
}

// TargetID is the identifier that makes the merge order total: the field of the target
// that identifies the thing itself, per kind.
func TargetID(h *rpcv1.SearchHit) string {
	t := h.GetTarget()
	if t == nil {
		return ""
	}
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
	default:
		return ""
	}
}

// ─── Adapters ────────────────────────────────────────────────────────────────
//
// Each one calls its domain's own search method, which is where that domain's access
// rule lives. None of them filters, and none of them re-checks: a row that comes back is
// a row the caller may open.
//
// snippet is populated only by the two sources that produce one AND whose content the
// caller is entitled to read — documents and messages, both access-filtered inside their
// own queries. Every other kind leaves it empty rather than excerpting content the
// caller has not been granted.

func personAdapter(l organization.OrganizationLogic) adapter {
	return func(ctx context.Context, db database.DBTX, q sourceQuery) ([]*rpcv1.SearchHit, error) {
		rows, err := l.SearchEmployees(ctx, db, q.orgID, q.text, q.limit, nil)
		if err != nil {
			return nil, err
		}
		hits := make([]*rpcv1.SearchHit, 0, len(rows))
		for _, r := range rows {
			hits = append(hits, &rpcv1.SearchHit{
				Kind:        rpcv1.SearchKind_SEARCH_KIND_PERSON,
				Title:       strings.TrimSpace(r.GivenName + " " + r.FamilyName),
				ContextLine: r.Email,
				Target:      &rpcv1.SearchTarget{EmployeeId: r.ID.String()},
			})
		}
		return hits, nil
	}
}

func departmentAdapter(l organization.OrganizationLogic) adapter {
	return func(ctx context.Context, db database.DBTX, q sourceQuery) ([]*rpcv1.SearchHit, error) {
		rows, err := l.SearchDepartments(ctx, db, q.orgID, q.text, q.limit, nil)
		if err != nil {
			return nil, err
		}
		hits := make([]*rpcv1.SearchHit, 0, len(rows))
		for _, r := range rows {
			members := "1 member"
			if r.MemberCount != 1 {
				members = fmt.Sprintf("%d members", r.MemberCount)
			}
			hits = append(hits, &rpcv1.SearchHit{
				Kind:        rpcv1.SearchKind_SEARCH_KIND_DEPARTMENT,
				Title:       r.Name,
				ContextLine: members,
				Target:      &rpcv1.SearchTarget{DepartmentId: r.ID.String()},
			})
		}
		return hits, nil
	}
}

func channelAdapter(l chat.ChatLogic) adapter {
	return func(ctx context.Context, db database.DBTX, q sourceQuery) ([]*rpcv1.SearchHit, error) {
		rows, err := l.SearchChannels(ctx, db, q.orgID, q.employeeID, q.text, q.limit, nil)
		if err != nil {
			return nil, err
		}
		hits := make([]*rpcv1.SearchHit, 0, len(rows))
		for _, r := range rows {
			contextLine := "Channel"
			if r.IsPrivate {
				contextLine = "Private channel"
			}
			hits = append(hits, &rpcv1.SearchHit{
				Kind:        rpcv1.SearchKind_SEARCH_KIND_CHANNEL,
				Title:       r.DisplayName,
				ContextLine: contextLine,
				Target:      &rpcv1.SearchTarget{ChannelId: r.ID.String()},
			})
		}
		return hits, nil
	}
}

func messageAdapter(l chat.ChatLogic) adapter {
	return func(ctx context.Context, db database.DBTX, q sourceQuery) ([]*rpcv1.SearchHit, error) {
		rows, err := l.SearchMessages(ctx, db, q.orgID, q.employeeID, q.text, q.limit, nil)
		if err != nil {
			return nil, err
		}
		hits := make([]*rpcv1.SearchHit, 0, len(rows))
		for _, r := range rows {
			hits = append(hits, &rpcv1.SearchHit{
				Kind:        rpcv1.SearchKind_SEARCH_KIND_MESSAGE,
				Title:       truncate(r.MessageText, 120),
				ContextLine: "in #" + r.ChannelName,
				// A message opens the channel it was posted in, not itself.
				Target: &rpcv1.SearchTarget{
					ChannelId: r.ChannelID.String(),
					MessageId: r.ID.String(),
				},
			})
		}
		return hits, nil
	}
}

func documentAdapter(l docs.DocumentLogic) adapter {
	return func(ctx context.Context, db database.DBTX, q sourceQuery) ([]*rpcv1.SearchHit, error) {
		// employeeID is what scopes this to documents the caller may read: the predicate
		// lives in SearchDocuments itself, so the same rule serves every caller.
		results, err := l.SearchDocuments(ctx, db, q.orgID, q.employeeID, q.text, nil, nil, q.limit)
		if err != nil {
			return nil, err
		}
		hits := make([]*rpcv1.SearchHit, 0, len(results))
		for _, r := range results {
			doc := r.GetDocument()
			if doc == nil {
				continue
			}
			hits = append(hits, &rpcv1.SearchHit{
				Kind:        rpcv1.SearchKind_SEARCH_KIND_DOCUMENT,
				Title:       doc.GetTitle(),
				ContextLine: "Document",
				Snippet:     r.GetSnippet(),
				// A slug, not an id: both document viewers route by slug, and an
				// id-only target pushes /docs/undefined.
				Target: &rpcv1.SearchTarget{DocumentSlug: doc.GetSlug()},
			})
		}
		return hits, nil
	}
}

func fileAdapter(l files.SearchLogic) adapter {
	return func(ctx context.Context, db database.DBTX, q sourceQuery) ([]*rpcv1.SearchHit, error) {
		results, err := l.SearchFiles(ctx, db, q.orgID, q.employeeID, q.text, q.limit)
		if err != nil {
			return nil, err
		}
		hits := make([]*rpcv1.SearchHit, 0, len(results))
		for _, r := range results {
			hits = append(hits, &rpcv1.SearchHit{
				Kind:        rpcv1.SearchKind_SEARCH_KIND_FILE,
				Title:       r.OriginalFilename,
				ContextLine: uploadContextLabel(r.UploadContext),
				Target:      &rpcv1.SearchTarget{FileId: r.FileID.String()},
			})
		}
		return hits, nil
	}
}

func workItemAdapter(l collaboration.Logic) adapter {
	return func(ctx context.Context, db database.DBTX, q sourceQuery) ([]*rpcv1.SearchHit, error) {
		rows, err := l.SearchTasks(ctx, db, q.orgID, q.employeeID, q.text, q.limit, dbuuid.NullUUID{})
		if err != nil {
			return nil, err
		}
		hits := make([]*rpcv1.SearchHit, 0, len(rows))
		for _, r := range rows {
			// Ordinary tasks and ritual instances are the same kind of thing to the
			// person searching — work with a name and a due date. The row says which.
			what := "Task"
			if r.TaskKind == "ritual_instance" {
				what = "Ritual"
			}
			hits = append(hits, &rpcv1.SearchHit{
				Kind:        rpcv1.SearchKind_SEARCH_KIND_WORK_ITEM,
				Title:       r.Title,
				ContextLine: r.ProjectName + " · " + what,
				// Both task routes are project-scoped, so the project id travels with
				// the task id rather than costing a GetTask round-trip on every tap.
				Target: &rpcv1.SearchTarget{
					ProjectId: r.ProjectID.String(),
					TaskId:    r.ID.String(),
				},
			})
		}
		return hits, nil
	}
}

func eventAdapter(l calendar.Logic) adapter {
	return func(ctx context.Context, db database.DBTX, q sourceQuery) ([]*rpcv1.SearchHit, error) {
		events, _, err := l.SearchEvents(ctx, db, q.orgID, q.employeeID, &calendar.SearchEventsParams{
			Query: q.text,
			Limit: q.limit,
		})
		if err != nil {
			return nil, err
		}
		hits := make([]*rpcv1.SearchHit, 0, len(events))
		for _, e := range events {
			startsAt := ""
			if e.GetStartTime() != nil {
				startsAt = e.GetStartTime().AsTime().UTC().Format("2 Jan 2006")
			}
			hits = append(hits, &rpcv1.SearchHit{
				Kind:        rpcv1.SearchKind_SEARCH_KIND_EVENT,
				Title:       e.GetTitle(),
				ContextLine: startsAt,
				Target:      &rpcv1.SearchTarget{EventId: e.GetId()},
			})
		}
		return hits, nil
	}
}

// uploadContextLabel says where a file was uploaded without a second query into another
// domain's tables. The specific container's name (which channel, which project) would
// need a cross-domain lookup per hit on the slowest path there is.
func uploadContextLabel(uploadContext string) string {
	switch uploadContext {
	case files.UploadContextChat:
		return "Shared in chat"
	case files.UploadContextProject:
		return "Project file"
	case files.UploadContextDocs:
		return "Document attachment"
	case files.UploadContextCalendar:
		return "Event attachment"
	case files.UploadContextAvatar:
		return "Avatar"
	default:
		return "File"
	}
}

func truncate(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return strings.TrimSpace(string(r[:max])) + "…"
}

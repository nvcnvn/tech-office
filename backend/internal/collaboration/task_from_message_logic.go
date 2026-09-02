package collaboration

import (
	"context"
	"fmt"
	"html"
	"log/slog"
	"regexp"
	"strings"

	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// CreateTaskFromMessage turns a chat message into an ordinary standard task.
//
// It deliberately does not reimplement task creation. It validates what is specific to
// this path — the title, the source message, the destination — and then delegates to
// CreateTask, so workflow rules, notifications, search indexing and analytics all apply
// exactly as they do for a task created through the full form. Afterwards it records
// where the task came from and asks chat to leave a threaded note on the source message.
//
// Everything here runs on the caller's transaction. The task row, its origin columns and
// the announcement commit together or not at all: a task with no announcement, or an
// announcement pointing at a task that was rolled back, would both be visible lies.
func (l *logicImpl) CreateTaskFromMessage(
	ctx context.Context,
	tx database.DBTX,
	orgID, actorID dbuuid.UUID,
	req *rpcv1.CreateTaskFromMessageRequest,
) (*rpcv1.Task, dbuuid.UUID, error) {
	title := strings.TrimSpace(req.GetTitle())
	if title == "" {
		return nil, dbuuid.UUID{}, ErrEmptyTaskTitle
	}
	if req.GetProjectId() == "" {
		return nil, dbuuid.UUID{}, ErrProjectNotFound
	}

	sourceChannelID, err := parseUUID(req.GetSourceChannelId())
	if err != nil {
		return nil, dbuuid.UUID{}, ErrSourceMessageNotConvertible
	}
	sourceMessageID, err := parseUUID(req.GetSourceMessageId())
	if err != nil {
		return nil, dbuuid.UUID{}, ErrSourceMessageNotConvertible
	}
	projectID, err := parseUUID(req.GetProjectId())
	if err != nil {
		return nil, dbuuid.UUID{}, ErrProjectNotFound
	}

	// Reading the message through chat is also the channel access check: a caller who
	// cannot read the channel cannot read the message either, so a private channel they
	// do not belong to is refused here rather than by a separate lookup.
	message, err := l.ChatLogic.GetMessage(ctx, tx, orgID, actorID, sourceMessageID)
	if err != nil {
		return nil, dbuuid.UUID{}, fmt.Errorf("failed to read source message: %w", err)
	}
	if message.GetIsDeleted() {
		return nil, dbuuid.UUID{}, ErrSourceMessageNotConvertible
	}
	// A system message is a record the system wrote about itself, not something a person
	// said and might want tracked.
	if message.GetMessageKind() == messageKindSystem {
		return nil, dbuuid.UUID{}, ErrSourceMessageNotConvertible
	}
	// The channel the request names must be the channel the message is actually in;
	// otherwise the origin would point at a conversation the message was never part of.
	if message.GetChannelId() != sourceChannelID.String() {
		return nil, dbuuid.UUID{}, ErrSourceMessageNotConvertible
	}

	// The destination must be usable before anything is written. A project the caller
	// cannot write to, or one that is archived, is refused with a precondition rather than
	// a bare denial, so the client can reopen the picker instead of showing a dead end.
	if err := l.assertDestinationUsable(ctx, tx, orgID, actorID, projectID); err != nil {
		return nil, dbuuid.UUID{}, err
	}

	createReq := &rpcv1.CreateTaskRequest{
		ProjectId:    req.GetProjectId(),
		Title:        title,
		ParentTaskId: req.ParentTaskId,
		DueDate:      req.DueDate,
	}
	if req.AssigneeEmployeeId != nil && *req.AssigneeEmployeeId != "" {
		createReq.AssigneeEmployeeIds = []string{*req.AssigneeEmployeeId}
	}

	task, err := l.CreateTask(ctx, tx, orgID, actorID, createReq)
	if err != nil {
		return nil, dbuuid.UUID{}, err
	}
	taskID, err := parseUUID(task.GetId())
	if err != nil {
		return nil, dbuuid.UUID{}, fmt.Errorf("created task has an unreadable id: %w", err)
	}

	withOrigin, err := l.Queries.SetTaskOrigin(ctx, tx, &database.SetTaskOriginParams{
		OrganizationID:  orgID,
		ID:              taskID,
		SourceChannelID: dbuuid.UUIDToNullUUID(sourceChannelID),
		SourceMessageID: dbuuid.UUIDToNullUUID(sourceMessageID),
	})
	if err != nil {
		return nil, dbuuid.UUID{}, fmt.Errorf("failed to record task origin: %w", err)
	}
	// Re-read from the row that was actually written rather than assuming, so the proto
	// carries what the database holds.
	task = l.taskToProto(withOrigin, nil, nil)

	// The channel remembers where its tasks go, but only the first time. A later
	// conversion that overrides the project for itself must leave the channel's default
	// exactly as it was, which is what DO NOTHING expresses in one statement
	// (FR-015, FR-016).
	if err := l.Queries.RememberChannelTaskDestination(ctx, tx, &database.RememberChannelTaskDestinationParams{
		OrganizationID:  orgID,
		ChannelID:       sourceChannelID,
		ProjectID:       projectID,
		SetByEmployeeID: actorID,
	}); err != nil {
		return nil, dbuuid.UUID{}, fmt.Errorf("failed to remember channel task destination: %w", err)
	}

	announcementID, err := l.ChatLogic.AnnounceTaskCreatedFromMessage(
		ctx, tx, orgID, actorID, sourceChannelID, sourceMessageID, taskID,
		task.GetIdentifier(), task.GetTitle(),
	)
	if err != nil {
		// Failing here rolls the task back with everything else. A task whose conversion
		// left no trace in the conversation is worse than a refused conversion the user
		// can retry.
		return nil, dbuuid.UUID{}, fmt.Errorf("failed to announce task creation: %w", err)
	}

	slog.InfoContext(ctx, "task created from chat message",
		"taskID", taskID, "identifier", task.GetIdentifier(),
		"sourceChannelID", sourceChannelID, "sourceMessageID", sourceMessageID,
	)

	return task, announcementID, nil
}

// assertDestinationUsable refuses a destination project the caller cannot actually put a
// task in. It distinguishes "archived" from "you are a viewer" only in the log: both
// reach the client as a precondition failure naming the project, which is what the client
// needs in order to reopen the picker.
func (l *logicImpl) assertDestinationUsable(
	ctx context.Context,
	tx database.DBTX,
	orgID, actorID, projectID dbuuid.UUID,
) error {
	project, err := l.Queries.GetProject(ctx, tx, &database.GetProjectParams{
		OrganizationID: orgID,
		ID:             projectID,
	})
	if err != nil {
		// A project in another organization is not found under this tenant, which is the
		// same answer as one that never existed. Neither confirms it exists elsewhere.
		return ErrProjectNotFound
	}
	if project.IsArchived {
		return fmt.Errorf("%w: %s is archived", ErrDestinationUnusable, project.Name)
	}

	role, err := l.GetProjectMemberRole(ctx, tx, orgID, projectID, actorID)
	if err != nil || role == ProjectMemberRoleViewer {
		return ErrAccessDenied
	}
	return nil
}

// ---------------------------------------------------------------------------
// Deriving a task title from a message body
// ---------------------------------------------------------------------------

var (
	htmlTagPattern    = regexp.MustCompile(`<[^>]*>`)
	whitespacePattern = regexp.MustCompile(`\s+`)
)

// TitleFromMessageBody turns a stored message body into the title the quick sheet opens
// with. The body is sanitized HTML, so formatting is stripped to plain text, runs of
// whitespace collapse to single spaces, and a long message is cut at a word boundary
// rather than mid-word.
//
// An attachment-only or empty message yields an empty string. That is not an error: the
// sheet simply opens with an empty title for the user to fill in, and the empty title is
// refused only if they confirm without typing one.
func TitleFromMessageBody(body string) string {
	// Block-level tags are boundaries between words, not word joins: stripping <p>x</p><p>y</p>
	// without this would produce "xy".
	text := htmlTagPattern.ReplaceAllString(body, " ")
	text = html.UnescapeString(text)
	text = strings.TrimSpace(whitespacePattern.ReplaceAllString(text, " "))

	// Counted in runes, not bytes: a byte-slice of a multibyte character would produce
	// mojibake in the title the user is shown.
	runes := []rune(text)
	if len(runes) <= MaxTaskTitleLength {
		return text
	}

	cut := string(runes[:MaxTaskTitleLength])
	// Prefer the last word boundary inside the limit. If the first word is longer than the
	// whole limit there is no boundary to find, and a hard cut is the only option left.
	if idx := strings.LastIndex(cut, " "); idx > 0 {
		cut = cut[:idx]
	}
	return strings.TrimSpace(cut)
}

// parseUUID is the non-panicking counterpart to dbuuid.MustParse, for ids that arrive
// from a request and must produce an error rather than take the server down.
func parseUUID(s string) (dbuuid.UUID, error) {
	if s == "" {
		return dbuuid.UUID{}, fmt.Errorf("empty uuid")
	}
	return dbuuid.Parse(s)
}

const messageKindSystem = "system"

// ---------------------------------------------------------------------------
// Reading the link back: message → task, and task → message
// ---------------------------------------------------------------------------

// ListTasksBySourceMessages resolves, in one call, the chips a whole rendered page of
// chat messages carries. The repeated request shape is the contract-level guarantee
// against an N+1; nothing here should ever be called once per message.
//
// Links to tasks in projects the caller cannot see are omitted rather than flagged: a
// flagged entry would still leak the identifier and title of work they may not know
// about (FR-021). The omission happens in SQL, so no filtered row is ever loaded.
func (l *logicImpl) ListTasksBySourceMessages(
	ctx context.Context,
	tx database.DBTX,
	orgID, actorID dbuuid.UUID,
	messageIDs []string,
) ([]*rpcv1.MessageTaskLink, error) {
	if len(messageIDs) == 0 {
		return nil, nil
	}
	if len(messageIDs) > MaxSourceMessagesPerLookup {
		return nil, ErrTooManySourceMessages
	}

	parsed := make([]dbuuid.UUID, 0, len(messageIDs))
	for _, raw := range messageIDs {
		id, err := parseUUID(raw)
		if err != nil {
			// One malformed id in a page of message ids should not blank out every chip
			// on the page, so it is skipped rather than failing the call.
			slog.WarnContext(ctx, "skipping unparseable message id in chip lookup", "messageID", raw)
			continue
		}
		parsed = append(parsed, id)
	}
	if len(parsed) == 0 {
		return nil, nil
	}

	rows, err := l.Queries.ListTasksBySourceMessages(ctx, tx, &database.ListTasksBySourceMessagesParams{
		OrganizationID: orgID,
		MessageIds:     parsed,
		EmployeeID:     actorID,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to resolve tasks by source message: %w", err)
	}

	links := make([]*rpcv1.MessageTaskLink, 0, len(rows))
	for _, r := range rows {
		if !r.SourceMessageID.Valid {
			continue
		}
		links = append(links, &rpcv1.MessageTaskLink{
			SourceMessageId: r.SourceMessageID.UUID.String(),
			TaskId:          r.ID.String(),
			Identifier:      r.Identifier,
			Title:           r.Title,
			ProjectId:       r.ProjectID.String(),
			StateName:       r.StateName,
			StateCategory:   stringToStateCategoryProto(r.StateCategory),
		})
	}
	return links, nil
}

// GetTaskOrigin resolves the origin block shown on a task that came from a message:
// which conversation it was said in, who said it, and what they said.
//
// It is separate from GetTask so the ordinary task read stays a single-domain query;
// the client calls it only when Task.source_message_id is set.
//
// A soft-deleted source message does not remove the origin. The task keeps its channel
// and message ids and the block still names the conversation; only the excerpt becomes
// unavailable (FR-023).
func (l *logicImpl) GetTaskOrigin(
	ctx context.Context,
	tx database.DBTX,
	orgID, actorID dbuuid.UUID,
	taskID dbuuid.UUID,
) (*rpcv1.GetTaskOriginResponse, error) {
	origin, err := l.Queries.GetTaskOrigin(ctx, tx, &database.GetTaskOriginParams{
		OrganizationID: orgID,
		ID:             taskID,
	})
	if err != nil {
		return nil, ErrTaskNotFound
	}
	if !origin.SourceChannelID.Valid || !origin.SourceMessageID.Valid {
		return &rpcv1.GetTaskOriginResponse{HasOrigin: false}, nil
	}

	channelID := dbuuid.UUID(origin.SourceChannelID.UUID)
	messageID := dbuuid.UUID(origin.SourceMessageID.UUID)
	resp := &rpcv1.GetTaskOriginResponse{
		HasOrigin:       true,
		SourceChannelId: channelID.String(),
		SourceMessageId: messageID.String(),
	}

	// Both chat reads run as the caller, so a viewer who can see the task but not the
	// private channel it came from gets the identifiers and nothing else. That is the
	// honest answer: the origin exists, they just cannot read it.
	if channel, _, chErr := l.ChatLogic.GetChannel(ctx, tx, orgID, actorID, channelID); chErr == nil {
		resp.ChannelDisplayName = channel.GetDisplayName()
	} else {
		slog.DebugContext(ctx, "task origin channel not readable by caller",
			"taskID", taskID, "channelID", channelID, "error", chErr)
	}

	message, msgErr := l.ChatLogic.GetMessage(ctx, tx, orgID, actorID, messageID)
	if msgErr != nil {
		slog.DebugContext(ctx, "task origin message not readable by caller",
			"taskID", taskID, "messageID", messageID, "error", msgErr)
		return resp, nil
	}
	resp.AuthorDisplayName = message.GetAuthorName()
	if message.GetIsDeleted() {
		// The row survives a soft delete with placeholder text; showing that placeholder
		// as an excerpt would misrepresent it as what was said.
		return resp, nil
	}
	resp.SourceMessageAvailable = true
	resp.ExcerptHtml = message.GetMessageText()
	return resp, nil
}

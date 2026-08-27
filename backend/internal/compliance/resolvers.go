package compliance

import (
	"context"
	"fmt"
	"strings"

	"github.com/nvcnvn/tech-office/backend/database"
	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/internal/files"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// The resolvers below are the whole of Principle IV for this domain: a report can
// target a chat message, a direct message, an uploaded file, a document comment or
// a call record, and each is fetched by asking the domain that owns it. Nothing
// here joins across schemas, and nothing trusts the client for authorship.
//
// Each interface is declared here rather than imported so that the owning packages
// keep no knowledge of compliance.

// --- chat messages and direct messages ---

type MessageGetter interface {
	GetMessage(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, messageID dbuuid.UUID) (*rpcv1.Message, error)
}

type chatMessageResolver struct {
	chat   MessageGetter
	direct bool
}

// NewChatMessageResolver resolves a message posted in a channel.
func NewChatMessageResolver(chat MessageGetter) TargetResolver {
	return &chatMessageResolver{chat: chat}
}

// NewDirectMessageResolver resolves a message in a direct conversation. The lookup
// is the same; the target kind differs so a reviewer can see at a glance whether
// the report is about something said in the open or in private.
func NewDirectMessageResolver(chat MessageGetter) TargetResolver {
	return &chatMessageResolver{chat: chat, direct: true}
}

func (r *chatMessageResolver) ResolveReportTarget(
	ctx context.Context,
	tx database.DBTX,
	orgID, viewerID, targetID dbuuid.UUID,
) (ReportTarget, error) {
	msg, err := r.chat.GetMessage(ctx, tx, orgID, viewerID, targetID)
	if err != nil {
		return ReportTarget{}, err
	}
	author, err := dbuuid.Parse(msg.AuthorEmployeeId)
	if err != nil {
		return ReportTarget{}, fmt.Errorf("message has no usable author: %w", err)
	}
	snapshot := strings.TrimSpace(msg.MessageText)
	if snapshot == "" {
		// A voice message or a bare attachment has no text; the reviewer still needs
		// something to look at, so describe it rather than storing an empty string
		// the NOT NULL column would reject.
		snapshot = fmt.Sprintf("(%s message with no text)", msg.MessageKind)
	}
	return ReportTarget{
		AuthorEmployeeID: author,
		Snapshot:         snapshot,
		DeepLink:         fmt.Sprintf("/workspace/chat/%s?message=%s", msg.ChannelId, msg.Id),
	}, nil
}

// --- uploaded files ---

type FileMetadataGetter interface {
	GetFileMetadata(ctx context.Context, tx database.DBTX, params files.GetFileMetadataParams) (*files.GetFileMetadataResult, error)
}

type fileResolver struct{ files FileMetadataGetter }

func NewFileResolver(f FileMetadataGetter) TargetResolver { return &fileResolver{files: f} }

func (r *fileResolver) ResolveReportTarget(
	ctx context.Context,
	tx database.DBTX,
	orgID, viewerID, targetID dbuuid.UUID,
) (ReportTarget, error) {
	result, err := r.files.GetFileMetadata(ctx, tx, files.GetFileMetadataParams{
		OrganizationID: orgID,
		EmployeeID:     viewerID,
		FileID:         targetID,
	})
	if err != nil {
		return ReportTarget{}, err
	}
	if result == nil || result.File == nil {
		return ReportTarget{}, fmt.Errorf("file metadata unavailable")
	}
	// A file's bytes are not the snapshot — a reviewer needs to know what was
	// uploaded and where, and can still open the file while it exists.
	snapshot := fmt.Sprintf("File %q (%s, %d bytes) uploaded to %s",
		result.File.Filename, result.File.MimeType, result.File.SizeBytes, result.File.UploadContext)
	return ReportTarget{
		AuthorEmployeeID: result.File.UploadedBy,
		Snapshot:         snapshot,
		DeepLink:         fmt.Sprintf("/workspace/files/%s", result.File.ID.String()),
	}, nil
}

// --- document comments ---

type DocumentCommentGetter interface {
	GetCommentAuthorAndText(ctx context.Context, tx database.DBTX, orgID, commentID dbuuid.UUID) (dbuuid.UUID, dbuuid.UUID, string, error)
}

type documentCommentResolver struct{ docs DocumentCommentGetter }

func NewDocumentCommentResolver(d DocumentCommentGetter) TargetResolver {
	return &documentCommentResolver{docs: d}
}

func (r *documentCommentResolver) ResolveReportTarget(
	ctx context.Context,
	tx database.DBTX,
	orgID, viewerID, targetID dbuuid.UUID,
) (ReportTarget, error) {
	author, documentID, text, err := r.docs.GetCommentAuthorAndText(ctx, tx, orgID, targetID)
	if err != nil {
		return ReportTarget{}, err
	}
	snapshot := strings.TrimSpace(text)
	if snapshot == "" {
		snapshot = "(empty comment)"
	}
	return ReportTarget{
		AuthorEmployeeID: author,
		Snapshot:         snapshot,
		DeepLink:         fmt.Sprintf("/workspace/docs/%s?comment=%s", documentID.String(), targetID.String()),
	}, nil
}

// --- voice call records ---

type CallRecordGetter interface {
	GetCallRecord(ctx context.Context, tx database.DBTX, orgID, employeeID, callID dbuuid.UUID) (*rpcv1.VoiceCallRecord, error)
}

type callRecordResolver struct{ voice CallRecordGetter }

func NewCallRecordResolver(v CallRecordGetter) TargetResolver { return &callRecordResolver{voice: v} }

func (r *callRecordResolver) ResolveReportTarget(
	ctx context.Context,
	tx database.DBTX,
	orgID, viewerID, targetID dbuuid.UUID,
) (ReportTarget, error) {
	record, err := r.voice.GetCallRecord(ctx, tx, orgID, viewerID, targetID)
	if err != nil {
		return ReportTarget{}, err
	}
	if record == nil || record.Call == nil {
		return ReportTarget{}, fmt.Errorf("call record unavailable")
	}
	initiator, err := dbuuid.Parse(record.Call.InitiatorEmployeeId)
	if err != nil {
		return ReportTarget{}, fmt.Errorf("call record has no usable initiator: %w", err)
	}
	// There is no transcript to quote in the general case, so the snapshot records
	// the facts of the call: who started it, when, and how it ended.
	started := "unknown time"
	if record.Call.StartedAt != nil {
		started = record.Call.StartedAt.AsTime().Format("2006-01-02 15:04 MST")
	}
	snapshot := fmt.Sprintf("Voice call started %s, outcome %s, %d participants",
		started, record.Call.Outcome.String(), len(record.Call.Participants))
	return ReportTarget{
		AuthorEmployeeID: initiator,
		Snapshot:         snapshot,
		DeepLink:         fmt.Sprintf("/workspace/chat/%s?call=%s", record.Call.ChannelId, record.Call.Id),
	}, nil
}

// RegisterResolvers wires one resolver per reportable kind. Every kind in the
// target_kind CHECK must appear here, or ReportContent rejects it as an unknown
// target rather than storing a report nobody can review.
func (l *Logic) RegisterResolvers(chat MessageGetter, f FileMetadataGetter, d DocumentCommentGetter, v CallRecordGetter) {
	l.Resolvers = map[string]TargetResolver{
		TargetKindChatMessage:     NewChatMessageResolver(chat),
		TargetKindDirectMessage:   NewDirectMessageResolver(chat),
		TargetKindFile:            NewFileResolver(f),
		TargetKindDocumentComment: NewDocumentCommentResolver(d),
		TargetKindCallRecord:      NewCallRecordResolver(v),
	}
}

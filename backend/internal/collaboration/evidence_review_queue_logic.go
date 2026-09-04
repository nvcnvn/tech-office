package collaboration

import (
	"context"
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Page sizing and the count cap. The count is bounded inside SQL so a reviewer returning
// from leave with 4 000 pending items costs the same as one with 100; clients render "99+"
// when is_capped is set.
const (
	reviewQueueDefaultPageSize = 25
	reviewQueueMaxPageSize     = 100
	reviewQueueCountCap        = 100
)

// reviewQueueCursor is the queue's full sort tuple. Ordering is by
// (urgency_rank, server_timestamp, submission id) and the cursor carries all three, so the
// page boundary is total: the id leg is a UUID v7 primary key, so no two rows tie and a page
// can neither duplicate nor skip within a snapshot.
type reviewQueueCursor struct {
	urgencyRank     int32
	serverTimestamp time.Time
	submissionID    dbuuid.UUID
}

// encodeReviewQueueCursor renders the tuple opaque on the wire. The encoding is base64 of
// "<rank>|<RFC3339Nano>|<uuid>" — opaque so clients cannot construct one, and so the shape
// can change without a client release.
func encodeReviewQueueCursor(c reviewQueueCursor) string {
	raw := fmt.Sprintf("%d|%s|%s",
		c.urgencyRank,
		c.serverTimestamp.UTC().Format(time.RFC3339Nano),
		c.submissionID.String(),
	)
	return base64.RawURLEncoding.EncodeToString([]byte(raw))
}

// decodeReviewQueueCursor is the inverse. Every malformed input — bad base64, wrong leg
// count, unparseable rank/time/uuid — returns an error rather than silently paging from the
// start, because a cursor the server cannot read means the client's idea of where it is has
// been lost, and quietly restarting the page would show the reviewer rows they already
// cleared.
func decodeReviewQueueCursor(encoded string) (reviewQueueCursor, error) {
	raw, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		return reviewQueueCursor{}, fmt.Errorf("cursor is not valid base64: %w", err)
	}

	parts := strings.Split(string(raw), "|")
	if len(parts) != 3 {
		return reviewQueueCursor{}, fmt.Errorf("cursor has %d parts, want 3", len(parts))
	}

	rank, err := strconv.ParseInt(parts[0], 10, 32)
	if err != nil {
		return reviewQueueCursor{}, fmt.Errorf("cursor urgency rank is not an integer: %w", err)
	}

	ts, err := time.Parse(time.RFC3339Nano, parts[1])
	if err != nil {
		return reviewQueueCursor{}, fmt.Errorf("cursor timestamp is not RFC3339: %w", err)
	}

	id, err := dbuuid.Parse(parts[2])
	if err != nil {
		return reviewQueueCursor{}, fmt.Errorf("cursor submission id is not a UUID: %w", err)
	}

	return reviewQueueCursor{urgencyRank: int32(rank), serverTimestamp: ts, submissionID: id}, nil
}

// ListEvidenceReviewQueue returns the page of pending submissions the caller is entitled to
// decide. Scope lives in the query (non-`viewer` project membership); the caller is
// responsible for having established that the permission is held.
func (l *logicImpl) ListEvidenceReviewQueue(
	ctx context.Context,
	tx database.DBTX,
	orgID, reviewerID dbuuid.UUID,
	req *rpcv1.ListEvidenceReviewQueueRequest,
) ([]*rpcv1.ReviewQueueEntry, string, error) {
	params := &database.ListEvidenceReviewQueueParams{
		OrganizationID:     orgID,
		ReviewerEmployeeID: reviewerID,
	}

	if req.GetProjectId() != "" {
		projectID, err := dbuuid.Parse(req.GetProjectId())
		if err != nil {
			return nil, "", fmt.Errorf("invalid project_id: %w", err)
		}
		params.ProjectID = dbuuid.UUIDToNullUUID(projectID)
	}

	if req.GetCursor() != "" {
		cursor, err := decodeReviewQueueCursor(req.GetCursor())
		if err != nil {
			return nil, "", fmt.Errorf("%w: %w", ErrInvalidReviewQueueCursor, err)
		}
		params.CursorSubmissionID = dbuuid.UUIDToNullUUID(cursor.submissionID)
		params.CursorUrgencyRank = pgtype.Int4{Int32: cursor.urgencyRank, Valid: true}
		params.CursorServerTimestamp = pgtype.Timestamptz{Time: cursor.serverTimestamp, Valid: true}
	}

	pageSize := req.GetPageSize()
	if pageSize <= 0 {
		pageSize = reviewQueueDefaultPageSize
	}
	if pageSize > reviewQueueMaxPageSize {
		pageSize = reviewQueueMaxPageSize
	}
	// One extra row tells us whether a further page exists without a second count query, so
	// next_cursor is emitted only when there is genuinely something after this page.
	params.PageLimit = pageSize + 1

	rows, err := l.Queries.ListEvidenceReviewQueue(ctx, tx, params)
	if err != nil {
		return nil, "", fmt.Errorf("failed to list evidence review queue: %w", err)
	}

	hasMore := int32(len(rows)) > pageSize
	if hasMore {
		rows = rows[:pageSize]
	}

	entries := make([]*rpcv1.ReviewQueueEntry, len(rows))
	for i, row := range rows {
		entries[i] = reviewQueueRowToProto(row)
	}

	var nextCursor string
	if hasMore {
		last := rows[len(rows)-1]
		nextCursor = encodeReviewQueueCursor(reviewQueueCursor{
			urgencyRank:     last.UrgencyRank,
			serverTimestamp: last.ServerTimestamp.Time,
			submissionID:    last.EvidenceSubmissionID,
		})
	}

	return entries, nextCursor, nil
}

// GetEvidenceReviewQueueCount returns the badge count, bounded server-side.
func (l *logicImpl) GetEvidenceReviewQueueCount(
	ctx context.Context,
	tx database.DBTX,
	orgID, reviewerID dbuuid.UUID,
	req *rpcv1.GetEvidenceReviewQueueCountRequest,
) (int32, bool, error) {
	params := &database.CountEvidenceReviewQueueParams{
		OrganizationID:     orgID,
		ReviewerEmployeeID: reviewerID,
		CountCap:           reviewQueueCountCap,
	}

	if req.GetProjectId() != "" {
		projectID, err := dbuuid.Parse(req.GetProjectId())
		if err != nil {
			return 0, false, fmt.Errorf("invalid project_id: %w", err)
		}
		params.ProjectID = dbuuid.UUIDToNullUUID(projectID)
	}

	count, err := l.Queries.CountEvidenceReviewQueue(ctx, tx, params)
	if err != nil {
		return 0, false, fmt.Errorf("failed to count evidence review queue: %w", err)
	}

	return count, count >= reviewQueueCountCap, nil
}

func reviewQueueRowToProto(row *database.ListEvidenceReviewQueueRow) *rpcv1.ReviewQueueEntry {
	entry := &rpcv1.ReviewQueueEntry{
		EvidenceSubmissionId:          row.EvidenceSubmissionID.String(),
		TaskId:                        row.TaskID.String(),
		TaskIdentifier:                row.TaskIdentifier,
		TaskTitle:                     row.TaskTitle,
		ProjectId:                     row.ProjectID.String(),
		ProjectName:                   row.ProjectName,
		RitualName:                    row.RitualName,
		EvidenceRequirementId:         row.EvidenceRequirementID.String(),
		EvidenceRequirementName:       row.EvidenceRequirementName,
		EvidenceRequirementPosition:   row.EvidenceRequirementPosition,
		EvidenceRequirementIsRequired: row.EvidenceRequirementIsRequired,
		RequirementUnresolved:         row.RequirementUnresolved,
		SubmittedByEmployeeId:         row.SubmittedByEmployeeID.String(),
		SubmittedByDisplayName:        row.SubmittedByDisplayName,
		EvidenceType:                  stringToEvidenceTypeProto(row.EvidenceType),
		InstanceStateCategory:         row.InstanceStateCategory,
		Urgency:                       urgencyRankToProto(row.UrgencyRank),
	}

	if row.RitualDefinitionID.Valid {
		entry.RitualDefinitionId = row.RitualDefinitionID.UUID.String()
	}
	// Empty for an entry whose definition could not be resolved. Such an entry stays
	// listed and stays decidable, exactly as before.
	if row.ProcedureDocumentID.Valid {
		entry.ProcedureDocumentId = row.ProcedureDocumentID.UUID.String()
	}
	if row.ServerTimestamp.Valid {
		entry.ServerTimestamp = timestamppb.New(row.ServerTimestamp.Time)
	}
	if row.DeviceTimestamp.Valid {
		entry.DeviceTimestamp = timestamppb.New(row.DeviceTimestamp.Time)
	}
	if row.InstanceCompletionDeadline.Valid {
		entry.InstanceCompletionDeadline = timestamppb.New(row.InstanceCompletionDeadline.Time)
	}
	if row.FileID.Valid {
		entry.FileId = row.FileID.UUID.String()
	}
	if row.TextContent.Valid {
		entry.TextContent = row.TextContent.String
	}
	if row.LinkUrl.Valid {
		entry.LinkUrl = row.LinkUrl.String
	}
	if row.GpsLatitude.Valid && row.GpsLongitude.Valid {
		lat, latOK := numericToFloat64(row.GpsLatitude)
		lon, lonOK := numericToFloat64(row.GpsLongitude)
		if latOK && lonOK {
			acc, _ := numericToFloat64(row.GpsAccuracyMeters)
			entry.GpsCoordinates = &rpcv1.GpsCoordinates{
				Latitude:       lat,
				Longitude:      lon,
				AccuracyMeters: acc,
			}
		}
	}

	return entry
}

// urgencyRankToProto maps the query's sort rank back to the wire enum. The rank is the
// authority — it is what the ORDER BY and the cursor use — so the enum is derived from it
// rather than recomputed from the state category, which would let the two disagree.
func urgencyRankToProto(rank int32) rpcv1.ReviewUrgency {
	if rank == 0 {
		return rpcv1.ReviewUrgency_REVIEW_URGENCY_LATE
	}
	return rpcv1.ReviewUrgency_REVIEW_URGENCY_NORMAL
}

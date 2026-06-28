package docs

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// ============================================================================
// Section Embed Domain Errors
// ============================================================================

var (
	ErrEmbedNotFound = errors.New("section embed not found")
	ErrCircularEmbed = errors.New("circular embed detected")
	ErrSelfEmbed     = errors.New("cannot embed section from same document")
)

// ============================================================================
// Section Embed Methods
// ============================================================================

func (l *documentLogicImpl) CreateEmbed(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	req *rpcv1.CreateEmbedRequest,
) (*rpcv1.SectionEmbed, error) {
	slog.DebugContext(ctx, "DocumentLogic.CreateEmbed",
		"sourceDocID", req.SourceDocumentId,
		"targetDocID", req.TargetDocumentId,
		"targetLines", fmt.Sprintf("L%d-L%d", req.TargetLineStart, req.TargetLineEnd),
	)

	sourceDocID := dbuuid.MustParse(req.SourceDocumentId)
	targetDocID := dbuuid.MustParse(req.TargetDocumentId)

	// Prevent self-embed
	if sourceDocID == targetDocID {
		return nil, ErrSelfEmbed
	}

	// Validate line numbers
	if req.SourceLineStart <= 0 || req.SourceLineEnd < req.SourceLineStart {
		return nil, fmt.Errorf("invalid source line range: %d-%d", req.SourceLineStart, req.SourceLineEnd)
	}
	if req.TargetLineStart <= 0 || req.TargetLineEnd < req.TargetLineStart {
		return nil, fmt.Errorf("invalid target line range: %d-%d", req.TargetLineStart, req.TargetLineEnd)
	}

	// Check for circular embeds
	hasCircular, err := l.detectCircularEmbed(ctx, tx, orgID, sourceDocID, targetDocID)
	if err != nil {
		return nil, fmt.Errorf("failed to check circular embed: %w", err)
	}
	if hasCircular {
		return nil, ErrCircularEmbed
	}

	// Verify both documents exist
	_, err = l.Queries.GetDocumentByID(ctx, tx, &database.GetDocumentByIDParams{
		OrganizationID: orgID,
		ID:             sourceDocID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("source document not found")
		}
		return nil, fmt.Errorf("failed to get source document: %w", err)
	}

	targetDoc, err := l.Queries.GetDocumentByID(ctx, tx, &database.GetDocumentByIDParams{
		OrganizationID: orgID,
		ID:             targetDocID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("target document not found")
		}
		return nil, fmt.Errorf("failed to get target document: %w", err)
	}

	// Auto-populate target version if not explicitly provided (snapshot behavior)
	// Users expect to embed the content they SEE at embed creation time, not future versions
	var targetVersionNumber int32
	if req.TargetVersionNumber != nil {
		// Explicit version provided (e.g., citing an older version)
		targetVersionNumber = *req.TargetVersionNumber
	} else {
		// Default: snapshot current version (what user sees NOW)
		targetVersionNumber = targetDoc.VersionCount
		slog.DebugContext(ctx, "Auto-populated embed with current version",
			"targetDocID", targetDocID,
			"snapshotVersion", targetDoc.VersionCount,
		)
	}

	embed, err := l.Queries.CreateSectionEmbed(ctx, tx, &database.CreateSectionEmbedParams{
		ID:                  dbuuid.Must(),
		OrganizationID:      orgID,
		SourceDocumentID:    sourceDocID,
		SourceLineStart:     req.SourceLineStart,
		SourceLineEnd:       req.SourceLineEnd,
		TargetDocumentID:    targetDocID,
		TargetLineStart:     req.TargetLineStart,
		TargetLineEnd:       req.TargetLineEnd,
		TargetVersionNumber: targetVersionNumber,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to create section embed",
			"error", err,
			"sourceDocID", req.SourceDocumentId,
		)
		return nil, fmt.Errorf("failed to create section embed: %w", err)
	}

	// Check if embed is already stale (rare: someone updated target between our GetDocument and CreateEmbed calls)
	isStale := embed.TargetVersionNumber < targetDoc.VersionCount

	return &rpcv1.SectionEmbed{
		Id:                  embed.ID.String(),
		SourceDocumentId:    embed.SourceDocumentID.String(),
		SourceLineStart:     embed.SourceLineStart,
		SourceLineEnd:       embed.SourceLineEnd,
		TargetDocumentId:    embed.TargetDocumentID.String(),
		TargetDocumentTitle: targetDoc.Title,
		TargetLineStart:     embed.TargetLineStart,
		TargetLineEnd:       embed.TargetLineEnd,
		TargetStatus:        statusToProto(targetDoc.Status),
		TargetVersionNumber: &embed.TargetVersionNumber,
		TargetLatestVersion: &targetDoc.VersionCount,
		IsStale:             isStale,
	}, nil
}

func (l *documentLogicImpl) GetEmbeddedSection(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID, embedID dbuuid.UUID,
) (*rpcv1.SectionEmbed, string, string, bool, error) {
	embed, err := l.Queries.GetSectionEmbed(ctx, tx, &database.GetSectionEmbedParams{
		OrganizationID: orgID,
		ID:             embedID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, "", "", false, ErrEmbedNotFound
		}
		return nil, "", "", false, fmt.Errorf("failed to get section embed: %w", err)
	}

	// Get target document content at the specific version (snapshot)
	// This fetches content from document_version table, not current document
	targetDoc, err := l.Queries.GetEmbeddedContent(ctx, tx, &database.GetEmbeddedContentParams{
		OrganizationID: orgID,
		ID:             embed.TargetDocumentID,
		VersionNumber:  embed.TargetVersionNumber,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Target was deleted
			protoEmbed := &rpcv1.SectionEmbed{
				Id:                  embed.ID.String(),
				SourceDocumentId:    embed.SourceDocumentID.String(),
				SourceLineStart:     embed.SourceLineStart,
				SourceLineEnd:       embed.SourceLineEnd,
				TargetDocumentId:    embed.TargetDocumentID.String(),
				TargetLineStart:     embed.TargetLineStart,
				TargetLineEnd:       embed.TargetLineEnd,
				TargetVersionNumber: &embed.TargetVersionNumber,
			}
			return protoEmbed, "", "", false, nil
		}
		return nil, "", "", false, fmt.Errorf("failed to get target document: %w", err)
	}

	// Check if employee has access to target document
	accessLevel, isOwner, err := l.CheckAccess(ctx, tx, orgID, employeeID, embed.TargetDocumentID)
	if err != nil {
		return nil, "", "", false, fmt.Errorf("failed to check access: %w", err)
	}

	accessible := isOwner || accessLevel != rpcv1.AccessLevel_ACCESS_LEVEL_NONE

	// Check staleness: embed version < current version
	isStale := embed.TargetVersionNumber < embed.TargetLatestVersion

	protoEmbed := &rpcv1.SectionEmbed{
		Id:                  embed.ID.String(),
		SourceDocumentId:    embed.SourceDocumentID.String(),
		SourceLineStart:     embed.SourceLineStart,
		SourceLineEnd:       embed.SourceLineEnd,
		TargetDocumentId:    embed.TargetDocumentID.String(),
		TargetDocumentTitle: embed.TargetDocumentTitle,
		TargetLineStart:     embed.TargetLineStart,
		TargetLineEnd:       embed.TargetLineEnd,
		TargetStatus:        statusToProto(targetDoc.Status),
		TargetVersionNumber: &embed.TargetVersionNumber,
		TargetLatestVersion: &embed.TargetLatestVersion,
		IsStale:             isStale,
	}

	var contentJSON, contentText string
	if accessible {
		contentJSON = string(targetDoc.ContentJson)
		contentText = targetDoc.ContentText
	}

	return protoEmbed, contentText, contentJSON, accessible, nil
}

func (l *documentLogicImpl) ListEmbeds(
	ctx context.Context,
	tx database.DBTX,
	orgID, docID dbuuid.UUID,
) ([]*rpcv1.SectionEmbed, error) {
	embeds, err := l.Queries.ListDocumentEmbeds(ctx, tx, &database.ListDocumentEmbedsParams{
		OrganizationID:   orgID,
		SourceDocumentID: docID,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list document embeds: %w", err)
	}

	result := make([]*rpcv1.SectionEmbed, len(embeds))
	for i, e := range embeds {
		// Check staleness: embedded version < current latest version
		isStale := e.TargetVersionNumber < e.TargetLatestVersion

		result[i] = &rpcv1.SectionEmbed{
			Id:                  e.ID.String(),
			SourceDocumentId:    e.SourceDocumentID.String(),
			SourceLineStart:     e.SourceLineStart,
			SourceLineEnd:       e.SourceLineEnd,
			TargetDocumentId:    e.TargetDocumentID.String(),
			TargetDocumentTitle: e.TargetDocumentTitle,
			TargetLineStart:     e.TargetLineStart,
			TargetLineEnd:       e.TargetLineEnd,
			TargetStatus:        statusToProto(e.TargetStatus),
			TargetVersionNumber: &e.TargetVersionNumber,
			TargetLatestVersion: &e.TargetLatestVersion,
			IsStale:             isStale,
		}
	}

	return result, nil
}

// ListIncomingCitations lists all documents that cite (embed) the given document
// This helps document owners understand who is referencing their content
func (l *documentLogicImpl) ListIncomingCitations(
	ctx context.Context,
	tx database.DBTX,
	orgID, docID dbuuid.UUID,
) (*rpcv1.ListIncomingCitationsResponse, error) {
	slog.DebugContext(ctx, "DocumentLogic.ListIncomingCitations",
		"documentId", docID,
	)

	citations, err := l.Queries.ListIncomingCitations(ctx, tx, &database.ListIncomingCitationsParams{
		OrganizationID:   orgID,
		TargetDocumentID: docID,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to list incoming citations",
			"error", err,
			"documentId", docID,
		)
		return nil, fmt.Errorf("failed to list incoming citations: %w", err)
	}

	// Build citations list and aggregate cited line ranges
	result := make([]*rpcv1.IncomingCitation, len(citations))
	lineRangeMap := make(map[string]*rpcv1.CitedLineRange) // key: "start-end"

	for i, c := range citations {
		// Check staleness: cited version < current version
		isStale := c.TargetVersionNumber < c.TargetCurrentVersion

		// Handle source owner name which may be nil
		sourceOwnerName := ""
		if c.SourceOwnerName != nil {
			sourceOwnerName, _ = c.SourceOwnerName.(string)
		}

		result[i] = &rpcv1.IncomingCitation{
			Id:                  c.ID.String(),
			SourceDocumentId:    c.SourceDocumentID.String(),
			SourceDocumentTitle: c.SourceDocumentTitle,
			SourceDocumentSlug:  c.SourceDocumentSlug,
			SourceOwnerName:     sourceOwnerName,
			SourceLineStart:     c.SourceLineStart,
			SourceLineEnd:       c.SourceLineEnd,
			SourceUpdatedAt:     timestamppbFromTime(c.SourceUpdatedAt.Time),
			TargetLineStart:     c.TargetLineStart,
			TargetLineEnd:       c.TargetLineEnd,
			CitedAtVersion:      c.TargetVersionNumber,
			CurrentVersion:      c.TargetCurrentVersion,
			IsStale:             isStale,
		}

		// Aggregate line ranges for quick display
		rangeKey := fmt.Sprintf("%d-%d", c.TargetLineStart, c.TargetLineEnd)
		if existing, ok := lineRangeMap[rangeKey]; ok {
			existing.CitationCount++
		} else {
			lineRangeMap[rangeKey] = &rpcv1.CitedLineRange{
				StartLine:     c.TargetLineStart,
				EndLine:       c.TargetLineEnd,
				CitationCount: 1,
			}
		}
	}

	// Convert map to slice and sort by start line
	citedLineRanges := make([]*rpcv1.CitedLineRange, 0, len(lineRangeMap))
	for _, r := range lineRangeMap {
		citedLineRanges = append(citedLineRanges, r)
	}
	// Sort by start line (simple bubble sort for small lists)
	for i := 0; i < len(citedLineRanges); i++ {
		for j := i + 1; j < len(citedLineRanges); j++ {
			if citedLineRanges[j].StartLine < citedLineRanges[i].StartLine {
				citedLineRanges[i], citedLineRanges[j] = citedLineRanges[j], citedLineRanges[i]
			}
		}
	}

	return &rpcv1.ListIncomingCitationsResponse{
		Citations:       result,
		TotalCount:      int32(len(result)),
		CitedLineRanges: citedLineRanges,
	}, nil
}

func (l *documentLogicImpl) DeleteEmbed(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID, embedID dbuuid.UUID,
) error {
	// Verify embed exists and get source document
	embed, err := l.Queries.GetSectionEmbed(ctx, tx, &database.GetSectionEmbedParams{
		OrganizationID: orgID,
		ID:             embedID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrEmbedNotFound
		}
		return fmt.Errorf("failed to get embed: %w", err)
	}

	// Check if employee has write access to source document
	accessLevel, isOwner, err := l.CheckAccess(ctx, tx, orgID, employeeID, embed.SourceDocumentID)
	if err != nil {
		return fmt.Errorf("failed to check access: %w", err)
	}

	if !isOwner && accessLevel != rpcv1.AccessLevel_ACCESS_LEVEL_WRITE_UPDATE {
		return ErrAccessDenied
	}

	return l.Queries.DeleteSectionEmbed(ctx, tx, &database.DeleteSectionEmbedParams{
		OrganizationID: orgID,
		ID:             embedID,
	})
}

// ============================================================================
// Circular Embed Detection
// ============================================================================

// detectCircularEmbed checks if creating an embed from sourceDoc to targetDoc
// would create a circular reference chain
func (l *documentLogicImpl) detectCircularEmbed(
	ctx context.Context,
	tx database.DBTX,
	orgID, sourceDocID, targetDocID dbuuid.UUID,
) (bool, error) {
	// Check if targetDoc already embeds anything from sourceDoc (directly or transitively)
	visited := make(map[dbuuid.UUID]bool)
	return l.hasPathToDocument(ctx, tx, orgID, targetDocID, sourceDocID, visited)
}

func (l *documentLogicImpl) hasPathToDocument(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	fromDoc, toDoc dbuuid.UUID,
	visited map[dbuuid.UUID]bool,
) (bool, error) {
	if fromDoc == toDoc {
		return true, nil
	}

	if visited[fromDoc] {
		return false, nil
	}
	visited[fromDoc] = true

	// Get all documents that fromDoc embeds (as source)
	embeds, err := l.Queries.ListDocumentEmbeds(ctx, tx, &database.ListDocumentEmbedsParams{
		OrganizationID:   orgID,
		SourceDocumentID: fromDoc,
	})
	if err != nil {
		return false, err
	}

	for _, embed := range embeds {
		if hasPath, err := l.hasPathToDocument(ctx, tx, orgID, embed.TargetDocumentID, toDoc, visited); err != nil {
			return false, err
		} else if hasPath {
			return true, nil
		}
	}

	return false, nil
}

// ============================================================================
// Helper Functions
// ============================================================================

// timestamppbFromTime converts a time.Time to *timestamppb.Timestamp
func timestamppbFromTime(t time.Time) *timestamppb.Timestamp {
	return timestamppb.New(t)
}

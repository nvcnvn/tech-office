package docs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"strings"
	"time"
	"unicode"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/tech-office/backend/database"
	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/internal/linking"
	"github.com/nvcnvn/tech-office/backend/internal/notification"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type documentPreviewProvider struct{}

func NewPreviewProvider() linking.PreviewProvider {
	return documentPreviewProvider{}
}

func (documentPreviewProvider) Preview(target linking.CanonicalLinkTarget, canonicalURL string) (*linking.LinkPreviewMetadata, bool) {
	if target.ResourceType != linking.ResourceTypeDocumentPage {
		return nil, false
	}
	return &linking.LinkPreviewMetadata{
		Title:        fmt.Sprintf("Document %s", target.ResourceID),
		Subtitle:     "Document",
		ResourceType: target.ResourceType,
		Href:         canonicalURL,
	}, true
}

// Common errors for document operations
var (
	ErrDocumentNotFound         = errors.New("document not found")
	ErrSlugNotFound             = errors.New("slug not found")
	ErrMaxDepthExceeded         = errors.New("maximum document depth exceeded")
	ErrAccessDenied             = errors.New("access denied")
	ErrInvalidParent            = errors.New("invalid parent document")
	ErrEditorLimitReached       = errors.New("maximum editors limit reached")
	ErrVersionNotFound          = errors.New("version not found")
	ErrCannotDeleteWithChildren = errors.New("cannot delete document with children")
)

// extractEmbedIds parses TipTap JSON content and extracts all embedId attributes from embed nodes
func extractEmbedIds(contentJSON string) ([]dbuuid.UUID, error) {
	var doc struct {
		Content []json.RawMessage `json:"content"`
	}

	if err := json.Unmarshal([]byte(contentJSON), &doc); err != nil {
		return nil, fmt.Errorf("failed to parse content JSON: %w", err)
	}

	var embedIDs []dbuuid.UUID
	var extractFromNode func(data json.RawMessage)

	extractFromNode = func(data json.RawMessage) {
		var node struct {
			Type    string                 `json:"type"`
			Attrs   map[string]interface{} `json:"attrs"`
			Content []json.RawMessage      `json:"content"`
		}

		if err := json.Unmarshal(data, &node); err != nil {
			return
		}

		// Extract embedId from embed nodes
		if node.Type == "embed" && node.Attrs != nil {
			if embedIDStr, ok := node.Attrs["embedId"].(string); ok && embedIDStr != "" {
				if embedID, err := dbuuid.Parse(embedIDStr); err == nil {
					embedIDs = append(embedIDs, embedID)
				}
			}
		}

		// Recursively process child nodes
		for _, child := range node.Content {
			extractFromNode(child)
		}
	}

	// Process all top-level nodes
	for _, node := range doc.Content {
		extractFromNode(node)
	}

	return embedIDs, nil
}

// DocumentLogic defines the business logic interface for document operations.
// This layer is pool-agnostic and receives transactions from the Connect layer.
type DocumentLogic interface {
	// Document CRUD
	CreateDocument(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, req *rpcv1.CreateDocumentRequest) (*rpcv1.Document, error)
	GetDocument(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, docID dbuuid.UUID) (*rpcv1.Document, error)
	GetDocumentBySlug(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, slug string) (*rpcv1.Document, error)
	UpdateDocument(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, req *rpcv1.UpdateDocumentRequest) (*rpcv1.Document, int32, error)
	DeleteDocument(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, docID dbuuid.UUID) (int32, error)
	ListDocuments(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, parentID *dbuuid.UUID, status *string, cursor *dbuuid.UUID, limit int32) ([]*rpcv1.DocumentSummary, error)
	GetDocumentTree(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, rootID *dbuuid.UUID, maxDepth int32) ([]*rpcv1.DocumentTreeNode, error)
	SearchDocuments(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, query string, status *string, cursor *dbuuid.UUID, limit int32) ([]*rpcv1.SearchResult, error)
	UpdateDocumentStatus(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, docID dbuuid.UUID, status string) (*rpcv1.Document, error)
	ResolveSlug(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, slug string) (currentSlug string, isRedirect bool, docID dbuuid.UUID, err error)

	// Version History
	CreateVersion(ctx context.Context, tx database.DBTX, orgID, docID, authorID dbuuid.UUID, contentJSON, summary string) (*rpcv1.DocumentVersion, error)
	ListVersions(ctx context.Context, tx database.DBTX, orgID, docID dbuuid.UUID, cursor *int32, limit int32) ([]*rpcv1.DocumentVersion, error)
	GetVersion(ctx context.Context, tx database.DBTX, orgID, docID dbuuid.UUID, versionNumber int32) (*rpcv1.DocumentVersion, error)
	GetVersionDiff(ctx context.Context, tx database.DBTX, orgID, docID dbuuid.UUID, fromVersion, toVersion int32) ([]*rpcv1.DiffChange, *rpcv1.DocumentVersion, *rpcv1.DocumentVersion, error)
	GetBlame(ctx context.Context, tx database.DBTX, orgID, docID dbuuid.UUID) ([]*rpcv1.BlameBlock, error)

	// Access Control
	SetAccess(ctx context.Context, tx database.DBTX, orgID, granterID dbuuid.UUID, req *rpcv1.SetAccessRequest) (*rpcv1.DocumentAccess, error)
	RemoveAccess(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, req *rpcv1.RemoveAccessRequest) error
	ListAccess(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, docID dbuuid.UUID) ([]*rpcv1.DocumentAccess, rpcv1.DocumentVisibility, error)
	CheckAccess(ctx context.Context, tx database.DBTX, orgID, employeeID, docID dbuuid.UUID) (rpcv1.AccessLevel, bool, error)

	// Followers
	FollowDocument(ctx context.Context, tx database.DBTX, orgID, employeeID, docID dbuuid.UUID) error
	UnfollowDocument(ctx context.Context, tx database.DBTX, orgID, employeeID, docID dbuuid.UUID) error
	ListFollowedDocuments(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, cursor *dbuuid.UUID, limit int32) ([]*rpcv1.DocumentSummary, error)
	IsFollowing(ctx context.Context, tx database.DBTX, orgID, employeeID, docID dbuuid.UUID) (bool, error)
	GetDocumentFollowers(ctx context.Context, tx database.DBTX, orgID, docID dbuuid.UUID) ([]dbuuid.UUID, error)

	// Comments
	AddComment(ctx context.Context, tx database.DBTX, orgID, authorID dbuuid.UUID, req *rpcv1.AddCommentRequest) (*rpcv1.Comment, error)
	AddCommentReply(ctx context.Context, tx database.DBTX, orgID, authorID dbuuid.UUID, commentID dbuuid.UUID, replyText string) (*rpcv1.CommentReply, error)
	ResolveComment(ctx context.Context, tx database.DBTX, orgID, resolverID, commentID dbuuid.UUID) (*rpcv1.Comment, error)
	ListComments(ctx context.Context, tx database.DBTX, orgID, docID dbuuid.UUID, includeResolved bool) ([]*rpcv1.Comment, error)
	DeleteComment(ctx context.Context, tx database.DBTX, orgID, employeeID, commentID dbuuid.UUID) error

	// Reactions
	AddReaction(ctx context.Context, tx database.DBTX, orgID, employeeID, docID dbuuid.UUID, reactionType string) (*rpcv1.DocumentReaction, error)
	RemoveReaction(ctx context.Context, tx database.DBTX, orgID, employeeID, docID dbuuid.UUID) error
	GetReactionStats(ctx context.Context, tx database.DBTX, orgID, employeeID, docID dbuuid.UUID) (thumbsUpCount, thumbsDownCount int32, userReaction *rpcv1.ReactionType, err error)

	// Section Embeds
	CreateEmbed(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, req *rpcv1.CreateEmbedRequest) (*rpcv1.SectionEmbed, error)
	GetEmbeddedSection(ctx context.Context, tx database.DBTX, orgID, employeeID, embedID dbuuid.UUID) (*rpcv1.SectionEmbed, string, string, bool, error)
	ListEmbeds(ctx context.Context, tx database.DBTX, orgID, docID dbuuid.UUID) ([]*rpcv1.SectionEmbed, error)
	ListIncomingCitations(ctx context.Context, tx database.DBTX, orgID, docID dbuuid.UUID) (*rpcv1.ListIncomingCitationsResponse, error)
	DeleteEmbed(ctx context.Context, tx database.DBTX, orgID, employeeID, embedID dbuuid.UUID) error

	// Collaborative Editing
	JoinDocument(ctx context.Context, tx database.DBTX, orgID, employeeID, docID dbuuid.UUID, instanceID string) (connID dbuuid.UUID, editors []*rpcv1.ActiveEditor, limitReached bool, err error)
	LeaveDocument(ctx context.Context, tx database.DBTX, orgID, employeeID, docID dbuuid.UUID) error
	UpdateCursor(ctx context.Context, tx database.DBTX, orgID, employeeID, docID dbuuid.UUID, blockID string, offset int32) error
	ListActiveEditors(ctx context.Context, tx database.DBTX, orgID, docID dbuuid.UUID) ([]*rpcv1.ActiveEditor, error)
	Heartbeat(ctx context.Context, tx database.DBTX, orgID, employeeID, docID dbuuid.UUID) error

	// Calendar Overlay Reader — used by the calendar service to render doc deadline overlay items.
	GetDocDeadlinesInRange(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, from, to time.Time) ([]*rpcv1.OverlayItem, error)
}

// NotificationPublisher defines the interface for publishing notifications from docs service.
type NotificationPublisher interface {
	PublishNotification(ctx context.Context, tx database.DBTX, req *rpcv1.PublishNotificationRequest) (*rpcv1.PublishNotificationResponse, error)
}

// documentLogicImpl implements DocumentLogic interface
type documentLogicImpl struct {
	Queries               *database.Queries
	NotificationPublisher NotificationPublisher
}

// NewDocumentLogic creates a new document logic layer implementation
func NewDocumentLogic(queries *database.Queries, notificationPublisher NotificationPublisher) DocumentLogic {
	return &documentLogicImpl{
		Queries:               queries,
		NotificationPublisher: notificationPublisher,
	}
}

// ============================================================================
// Slug Generation Helpers
// ============================================================================

// slugify converts a title to a URL-friendly slug
func slugify(title string) string {
	// Convert to lowercase
	slug := strings.ToLower(title)

	// Replace spaces and special characters with hyphens
	reg := regexp.MustCompile(`[^a-z0-9]+`)
	slug = reg.ReplaceAllString(slug, "-")

	// Remove leading/trailing hyphens
	slug = strings.Trim(slug, "-")

	// Limit length
	if len(slug) > 50 {
		slug = slug[:50]
	}

	return slug
}

// generateSlug creates a unique slug from title with base62 UUID suffix
func generateSlug(title string) string {
	base := slugify(title)
	if base == "" {
		base = "doc"
	}
	// Generate short UUID suffix (first 8 chars of base62-encoded UUID)
	suffix := encodeBase62(dbuuid.Must())[:8]
	return fmt.Sprintf("%s-%s", base, suffix)
}

// encodeBase62 encodes a UUID to base62 string
func encodeBase62(id dbuuid.UUID) string {
	const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
	bytes := id[:]
	var result strings.Builder
	for _, b := range bytes {
		result.WriteByte(alphabet[int(b)%62])
	}
	return result.String()
}

// extractPlainText extracts plain text from TipTap JSON content
func extractPlainText(contentJSON string) string {
	if contentJSON == "" || contentJSON == "{}" {
		return ""
	}

	var doc map[string]interface{}
	if err := json.Unmarshal([]byte(contentJSON), &doc); err != nil {
		return ""
	}

	var builder strings.Builder
	extractTextFromNode(doc, &builder, false)
	return builder.String()
}

// extractFormattedText extracts text with markdown-style formatting markers
func extractFormattedText(contentJSON string) string {
	if contentJSON == "" || contentJSON == "{}" {
		return ""
	}

	var doc map[string]interface{}
	if err := json.Unmarshal([]byte(contentJSON), &doc); err != nil {
		return ""
	}

	var builder strings.Builder
	extractTextFromNode(doc, &builder, true)
	return builder.String()
}

func extractTextFromNode(node map[string]interface{}, builder *strings.Builder, includeMarks bool) {
	// Get node type
	nodeType, _ := node["type"].(string)

	// Handle hardBreak nodes (newlines within paragraphs)
	if nodeType == "hardBreak" {
		builder.WriteString("\n")
		return
	}

	// Check for text content
	if text, ok := node["text"].(string); ok {
		if includeMarks {
			// Extract marks and wrap text with markdown-style markers
			marks := extractMarks(node)
			text = applyMarkdownMarks(text, marks)
		}
		builder.WriteString(text)
	}

	// Recursively process content array
	if content, ok := node["content"].([]interface{}); ok {
		for _, child := range content {
			if childNode, ok := child.(map[string]interface{}); ok {
				extractTextFromNode(childNode, builder, includeMarks)
			}
		}
	}

	// Add newline after paragraph nodes
	if nodeType == "paragraph" {
		builder.WriteString("\n")
	}
}

// extractMarks extracts formatting marks from a text node
func extractMarks(node map[string]interface{}) []string {
	marks := make([]string, 0)
	if marksArr, ok := node["marks"].([]interface{}); ok {
		for _, m := range marksArr {
			if markMap, ok := m.(map[string]interface{}); ok {
				if markType, ok := markMap["type"].(string); ok {
					marks = append(marks, markType)
				}
			}
		}
	}
	return marks
}

// applyMarkdownMarks wraps text with markdown-style markers based on marks
func applyMarkdownMarks(text string, marks []string) string {
	for _, mark := range marks {
		switch mark {
		case "bold":
			text = "**" + text + "**"
		case "italic":
			text = "_" + text + "_"
		case "underline":
			text = "<u>" + text + "</u>"
		case "strike":
			text = "~~" + text + "~~"
		case "code":
			text = "`" + text + "`"
		}
	}
	return text
}

// ============================================================================
// Document CRUD Operations
// ============================================================================

func (l *documentLogicImpl) CreateDocument(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID dbuuid.UUID,
	req *rpcv1.CreateDocumentRequest,
) (*rpcv1.Document, error) {
	slog.DebugContext(ctx, "DocumentLogic.CreateDocument",
		"title", req.Title,
		"parentID", req.ParentDocumentId,
	)

	var parentDoc *database.DocsDocument
	var depth int16 = 0
	path := []dbuuid.UUID{} // Initialize as empty slice, NOT nil (Postgres NULL)

	// If parent specified, validate and compute hierarchy
	if req.ParentDocumentId != "" {
		parentID := dbuuid.MustParse(req.ParentDocumentId)
		parent, err := l.Queries.GetDocumentByID(ctx, tx, &database.GetDocumentByIDParams{
			OrganizationID: orgID,
			ID:             parentID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, ErrInvalidParent
			}
			return nil, fmt.Errorf("failed to get parent document: %w", err)
		}
		parentDoc = parent
		depth = parentDoc.Depth + 1

		if depth > MaxDocumentDepth {
			return nil, ErrMaxDepthExceeded
		}

		// Build path from parent's path + parent ID
		path = append(path, parentDoc.Path...)
		path = append(path, parentDoc.ID)
	}

	// Generate unique slug
	slug := generateSlug(req.Title)

	// Extract plain text for search
	contentText := extractPlainText(req.ContentJson)

	// Determine visibility (only for root documents)
	visibility := VisibilityPrivate
	if parentDoc == nil && req.Visibility == rpcv1.DocumentVisibility_DOCUMENT_VISIBILITY_PUBLIC {
		visibility = VisibilityPublic
	}

	// Create document
	docID := dbuuid.Must()
	now := pgtype.Timestamptz{Time: time.Now(), Valid: true}

	var parentDocID dbuuid.NullUUID
	if parentDoc != nil {
		parentDocID = dbuuid.UUIDToNullUUID(dbuuid.UUID(parentDoc.ID))
	}

	doc, err := l.Queries.CreateDocument(ctx, tx, &database.CreateDocumentParams{
		ID:               docID,
		OrganizationID:   orgID,
		Title:            req.Title,
		Slug:             slug,
		ParentDocumentID: parentDocID,
		Depth:            depth,
		ContentJson:      []byte(req.ContentJson),
		ContentText:      contentText,
		Status:           DocumentStatusActive,
		Visibility:       visibility,
		OwnerEmployeeID:  employeeID,
		Path:             path,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to create document",
			"error", err,
			"title", req.Title,
		)
		return nil, fmt.Errorf("failed to create document: %w", err)
	}

	// Update parent's child count
	if parentDoc != nil {
		err = l.Queries.IncrementChildCount(ctx, tx, &database.IncrementChildCountParams{
			OrganizationID: orgID,
			ID:             parentDoc.ID,
			UpdatedAt:      now,
		})
		if err != nil {
			slog.ErrorContext(ctx, "failed to increment parent child count",
				"error", err,
				"parentID", parentDoc.ID,
			)
		}
	}

	// Create initial version
	_, err = l.CreateVersion(ctx, tx, orgID, docID, employeeID, req.ContentJson, "Initial version")
	if err != nil {
		slog.ErrorContext(ctx, "failed to create initial version",
			"error", err,
			"docID", docID,
		)
	}

	_ = l.ensureDocumentCreatorSubscription(ctx, tx, orgID, employeeID, docID)

	// Register V2 resource_surface so document comments inherit the parent subscription.
	l.registerDocumentResourceSurfaces(ctx, tx, orgID, docID)

	// Get owner name for response
	ownerName := l.getEmployeeName(ctx, tx, orgID, employeeID)

	return l.documentToProto(doc, ownerName), nil
}

// registerDocumentResourceSurfaces creates a resource_surface row linking the
// document to its comment thread so V2 subscription inheritance works.
func (l *documentLogicImpl) registerDocumentResourceSurfaces(
	ctx context.Context,
	tx database.DBTX,
	orgID, docID dbuuid.UUID,
) {
	now := pgtype.Timestamptz{Time: time.Now(), Valid: true}

	if _, err := l.Queries.UpsertResourceSurface(ctx, tx, &database.UpsertResourceSurfaceParams{
		OrganizationID:       orgID,
		ParentDomain:         notification.ResourceDomainDocument,
		ParentResourceID:     docID,
		SurfaceType:          notification.ResourceSurfaceTypeDocumentComments,
		SurfaceDomain:        notification.ResourceSurfaceDomainDocumentCommentThread,
		SurfaceResourceID:    docID, // Document uses its own ID as comment thread surface
		InheritsSubscription: true,
		CreatedAt:            now,
	}); err != nil {
		slog.WarnContext(ctx, "failed to register document_comments surface",
			"error", err, "docID", docID,
		)
	}
}

func (l *documentLogicImpl) GetDocument(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	docID dbuuid.UUID,
) (*rpcv1.Document, error) {
	doc, err := l.Queries.GetDocumentByID(ctx, tx, &database.GetDocumentByIDParams{
		OrganizationID: orgID,
		ID:             docID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrDocumentNotFound
		}
		return nil, fmt.Errorf("failed to get document: %w", err)
	}

	ownerName := l.getEmployeeName(ctx, tx, orgID, dbuuid.UUID(doc.OwnerEmployeeID))
	return l.documentToProto(doc, ownerName), nil
}

func (l *documentLogicImpl) GetDocumentBySlug(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	slug string,
) (*rpcv1.Document, error) {
	doc, err := l.Queries.GetDocumentBySlug(ctx, tx, &database.GetDocumentBySlugParams{
		OrganizationID: orgID,
		Slug:           slug,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrDocumentNotFound
		}
		return nil, fmt.Errorf("failed to get document by slug: %w", err)
	}

	ownerName := l.getEmployeeName(ctx, tx, orgID, dbuuid.UUID(doc.OwnerEmployeeID))
	return l.documentToProto(doc, ownerName), nil
}

func (l *documentLogicImpl) UpdateDocument(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID dbuuid.UUID,
	req *rpcv1.UpdateDocumentRequest,
) (*rpcv1.Document, int32, error) {
	slog.DebugContext(ctx, "DocumentLogic.UpdateDocument",
		"docID", req.Id,
		"title", req.Title,
	)

	docID := dbuuid.MustParse(req.Id)
	now := pgtype.Timestamptz{Time: time.Now(), Valid: true}

	// Get current document
	currentDoc, err := l.Queries.GetDocumentByID(ctx, tx, &database.GetDocumentByIDParams{
		OrganizationID: orgID,
		ID:             docID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, 0, ErrDocumentNotFound
		}
		return nil, 0, fmt.Errorf("failed to get document: %w", err)
	}

	// Check if title changed (need new slug)
	oldSlug := currentDoc.Slug
	newSlug := oldSlug
	if req.Title != currentDoc.Title {
		newSlug = generateSlug(req.Title)

		// Record slug change for redirect
		err = l.Queries.CreateSlugHistory(ctx, tx, &database.CreateSlugHistoryParams{
			ID:             dbuuid.Must(),
			OrganizationID: orgID,
			DocumentID:     docID,
			OldSlug:        oldSlug,
		})
		if err != nil {
			slog.ErrorContext(ctx, "failed to create slug history",
				"error", err,
				"oldSlug", oldSlug,
			)
		}
	}

	// Extract plain text for search
	contentText := extractPlainText(req.ContentJson)

	// Update document
	updatedDoc, err := l.Queries.UpdateDocument(ctx, tx, &database.UpdateDocumentParams{
		OrganizationID: orgID,
		ID:             docID,
		Title:          req.Title,
		Slug:           newSlug,
		ContentJson:    []byte(req.ContentJson),
		ContentText:    contentText,
		UpdatedAt:      now,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to update document",
			"error", err,
			"docID", req.Id,
		)
		return nil, 0, fmt.Errorf("failed to update document: %w", err)
	}

	// Create new version
	version, err := l.CreateVersion(ctx, tx, orgID, docID, employeeID, req.ContentJson, req.VersionSummary)
	if err != nil {
		slog.ErrorContext(ctx, "failed to create version",
			"error", err,
			"docID", req.Id,
		)
		return nil, 0, fmt.Errorf("failed to create version: %w", err)
	}

	// Sync embed table: delete embeds removed from content
	if err := l.syncEmbeds(ctx, tx, orgID, docID, req.ContentJson); err != nil {
		slog.ErrorContext(ctx, "failed to sync embeds",
			"error", err,
			"docID", req.Id,
		)
		return nil, 0, fmt.Errorf("failed to sync embeds: %w", err)
	}

	ownerName := l.getEmployeeName(ctx, tx, orgID, dbuuid.UUID(updatedDoc.OwnerEmployeeID))

	return l.documentToProto(updatedDoc, ownerName), version.VersionNumber, nil
}

func (l *documentLogicImpl) DeleteDocument(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID dbuuid.UUID,
	docID dbuuid.UUID,
) (int32, error) {
	slog.DebugContext(ctx, "DocumentLogic.DeleteDocument",
		"docID", docID,
	)

	now := time.Now()

	// Check if document exists
	doc, err := l.Queries.GetDocumentByID(ctx, tx, &database.GetDocumentByIDParams{
		OrganizationID: orgID,
		ID:             docID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, ErrDocumentNotFound
		}
		return 0, fmt.Errorf("failed to get document: %w", err)
	}

	// Orphan children (make them root documents)
	orphanedCount, err := l.Queries.OrphanChildren(ctx, tx, &database.OrphanChildrenParams{
		OrganizationID: orgID,
		ParentID:       dbuuid.UUIDToNullUUID(docID),
		UpdatedAt:      pgtype.Timestamptz{Time: now, Valid: true},
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to orphan children",
			"error", err,
			"docID", docID,
		)
	}

	// Soft delete the document
	err = l.Queries.SoftDeleteDocument(ctx, tx, &database.SoftDeleteDocumentParams{
		OrganizationID: orgID,
		ID:             docID,
		UpdatedAt:      pgtype.Timestamptz{Time: now, Valid: true},
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to soft delete document",
			"error", err,
			"docID", docID,
		)
		return 0, fmt.Errorf("failed to delete document: %w", err)
	}

	// Decrement parent's child count if applicable
	if doc.ParentDocumentID.Valid {
		err = l.Queries.DecrementChildCount(ctx, tx, &database.DecrementChildCountParams{
			OrganizationID: orgID,
			ID:             dbuuid.UUID(doc.ParentDocumentID.UUID),
			UpdatedAt:      pgtype.Timestamptz{Time: now, Valid: true},
		})
		if err != nil {
			slog.ErrorContext(ctx, "failed to decrement parent child count",
				"error", err,
				"parentID", doc.ParentDocumentID.UUID,
			)
		}
	}

	slog.InfoContext(ctx, "document deleted",
		"docID", docID,
		"orphanedChildren", orphanedCount,
	)

	return int32(orphanedCount), nil
}

func (l *documentLogicImpl) ListDocuments(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	parentID *dbuuid.UUID,
	status *string,
	cursor *dbuuid.UUID,
	limit int32,
) ([]*rpcv1.DocumentSummary, error) {
	var docs []*database.DocsDocument
	var err error

	var cursorParam dbuuid.NullUUID
	if cursor != nil {
		cursorParam = dbuuid.UUIDToNullUUID(*cursor)
	}

	if parentID == nil {
		// List root documents
		docs, err = l.Queries.ListRootDocuments(ctx, tx, &database.ListRootDocumentsParams{
			OrganizationID: orgID,
			Status:         pgtype.Text{String: stringValue(status), Valid: status != nil},
			Cursor:         cursorParam,
			DocLimit:       limit,
		})
	} else {
		// List child documents
		parentParam := dbuuid.UUIDToNullUUID(*parentID)
		docs, err = l.Queries.ListChildDocuments(ctx, tx, &database.ListChildDocumentsParams{
			OrganizationID:   orgID,
			ParentDocumentID: parentParam,
			Status:           pgtype.Text{String: stringValue(status), Valid: status != nil},
			Cursor:           cursorParam,
			DocLimit:         limit,
		})
	}

	if err != nil {
		return nil, fmt.Errorf("failed to list documents: %w", err)
	}

	result := make([]*rpcv1.DocumentSummary, len(docs))
	for i, doc := range docs {
		ownerName := l.getEmployeeName(ctx, tx, orgID, dbuuid.UUID(doc.OwnerEmployeeID))
		result[i] = l.documentToSummaryProto(doc, ownerName)
	}

	return result, nil
}

func (l *documentLogicImpl) GetDocumentTree(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	rootID *dbuuid.UUID,
	maxDepth int32,
) ([]*rpcv1.DocumentTreeNode, error) {
	var docs []*database.DocsDocument
	var err error

	if rootID != nil {
		// Get specific document and its children
		docs, err = l.Queries.GetDocumentWithChildren(ctx, tx, &database.GetDocumentWithChildrenParams{
			OrganizationID: orgID,
			DocumentID:     *rootID,
		})
	} else {
		// Get root documents
		docs, err = l.Queries.ListRootDocuments(ctx, tx, &database.ListRootDocumentsParams{
			OrganizationID: orgID,
			Status:         pgtype.Text{},
			Cursor:         dbuuid.NullUUID{},
			DocLimit:       100, // Default limit for tree view
		})
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get document tree: %w", err)
	}

	// Build tree structure from flat list
	return l.buildTreeFromDocs(ctx, tx, orgID, docs), nil
}

func (l *documentLogicImpl) SearchDocuments(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	query string,
	status *string,
	cursor *dbuuid.UUID,
	limit int32,
) ([]*rpcv1.SearchResult, error) {
	var statusFilter pgtype.Text
	if status != nil {
		statusFilter = pgtype.Text{String: *status, Valid: true}
	}

	var cursorUUID dbuuid.NullUUID
	if cursor != nil {
		cursorUUID = dbuuid.UUIDToNullUUID(*cursor)
	}

	results, err := l.Queries.SearchDocuments(ctx, tx, &database.SearchDocumentsParams{
		OrganizationID: orgID,
		Query:          query,
		Status:         statusFilter,
		Cursor:         cursorUUID,
		SearchLimit:    limit,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to search documents: %w", err)
	}

	searchResults := make([]*rpcv1.SearchResult, len(results))
	for i, r := range results {
		ownerName := l.getEmployeeName(ctx, tx, orgID, dbuuid.UUID(r.OwnerEmployeeID))

		// Handle interface{} types from database
		snippet := ""
		if s, ok := r.Snippet.(string); ok {
			snippet = s
		}
		score := float32(0)
		if sc, ok := r.Score.(float64); ok {
			score = float32(sc)
		}

		searchResults[i] = &rpcv1.SearchResult{
			Document: &rpcv1.DocumentSummary{
				Id:               dbuuid.UUID(r.ID).String(),
				Title:            r.Title,
				Slug:             r.Slug,
				ParentDocumentId: nullUUIDToString(r.ParentDocumentID),
				Depth:            int32(r.Depth),
				Status:           statusToProto(r.Status),
				Visibility:       visibilityToProto(r.Visibility),
				OwnerName:        ownerName,
				ChildCount:       r.ChildCount,
				UpdatedAt:        timestamppb.New(r.UpdatedAt.Time),
			},
			Snippet: snippet,
			Score:   score,
		}
	}

	return searchResults, nil
}

func (l *documentLogicImpl) UpdateDocumentStatus(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID dbuuid.UUID,
	docID dbuuid.UUID,
	status string,
) (*rpcv1.Document, error) {
	if !IsValidDocumentStatus(status) {
		return nil, fmt.Errorf("invalid document status: %s", status)
	}

	now := pgtype.Timestamptz{Time: time.Now(), Valid: true}
	doc, err := l.Queries.UpdateDocumentStatus(ctx, tx, &database.UpdateDocumentStatusParams{
		OrganizationID: orgID,
		ID:             docID,
		Status:         status,
		UpdatedAt:      now,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrDocumentNotFound
		}
		return nil, fmt.Errorf("failed to update document status: %w", err)
	}

	ownerName := l.getEmployeeName(ctx, tx, orgID, dbuuid.UUID(doc.OwnerEmployeeID))
	return l.documentToProto(doc, ownerName), nil
}

func (l *documentLogicImpl) ResolveSlug(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	slug string,
) (currentSlug string, isRedirect bool, docID dbuuid.UUID, err error) {
	// First, try to find document with current slug
	doc, err := l.Queries.GetDocumentBySlug(ctx, tx, &database.GetDocumentBySlugParams{
		OrganizationID: orgID,
		Slug:           slug,
	})
	if err == nil {
		return doc.Slug, false, dbuuid.UUID(doc.ID), nil
	}

	if !errors.Is(err, pgx.ErrNoRows) {
		return "", false, dbuuid.UUID{}, fmt.Errorf("failed to get document by slug: %w", err)
	}

	// Check slug history for redirect
	resolvedDocID, err := l.Queries.ResolveOldSlug(ctx, tx, &database.ResolveOldSlugParams{
		OrganizationID: orgID,
		OldSlug:        slug,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", false, dbuuid.UUID{}, ErrSlugNotFound
		}
		return "", false, dbuuid.UUID{}, fmt.Errorf("failed to resolve old slug: %w", err)
	}

	// Get current document to find current slug
	currentDoc, err := l.Queries.GetDocumentByID(ctx, tx, &database.GetDocumentByIDParams{
		OrganizationID: orgID,
		ID:             resolvedDocID,
	})
	if err != nil {
		return "", false, dbuuid.UUID{}, fmt.Errorf("failed to get current document: %w", err)
	}

	return currentDoc.Slug, true, dbuuid.UUID(currentDoc.ID), nil
}

// ============================================================================
// Helper Functions
// ============================================================================

func (l *documentLogicImpl) getEmployeeName(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID) string {
	// Simple implementation - in real code, might want to cache this
	return "Employee" // Placeholder - would query organization.employee table
}

// syncEmbeds ensures section_embed table matches embed nodes in document content
// Deletes embed records that are no longer present in the content JSON
func (l *documentLogicImpl) syncEmbeds(
	ctx context.Context,
	tx database.DBTX,
	orgID, docID dbuuid.UUID,
	contentJSON string,
) error {
	// Extract embed IDs from new content
	currentEmbedIDs, err := extractEmbedIds(contentJSON)
	if err != nil {
		return fmt.Errorf("failed to extract embed IDs: %w", err)
	}

	// Get existing embeds for this document
	existingEmbeds, err := l.Queries.ListEmbedsBySource(ctx, tx, &database.ListEmbedsBySourceParams{
		OrganizationID:   orgID,
		SourceDocumentID: docID,
	})
	if err != nil {
		return fmt.Errorf("failed to list existing embeds: %w", err)
	}

	// Build set of current embed IDs for O(1) lookup
	currentSet := make(map[dbuuid.UUID]bool, len(currentEmbedIDs))
	for _, id := range currentEmbedIDs {
		currentSet[id] = true
	}

	// Delete embeds that are no longer in content
	var deletedCount int
	for _, existing := range existingEmbeds {
		if !currentSet[dbuuid.UUID(existing.ID)] {
			err := l.Queries.DeleteSectionEmbed(ctx, tx, &database.DeleteSectionEmbedParams{
				OrganizationID: orgID,
				ID:             dbuuid.UUID(existing.ID),
			})
			if err != nil {
				slog.WarnContext(ctx, "failed to delete orphaned embed",
					"embedID", existing.ID,
					"error", err,
				)
			} else {
				deletedCount++
			}
		}
	}

	if deletedCount > 0 {
		slog.InfoContext(ctx, "cleaned up orphaned embeds",
			"docID", docID,
			"deletedCount", deletedCount,
		)
	}

	return nil
}

func (l *documentLogicImpl) documentToProto(doc *database.DocsDocument, ownerName string) *rpcv1.Document {
	pathStrings := make([]string, len(doc.Path))
	for i, p := range doc.Path {
		pathStrings[i] = p.String()
	}

	return &rpcv1.Document{
		Id:               doc.ID.String(),
		Title:            doc.Title,
		Slug:             doc.Slug,
		ParentDocumentId: nullUUIDToString(doc.ParentDocumentID),
		Depth:            int32(doc.Depth),
		ContentJson:      string(doc.ContentJson),
		Status:           statusToProto(doc.Status),
		Visibility:       visibilityToProto(doc.Visibility),
		OwnerEmployeeId:  doc.OwnerEmployeeID.String(),
		OwnerName:        ownerName,
		ChildCount:       doc.ChildCount,
		VersionCount:     doc.VersionCount,
		FollowerCount:    doc.FollowerCount,
		UpdatedAt:        timestamppb.New(doc.UpdatedAt.Time),
		Path:             pathStrings,
	}
}

func (l *documentLogicImpl) documentToSummaryProto(doc *database.DocsDocument, ownerName string) *rpcv1.DocumentSummary {
	return &rpcv1.DocumentSummary{
		Id:               doc.ID.String(),
		Title:            doc.Title,
		Slug:             doc.Slug,
		ParentDocumentId: nullUUIDToString(doc.ParentDocumentID),
		Depth:            int32(doc.Depth),
		Status:           statusToProto(doc.Status),
		Visibility:       visibilityToProto(doc.Visibility),
		OwnerName:        ownerName,
		ChildCount:       doc.ChildCount,
		UpdatedAt:        timestamppb.New(doc.UpdatedAt.Time),
	}
}

func (l *documentLogicImpl) buildTreeFromDocs(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, docs []*database.DocsDocument) []*rpcv1.DocumentTreeNode {
	// Build a map of ID to node
	nodeMap := make(map[dbuuid.UUID]*rpcv1.DocumentTreeNode)
	var roots []*rpcv1.DocumentTreeNode

	for _, doc := range docs {
		ownerName := l.getEmployeeName(ctx, tx, orgID, doc.OwnerEmployeeID)
		node := &rpcv1.DocumentTreeNode{
			Document: &rpcv1.DocumentSummary{
				Id:               doc.ID.String(),
				Title:            doc.Title,
				Slug:             doc.Slug,
				ParentDocumentId: nullUUIDToString(doc.ParentDocumentID),
				Depth:            int32(doc.Depth),
				Status:           statusToProto(doc.Status),
				Visibility:       visibilityToProto(doc.Visibility),
				OwnerName:        ownerName,
				ChildCount:       doc.ChildCount,
				UpdatedAt:        timestamppb.New(doc.UpdatedAt.Time),
			},
			Children: []*rpcv1.DocumentTreeNode{},
		}
		nodeMap[doc.ID] = node
	}

	// Build tree structure
	for _, doc := range docs {
		node := nodeMap[doc.ID]
		if doc.ParentDocumentID.Valid {
			parentID := dbuuid.UUID(doc.ParentDocumentID.UUID)
			if parent, ok := nodeMap[parentID]; ok {
				parent.Children = append(parent.Children, node)
			}
		} else {
			roots = append(roots, node)
		}
	}

	return roots
}

func statusToProto(status string) rpcv1.DocumentStatus {
	switch status {
	case DocumentStatusActive:
		return rpcv1.DocumentStatus_DOCUMENT_STATUS_ACTIVE
	case DocumentStatusOutdated:
		return rpcv1.DocumentStatus_DOCUMENT_STATUS_OUTDATED
	case DocumentStatusArchived:
		return rpcv1.DocumentStatus_DOCUMENT_STATUS_ARCHIVED
	default:
		return rpcv1.DocumentStatus_DOCUMENT_STATUS_UNSPECIFIED
	}
}

func visibilityToProto(visibility string) rpcv1.DocumentVisibility {
	switch visibility {
	case VisibilityPublic:
		return rpcv1.DocumentVisibility_DOCUMENT_VISIBILITY_PUBLIC
	case VisibilityPrivate:
		return rpcv1.DocumentVisibility_DOCUMENT_VISIBILITY_PRIVATE
	default:
		return rpcv1.DocumentVisibility_DOCUMENT_VISIBILITY_UNSPECIFIED
	}
}

func protoToStatus(status rpcv1.DocumentStatus) string {
	switch status {
	case rpcv1.DocumentStatus_DOCUMENT_STATUS_ACTIVE:
		return DocumentStatusActive
	case rpcv1.DocumentStatus_DOCUMENT_STATUS_OUTDATED:
		return DocumentStatusOutdated
	case rpcv1.DocumentStatus_DOCUMENT_STATUS_ARCHIVED:
		return DocumentStatusArchived
	default:
		return DocumentStatusActive
	}
}

func nullUUIDToString(u dbuuid.NullUUID) string {
	if u.Valid {
		return dbuuid.UUID(u.UUID).String()
	}
	return ""
}

func stringValue(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func uuidValue(u *dbuuid.UUID) dbuuid.UUID {
	if u == nil {
		return dbuuid.UUID{}
	}
	return *u
}

// isLetter checks if a rune is a letter (for slug generation)
func isLetter(r rune) bool {
	return unicode.IsLetter(r)
}

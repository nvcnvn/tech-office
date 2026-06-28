package docs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/internal/notification"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// ============================================================================
// Version History Methods
// ============================================================================

func (l *documentLogicImpl) CreateVersion(
	ctx context.Context,
	tx database.DBTX,
	orgID, docID, authorID dbuuid.UUID,
	contentJSON, summary string,
) (*rpcv1.DocumentVersion, error) {
	slog.DebugContext(ctx, "DocumentLogic.CreateVersion",
		"docID", docID,
		"authorID", authorID,
	)

	// Get latest version number
	latestVersion, err := l.Queries.GetLatestVersionNumber(ctx, tx, &database.GetLatestVersionNumberParams{
		OrganizationID: orgID,
		DocumentID:     docID,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get latest version number: %w", err)
	}

	// Handle interface{} return from GetLatestVersionNumber
	var latestVersionNum int32
	if latestVersion != nil {
		switch v := latestVersion.(type) {
		case int64:
			latestVersionNum = int32(v)
		case int32:
			latestVersionNum = v
		case int:
			latestVersionNum = int32(v)
		}
	}

	newVersionNumber := latestVersionNum + 1
	contentText := extractPlainText(contentJSON)

	version, err := l.Queries.CreateVersion(ctx, tx, &database.CreateVersionParams{
		ID:               dbuuid.Must(),
		OrganizationID:   orgID,
		DocumentID:       docID,
		VersionNumber:    newVersionNumber,
		ContentJson:      []byte(contentJSON),
		ContentText:      contentText,
		AuthorEmployeeID: authorID,
		Summary:          pgtype.Text{String: summary, Valid: summary != ""},
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to create version",
			"error", err,
			"docID", docID,
		)
		return nil, fmt.Errorf("failed to create version: %w", err)
	}

	// Notify followers of the version save
	notifMessage := summary
	if notifMessage == "" {
		notifMessage = "A new version has been saved"
	}
	l.notifyDocFollowers(ctx, tx, orgID, docID, authorID,
		notification.NotificationTypeDocUpdated, 2, false,
		"Document updated", notifMessage)

	// V2: If this document is a task description surface, also notify
	// parent-task subscribers with task_description_modified.
	l.bridgeTaskDescriptionModified(ctx, tx, orgID, docID, authorID, notifMessage)

	return l.versionToProto(version, "Author"), nil
}

func (l *documentLogicImpl) ListVersions(
	ctx context.Context,
	tx database.DBTX,
	orgID, docID dbuuid.UUID,
	cursor *int32,
	limit int32,
) ([]*rpcv1.DocumentVersion, error) {
	var cursorVal int32 = 0
	if cursor != nil {
		cursorVal = *cursor
	}

	versions, err := l.Queries.ListVersions(ctx, tx, &database.ListVersionsParams{
		OrganizationID: orgID,
		DocumentID:     docID,
		Cursor:         pgtype.Int4{Int32: cursorVal, Valid: cursor != nil},
		VersionLimit:   limit,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list versions: %w", err)
	}

	result := make([]*rpcv1.DocumentVersion, len(versions))
	for i, v := range versions {
		result[i] = &rpcv1.DocumentVersion{
			Id:               v.ID.String(),
			DocumentId:       v.DocumentID.String(),
			VersionNumber:    v.VersionNumber,
			ContentJson:      string(v.ContentJson),
			AuthorEmployeeId: v.AuthorEmployeeID.String(),
			AuthorName:       interfaceToString(v.AuthorName),
			Summary:          v.Summary.String,
			CreatedAt:        timestamppb.New(v.CreatedAt.Time),
		}
	}

	return result, nil
}

func (l *documentLogicImpl) GetVersion(
	ctx context.Context,
	tx database.DBTX,
	orgID, docID dbuuid.UUID,
	versionNumber int32,
) (*rpcv1.DocumentVersion, error) {
	version, err := l.Queries.GetVersion(ctx, tx, &database.GetVersionParams{
		OrganizationID: orgID,
		DocumentID:     docID,
		VersionNumber:  versionNumber,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrVersionNotFound
		}
		return nil, fmt.Errorf("failed to get version: %w", err)
	}

	return &rpcv1.DocumentVersion{
		Id:               version.ID.String(),
		DocumentId:       version.DocumentID.String(),
		VersionNumber:    version.VersionNumber,
		ContentJson:      string(version.ContentJson),
		AuthorEmployeeId: version.AuthorEmployeeID.String(),
		AuthorName:       interfaceToString(version.AuthorName),
		Summary:          version.Summary.String,
		CreatedAt:        timestamppb.New(version.CreatedAt.Time),
	}, nil
}

func (l *documentLogicImpl) GetVersionDiff(
	ctx context.Context,
	tx database.DBTX,
	orgID, docID dbuuid.UUID,
	fromVersion, toVersion int32,
) ([]*rpcv1.DiffChange, *rpcv1.DocumentVersion, *rpcv1.DocumentVersion, error) {
	versions, err := l.Queries.GetVersionRange(ctx, tx, &database.GetVersionRangeParams{
		OrganizationID: orgID,
		DocumentID:     docID,
		FromVersion:    fromVersion,
		ToVersion:      toVersion,
	})
	if err != nil {
		return nil, nil, nil, fmt.Errorf("failed to get version range: %w", err)
	}

	if len(versions) < 2 {
		return nil, nil, nil, ErrVersionNotFound
	}

	// Find from and to versions
	var fromVer, toVer *database.GetVersionRangeRow
	for i := range versions {
		if versions[i].VersionNumber == fromVersion {
			fromVer = versions[i]
		}
		if versions[i].VersionNumber == toVersion {
			toVer = versions[i]
		}
	}

	if fromVer == nil || toVer == nil {
		return nil, nil, nil, ErrVersionNotFound
	}

	// Compute diff
	changes := computeDiff(string(fromVer.ContentJson), string(toVer.ContentJson))

	fromProto := &rpcv1.DocumentVersion{
		Id:               fromVer.ID.String(),
		DocumentId:       fromVer.DocumentID.String(),
		VersionNumber:    fromVer.VersionNumber,
		ContentJson:      string(fromVer.ContentJson),
		AuthorEmployeeId: fromVer.AuthorEmployeeID.String(),
		AuthorName:       interfaceToString(fromVer.AuthorName),
		Summary:          fromVer.Summary.String,
		CreatedAt:        timestamppb.New(fromVer.CreatedAt.Time),
	}

	toProto := &rpcv1.DocumentVersion{
		Id:               toVer.ID.String(),
		DocumentId:       toVer.DocumentID.String(),
		VersionNumber:    toVer.VersionNumber,
		ContentJson:      string(toVer.ContentJson),
		AuthorEmployeeId: toVer.AuthorEmployeeID.String(),
		AuthorName:       interfaceToString(toVer.AuthorName),
		Summary:          toVer.Summary.String,
		CreatedAt:        timestamppb.New(toVer.CreatedAt.Time),
	}

	return changes, fromProto, toProto, nil
}

func (l *documentLogicImpl) GetBlame(
	ctx context.Context,
	tx database.DBTX,
	orgID, docID dbuuid.UUID,
) ([]*rpcv1.BlameBlock, error) {
	// Get all versions to compute blame
	versions, err := l.Queries.ListVersions(ctx, tx, &database.ListVersionsParams{
		OrganizationID: orgID,
		DocumentID:     docID,
		VersionLimit:   100, // Reasonable limit
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list versions for blame: %w", err)
	}

	if len(versions) == 0 {
		return []*rpcv1.BlameBlock{}, nil
	}

	// Simple blame implementation: extract blocks from latest version
	// and attribute based on when content was added
	latestVersion := versions[0]

	var doc map[string]interface{}
	if err := json.Unmarshal(latestVersion.ContentJson, &doc); err != nil {
		return nil, fmt.Errorf("failed to parse document JSON: %w", err)
	}

	blocks := extractBlocks(doc)
	blameBlocks := make([]*rpcv1.BlameBlock, 0, len(blocks))

	for _, block := range blocks {
		// Simple attribution: assign to latest version author
		// Full implementation would walk version history
		blameBlocks = append(blameBlocks, &rpcv1.BlameBlock{
			BlockId:          block.ID,
			AuthorEmployeeId: latestVersion.AuthorEmployeeID.String(),
			AuthorName:       interfaceToString(latestVersion.AuthorName),
			VersionNumber:    latestVersion.VersionNumber,
			AuthoredAt:       timestamppb.New(latestVersion.CreatedAt.Time),
		})
	}

	return blameBlocks, nil
}

func (l *documentLogicImpl) versionToProto(v *database.DocsDocumentVersion, authorName string) *rpcv1.DocumentVersion {
	return &rpcv1.DocumentVersion{
		Id:               v.ID.String(),
		DocumentId:       v.DocumentID.String(),
		VersionNumber:    v.VersionNumber,
		ContentJson:      string(v.ContentJson),
		AuthorEmployeeId: v.AuthorEmployeeID.String(),
		AuthorName:       authorName,
		Summary:          v.Summary.String,
		CreatedAt:        timestamppb.New(v.CreatedAt.Time),
	}
}

// ============================================================================
// Diff Computation Helpers
// ============================================================================

// Block represents a TipTap document block
type Block struct {
	ID      string
	Type    string
	Content string
}

// computeDiff computes line-by-line diff between two content versions using LCS algorithm
// It detects both text changes and formatting-only changes
func computeDiff(fromJSON, toJSON string) []*rpcv1.DiffChange {
	// Extract plain text for text-level comparison
	fromText := extractPlainText(fromJSON)
	toText := extractPlainText(toJSON)

	// Extract formatted text for format-level comparison
	fromFormatted := extractFormattedText(fromJSON)
	toFormatted := extractFormattedText(toJSON)

	fromPlainLines := splitLines(fromText)
	toPlainLines := splitLines(toText)

	fromFormattedLines := splitLines(fromFormatted)
	toFormattedLines := splitLines(toFormatted)

	// Use enhanced diff algorithm that detects formatting changes
	return myersDiffWithFormatting(fromPlainLines, toPlainLines, fromFormattedLines, toFormattedLines)
}

// myersDiffWithFormatting implements a diff algorithm that detects formatting changes
func myersDiffWithFormatting(fromPlain, toPlain, fromFormatted, toFormatted []string) []*rpcv1.DiffChange {
	// Build LCS table based on plain text (ignore formatting for matching)
	m, n := len(fromPlain), len(toPlain)
	lcs := make([][]int, m+1)
	for i := range lcs {
		lcs[i] = make([]int, n+1)
	}

	// Fill LCS table
	for i := 1; i <= m; i++ {
		for j := 1; j <= n; j++ {
			if fromPlain[i-1] == toPlain[j-1] {
				lcs[i][j] = lcs[i-1][j-1] + 1
			} else {
				lcs[i][j] = max(lcs[i-1][j], lcs[i][j-1])
			}
		}
	}

	// Backtrack to generate diff
	changes := make([]*rpcv1.DiffChange, 0)
	i, j := m, n

	for i > 0 || j > 0 {
		if i > 0 && j > 0 && fromPlain[i-1] == toPlain[j-1] {
			// Plain text matches - check if formatting changed
			fromFmt := ""
			toFmt := ""
			if i-1 < len(fromFormatted) {
				fromFmt = fromFormatted[i-1]
			}
			if j-1 < len(toFormatted) {
				toFmt = toFormatted[j-1]
			}

			if fromFmt != toFmt {
				// Formatting changed but text is same
				changes = append([]*rpcv1.DiffChange{{
					ChangeType: "modified",
					Content:    fromPlain[i-1],
					OldContent: fromFmt,
					NewContent: toFmt,
				}}, changes...)
			} else {
				// Line is completely unchanged
				changes = append([]*rpcv1.DiffChange{{
					ChangeType: "unchanged",
					Content:    fromPlain[i-1],
				}}, changes...)
			}
			i--
			j--
		} else if j > 0 && (i == 0 || lcs[i][j-1] >= lcs[i-1][j]) {
			// Line was added in toLines - prepend to results
			toFmt := ""
			if j-1 < len(toFormatted) {
				toFmt = toFormatted[j-1]
			}
			changes = append([]*rpcv1.DiffChange{{
				ChangeType: "add",
				Content:    toPlain[j-1],
				NewContent: toFmt,
			}}, changes...)
			j--
		} else if i > 0 {
			// Line was removed from fromLines - prepend to results
			fromFmt := ""
			if i-1 < len(fromFormatted) {
				fromFmt = fromFormatted[i-1]
			}
			changes = append([]*rpcv1.DiffChange{{
				ChangeType: "remove",
				Content:    fromPlain[i-1],
				OldContent: fromFmt,
			}}, changes...)
			i--
		}
	}

	return changes
}

// myersDiff implements a simplified Myers diff algorithm (kept for backward compatibility)
func myersDiff(fromLines, toLines []string) []*rpcv1.DiffChange {
	// Build LCS (Longest Common Subsequence) table
	m, n := len(fromLines), len(toLines)
	lcs := make([][]int, m+1)
	for i := range lcs {
		lcs[i] = make([]int, n+1)
	}

	// Fill LCS table
	for i := 1; i <= m; i++ {
		for j := 1; j <= n; j++ {
			if fromLines[i-1] == toLines[j-1] {
				lcs[i][j] = lcs[i-1][j-1] + 1
			} else {
				lcs[i][j] = max(lcs[i-1][j], lcs[i][j-1])
			}
		}
	}

	// Backtrack to generate diff
	changes := make([]*rpcv1.DiffChange, 0)
	i, j := m, n

	for i > 0 || j > 0 {
		if i > 0 && j > 0 && fromLines[i-1] == toLines[j-1] {
			// Line is unchanged - prepend to results
			changes = append([]*rpcv1.DiffChange{{
				ChangeType: "unchanged",
				Content:    fromLines[i-1],
			}}, changes...)
			i--
			j--
		} else if j > 0 && (i == 0 || lcs[i][j-1] >= lcs[i-1][j]) {
			// Line was added in toLines - prepend to results
			changes = append([]*rpcv1.DiffChange{{
				ChangeType: "add",
				Content:    toLines[j-1],
			}}, changes...)
			j--
		} else if i > 0 {
			// Line was removed from fromLines - prepend to results
			changes = append([]*rpcv1.DiffChange{{
				ChangeType: "remove",
				Content:    fromLines[i-1],
			}}, changes...)
			i--
		}
	}

	return changes
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func splitLines(text string) []string {
	if text == "" {
		return []string{}
	}
	lines := make([]string, 0)
	start := 0
	for i, c := range text {
		if c == '\n' {
			lines = append(lines, text[start:i])
			start = i + 1
		}
	}
	if start < len(text) {
		lines = append(lines, text[start:])
	}
	return lines
}

func extractBlocks(doc map[string]interface{}) []Block {
	blocks := make([]Block, 0)

	content, ok := doc["content"].([]interface{})
	if !ok {
		return blocks
	}

	for _, item := range content {
		node, ok := item.(map[string]interface{})
		if !ok {
			continue
		}

		blockType, _ := node["type"].(string)

		// Get block ID (from UniqueId extension)
		attrs, _ := node["attrs"].(map[string]interface{})
		blockID, _ := attrs["id"].(string)
		if blockID == "" {
			blockID = dbuuid.Must().String()
		}

		// Extract text content
		var textContent string
		if nodeContent, ok := node["content"].([]interface{}); ok {
			for _, child := range nodeContent {
				if textNode, ok := child.(map[string]interface{}); ok {
					if text, ok := textNode["text"].(string); ok {
						textContent += text
					}
				}
			}
		}

		blocks = append(blocks, Block{
			ID:      blockID,
			Type:    blockType,
			Content: textContent,
		})
	}

	return blocks
}

// ============================================================================
// Access Control Methods
// ============================================================================

func (l *documentLogicImpl) SetAccess(
	ctx context.Context,
	tx database.DBTX,
	orgID, granterID dbuuid.UUID,
	req *rpcv1.SetAccessRequest,
) (*rpcv1.DocumentAccess, error) {
	slog.DebugContext(ctx, "DocumentLogic.SetAccess",
		"docID", req.DocumentId,
		"granteeType", req.GranteeType,
		"granteeID", req.GranteeId,
	)

	docID := dbuuid.MustParse(req.DocumentId)
	granteeID := dbuuid.MustParse(req.GranteeId)
	now := pgtype.Timestamptz{Time: time.Now(), Valid: true}

	granteeType := protoToGranteeType(req.GranteeType)
	accessLevel := protoToAccessLevel(req.AccessLevel)

	if !IsValidGranteeType(granteeType) {
		return nil, fmt.Errorf("invalid grantee type: %s", granteeType)
	}
	if !IsValidAccessLevel(accessLevel) {
		return nil, fmt.Errorf("invalid access level: %s", accessLevel)
	}

	access, err := l.Queries.SetDocumentAccess(ctx, tx, &database.SetDocumentAccessParams{
		ID:                  dbuuid.Must(),
		OrganizationID:      orgID,
		DocumentID:          docID,
		GranteeType:         granteeType,
		GranteeID:           granteeID,
		AccessLevel:         accessLevel,
		GrantedByEmployeeID: granterID,
		UpdatedAt:           now,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to set document access",
			"error", err,
			"docID", req.DocumentId,
		)
		return nil, fmt.Errorf("failed to set document access: %w", err)
	}

	return &rpcv1.DocumentAccess{
		Id:          access.ID.String(),
		DocumentId:  access.DocumentID.String(),
		GranteeType: req.GranteeType,
		GranteeId:   access.GranteeID.String(),
		AccessLevel: req.AccessLevel,
		UpdatedAt:   timestamppb.New(access.UpdatedAt.Time),
	}, nil
}

func (l *documentLogicImpl) RemoveAccess(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID dbuuid.UUID,
	req *rpcv1.RemoveAccessRequest,
) error {
	docID := dbuuid.MustParse(req.DocumentId)
	granteeID := dbuuid.MustParse(req.GranteeId)
	granteeType := protoToGranteeType(req.GranteeType)

	return l.Queries.RemoveDocumentAccess(ctx, tx, &database.RemoveDocumentAccessParams{
		OrganizationID: orgID,
		DocumentID:     docID,
		GranteeType:    granteeType,
		GranteeID:      granteeID,
	})
}

func (l *documentLogicImpl) ListAccess(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	docID dbuuid.UUID,
) ([]*rpcv1.DocumentAccess, rpcv1.DocumentVisibility, error) {
	accessList, err := l.Queries.ListDocumentAccess(ctx, tx, &database.ListDocumentAccessParams{
		OrganizationID: orgID,
		DocumentID:     docID,
	})
	if err != nil {
		return nil, rpcv1.DocumentVisibility_DOCUMENT_VISIBILITY_UNSPECIFIED, fmt.Errorf("failed to list document access: %w", err)
	}

	// Get document visibility
	doc, err := l.Queries.GetDocumentByID(ctx, tx, &database.GetDocumentByIDParams{
		OrganizationID: orgID,
		ID:             docID,
	})
	if err != nil {
		return nil, rpcv1.DocumentVisibility_DOCUMENT_VISIBILITY_UNSPECIFIED, fmt.Errorf("failed to get document: %w", err)
	}

	result := make([]*rpcv1.DocumentAccess, len(accessList))
	for i, a := range accessList {
		result[i] = &rpcv1.DocumentAccess{
			Id:            a.ID.String(),
			DocumentId:    a.DocumentID.String(),
			GranteeType:   granteeTypeToProto(a.GranteeType),
			GranteeId:     a.GranteeID.String(),
			GranteeName:   interfaceToString(a.GranteeName),
			AccessLevel:   accessLevelToProto(a.AccessLevel),
			GrantedByName: interfaceToString(a.GrantedByName),
			UpdatedAt:     timestamppb.New(a.UpdatedAt.Time),
		}
	}

	return result, visibilityToProto(doc.Visibility), nil
}

func (l *documentLogicImpl) CheckAccess(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID, docID dbuuid.UUID,
) (rpcv1.AccessLevel, bool, error) {
	// Get document
	doc, err := l.Queries.GetDocumentByID(ctx, tx, &database.GetDocumentByIDParams{
		OrganizationID: orgID,
		ID:             docID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return rpcv1.AccessLevel_ACCESS_LEVEL_NONE, false, ErrDocumentNotFound
		}
		return rpcv1.AccessLevel_ACCESS_LEVEL_NONE, false, fmt.Errorf("failed to get document: %w", err)
	}

	// Check if user is owner
	isOwner := doc.OwnerEmployeeID == employeeID
	if isOwner {
		return rpcv1.AccessLevel_ACCESS_LEVEL_WRITE_UPDATE, true, nil
	}

	// Check direct employee access
	access, err := l.Queries.GetEmployeeDocumentAccess(ctx, tx, &database.GetEmployeeDocumentAccessParams{
		OrganizationID: orgID,
		DocumentID:     docID,
		EmployeeID:     employeeID,
	})
	if err == nil {
		return accessLevelToProto(access), false, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return rpcv1.AccessLevel_ACCESS_LEVEL_NONE, false, fmt.Errorf("failed to check employee access: %w", err)
	}

	// Check department-based access
	deptAccess, err := l.Queries.GetDepartmentDocumentAccess(ctx, tx, &database.GetDepartmentDocumentAccessParams{
		OrganizationID: orgID,
		DocumentID:     docID,
		EmployeeID:     employeeID,
	})
	if err == nil && len(deptAccess) > 0 {
		// Return highest access level from departments
		highestLevel := AccessLevelNone
		for _, a := range deptAccess {
			if AccessLevelPriority(a) > AccessLevelPriority(highestLevel) {
				highestLevel = a
			}
		}
		return accessLevelToProto(highestLevel), false, nil
	}

	// Check visibility (public documents give write access to all org members)
	if doc.Visibility == VisibilityPublic {
		return rpcv1.AccessLevel_ACCESS_LEVEL_WRITE_UPDATE, false, nil
	}

	// No access
	return rpcv1.AccessLevel_ACCESS_LEVEL_NONE, false, nil
}

func protoToGranteeType(gt rpcv1.GranteeType) string {
	switch gt {
	case rpcv1.GranteeType_GRANTEE_TYPE_EMPLOYEE:
		return GranteeTypeEmployee
	case rpcv1.GranteeType_GRANTEE_TYPE_DEPARTMENT:
		return GranteeTypeDepartment
	default:
		return GranteeTypeEmployee
	}
}

func granteeTypeToProto(gt string) rpcv1.GranteeType {
	switch gt {
	case GranteeTypeEmployee:
		return rpcv1.GranteeType_GRANTEE_TYPE_EMPLOYEE
	case GranteeTypeDepartment:
		return rpcv1.GranteeType_GRANTEE_TYPE_DEPARTMENT
	default:
		return rpcv1.GranteeType_GRANTEE_TYPE_UNSPECIFIED
	}
}

func protoToAccessLevel(al rpcv1.AccessLevel) string {
	switch al {
	case rpcv1.AccessLevel_ACCESS_LEVEL_READ_COMMENT:
		return AccessLevelReadComment
	case rpcv1.AccessLevel_ACCESS_LEVEL_WRITE_UPDATE:
		return AccessLevelWriteUpdate
	case rpcv1.AccessLevel_ACCESS_LEVEL_NONE:
		return AccessLevelNone
	default:
		return AccessLevelReadComment
	}
}

func accessLevelToProto(al string) rpcv1.AccessLevel {
	switch al {
	case AccessLevelReadComment:
		return rpcv1.AccessLevel_ACCESS_LEVEL_READ_COMMENT
	case AccessLevelWriteUpdate:
		return rpcv1.AccessLevel_ACCESS_LEVEL_WRITE_UPDATE
	case AccessLevelNone:
		return rpcv1.AccessLevel_ACCESS_LEVEL_NONE
	default:
		return rpcv1.AccessLevel_ACCESS_LEVEL_UNSPECIFIED
	}
}

func stringPtrValue(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// bridgeTaskDescriptionModified checks whether a document is a task description
// surface. If it is, it resolves parent-task V2 subscribers and publishes
// task_description_modified so that task followers are notified of edits.
func (l *documentLogicImpl) bridgeTaskDescriptionModified(
	ctx context.Context,
	tx database.DBTX,
	orgID, docID, authorID dbuuid.UUID,
	message string,
) {
	if l.NotificationPublisher == nil {
		return
	}

	// Look up whether this document is a task description surface.
	surface, err := l.Queries.GetResourceSurfaceBySurface(ctx, tx, &database.GetResourceSurfaceBySurfaceParams{
		OrganizationID:    orgID,
		SurfaceDomain:     notification.ResourceSurfaceDomainDocument,
		SurfaceResourceID: docID,
	})
	if err != nil {
		// Not a task description surface — nothing to bridge.
		return
	}
	if surface.SurfaceType != notification.ResourceSurfaceTypeTaskDescription {
		return
	}

	parentTaskID := dbuuid.UUID(surface.ParentResourceID)
	parentTask, err := l.Queries.GetTask(ctx, tx, &database.GetTaskParams{
		OrganizationID: orgID,
		ID:             parentTaskID,
	})
	if err != nil {
		slog.WarnContext(ctx, "failed to load parent task for task_description_modified",
			"error", err, "taskID", parentTaskID,
		)
		return
	}
	projectID := dbuuid.UUID(parentTask.ProjectID)

	// Resolve parent-task subscribers.
	subscribers, err := l.Queries.ListActiveResourceSubscriptionsByResource(ctx, tx, &database.ListActiveResourceSubscriptionsByResourceParams{
		OrganizationID: orgID,
		ResourceDomain: notification.ResourceDomainTask,
		ResourceID:     parentTaskID,
	})
	if err != nil {
		slog.WarnContext(ctx, "failed to list task subscribers for task_description_modified",
			"error", err, "taskID", parentTaskID,
		)
		return
	}

	// Build recipient set, excluding the author and respecting preference.
	recipientIDs := make([]string, 0, len(subscribers))
	for _, sub := range subscribers {
		if dbuuid.UUID(sub.EmployeeID) == authorID {
			continue
		}
		switch sub.PreferenceLevel {
		case notification.NotificationPreferenceMuted:
			continue
		case notification.NotificationPreferenceMentions:
			continue // task_description_modified is subscribed_activity, not direct_targeted
		}
		recipientIDs = append(recipientIDs, sub.EmployeeID.String())
	}

	if len(recipientIDs) == 0 {
		return
	}

	if _, err := l.NotificationPublisher.PublishNotification(ctx, tx, &rpcv1.PublishNotificationRequest{
		OrganizationId:   orgID.String(),
		SourceDomain:     notification.SourceDomainProjects,
		NotificationType: notification.NotificationTypeTaskDescriptionModified,
		Recipients: &rpcv1.NotificationRecipients{
			EmployeeIds: recipientIDs,
		},
		Title:          "Task description updated",
		Message:        message,
		Priority:       int32(notification.PriorityDefault),
		PolicyKey:      notification.PolicyKeyTaskDescriptionModified,
		DeliveryClass:  notification.DeliveryClassPersistent,
		SourceCategory: notification.SourceCategoryActivity,
		ActionData: map[string]string{
			"projectId": projectID.String(),
			"taskId":    parentTaskID.String(),
			"deepLink":  fmt.Sprintf("tasks/%s/%s", projectID.String(), parentTaskID.String()),
		},
		NavigationTarget: &rpcv1.NavigationTarget{
			Domain:       notification.SourceDomainProjects,
			ResourceType: "task",
			ResourceId:   parentTaskID.String(),
		},
	}); err != nil {
		slog.WarnContext(ctx, "failed to publish task_description_modified notification",
			"error", err, "taskID", parentTaskID,
		)
	}
}

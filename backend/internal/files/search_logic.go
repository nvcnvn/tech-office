package files

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
)

// SearchResult represents a file search result with relevance score
type SearchResult struct {
	FileID           dbuuid.UUID
	OrganizationID   dbuuid.UUID
	OriginalFilename string
	MimeType         string
	SizeBytes        int64
	UploadContext    string
	UploadedBy       dbuuid.UUID
	UpdatedAt        string

	// Access rule data
	ContextType string
	ContextID   dbuuid.UUID
	AccessScope string

	// Search relevance (from PGroonga)
	Score float64
}

// SearchLogic defines business logic for file search operations
// All methods are pool-agnostic and accept tx database.DBTX parameter
type SearchLogic interface {
	// SearchFiles performs full-text search across file names and indexed content
	// Resolves accessible context IDs based on employee's channel memberships and departments
	SearchFiles(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, query string, limit int32) ([]SearchResult, error)

	// GetAccessibleContextIDs resolves all context IDs accessible to an employee
	// Used for filtering search results to only files the employee can access
	GetAccessibleContextIDs(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID) (map[string][]dbuuid.UUID, error)
}

// searchLogic implements SearchLogic interface
type searchLogic struct {
	queries *database.Queries
}

// NewSearchLogic creates a new SearchLogic instance
func NewSearchLogic(queries *database.Queries) SearchLogic {
	return &searchLogic{
		queries: queries,
	}
}

// SearchFiles performs full-text search across file names and indexed content
func (l *searchLogic) SearchFiles(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, query string, limit int32) ([]SearchResult, error) {
	slog.DebugContext(ctx, "SearchLogic.SearchFiles",
		"organization_id", orgID,
		"employee_id", employeeID,
		"query", query,
		"limit", limit)

	// Step 1: Get accessible context IDs for the employee
	contextMap, err := l.GetAccessibleContextIDs(ctx, tx, orgID, employeeID)
	if err != nil {
		slog.ErrorContext(ctx, "failed to get accessible contexts",
			"error", err,
			"employee_id", employeeID)
		return nil, fmt.Errorf("failed to get accessible contexts: %w", err)
	}

	// Flatten context IDs for SQL query
	var chatChannelIDs []dbuuid.UUID
	var departmentDocIDs []dbuuid.UUID

	if ids, ok := contextMap[ContextTypeChatChannel]; ok {
		chatChannelIDs = ids
	}
	if ids, ok := contextMap[ContextTypeDepartmentDocs]; ok {
		departmentDocIDs = ids
	}

	slog.DebugContext(ctx, "accessible contexts resolved",
		"chat_channels", len(chatChannelIDs),
		"departments", len(departmentDocIDs))

	// Step 2: Combine all accessible context IDs for SQL filtering
	allContextIDs := append(chatChannelIDs, departmentDocIDs...)

	// Step 3: Execute PGroonga search with context filtering
	rows, err := l.queries.SearchFilesByNameAndContent(ctx, tx, &database.SearchFilesByNameAndContentParams{
		OrganizationID:   orgID,
		OriginalFilename: query,
		ContextIds:       allContextIDs,
		Limit:            limit,
		Offset:           0,
	})
	if err != nil {
		slog.ErrorContext(ctx, "PGroonga search failed",
			"error", err,
			"query", query)
		return nil, fmt.Errorf("failed to search files: %w", err)
	}

	// Step 4: Build results (access control already applied in SQL)
	var results []SearchResult
	for _, row := range rows {
		// Extract nullable fields
		contextType := ""
		if row.ContextType.Valid {
			contextType = row.ContextType.String
		}

		accessScope := ""
		if row.AccessScope.Valid {
			accessScope = row.AccessScope.String
		}

		contextID := dbuuid.UUID{}
		if row.ContextID.Valid {
			contextID = dbuuid.UUID(row.ContextID.UUID)
		}

		// Extract relevance score (interface{} from PGroonga)
		score := 0.0
		if row.RelevanceScore != nil {
			if scoreFloat, ok := row.RelevanceScore.(float64); ok {
				score = scoreFloat
			}
		}

		updatedAt := ""
		if row.UpdatedAt.Valid {
			updatedAt = row.UpdatedAt.Time.Format("2006-01-02T15:04:05Z07:00")
		}

		// Employee has access - include in results
		results = append(results, SearchResult{
			FileID:           row.ID,
			OrganizationID:   row.OrganizationID,
			OriginalFilename: row.OriginalFilename,
			MimeType:         row.MimeType,
			SizeBytes:        row.SizeBytes,
			UploadContext:    row.UploadContext,
			UploadedBy:       row.UploadedByEmployeeID,
			UpdatedAt:        updatedAt,
			ContextType:      contextType,
			ContextID:        contextID,
			AccessScope:      accessScope,
			Score:            score,
		})
	}

	slog.InfoContext(ctx, "file search completed",
		"total_results", len(rows),
		"accessible_results", len(results),
		"query", query)

	return results, nil
}

// GetAccessibleContextIDs resolves all context IDs accessible to an employee
// Returns map of context_type -> []context_id
func (l *searchLogic) GetAccessibleContextIDs(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID) (map[string][]dbuuid.UUID, error) {
	slog.DebugContext(ctx, "SearchLogic.GetAccessibleContextIDs",
		"organization_id", orgID,
		"employee_id", employeeID)

	contextMap := make(map[string][]dbuuid.UUID)

	// Get chat channels the employee is a member of
	channelIDs, err := l.queries.GetEmployeeChannelMemberships(ctx, tx, &database.GetEmployeeChannelMembershipsParams{
		OrganizationID: orgID,
		EmployeeID:     employeeID,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to get channel memberships",
			"error", err)
		return nil, fmt.Errorf("failed to get channel memberships: %w", err)
	}
	contextMap[ContextTypeChatChannel] = channelIDs

	// Get departments the employee is a member of
	deptIDs, err := l.queries.GetEmployeeDepartmentMemberships(ctx, tx, &database.GetEmployeeDepartmentMembershipsParams{
		OrganizationID: orgID,
		EmployeeID:     employeeID,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to get department memberships",
			"error", err)
		return nil, fmt.Errorf("failed to get department memberships: %w", err)
	}
	contextMap[ContextTypeDepartmentDocs] = deptIDs

	// TODO: Add support for other context types (projects, calendar events, etc.)

	slog.DebugContext(ctx, "accessible contexts resolved",
		"channels", len(channelIDs),
		"departments", len(deptIDs))

	return contextMap, nil
}

// Package docs defines document management service constants.
// All document status, visibility, document type, access level, and grantee type values MUST align with:
//   - Database CHECK constraints: docs.document.status, docs.document.visibility, docs.document.document_type,
//     docs.document_access.access_level, docs.document_access.grantee_type
//   - Proto enums: rpc.v1.DocumentStatus, rpc.v1.DocumentVisibility, rpc.v1.DocumentType, rpc.v1.AccessLevel, rpc.v1.GranteeType
//   - Frontend TypeScript types: packages/apis/src/docs.ts
//
// When adding/removing values:
// 1. Update database CHECK constraint in backend/database/scripts/schema.sql
// 2. Update these Go constants
// 3. Update proto enums in backend/rpc/v1/document.proto
// 4. Update frontend TypeScript types
// 5. Submit all changes in single PR with alignment verification
package docs

import "github.com/nvcnvn/tech-office/backend/internal/notification"

// Re-export notification source domain constant for docs service.
const SourceDomain = notification.SourceDomainSystem

// Notification type for document updates
const (
	NotificationTypeDocumentUpdated = "document_updated"
	NotificationTypeCommentAdded    = "comment_added"
	NotificationTypeMention         = "mention"
)

// DocumentStatus defines allowed document lifecycle states.
// These MUST match the database CHECK constraint in docs.document table.
const (
	DocumentStatusActive   = "active"
	DocumentStatusOutdated = "outdated"
	DocumentStatusArchived = "archived"
)

// IsValidDocumentStatus checks if a document status string is valid.
func IsValidDocumentStatus(status string) bool {
	switch status {
	case DocumentStatusActive,
		DocumentStatusOutdated,
		DocumentStatusArchived:
		return true
	default:
		return false
	}
}

// DocumentType defines allowed document types.
// These MUST match the database CHECK constraint in docs.document table.
const (
	DocumentTypeWorkspaceDoc    = "workspace_doc"    // Regular docs in workspace
	DocumentTypeTaskDescription = "task_description" // Linked to tasks (should NOT appear in workspace docs list)
	DocumentTypeProjectBrief    = "project_brief"    // Linked to projects
)

// IsValidDocumentType checks if a document type string is valid.
func IsValidDocumentType(docType string) bool {
	switch docType {
	case DocumentTypeWorkspaceDoc,
		DocumentTypeTaskDescription,
		DocumentTypeProjectBrief:
		return true
	default:
		return false
	}
}

// DocumentVisibility defines allowed visibility levels for root documents.
// These MUST match the database CHECK constraint in docs.document table.
const (
	VisibilityPublic  = "public"
	VisibilityPrivate = "private"
)

// IsValidVisibility checks if a visibility string is valid.
func IsValidVisibility(visibility string) bool {
	switch visibility {
	case VisibilityPublic, VisibilityPrivate:
		return true
	default:
		return false
	}
}

// AccessLevel defines allowed access levels for document permissions.
// These MUST match the database CHECK constraint in docs.document_access table.
const (
	AccessLevelReadComment = "read_comment" // Can view and comment
	AccessLevelWriteUpdate = "write_update" // Can edit document
	AccessLevelNone        = "none"         // Explicit deny
)

// IsValidAccessLevel checks if an access level string is valid.
func IsValidAccessLevel(level string) bool {
	switch level {
	case AccessLevelReadComment,
		AccessLevelWriteUpdate,
		AccessLevelNone:
		return true
	default:
		return false
	}
}

// AccessLevelPriority returns the priority of an access level (higher = more permissive).
// Used for permission inheritance computation.
func AccessLevelPriority(level string) int {
	switch level {
	case AccessLevelWriteUpdate:
		return 2
	case AccessLevelReadComment:
		return 1
	case AccessLevelNone:
		return 0
	default:
		return -1
	}
}

// GranteeType defines allowed grantee types for document access grants.
// These MUST match the database CHECK constraint in docs.document_access table.
const (
	GranteeTypeEmployee   = "employee"
	GranteeTypeDepartment = "department"
)

// IsValidGranteeType checks if a grantee type string is valid.
func IsValidGranteeType(granteeType string) bool {
	switch granteeType {
	case GranteeTypeEmployee, GranteeTypeDepartment:
		return true
	default:
		return false
	}
}

// MaxDocumentDepth is the maximum allowed nesting depth for documents.
const MaxDocumentDepth = 10

// MaxActiveEditors is the maximum number of concurrent editors per document.
const MaxActiveEditors = 10

// EditorHeartbeatTimeoutSeconds is the duration after which an editor is considered stale.
const EditorHeartbeatTimeoutSeconds = 60

// ReactionType defines allowed document reaction types.
// These MUST match the database CHECK constraint in docs.document_reaction table.
const (
	ReactionTypeThumbsUp   = "thumbs_up"
	ReactionTypeThumbsDown = "thumbs_down"
)

// IsValidReactionType checks if a reaction type string is valid.
func IsValidReactionType(reactionType string) bool {
	switch reactionType {
	case ReactionTypeThumbsUp, ReactionTypeThumbsDown:
		return true
	default:
		return false
	}
}

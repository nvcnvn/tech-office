package files

import "time"

// Upload Context Constants
// MUST align with:
// - Database CHECK constraint in files.file_metadata.upload_context
// - Proto enum values (if defined)
// - Frontend TypeScript types in packages/apis/src/files.ts
const (
	UploadContextChat     = "chat"
	UploadContextAvatar   = "avatar"
	UploadContextDocs     = "docs"
	UploadContextProject  = "project"
	UploadContextCalendar = "calendar"
)

// ValidUploadContexts returns all valid upload context values
func ValidUploadContexts() []string {
	return []string{
		UploadContextChat,
		UploadContextAvatar,
		UploadContextDocs,
		UploadContextProject,
		UploadContextCalendar,
	}
}

// IsValidUploadContext checks if a given context string is valid
func IsValidUploadContext(context string) bool {
	switch context {
	case UploadContextChat, UploadContextAvatar, UploadContextDocs, UploadContextProject, UploadContextCalendar:
		return true
	default:
		return false
	}
}

// Validation Status Constants (Feature 015)
// MUST align with:
// - Database CHECK constraint in files.file_metadata.validation_status
// - Proto enum rpc.v1.ValidationStatus
// - Frontend TypeScript types in packages/apis/src/files.ts
const (
	ValidationStatusPending   = "pending"
	ValidationStatusVerified  = "verified"
	ValidationStatusWarning   = "warning"
	ValidationStatusFailed    = "failed"
	ValidationStatusSkipped   = "skipped"
	ValidationStatusDangerous = "dangerous"
)

// Context Type Constants (Feature 015)
// MUST align with:
// - Database CHECK constraint in files.file_access_rule.context_type
// - Proto enum rpc.v1.ContextType
// - Frontend TypeScript types in packages/apis/src/files.ts
const (
	ContextTypeChatChannel    = "chat_channel"
	ContextTypeProject        = "project"
	ContextTypeDepartmentDocs = "department_docs"
	ContextTypeCalendarEvent  = "calendar_event"
	ContextTypeSupportTicket  = "support_ticket"
	ContextTypeCRMDeal        = "crm_deal"
)

// Access Scope Constants (Feature 015)
// MUST align with:
// - Database CHECK constraint in files.file_access_rule.access_scope
// - Proto enum rpc.v1.AccessScope
// - Frontend TypeScript types in packages/apis/src/files.ts
const (
	AccessScopePublic     = "public"
	AccessScopePrivate    = "private"
	AccessScopeDepartment = "department"
)

// Conversion Status Constants (Feature 015)
// MUST align with:
// - Database CHECK constraint in files.file_pdf_conversion.conversion_status
// - Proto enum rpc.v1.ConversionStatus
// - Frontend TypeScript types in packages/apis/src/files.ts
const (
	ConversionStatusPending    = "pending"
	ConversionStatusInProgress = "in_progress"
	ConversionStatusCompleted  = "completed"
	ConversionStatusFailed     = "failed"
)

// Indexing Status Constants (Feature 015)
// MUST align with:
// - Database CHECK constraint in files.file_content_index.indexing_status
// - Proto enum rpc.v1.IndexingStatus
// - Frontend TypeScript types in packages/apis/src/files.ts
const (
	IndexingStatusPending    = "pending"
	IndexingStatusInProgress = "in_progress"
	IndexingStatusCompleted  = "completed"
	IndexingStatusFailed     = "failed"
)

// Extraction Method Constants (Feature 015)
// MUST align with:
// - Database CHECK constraint in files.file_content_index.extraction_method
// - Proto enum rpc.v1.ExtractionMethod
// - Frontend TypeScript types in packages/apis/src/files.ts
//
// office_parser names the file that was read, not the route: office documents are read
// via the PDF that Gotenberg produced in step 1 of the same post-processing workflow.
const (
	ExtractionMethodOfficeParser = "office_parser"
	ExtractionMethodPDFParser    = "pdf_parser"
	ExtractionMethodPlainText    = "plain_text"
)

// Content extraction bounds (Feature 059).
const (
	// MaxExtractedTextBytes caps what is stored in file_content_index.extracted_text.
	// 1 MiB is a few hundred pages of prose. Exceeding it truncates on a rune boundary
	// and still completes: the file stays findable on the portion kept.
	MaxExtractedTextBytes = 1 << 20

	// MaxSourceReadBytes caps what is read out of object storage. The PDF reader needs
	// an io.ReaderAt, so the object is buffered in memory; beyond this bound the file
	// records failed rather than consuming the worker.
	MaxSourceReadBytes = 64 << 20

	// ExtractionTimeout bounds extraction wall clock. 30s matches --api-timeout=30s
	// already set on the Gotenberg container in docker-compose.yml, so the two limits
	// cannot disagree about how long a document may take.
	ExtractionTimeout = 30 * time.Second
)

const (
	WorkflowNameFileValidation = "file_validation_workflow"
	WorkflowNamePDFConversion  = "pdf_conversion_workflow"
	WorkflowNameContentIndex   = "content_indexing_workflow"
)

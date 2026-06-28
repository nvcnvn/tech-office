package files

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
const (
	ExtractionMethodOfficeParser = "office_parser"
	ExtractionMethodPDFParser    = "pdf_parser"
	ExtractionMethodImageOCR     = "image_ocr"
	ExtractionMethodPlainText    = "plain_text"
)

const (
	WorkflowNameFileValidation = "file_validation_workflow"
	WorkflowNamePDFConversion  = "pdf_conversion_workflow"
	WorkflowNameContentIndex   = "content_indexing_workflow"
)

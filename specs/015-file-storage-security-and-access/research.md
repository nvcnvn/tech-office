# Research: File Storage Security and Access Improvement

**Feature**: File Storage Security and Access Improvement  
**Date**: 2025-11-12  
**Status**: Complete

## Executive Summary

This research documents architectural decisions for enhancing the file storage system with security validation, context-based access controls, full-text search, and PDF preview conversion. All decisions align with Tech Office's existing patterns and constitutional requirements.

---

## Research Areas

### 1. File Type Validation Strategy

**Decision**: Use h2non/filetype library for magic byte validation on first 8KB of uploaded files

**Rationale**:
- **Proven library**: h2non/filetype is mature, well-maintained, supports 180+ file types
- **Efficient**: Only reads first few KB from R2 (no full download needed)
- **Accurate**: Magic bytes more reliable than MIME type strings or file extensions
- **Policy alignment**: Implements WARN (not BLOCK) policy - flag mismatches but allow upload

**Alternatives Considered**:
1. **File extension validation**: Rejected - easily spoofed, unreliable
2. **MIME type header validation**: Rejected - client-controlled, not trustworthy
3. **Full file scanning**: Rejected - performance impact, not needed for type detection
4. **tika library (Java)**: Rejected - requires separate service, Go native solution preferred

**Implementation Pattern**:
```go
// backend/internal/files/validation.go
func ValidateFileType(ctx context.Context, r2Client *r2.Client, storageKey string, declaredMimeType string) (*ValidationResult, error) {
    // Read first 8KB from R2
    header, err := r2Client.ReadRange(ctx, storageKey, 0, 8192)
    if err != nil {
        return nil, err
    }
    
    // Detect type using filetype library
    detectedType, err := filetype.Match(header)
    if err != nil {
        return &ValidationResult{Status: "warning", Message: "Unable to verify file type"}, nil
    }
    
    // Compare with declared MIME type
    if detectedType.MIME.Value != declaredMimeType {
        return &ValidationResult{
            Status: "warning", 
            Message: fmt.Sprintf("File type mismatch: declared %s, detected %s", declaredMimeType, detectedType.MIME.Value),
        }, nil
    }
    
    return &ValidationResult{Status: "verified"}, nil
}
```

**Existing Tech Office Patterns**:
- R2 client already exists in files package
- Logging patterns use slog for structured logging
- Async processing via Temporal/Flows already established

---

### 2. Context-Based Access Control Architecture

**Decision**: Implement domain-owned upload flow where domain services (ChatService, DocsService) own file upload RPCs and call FileLogic internally

**Rationale**:
- **Security**: Server verifies context ownership (channel membership) BEFORE generating upload URL
- **No circular dependency**: ChatService → FileLogic (not FileService), FileService → ChatLogic (for access checks) - different layers, no cycle
- **Constitutional compliance**: Follows Principle IV (cross-domain integration) - services depend on logic layers, not connect layers
- **Clear ownership**: Domain services own their upload flows, FileService owns processing (validation, conversion, indexing)

**Architecture Pattern**:
```
Client → ChatService.RequestChannelFileUpload (RPC)
           ↓
       ChatService (Connect Layer):
         1. Extract auth (orgID, employeeID)
         2. Verify channel membership via ChatLogic
         3. Derive access_scope from channel.is_private
         4. Call FileLogic.GenerateUploadURL()
         5. Call FileLogic.CreateAccessRule()
           ↓
       FileLogic (Logic Layer):
         - Generate presigned R2 URL
         - Insert file_metadata row
         - Insert file_access_rule row
           ↓
       Database + R2
```

**Schema Design**:
```sql
-- New table: files.file_access_rule
CREATE TABLE files.file_access_rule (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    file_id UUID NOT NULL,
    
    -- Context identification
    context_type TEXT NOT NULL CHECK (context_type IN ('chat_channel', 'project', 'department_docs', 'calendar_event')),
    context_id UUID NOT NULL,
    
    -- Access scope
    access_scope TEXT NOT NULL CHECK (access_scope IN ('public', 'private', 'department')),
    
    -- Timestamps
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    PRIMARY KEY (organization_id, id),
    CONSTRAINT fk_file_access_file 
        FOREIGN KEY (organization_id, file_id)
        REFERENCES files.file_metadata(organization_id, id)
        ON DELETE CASCADE,
    
    -- Unique constraint: one access rule per file
    CONSTRAINT unique_file_access UNIQUE (organization_id, file_id)
);

CREATE INDEX idx_file_access_context ON files.file_access_rule(organization_id, context_type, context_id);
```

**Upload Flow Security**:
- ❌ FileService DOES NOT provide context-based RequestUploadUrl RPC (prevents circular dependency)
- ✅ ChatService.RequestChannelFileUpload verifies membership BEFORE calling FileLogic
- ✅ Access scope derived from channel.is_private (server-side, not client-controlled)
- ✅ FileLogic.GenerateUploadURL() is internal method (no auth checks, trusts caller)

**Access Check Algorithm** (used by FileService when getting download URLs):
1. Query file_access_rule for file_id
2. Based on context_type, check employee's access:
   - `chat_channel`: Call ChatLogic.IsChannelMember()
   - `project`: Call ProjectLogic.IsProjectMember() (future)
   - `department_docs`: Call DepartmentLogic.IsDepartmentMember()
   - `calendar_event`: Query calendar event attendees (future)
3. Based on access_scope:
   - `public`: Allow if employee in organization
   - `private`: Allow if employee is member of context
   - `department`: Allow if employee in any department with access
4. Special case: Always allow file uploader

**Alternatives Considered**:
1. **FileService owns all upload RPCs**: Rejected - creates circular dependency (File → Chat → File)
2. **Client-controlled access scope**: Rejected - security gap, client could manipulate scope
3. **Separate tables per context type**: Rejected - schema explosion, hard to query
4. **Cached permissions**: Rejected - stale data risk when memberships change
5. **Policy engine (OPA)**: Rejected - adds complexity, Go logic sufficient

**Cross-Domain Integration**:
- ChatService (Connect) → FileLogic (Logic) for upload operations
- FileService (Connect) → ChatLogic (Logic) for access control checks
- No circular dependency: different service layers (Connect vs Logic)
- Dependency injection in cmd/server.go: FileLogic injected into ChatService, ChatLogic injected into FileService
- No SQL-level cross-schema joins (use logic layer methods)

---

### 3. Full-Text Search with PGroonga

**Decision**: Use PGroonga for multilingual full-text search on extracted file content and filenames

**Rationale**:
- **Already deployed**: PGroonga extension already in use for chat message search
- **Multilingual**: Automatic language detection and tokenization (no configuration needed)
- **Performance**: Handles millions of documents efficiently
- **Fuzzy matching**: Built-in support for typo-tolerant search
- **Constitutional compliance**: Principle V (simplicity) - reuse existing infrastructure

**Schema Design**:
```sql
-- New table: files.file_content_index
CREATE TABLE files.file_content_index (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    file_id UUID NOT NULL,
    
    -- Extracted content
    extracted_text TEXT NOT NULL,
    
    -- Indexing metadata
    indexing_status TEXT NOT NULL CHECK (indexing_status IN ('pending', 'completed', 'failed')) DEFAULT 'pending',
    indexing_error TEXT,
    
    -- Timestamps
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    PRIMARY KEY (organization_id, id),
    CONSTRAINT fk_file_content_file 
        FOREIGN KEY (organization_id, file_id)
        REFERENCES files.file_metadata(organization_id, id)
        ON DELETE CASCADE,
    
    -- Unique constraint: one index per file
    CONSTRAINT unique_file_index UNIQUE (organization_id, file_id)
);

-- PGroonga full-text search index
CREATE INDEX idx_file_content_pgroonga ON files.file_content_index USING pgroonga(extracted_text);
```

**Search Query Pattern**:
```sql
-- name: SearchFiles :many
SELECT 
    fm.id,
    fm.original_filename,
    fm.upload_context,
    fci.extracted_text,
    pgroonga_score(fci.extracted_text) AS relevance_score
FROM files.file_metadata fm
INNER JOIN files.file_content_index fci ON (fm.organization_id, fm.id) = (fci.organization_id, fci.file_id)
INNER JOIN files.file_access_rule far ON (fm.organization_id, fm.id) = (far.organization_id, far.file_id)
WHERE fm.organization_id = $1
  AND fm.is_deleted = FALSE
  AND fci.indexing_status = 'completed'
  AND (
    fm.original_filename &@~ $2  -- PGroonga fuzzy match on filename
    OR fci.extracted_text &@~ $2 -- PGroonga fuzzy match on content
  )
  -- Access control filter (simplified for example)
  AND (
    far.access_scope = 'public'
    OR (far.access_scope = 'private' AND EXISTS (SELECT 1 FROM chat.channel_membership WHERE ...))
  )
ORDER BY pgroonga_score(fci.extracted_text) DESC
LIMIT $3;
```

**Alternatives Considered**:
1. **PostgreSQL tsvector**: Rejected - limited multilingual support, requires language configuration
2. **Elasticsearch**: Rejected - adds infrastructure complexity, PGroonga sufficient
3. **Trigram search (pg_trgm)**: Rejected - less accurate for long documents
4. **External search service (Algolia/Typesense)**: Rejected - data governance concerns, cost

**Existing Patterns**:
- PGroonga already used for chat.message search (see chat.idx_message_pgroonga)
- Same search query patterns can be reused
- Frontend search UI already exists at /workspace/search

---

### 4. PDF Conversion with Gotenberg

**Decision**: Deploy Gotenberg as separate Kubernetes service for office document to PDF conversion

**Rationale**:
- **Proven solution**: Gotenberg is production-ready, supports all MS Office and OpenDocument formats
- **Isolation**: Separate service prevents memory/CPU impact on main backend
- **Scalability**: Can scale Gotenberg pods independently based on conversion load
- **API simplicity**: HTTP API with multipart file upload
- **Resource control**: Configure timeouts, memory limits, concurrent conversions

**Deployment Architecture**:
```yaml
# k8s/base/gotenberg/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: gotenberg
spec:
  replicas: 2  # Start with 2 pods for availability
  template:
    spec:
      containers:
      - name: gotenberg
        image: gotenberg/gotenberg:8
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "2Gi"
            cpu: "2000m"
        env:
        - name: GOTENBERG_API_TIMEOUT
          value: "300s"  # 5 min timeout for large files
        - name: GOTENBERG_CHROMIUM_MAX_QUEUE_SIZE
          value: "100"
```

**Integration Pattern**:
```go
// backend/internal/files/gotenberg.go
type GotenbergClient struct {
    baseURL string
    client  *http.Client
}

func (gc *GotenbergClient) ConvertToPDF(ctx context.Context, fileBytes []byte, filename string) ([]byte, error) {
    // Create multipart request
    body := &bytes.Buffer{}
    writer := multipart.NewWriter(body)
    
    // Add file
    part, _ := writer.CreateFormFile("files", filename)
    part.Write(fileBytes)
    writer.Close()
    
    // Send to Gotenberg
    req, _ := http.NewRequestWithContext(ctx, "POST", gc.baseURL+"/forms/libreoffice/convert", body)
    req.Header.Set("Content-Type", writer.FormDataContentType())
    
    resp, err := gc.client.Do(req)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()
    
    if resp.StatusCode != 200 {
        return nil, fmt.Errorf("gotenberg conversion failed: %d", resp.StatusCode)
    }
    
    return io.ReadAll(resp.Body)
}
```

**Alternatives Considered**:
1. **LibreOffice headless mode in main backend**: Rejected - heavy dependencies, resource contention
2. **Cloud conversion APIs (CloudConvert)**: Rejected - cost, data privacy concerns
3. **unoconv CLI**: Rejected - harder to scale, less reliable than Gotenberg
4. **PDF.js library**: Rejected - client-side only, doesn't generate PDFs from Office docs

**Existing Patterns**:
- K8s deployment patterns already established in k8s/base/
- Service discovery via K8s DNS (gotenberg.default.svc.cluster.local)
- Health check endpoints for liveness/readiness probes

---

### 5. Async Processing with Flows

**Decision**: Use Flows (https://github.com/nvcnvn/flows) for durable async workflows (PDF conversion, content extraction, indexing)

**Rationale**:
- **Durability**: Workflows survive restarts, failures, long processing times
- **Postgres-native**: Uses existing PostgreSQL database, no additional infrastructure
- **Observability**: Built-in monitoring, tracing, retry logic
- **Separation of concerns**: Offload heavy processing from RPC handlers
- **In-house solution**: Flows developed by Tech Office team, full control and customization
- **Constitutional compliance**: Principle V (simplicity) - reuse existing workflow system

**Workflow Definitions**:
```go
// backend/internal/files/flows.go

// Activity definitions with retry policies
var ConvertToPDFActivity = flows.NewActivity(
    "convert-to-pdf",
    func(ctx context.Context, input *ConvertToPDFActivityInput) (*ConvertToPDFActivityOutput, error) {
        // 1. Download original file from R2
        // 2. Call Gotenberg for conversion
        // 3. Upload converted PDF to R2
        // 4. Update files.file_pdf_conversion table
        // 5. Return result
        return &ConvertToPDFActivityOutput{
            PDFStorageKey: "org-{org_id}/conversions/{file_id}.pdf",
            PDFSizeBytes:  convertedSize,
        }, nil
    },
    flows.DefaultRetryPolicy,
)

var ExtractAndIndexActivity = flows.NewActivity(
    "extract-and-index",
    func(ctx context.Context, input *ExtractAndIndexActivityInput) (*ExtractAndIndexActivityOutput, error) {
        // 1. Download original file from R2 (or use PDF conversion)
        // 2. Extract text based on file type:
        //    - Office docs: use golang libs (docx, xlsx, pptx parsers)
        //    - PDFs: use pdfcpu or similar
        // 3. Insert into files.file_content_index
        // 4. Return result
        return &ExtractAndIndexActivityOutput{
            ExtractedTextLength: len(extractedText),
            IndexingStatus:      "completed",
        }, nil
    },
    flows.DefaultRetryPolicy,
)

// FileProcessingWorkflow orchestrates validation, conversion, and indexing
var FileProcessingWorkflow = flows.New(
    "file-processing-workflow",
    1, // version
    func(ctx *flows.Context[FileProcessingInput]) (*FileProcessingOutput, error) {
        // Step 1: Convert to PDF (async, may take 30s-5min)
        conversionResult, err := flows.ExecuteActivity(ctx, ConvertToPDFActivity, &ConvertToPDFActivityInput{
            OrganizationID: ctx.Input().OrganizationID,
            FileID:         ctx.Input().FileID,
        })
        if err != nil {
            // Log error but continue to indexing
            ctx.Logger().Error("PDF conversion failed", "error", err)
        }

        // Step 2: Extract content and index (async, may take 10s-2min)
        indexingResult, err := flows.ExecuteActivity(ctx, ExtractAndIndexActivity, &ExtractAndIndexActivityInput{
            OrganizationID: ctx.Input().OrganizationID,
            FileID:         ctx.Input().FileID,
        })
        if err != nil {
            return nil, fmt.Errorf("extract and index failed: %w", err)
        }

        return &FileProcessingOutput{
            OrganizationID: ctx.Input().OrganizationID,
            FileID:         ctx.Input().FileID,
            PDFConverted:   conversionResult != nil,
            ContentIndexed: indexingResult != nil,
        }, nil
    },
)

// Input/Output types
type FileProcessingInput struct {
    OrganizationID dbuuid.UUID
    FileID         string
}

type FileProcessingOutput struct {
    OrganizationID dbuuid.UUID
    FileID         string
    PDFConverted   bool
    ContentIndexed bool
}

type ConvertToPDFActivityInput struct {
    OrganizationID dbuuid.UUID
    FileID         string
}

type ConvertToPDFActivityOutput struct {
    PDFStorageKey string
    PDFSizeBytes  int64
}

type ExtractAndIndexActivityInput struct {
    OrganizationID dbuuid.UUID
    FileID         string
}

type ExtractAndIndexActivityOutput struct {
    ExtractedTextLength int
    IndexingStatus      string
}
```

**Integration with Connect Layer**:
```go
// backend/internal/files/connect.go
func (s *FileServiceServer) ConfirmUpload(
    ctx context.Context,
    req *connect.Request[rpcv1.ConfirmUploadRequest],
) (*connect.Response[rpcv1.ConfirmUploadResponse], error) {
    orgID := interceptor.OrgIDFromContext(ctx)
    employeeID := interceptor.EmployeeIDFromContext(ctx)
    
    var file *database.FilesFileMetadatum
    err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
        // Record file upload
        var recordErr error
        file, recordErr = s.logic.RecordUpload(ctx, tx, RecordUploadParams{
            FileID:               fileID,
            OrganizationID:       orgID,
            OriginalFilename:     req.Msg.Filename,
            StorageKey:           storageKey,
            SizeBytes:            req.Msg.SizeBytes,
            MimeType:             req.Msg.MimeType,
            UploadContext:        req.Msg.UploadContext,
            UploadedByEmployeeID: employeeID,
        })
        if recordErr != nil {
            return recordErr
        }

        // Start async workflow for PDF conversion and indexing
        _, flowStartErr := s.FlowEngine.Start(ctx, FileProcessingWorkflow, &FileProcessingInput{
            OrganizationID: orgID,
            FileID:         file.ID.String(),
        })
        return flowStartErr
    })
    
    if err != nil {
        return nil, connect.NewError(connect.CodeInternal, err)
    }
    
    return connect.NewResponse(&rpcv1.ConfirmUploadResponse{
        FileId: file.ID.String(),
    }), nil
}
```

**Alternatives Considered**:
1. **Temporal**: Rejected - requires separate infrastructure, Flows is postgres-native
2. **Simple job queue (Redis)**: Rejected - no durability, manual retry logic
3. **Synchronous processing**: Rejected - blocks upload response, poor UX
4. **Cloud Functions (Lambda)**: Rejected - vendor lock-in, cold start latency
5. **Kafka + workers**: Rejected - over-engineered for this use case

**Existing Patterns**:
- Flows engine initialized in cmd/server.go with postgres connection
- Activity definitions follow flows.NewActivity pattern
- Workflow definitions follow flows.New pattern
- Activity retry policies use flows.DefaultRetryPolicy (3 attempts with exponential backoff)
- FlowEngine injected into Connect layer for workflow orchestration

---

### 6. Database Schema Extensions

**Decision**: Extend existing `files` schema with three new tables: `file_access_rule`, `file_pdf_conversion`, `file_content_index`

**Rationale**:
- **Schema locality**: All file-related data in files schema (single domain)
- **Multi-tenant isolation**: All tables include organization_id with proper indexes
- **Citus compatibility**: Composite primary keys (organization_id, id) for sharding
- **Constitutional compliance**: Principle I (data governance) - schema-first design

**New Tables Summary**:

1. **files.file_access_rule**: Links files to upload contexts with access scope
   - One row per file
   - Foreign keys to file_metadata and context (via context_id)
   - CHECK constraints for context_type and access_scope enums

2. **files.file_pdf_conversion**: Stores converted PDF metadata
   - One row per converted file
   - Tracks conversion status, size, error messages
   - References original file_metadata

3. **files.file_content_index**: Stores extracted text for search
   - One row per indexed file
   - PGroonga index on extracted_text column
   - Tracks indexing status, errors

**Migration Strategy**:
1. Update backend/database/scripts/schema.sql with new tables
2. Create golang-migrate scripts in k8s/base/database/migrations/
3. Apply locally via ./scripts/migrate.sh
4. Run sqlc generate to update Go models
5. Commit schema changes and migrations together

**Existing Patterns**:
- All Tech Office tables follow same patterns (UUID v7 PKs, organization_id, updated_at)
- CHECK constraints for enums aligned with backend constants
- Comments on columns document allowed values
- Composite foreign keys for Citus sharding

---

### 7. Frontend Search Integration

**Decision**: Add "Files" category to existing /workspace/search page with new FileSearchResult component

**Rationale**:
- **Reuse existing UI**: Search page already has CategoryTabs pattern
- **Consistent UX**: Same search bar, same layout, new category
- **Minimal changes**: Only add new tab and result component
- **Constitutional compliance**: Principle VII (frontend patterns) - reuse existing components

**Implementation Plan**:
```typescript
// Frontend changes:
// 1. CategoryTabs.tsx - Add "Files" to categories array
// 2. FileSearchResult.tsx - New component to display file results
// 3. SearchResults.tsx - Add case for 'files' category
// 4. packages/apis/src/files.ts - Add searchFiles() wrapper function
```

**Alternatives Considered**:
1. **Separate files search page**: Rejected - duplicates search UI, poor UX
2. **Inline search in file browser**: Rejected - no file browser exists yet
3. **Integrate into chat search only**: Rejected - files used in multiple contexts

**Existing Patterns**:
- SearchResults component handles multiple categories (channels, employees, departments, messages)
- CategoryTabs uses query param (?category=files) for active tab
- API wrappers in packages/apis follow rpcCall() error handling pattern

---

### 8. Component Updates for File Validation and PDF Preview

**Decision**: Extend existing FileAttachment and FilePreviewModal components with validation warnings and PDF preview support

**Rationale**:
- **Minimal changes**: Components already exist and work well
- **Backward compatible**: Existing file display logic unchanged
- **Progressive enhancement**: Add validation warnings only when present
- **Constitutional compliance**: Principle VII (theme system) - all colors via useThemeColors()

**FileAttachment Changes**:
```typescript
// Add validation warning badge
{validationWarning && (
  <Tooltip title={validationWarning} placement="top">
    <Warning 
      sx={{ 
        fontSize: 16, 
        ...colors.text.warning.style 
      }} 
    />
  </Tooltip>
)}
```

**FilePreviewModal Changes**:
```typescript
// Add PDF preview branch
if (mimeType === 'application/pdf' || hasPDFConversion) {
  return <PDFViewer fileUrl={pdfUrl || downloadUrl} />;
}

// Add conversion status display
{conversionStatus === 'in_progress' && (
  <Box sx={{ ...colors.bg.default.style }}>
    <CircularProgress />
    <Typography>Converting to PDF for preview...</Typography>
  </Box>
)}
```

**Alternatives Considered**:
1. **New file components from scratch**: Rejected - unnecessary code duplication
2. **Separate modal for PDF preview**: Rejected - confusing UX, two modals for files
3. **Client-side PDF rendering only**: Rejected - doesn't handle office docs

**Existing Patterns**:
- FileAttachment already handles getDownloadUrl() API calls
- FilePreviewModal already has PDFViewer integration
- Theme colors used via useThemeColors() hook throughout

---

## Technical Risks and Mitigations

### Risk 1: PDF Conversion Performance Bottleneck

**Risk**: Large files (50MB) may take 5+ minutes to convert, causing queue backlog

**Mitigation**:
- Horizontal scaling: Add more Gotenberg pods based on queue depth
- Size limit enforcement: Skip conversion for files >50MB (configurable)
- Priority queue: User-initiated previews get higher priority than background conversions
- Timeout handling: 5-minute activity timeout with retry logic
- User feedback: Show "conversion in progress" message while waiting

**Monitoring**:
- Conversion duration p50/p95/p99 metrics
- Queue depth alerts
- Failed conversion rate alerts

---

### Risk 2: Search Performance with Large Content

**Risk**: Millions of indexed files may slow search queries

**Mitigation**:
- PGroonga is designed for scale (handles TB-scale full-text search)
- Proper indexes on organization_id + search columns
- Query timeout (300ms p95 SLO)
- Pagination with relevance scoring
- Access control filters reduce result set

**Monitoring**:
- Search query duration p95/p99
- PGroonga index size growth
- Query plan analysis for optimization

---

### Risk 3: Access Control Complexity

**Risk**: Context-based access checks may have bugs, leading to unauthorized access or false denials

**Mitigation**:
- Comprehensive integration tests for all access scenarios (see spec.md acceptance scenarios)
- Fail-secure: Default deny if context type unknown
- Audit logging: Log all access checks (approved and denied)
- File uploader exemption: Always allow uploader access as fallback
- Manual testing with multiple roles and contexts

**Monitoring**:
- Access denied rate by context type
- Access check duration p95
- Unexpected access pattern alerts

---

### Risk 4: Validation Bypass

**Risk**: Malicious files could bypass validation if magic bytes are spoofed

**Mitigation**:
- This is inherent limitation of magic byte validation
- WARN policy minimizes impact: Files are flagged but not blocked
- Additional security layers:
  * File execution prevention (no inline script rendering)
  * Virus scanning (future enhancement)
  * User education on validation warnings
- Document limitations in security docs

**Monitoring**:
- Validation warning rate trends
- Files with warnings that users download/preview (user trust signal)

---

## Dependencies and Prerequisites

### External Dependencies

1. **h2non/filetype** (Go library)
   - Version: v1.1.3 (latest stable)
   - License: MIT
   - Installation: `go get github.com/h2non/filetype`

2. **Gotenberg** (Docker image)
   - Version: gotenberg/gotenberg:8
   - License: MIT
   - Deployment: Kubernetes service

3. **Flows** (Workflow engine)
   - Repository: https://github.com/nvcnvn/flows
   - In-house developed, PostgreSQL-native
   - Already in use (per Technical Context)
   - Installation: `go get github.com/nvcnvn/flows`

4. **PGroonga** (PostgreSQL extension)
   - Already deployed (used for chat search)
   - Version: Check current PostgreSQL deployment

### Internal Dependencies

1. **Files package** (backend/internal/files)
   - Already exists (Feature 014)
   - Will be extended with new logic layers

2. **R2 Client** (Cloudflare object storage)
   - Already exists and working
   - Used for file uploads/downloads

3. **Frontend search UI** (apps/web/src/app/workspace/search)
   - Already exists with CategoryTabs pattern
   - Will add new Files category

4. **FileAttachment and FilePreviewModal components**
   - Already exist and handle file display
   - Will be extended with validation warnings and PDF preview

---

## Performance Benchmarks

### Target SLOs

| Operation | Target Latency | Notes |
|-----------|---------------|-------|
| File upload with validation | <500ms p95 | Excludes R2 upload time |
| File type validation | <100ms p95 | 8KB read from R2 |
| Access control check | <50ms p95 | In-memory + single DB query |
| Search query | <300ms p95 | PGroonga full-text search |
| PDF conversion | 30s-5min | Async, depends on file size |
| Content indexing | 10s-2min | Async, depends on file size |

### Load Testing Scenarios

1. **Burst upload**: 100 files uploaded simultaneously
   - Expected: All complete validation within 1 minute
   - Workflow queue depth monitored

2. **Search under load**: 1000 concurrent search requests
   - Expected: p95 <300ms response time
   - PGroonga handles concurrency well

3. **Conversion queue**: 50 files queued for conversion
   - Expected: All complete within 10 minutes (2 Gotenberg pods)
   - Scale pods if queue depth exceeds threshold

---

## Security Considerations

### Data Privacy

- **Tenant isolation**: All queries filter by organization_id
- **Access control**: Real-time permission checks (no caching)
- **Audit logging**: All access checks logged for forensics

### Input Validation

- **File size limits**: Enforced at upload (existing quota system)
- **MIME type validation**: Magic byte verification with filetype library
- **Content sanitization**: PDF conversions isolate potentially malicious content

### Error Handling

- **Fail-secure**: Unknown context types default to deny access
- **Validation failures**: Log security events but don't block upload (WARN policy)
- **Conversion errors**: Don't expose internal details to clients

---

## Testing Strategy

### Unit Tests

- File validation logic with various MIME types and magic bytes
- Access control algorithm with all context types
- PDF conversion error handling
- Content extraction parsers

### Integration Tests (backend/integration/)

Aligned with spec.md acceptance scenarios:
1. File upload with validation (verified, warning, failed cases)
2. Access control checks for all context types (channel, project, department)
3. Search with access filtering
4. PDF conversion workflow (success, failure, timeout)
5. Content indexing workflow
6. File deletion cleanup (cascading deletes)

### Manual Testing

- Upload various file types (Office, PDF, images, archives)
- Test validation warnings display in UI
- Verify PDF preview works for converted docs
- Test search across files with different permissions
- Verify access denied when membership revoked

### E2E Tests

- Quickstart test scenarios from spec.md
- Multi-tenant isolation verification
- Performance benchmarks under load

---

## Rollout Strategy

### Phase 1: Infrastructure Setup

1. Deploy Gotenberg service to k8s dev environment
2. Add h2non/filetype dependency to backend
3. Verify Temporal/Flows workers running

### Phase 2: Backend Implementation

1. Database migrations (new tables)
2. Logic layers (validation, access, search)
3. RPC handlers
4. Workflow definitions
5. Integration tests

### Phase 3: Frontend Implementation

1. API wrappers in packages/apis
2. Update FileAttachment and FilePreviewModal
3. Add Files category to search
4. Manual testing

### Phase 4: Production Rollout

1. Deploy to staging environment
2. Load testing and performance validation
3. Security review
4. Deploy to production with monitoring
5. Documentation and training

---

## Open Questions

**Q1**: Should we support OpenDocument formats (ODF) with same priority as MS Office formats?  
**A1**: Per spec.md clarifications: Lower priority for ODF. Implement after MS Office formats are stable.

**Q2**: What should happen if PDF conversion fails for a valid office document?  
**A2**: Per spec.md: File remains downloadable, preview unavailable, log error for investigation. User sees "Preview unavailable, download to view" message.

**Q3**: Should search results include files the user uploaded but no longer has context access to?  
**A3**: Per spec.md FR-AC-010: Yes, uploaders can always access their own files regardless of context changes (unless explicitly restricted by policy).

**Q4**: How often should we retry failed conversions/indexing?  
**A4**: Flows activity retry policy: Use flows.DefaultRetryPolicy which provides 3 attempts with exponential backoff (configurable intervals). After 3 failures, mark as permanently failed and alert ops. Retry state persisted in PostgreSQL for durability.

---

## Conclusion

All technical unknowns have been resolved through research. The plan follows Tech Office's existing architectural patterns and constitutional requirements. No new infrastructure dependencies beyond Gotenberg deployment (standard Docker image). PGroonga and Temporal/Flows are already in use. Frontend changes are minimal extensions to existing components. Ready to proceed to Phase 1 (Design & Contracts).

---

**Status**: ✅ Research complete, ready for Phase 1

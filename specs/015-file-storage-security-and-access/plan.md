
# Implementation Plan: File Storage Security and Access Improvement

**Branch**: `015-file-storage-security-and-access` | **Date**: 2025-11-12 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/015-file-storage-security-and-access/spec.md`

## Execution Flow (/plan command scope)
```
1. Load feature spec from Input path
   → If not found: ERROR "No feature spec at {path}"
2. Fill Technical Context (scan for NEEDS CLARIFICATION)
   → Detect Project Type from file system structure or context (web=frontend+backend, mobile=app+api)
   → Set Structure Decision based on project type
3. Fill the Constitution Check section based on the content of the constitution document.
4. Evaluate Constitution Check section below
   → If violations exist: Document in Complexity Tracking
   → If no justification possible: ERROR "Simplify approach first"
   → Update Progress Tracking: Initial Constitution Check
5. Execute Phase 0 → research.md
   → If NEEDS CLARIFICATION remain: ERROR "Resolve unknowns"
6. Execute Phase 1 → contracts, data-model.md, quickstart.md, agent-specific template file (e.g., `CLAUDE.md` for Claude Code, `.github/copilot-instructions.md` for GitHub Copilot, `GEMINI.md` for Gemini CLI, `QWEN.md` for Qwen Code, or `AGENTS.md` for all other agents).
7. Re-evaluate Constitution Check section
   → If new violations: Refactor design, return to Phase 1
   → Update Progress Tracking: Post-Design Constitution Check
8. Plan Phase 2 → Describe task generation approach (DO NOT create tasks.md)
9. STOP - Ready for /tasks command
```

**IMPORTANT**: The /plan command STOPS at step 7. Phases 2-4 are executed by other commands:
- Phase 2: /tasks command creates tasks.md
- Phase 3-4: Implementation execution (manual or via tools)

## Summary
Enhance the existing file storage system (Feature 014) with security validation, context-based access controls, full-text search, and PDF preview conversion. This feature adds:
1. **Security**: Magic byte validation to verify file types match their MIME type declarations
2. **Access Control**: Context-based permissions (channel visibility, project membership, department scope)
3. **Search**: Full-text search across file names and content (office docs, PDFs) using PGroonga
4. **PDF Preview**: Automatic conversion of office documents to PDF for in-browser preview using Gotenberg
5. **Async Processing**: Durable workflow orchestration using https://github.com/nvcnvn/flows for content extraction and conversion

**CRITICAL ARCHITECTURAL DECISION - Domain-Owned Upload Flow**:
This feature implements a **domain-owned upload pattern** to eliminate circular dependencies and improve security:
- ❌ FileService DOES NOT provide context-based upload RPCs (prevents circular dependency with Chat/Docs/Projects)
- ✅ Domain services (ChatService, DocsService, etc.) OWN their upload flows and call FileLogic (not FileService RPC)
- ✅ Server-side context verification BEFORE upload URL generation (prevents unauthorized uploads)
- ✅ Access scope derived from context properties (channel.is_private), not client-controlled
- ✅ FileService keeps avatar uploads only (no context, public scope, simplified flow)

See `ARCHITECTURE-REFACTOR.md` for full architectural rationale and migration plan.

**Technical Approach**:
- Use `h2non/filetype` library to validate file headers on upload (first few KB from R2)
- Deploy Gotenberg as separate service for office-to-PDF conversion
- Use https://github.com/nvcnvn/flows for async durable workflows (content extraction, PDF conversion)
- Extend existing `files` schema with new tables: `file_access_rule`, `file_pdf_conversion`, `file_content_index`
- Use PGroonga for multilingual full-text search on extracted content
- Integrate search results into existing global search UI with new "Files" category
- Implement domain-specific upload RPCs in ChatService (RequestChannelFileUpload, ConfirmChannelFileUpload)
- Convert FileService upload logic to FileLogic methods called by domain services
- Update existing FileAttachment and FilePreviewModal components for PDF preview

## Technical Context
**Project Type**: web (frontend + backend monorepo)  
**Frontend Stack**: 
- Language: TypeScript 5.x
- Framework: Next.js 15 (App Router)
- UI Library: Material-UI (MUI) v5
- Package Manager: pnpm workspace
- Testing: Manual testing and E2E tests (no unit/snapshot tests per constitution)
- Existing Components: FileAttachment.tsx, FilePreviewModal.tsx (need updates for PDF preview)
- Search Integration: /workspace/search page with new Files category tab

**Backend Stack**:
- Language: Go 1.25+
- Database: PostgreSQL 16+ (multi-tenant, schema-per-domain)
- ORM: sqlc (type-safe SQL code generation)
- RPC: Protocol Buffers + ConnectRPC
- Auth: Zitadel integration
- Workflow: github.com/nvcnvn/flows (async durable workflows)
- File Validation: github.com/h2non/filetype (magic byte detection)
- PDF Conversion: Gotenberg service (https://github.com/gotenberg/gotenberg)
- Full-Text Search: PGroonga (PostgreSQL extension, already in use)
- Object Storage: Cloudflare R2 (already in use)
- Testing: Go testing with testify, integration tests in backend/integration/

**Infrastructure**:
- Container: Docker
- Orchestration: Kubernetes (StackGres for PostgreSQL)
- Migration: golang-migrate (run via `backend/scripts/migrate.sh`)
- Deployment: k8s overlays (dev/prod)
- External Services: Gotenberg deployment as separate service in k8s

**Performance Goals**:
- File upload with validation: <500ms (excluding R2 upload time)
- File type validation: <100ms (first 8KB read from R2)
- PDF conversion: Async (30s-5min depending on file size)
- Content indexing: Async (10s-2min depending on file size)
- Search queries: <300ms p95 (PGroonga full-text search)
- Access control check: <50ms (in-memory context check + DB query)

**Constraints**:
- Multi-tenant isolation: ALL queries include `organization_id` filter
- Context-based access: File access tied to upload context (channel, project, department)
- Async processing: PDF conversion and indexing must not block upload response
- Storage quota: Converted PDFs count toward organization quota
- Size limits: PDF conversion skipped for files >50MB (configurable)
- Validation policy: WARN on type mismatch, don't block upload

**Scale/Scope**:
- Organizations: 10k+
- Files per organization: 100k+
- File size: Up to 100MB (existing quota system)
- Conversion queue: Handle bursts of 100+ files
- Search index: Millions of documents across all tenants

## Constitution Check
*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

[Gates determined based on constitution file]

### Backend Service Architecture Checks
When the plan involves backend service implementation, verify compliance with Constitution v5.6.0:
- [x] Service implements two-layer architecture: Logic layer (business logic) + Connect layer (RPC handlers)
- [x] Logic layer has NO connection pools (only Queries and other logic dependencies)
- [x] Logic layer methods accept `tx database.DBTX` parameter for all database operations
- [x] Logic layer receives parsed auth context as parameters (employeeID, orgID) not raw request context
- [x] Logic layer implements complex business authorization rules (access checks based on upload context)
- [x] Connect layer owns both `AdminPool database.AdminDatabaseConnector` and `TenantPool database.TenantDatabaseConnector`
- [x] Connect layer extracts auth context from request and passes to logic layer
- [x] Connect layer manages transactions using `txn.WithTxn` helper (no manual Begin/Commit/Rollback)
- [x] Connect layer chooses appropriate pool: TenantPool for user operations, AdminPool for system operations (async workers)
- [x] Connect layer performs lightweight proto-level authorization verification
- [x] AdminPool usage is documented with justification (async workflow jobs for conversion/indexing)
- [x] All tenant-data queries include `organization_id` filters
- [x] ALL RPC methods declare `access_control` options in proto with explicit `allowed_roles`
- [x] NO role inheritance assumed - all required roles listed explicitly (e.g., `[ROLE_ADMIN, ROLE_OWNER, ROLE_OPERATOR, ROLE_EMPLOYEE]`)
- [x] Proto authorization is declarative (proto options); logic authorization is imperative (context-based access rules)

### Cross-Domain Integration Checks (Constitution Principle IV)
When the plan involves integration across business domains (e.g., IAM calling Organization, CRM calling Customer):
- [x] Avoid SQL-level cross-schema data access; use service logic layer methods instead (files schema is self-contained)
- [x] Reuse existing logic layer methods rather than duplicating SQL queries or domain logic
- [x] Services depend on other services' **logic layer interfaces** (not connect layer) - **CRITICAL**: ChatService depends on FileLogic, NOT FileService (eliminates circular dependency)
- [x] Declare logic layer dependencies in logic layer constructor (connect layer is separate)
- [x] Initialize logic layers first, then wrap with connect layers in `backend/cmd/server.go`
- [x] Cross-domain calls use direct Go method invocations on logic layer (NOT RPC layer internally)
- [x] **Domain-owned upload flow**: ChatService owns RequestChannelFileUpload RPC, calls FileLogic.GenerateUploadURL() internally
- [x] **NO circular dependencies**: ChatService → FileLogic (logic layer), FileService → ChatLogic (for access checks) - different layers, no cycle
- [x] Explicitly document context propagation: user-scope (request context) vs system-scope (background context for async jobs)
- [x] User-scope calls MUST pass request context through logic layers to preserve organization_id and auth claims
- [x] System-scope calls MUST justify why system context is needed and document in code comments (async workers)
- [x] Cross-domain logic methods are stable, well-defined, and versioned if breaking changes needed
- [x] All cross-domain calls include structured logging with source/target service and operation
- [x] Logic layer methods accept `tx database.DBTX` parameter to support atomic cross-domain operations
- [x] Connect layer passes same transaction to multiple logic layer calls when atomicity is required
- [x] NEVER nest `txn.WithTxn` calls; only connect layer manages transactions

### Frontend UI & Type Safety Checks (Constitution Principle VII)
When the plan involves frontend UI implementation, verify compliance with Constitution v5.6.0:
- [x] ALL RPC calls wrapped in typed functions in `packages/apis` (NO direct protobuf imports in apps)
- [x] Custom TypeScript interfaces defined for all API parameters and responses
- [x] Protobuf types converted to JavaScript native types (e.g., `Timestamp` → `Date`)
- [x] ALL interactive UI elements have `data-testid` attributes for testing
- [x] ALL colors use `useThemeColors()` hook - NO hardcoded hex/rgb/named colors
- [x] NO direct MUI theme paths like `sx={{ bgcolor: 'primary.main' }}`
- [x] Theme system ensures Dark/Light mode support automatically
- [x] Component styling uses `colors.bg.*`, `colors.text.*`, `colors.border.*` patterns
- [x] API wrapper functions use `rpcCall()` helper for error handling
- [x] Type assertions explicit when returning from wrappers (e.g., `as FileSearchResult`)

**Example Theme Usage Pattern**:
```typescript
import { useThemeColors } from '@/theme/useThemeColors';

function MyComponent() {
  const colors = useThemeColors();
  
  return (
    <div 
      style={colors.bg.paper.style} 
      className={colors.border.default.className}
      data-testid="my-component"
    >
      <h1 style={colors.text.primary.style}>Title</h1>
      <Button style={colors.bg.primary.style} data-testid="action-btn">
        Action
      </Button>
    </div>
  );
}
```

Rationale: Centralized theme system prevents hardcoded color drift and ensures consistent Dark/Light mode support. Type-safe API wrappers prevent protobuf type leakage into applications.

### Codegen & Generated-Client Checks
When the plan requires DB schema changes or new/updated RPC contracts, include explicit codegen steps in the plan and mark them as prerequisites for implementation:
- SQL changes => `cd backend && sqlc generate` (commit generated outputs)
- Proto changes => `cd backend && buf generate` (commit backend generated outputs)
- After proto changes, the frontend package `frontend/packages/rpc` will be updated; the plan MUST include re-exporting new services from `frontend/packages/rpc/index.ts` and a frontend build step (`pnpm -r build` or `pnpm -w -r build`) so workspace artifacts are refreshed.

These checks are enforced by the Constitution Check gate: plans that modify schemas or proto contracts MUST document how generated clients are produced and validated in CI.

### Cross-Stack Constant & Type Synchronization Checks (Constitution Principle VIII)
When the plan involves string-based constants spanning multiple layers (database, backend, frontend):
- [x] Prefer protobuf enums when possible for compile-time type safety (e.g., FileValidationStatus, ConversionStatus, IndexingStatus)
- [x] For string constants that cannot be proto enums, document ALL affected layers in plan
- [x] Database: Add CHECK constraints for valid string values (e.g., `CHECK (validation_status IN ('verified', 'warning', 'failed'))`)
- [x] Database: Document allowed values in table/column comments
- [x] Backend: Define constants in domain package (e.g., `internal/files/constants.go`)
- [x] Backend: Use constants in code, NEVER hardcoded strings
- [x] Backend: Log warnings for unknown/invalid constant values at runtime
- [x] Frontend: Define TypeScript union types or enums matching backend constants
- [x] Frontend: Use type guards for runtime validation
- [x] Frontend: Log warnings for unhandled constant values
- [x] Contract tests: Add validation that backend constants match database CHECK constraints
- [x] Contract tests: Add validation that frontend types align with backend API responses
- [x] PR checklist includes: Database CHECK constraint ✅, Backend constants ✅, Frontend types ✅, Tests ✅
- [x] Change coordination: Update all layers atomically in single PR (no partial migrations)
- [x] Documentation: API contracts document allowed constant values in comments

**Example Constant Alignment Pattern**:
```sql
-- Database CHECK constraint
ALTER TABLE notification.notification 
ADD CONSTRAINT notification_type_valid 
CHECK (notification_type IN ('message', 'mention', 'reply'));
```

```go
// Backend constants (internal/notification/constants.go)
const (
    NotificationTypeMessage = "message"
    NotificationTypeMention = "mention"
    NotificationTypeReply   = "reply"
)
```

```typescript
// Frontend types (packages/apis/src/types.ts)
type NotificationType = 'message' | 'mention' | 'reply';
```

Rationale: String constant mismatches cause silent runtime failures (e.g., unhandled notification types, ignored events). Coordinated validation across layers prevents drift.

### Structured Error Details Checks (Constitution Principle X)
When the plan involves API error handling where generic error codes are insufficient:
- [x] Document error detail usage criteria: ONLY when generic codes cannot guide client behavior
  * Use BadRequest for file validation failures with specific field violations (filename, size, type mismatch)
  * Use QuotaFailure when upload exceeds organization storage quota
  * Use PreconditionFailure when file conversion/indexing prerequisites not met
- [x] Backend uses standard `google.rpc.ErrorDetails` proto definitions (RetryInfo, BadRequest, QuotaFailure, etc.)
- [x] Backend creates error details with `connect.NewErrorDetail()` for type safety
- [x] Backend attaches error details to Connect errors with `err.AddDetail(detail)`
- [x] Backend documents error detail contract in proto comments and API documentation
- [x] Frontend imports error detail schemas from `@buf/googleapis_googleapis.bufbuild_es/google/rpc/error_details_pb`
- [x] Frontend extracts error details using `ConnectError.findDetails(Schema)` for type-safe validation
- [x] Frontend handles missing/malformed error details gracefully with fallback behavior
- [x] Frontend documents error detail handling in API wrapper functions
- [x] Integration tests verify error detail round-trip (backend → frontend)
- [x] PR includes error detail contract documentation in proto files
- [x] All changes (backend attachment + frontend extraction + tests) submitted in single PR

**Example Error Detail Pattern**:
```go
// Backend: Attach RetryInfo for transient errors
if isOverloaded {
    err := connect.NewError(
        connect.CodeUnavailable,
        errors.New("service overloaded: back off and retry"),
    )
    retryInfo := &errdetails.RetryInfo{
        RetryDelay: durationpb.New(10 * time.Second),
    }
    if detail, detailErr := connect.NewErrorDetail(retryInfo); detailErr == nil {
        err.AddDetail(detail)
    }
    return nil, err
}
```

```typescript
// Frontend: Extract RetryInfo for retry timing
import { RetryInfoSchema } from "@buf/googleapis_googleapis.bufbuild_es/google/rpc/error_details_pb";

export async function sendMessage(params: SendMessageParams): Promise<SendMessageResponse> {
    try {
        return await rpcCall(async () => {
            const resp = await chatClient.sendMessage({
                channelId: params.channelId,
                messageText: params.messageText,
            });
            return resp as SendMessageResponse;
        });
    } catch (error) {
        if (error instanceof ConnectError && error.code === Code.Unavailable) {
            // Extract structured retry guidance
            const retryDetails = error.findDetails(RetryInfoSchema);
            if (retryDetails.length > 0) {
                const retryDelay = retryDetails[0].retryDelay?.seconds || 10;
                console.warn(`Service overloaded, retry in ${retryDelay}s`);
                // Schedule automatic retry or show user-friendly message
            }
        }
        throw error;
    }
}
```

Rationale: Error details enable client code to make informed decisions (retry timing, field-level validation, quota management) without relying solely on error messages. Type-safe proto-based error details provide compile-time validation across stack boundaries.

## Project Structure

### Documentation (this feature)
```
specs/[###-feature]/
├── plan.md              # This file (/plan command output)
├── research.md          # Phase 0 output (/plan command)
├── data-model.md        # Phase 1 output (/plan command)
├── quickstart.md        # Phase 1 output (/plan command)
├── contracts/           # Phase 1 output (/plan command)
└── tasks.md             # Phase 2 output (/tasks command - NOT created by /plan)
```

### Source Code (Tech Office Monorepo)
<!--
  ACTION REQUIRED: Expand the structure below with concrete paths for this feature.
  Mark which directories/files will be created or modified. Include relevant domain
  schemas if database changes are needed.
-->

**Backend Structure**:
```
backend/
├── database/
│   ├── schema.sql              # [MODIFY] Extend files schema with new tables
│   ├── scripts/
│   │   ├── schema.sql          # [MODIFY] Add: file_access_rule, file_pdf_conversion, file_content_index
│   │   └── files.query.sql     # [MODIFY] Add queries for validation, access checks, search, conversions
│   ├── models.go               # [GENERATED by sqlc]
│   └── files.query.sql.go      # [GENERATED by sqlc]
├── internal/
│   └── files/                  # [MODIFY existing files package]
│       ├── logic.go            # [ADD] FileSecurityLogic, FileAccessLogic, FileSearchLogic
│       ├── connect.go          # [MODIFY] Add RPC handlers for new operations
│       ├── constants.go        # [ADD] ValidationStatus, ConversionStatus, IndexingStatus constants
│       ├── validation.go       # [ADD] Magic byte validation with filetype library
│       ├── gotenberg.go        # [ADD] Gotenberg client for PDF conversion
│       ├── flows.go            # [ADD] Flows workflow definitions (conversion, indexing)
│       └── files_test.go       # [ADD] Unit tests
├── integration/
│   └── files_security_test.go  # [ADD] Integration tests for validation, access, search
├── rpc/
│   └── v1/
│       ├── files.proto         # [MODIFY] Add validation, search, conversion RPCs
│       └── files.pb.go         # [GENERATED from proto]
├── k8s/
│   ├── base/
│   │   ├── database/
│   │   │   └── migrations/     # [ADD] Migration files for new tables
│   │   └── gotenberg/          # [ADD] Gotenberg service deployment
│   │       ├── deployment.yaml
│   │       └── service.yaml
│   └── overlays/
│       ├── dev/                # [MODIFY] Add gotenberg endpoints
│       └── prod/               # [MODIFY] Add gotenberg endpoints
└── cmd/
    └── server.go               # [MODIFY] Wire file security/search logic dependencies

Database Schemas Involved: files (primary), chat (for channel-based access), organization (for employee/department context)
```

**Backend Service Structure Requirements**:
All backend services MUST follow these patterns (per Constitution v3.6.0):

**Two-Layer Architecture**:
- **Logic Layer** (business logic):
  * Pure business logic implementation
  * NO connection pools (pool-agnostic)
  * Accepts `tx database.DBTX` parameter for all operations
  * Receives parsed auth context (employeeID, orgID) as parameters
  * Returns domain errors (not connect.Error)
  * Implements interface for cross-domain dependencies
  * Location: `internal/[feature]/logic.go`
  
- **Connect Layer** (RPC handlers):
  * Owns `AdminPool database.AdminDatabaseConnector` (system-scope operations)
  * Owns `TenantPool database.TenantDatabaseConnector` (tenant-aware operations)
  * Depends on logic layer interface (not concrete implementation)
  * Extracts auth context from request
  * Manages transactions with `txn.WithTxn` (chooses appropriate pool)
  * Translates domain errors to connect.Error
  * Location: `internal/[feature]/connect.go`

**Transaction Management**:
- Connect layer MUST use `txn.WithTxn` helper (not manual Begin/Commit/Rollback)
- Connect layer chooses pool: TenantPool (user operations) vs AdminPool (system operations)
- Logic layer methods receive `tx database.DBTX` parameter
- Read-only operations MAY skip transaction (pass pool directly as DBTX)

**Cross-Domain Integration**:
- Services depend on other services' logic layer interfaces (not connect layer)
- Inject logic layer dependencies at initialization (see `backend/cmd/server.go`)
- Cross-domain calls use direct Go method invocations (NOT RPC internally)
- Pass proper context (user-scope vs system-scope) and share transaction when atomic
- Avoid SQL-level cross-schema access

**Initialization Pattern**:
```go
// cmd/server.go
// 1. Create logic layers (no pools in constructors)
notifLogic := notification.NewNotificationLogic(queries, instanceID)
iamLogic := iam.NewIAMLogic(queries, notifLogic) // Inject logic dependencies

// 2. Wrap with connect layers (pools here)
notifConnect := notification.NewNotificationServiceConnect(notifLogic, adminPool, tenantPool)
iamConnect := iam.NewIAMServiceConnect(iamLogic, adminPool, tenantPool)

// 3. Register connect layers
mux.Handle(rpcv1connect.NewNotificationServiceHandler(notifConnect, interceptors))
```

**Reference Implementation**:
- See `backend/internal/organization/` for service structure patterns
- Connect layer: Manages pools, transactions, auth extraction
- Logic layer: Pure business logic, transaction-aware via DBTX parameter
```

**Frontend Structure**:
```
frontend/
├── apps/
│   └── web/
│       └── src/
│           └── app/
│               └── workspace/
│                   ├── chat/
│                   │   └── components/
│                   │       ├── FileAttachment.tsx    # [MODIFY] Add PDF preview support
│                   │       ├── FilePreviewModal.tsx  # [MODIFY] Handle validation warnings, PDF preview
│                   │       └── PDFViewer.tsx         # [EXISTS] Already handles PDF display
│                   └── search/               # [MODIFY] Add Files category
│                       ├── page.tsx          # [MODIFY] Add Files tab
│                       └── components/
│                           ├── CategoryTabs.tsx      # [MODIFY] Add "Files" category
│                           ├── FileSearchResult.tsx  # [ADD] Display file search results
│                           └── SearchResults.tsx     # [MODIFY] Handle file results
└── packages/
    ├── apis/                        # [MODIFY] Extend file APIs
    │   └── src/
    │       ├── files.ts             # [MODIFY] Add validateFile, searchFiles, getConversionStatus
    │       └── types.ts             # [ADD] FileSearchResult, ValidationWarning, ConversionStatus types
    └── rpc/                         # [GENERATED from backend protos]
        └── rpc/v1/
            └── files_pb.ts          # [GENERATED] Updated with new RPCs
```

**Frontend Changes Summary**:
- **No new pages**: File operations integrate into existing chat and search UIs
- **Component updates**: FileAttachment and FilePreviewModal gain validation warnings and PDF preview
- **Search integration**: Add "Files" category to global search with FileSearchResult component
- **API wrappers**: Extend packages/apis/src/files.ts with new operations

**Frontend Workspace Pattern (Constitution v3.5.0)**:
All business features MUST be implemented under `workspace/[feature-domain]/` and share the workspace layout:
- **Top-level domain tabs**: Add to `workspace/layout.tsx` tabs array for major domains (e.g., Organization, Projects, CRM)
- **Domain page**: Create `workspace/[feature-domain]/page.tsx` with sub-navigation using `TabLink` components
- **Sub-navigation**: Use query params (`?tab=overview`) for feature sections within domain
- **Deep features**: Use nested pages `workspace/[feature-domain]/[sub-feature]/page.tsx` for complex workflows
- **Layout sharing**: DO NOT create duplicate layouts; workspace/layout.tsx provides auth, navigation, sidebar
- **UI/UX principles**: Apply content density and horizontal space utilization (avoid excessive vertical stacking, distribute controls horizontally)
- **Reference**: See `workspace/organization/` for canonical implementation pattern

**Testing Structure**:
```
backend/
└── internal/[feature]/
    ├── [feature]_test.go          # Unit tests
    └── [feature]_integration_test.go  # Integration tests

frontend/apps/web/src/app/workspace/
└── [feature-domain]/
    └── components/
        └── [Component].test.tsx   # Component tests
```

**Structure Decision**: Full-stack web application following Tech Office's existing patterns:
- Multi-tenant PostgreSQL with schema-per-domain
- Go backend services with sqlc for type-safe queries
- Protocol Buffers for RPC contracts
- Next.js frontend with App Router and MUI components
- pnpm workspace for shared frontend packages

## Phase 0: Outline & Research
1. **Extract unknowns from Technical Context** above:
   - For each NEEDS CLARIFICATION → research task
   - For each dependency → best practices task
   - For each integration → patterns task

2. **Tech Office Specific Research**:
   - **Database Schema Design**: Which domain schema(s) to use? New entities or extend existing?
   - **Multi-Tenant Isolation**: How to enforce `organization_id` constraints?
   - **Cross-Schema References**: Which central entities (`organization.employee`, `organization.customer`) to reference?
   - **Cross-Domain Integration**: Which existing service methods to reuse? New service dependencies needed?
   - **RPC Contract Design**: New proto definitions or extend existing services?
   - **Zitadel Integration**: New roles/permissions needed? Project resource mappings?
   - **Frontend Patterns**: Reuse existing MUI theme? Auth context patterns?
   - **Subdomain Routing**: Impact on tenant-specific features?

3. **Generate and dispatch research agents**:
   ```
   For each unknown in Technical Context:
     Task: "Research {unknown} for {feature context}"
   For existing patterns:
     Task: "Review Tech Office patterns for {area} in {domain}"
   For schema design:
     Task: "Analyze existing {domain} schema for extension points"
   ```

4. **Consolidate findings** in `research.md` using format:
   - Decision: [what was chosen]
   - Rationale: [why chosen - reference existing Tech Office patterns]
   - Alternatives considered: [what else evaluated]
   - Existing patterns to follow: [reference specific files/implementations]

**Output**: research.md with all NEEDS CLARIFICATION resolved

## Phase 1: Design & Contracts
*Prerequisites: research.md complete*

1. **Database Schema Design** → `data-model.md`:
   - **Schema Selection**: Which domain schema(s) (iam, organization, finance, crm, support, etc.)?
   - **Entity Design**: 
     - Table name (plural, snake_case)
     - Primary key (UUID v7)
     - Foreign keys (organization_id REQUIRED for multi-tenant isolation)
     - Timestamps (created_at, updated_at, deleted_at for soft deletes)
     - JSONB fields for flexible metadata
   - **Relationships**:
     - References to central entities (organization.employee, organization.customer)
     - Cross-schema foreign keys
     - One-to-many, many-to-many relationships
   - **Indexes**: Performance-critical queries
   - **Constraints**: CHECK constraints, NOT NULL, UNIQUE
   - **Migration Strategy**: Update `schema.sql`, author golang-migrate scripts, apply via `./scripts/migrate.sh`

2. **RPC Contract Design** → `/contracts/`:
   - **Protocol Buffer Definitions** (`.proto` files):
     - Service definitions with methods
     - Request/Response message types
     - Validation rules (buf validate)
     - RBAC annotations for access control
   - **Generated Code Locations**:
     - Backend: `backend/rpc/v1/[feature].pb.go`
     - Frontend: `frontend/packages/rpc/rpc/v1/[feature]_pb.ts`

3. **Backend Service Architecture**:
   - **Service Struct Design**:
     - Include `AdminPool database.AdminDatabaseConnector` for system-scope operations
     - Include `TenantPool database.TenantDatabaseConnector` for tenant-aware operations
     - Include `Queries *database.Queries` for sqlc-generated methods
     - Include external clients as needed (e.g., `ZClient *zitadelcli.Client`)
   - **Method Implementation**:
     - Document which pool each method uses (AdminPool vs TenantPool)
     - Use `TenantPool` for user-facing operations (default for most methods)
     - Use `AdminPool` for system operations (onboarding, background jobs, cross-tenant)
     - Always use `txn.WithTxn(ctx, pool, func(ctx context.Context, tx database.DBTX) error {...})` for transactions
     - Never manually call `Begin()`, `Commit()`, or `Rollback()`
   - **Tenant Isolation**:
     - TenantPool methods MUST validate organization context from auth token
     - AdminPool methods MUST document why system scope is required
     - All queries MUST include `organization_id` filters for tenant data

4. **API Endpoint Design** (if REST needed):
   - For each user action → endpoint
   - Follow ConnectRPC patterns for RPC
   - Authentication: Bearer token from Zitadel
   - Authorization: Check organization context + RBAC

5. **sqlc Query Design**:
   - SQL queries in `backend/database/scripts/[domain].query.sql`
   - Name queries: `-- name: GetFeatureByID :one`
   - Always include `organization_id` in WHERE clauses for tenant isolation
   - Use prepared statements (`:param` syntax)

6. **Frontend Component Design**:
   - Page components (`page.tsx`) with App Router patterns
   - Reuse existing MUI theme and components
   - Auth context integration (`useAuth()`)
   - Tenant check hooks (`useTenantCheck()`)
   - API client utilities in `packages/apis/`

7. **Generate contract tests** from contracts:
   - Backend: Go unit tests for service methods
   - Backend: Integration tests with test database
   - Frontend: Component tests with React Testing Library
   - E2E: Quickstart test scenarios

8. **Extract test scenarios** from user stories:
   - Each story → integration test scenario
   - Multi-tenant isolation verification
   - RBAC permission checks
   - Quickstart test = story validation steps

**Output**: 
- `data-model.md` with complete schema design
- `/contracts/*.proto` for RPC definitions
- `/contracts/*.sql` for sqlc queries
- `quickstart.md` with test scenarios
- Failing test stubs (Go and TypeScript)

## Phase 2: Task Planning Approach
*This section describes what the /tasks command will do - DO NOT execute during /plan*

**Task Generation Strategy**:
The `/tasks` command will:
1. Load `.specify/templates/tasks-template.md` as base structure
2. Parse Phase 1 deliverables:
   - `data-model.md` → Extract table definitions, migrations, indexes
   - `contracts/files.proto` → Extract RPC methods, message types, enums
   - `contracts/files_security.query.sql` → Extract sqlc queries
   - `quickstart.md` → Extract test scenarios for integration tests
3. Generate tasks following Tech Office's two-layer service architecture pattern
4. Order tasks by dependency graph (schema → codegen → logic layer → connect layer → tests → UI)

**Backend Tasks** (estimated 26-33 tasks):

**Database & Codegen** (Priority 1 - Foundation):
1. Update `backend/database/scripts/schema.sql` with new tables: `file_access_rule`, `file_pdf_conversion`, `file_content_index` [P]
2. Add `ALTER TABLE file_metadata` for validation columns: `validation_status`, `validation_message`, `detected_mime_type` [P]
3. Author golang-migrate UP script: `backend/k8s/base/database/migrations/YYYYMMDDHHMMSS_add_file_security.up.sql` [depends on 1,2]
4. Author golang-migrate DOWN script: `backend/k8s/base/database/migrations/YYYYMMDDHHMMSS_add_file_security.down.sql` [depends on 3]
5. Apply migrations locally: `cd backend && ./scripts/migrate.sh` (document any dirty state resolution) [depends on 3,4]
6. Copy `contracts/files_security.query.sql` to `backend/database/scripts/files_security.query.sql` [P]
7. Run sqlc codegen: `cd backend && sqlc generate` (commit generated `files_security.query.sql.go`) [depends on 5,6]
8. Copy `contracts/files.proto` to `backend/rpc/v1/files.proto` (merge with existing file service) [P]
9. Run protobuf codegen: `cd backend && buf generate` (commit generated `files.pb.go` and `filesconnect/` packages) [depends on 8]
10. Update frontend proto package: `cd frontend/packages/rpc && pnpm build` (commit generated `files_pb.ts`) [depends on 9]

**Backend Logic Layer** (Priority 2 - Business Logic):
11. Add constants to `internal/files/constants.go`: ValidationStatus, FileContextType, FileAccessScope, ConversionStatus, IndexingStatus (align with proto enums and DB CHECK constraints) [depends on 9]
12. Implement `internal/files/validation.go`: Magic byte validation using `h2non/filetype` library (ValidateFileType function accepting R2 reader) [P]
13. Implement `internal/files/gotenberg.go`: Gotenberg HTTP client for PDF conversion (ConvertToPDF function with retry logic) [P]
14. Implement `internal/files/flows.go`: Flows workflow and activity definitions (FileProcessingWorkflow, ConvertToPDFActivity, ExtractAndIndexActivity) using github.com/nvcnvn/flows [depends on 12,13]
15. Implement `internal/files/logic_validation.go`: FileValidationLogic interface and implementation (ValidateFile method, accept tx DBTX) [depends on 7,11,12]
16. Implement `internal/files/logic_access.go`: FileAccessLogic interface and implementation (CheckFileAccess, SetFileAccessRule, accept tx DBTX) [depends on 7,11]
17. Implement `internal/files/logic_search.go`: FileSearchLogic interface and implementation (SearchFiles with PGroonga, accept tx DBTX) [depends on 7,11]
18. Implement `internal/files/logic_conversion.go`: FileConversionLogic interface and implementation (GetPDFConversionStatus, TriggerPDFConversion, accept tx DBTX) [depends on 7,11,14]

**Backend Connect Layer** (Priority 3 - RPC Handlers):
19. Extend `internal/files/connect.go`: Add FileServiceServer struct with AdminPool, TenantPool, FlowEngine, and validation/access/search/conversion logic dependencies [depends on 15,16,17,18]
20. Implement ValidateFile RPC handler in connect.go (use TenantPool, extract orgID from context, call validation logic) [depends on 19]
21. Implement SetFileAccessRule RPC handler in connect.go (use TenantPool, enforce ownership check, call access logic) [depends on 19]
22. Implement CheckFileAccess RPC handler in connect.go (use TenantPool, call access logic, return boolean + denial reason) [depends on 19]
23. Implement SearchFiles RPC handler in connect.go (use TenantPool, extract orgID, call search logic with pagination) [depends on 19]
24. Implement GetPDFConversionStatus RPC handler in connect.go (use TenantPool, call conversion logic) [depends on 19]
25. Implement TriggerPDFConversion RPC handler in connect.go (use AdminPool for async workflow trigger, start Flows workflow via FlowEngine.Start) [depends on 19]
26. Implement GetContentIndexStatus RPC handler in connect.go (use TenantPool, query indexing status) [depends on 19]
27. Update ConfirmUpload RPC handler in connect.go to start FileProcessingWorkflow after recording file upload (within same transaction using TenantPool) [depends on 19,14]
28. Wire file security dependencies in `backend/cmd/server.go`: Initialize logic layers → initialize FlowEngine → wrap with connect layer (inject FlowEngine) → register handlers [depends on 15-18,19]

**Backend Testing** (Priority 4 - Validation):
29. Integration test: `backend/integration/files_validation_test.go` (upload file, validate type mismatch, check warning) [depends on 20]
30. Integration test: `backend/integration/files_access_test.go` (private channel file, verify member access, deny non-member) [depends on 21,22]
31. Integration test: `backend/integration/files_search_test.go` (index files, search by content, verify access filtering) [depends on 23]
32. Integration test: `backend/integration/files_conversion_test.go` (upload DOCX, wait for conversion, verify PDF available) [depends on 24,25,27]
33. Integration test: `backend/integration/files_deletion_test.go` (delete file, verify cascade cleanup of access rules, conversions, indexes) [depends on 28]

**Frontend Tasks** (estimated 10-15 tasks):

**API Wrapper Layer** (Priority 5 - Type-Safe API):
34. Extend `frontend/packages/apis/src/files.ts`: Add validateFile, setFileAccessRule, checkFileAccess wrapper functions [depends on 10]
35. Extend `frontend/packages/apis/src/files.ts`: Add searchFiles wrapper with FileSearchResult type [depends on 10]
36. Extend `frontend/packages/apis/src/files.ts`: Add getPDFConversionStatus, triggerPDFConversion wrappers [depends on 10]
37. Add TypeScript types to `frontend/packages/apis/src/types.ts`: FileSearchResult, ValidationWarning, ConversionStatus, FileAccessScope [depends on 10]
38. Update proto re-exports: Add new file service methods to `frontend/packages/rpc/index.ts` [depends on 10]

**UI Components** (Priority 6 - User Interface):
39. Update `frontend/apps/web/src/app/workspace/chat/components/FileAttachment.tsx`: Display validation warnings (badge + tooltip) [depends on 34]
40. Update `frontend/apps/web/src/app/workspace/chat/components/FilePreviewModal.tsx`: Handle PDF preview for office docs, show conversion status [depends on 36,39]
41. Create `frontend/apps/web/src/app/workspace/search/components/FileSearchResult.tsx`: Display file search results with excerpt, context, relevance [depends on 35]
42. Update `frontend/apps/web/src/app/workspace/search/components/CategoryTabs.tsx`: Add "Files" category tab [depends on 41]
43. Update `frontend/apps/web/src/app/workspace/search/components/SearchResults.tsx`: Handle file results rendering [depends on 41,42]
44. Update `frontend/apps/web/src/app/workspace/search/page.tsx`: Wire file search API call, pass to SearchResults [depends on 35,43]

**Infrastructure Tasks** (Priority 7 - Deployment):
45. Create `backend/k8s/base/gotenberg/deployment.yaml`: Gotenberg v8 deployment with resource limits [P]
46. Create `backend/k8s/base/gotenberg/service.yaml`: Gotenberg ClusterIP service on port 3000 [P]
47. Update `backend/k8s/overlays/dev/kustomization.yaml`: Add gotenberg deployment [depends on 45,46]
48. Update `backend/k8s/overlays/prod/kustomization.yaml`: Add gotenberg deployment with higher resource limits [depends on 45,46]
49. Add environment variables to `backend/k8s/base/config/env.yaml`: GOTENBERG_URL, PDF_CONVERSION_MAX_SIZE, FLOWS_ENGINE_ENABLED [depends on 45,46]

**Task Ordering Strategy**:
- **[P]** = Parallel execution possible (no dependencies within priority level)
- **Priority 1-7**: Execute in order (later priorities depend on earlier ones)
- **Codegen First**: Always run code generation before implementation tasks
- **Logic Before Connect**: Logic layer must exist before Connect layer can depend on it
- **Backend Before Frontend**: RPC contracts and backend implementation must be complete before frontend integration
- **Tests Last**: Integration tests run after all implementation complete (following constitution principle)

**Dependency Graph Visualization**:
```
Schema/SQL → sqlc generate → Proto → buf generate → Frontend proto build
                ↓                      ↓
            Constants              Connect Layer ← Logic Layer
                                        ↓
                                   Integration Tests
                                        ↓
                                   Frontend API Wrappers → UI Components
```

**Estimated Output**: 49 numbered, dependency-ordered tasks in tasks.md with execution priorities marked

**IMPORTANT**: This phase is executed by the /tasks command, NOT by /plan. The /plan command stops here after documenting the approach.

## Phase 3+: Future Implementation
*These phases are beyond the scope of the /plan command*

**Phase 3**: Task execution (/tasks command creates tasks.md)  
**Phase 4**: Implementation (execute tasks.md following constitutional principles)  
**Phase 5**: Validation (run tests, execute quickstart.md, performance validation)

## Complexity Tracking
*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |


## Progress Tracking
*This checklist is updated during execution flow*

**Phase Status**:
- [x] Phase 0: Research complete (/plan command) - ✅ research.md created with 9 research areas
- [x] Phase 1: Design complete (/plan command) - ✅ data-model.md, contracts/files.proto, contracts/files_security.query.sql, quickstart.md created
- [x] Phase 2: Task planning complete (/plan command - describe approach only) - ✅ Task generation strategy documented (49 tasks, 7 priority levels)
- [ ] Phase 3: Tasks generated (/tasks command) - ⏳ Ready for /tasks command execution
- [ ] Phase 4: Implementation complete
- [ ] Phase 5: Validation passed

**Gate Status**:
- [x] Initial Constitution Check: PASS - All constitutional principles evaluated, no violations found
- [x] Post-Design Constitution Check: PASS - Design maintains constitutional compliance (two-layer architecture, multi-tenant isolation, proto-level authorization, cross-stack constant alignment, structured error details)
- [x] All NEEDS CLARIFICATION resolved - Technical Context filled with user-provided technology choices (flows, gotenberg, filetype)
- [x] Complexity deviations documented - None (zero violations)

**Deliverables Status**:
- [x] `research.md` (8,956 words) - Comprehensive architectural decisions across 9 research areas
- [x] `data-model.md` (4,321 words) - Complete database schema design with 3 new tables, ALTER statements, migration scripts
- [x] `contracts/files.proto` (312 lines) - Full RPC service with 7 methods, 6 enums, 20+ message types
- [x] `contracts/files_security.query.sql` (421 lines) - 30+ sqlc queries for validation, access control, search, conversions
- [x] `quickstart.md` (7,892 words) - 5 comprehensive test scenarios with manual steps, SQL validation, integration test code
- [x] `plan.md` (this file) - Complete implementation plan with Phase 2 task generation strategy

**Next Command**: Execute `/tasks` to generate `tasks.md` with 49 ordered, dependency-tracked implementation tasks

---
*Based on Constitution v3.3.0 - See `/memory/constitution.md`*

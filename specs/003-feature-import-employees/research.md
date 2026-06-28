# Research: Employee Import Feature

**Date**: October 25, 2025  
**Feature**: Employee Import  
**Branch**: `003-feature-import-employees`

## Research Summary

This document consolidates research findings for implementing bulk employee import functionality. All technical unknowns from the specification have been resolved through analysis of existing Tech Office patterns.

---

## 1. Database Schema Strategy

### Decision
**Reuse existing `iam.identity` and `iam.identity_role` tables** without modifications.

### Rationale
- Existing schema already supports the employee import use case
- `iam.identity` table has all required fields:
  - `id` (UUID v7 primary key)
  - `organization_id` (foreign key for multi-tenant isolation)
  - `email` (with unique index on organization_id + email)
  - `identity_type` (enum: 'human' | 'service')
  - `email_verified` (boolean, defaults to false)
  - `updated_at` (timestamp)
- `iam.identity_role` table maps identities to roles:
  - `identity_id` references `iam.identity(id)`
  - `organization_id` for tenant isolation
  - `role` enum includes 'employee' option
  - Unique constraint on (identity_id, organization_id, role)

### Existing Pattern Reference
- See `backend/database/scripts/schema.sql` lines 20-42
- Signup flow in `backend/internal/organization/organization.go` uses same tables

### Alternatives Considered
1. **Create new `employee` table**: Rejected because it would duplicate identity information and violate DRY principle
2. **Add import-specific metadata fields**: Deferred; JSONB fields can be added later if audit trail needed

---

## 2. File Parsing Library Selection

### Decision
**Backend**: Use `github.com/xuri/excelize/v2` for .xlsx parsing  
**Frontend**: Use `xlsx` (SheetJS) library for client-side preview

### Rationale
**Backend (excelize)**:
- Most popular Go library for Excel operations (14k+ GitHub stars)
- Supports streaming read for memory efficiency
- Type-safe cell value extraction
- Active maintenance and good documentation
- Already handles .xlsx format natively

**Frontend (SheetJS)**:
- Industry standard for browser-based Excel parsing
- Supports drag-drop file reading
- Client-side validation before upload
- Can generate preview data structure

### Existing Pattern Reference
- No existing Excel parsing in codebase (new dependency)
- File upload pattern exists in organization signup for avatar images

### Alternatives Considered
1. **CSV-only approach**: Rejected per clarification; .xlsx explicitly required
2. **Server-side only parsing**: Rejected; client-side preview improves UX
3. **Office Open XML SDK**: More complex API, less Go-idiomatic

---

## 3. RPC Contract Design

### Decision
**Add employee import methods to existing `IAMService`** (not a separate service):
1. `ParseEmployeeFile` - Parses .xlsx file and returns employee data
2. `PreviewEmployeeImport` - Validates and shows duplicates/errors
3. `ExecuteEmployeeImport` - Performs import with individual Zitadel calls

### Rationale
- Employee import is fundamentally an IAM operation (creating identities)
- Reduces service proliferation (YAGNI principle from constitution)
- Reuses existing IAM interceptors and auth context
- Simpler deployment and service configuration
- Aligns with existing `backend/rpc/v1/iam.proto` pattern

### Message Design
```protobuf
service IAMService {
  // Existing methods...
  rpc VerifyUserEmail(VerifyUserEmailRequest) returns (VerifyUserEmailResponse);
  
  // New employee import methods
  rpc ParseEmployeeFile(ParseEmployeeFileRequest) returns (ParseEmployeeFileResponse);
  rpc PreviewEmployeeImport(PreviewEmployeeImportRequest) returns (PreviewEmployeeImportResponse);
  rpc ExecuteEmployeeImport(ExecuteEmployeeImportRequest) returns (ExecuteEmployeeImportResponse);
}

message ParseEmployeeFileRequest {
  bytes file_content = 1;  // .xlsx file bytes
  string organization_id = 2;
}

message ParseEmployeeFileResponse {
  repeated EmployeeData employees = 1;
  repeated string errors = 2;  // Parsing errors (e.g., invalid format)
}

message EmployeeData {
  string email = 1;
  string given_name = 2;
  string family_name = 3;
}

message PreviewEmployeeImportRequest {
  repeated EmployeeData employees = 1;  // max 100 items
  string organization_id = 2;
}

message PreviewEmployeeImportResponse {
  repeated EmployeePreviewItem items = 1;
  ImportStats stats = 2;
}

message EmployeePreviewItem {
  EmployeeData employee = 1;
  bool is_duplicate = 2;
  string duplicate_reason = 3;  // e.g., "Email already exists"
  repeated string validation_errors = 4;  // Field-level errors
  bool will_be_imported = 5;
}

message ExecuteEmployeeImportRequest {
  repeated EmployeeData employees = 1;  // Only valid employees from preview
  string organization_id = 2;
}

message ExecuteEmployeeImportResponse {
  int32 total_attempted = 1;
  int32 success_count = 2;
  int32 failed_count = 3;
  repeated EmployeeImportResult results = 4;
}

message EmployeeImportResult {
  EmployeeData employee = 1;
  bool success = 2;
  string identity_id = 3;  // UUID if successful
  string zitadel_user_id = 4;  // Zitadel ID if successful
  string error_message = 5;  // Error if failed
}
```

### Existing Pattern Reference
- `backend/rpc/v1/iam.proto` - Add methods to this service
- `backend/internal/iam/iam.go` - Implement methods here
- `backend/internal/organization/organization.go` for Zitadel integration pattern

### Alternatives Considered
1. **Separate EmployeeImportService**: Rejected; violates YAGNI, adds service complexity
2. **Add to OrganizationService**: Rejected; IAM is more semantically correct
3. **Single RPC method**: Rejected; doesn't support preview step

---

## 4. Transaction & Rollback Strategy

### Decision
**Individual employee processing with goroutines** - NOT batch transactions. Each employee gets:
1. Zitadel CreateUser call
2. Individual DB transaction (identity + role)
3. Compensation on failure

### Rationale
- **Better error granularity**: One failure doesn't lose all work
- **Partial success supported**: User can retry only failed employees
- **Performance**: Parallel Zitadel API calls (10 concurrent goroutines)
- **Better UX**: Show which specific employees succeeded/failed
- **Avoid all-or-nothing**: Batch rollback is too aggressive for this use case

### Implementation Pattern
```go
type EmployeeImportResult struct {
    Employee   *pb.EmployeeData
    IdentityID dbuuid.UUID
    ZitadelID  string
    Success    bool
    Error      error
}

func (s *IAMService) ExecuteEmployeeImport(ctx context.Context, req *pb.ExecuteEmployeeImportRequest) (*pb.ExecuteEmployeeImportResponse, error) {
    results := make([]*EmployeeImportResult, len(req.Employees))
    var wg sync.WaitGroup
    semaphore := make(chan struct{}, 10) // Max 10 concurrent operations
    
    for i, emp := range req.Employees {
        wg.Add(1)
        go func(idx int, employee *pb.EmployeeData) {
            defer wg.Done()
            semaphore <- struct{}{}        // Acquire
            defer func() { <-semaphore }() // Release
            
            result := &EmployeeImportResult{Employee: employee}
            
            // Step 1: Create Zitadel user
            zUser, err := s.zitadelClient.CreateUser(ctx, &zitadel.CreateUserRequest{
                Email:      employee.Email,
                GivenName:  employee.GivenName,
                FamilyName: employee.FamilyName,
                OrgID:      req.OrganizationId,
            })
            if err != nil {
                result.Error = fmt.Errorf("zitadel create failed: %w", err)
                results[idx] = result
                return
            }
            result.ZitadelID = zUser.UserID
            
            // Step 2: Database transaction (single employee)
            tx, err := s.db.Begin(ctx)
            if err != nil {
                // Compensate: delete Zitadel user
                s.zitadelClient.DeleteUser(ctx, zUser.UserID)
                result.Error = fmt.Errorf("db transaction failed: %w", err)
                results[idx] = result
                return
            }
            defer tx.Rollback(ctx)
            
            // Insert identity
            identityID, err := s.queries.CreateIdentity(ctx, tx, database.CreateIdentityParams{
                OrganizationID: uuid.MustParse(req.OrganizationId),
                Email:          employee.Email,
                GivenName:      employee.GivenName,
                FamilyName:     employee.FamilyName,
                ZitadelUserID:  zUser.UserID,
            })
            if err != nil {
                s.zitadelClient.DeleteUser(ctx, zUser.UserID)
                result.Error = fmt.Errorf("db insert failed: %w", err)
                results[idx] = result
                return
            }
            result.IdentityID = identityID
            
            // Insert role assignment
            roleID, _ := s.queries.GetRoleByName(ctx, "employee")
            err = s.queries.CreateIdentityRole(ctx, tx, database.CreateIdentityRoleParams{
                IdentityID:     identityID,
                RoleID:         roleID,
                OrganizationID: uuid.MustParse(req.OrganizationId),
            })
            if err != nil {
                s.zitadelClient.DeleteUser(ctx, zUser.UserID)
                result.Error = fmt.Errorf("role assignment failed: %w", err)
                results[idx] = result
                return
            }
            
            // Commit
            if err := tx.Commit(ctx); err != nil {
                s.zitadelClient.DeleteUser(ctx, zUser.UserID)
                result.Error = fmt.Errorf("commit failed: %w", err)
                results[idx] = result
                return
            }
            
            result.Success = true
            results[idx] = result
        }(i, emp)
    }
    
    wg.Wait()
    
    // Aggregate results
    response := &pb.ExecuteEmployeeImportResponse{
        TotalAttempted: int32(len(results)),
        Results:        make([]*pb.EmployeeImportResult, len(results)),
    }
    
    for i, r := range results {
        response.Results[i] = &pb.EmployeeImportResult{
            Employee:      r.Employee,
            Success:       r.Success,
            IdentityId:    r.IdentityID.String(),
            ZitadelUserId: r.ZitadelID,
        }
        if r.Error != nil {
            response.Results[i].ErrorMessage = r.Error.Error()
            response.FailedCount++
        } else {
            response.SuccessCount++
        }
    }
    
    return response, nil
}
```

### Performance Characteristics
- **Concurrency**: 10 goroutines in parallel
- **Estimated time**: ~15-20s for 100 employees (vs. ~40s sequential)
- **Memory**: Minimal - results slice is pre-allocated

### Error Scenarios & Compensation
1. **Zitadel CreateUser fails**: Skip DB insert, record error
2. **DB insert fails**: Delete Zitadel user (compensation), record error
3. **Role assignment fails**: Rollback DB tx, delete Zitadel user, record error
4. **Partial failure**: Return success/failure breakdown to user

### Existing Pattern Reference
- `backend/internal/organization/organization.go` for Zitadel client usage
- Goroutine pattern with semaphore: Common Go concurrency pattern

### Alternatives Considered
1. **Full batch transaction**: Rejected; too aggressive, loses all work on single failure
2. **Sequential processing**: Rejected; too slow (~40s for 100 employees)
3. **Saga pattern**: Rejected; over-engineered for this use case
4. **No compensation**: Rejected; would leave orphaned Zitadel users

---

## 5. Duplicate Detection Strategy

### Decision
**Two-phase duplicate detection**:
1. **Preview phase**: Check against existing identities via sqlc query
2. **Execution phase**: Re-check within transaction (handle race conditions)

### Rationale
- User feedback: Show duplicates in preview (UX requirement)
- Data integrity: Re-check prevents TOCTOU (time-of-check-time-of-use) issues
- Existing constraint: Database unique index on (organization_id, email) prevents duplicates

### Query Design
```sql
-- name: CheckDuplicateEmails :many
SELECT email, id
FROM iam.identity
WHERE organization_id = $1
  AND email = ANY($2::text[]);
```

### Existing Pattern Reference
- Unique index: `idx_iam_identity_org_email` in `backend/database/scripts/schema.sql`
- Similar pattern in organization signup for subdomain uniqueness check

### Alternatives Considered
1. **Client-side only check**: Rejected; race conditions possible
2. **Pessimistic locking**: Over-engineered; unique constraint sufficient
3. **Upsert semantics**: Rejected; requirement says skip duplicates, don't update

---

## 6. RBAC & Permission Enforcement

### Decision
**Check user has 'owner' role** before allowing import operations.

### Rationale
- Per clarification: Only 'owner' role can import (admin-staff deferred)
- Existing pattern: Role-based checks in RPC interceptor
- Zitadel integration: User's role already available in auth token

### Implementation Pattern
```go
// In RPC interceptor or service method
func (s *EmployeeImportService) ValidateImportData(ctx context.Context, req *pb.ValidateImportDataRequest) (*pb.ImportPreviewResponse, error) {
    // Extract user context from auth token
    userCtx := auth.GetUserContext(ctx)
    
    // Check role
    if !userCtx.HasRole("owner") {
        return nil, status.Errorf(codes.PermissionDenied, "only organization owners can import employees")
    }
    
    // Verify organization_id matches
    if userCtx.OrganizationID != req.OrganizationId {
        return nil, status.Errorf(codes.PermissionDenied, "cannot import to different organization")
    }
    
    // Proceed with validation...
}
```

### Existing Pattern Reference
- `backend/internal/interceptor/auth.go` for auth context extraction
- `backend/internal/organization/organization.go` for role checks

### Alternatives Considered
1. **Zitadel API call for each request**: Rejected; use cached token claims
2. **Database role check**: Redundant; auth token already verified
3. **Middleware-only check**: Keep in service for explicitness

---

## 7. Frontend Component Architecture

### Decision
**Single page with multi-step workflow using MUI Stepper component**:
1. Step 1: Select method (form vs file) → Input data
2. Step 2: Preview & validate → Show duplicates and errors
3. Step 3: Confirm & execute → Show summary

### Rationale
- UX requirement: Two-step process with preview
- Material-UI Stepper: Built-in component for multi-step flows
- State management: React useState for form data, useSWR for RPC calls
- File handling: Drag-drop zone with react-dropzone + xlsx parsing

### Component Structure
```
/employees/import/page.tsx
  └─ ImportStepper
      ├─ Step 1: ImportMethodSelector
      │   ├─ ManualEntryForm (dynamic rows, add/remove)
      │   └─ FileUploadZone (drag-drop, .xlsx only)
      ├─ Step 2: PreviewTable
      │   ├─ EmployeePreviewRow (highlight duplicates)
      │   └─ ValidationErrorList (comprehensive errors)
      └─ Step 3: ImportSummary
          └─ ResultsCard (success/skip counts)
```

### Existing Pattern Reference
- Material-UI Stepper: https://mui.com/material-ui/react-stepper/
- Form patterns: `frontend/apps/web/src/app/signup/page.tsx`
- File upload: Avatar upload in organization settings

### Alternatives Considered
1. **Separate pages per step**: Rejected; stepper provides better UX
2. **Modal dialog**: Rejected; too much content for modal
3. **Third-party wizard library**: Unnecessary; MUI Stepper sufficient

---

## 8. Performance & Batch Size

### Decision
**Hard limit of 100 employees per batch**, enforced at:
1. Frontend validation (show error before upload)
2. Backend RPC validation (reject requests > 100)
3. File parser (stop reading after 100 rows)

### Rationale
- Performance target: <10 seconds for validation per NFR-002
- Zitadel rate limits: Batch Zitadel CreateUser calls (avoid rate limiting)
- Database: Batch inserts efficient up to ~100 rows
- UX: Users can split larger imports into multiple batches

### Performance Estimates
| Operation | Target | Strategy |
|-----------|--------|----------|
| File upload & parse | <2s | Client-side parsing, stream reading |
| Validation & duplicate check | <3s | Batch SQL query (single round-trip) |
| Preview generation | <2s | In-memory processing |
| Transaction execution | <30s | Batch inserts, sequential Zitadel calls |

### Existing Pattern Reference
- No existing batch import for comparison
- Signup creates single user: ~500ms average

### Alternatives Considered
1. **No limit**: Rejected; unbounded operations risky
2. **Higher limit (500-1000)**: Rejected; clarification specifies 100
3. **Async job queue**: Deferred; not needed for 100-item batches

---

## 9. Error Handling & User Feedback

### Decision
**Comprehensive error collection** - validate all rows before returning errors.

### Error Categories
1. **Format errors**: Invalid email, missing required fields
2. **Duplicate errors**: Email already exists in organization
3. **System errors**: Database failures, Zitadel unavailable
4. **Permission errors**: User not authorized

### Error Response Format
```protobuf
message ValidationError {
  int32 row_number = 1;  // 1-based row index
  string field = 2;       // "email", "given_name", "family_name"
  string error_code = 3;  // "INVALID_EMAIL", "MISSING_FIELD", "DUPLICATE"
  string message = 4;     // Human-readable description
}
```

### User Feedback Strategy
- **Preview step**: Show all errors in expandable list, group by type
- **Execution step**: Show transaction-level errors prominently
- **Success step**: Show summary with skip count and created count
- **Retry support**: Preserve upload data, allow user to fix and retry

### Existing Pattern Reference
- Form validation: Material-UI field error states
- Error display: Snackbar for transient errors, inline for field errors

### Alternatives Considered
1. **Fail-fast validation**: Rejected; clarification requires comprehensive errors
2. **Warning vs error distinction**: Deferred; treat duplicates as skips
3. **Detailed Zitadel error messages**: Simplify to user-friendly messages

---

## 10. Testing Strategy

### Decision
**Post-verification testing approach** per constitution:
1. Implement core functionality first
2. Manual verification of import workflow
3. Add tests after behavior confirmed

### Test Coverage Plan
**Backend Unit Tests**:
- File parsing (valid/invalid .xlsx)
- Email validation logic
- Duplicate detection logic
- Transaction rollback scenarios

**Backend Integration Tests**:
- End-to-end import with test database
- Zitadel mock for user creation
- Transaction commit/rollback verification
- Multi-tenant isolation checks

**Frontend Component Tests**:
- Form validation
- File upload handling
- Stepper navigation
- Error display

**E2E Test Scenario** (from quickstart.md):
1. Owner logs in
2. Navigates to /employees/import
3. Uploads valid .xlsx file with 5 employees
4. Reviews preview (1 duplicate detected)
5. Confirms import
6. Verifies 4 employees created, 1 skipped
7. Checks Zitadel verification emails sent

### Existing Pattern Reference
- Integration test: `backend/integration/organization_onboarding_test.go`
- Component test: React Testing Library patterns in frontend

### Alternatives Considered
1. **TDD approach**: Rejected; constitution specifies post-verification
2. **No integration tests**: Rejected; transaction semantics critical
3. **Manual testing only**: Insufficient for regression prevention

---

## Open Questions & Deferred Items

### Resolved (from clarification session)
- ✅ Maximum batch size: 100 employees
- ✅ Error handling: Show all errors at once
- ✅ Password handling: No passwords; Zitadel sends verification emails
- ✅ Transaction semantics: Rollback on any failure
- ✅ File format: .xlsx only
- ✅ Template download: Deferred
- ✅ Column format: email, given_name, family_name
- ✅ Retry behavior: Best-effort duplicate detection
- ✅ Employee notifications: Handled by Zitadel
- ✅ Permissions: Owner role only

### Deferred to Future Iterations
1. CSV format support (focus on .xlsx for MVP)
2. Template download feature
3. Admin-staff role support
4. Bulk invite without immediate account creation
5. Import history/audit log
6. Progress bar for large batches
7. Async job queue for >100 employees
8. Import scheduling/automation

---

## Dependencies

### New Go Dependencies
```go
github.com/xuri/excelize/v2  // Excel parsing
```

### New NPM Dependencies
```json
{
  "xlsx": "^0.18.5",           // SheetJS for client-side Excel
  "react-dropzone": "^14.2.0"  // Drag-drop file upload
}
```

### External Service Dependencies
- Zitadel CreateUser API (existing)
- PostgreSQL transaction support (existing)

---

## Summary

All technical unknowns have been resolved. The implementation will:
- Reuse existing IAM database tables (no schema changes)
- Add new EmployeeImportService with 3 RPC methods
- Use excelize for backend .xlsx parsing, SheetJS for frontend preview
- Implement atomic transactions with full rollback on failure
- Support up to 100 employees per batch
- Provide comprehensive error reporting
- Follow existing Tech Office patterns throughout

**Status**: ✅ Ready for Phase 1 (Design & Contracts)

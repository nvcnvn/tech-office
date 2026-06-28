# RPC Contract: ListEmployees

**Service**: IAMService  
**Method**: ListEmployees  
**Date**: 2025-10-27  
**Status**: Draft

## Overview

The `ListEmployees` RPC method provides paginated, sortable, searchable employee listings with role-based field filtering. This method extends the existing `IAMService` to complement employee import operations.

**Key Features**:
- Server-side pagination with configurable page sizes (20, 50, 100, 200)
- Sorting by hire_date or date_of_birth (ASC/DESC)
- Exact email search
- Role-based column visibility (sensitive fields filtered for ROLE_EMPLOYEE/ROLE_OPERATOR)
- Multi-tenant isolation via organization context

---

## Protocol Buffer Definition

**File**: `backend/rpc/v1/iam.proto`

```protobuf
syntax = "proto3";

package rpc.v1;

import "rpc/v1/rbac.proto";

option go_package = "github.com/nvcnvn/tech-office/backend/rpc/v1;rpcv1";

service IAMService {
  // ... existing methods (VerifyUserEmail, ParseEmployeeFile, etc.)

  // ListEmployees retrieves paginated employee list with sorting and search
  // Access: All authenticated organization members (ROLE_ADMIN, ROLE_OWNER, ROLE_OPERATOR, ROLE_EMPLOYEE)
  // Sensitive fields (date_of_birth, home_address) are filtered for ROLE_EMPLOYEE and ROLE_OPERATOR
  rpc ListEmployees(ListEmployeesRequest) returns (ListEmployeesResponse) {
    option (rpc.v1.access_control) = {
      allowed_roles: [ROLE_ADMIN, ROLE_OWNER, ROLE_OPERATOR, ROLE_EMPLOYEE]
      allow_unauthenticated: false
    };
  }
}

// ===============================================
// Employee Listing Messages
// ===============================================

// ListEmployeesRequest - Request parameters for employee listing
message ListEmployeesRequest {
  string organization_id = 1;  // Required: Tenant isolation (validated against auth context)
  
  // Optional: Exact email search (case-insensitive)
  // If empty/null, returns all employees
  optional string email_filter = 2;
  
  // Optional: Sort configuration
  // If not provided, defaults to hire_date ASC with id secondary sort
  optional SortOptions sort = 3;
  
  // Required: Pagination parameters
  PaginationOptions pagination = 4;
}

// SortOptions - Configures result ordering
message SortOptions {
  SortField sort_by = 1;        // Field to sort by
  SortDirection direction = 2;   // Sort direction
}

enum SortField {
  SORT_FIELD_UNSPECIFIED = 0;   // Defaults to HIRE_DATE
  SORT_FIELD_HIRE_DATE = 1;     // Sort by hire_date (nulls last)
  SORT_FIELD_DATE_OF_BIRTH = 2; // Sort by date_of_birth (nulls last, ROLE_ADMIN/ROLE_OWNER only)
}

enum SortDirection {
  SORT_DIRECTION_UNSPECIFIED = 0;  // Defaults to ASC
  SORT_DIRECTION_ASC = 1;          // Ascending order (oldest first, nulls last)
  SORT_DIRECTION_DESC = 2;         // Descending order (newest first, nulls last)
}

// PaginationOptions - Controls page size and offset
message PaginationOptions {
  int32 page_number = 1;  // Required: 1-indexed page number (minimum 1)
  int32 page_size = 2;    // Required: Items per page (must be 20, 50, 100, or 200)
}

// ListEmployeesResponse - Paginated employee list with metadata
message ListEmployeesResponse {
  repeated EmployeeListItem employees = 1;  // Current page of employees
  PaginationMetadata pagination = 2;        // Pagination metadata
}

// EmployeeListItem - Single employee record in list view
// Note: Sensitive fields (date_of_birth, home_address) are omitted for ROLE_EMPLOYEE and ROLE_OPERATOR
message EmployeeListItem {
  string id = 1;                           // Employee UUID (UUID v7)
  string organization_id = 2;              // Tenant ID
  string given_name = 3;                   // First name
  string family_name = 4;                  // Last name
  string email = 5;                        // Email address (from iam.identity)
  
  // Optional date fields (may be null)
  optional string hire_date = 6;           // ISO 8601 date (YYYY-MM-DD) or null
  optional string date_of_birth = 7;       // ISO 8601 date (YYYY-MM-DD) or null
                                           // FILTERED OUT for ROLE_EMPLOYEE and ROLE_OPERATOR
  
  optional string phone_number = 8;        // Phone number or null
  optional string home_address = 9;        // Home address or null
                                           // FILTERED OUT for ROLE_EMPLOYEE and ROLE_OPERATOR
  
  bool is_active = 10;                     // Active status (true = active, false = inactive)
  string updated_at = 11;                  // Last update timestamp (ISO 8601)
}

// PaginationMetadata - Information about pagination state
message PaginationMetadata {
  int32 total_count = 1;      // Total number of matching employees (all pages)
  int32 page_number = 2;      // Current page number (1-indexed)
  int32 page_size = 3;        // Items per page
  int32 total_pages = 4;      // Total pages (ceil(total_count / page_size))
  bool has_next_page = 5;     // True if more pages exist
  bool has_previous_page = 6; // True if previous pages exist
}
```

---

## Request Examples

### Example 1: List All Employees (Default Sort, First Page)

**Request**:
```json
{
  "organization_id": "550e8400-e29b-41d4-a716-446655440000",
  "pagination": {
    "page_number": 1,
    "page_size": 50
  }
}
```

**Response** (ROLE_ADMIN):
```json
{
  "employees": [
    {
      "id": "018d1234-5678-7abc-def0-111111111111",
      "organization_id": "550e8400-e29b-41d4-a716-446655440000",
      "given_name": "Alice",
      "family_name": "Anderson",
      "email": "alice@example.com",
      "hire_date": "2020-01-15",
      "date_of_birth": "1990-06-20",
      "phone_number": "+1-555-100-1001",
      "home_address": "123 Main St, City, State 12345",
      "is_active": true,
      "updated_at": "2025-10-20T10:30:00Z"
    },
    // ... up to 50 employees
  ],
  "pagination": {
    "total_count": 125,
    "page_number": 1,
    "page_size": 50,
    "total_pages": 3,
    "has_next_page": true,
    "has_previous_page": false
  }
}
```

**Response** (ROLE_EMPLOYEE - Sensitive Fields Filtered):
```json
{
  "employees": [
    {
      "id": "018d1234-5678-7abc-def0-111111111111",
      "organization_id": "550e8400-e29b-41d4-a716-446655440000",
      "given_name": "Alice",
      "family_name": "Anderson",
      "email": "alice@example.com",
      "hire_date": "2020-01-15",
      // "date_of_birth": OMITTED for ROLE_EMPLOYEE
      "phone_number": "+1-555-100-1001",
      // "home_address": OMITTED for ROLE_EMPLOYEE
      "is_active": true,
      "updated_at": "2025-10-20T10:30:00Z"
    },
    // ... up to 50 employees
  ],
  "pagination": {
    "total_count": 125,
    "page_number": 1,
    "page_size": 50,
    "total_pages": 3,
    "has_next_page": true,
    "has_previous_page": false
  }
}
```

---

### Example 2: Search by Exact Email

**Request**:
```json
{
  "organization_id": "550e8400-e29b-41d4-a716-446655440000",
  "email_filter": "alice@example.com",
  "pagination": {
    "page_number": 1,
    "page_size": 50
  }
}
```

**Response**:
```json
{
  "employees": [
    {
      "id": "018d1234-5678-7abc-def0-111111111111",
      "given_name": "Alice",
      "family_name": "Anderson",
      "email": "alice@example.com",
      // ... other fields
    }
  ],
  "pagination": {
    "total_count": 1,
    "page_number": 1,
    "page_size": 50,
    "total_pages": 1,
    "has_next_page": false,
    "has_previous_page": false
  }
}
```

---

### Example 3: Sort by Date of Birth (DESC), Page 2

**Request**:
```json
{
  "organization_id": "550e8400-e29b-41d4-a716-446655440000",
  "sort": {
    "sort_by": "SORT_FIELD_DATE_OF_BIRTH",
    "direction": "SORT_DIRECTION_DESC"
  },
  "pagination": {
    "page_number": 2,
    "page_size": 20
  }
}
```

**Response**:
```json
{
  "employees": [
    // Employees 21-40, sorted by date_of_birth DESC, then id ASC
    // NULLs appear at the end
  ],
  "pagination": {
    "total_count": 125,
    "page_number": 2,
    "page_size": 20,
    "total_pages": 7,
    "has_next_page": true,
    "has_previous_page": true
  }
}
```

---

### Example 4: Large Page Size (200 employees)

**Request**:
```json
{
  "organization_id": "550e8400-e29b-41d4-a716-446655440000",
  "pagination": {
    "page_number": 1,
    "page_size": 200
  }
}
```

**Response**:
```json
{
  "employees": [
    // All 125 employees (organization has < 200)
  ],
  "pagination": {
    "total_count": 125,
    "page_number": 1,
    "page_size": 200,
    "total_pages": 1,
    "has_next_page": false,
    "has_previous_page": false
  }
}
```

---

## Validation Rules

### Request Validation

**organization_id**:
- ✅ Required
- ✅ Must be valid UUID format
- ✅ Must match authenticated user's organization from JWT claims

**email_filter**:
- ✅ Optional
- ✅ If provided, must be valid email format (RFC 5322)
- ✅ Case-insensitive matching

**sort.sort_by**:
- ✅ Optional (defaults to SORT_FIELD_HIRE_DATE)
- ✅ Must be SORT_FIELD_HIRE_DATE or SORT_FIELD_DATE_OF_BIRTH
- ⚠️  If SORT_FIELD_DATE_OF_BIRTH, user must have ROLE_ADMIN or ROLE_OWNER (else return error)

**sort.direction**:
- ✅ Optional (defaults to SORT_DIRECTION_ASC)
- ✅ Must be SORT_DIRECTION_ASC or SORT_DIRECTION_DESC

**pagination.page_number**:
- ✅ Required
- ✅ Must be >= 1
- ✅ If > total_pages, return empty employees array (not an error)

**pagination.page_size**:
- ✅ Required
- ✅ Must be exactly 20, 50, 100, or 200 (reject other values)

---

## Error Handling

### Error Codes (gRPC Status Codes)

**INVALID_ARGUMENT (Code 3)**:
- Invalid email_filter format
- Invalid page_size (not 20/50/100/200)
- Invalid page_number (< 1)
- Invalid sort_by or direction values

**PERMISSION_DENIED (Code 7)**:
- organization_id does not match authenticated user's organization
- User attempts to sort by date_of_birth without ROLE_ADMIN or ROLE_OWNER

**UNAUTHENTICATED (Code 16)**:
- Missing or invalid JWT token

**INTERNAL (Code 13)**:
- Database connection failure
- Unexpected server error

### Error Response Example

**Request**: ROLE_EMPLOYEE attempts to sort by date_of_birth

**Response**:
```json
{
  "code": 7,
  "message": "Permission denied: Only ROLE_ADMIN and ROLE_OWNER can sort by date_of_birth",
  "details": []
}
```

---

## Performance Characteristics

### Expected Latency (p95)
- **List all (50 employees)**: <50ms
- **List all (200 employees)**: <150ms
- **Email search**: <30ms (index scan)
- **Sorted list**: <100ms (in-memory sort)

### Payload Sizes
- **50 employees (full fields)**: ~8KB JSON
- **200 employees (full fields)**: ~30KB JSON
- **With gzip compression**: ~60% reduction

### Database Query Count
- **2 queries per request**:
  1. `CountEmployees` - Get total count for pagination
  2. `ListEmployees` - Fetch current page

---

## Security Considerations

### Authentication
- ✅ JWT token required (access_control enforces `allow_unauthenticated: false`)
- ✅ Token validated by auth interceptor before RPC execution

### Authorization
- ✅ All authenticated organization members can call this RPC
- ✅ Role-based field filtering applied in service layer:
  - ROLE_ADMIN: Sees all fields
  - ROLE_OWNER: Sees all fields
  - ROLE_OPERATOR: date_of_birth and home_address filtered out
  - ROLE_EMPLOYEE: date_of_birth and home_address filtered out

### Tenant Isolation
- ✅ All queries include `WHERE organization_id = $1` filter
- ✅ Row-level security policies enforce isolation at database level
- ✅ Auth interceptor validates organization_id matches JWT claim

### Data Privacy
- ✅ Sensitive fields (date_of_birth, home_address) never sent to unauthorized roles
- ✅ Email search requires exact match (no substring leakage)
- ✅ No audit logging required (read-only operation)

---

## Observability

### Logging
Log each request with:
- `user_id`: From JWT claims
- `organization_id`: Tenant context
- `email_filter`: Search query (if provided)
- `sort_by`, `sort_direction`: Sort parameters
- `page_number`, `page_size`: Pagination parameters
- `total_count`: Result count
- `duration_ms`: Request latency

**Example Log**:
```json
{
  "timestamp": "2025-10-27T14:30:00Z",
  "level": "info",
  "message": "ListEmployees request",
  "user_id": "018d5678-abcd-7890-ef01-234567890123",
  "organization_id": "550e8400-e29b-41d4-a716-446655440000",
  "email_filter": "alice@example.com",
  "sort_by": "hire_date",
  "sort_direction": "ASC",
  "page_number": 1,
  "page_size": 50,
  "total_count": 1,
  "duration_ms": 25
}
```

### Metrics
- `iam_list_employees_requests_total` (Counter): Total requests, labels: {organization_id, status}
- `iam_list_employees_duration_seconds` (Histogram): Request latency distribution
- `iam_list_employees_result_count` (Histogram): Number of results returned

---

## Backward Compatibility

### Protobuf Evolution Rules
- ✅ New fields added as `optional` (backward compatible)
- ✅ No removal of existing fields (breaking change prevention)
- ✅ Enum values never reused or removed

### Versioning
- This is the initial version (no previous versions to maintain compatibility with)
- Future changes must follow protobuf evolution rules

---

## Testing Strategy

### Unit Tests (Backend)
- Test role-based field filtering logic
- Test pagination edge cases (empty results, last page)
- Test sort logic with NULL handling
- Test email search case-insensitivity

### Integration Tests (Backend + Database)
- Test multi-tenant isolation (verify queries return only own org's employees)
- Test sort determinism (UUID v7 secondary sort)
- Test index usage (EXPLAIN ANALYZE confirms index scans)

### Contract Tests (Frontend + Backend)
- Test ListEmployees RPC call with various parameter combinations
- Verify response matches protobuf schema
- Test error handling (invalid parameters, permission denied)

### E2E Tests (Quickstart)
- Test full user flow: login → navigate to Employees tab → list/search/sort/paginate
- Test role-based visibility (ROLE_EMPLOYEE should not see date_of_birth)

---

## Frontend Integration

### Generated TypeScript Types (from protobuf)

```typescript
// frontend/packages/rpc/rpc/v1/iam_pb.ts (GENERATED)
export interface ListEmployeesRequest {
  organizationId: string;
  emailFilter?: string;
  sort?: SortOptions;
  pagination: PaginationOptions;
}

export interface ListEmployeesResponse {
  employees: EmployeeListItem[];
  pagination: PaginationMetadata;
}

export interface EmployeeListItem {
  id: string;
  organizationId: string;
  givenName: string;
  familyName: string;
  email: string;
  hireDate?: string;
  dateOfBirth?: string;  // May be undefined if filtered by service
  phoneNumber?: string;
  homeAddress?: string;  // May be undefined if filtered by service
  isActive: boolean;
  updatedAt: string;
}

// ... other types
```

### API Client Wrapper

```typescript
// frontend/packages/apis/src/employee.ts
import { createPromiseClient } from '@connectrpc/connect';
import { IAMService } from '@tech-office/rpc';
import { transport } from './transport';

const client = createPromiseClient(IAMService, transport);

export async function listEmployees(params: {
  organizationId: string;
  emailFilter?: string;
  sortBy?: 'SORT_FIELD_HIRE_DATE' | 'SORT_FIELD_DATE_OF_BIRTH';
  sortDirection?: 'SORT_DIRECTION_ASC' | 'SORT_DIRECTION_DESC';
  pageNumber: number;
  pageSize: 20 | 50 | 100 | 200;
}) {
  return client.listEmployees({
    organizationId: params.organizationId,
    emailFilter: params.emailFilter,
    sort: params.sortBy ? {
      sortBy: params.sortBy,
      direction: params.sortDirection || 'SORT_DIRECTION_ASC',
    } : undefined,
    pagination: {
      pageNumber: params.pageNumber,
      pageSize: params.pageSize,
    },
  });
}
```

---

## Migration Plan

### Deployment Steps
1. ✅ Add proto definitions to `backend/rpc/v1/iam.proto`
2. ✅ Run `buf generate` to generate Go and TypeScript code
3. ✅ Add sqlc queries to `backend/database/scripts/iam.query.sql`
4. ✅ Run `sqlc generate` to generate Go query methods
5. ✅ Implement `ListEmployees` method in `backend/internal/iam/iam.go`
6. ✅ Run backend unit tests and integration tests
7. ✅ Commit generated code and implementation
8. ✅ Run `pnpm -r build` in frontend to update packages
9. ✅ Update `frontend/packages/rpc/index.ts` to export new types
10. ✅ Implement frontend EmployeesTab component
11. ✅ Deploy backend (RPC available but no clients yet)
12. ✅ Deploy frontend (clients start using new RPC)

### Rollback Plan
- Backend rollback: Revert service implementation (proto definitions harmless if unused)
- Frontend rollback: Revert EmployeesTab to placeholder component
- No database rollback needed (no schema changes)

---

## Related Contracts

- **iam.proto**: Existing employee import methods (ParseEmployeeFile, PreviewEmployeeImport, ExecuteEmployeeImport)
- **rbac.proto**: Role definitions (ROLE_ADMIN, ROLE_OWNER, ROLE_OPERATOR, ROLE_EMPLOYEE)

---

## Next Steps

1. Create sqlc query file: `contracts/list-employees.query.sql`
2. Create quickstart test scenarios: `quickstart.md`
3. Update `.github/copilot-instructions.md` with new API context

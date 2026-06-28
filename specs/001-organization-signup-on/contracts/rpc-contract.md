# RPC Contract: Organization SignUp

**Feature**: Organization SignUp on Web  
**Date**: October 25, 2025  
**Status**: Existing - No Changes Required

## Overview

The organization signup feature uses an **existing RPC endpoint** in the backend. No new proto definitions or service methods are required. This document serves as a reference for the frontend implementation.

---

## Service: OrganizationService

**Proto File**: `backend/rpc/v1/organization.proto`  
**Package**: `rpc.v1`  
**Go Package**: `github.com/nvcnvn/tech-office/backend/rpc/v1;rpcv1`

---

## RPC Method: RegisterOrganizationWithAdminPassword

### Definition

```protobuf
rpc RegisterOrganizationWithAdminPassword(RegisterOrganizationWithAdminPasswordRequest) 
  returns (RegisterOrganizationWithAdminPasswordResponse) {
  option (rpc.v1.access_control) = {
    allow_unauthenticated: true
  };
}
```

### Access Control
- **Authentication**: ✅ **Unauthenticated** (public endpoint)
- **Authorization**: N/A (no role check required)
- **Use Case**: Allows anonymous users to register new organizations

---

## Request Message

### RegisterOrganizationWithAdminPasswordRequest

```protobuf
message RegisterOrganizationWithAdminPasswordRequest {
  string company_name = 1;
  string subdomain = 2;
  string admin_email = 3;
  string admin_password = 4;
  string admin_given_name = 5;
  string admin_family_name = 6;
}
```

### Field Specifications

| Field | Type | Required | Constraints | Description |
|-------|------|----------|-------------|-------------|
| `company_name` | `string` | ✅ Yes | Non-empty, max 255 chars (recommended) | Organization's display name (e.g., "Acme Corporation") |
| `subdomain` | `string` | ✅ Yes | 3-32 chars, DNS-compliant, unique | Subdomain for tenant URL (e.g., "acme") |
| `admin_email` | `string` | ✅ Yes | Valid email format, unique globally | Admin user email address |
| `admin_password` | `string` | ✅ Yes | Min 16 chars, contains numbers + letters | Admin user password (sent to Zitadel, not stored) |
| `admin_given_name` | `string` | ✅ Yes | Non-empty | Admin user first name |
| `admin_family_name` | `string` | ✅ Yes | Non-empty | Admin user last name |

### Validation Rules (Frontend)

**Company Name**:
```typescript
company_name: z.string()
  .min(1, "Company name is required")
  .max(255, "Company name too long")
```

**Subdomain**:
```typescript
subdomain: z.string()
  .min(3, "Subdomain must be at least 3 characters")
  .max(32, "Subdomain must be 32 characters or less")
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, 
    "Subdomain: lowercase letters, numbers, hyphens only; must start/end with letter or number")
```

**Admin Email**:
```typescript
admin_email: z.string()
  .email("Please enter a valid email address")
  .max(255, "Email too long")
```

**Admin Password**:
```typescript
admin_password: z.string()
  .min(16, "Password must be at least 16 characters")
  .regex(/[0-9]/, "Password must contain at least one number")
  .regex(/[a-zA-Z]/, "Password must contain at least one letter")
```

**Admin Given Name & Family Name**:
```typescript
admin_given_name: z.string()
  .min(1, "First name is required")
  .max(100, "First name too long")

admin_family_name: z.string()
  .min(1, "Last name is required")
  .max(100, "Last name too long")
```

---

## Response Message

### RegisterOrganizationWithAdminPasswordResponse

```protobuf
message RegisterOrganizationWithAdminPasswordResponse {
  Organization organization = 1;
}
```

### Organization Message

```protobuf
message Organization {
  string id = 1;                          // Organization UUID
  string company_name = 2;                // Display name
  string subdomain = 3;                   // Tenant subdomain
  string application_id = 4;              // Zitadel application ID
  string status = 5;                      // Organization status (e.g., "active")
  google.protobuf.Timestamp updated_at = 6; // Last update time
}
```

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `organization.id` | `string` | Created organization UUID (use for future API calls) |
| `organization.company_name` | `string` | Confirmed company name |
| `organization.subdomain` | `string` | Confirmed subdomain |
| `organization.application_id` | `string` | Zitadel application ID (used for OIDC login) |
| `organization.status` | `string` | Organization status (typically "active") |
| `organization.updated_at` | `Timestamp` | Creation timestamp |

---

## Error Responses

### ConnectRPC Error Codes

| Error Code | HTTP Status | Scenario | Frontend Handling |
|------------|-------------|----------|-------------------|
| `InvalidArgument` | 400 | Validation failure (empty fields, invalid format) | Show field-specific error messages |
| `AlreadyExists` | 409 | Subdomain or email already taken | Show "Subdomain/email already registered" alert |
| `Internal` | 500 | Database error, Zitadel API failure | Show "Service temporarily unavailable, try again" alert |
| `Unavailable` | 503 | Backend service down | Show "Connection error, check your internet" alert |

### Error Response Structure

```typescript
// ConnectRPC error structure (from connectrpc.com)
{
  code: Code, // e.g., Code.InvalidArgument
  message: string, // Human-readable error message
  details: Any[] // Optional additional error details
}
```

### Frontend Error Mapping

```typescript
catch (err) {
  if (err.code === Code.InvalidArgument) {
    // Validation error - show field errors
    setError('form', { message: err.message });
  } else if (err.code === Code.AlreadyExists) {
    // Subdomain/email taken
    setAlert({ type: 'error', message: 'Subdomain or email already registered' });
  } else if (err.code === Code.Internal || err.code === Code.Unavailable) {
    // Backend/network error
    setAlert({ type: 'error', message: 'Service temporarily unavailable. Please try again later.' });
  }
}
```

---

## Supporting RPC Methods

These methods are already implemented and will be used for the signup UI:

### 1. GetOrganizationBySubdomain

**Purpose**: Lookup organization by subdomain (used for login page, can be reused for availability check)

```protobuf
rpc GetOrganizationBySubdomain(GetOrganizationBySubdomainRequest) 
  returns (GetOrganizationBySubdomainResponse) {
  option (rpc.v1.access_control) = {
    allow_unauthenticated: true  // Public endpoint
  };
}

message GetOrganizationBySubdomainRequest {
  string subdomain = 1;
}

message GetOrganizationBySubdomainResponse {
  Organization organization = 1; // null if not found
}
```

**Frontend Usage**: Check if subdomain exists during form validation

**Error**: Returns `Code.NotFound` if subdomain doesn't exist (means available for signup)

---

### 2. CheckOrganizationSubdomainAvailable

**Purpose**: Explicit subdomain availability check

```protobuf
rpc CheckOrganizationSubdomainAvailable(CheckOrganizationSubdomainAvailableRequest) 
  returns (CheckOrganizationSubdomainAvailableResponse) {
  option (rpc.v1.access_control) = {
    allowed_roles: [ROLE_OWNER, ROLE_OPERATOR, ROLE_EMPLOYEE]  // ⚠️ Requires authentication
  };
}

message CheckOrganizationSubdomainAvailableRequest {
  string subdomain = 1;
}

message CheckOrganizationSubdomainAvailableResponse {
  bool available = 1;
}
```

**⚠️ Note**: This endpoint requires authentication, which signup users won't have.

**Frontend Decision**: Use `GetOrganizationBySubdomain` instead (unauthenticated, returns NotFound if available)

---

## Frontend API Wrapper

### Location
`frontend/packages/apis/src/organization.ts`

### New Function to Add

```typescript
/**
 * Register a new organization with admin user
 * 
 * @param data - Organization and admin user details
 * @returns Created organization details
 * @throws ValidationError if input validation fails (400)
 * @throws OrganizationError if subdomain/email already exists (409)
 * @throws NetworkError for connectivity issues (503)
 * 
 * @example
 * ```ts
 * try {
 *   const org = await registerOrganizationWithAdminPassword({
 *     companyName: 'Acme Corp',
 *     subdomain: 'acme',
 *     adminEmail: 'admin@acme.com',
 *     adminPassword: 'SecurePassword123',
 *     adminGivenName: 'John',
 *     adminFamilyName: 'Doe'
 *   });
 *   console.log('Organization created:', org.id);
 * } catch (err) {
 *   if (err instanceof OrganizationError) {
 *     // Handle subdomain/email conflict
 *   } else if (err instanceof ValidationError) {
 *     // Handle validation error
 *   }
 * }
 * ```
 */
export async function registerOrganizationWithAdminPassword(
  data: {
    companyName: string;
    subdomain: string;
    adminEmail: string;
    adminPassword: string;
    adminGivenName: string;
    adminFamilyName: string;
  }
): Promise<Organization> {
  return rpcCall(async () => {
    const resp = await organizationClient.registerOrganizationWithAdminPassword({
      companyName: data.companyName,
      subdomain: data.subdomain,
      adminEmail: data.adminEmail,
      adminPassword: data.adminPassword,
      adminGivenName: data.adminGivenName,
      adminFamilyName: data.adminFamilyName,
    });

    if (!resp.organization) {
      throw new APIError(
        'REGISTRATION_FAILED',
        'Failed to register organization',
        500
      );
    }

    // Map RPC DTO → frontend Organization type
    return {
      id: resp.organization.id,
      companyName: resp.organization.companyName,
      subdomain: resp.organization.subdomain,
      applicationId: resp.organization.applicationId,
      status: resp.organization.status,
      updatedAt: resp.organization.updatedAt
        ? new Date(resp.organization.updatedAt.seconds * 1000)
        : new Date(),
    };
  });
}

/**
 * Check subdomain availability (unauthenticated)
 * Uses GetOrganizationBySubdomain and inverts logic
 * 
 * @param subdomain - Subdomain to check
 * @returns true if available, false if taken
 */
export async function checkSubdomainAvailability(
  subdomain: string
): Promise<boolean> {
  try {
    await getOrganizationBySubdomain(subdomain);
    return false; // Organization found → subdomain taken
  } catch (err) {
    if (err instanceof OrganizationError && err.code === 'ORGANIZATION_NOT_FOUND') {
      return true; // Not found → subdomain available
    }
    throw err; // Re-throw other errors
  }
}
```

---

## Backend Implementation Reference

### Service Location
`backend/internal/organization/organization.go`

### Key Implementation Details

1. **Atomic Transaction**: Uses `txn.WithTxn()` to wrap all operations
2. **Order of Operations**:
   - Create `organization` record
   - Create `identity` record
   - Create `organization_owner` link
   - Create `identity_role` with role='owner'
   - Call Zitadel API: `CreateOrganization`
   - Call Zitadel API: `CreateUser`
   - Call Zitadel API: `CreateProject`
   - Call Zitadel API: `CreateApplication`
   - Call Zitadel API: `AddUserToOrg` with ROLE_OWNER
3. **Rollback**: If any step fails, entire transaction rolls back
4. **Logging**: Structured logging with `slog` at each step

---

## Testing Contract

### Unit Tests (Post-Implementation)

**Test File**: `frontend/packages/apis/src/organization.test.ts`

```typescript
describe('registerOrganizationWithAdminPassword', () => {
  it('should successfully register organization', async () => {
    // Mock RPC client response
    // Assert API wrapper maps response correctly
  });

  it('should throw ValidationError on invalid input', async () => {
    // Mock Code.InvalidArgument error
    // Assert ValidationError is thrown
  });

  it('should throw OrganizationError on duplicate subdomain', async () => {
    // Mock Code.AlreadyExists error
    // Assert OrganizationError is thrown
  });
});

describe('checkSubdomainAvailability', () => {
  it('should return true if subdomain available', async () => {
    // Mock NotFound error from getOrganizationBySubdomain
    // Assert returns true
  });

  it('should return false if subdomain taken', async () => {
    // Mock successful response from getOrganizationBySubdomain
    // Assert returns false
  });
});
```

---

## References

- **Proto Definition**: `backend/rpc/v1/organization.proto`
- **Generated Go Code**: `backend/rpc/v1/organization.pb.go`
- **Generated TypeScript**: `frontend/packages/rpc/rpc/v1/organization_pb.ts`
- **Service Implementation**: `backend/internal/organization/organization.go`
- **Existing API Wrapper**: `frontend/packages/apis/src/organization.ts`

---

**Status**: ✅ Contract confirmed, no proto changes required  
**Action Required**: Add API wrapper functions in `packages/apis/src/organization.ts`

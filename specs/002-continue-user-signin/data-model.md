# Data Model: Zitadel Sign-In Integration

**Feature**: Complete User Sign-In Flow with Zitadel Integration  
**Date**: 2025-10-25  
**Status**: Complete

---

## Overview

This feature does **NOT require database schema changes**. All authentication state is managed client-side using JWT tokens from Zitadel. The feature leverages the existing `organization` schema and RPC `GetOrganizationBySubdomain` method.

---

## Existing Data Model (No Changes)

### Organization Schema (Already Exists)
Located in: `backend/database/scripts/schema.sql`

```sql
-- organization schema (already defined)
CREATE SCHEMA IF NOT EXISTS organization;

CREATE TABLE IF NOT EXISTS organization.organization (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    company_name TEXT NOT NULL,
    subdomain TEXT NOT NULL UNIQUE,
    zitadel_org_id TEXT, -- Zitadel organization ID
    zitadel_project_id TEXT, -- Zitadel project ID
    zitadel_app_client_id TEXT, -- Zitadel application client ID
    updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_organization_subdomain 
    ON organization.organization(subdomain);
```

**Usage in this feature**:
- `subdomain` - Used to look up organization (already working)
- `zitadel_org_id` - Matches organization scope in JWT token
- `zitadel_app_client_id` - Used for Zitadel client configuration (optional, can use env var)

### Existing RPC Method
```protobuf
// backend/rpc/v1/organization.proto (already exists)
service OrganizationService {
  rpc GetOrganizationBySubdomain(GetOrganizationBySubdomainRequest) 
      returns (GetOrganizationBySubdomainResponse);
}

message GetOrganizationBySubdomainRequest {
  string subdomain = 1;
}

message GetOrganizationBySubdomainResponse {
  Organization organization = 1;
}

message Organization {
  string id = 1;
  string company_name = 2;
  string subdomain = 3;
  string zitadel_org_id = 4;
  string zitadel_project_id = 5;
  string zitadel_app_client_id = 6;
}
```

**Already implemented** in:
- Backend: `backend/internal/organization/organization.go`
- Frontend: `frontend/packages/apis/src/organization.ts`

---

## Client-Side Data Structures (TypeScript)

### Auth Tokens (localStorage)
```typescript
// lib/auth/types.ts
export interface AuthTokens {
  access_token: string;      // JWT for API authorization (1hr expiry)
  refresh_token: string;     // Long-lived token for renewal (30d expiry)
  id_token: string;          // JWT with user identity claims
  token_type: 'Bearer';
  expires_at: number;        // Unix timestamp
  scope: string;             // OAuth scopes granted
}
```

**Storage Location**: `localStorage.setItem('auth_tokens', JSON.stringify(tokens))`  
**Security**: Acceptable for MVP, migrate to HttpOnly cookies for production

### User Profile (from ID token claims)
```typescript
// lib/auth/types.ts
export interface UserProfile {
  sub: string;                           // User ID from Zitadel
  email: string;
  email_verified: boolean;
  name: string;
  given_name?: string;
  family_name?: string;
  picture?: string;                      // Avatar URL
  locale?: string;
  'urn:zitadel:iam:org:id': string;     // Organization ID (tenant context)
  'urn:zitadel:iam:org:domain:primary': string; // Organization subdomain
  'urn:zitadel:iam:user:resourceowner:id'?: string;
  'urn:zitadel:iam:user:resourceowner:name'?: string;
  roles?: string[];                      // Project roles (if configured)
}
```

**Source**: Extracted from `id_token` JWT claims after validation  
**Usage**: Display user info, tenant context for API calls

### OAuth State (sessionStorage - temporary)
```typescript
// Internal to @zitadel/react, managed by oidc-client-ts
interface OAuthState {
  state: string;              // Random string for CSRF protection
  code_verifier: string;      // PKCE code verifier (SHA256 hashed)
  redirect_uri: string;       // Original redirect URI
  nonce?: string;             // Optional nonce for ID token validation
  created: number;            // Timestamp
}
```

**Storage Location**: `sessionStorage` (automatic, managed by library)  
**Lifetime**: Cleared after successful callback

---

## Data Flow

### 1. Sign-In Flow (Frontend → Zitadel → Frontend)
```
┌─────────────┐
│   Browser   │
│  (signin)   │
└──────┬──────┘
       │ 1. User clicks "Login with Zitadel"
       │    organizationId = "uuid-123"
       │
       ▼
┌─────────────────────────────────────────────────┐
│ LoginForm Component                             │
│ - buildOidcScope(organizationId)                │
│ - login({ scope: "... org:id:uuid-123" })      │
└──────┬──────────────────────────────────────────┘
       │ 2. Redirect to Zitadel
       │    /oauth/v2/authorize?
       │      client_id=...
       │      redirect_uri=.../callback
       │      scope=openid+profile+email+urn:zitadel:iam:org:id:uuid-123
       │      response_type=code
       │      code_challenge=... (PKCE)
       │      state=random-string
       │
       ▼
┌─────────────┐
│  Zitadel    │
│  (Auth UI)  │
└──────┬──────┘
       │ 3. User authenticates
       │
       ▼
┌─────────────┐
│   Browser   │
│  /callback  │
└──────┬──────┘
       │ 4. Redirect back with code
       │    /callback?code=xyz&state=random-string
       │
       ▼
┌─────────────────────────────────────────────────┐
│ Callback Page Component                         │
│ - Validate state (CSRF check)                   │
│ - Exchange code for tokens (POST /oauth/v2/token)│
│   {                                              │
│     grant_type: authorization_code,              │
│     code: xyz,                                   │
│     redirect_uri: ...,                           │
│     code_verifier: ... (PKCE)                    │
│   }                                              │
└──────┬──────────────────────────────────────────┘
       │ 5. Zitadel returns tokens
       │    {
       │      access_token: "jwt-access",
       │      refresh_token: "opaque-refresh",
       │      id_token: "jwt-id",
       │      expires_in: 3600
       │    }
       │
       ▼
┌─────────────────────────────────────────────────┐
│ Token Storage                                   │
│ localStorage.setItem('auth_tokens', tokens)     │
└──────┬──────────────────────────────────────────┘
       │ 6. Redirect to dashboard
       │
       ▼
┌─────────────┐
│  Dashboard  │
│  (protected)│
└─────────────┘
```

### 2. API Call with Token (Frontend → Backend)
```
┌─────────────┐
│  Dashboard  │
│   Component │
└──────┬──────┘
       │ 1. Call API (e.g., getUsers())
       │
       ▼
┌─────────────────────────────────────────────────┐
│ RPC Client (packages/apis)                      │
│ - Load tokens from localStorage                 │
│ - Add header: Authorization: Bearer jwt-access  │
└──────┬──────────────────────────────────────────┘
       │ 2. RPC call with token
       │
       ▼
┌─────────────────────────────────────────────────┐
│ Backend RPC Interceptor                         │
│ - Extract JWT from Authorization header         │
│ - Verify signature (Zitadel public key)         │
│ - Extract claims:                                │
│   {                                              │
│     sub: user-id,                                │
│     urn:zitadel:iam:org:id: org-uuid            │
│   }                                              │
│ - Add to context: ctx.organizationId = org-uuid │
└──────┬──────────────────────────────────────────┘
       │ 3. Execute RPC with tenant context
       │
       ▼
┌─────────────────────────────────────────────────┐
│ Service Layer                                   │
│ - Query with WHERE organization_id = ctx.orgId  │
│   (multi-tenant isolation)                      │
└──────┬──────────────────────────────────────────┘
       │ 4. Return response
       │
       ▼
┌─────────────┐
│  Dashboard  │
│   (render)  │
└─────────────┘
```

### 3. Token Refresh (Automatic)
```
┌─────────────────────────────────────────────────┐
│ @zitadel/react (background timer)               │
│ - Monitor access_token expiry                   │
│ - 60s before expiry, trigger refresh            │
└──────┬──────────────────────────────────────────┘
       │ 1. POST /oauth/v2/token
       │    {
       │      grant_type: refresh_token,
       │      refresh_token: "opaque-refresh"
       │    }
       │
       ▼
┌─────────────┐
│  Zitadel    │
└──────┬──────┘
       │ 2. Return new tokens
       │    {
       │      access_token: "new-jwt-access",
       │      refresh_token: "new-opaque-refresh",
       │      expires_in: 3600
       │    }
       │
       ▼
┌─────────────────────────────────────────────────┐
│ Token Storage (update)                          │
│ localStorage.setItem('auth_tokens', newTokens)  │
└──────┬──────────────────────────────────────────┘
       │ 3. Continue using app
       │    (transparent to user)
       │
       ▼
┌─────────────┐
│ App continues│
└─────────────┘
```

---

## Security Considerations

### Multi-Tenant Isolation
- ✅ **Organization ID in token**: `urn:zitadel:iam:org:id` claim
- ✅ **Backend validation**: Every API call validates organization context
- ✅ **Query filtering**: All DB queries include `WHERE organization_id = ?`
- ✅ **No schema changes needed**: Isolation enforced at query level

### Token Security
- ✅ **PKCE**: Prevents authorization code interception
- ✅ **State parameter**: CSRF protection on callback
- ✅ **Short-lived access tokens**: 1 hour expiration
- ✅ **Refresh token rotation**: New refresh token on each renewal
- ⚠️ **localStorage**: Acceptable for MVP, migrate to HttpOnly cookies for production

### Authorization
- Backend enforces authorization (not just authentication)
- Token claims include organization ID for tenant context
- Future: Role-based access control (RBAC) via project roles in token

---

## Testing Data Requirements

### Test Organization Setup
Create test organization in Zitadel:
```json
{
  "name": "Test Organization",
  "domain": "test-org",
  "users": [
    {
      "email": "test@test-org.com",
      "firstName": "Test",
      "lastName": "User",
      "roles": ["admin"]
    }
  ]
}
```

### Test Data in Tech Office
Insert test organization in database:
```sql
INSERT INTO organization.organization (
  id,
  company_name,
  subdomain,
  zitadel_org_id
) VALUES (
  '123e4567-e89b-12d3-a456-426614174000',
  'Test Organization',
  'test-org',
  'zitadel-org-id-from-zitadel-console'
);
```

### Mock Tokens for Tests
```typescript
// For component tests
const mockTokens: AuthTokens = {
  access_token: 'mock-jwt-access',
  refresh_token: 'mock-refresh',
  id_token: 'mock-jwt-id',
  token_type: 'Bearer',
  expires_at: Date.now() + 3600000,
  scope: 'openid profile email',
};

const mockUser: UserProfile = {
  sub: 'test-user-id',
  email: 'test@test-org.com',
  email_verified: true,
  name: 'Test User',
  'urn:zitadel:iam:org:id': '123e4567-e89b-12d3-a456-426614174000',
  'urn:zitadel:iam:org:domain:primary': 'test-org',
};
```

---

## Summary

**Database Changes**: ❌ None required  
**Schema Changes**: ❌ None required  
**Existing Data Used**: ✅ `organization.organization` table  
**Client-Side Storage**: ✅ localStorage for auth tokens  
**Data Flow**: ✅ Frontend → Zitadel → Frontend → Backend (with JWT)  
**Multi-Tenant**: ✅ Enforced via organization ID in token claims  

**Ready for Phase 1 Contracts**: Design OAuth flow, error handling, component architecture

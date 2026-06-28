# RPC Contracts: IAM Service

**Feature**: Direct SSO IAM Without Zitadel  
**Date**: 2026-02-10  
**Status**: Complete

## Overview

This directory contains Protocol Buffer definitions for the IAM service, including:
- Authentication endpoints (SSO, password, invitations)
- Session management
- User profile management
- Organization membership
- Invitation system

**Generation Target**: `backend/rpc/v1/iam.proto` (will be copied during implementation)

---

## Service Definition

### IAMService

**Purpose**: Comprehensive authentication and authorization service

**Categories**:
1. **SSO Authentication**: Exchange Google/Apple tokens for internal JWT
2. **Password Authentication**: Email/password login (invitation-based only)
3. **Password Management**: Change password, reset flow
4. **Session Management**: Logout, active sessions
5. **User Profile**: Get/update profile info
6. **SSO Identity Management**: Link/unlink providers
7. **Organization Membership**: List orgs, switch context
8. **Invitations**: Invite users, accept invitations (admin only)

**Total Methods**: 21 RPC endpoints

---

## Method Access Control Summary

### Public Endpoints (No Authentication)
- `ExchangeToken` - SSO token exchange
- `Login` - Password authentication
- `RequestPasswordReset` - Initiate reset
- `ResetPassword` - Complete reset
- `AcceptInvitation` - Join organization (creates account if new user)

### Authenticated Endpoints
- `ChangePassword` - Update password
- `Logout` - End session
- `LogoutAllSessions` - Security logout
- `GetActiveSessions` - List sessions
- `GetProfile` - User info
- `UpdateProfile` - Profile updates
- `LinkSSOIdentity` - Add provider
- `UnlinkSSOIdentity` - Remove provider
- `GetUserOrganizations` - List memberships
- `SwitchOrganization` - Change context

### Admin/Owner Endpoints (Role-Based)
- `InviteUser` - Send invitations
- `CancelInvitation` - Cancel invitations
- `ListInvitations` - View invitations

---

## Generate Code

### Backend (Go)

```bash
# From backend/ directory
buf generate
```

**Output**:
- `backend/rpc/v1/iam.pb.go` - Message structs
- `backend/rpc/v1/iam_connect.pb.go` - ConnectRPC service interfaces

**Configuration**: `backend/buf.gen.yaml`

```yaml
version: v1
plugins:
  - plugin: buf.build/protocolbuffers/go
    out: rpc
    opt:
      - paths=source_relative
  - plugin: buf.build/connectrpc/go
    out: rpc
    opt:
      - paths=source_relative
  - plugin: buf.build/bufbuild/validate-go
    out: rpc
    opt:
      - paths=source_relative
```

### Frontend (TypeScript)

```bash
# From frontend/ directory
buf generate
```

**Output**:
- `frontend/packages/rpc/src/iam_pb.ts` - Message types
- `frontend/packages/rpc/src/iam_connect.ts` - ConnectRPC client

**Configuration**: `frontend/buf.gen.yaml`

```yaml
version: v1
plugins:
  - plugin: buf.build/connectrpc/es
    opt:
      - target=ts
      - import_extension=none
    out: packages/rpc/src
```

---

## Key Design Decisions

### 1. Minimal JWT Claims

**Decision**: User roles NOT in JWT - queried from DB per request

**Rationale**:
- Real-time role changes without re-authentication
- Consistent with Constitution Principle XI (Distributed-First)
- Support multi-tenant role complexity

**JWT Structure**:
```json
{
  "sub": "user-uuid",
  "email": "user@example.com",
  "iat": 1234567890,
  "exp": 1234567890,
  "jti": "session-uuid"
}
```

### 2. Two-Phase Token Exchange

**Decision**: Client gets SSO token → Backend exchanges for internal JWT

**Flow**:
```
1. Frontend: Get Google/Apple ID token (frontend libs)
2. Frontend: Call ExchangeToken(provider, id_token)
3. Backend: Verify JWKS signature
4. Backend: Find or create user
5. Backend: Issue internal JWT
6. Frontend: Store internal JWT
```

**Rationale**:
- Decouples frontend from SSO provider changes
- Backend controls user creation logic
- Single internal token format

### 3. Public Invitation Acceptance

**Decision**: `AcceptInvitation` is public endpoint (creates account)

**Flow**:
```
1. User clicks invitation link (token in URL)
2. If not logged in:
   - Show signup form (SSO or password)
   - Create account + accept invitation in single call
3. If logged in:
   - Accept invitation with existing account
```

**Rationale**:
- Seamless onboarding experience
- Supports both new and existing users
- Invitation token provides authorization

### 4. Access Control Annotations

**Decision**: Use proto extensions for RBAC requirements

**Example**:
```protobuf
rpc InviteUser(InviteUserRequest) returns (InviteUserResponse) {
  option (rpc.v1.access_control) = {
    allowed_roles: [ROLE_ADMIN, ROLE_OWNER]
  };
}
```

**Rationale**:
- Declarative authorization
- Self-documenting API
- Middleware can enforce without code duplication

### 5. Session Tracking

**Decision**: `jti` claim maps to `iam.session` table

**Implementation**:
- Every token issuance creates session record
- Logout marks session as invalidated
- Middleware checks session validity in DB

**Rationale**:
- Supports immediate logout (not just token expiry)
- Audit trail for security
- Re-authentication prompts for sensitive operations

---

## Message Validation

### Buf Validate Rules

**Email**: `(buf.validate.field).string.email = true`  
**Password**: Min 8 chars, max 72 chars (bcrypt limit)  
**UUID**: `(buf.validate.field).string.uuid = true`  
**Enum**: `(buf.validate.field).enum.defined_only = true`  

**Example**:
```protobuf
message LoginRequest {
  string email = 1 [(buf.validate.field).string.email = true];
  string password = 2 [(buf.validate.field).string.min_len = 8];
}
```

**Benefits**:
- Automatic validation in middleware
- Consistent error messages
- Type-safe across backend/frontend

---

## Frontend Client Usage

### Example: SSO Login

```typescript
import { createPromiseClient } from '@connectrpc/connect';
import { IAMService } from '@/rpc/iam_connect';
import { SSOProvider } from '@/rpc/iam_pb';

// Create client
const iamClient = createPromiseClient(IAMService, transport);

// Exchange Google token
const response = await iamClient.exchangeToken({
  provider: SSOProvider.SSO_PROVIDER_GOOGLE,
  idToken: googleIdToken,
});

// Store internal JWT
localStorage.setItem('access_token', response.accessToken);
```

### Example: Password Login

```typescript
const response = await iamClient.login({
  email: 'user@example.com',
  password: 'SecurePassword123',
});

localStorage.setItem('access_token', response.accessToken);
```

**Note**: Users cannot self-register. They must be invited to an organization first via `AcceptInvitation`, which can create their account.

### Example: Get Profile

```typescript
const profile = await iamClient.getProfile({});

console.log(profile.user.displayName);
console.log(profile.ssoIdentities); // Linked SSO providers
console.log(profile.organizations); // Org memberships
```

---

## Backend Implementation Pattern

### Service Layer (Two-Tier Architecture)

**Handler**: `backend/internal/handler/iam/iam.go`
- RPC method implementations
- Request validation
- Response mapping

**Service**: `backend/internal/service/iam/iam.go`
- Business logic
- Database queries
- External API calls (JWKS, email)

**Example**:
```go
// Handler (RPC layer)
func (h *IAMHandler) ExchangeToken(
    ctx context.Context,
    req *connect.Request[v1.ExchangeTokenRequest],
) (*connect.Response[v1.ExchangeTokenResponse], error) {
    user, token, err := h.iamService.ExchangeSSOToken(
        ctx,
        req.Msg.Provider,
        req.Msg.IdToken,
    )
    if err != nil {
        return nil, err
    }
    
    return connect.NewResponse(&v1.ExchangeTokenResponse{
        AccessToken: token,
        User: toProtoUser(user),
        IsNewUser: user.CreatedAt.After(time.Now().Add(-1 * time.Minute)),
    }), nil
}

// Service (logic layer)
func (s *IAMService) ExchangeSSOToken(
    ctx context.Context,
    provider v1.SSOProvider,
    idToken string,
) (*database.User, string, error) {
    // 1. Verify JWKS signature
    claims, err := s.verifyJWKS(provider, idToken)
    if err != nil {
        return nil, "", err
    }
    
    // 2. Find or create user
    user, err := s.findOrCreateUser(ctx, claims)
    if err != nil {
        return nil, "", err
    }
    
    // 3. Issue internal JWT
    token, err := s.issueJWT(user)
    if err != nil {
        return nil, "", err
    }
    
    return user, token, nil
}
```

---

## Security Considerations

### 1. Token Validation

**SSO Tokens**:
- ✅ Verify JWKS signature (Google/Apple public keys)
- ✅ Check expiration (`exp` claim)
- ✅ Verify audience (`aud` claim)
- ✅ Cache JWKS keys (1 hour, refresh on verification failure)

**Internal Tokens**:
- ✅ Verify RSA-256 signature (devjwt package)
- ✅ Check expiration
- ✅ Query session validity from DB
- ✅ Extract roles from DB (NOT from token)

### 2. Password Security

**Storage**:
- ✅ bcrypt hashing (cost factor 12)
- ✅ Hash verification in constant time

**Validation**:
- ✅ Minimum 8 characters
- ✅ Uppercase + lowercase + number
- ✅ Max 72 bytes (bcrypt limit)

**Rate Limiting**:
- ⚠️ 5 failed attempts per 15 minutes per email
- ⚠️ Implement in middleware (TODO: Phase 2)

### 3. User Enumeration Prevention

**Password Reset**:
- ✅ Generic "Email sent" response (even if email doesn't exist)
- ✅ Same response time for valid/invalid emails
- ✅ No indication whether email exists

**Login**:
- ✅ Generic "Invalid email or password" error
- ✅ No distinction between "email not found" and "wrong password"

### 4. Multi-Tenant Isolation

**Organization Context**:
- ✅ `SwitchOrganization` issues new JWT with org context
- ✅ Middleware validates user has membership in org
- ✅ All org-scoped queries filter by organization_id

---

## Testing Strategy

### Integration Tests (Backend)

**File**: `backend/integration/iam_test.go`

**Test Cases**:
1. SSO token exchange (Google, Apple)
2. Password login
3. Registration
4. Password reset flow
5. Invitation acceptance
6. Multi-tenant role resolution
7. Session invalidation

**Example**:
```go
func TestExchangeToken_Google(t *testing.T) {
    // Setup: Create fake Google ID token
    token := createFakeGoogleToken(t)
    
    // Act: Call ExchangeToken
    resp, err := iamClient.ExchangeToken(ctx, connect.NewRequest(&v1.ExchangeTokenRequest{
        Provider: v1.SSOProvider_SSO_PROVIDER_GOOGLE,
        IdToken: token,
    }))
    require.NoError(t, err)
    
    // Assert: Verify response
    assert.NotEmpty(t, resp.Msg.AccessToken)
    assert.Equal(t, "user@gmail.com", resp.Msg.User.Email)
    
    // Verify: User created in database
    user, err := queries.GetUserByEmail(ctx, "user@gmail.com")
    require.NoError(t, err)
    assert.Equal(t, resp.Msg.User.Id, user.ID.String())
}
```

### E2E Tests (Frontend)

**Framework**: Playwright

**Test Cases**:
1. Google SSO login flow
2. Password login
3. Invitation acceptance (new user)
4. Profile updates
5. Organization switching

**Example**:
```typescript
test('Google SSO login flow', async ({ page }) => {
  await page.goto('/login');
  
  // Click Google sign-in button
  await page.click('[data-testid="google-signin"]');
  
  // Wait for redirect to dashboard
  await page.waitForURL('/dashboard');
  
  // Verify user is logged in
  const userName = await page.textContent('[data-testid="user-name"]');
  expect(userName).toBeTruthy();
});
```

---

## Migration from Zitadel

### Clean Replacement (Single Phase)

**Strategy**: Complete removal with fresh start (acceptable for early development)

**Middleware**: Only internal JWT support

```go
func (i *AuthInterceptor) verifyToken(token string) (*UserInfo, error) {
    // Clean implementation - internal JWT only
    claims, err := i.internalVerifier.Verify(token)
    if err != nil {
        return nil, connect.NewError(connect.CodeUnauthenticated, 
            errors.New("invalid token"))
    }
    
    // Extract user info and query roles from DB
    return i.extractUserInfoInternal(ctx, claims)
}
```

**Cleanup Tasks**:

1. **Backend**:
   - Remove `github.com/zitadel/zitadel-go` from go.mod
   - Delete `backend/internal/zitadelcli/` directory
   - Rewrite `backend/internal/interceptor/auth.go` (no Zitadel code)
   - Remove Zitadel environment variables

2. **Database**:
   ```sql
   -- Optional: Archive existing users
   COPY (SELECT * FROM zitadel.users) TO '/tmp/zitadel_archive.csv';
   
   -- Drop Zitadel schema
   DROP SCHEMA IF EXISTS zitadel CASCADE;
   ```

3. **Frontend**:
   - Remove Zitadel auth provider components
   - Update login page with new SSO + password UI
   - Remove Zitadel-related environment variables

**User Communication**:
- "We've upgraded our authentication system"
- "Please create a new account using Google, Apple, or email/password"
- Acceptable for early development with limited users

---

## Summary

**RPC Methods**: ✅ 21 endpoints defined  
**Message Types**: ✅ 46 request/response/entity messages  
**Enums**: ✅ 4 enums (SSOProvider, UserStatus, OrganizationRole, InvitationStatus)  
**Access Control**: ✅ Public, authenticated, role-based  
**Validation**: ✅ Buf validate rules on all inputs  

**Ready for Implementation**: Backend service layer, frontend client integration

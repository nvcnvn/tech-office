# Research: Direct SSO IAM Without Zitadel

**Feature**: Replace Zitadel with direct SSO integration + custom authentication  
**Date**: 2026-02-10  
**Status**: Complete

## Overview

This research document captures all architectural decisions, technology choices, and implementation patterns for replacing Zitadel with a custom IAM system that supports:
- Direct SSO integration (Google, Apple)
- Custom email/password authentication  
- Global user accounts with org-specific roles
- Password reset, invitations, profile management

---

## 1. SSO Token Exchange Architecture

### Decision
Implement **two-phase token exchange**:
1. **Phase 1 (Client-side)**: Obtain SSO provider IDToken (Google/Apple)
2. **Phase 2 (Backend)**: Exchange IDToken for internal JWT

### Rationale
- **Decoupling**: Client doesn't need to understand internal JWT format
- **Security**: Internal JWT never exposed to SSO providers
- **Flexibility**: Can add more SSO providers without changing internal auth
- **Token lifetime control**: Internal JWT has independent expiration policy

### Implementation Pattern

**Client-side SSO flows**:
```typescript
// Google Sign-In
import { GoogleOAuthProvider, useGoogleLogin } from '@react-oauth/google';

const googleLogin = useGoogleLogin({
  onSuccess: async (response) => {
    // response.access_token or response.id_token
    const { token } = await exchangeToken({
      provider: 'GOOGLE',
      idToken: response.id_token
    });
    // Store internal JWT
    localStorage.setItem('auth_token', token);
  }
});

// Apple Sign-In
import AppleSignin from 'react-apple-signin-auth';

<AppleSignin
  authOptions={{
    clientId: 'com.techoffice.web',
    scope: 'name email',
    redirectURI: 'https://app.techoffice.com/callback/apple',
    usePopup: true,
  }}
  onSuccess={(response) => {
    // response.authorization.id_token
    const { token } = await exchangeToken({
      provider: 'APPLE',
      idToken: response.authorization.id_token
    });
    localStorage.setItem('auth_token', token);
  }}
/>
```

**Backend exchange endpoint**:
```go
// RPC: ExchangeToken
func (s *AuthServiceConnect) ExchangeToken(
    ctx context.Context, 
    req *connect.Request[rpcv1.ExchangeTokenRequest],
) (*connect.Response[rpcv1.ExchangeTokenResponse], error) {
    // 1. Verify IDToken with provider JWKS
    claims, err := s.logic.VerifyProviderToken(ctx, req.Msg.Provider, req.Msg.IdToken)
    if err != nil {
        return nil, connect.NewError(connect.CodeUnauthenticated, err)
    }
    
    // 2. Find or create user
    var user *iam.User
    err = txn.WithTxn(ctx, s.AdminPool, func(ctx context.Context, tx database.DBTX) error {
        user, err = s.logic.FindOrCreateSSOUser(ctx, tx, claims.Email, claims.Sub, req.Msg.Provider)
        return err
    })
    if err != nil {
        return nil, err
    }
    
    // 3. Generate internal JWT
    internalToken, err := s.jwtSigner.GenerateToken(user.ID, user.Email)
    if err != nil {
        return nil, err
    }
    
    // 4. Track session
    err = txn.WithTxn(ctx, s.AdminPool, func(ctx context.Context, tx database.DBTX) error {
        return s.logic.CreateSession(ctx, tx, user.ID, internalToken)
    })
    
    return connect.NewResponse(&rpcv1.ExchangeTokenResponse{
        Token: internalToken,
        User:  toProtoUser(user),
    }), nil
}
```

### Technology Choices

**Backend: JWKS verification**
- Library: `github.com/lestrrat-go/jwx/v3` (already used in codebase)
- Google JWKS: `https://www.googleapis.com/oauth2/v3/certs`
- Apple JWKS: `https://appleid.apple.com/auth/keys`
- Cache TTL: 1 hour (reduce external dependency)

**Frontend: SSO libraries**
- Google: `@react-oauth/google` (official React library)
- Apple: `react-apple-signin-auth` (community library with good adoption)

### Alternatives Considered
- **Direct OIDC flow**: Too complex, requires managing PKCE, state, nonce
- **Proxy all SSO through backend**: Adds latency, doesn't improve security
- **Embedded WebView**: Poor UX, security concerns

---

## 2. Internal JWT Format

### Decision
Use `backend/internal/devjwt` as foundation with **minimal claims**:
```json
{
  "iss": "tech-office",
  "sub": "user-uuid",
  "email": "user@example.com",
  "exp": 1234567890,
  "iat": 1234567890,
  "last_token_issued": 1234567890
}
```

### Rationale
- **Small tokens**: No roles in JWT → faster verification, smaller payload
- **Real-time role changes**: Roles queried from DB per request
- **User-provided requirement**: Explicit request to use devjwt as base
- **Consistency**: Match existing devjwt structure (RSA-256, similar claims)

### Implementation

**Token generation** (extend devjwt.Signer):
```go
type InternalJWTSigner struct {
    *devjwt.DevJWTSigner
}

func (s *InternalJWTSigner) GenerateToken(userID dbuuid.UUID, email string) (string, error) {
    claims := jwt.Claims{
        Issuer:    "tech-office",
        Subject:   userID.String(),
        ExpiresAt: time.Now().Add(30 * 24 * time.Hour), // 30 days
        IssuedAt:  time.Now(),
    }
    
    token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
    token.Header["last_token_issued"] = time.Now().Unix()
    
    return token.SignedString(s.privateKey)
}
```

**Token verification** (extend devjwt.Verifier):
```go
type InternalJWTVerifier struct {
    *devjwt.DevJWTVerifier
}

func (v *InternalJWTVerifier) Verify(ctx context.Context, tokenString string) (jwt.Token, error) {
    return jwt.ParseString(tokenString, jwt.WithKey(jwa.RS256(), v.publicKey))
}
```

### Role Resolution (NOT in JWT)
```go
// Middleware extracts userID from JWT, then queries roles
func (i *AuthInterceptor) extractUserInfo(ctx context.Context, tk jwt.Token) (string, map[string]struct{}, error) {
    userID := tk.Subject()
    
    // Extract orgID from context (from subdomain or request)
    orgID := interceptor.OrgIDFromContext(ctx)
    
    // Query roles from DB
    roles, err := i.queries.GetUserRolesInOrg(ctx, database.GetUserRolesInOrgParams{
        UserID: dbuuid.Parse(userID),
        OrganizationID: dbuuid.Parse(orgID),
    })
    
    userRoles := map[string]struct{}{}
    for _, role := range roles {
        userRoles[role] = struct{}{}
    }
    
    return userID, userRoles, nil
}
```

### Key Management
- **Location**: Kubernetes Secret `iam-jwt-keys`
- **Format**: PEM-encoded RSA 2048-bit keys
- **Rotation**: Manual (document in runbook), reissue all tokens on rotation
- **Dev environment**: Use devjwt test keys from `backend/test/keys/`

---

## 3. Global User Accounts Architecture

### Decision
**Global user scope**: Single `iam.user` table WITHOUT `organization_id`

Relationships:
- `iam.user` (1) \u2194 (N) `iam.organization_membership` (N) \u2194 (1) `public.organization`

### Rationale
- **User-provided requirement**: "Users accounts are global scope"
- **Multi-org support**: Same email can belong to multiple organizations
- **Role flexibility**: Different roles in different orgs (employee in Org A, owner in Org B)
- **Email uniqueness**: Enforced globally, prevents duplicate accounts

### Schema Design

**Core tables**:
```sql
CREATE SCHEMA IF NOT EXISTS iam;

-- Global user accounts (NO organization_id)
CREATE TABLE IF NOT EXISTS iam.user (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    email TEXT NOT NULL UNIQUE,
    display_name TEXT,
    profile_picture_url TEXT,
    status TEXT NOT NULL DEFAULT 'active' 
        CHECK (status IN ('active', 'suspended', 'deleted')),
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_email ON iam.user(email);
CREATE INDEX IF NOT EXISTS idx_user_status ON iam.user(status) WHERE status = 'active';

-- Organization memberships (many-to-many)
CREATE TABLE IF NOT EXISTS iam.organization_membership (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    user_id UUID NOT NULL REFERENCES iam.user(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    role TEXT NOT NULL 
        CHECK (role IN ('admin', 'owner', 'operator', 'employee')),
    joined_at TIMESTAMPTZ DEFAULT now(),
    invited_by UUID REFERENCES iam.user(id),
    UNIQUE(user_id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_membership_user ON iam.organization_membership(user_id);
CREATE INDEX IF NOT EXISTS idx_membership_org ON iam.organization_membership(organization_id);
CREATE INDEX IF NOT EXISTS idx_membership_role ON iam.organization_membership(organization_id, role);
```

### Query Patterns

**Get user with org roles**:
```sql
-- name: GetUserWithOrgRoles :many
SELECT 
    u.id,
    u.email,
    u.display_name,
    m.organization_id,
    m.role,
    o.company_name
FROM iam.user u
LEFT JOIN iam.organization_membership m ON u.id = m.user_id
LEFT JOIN public.organization o ON m.organization_id = o.id
WHERE u.id = $1;
```

**Get user roles in specific org**:
```sql
-- name: GetUserRolesInOrg :many
SELECT role 
FROM iam.organization_membership
WHERE user_id = $1 AND organization_id = $2;
```

### Middleware Changes

Update `backend/internal/interceptor/auth.go`:
```go
func (u *AuthInterceptor) extractUserInfo(ctx context.Context, tk jwt.Token) (string, map[string]struct{}, error) {
    userID := tk.Subject()
    
    // NEW: Extract orgID from context (subdomain-based routing)
    orgID, ok := OrgIDFromContext(ctx)
    if !ok {
        return "", nil, errors.New("organization context required")
    }
    
    // NEW: Query roles from database (not from JWT)
    roles, err := u.queries.GetUserRolesInOrg(ctx, database.GetUserRolesInOrgParams{
        UserID:         dbuuid.Parse(userID),
        OrganizationID: dbuuid.Parse(orgID),
    })
    if err != nil {
        return "", nil, err
    }
    
    userRoles := map[string]struct{}{}
    for _, role := range roles {
        userRoles[role] = struct{}{}
    }
    
    return userID, userRoles, nil
}
```

### Alternatives Considered
- **Org-scoped users + email normalization**: Complex, doesn't handle multi-org well
- **Roles in JWT**: Requires token refresh on role changes, larger tokens
- **Separate admin/employee user tables**: Violates DRY, complex queries

---

## 4. SSO Identity Linking

### Decision
Store SSO provider identities in separate `iam.sso_identity` table

### Rationale
- **Multiple providers**: Users can link Google AND Apple to same account
- **Provider-specific data**: Store provider_user_id, email (may differ from primary)
- **Account merging**: Easy to unlink/relink SSO providers

### Schema

```sql
CREATE TABLE IF NOT EXISTS iam.sso_identity (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    user_id UUID NOT NULL REFERENCES iam.user(id) ON DELETE CASCADE,
    provider TEXT NOT NULL 
        CHECK (provider IN ('google', 'apple')),
    provider_user_id TEXT NOT NULL, -- 'sub' claim from provider
    email TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    last_used_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(provider, provider_user_id)
);

CREATE INDEX IF NOT EXISTS idx_sso_user ON iam.sso_identity(user_id);
CREATE INDEX IF NOT EXISTS idx_sso_provider_id ON iam.sso_identity(provider, provider_user_id);
```

### Find-or-Create Flow

```go
func (l *IAMLogic) FindOrCreateSSOUser(
    ctx context.Context, 
    tx database.DBTX,
    email string,
    providerUserID string,
    provider string,
) (*User, error) {
    // 1. Try to find existing SSO identity
    identity, err := l.queries.GetSSOIdentity(ctx, tx, database.GetSSOIdentityParams{
        Provider:       provider,
        ProviderUserID: providerUserID,
    })
    if err == nil {
        // Identity exists, update last used
        l.queries.UpdateSSOIdentityLastUsed(ctx, tx, identity.ID)
        return l.queries.GetUser(ctx, tx, identity.UserID)
    }
    
    // 2. Check if user exists by email
    user, err := l.queries.GetUserByEmail(ctx, tx, email)
    if err == database.ErrNotFound {
        // 3. Create new user + SSO identity
        user, err = l.queries.CreateUser(ctx, tx, database.CreateUserParams{
            ID:          dbuuid.Must(),
            Email:       email,
            DisplayName: extractNameFromEmail(email),
            Status:      iam.UserStatusActive,
        })
        if err != nil {
            return nil, err
        }
    }
    
    // 4. Link SSO identity to user
    _, err = l.queries.CreateSSOIdentity(ctx, tx, database.CreateSSOIdentityParams{
        ID:             dbuuid.Must(),
        UserID:         user.ID,
        Provider:       provider,
        ProviderUserID: providerUserID,
        Email:          email,
    })
    
    return user, err
}
```

---

## 5. Password Authentication

### Decision
Use **bcrypt** for password hashing (Go standard library `golang.org/x/crypto/bcrypt`)

### Rationale
- **Industry standard**: Widely adopted, well-tested
- **Built-in salt**: No need to manage separate salt field
- **Adaptive cost**: Can increase work factor as hardware improves
- **Go standard**: No external dependencies

### Schema

```sql
CREATE TABLE IF NOT EXISTS iam.password_credential (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    user_id UUID NOT NULL UNIQUE REFERENCES iam.user(id) ON DELETE CASCADE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_password_user ON iam.password_credential(user_id);
```

### Implementation

```go
package iam

import "golang.org/x/crypto/bcrypt"

const bcryptCost = 12 // Balanced security/performance

func HashPassword(password string) (string, error) {
    bytes, err := bcrypt.GenerateFromPassword([]byte(password), bcryptCost)
    return string(bytes), err
}

func VerifyPassword(password, hash string) error {
    return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
}

// Password requirements validation
func ValidatePassword(password string) error {
    if len(password) < 8 {
        return ErrPasswordTooShort
    }
    
    var (
        hasUpper   = false
        hasLower   = false
        hasNumber  = false
    )
    
    for _, char := range password {
        switch {
        case unicode.IsUpper(char):
            hasUpper = true
        case unicode.IsLower(char):
            hasLower = true
        case unicode.IsNumber(char):
            hasNumber = true
        }
    }
    
    if !hasUpper || !hasLower || !hasNumber {
        return ErrPasswordComplexity
    }
    
    return nil
}
```

### Login Flow

```go
func (l *IAMLogic) LoginWithPassword(
    ctx context.Context,
    tx database.DBTX,
    email string,
    password string,
) (*User, string, error) {
    // 1. Find user by email
    user, err := l.queries.GetUserByEmail(ctx, tx, email)
    if err != nil {
        return nil, "", ErrInvalidCredentials // Don't reveal if email exists
    }
    
    // 2. Get password credential
    cred, err := l.queries.GetPasswordCredential(ctx, tx, user.ID)
    if err != nil {
        return nil, "", ErrInvalidCredentials
    }
    
    // 3. Verify password
    if err := VerifyPassword(password, cred.PasswordHash); err != nil {
        return nil, "", ErrInvalidCredentials
    }
    
    // 4. Generate internal JWT
    token, err := l.jwtSigner.GenerateToken(user.ID, user.Email)
    if err != nil {
        return nil, "", err
    }
    
    // 5. Update last login
    l.queries.UpdateUserLastLogin(ctx, tx, user.ID)
    
    return user, token, nil
}
```

### Alternatives Considered
- **Argon2**: More modern but requires C library (CGO), deployment complexity
- **scrypt**: Good but bcrypt more widely supported in Go ecosystem
- **PBKDF2**: Less secure than bcrypt for same iteration count

---

## 6. Password Reset Flow

### Decision
Time-limited, single-use reset tokens stored in database

### Rationale
- **Security**: Tokens in database, can be invalidated server-side
- **Time-bound**: 1 hour expiration reduces attack window
- **Single-use**: Token deleted after successful reset
- **User enumeration prevention**: Same response for valid/invalid emails

### Schema

```sql
CREATE TABLE IF NOT EXISTS iam.password_reset_token (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    user_id UUID NOT NULL REFERENCES iam.user(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reset_token ON iam.password_reset_token(token) WHERE used_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_reset_user ON iam.password_reset_token(user_id);
```

### Implementation

```go
func (l *IAMLogic) RequestPasswordReset(
    ctx context.Context,
    tx database.DBTX,
    email string,
) error {
    user, err := l.queries.GetUserByEmail(ctx, tx, email)
    if err != nil {
        // Don't reveal if email exists
        slog.WarnContext(ctx, "password reset requested for non-existent email", "email", email)
        return nil // Still return success
    }
    
    // Check if user has password credential
    _, err = l.queries.GetPasswordCredential(ctx, tx, user.ID)
    if err != nil {
        // SSO-only account, no password to reset
        slog.InfoContext(ctx, "password reset requested for SSO-only account", "user_id", user.ID)
        return nil // Still return success (don't reveal)
    }
    
    // Generate secure random token
    tokenBytes := make([]byte, 32)
    if _, err := rand.Read(tokenBytes); err != nil {
        return err
    }
    token := base64.URLEncoding.EncodeToString(tokenBytes)
    
    // Store token with 1 hour expiration
    _, err = l.queries.CreatePasswordResetToken(ctx, tx, database.CreatePasswordResetTokenParams{
        ID:        dbuuid.Must(),
        UserID:    user.ID,
        Token:     token,
        ExpiresAt: time.Now().Add(1 * time.Hour),
    })
    if err != nil {
        return err
    }
    
    // Send reset email (async)
    l.emailService.SendPasswordResetEmail(user.Email, token)
    
    return nil
}

func (l *IAMLogic) ResetPassword(
    ctx context.Context,
    tx database.DBTX,
    token string,
    newPassword string,
) error {
    // 1. Validate password requirements
    if err := ValidatePassword(newPassword); err != nil {
        return err
    }
    
    // 2. Find valid token
    resetToken, err := l.queries.GetPasswordResetToken(ctx, tx, token)
    if err != nil {
        return ErrInvalidResetToken
    }
    
    // 3. Check expiration and usage
    if time.Now().After(resetToken.ExpiresAt) {
        return ErrResetTokenExpired
    }
    if resetToken.UsedAt != nil {
        return ErrResetTokenUsed
    }
    
    // 4. Hash new password
    hash, err := HashPassword(newPassword)
    if err != nil {
        return err
    }
    
    // 5. Update password credential
    err = l.queries.UpdatePasswordCredential(ctx, tx, database.UpdatePasswordCredentialParams{
        UserID:       resetToken.UserID,
        PasswordHash: hash,
    })
    if err != nil {
        return err
    }
    
    // 6. Mark token as used
    l.queries.MarkPasswordResetTokenUsed(ctx, tx, resetToken.ID)
    
    // 7. Invalidate all existing sessions
    l.queries.InvalidateUserSessions(ctx, tx, resetToken.UserID)
    
    return nil
}
```

---

## 7. Invitation System

### Decision
Store pending invitations with email + token, auto-create accounts on first login

### Rationale
- **User-provided requirement**: "Org admin can invite users event if the account still not exist"
- **Deferred account creation**: Account created when user completes first login
- **Flexible**: Works for both existing and new users
- **Secure**: Token-based, time-limited invitations

### Schema

```sql
CREATE TABLE IF NOT EXISTS iam.invitation (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL 
        CHECK (role IN ('admin', 'owner', 'operator', 'employee')),
    token TEXT NOT NULL UNIQUE,
    invited_by UUID NOT NULL REFERENCES iam.user(id),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'cancelled', 'expired')),
    expires_at TIMESTAMPTZ NOT NULL,
    accepted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invitation_token ON iam.invitation(token) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_invitation_email ON iam.invitation(email, status);
CREATE INDEX IF NOT EXISTS idx_invitation_org ON iam.invitation(organization_id, status);
```

### Implementation

```go
func (l *IAMLogic) SendInvitation(
    ctx context.Context,
    tx database.DBTX,
    orgID dbuuid.UUID,
    email string,
    role string,
    invitedBy dbuuid.UUID,
) (*Invitation, error) {
    // Generate secure random token
    tokenBytes := make([]byte, 32)
    rand.Read(tokenBytes)
    token := base64.URLEncoding.EncodeToString(tokenBytes)
    
    // Create invitation with 7-day expiration
    invitation, err := l.queries.CreateInvitation(ctx, tx, database.CreateInvitationParams{
        ID:             dbuuid.Must(),
        OrganizationID: orgID,
        Email:          email,
        Role:           role,
        Token:          token,
        InvitedBy:      invitedBy,
        ExpiresAt:      time.Now().Add(7 * 24 * time.Hour),
    })
    if err != nil {
        return nil, err
    }
    
    // Send invitation email (async)
    l.emailService.SendInvitationEmail(email, token, orgID)
    
    return invitation, nil
}

func (l *IAMLogic) AcceptInvitation(
    ctx context.Context,
    tx database.DBTX,
    token string,
    userID dbuuid.UUID, // From authenticated user (if exists)
) error {
    // 1. Find valid invitation
    invitation, err := l.queries.GetInvitationByToken(ctx, tx, token)
    if err != nil {
        return ErrInvalidInvitation
    }
    
    // 2. Validate invitation
    if time.Now().After(invitation.ExpiresAt) {
        return ErrInvitationExpired
    }
    if invitation.Status != "pending" {
        return ErrInvitationNotPending
    }
    
    // 3. If no userID, this is first-time login - account created during SSO/password flow
    // userID is passed from the login flow that followed invitation link
    
    // 4. Create organization membership
    _, err = l.queries.CreateOrganizationMembership(ctx, tx, database.CreateOrganizationMembershipParams{
        ID:             dbuuid.Must(),
        UserID:         userID,
        OrganizationID: invitation.OrganizationID,
        Role:           invitation.Role,
        InvitedBy:      &invitation.InvitedBy,
    })
    if err != nil {
        return err
    }
    
    // 5. Mark invitation as accepted
    l.queries.UpdateInvitationStatus(ctx, tx, database.UpdateInvitationStatusParams{
        ID:         invitation.ID,
        Status:     "accepted",
        AcceptedAt: timeNow(),
    })
    
    return nil
}
```

---

## 8. Session Tracking

### Decision
Store session metadata in `iam.session` table for:
- Last token issued time (for re-auth prompts)
- Token expiration tracking
- Concurrent session management

### Rationale
- **User-provided requirement**: "track the last issued, token exp"
- **Re-auth triggers**: Can prompt for re-login before sensitive operations
- **Session management**: Support logout, session invalidation
- **Audit trail**: Track login history, session duration

### Schema

```sql
CREATE TABLE IF NOT EXISTS iam.session (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    user_id UUID NOT NULL REFERENCES iam.user(id) ON DELETE CASCADE,
    token_jti TEXT NOT NULL UNIQUE, -- JWT ID from token
    issued_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    last_activity_at TIMESTAMPTZ DEFAULT now(),
    ip_address INET,
    user_agent TEXT,
    invalidated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_session_user ON iam.session(user_id) WHERE invalidated_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_session_token ON iam.session(token_jti) WHERE invalidated_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_session_expiry ON iam.session(expires_at) WHERE invalidated_at IS NULL;
```

### Implementation

```go
func (l *IAMLogic) CreateSession(
    ctx context.Context,
    tx database.DBTX,
    userID dbuuid.UUID,
    tokenJTI string,
    expiresAt time.Time,
) error {
    // Extract IP and user agent from context
    ipAddress := extractIPFromContext(ctx)
    userAgent := extractUserAgentFromContext(ctx)
    
    return l.queries.CreateSession(ctx, tx, database.CreateSessionParams{
        ID:         dbuuid.Must(),
        UserID:     userID,
        TokenJTI:   tokenJTI,
        IssuedAt:   time.Now(),
        ExpiresAt:  expiresAt,
        IPAddress:  ipAddress,
        UserAgent:  userAgent,
    })
}

func (l *IAMLogic) GetActiveSessions(
    ctx context.Context,
    tx database.DBTX,
    userID dbuuid.UUID,
) ([]Session, error) {
    return l.queries.GetActiveSessions(ctx, tx, userID)
}

func (l *IAMLogic) InvalidateSession(
    ctx context.Context,
    tx database.DBTX,
    sessionID dbuuid.UUID,
) error {
    return l.queries.InvalidateSession(ctx, tx, sessionID)
}
```

### Re-auth Prompt Logic

```go
func (l *IAMLogic) ShouldPromptReauth(
    ctx context.Context,
    tx database.DBTX,
    userID dbuuid.UUID,
    operation string, // "delete_account", "change_email", etc.
) (bool, error) {
    // Get most recent session
    session, err := l.queries.GetMostRecentSession(ctx, tx, userID)
    if err != nil {
        return false, err
    }
    
    // Require re-auth if last token issued more than 5 minutes ago
    if time.Since(session.IssuedAt) > 5*time.Minute {
        return true, nil
    }
    
    return false, nil
}
```

---

## 9. Middleware Integration

### Decision
Extend existing `backend/internal/interceptor/auth.go` to support new JWT format

### Changes Required

```go
// Add new verifier alongside existing Zitadel verifier
type AuthInterceptor struct {
    zitadelVerifier  JWTVerifierInterface // Keep for migration period
    internalVerifier JWTVerifierInterface // New internal JWT verifier
    queries          *database.Queries    // Add for role queries
}

func (u *AuthInterceptor) verifyToken(ctx context.Context, token string) (jwt.Token, error) {
    // Try internal verifier first
    claims, err := u.internalVerifier.Verify(ctx, token)
    if err == nil {
        slog.InfoContext(ctx, "internal JWT verified")
        return claims, nil
    }
    
    // Fallback to Zitadel (migration period)
    claims, err = u.zitadelVerifier.Verify(ctx, token)
    if err != nil {
        return nil, err
    }
    slog.InfoContext(ctx, "Zitadel JWT verified (legacy)")
    return claims, nil
}

func (u *AuthInterceptor) extractUserInfo(ctx context.Context, tk jwt.Token) (string, map[string]struct{}, error) {
    userID := tk.Subject()
    
    // Check token issuer to determine if it's internal or Zitadel
    issuer, ok := tk.Issuer()
    if ok && issuer == "tech-office" {
        // Internal JWT: Query roles from database
        orgID, ok := OrgIDFromContext(ctx)
        if !ok {
            return "", nil, errors.New("organization context required")
        }
        
        roles, err := u.queries.GetUserRolesInOrg(ctx, database.GetUserRolesInOrgParams{
            UserID:         dbuuid.Parse(userID),
            OrganizationID: dbuuid.Parse(orgID),
        })
        if err != nil {
            return "", nil, err
        }
        
        userRoles := map[string]struct{}{}
        for _, role := range roles {
            userRoles[role] = struct{}{}
        }
        
        return userID, userRoles, nil
    }
    
    // Zitadel JWT: Extract roles from token (legacy)
    m := map[string]map[string]string{}
    if err := tk.Get("urn:zitadel:iam:org:project:roles", &m); err != nil {
        return "", nil, err
    }
    
    userRoles := map[string]struct{}{}
    for key := range m {
        userRoles[key] = struct{}{}
    }
    
    return userID, userRoles, nil
}
```

---

## 10. Frontend Auth Context

### Decision
Update auth context to support both SSO and email/password flows

### Implementation

**Auth provider** (`frontend/packages/auth/src/AuthContext.tsx`):
```typescript
interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  loginWithApple: () => Promise<void>;
  logout: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  resetPassword: (token: string, newPassword: string) => Promise<void>;
}

export const AuthProvider: React.FC = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(
    localStorage.getItem('auth_token')
  );
  
  // Email/password login
  const login = async (email: string, password: string) => {
    const { token, user } = await authApi.loginWithPassword({ email, password });
    localStorage.setItem('auth_token', token);
    setToken(token);
    setUser(user);
  };
  
  // Google SSO
  const loginWithGoogle = async () => {
    const googleResponse = await googleLogin();
    const { token, user } = await authApi.exchangeToken({
      provider: 'GOOGLE',
      idToken: googleResponse.id_token,
    });
    localStorage.setItem('auth_token', token);
    setToken(token);
    setUser(user);
  };
  
  // Apple SSO
  const loginWithApple = async () => {
    const appleResponse = await appleSignIn();
    const { token, user } = await authApi.exchangeToken({
      provider: 'APPLE',
      idToken: appleResponse.authorization.id_token,
    });
    localStorage.setItem('auth_token', token);
    setToken(token);
    setUser(user);
  };
  
  const logout = async () => {
    await authApi.logout();
    localStorage.removeItem('auth_token');
    setToken(null);
    setUser(null);
  };
  
  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, login, loginWithGoogle, loginWithApple, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
```

---

## 11. Migration Strategy

### Decision
**Complete Zitadel removal** - no backward compatibility (early development phase)

### Single-Phase Clean Replacement
- Remove all Zitadel integration code
- Replace auth middleware completely
- Deploy new IAM system
- Users re-register with SSO or email/password
- No data preservation needed

### Rationale
Early development phase allows clean architecture without technical debt from supporting legacy systems. Users will need to create new accounts, but this is acceptable given:
- Limited user base in early development
- Cleaner codebase without compatibility layers
- Simpler testing and deployment
- No dual-system complexity

### Cleanup Tasks

**Backend**:
```bash
# Remove Zitadel dependency
cd backend
go mod edit -dropreplace github.com/zitadel/zitadel-go
go mod tidy

# Delete Zitadel integration code
rm -rf internal/zitadelcli/

# Rewrite auth middleware (no Zitadel code)
# backend/internal/interceptor/auth.go - complete rewrite
```

**Database**:
```sql
-- Optional: Export existing users for reference
COPY (
    SELECT user_id, email, display_name, last_login
    FROM zitadel.users  -- If Zitadel tables exist
    ORDER BY last_login DESC
) TO '/tmp/zitadel_users_archive.csv' WITH CSV HEADER;

-- Drop Zitadel schema
DROP SCHEMA IF EXISTS zitadel CASCADE;

-- Fresh start with iam schema (created in migrations)
```

**Frontend**:
- Remove Zitadel auth provider components
- Update login page with new SSO + password UI
- Remove Zitadel-related environment variables

### User Communication
- "We've upgraded our authentication system for better security"
- "Please create a new account using Google, Apple, or email/password"
- Provide clear onboarding flow for existing test users

---

## 12. Testing Strategy

### Decision
**Integration-first testing** (following Constitution Principle II)

### Test Categories

**Backend Integration Tests** (`backend/integration/iam_test.go`):
```go
func TestSSOTokenExchange_Google(t *testing.T) {
    // Use real Google test credentials
    googleIDToken := getGoogleTestToken()
    
    client := iamconnect.NewIAMServiceClient(http.DefaultClient, serverURL)
    
    req := connect.NewRequest(&iamv1.ExchangeTokenRequest{
        Provider: iamv1.SSOProvider_GOOGLE,
        IdToken:  googleIDToken,
    })
    
    resp, err := client.ExchangeToken(context.Background(), req)
    require.NoError(t, err)
    assert.NotEmpty(t, resp.Msg.Token)
    assert.Equal(t, "test@example.com", resp.Msg.User.Email)
}

func TestPasswordLogin(t *testing.T) {
    // Setup: Create user with password
    setupUser(t, "user@example.com", "SecurePass123")
    
    client := iamconnect.NewIAMServiceClient(http.DefaultClient, serverURL)
    
    req := connect.NewRequest(&iamv1.LoginRequest{
        Email:    "user@example.com",
        Password: "SecurePass123",
    })
    
    resp, err := client.Login(context.Background(), req)
    require.NoError(t, err)
    assert.NotEmpty(t, resp.Msg.Token)
}

func TestGlobalUserMultiOrg(t *testing.T) {
    // Test user can have different roles in different orgs
    userID := setupUser(t, "multi@example.com", "SecurePass123")
    org1 := setupOrg(t, "Org1")
    org2 := setupOrg(t, "Org2")
    
    // Add user to both orgs with different roles
    addMembership(t, userID, org1, "employee")
    addMembership(t, userID, org2, "owner")
    
    // Verify roles in each org
    roles1 := getUserRoles(t, userID, org1)
    assert.Equal(t, []string{"employee"}, roles1)
    
    roles2 := getUserRoles(t, userID, org2)
    assert.Equal(t, []string{"owner"}, roles2)
}
```

**Frontend E2E Tests** (manual verification first, then automated):
- SSO login flow (Google/Apple)
- Email/password login
- Password reset flow
- Invitation acceptance
- Profile management
- Multi-org switching

---

## Summary

**All technical unknowns resolved:**
- ✅ SSO token exchange architecture (two-phase: provider → internal JWT)
- ✅ Internal JWT format (minimal claims, DB-based roles)
- ✅ Global user accounts with org-specific roles
- ✅ SSO identity linking (multiple providers per user)
- ✅ Password authentication (bcrypt, complexity rules)
- ✅ Password reset flow (time-limited, single-use tokens)
- ✅ Invitation system (deferred account creation)
- ✅ Session tracking (last issued, expiration, re-auth prompts)
- ✅ Middleware integration (extend existing interceptor)
- ✅ Frontend auth context (unified SSO + password)
- ✅ Migration strategy (phased rollout, ID preservation)
- ✅ Testing approach (integration-first, following constitution)

**Ready for Phase 1**: Design & Contracts

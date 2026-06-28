# Quickstart & Test Scenarios

**Feature**: Direct SSO IAM Without Zitadel  
**Date**: 2026-02-10  
**Status**: Complete

## Overview

This document provides:
1. **Quick setup guide** for local development
2. **Test scenarios** derived from spec.md user stories
3. **Integration test patterns** for backend RPC methods
4. **E2E test scenarios** for frontend flows
5. **Multi-tenant isolation tests**

---

## Local Development Setup

### Prerequisites

```bash
# Required tools
- Go 1.25+
- Node.js 22+
- PostgreSQL 18+
- Docker & Docker Compose
```

### 1. Database Setup

```bash
# Start PostgreSQL with Docker
cd backend
docker compose up -d postgres

# Run migrations
cd k8s/base/database/migrations
./migrate.sh up

# Verify schema
docker compose exec postgres psql -U postgres -d tech_office_db \
  -c "\dt iam.*"

# Expected output:
# iam.user
# iam.sso_identity
# iam.password_credential
# iam.organization_membership
# iam.invitation
# iam.password_reset_token
# iam.session
```

### 2. Backend Setup

```bash
# Generate proto code
cd backend
buf generate

# Generate sqlc code
sqlc generate

# Build backend
go build -o tech-office-backend ./cmd

# Run backend
./tech-office-backend
# Server listening on :50051 (gRPC)
# Server listening on :8080 (HTTP/ConnectRPC)
```

### 3. Frontend Setup

```bash
cd frontend

# Install dependencies
pnpm install

# Generate RPC client
buf generate

# Run development server
pnpm dev
# Frontend: http://localhost:13000
```

### 4. Test Data Setup

```sql
-- Create test organization
INSERT INTO public.organization (id, company_name, subdomain, status)
VALUES (
    '01234567-89ab-cdef-0123-456789abcdef',
    'ACME Corp',
    'acme',
    'active'
);

-- Create test user
INSERT INTO iam.user (id, email, display_name, status)
VALUES (
    'a1234567-89ab-cdef-0123-456789abcdef',
    'admin@acme.com',
    'Admin User',
    'active'
);

-- Create admin membership
INSERT INTO iam.organization_membership (
    id, user_id, organization_id, role
) VALUES (
    'b1234567-89ab-cdef-0123-456789abcdef',
    'a1234567-89ab-cdef-0123-456789abcdef',
    '01234567-89ab-cdef-0123-456789abcdef',
    'admin'
);

-- Create password credential (password: "Test123456")
INSERT INTO iam.password_credential (id, user_id, password_hash)
VALUES (
    'c1234567-89ab-cdef-0123-456789abcdef',
    'a1234567-89ab-cdef-0123-456789abcdef',
    '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5GyYIpjmjYhKy'
);
```

---

## Test Scenarios (From Spec User Stories)

### US-001: SSO Login - New User

**User Story**: As a new user, I want to sign in with Google so I can access the platform

**Test Scenario**:
```typescript
// Frontend E2E Test
test('US-001: Google SSO login creates new account', async ({ page }) => {
  // 1. Navigate to login page
  await page.goto('/login');
  
  // 2. Click Google sign-in
  await page.click('[data-testid="google-signin"]');
  
  // 3. Complete Google OAuth (mock in test)
  // Mock: Returns fake Google ID token
  
  // 4. Verify redirect to dashboard
  await page.waitForURL('/dashboard');
  
  // 5. Verify profile created
  const userName = await page.textContent('[data-testid="user-name"]');
  expect(userName).toBe('John Doe');
  
  // 6. Verify token stored
  const token = await page.evaluate(() => localStorage.getItem('access_token'));
  expect(token).toBeTruthy();
});
```

**Backend Integration Test**:
```go
func TestUS001_GoogleSSONewUser(t *testing.T) {
    ctx := context.Background()
    
    // 1. Create fake Google ID token
    googleToken := createFakeGoogleToken(t, map[string]interface{}{
        "sub": "google_user_123",
        "email": "john@gmail.com",
        "name": "John Doe",
        "picture": "https://example.com/photo.jpg",
    })
    
    // 2. Call ExchangeToken
    resp, err := iamClient.ExchangeToken(ctx, connect.NewRequest(&v1.ExchangeTokenRequest{
        Provider: v1.SSOProvider_SSO_PROVIDER_GOOGLE,
        IdToken: googleToken,
    }))
    require.NoError(t, err)
    
    // 3. Verify response
    assert.True(t, resp.Msg.IsNewUser)
    assert.Equal(t, "john@gmail.com", resp.Msg.User.Email)
    assert.Equal(t, "John Doe", resp.Msg.User.DisplayName)
    assert.NotEmpty(t, resp.Msg.AccessToken)
    
    // 4. Verify user created in database
    user, err := queries.GetUserByEmail(ctx, "john@gmail.com")
    require.NoError(t, err)
    assert.Equal(t, v1.UserStatus_USER_STATUS_ACTIVE.String(), user.Status)
    
    // 5. Verify SSO identity linked
    identities, err := queries.GetUserSSOIdentities(ctx, user.ID)
    require.NoError(t, err)
    assert.Len(t, identities, 1)
    assert.Equal(t, "google", identities[0].Provider)
    assert.Equal(t, "google_user_123", identities[0].ProviderUserID)
}
```

**Acceptance Criteria**:
- ✅ User record created in `iam.user`
- ✅ SSO identity linked in `iam.sso_identity`
- ✅ Internal JWT issued with 30-day expiry
- ✅ Session tracked in `iam.session`
- ✅ Frontend redirects to dashboard

---

### US-002: Password Login - Existing User

**User Story**: As an existing user, I want to log in with email/password

**Test Scenario**:
```typescript
test('US-002: Password login with valid credentials', async ({ page }) => {
  await page.goto('/login');
  
  // Fill login form
  await page.fill('[name="email"]', 'admin@acme.com');
  await page.fill('[name="password"]', 'Test123456');
  await page.click('[data-testid="login-button"]');
  
  // Verify redirect
  await page.waitForURL('/dashboard');
  
  // Verify user info displayed
  const email = await page.textContent('[data-testid="user-email"]');
  expect(email).toBe('admin@acme.com');
});
```

**Backend Integration Test**:
```go
func TestUS002_PasswordLogin(t *testing.T) {
    ctx := context.Background()
    
    // Setup: User with password credential exists
    user := createTestUser(t, "test@example.com", "Test User")
    createPasswordCredential(t, user.ID, "SecurePass123")
    
    // Act: Call Login
    resp, err := iamClient.Login(ctx, connect.NewRequest(&v1.LoginRequest{
        Email: "test@example.com",
        Password: "SecurePass123",
    }))
    require.NoError(t, err)
    
    // Assert: Verify response
    assert.Equal(t, user.Email, resp.Msg.User.Email)
    assert.NotEmpty(t, resp.Msg.AccessToken)
    
    // Verify: Session created
    sessions, err := queries.GetActiveSessions(ctx, user.ID)
    require.NoError(t, err)
    assert.GreaterOrEqual(t, len(sessions), 1)
    
    // Verify: Last login updated
    updatedUser, err := queries.GetUserByID(ctx, user.ID)
    require.NoError(t, err)
    assert.WithinDuration(t, time.Now(), updatedUser.LastLoginAt, 5*time.Second)
}
```

**Negative Test**:
```go
func TestUS002_PasswordLogin_InvalidPassword(t *testing.T) {
    ctx := context.Background()
    
    // Setup: User exists
    user := createTestUser(t, "test@example.com", "Test User")
    createPasswordCredential(t, user.ID, "CorrectPassword")
    
    // Act: Try wrong password
    _, err := iamClient.Login(ctx, connect.NewRequest(&v1.LoginRequest{
        Email: "test@example.com",
        Password: "WrongPassword",
    }))
    
    // Assert: Generic error (no user enumeration)
    require.Error(t, err)
    assert.Contains(t, err.Error(), "Invalid email or password")
}
```

**Acceptance Criteria**:
- ✅ Correct password validates successfully
- ✅ Wrong password returns generic error
- ✅ Non-existent email returns same error (no enumeration)
- ✅ Last login timestamp updated
- ✅ Session created in database

---

### US-003: Password Reset Flow

**User Story**: As a user, I want to reset my password if I forget it

**Frontend E2E Test**:
```typescript
test('US-003: Complete password reset flow', async ({ page, context }) => {
  // Step 1: Request password reset
  await page.goto('/forgot-password');
  await page.fill('[name="email"]', 'user@example.com');
  await page.click('[data-testid="reset-button"]');
  
  // Verify success message (generic, no email enumeration)
  await expect(page.locator('[data-testid="success-message"]')).toContainText(
    'If that email exists, you will receive a reset link'
  );
  
  // Step 2: Capture reset email (mock email service)
  const resetToken = await captureEmailToken(context, 'user@example.com');
  
  // Step 3: Open reset link
  await page.goto(`/reset-password?token=${resetToken}`);
  
  // Step 4: Enter new password
  await page.fill('[name="new_password"]', 'NewSecure123');
  await page.fill('[name="confirm_password"]', 'NewSecure123');
  await page.click('[data-testid="reset-submit"]');
  
  // Step 5: Verify redirect to login
  await page.waitForURL('/login');
  
  // Step 6: Login with new password
  await page.fill('[name="email"]', 'user@example.com');
  await page.fill('[name="password"]', 'NewSecure123');
  await page.click('[data-testid="login-button"]');
  
  // Verify successful login
  await page.waitForURL('/dashboard');
});
```

**Backend Integration Test**:
```go
func TestUS003_PasswordResetFlow(t *testing.T) {
    ctx := context.Background()
    
    // Setup: User with password
    user := createTestUser(t, "reset@example.com", "Reset User")
    createPasswordCredential(t, user.ID, "OldPassword123")
    
    // Step 1: Request password reset
    resetResp, err := iamClient.RequestPasswordReset(ctx, connect.NewRequest(&v1.RequestPasswordResetRequest{
        Email: "reset@example.com",
    }))
    require.NoError(t, err)
    assert.Equal(t, "If that email exists, you will receive a reset link", resetResp.Msg.Message)
    
    // Verify: Reset token created
    tokens, err := queries.GetPasswordResetTokensByUser(ctx, user.ID)
    require.NoError(t, err)
    assert.Len(t, tokens, 1)
    resetToken := tokens[0]
    
    // Step 2: Reset password with token
    _, err = iamClient.ResetPassword(ctx, connect.NewRequest(&v1.ResetPasswordRequest{
        Token: resetToken.Token,
        NewPassword: "NewSecure999",
    }))
    require.NoError(t, err)
    
    // Verify: Token marked as used
    usedToken, err := queries.GetPasswordResetToken(ctx, resetToken.Token)
    require.NoError(t, err)
    assert.NotNil(t, usedToken.UsedAt)
    
    // Verify: Can login with new password
    loginResp, err := iamClient.Login(ctx, connect.NewRequest(&v1.LoginRequest{
        Email: "reset@example.com",
        Password: "NewSecure999",
    }))
    require.NoError(t, err)
    assert.NotEmpty(t, loginResp.Msg.AccessToken)
    
    // Verify: Cannot use old password
    _, err = iamClient.Login(ctx, connect.NewRequest(&v1.LoginRequest{
        Email: "reset@example.com",
        Password: "OldPassword123",
    }))
    assert.Error(t, err)
}
```

**Acceptance Criteria**:
- ✅ Generic response for valid/invalid emails (no enumeration)
- ✅ Reset token expires after 1 hour
- ✅ Reset token is single-use
- ✅ Old password no longer valid
- ✅ All sessions invalidated after reset

---

### US-004: Organization Invitation - Admin Flow

**User Story**: As an organization admin, I want to invite users to join my organization

**Backend Integration Test**:
```go
func TestUS004_InviteUser_AdminFlow(t *testing.T) {
    ctx := context.Background()
    
    // Setup: Organization with admin
    org := createTestOrg(t, "Test Company", "testco")
    admin := createTestUser(t, "admin@testco.com", "Admin")
    createMembership(t, admin.ID, org.ID, "admin")
    
    // Setup: Admin JWT context
    ctx = withAuthContext(ctx, admin.ID, org.ID, []string{"admin"})
    
    // Act: Invite new user
    inviteResp, err := iamClient.InviteUser(ctx, connect.NewRequest(&v1.InviteUserRequest{
        OrganizationId: org.ID.String(),
        Email: "newuser@example.com",
        Role: v1.OrganizationRole_ORGANIZATION_ROLE_EMPLOYEE,
    }))
    require.NoError(t, err)
    
    // Verify: Invitation created
    assert.Equal(t, "newuser@example.com", inviteResp.Msg.Invitation.Email)
    assert.Equal(t, v1.OrganizationRole_ORGANIZATION_ROLE_EMPLOYEE, inviteResp.Msg.Invitation.Role)
    assert.NotEmpty(t, inviteResp.Msg.Invitation.Token)
    
    // Verify: Expires in 7 days
    expiresAt := inviteResp.Msg.Invitation.ExpiresAt.AsTime()
    expectedExpiry := time.Now().Add(7 * 24 * time.Hour)
    assert.WithinDuration(t, expectedExpiry, expiresAt, 1*time.Minute)
    
    // Verify: Email sent (check email service mock)
    sentEmails := captureEmailsSent(t)
    assert.Len(t, sentEmails, 1)
    assert.Equal(t, "newuser@example.com", sentEmails[0].To)
    assert.Contains(t, sentEmails[0].Body, inviteResp.Msg.Invitation.Token)
}
```

**Negative Test - Non-Admin Cannot Invite**:
```go
func TestUS004_InviteUser_EmployeeCannotInvite(t *testing.T) {
    ctx := context.Background()
    
    // Setup: Organization with employee (NOT admin)
    org := createTestOrg(t, "Test Company", "testco")
    employee := createTestUser(t, "employee@testco.com", "Employee")
    createMembership(t, employee.ID, org.ID, "employee")
    
    // Setup: Employee JWT context
    ctx = withAuthContext(ctx, employee.ID, org.ID, []string{"employee"})
    
    // Act: Try to invite user
    _, err := iamClient.InviteUser(ctx, connect.NewRequest(&v1.InviteUserRequest{
        OrganizationId: org.ID.String(),
        Email: "newuser@example.com",
        Role: v1.OrganizationRole_ORGANIZATION_ROLE_EMPLOYEE,
    }))
    
    // Assert: Permission denied
    require.Error(t, err)
    assert.Contains(t, err.Error(), "permission denied")
}
```

**Acceptance Criteria**:
- ✅ Only admin/owner can invite users
- ✅ Invitation email sent with secure token
- ✅ Invitation expires after 7 days
- ✅ Employee role cannot invite others

---

### US-005: Accept Invitation - New User

**User Story**: As an invited user, I want to accept the invitation and create my account

**Frontend E2E Test**:
```typescript
test('US-005: Accept invitation with new account', async ({ page }) => {
  // Setup: Invitation token in URL
  const inviteToken = 'test-invite-token-12345';
  
  // Navigate to invitation page
  await page.goto(`/accept-invitation?token=${inviteToken}`);
  
  // Verify invitation details displayed
  await expect(page.locator('[data-testid="org-name"]')).toContainText('ACME Corp');
  await expect(page.locator('[data-testid="invited-role"]')).toContainText('Employee');
  
  // Choose SSO signup (Google)
  await page.click('[data-testid="google-signup"]');
  
  // Mock Google OAuth
  // ... Google authentication flow ...
  
  // Verify redirect to organization dashboard
  await page.waitForURL('/dashboard');
  
  // Verify organization context active
  const orgName = await page.textContent('[data-testid="active-org"]');
  expect(orgName).toBe('ACME Corp');
});
```

**Backend Integration Test**:
```go
func TestUS005_AcceptInvitation_NewUser(t *testing.T) {
    ctx := context.Background()
    
    // Setup: Organization and invitation
    org := createTestOrg(t, "ACME Corp", "acme")
    admin := createTestUser(t, "admin@acme.com", "Admin")
    createMembership(t, admin.ID, org.ID, "admin")
    
    invitation := createInvitation(t, org.ID, "newuser@example.com", "employee", admin.ID)
    
    // Act: Accept invitation with Google SSO
    googleToken := createFakeGoogleToken(t, map[string]interface{}{
        "sub": "google_456",
        "email": "newuser@example.com",
        "name": "New User",
    })
    
    resp, err := iamClient.AcceptInvitation(ctx, connect.NewRequest(&v1.AcceptInvitationRequest{
        Token: invitation.Token,
        DisplayName: proto.String("New User"),
        SsoProvider: proto.Enum(v1.SSOProvider_SSO_PROVIDER_GOOGLE),
        SsoIdToken: proto.String(googleToken),
    }))
    require.NoError(t, err)
    
    // Verify: User created
    assert.Equal(t, "newuser@example.com", resp.Msg.User.Email)
    assert.NotEmpty(t, resp.Msg.AccessToken)
    
    // Verify: Organization membership created
    assert.Equal(t, org.ID.String(), resp.Msg.Membership.OrganizationId)
    assert.Equal(t, v1.OrganizationRole_ORGANIZATION_ROLE_EMPLOYEE, resp.Msg.Membership.Role)
    
    // Verify: Invitation marked as accepted
    updatedInvite, err := queries.GetInvitationByToken(ctx, invitation.Token)
    require.NoError(t, err)
    assert.Equal(t, "accepted", updatedInvite.Status)
    assert.NotNil(t, updatedInvite.AcceptedAt)
}
```

**Acceptance Criteria**:
- ✅ New user account created on acceptance
- ✅ Organization membership created with invited role
- ✅ Invitation marked as accepted
- ✅ User automatically logged in
- ✅ Organization context set in JWT

---

### US-006: Switch Organization Context

**User Story**: As a user in multiple organizations, I want to switch between them

**Frontend E2E Test**:
```typescript
test('US-006: Switch between organizations', async ({ page }) => {
  // Setup: User logged in with 2 orgs
  await loginAsUser(page, 'multiorg@example.com', 'Test123456');
  
  // Verify current org (default: first joined)
  await expect(page.locator('[data-testid="active-org"]')).toContainText('ACME Corp');
  
  // Open organization switcher
  await page.click('[data-testid="org-switcher"]');
  
  // Verify list shows all orgs
  const orgItems = await page.locator('[data-testid^="org-item-"]').count();
  expect(orgItems).toBe(2);
  
  // Click different organization
  await page.click('[data-testid="org-item-beta-inc"]');
  
  // Verify context switched
  await expect(page.locator('[data-testid="active-org"]')).toContainText('Beta Inc');
  
  // Verify token refreshed (new organization_id in JWT)
  const token = await page.evaluate(() => localStorage.getItem('access_token'));
  const decodedToken = decodeJWT(token);
  expect(decodedToken.organization_id).toBe('beta-inc-org-id');
});
```

**Backend Integration Test**:
```go
func TestUS006_SwitchOrganization(t *testing.T) {
    ctx := context.Background()
    
    // Setup: User member of 2 organizations
    user := createTestUser(t, "multiorg@example.com", "Multi Org User")
    org1 := createTestOrg(t, "ACME Corp", "acme")
    org2 := createTestOrg(t, "Beta Inc", "beta")
    createMembership(t, user.ID, org1.ID, "admin")
    createMembership(t, user.ID, org2.ID, "employee")
    
    // Setup: User authenticated (currently in org1)
    ctx = withAuthContext(ctx, user.ID, org1.ID, []string{"admin"})
    
    // Act: Switch to org2
    resp, err := iamClient.SwitchOrganization(ctx, connect.NewRequest(&v1.SwitchOrganizationRequest{
        OrganizationId: org2.ID.String(),
    }))
    require.NoError(t, err)
    
    // Verify: New token issued
    assert.NotEmpty(t, resp.Msg.AccessToken)
    assert.Equal(t, v1.OrganizationRole_ORGANIZATION_ROLE_EMPLOYEE, resp.Msg.Role)
    
    // Verify: Token contains new organization context
    claims, err := verifyJWT(resp.Msg.AccessToken)
    require.NoError(t, err)
    assert.Equal(t, org2.ID.String(), claims["organization_id"])
    
    // Verify: Old session invalidated, new session created
    sessions, err := queries.GetActiveSessions(ctx, user.ID)
    require.NoError(t, err)
    
    // Most recent session should be for org2
    latestSession := sessions[0]
    assert.WithinDuration(t, time.Now(), latestSession.IssuedAt, 5*time.Second)
}
```

**Negative Test - Cannot Switch to Non-Member Org**:
```go
func TestUS006_SwitchOrganization_NotMember(t *testing.T) {
    ctx := context.Background()
    
    // Setup: User member of org1 only
    user := createTestUser(t, "user@example.com", "User")
    org1 := createTestOrg(t, "ACME Corp", "acme")
    org2 := createTestOrg(t, "Beta Inc", "beta")
    createMembership(t, user.ID, org1.ID, "employee")
    // NOT member of org2
    
    // Setup: User authenticated
    ctx = withAuthContext(ctx, user.ID, org1.ID, []string{"employee"})
    
    // Act: Try to switch to org2
    _, err := iamClient.SwitchOrganization(ctx, connect.NewRequest(&v1.SwitchOrganizationRequest{
        OrganizationId: org2.ID.String(),
    }))
    
    // Assert: Permission denied
    require.Error(t, err)
    assert.Contains(t, err.Error(), "not a member")
}
```

**Acceptance Criteria**:
- ✅ User can switch between member organizations
- ✅ New JWT issued with updated organization_id
- ✅ Role changes according to target organization
- ✅ Cannot switch to non-member organization
- ✅ Session tracking updated

---

## Multi-Tenant Isolation Tests

### Test: User Cannot Access Other Org's Data

```go
func TestMultiTenant_IsolationBetweenOrgs(t *testing.T) {
    ctx := context.Background()
    
    // Setup: 2 organizations
    org1 := createTestOrg(t, "Org 1", "org1")
    org2 := createTestOrg(t, "Org 2", "org2")
    
    // User1 in org1 (admin)
    user1 := createTestUser(t, "user1@org1.com", "User 1")
    createMembership(t, user1.ID, org1.ID, "admin")
    
    // User2 in org2 (admin)
    user2 := createTestUser(t, "user2@org2.com", "User 2")
    createMembership(t, user2.ID, org2.ID, "admin")
    
    // Create invitation in org2
    invitation := createInvitation(t, org2.ID, "newuser@org2.com", "employee", user2.ID)
    
    // User1 authenticated with org1 context
    ctx1 := withAuthContext(ctx, user1.ID, org1.ID, []string{"admin"})
    
    // Test: User1 cannot list org2's invitations
    _, err := iamClient.ListInvitations(ctx1, connect.NewRequest(&v1.ListInvitationsRequest{
        OrganizationId: org2.ID.String(), // Different org!
    }))
    require.Error(t, err)
    assert.Contains(t, err.Error(), "permission denied")
    
    // Test: User1 cannot cancel org2's invitation
    _, err = iamClient.CancelInvitation(ctx1, connect.NewRequest(&v1.CancelInvitationRequest{
        OrganizationId: org2.ID.String(),
        InvitationId: invitation.ID.String(),
    }))
    require.Error(t, err)
    assert.Contains(t, err.Error(), "permission denied")
    
    // Verify: User2 CAN access org2's invitations
    ctx2 := withAuthContext(ctx, user2.ID, org2.ID, []string{"admin"})
    listResp, err := iamClient.ListInvitations(ctx2, connect.NewRequest(&v1.ListInvitationsRequest{
        OrganizationId: org2.ID.String(),
    }))
    require.NoError(t, err)
    assert.Len(t, listResp.Msg.Invitations, 1)
}
```

**Acceptance Criteria**:
- ✅ Users cannot access data from non-member organizations
- ✅ Middleware validates organization membership
- ✅ All org-scoped queries include organization_id filter
- ✅ Cross-org operations return permission denied

---

## Common Test Helpers

### Backend Test Helpers

```go
// database/test/helpers.go

// Create test user
func createTestUser(t *testing.T, email, displayName string) *database.User {
    user, err := queries.CreateUser(ctx, database.CreateUserParams{
        ID: dbuuid.Must(),
        Email: email,
        DisplayName: displayName,
        Status: "active",
    })
    require.NoError(t, err)
    return &user
}

// Create password credential
func createPasswordCredential(t *testing.T, userID dbuuid.UUID, password string) {
    hash, err := bcrypt.GenerateFromPassword([]byte(password), 12)
    require.NoError(t, err)
    
    _, err = queries.CreatePasswordCredential(ctx, database.CreatePasswordCredentialParams{
        ID: dbuuid.Must(),
        UserID: userID,
        PasswordHash: string(hash),
    })
    require.NoError(t, err)
}

// Create organization membership
func createMembership(t *testing.T, userID, orgID dbuuid.UUID, role string) {
    _, err := queries.CreateOrganizationMembership(ctx, database.CreateOrganizationMembershipParams{
        ID: dbuuid.Must(),
        UserID: userID,
        OrganizationID: orgID,
        Role: role,
    })
    require.NoError(t, err)
}

// Create fake Google JWT for testing
func createFakeGoogleToken(t *testing.T, claims map[string]interface{}) string {
    // Use test signing key
    privateKey := loadTestPrivateKey(t)
    
    token := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims(claims))
    signedToken, err := token.SignedString(privateKey)
    require.NoError(t, err)
    
    return signedToken
}

// Add auth context to request
func withAuthContext(ctx context.Context, userID, orgID dbuuid.UUID, roles []string) context.Context {
    // Simulate middleware setting context values
    ctx = context.WithValue(ctx, "user_id", userID.String())
    ctx = context.WithValue(ctx, "organization_id", orgID.String())
    ctx = context.WithValue(ctx, "roles", roles)
    return ctx
}
```

### Frontend Test Helpers

```typescript
// apps/web/tests/helpers.ts

// Login helper
export async function loginAsUser(
  page: Page,
  email: string,
  password: string
) {
  await page.goto('/login');
  await page.fill('[name="email"]', email);
  await page.fill('[name="password"]', password);
  await page.click('[data-testid="login-button"]');
  await page.waitForURL('/dashboard');
}

// Capture email sent (mock email service)
export async function captureEmailToken(
  context: BrowserContext,
  email: string
): Promise<string> {
  // Mock email service captures sent emails
  const emailService = context.route('**/api/email/send', route => {
    const body = route.request().postDataJSON();
    if (body.to === email) {
      // Extract token from email body
      const token = extractTokenFromEmail(body.html);
      return route.fulfill({ json: { token } });
    }
  });
  
  return emailService.token;
}

// Decode JWT for assertions
export function decodeJWT(token: string): any {
  const [, payload] = token.split('.');
  return JSON.parse(atob(payload));
}
```

---

## Running Tests

### Backend Integration Tests

```bash
cd backend

# Run all IAM integration tests
go test -v ./integration/iam_test.go

# Run specific test
go test -v ./integration/iam_test.go -run TestUS001

# Run with coverage
go test -coverprofile=coverage.out ./integration/iam_test.go
go tool cover -html=coverage.out
```

### Frontend E2E Tests

```bash
cd frontend

# Run Playwright tests
pnpm test:e2e

# Run specific suite
pnpm test:e2e tests/iam/login.spec.ts

# Run in UI mode (interactive)
pnpm test:e2e --ui

# Generate test report
pnpm test:e2e --reporter=html
```

---

## Summary

**Test Scenarios**: ✅ 6 core user stories mapped to tests  
**Integration Tests**: ✅ Backend RPC method testing patterns  
**E2E Tests**: ✅ Frontend user flow scenarios  
**Multi-Tenant**: ✅ Isolation verification tests  
**Test Helpers**: ✅ Reusable setup functions  

**Coverage Goals**:
- Backend: >80% code coverage for IAM service
- Frontend: E2E tests for all authentication flows
- Integration: All RPC methods have test cases

**Ready for Implementation**: Test-first development approach, clear acceptance criteria

# Feature Specification: Direct SSO IAM Without Zitadel

**Feature Branch**: `018-direct-sso-iam-without-zitadel`  
**Created**: 2026-02-10  
**Status**: Draft  
**Input**: User description: "direct SSO IAM without Zitadel. I want to remove all zitadel usage and come up with better UX for login and user management. Instead of using Zitadel, we can config SSO direct with Apple and Google. Using Apple / Google jwks to verify. We need to support custom username (using email) and password login. Forget password etc. We need to have profile management. Users accounts are global scope, org admin can invite the users. Org admin can invite the users event if the account still not exist. The account will be create after first login."

## Execution Flow (main)
```
1. Parse user description from Input
   → Feature: Replace Zitadel with direct SSO integration
2. Extract key concepts from description
   → Actors: Users, Org Admins, System
   → Actions: Login (SSO/Email), Invite, Manage Profile, Reset Password
   → Data: Global User Accounts, SSO Tokens, Organization Memberships
   → Constraints: JWKS verification, global user scope, invite-before-signup
3. For each unclear aspect:
   → [RESOLVED] Authentication methods: Apple SSO, Google SSO, Email/Password
   → [RESOLVED] User scope: Global (not tenant-scoped)
   → [RESOLVED] Invitation flow: Admin can invite non-existent users
4. Fill User Scenarios & Testing section
   → Primary flows: SSO login, Email/Password login, Invitation, Password reset
5. Generate Functional Requirements
   → 47 testable requirements identified
6. Identify Key Entities
   → GlobalUser, SSOIdentity, OrganizationMembership, Invitation, PasswordResetToken
7. Run Review Checklist
   → No implementation details included
   → All requirements testable
8. Return: SUCCESS (spec ready for planning)
```

---

## ⚡ Quick Guidelines
- ✅ Focus on WHAT users need and WHY
- ❌ Avoid HOW to implement (no tech stack, APIs, code structure)
- 👥 Written for business stakeholders, not developers

---

## User Scenarios & Testing *(mandatory)*

### Primary User Stories

#### Story 1: New User Login via SSO
A user clicks "Sign in with Google" on the login page, authenticates with their Google account, and is automatically logged into Tech Office. If this is their first login, a global user account is created automatically.

#### Story 2: Existing User Email/Password Login
A user enters their email and password on the login page, clicks "Sign In", and is authenticated and logged into Tech Office.

#### Story 3: Organization Admin Invites New User
An organization admin enters an email address to invite a new user to their organization. The system sends an invitation email even if the user account doesn't exist yet. When the user clicks the invitation link and completes their first login (via SSO or email/password), their account is created and linked to the organization.

#### Story 4: User Resets Forgotten Password
A user clicks "Forgot Password" on the login page, enters their email, receives a password reset link, clicks the link, enters a new password, and can now login with the new password.

#### Story 5: User Manages Profile
A logged-in user navigates to their profile page, updates their display name and profile picture, saves changes, and sees the updated information reflected across the application.

### Acceptance Scenarios

1. **Given** a user has a Google account, **When** they click "Sign in with Google" and approve access, **Then** they are logged into Tech Office with a session token
2. **Given** a user has never logged in before, **When** they complete SSO login, **Then** a global user account is created with their email and basic profile information
3. **Given** a user has an account with email/password, **When** they enter correct credentials and click "Sign In", **Then** they are logged into Tech Office
4. **Given** a user enters incorrect password, **When** they click "Sign In", **Then** they see an error message "Invalid email or password"
5. **Given** an org admin enters a valid email address, **When** they click "Send Invitation", **Then** an invitation email is sent to that address
6. **Given** a user has a pending invitation, **When** they click the invitation link and complete login, **Then** their account is linked to the inviting organization
7. **Given** a user clicks "Forgot Password", **When** they enter their email and submit, **Then** they receive a password reset email with a time-limited link
8. **Given** a user has a password reset link, **When** they click it and enter a new password, **Then** their password is updated and they can login with the new password
9. **Given** a user is logged in, **When** they update their profile name and save, **Then** the new name appears in their profile and across the application
10. **Given** a user's password reset link is older than 1 hour, **When** they try to use it, **Then** they see an error message "This reset link has expired"

### Edge Cases

- **What happens when a user tries to login with SSO but their account is suspended?**  
  System displays an error message "Your account has been suspended. Please contact support."

- **What happens when an org admin invites a user who already has an account?**  
  System links the existing user account to the organization and sends a notification email (not a duplicate account).

- **What happens when a user tries to create an email/password account with an email already registered via SSO?**  
  System displays an error message "An account with this email already exists. Please sign in with Google/Apple."

- **What happens when a user clicks an expired invitation link?**  
  System displays an error message "This invitation has expired. Please request a new invitation from your organization admin."

- **What happens when a user tries to reset password for an SSO-only account?**  
  System displays an informational message "This account uses Google/Apple login. Please sign in with your SSO provider."

- **What happens when a user has both SSO and email/password authentication methods?**  
  System allows login via either method. Profile page shows all linked authentication methods.

- **What happens when Google/Apple JWKS endpoint is unreachable during login?**  
  System displays a temporary error message "Authentication service temporarily unavailable. Please try again in a few moments."

---

## Requirements *(mandatory)*

### Functional Requirements

#### Authentication & Login

- **FR-001**: System MUST support user authentication via Google SSO using OpenID Connect
- **FR-002**: System MUST support user authentication via Apple SSO using Sign in with Apple
- **FR-003**: System MUST verify SSO tokens using Google/Apple JWKS (JSON Web Key Sets)
- **FR-004**: System MUST support user authentication via email and password
- **FR-005**: System MUST enforce password requirements: minimum 8 characters, at least one uppercase, one lowercase, one number
- **FR-006**: System MUST securely hash and store user passwords using industry-standard algorithms
- **FR-007**: System MUST issue session tokens upon successful authentication
- **FR-008**: System MUST support logout functionality that invalidates session tokens
- **FR-009**: System MUST prevent concurrent sessions from multiple devices (user can only be logged in on one device at a time)

#### Account Management

- **FR-010**: User accounts MUST be globally scoped (not organization-specific)
- **FR-011**: System MUST create a new global user account automatically on first SSO login
- **FR-012**: System MUST create a new global user account when a user completes email/password registration
- **FR-013**: Users MUST be able to link multiple SSO providers to a single account (e.g., both Google and Apple)
- **FR-014**: System MUST prevent duplicate accounts with the same email address
- **FR-015**: System MUST support user account suspension by system administrators
- **FR-016**: System MUST support user account deletion with data retention policy compliance

#### Password Reset

- **FR-017**: Users MUST be able to request a password reset by entering their email address
- **FR-018**: System MUST send a time-limited password reset link via email (valid for 1 hour)
- **FR-019**: Password reset links MUST be single-use (invalidated after successful password change)
- **FR-020**: System MUST prevent password reset for SSO-only accounts (accounts without email/password authentication)
- **FR-021**: System MUST validate new password meets password requirements before accepting reset

#### User Invitations

- **FR-022**: Organization admins MUST be able to invite users by email address
- **FR-023**: System MUST send invitation emails to invited users
- **FR-024**: System MUST support invitations to users who do not yet have accounts
- **FR-025**: Invitation links MUST be time-limited (valid for 7 days)
- **FR-026**: System MUST create user account and link to organization upon first login via invitation link
- **FR-027**: System MUST link existing user accounts to organization when invitation is accepted
- **FR-028**: Organization admins MUST be able to view pending invitations
- **FR-029**: Organization admins MUST be able to cancel pending invitations
- **FR-030**: System MUST automatically expire invitations after 7 days

#### Profile Management

- **FR-031**: Users MUST be able to view their profile information (name, email, profile picture)
- **FR-032**: Users MUST be able to update their display name
- **FR-033**: Users MUST be able to upload and update their profile picture
- **FR-034**: Users MUST be able to view all linked authentication methods (Google, Apple, Email/Password)
- **FR-035**: Users MUST be able to add email/password authentication to an SSO-only account
- **FR-036**: Users MUST be able to change their password (for accounts with email/password authentication)
- **FR-037**: System MUST display user's organization memberships on profile page
- **FR-038**: User profile changes MUST be reflected immediately across all active sessions

#### Security & Compliance

- **FR-039**: System MUST rate-limit login attempts to prevent brute-force attacks (maximum 5 failed attempts per 15 minutes per email)
- **FR-040**: System MUST log all authentication events (login, logout, failed attempts) for audit purposes
- **FR-041**: System MUST expire session tokens after 30 days of inactivity
- **FR-042**: System MUST validate email addresses before sending invitations or password reset emails
- **FR-043**: System MUST prevent user enumeration attacks (same error message for valid and invalid emails during password reset)

#### Zitadel Migration

- **FR-044**: System MUST provide a migration path for existing Zitadel users to new authentication system
- **FR-045**: System MUST maintain existing user IDs during migration to preserve data relationships
- **FR-046**: System MUST support rollback capability during migration window
- **FR-047**: All Zitadel API calls MUST be replaced with new authentication service calls

### Key Entities

- **GlobalUser**: Represents a user account in the system (global scope, not organization-specific)
  - Attributes: user_id (UUID), email (unique), display_name, profile_picture_url, status (active/suspended/deleted), created_at, last_login_at
  - Relationships: has many SSOIdentities, has many OrganizationMemberships, has zero or one PasswordCredential

- **SSOIdentity**: Represents a linked SSO provider for a user
  - Attributes: identity_id (UUID), user_id (FK), provider (Google/Apple), provider_user_id (unique per provider), email, created_at
  - Relationships: belongs to GlobalUser

- **PasswordCredential**: Represents email/password authentication for a user
  - Attributes: credential_id (UUID), user_id (FK), password_hash, salt, created_at, updated_at
  - Relationships: belongs to GlobalUser

- **OrganizationMembership**: Links global users to organizations
  - Attributes: membership_id (UUID), user_id (FK), organization_id (FK), role (employee/operator/owner/admin), joined_at, invited_by (FK to user_id)
  - Relationships: belongs to GlobalUser, belongs to Organization

- **Invitation**: Represents a pending invitation to join an organization
  - Attributes: invitation_id (UUID), organization_id (FK), email, invited_by (FK to user_id), token (unique), expires_at, status (pending/accepted/cancelled/expired), created_at
  - Relationships: belongs to Organization, belongs to GlobalUser (invited_by)

- **PasswordResetToken**: Represents a time-limited password reset request
  - Attributes: token_id (UUID), user_id (FK), token (unique), expires_at, used_at, created_at
  - Relationships: belongs to GlobalUser

### Scale & Distribution Considerations

- **Expected concurrent users**: System MUST support at least 10,000 concurrent authenticated sessions
- **Session lifecycle**: Session tokens MUST expire after 30 days of inactivity; users MUST re-authenticate after expiration
- **Multi-instance resilience**: Authentication service MUST be stateless; users MUST be able to authenticate via any backend instance
- **Data consistency requirements**: 
  - User profile updates MUST be visible to the user immediately (same session)
  - User profile updates MUST be visible to other users within 5 seconds (eventual consistency acceptable for cross-user profile views)
  - Session invalidation (logout) MUST take effect immediately on the same instance and within 30 seconds on other instances
- **JWKS caching**: System MUST cache Google/Apple JWKS keys for at least 1 hour to reduce external API dependency
- **Rate limiting**: Login attempt rate limits MUST be enforced consistently across all backend instances (requires shared state)
- **Invitation state**: Pending invitations MUST be stored in the database (not in-memory) to be accessible from any backend instance

---

## Review & Acceptance Checklist

### Content Quality
- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

### Requirement Completeness
- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous  
- [x] Success criteria are measurable
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

---

## Execution Status

- [x] User description parsed
- [x] Key concepts extracted
- [x] Ambiguities marked (all resolved)
- [x] User scenarios defined
- [x] Requirements generated (47 functional requirements)
- [x] Entities identified (6 key entities)
- [x] Review checklist passed

---

## Migration Strategy & Rollback

### Migration Phases

**Phase 1: Dual Authentication Support (1-2 weeks)**
- Deploy new authentication system alongside Zitadel
- Existing users continue using Zitadel
- New users can choose new authentication system
- Risk: Low (no existing user impact)

**Phase 2: User Migration (2-3 weeks)**
- Migrate Zitadel users to new system in batches (by organization)
- User accounts preserve existing user IDs and organization memberships
- Users receive email notification about authentication method change
- SSO users auto-migrate on next login; email/password users forced to reset password
- Risk: Medium (user experience disruption, requires communication plan)

**Phase 3: Zitadel Decommission (1 week)**
- Remove all Zitadel API calls and dependencies
- Archive Zitadel configuration for compliance retention
- Monitor error rates and authentication failures
- Risk: Low (all users migrated in Phase 2)

### Rollback Capability

- **Phase 1 Rollback**: Disable new authentication endpoints, continue using Zitadel
- **Phase 2 Rollback**: Revert user records to Zitadel authentication, preserve new system data for retry
- **Phase 3 Rollback**: Not supported (Zitadel fully decommissioned; forward-fix only)

### Success Metrics

- Authentication success rate > 99.5%
- SSO login latency < 2 seconds (p95)
- Email/password login latency < 1 second (p95)
- Password reset email delivery rate > 98%
- User migration completion rate > 99% within Phase 2 window
- Zero authentication-related data loss during migration

---

## Dependencies & Assumptions

### External Dependencies

- **Google JWKS Endpoint**: `https://www.googleapis.com/oauth2/v3/certs`
  - Assumption: 99.9% uptime, cached for 1 hour
- **Apple JWKS Endpoint**: `https://appleid.apple.com/auth/keys`
  - Assumption: 99.9% uptime, cached for 1 hour
- **Email Service**: Transactional email provider for invitations and password resets
  - Assumption: 99% delivery rate within 5 minutes

### Internal Dependencies

- **Organization Service**: Required for organization membership linking
- **Notification Service**: Required for real-time session invalidation events
- **File Storage**: Required for profile picture uploads

### Assumptions

- Users have access to their email accounts for invitation and password reset flows
- Users with SSO accounts can authenticate with their SSO provider
- Existing Zitadel user data is accessible and mappable to new schema
- Organization admins are properly identified and authorized in current system
- User consent for data migration is covered by existing Terms of Service

---

## Out of Scope

- Two-factor authentication (2FA) - deferred to future feature
- Social login providers beyond Google and Apple (e.g., Microsoft, GitHub) - deferred
- Passwordless authentication methods (magic links, WebAuthn) - deferred
- Admin portal for global user management - deferred
- User activity audit logs beyond authentication events - deferred
- API keys or service account authentication - deferred
- Single Sign-On (SSO) for enterprise customers (SAML, OIDC) - deferred

---

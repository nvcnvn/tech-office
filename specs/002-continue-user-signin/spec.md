# Feature Specification: Complete User Sign-In Flow with Zitadel Integration

**Feature Branch**: `002-continue-user-signin`  
**Created**: October 25, 2025  
**Status**: Draft  
**Input**: User description: "continue user signin web page"

## Execution Flow (main)
```
1. Parse user description from Input
   → Feature: Complete Zitadel OIDC authentication integration for sign-in page
2. Extract key concepts from description
   → Actors: End users, Organization administrators
   → Actions: Authenticate, Redirect, Store tokens, Handle callback
   → Data: User tokens (access, refresh, ID), User profile info
   → Constraints: Must work with subdomain routing, Multi-tenant isolation
3. User scenarios defined (see below)
4. Functional requirements generated (see below)
5. Key entities identified (see below)
6. Review checklist completed
```

---

## ⚡ Quick Context

This feature completes the user sign-in implementation started in Phase 1. The existing implementation includes:
- Organization selection via subdomain (e.g., `acme.tech-office.com`)
- API call to fetch organization details (ID, application ID)
- UI components: `OrgSelector` and `LoginForm` (placeholder only)

**What's Missing:**
- Actual Zitadel OIDC authentication flow integration
- OAuth callback handler page
- Token storage and session management
- Post-authentication redirect logic

---

## Clarifications

### Session 2025-10-25

- Q: How should the system obtain and apply the dynamic client ID based on organization? → A: Backend returns `application_id` in `GetOrganizationBySubdomain` response, frontend reconfigures Zitadel auth instance before login
- Q: Which storage approach should the system use for authentication tokens? → A: localStorage - Simple, persists across sessions, accessible to JavaScript
- Q: When `GetOrganizationBySubdomain` fails, what should happen to the sign-in page state? → A: Show error inline below org input field, keep page interactive, allow user to retry/edit subdomain
- Q: When a user with valid tokens navigates to `/signin`, should redirect happen immediately or after showing the page? → A: Immediate redirect - Check tokens on page load, redirect instantly if valid (user never sees signin page)
- Q: Does the `/dashboard` route exist, or should it be created as part of this feature? → A: Create placeholder - Create a simple placeholder dashboard page (shows "Dashboard - Coming Soon")

---

## User Scenarios & Testing *(mandatory)*

### Primary User Story
As an employee of Acme Corporation, I want to sign in to the Tech Office platform using my organization's subdomain (acme.tech-office.com) so that I can access my company's workspace securely using Zitadel authentication.

### Acceptance Scenarios

1. **Given** user navigates to `acme.tech-office.com/signin`, **When** the page loads, **Then** the system automatically detects "acme" subdomain, validates it with the backend API, and displays the organization name with a "Login with Zitadel" button.

2. **Given** user is on the sign-in page with a valid organization selected, **When** user clicks "Login with Zitadel", **Then** the system initiates OIDC authorization code flow with PKCE, redirecting the user to Zitadel's authorization endpoint with organization-specific scope.

3. **Given** user has completed authentication on Zitadel, **When** Zitadel redirects back to `/auth/callback?code={auth_code}&state={state}`, **Then** the system exchanges the authorization code for tokens (access, refresh, ID), validates the tokens, stores them securely, and redirects the user to the application dashboard.

4. **Given** user is already authenticated (has valid tokens in localStorage), **When** user navigates to `/signin` again, **Then** the system checks token validity on page load and immediately redirects to the dashboard without rendering the sign-in page UI.

5. **Given** user manually enters a subdomain in the organization input field, **When** user types "acme" and the field loses focus, **Then** the system validates the subdomain against the backend API and displays organization details if valid, or an error message if invalid.

### Edge Cases

- **What happens when** the `GetOrganizationBySubdomain` API call fails (network error, organization not found, invalid subdomain)?
  → System displays inline error message below the organization input field (e.g., "Organization not found" or "Unable to connect. Please try again."), keeps the page interactive, and allows the user to edit the subdomain and retry without page reload

- **What happens when** the user navigates directly to `/auth/callback` without a valid OAuth state?
  → System displays error: "Invalid authentication state" and redirects to `/signin`

- **What happens when** the token exchange fails (network error, invalid code)?
  → System displays error message: "Authentication failed. Please try again." and provides retry button

- **What happens when** user tries to sign in to organization A but they don't have access in Zitadel?
  → Zitadel denies access with appropriate error, user is redirected back with error parameter, system displays: "Access denied. Please contact your administrator."

- **What happens when** stored tokens expire?
  → System attempts automatic token refresh using refresh token. If refresh fails, user is prompted to sign in again.

- **What happens when** user is on localhost without a subdomain?
  → System displays manual organization selector with input field, allows user to enter subdomain or select from query parameter `?org=acme`

- **How does system handle** concurrent authentication attempts in multiple tabs?
  → Each tab maintains independent OAuth state. Token storage uses shared storage mechanism so successful authentication in one tab makes tokens available to other tabs.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST integrate Zitadel OIDC authentication flow using OAuth 2.0 Authorization Code flow with PKCE (Proof Key for Code Exchange)

- **FR-002**: System MUST create an authentication service configured with:
  - Issuer URL from environment configuration
  - Client ID dynamically obtained from backend `GetOrganizationBySubdomain` response (`application_id` field)
  - Redirect URI: `{baseUrl}/callback`
  - Post-logout redirect URI: `{baseUrl}/signin`
  - Organization-specific scope including: user profile, email, and organization context

- **FR-003**: System MUST reconfigure the Zitadel authentication instance when organization is selected by:
  - Extracting `application_id` from the `GetOrganizationBySubdomain` API response
  - Updating the auth service configuration with the organization-specific `client_id` (using `application_id` value)
  - Ensuring the reconfiguration completes before allowing login initiation

- **FR-004**: System MUST initiate login when user clicks "Login with Zitadel" button by:
  - Validating organization selection (must not be null)
  - Creating organization-specific authentication request with organization ID in scope
  - Redirecting user to Zitadel authorization endpoint
  - Preserving OAuth state for callback validation (CSRF protection)

- **FR-005**: System MUST implement OAuth callback handler page at `/callback` route that:
  - Extracts authorization code and state from URL query parameters
  - Validates the state matches the original request (CSRF protection)
  - Exchanges authorization code for authentication tokens
  - Validates token signatures and claims
  - Extracts user profile information from tokens

- **FR-006**: System MUST securely store authentication data after successful login:
  - Access token (for API authorization)
  - Refresh token (for obtaining new access tokens)
  - ID token (contains user identity claims)
  - Token expiration time
  - User profile data (name, email, user ID)

- **FR-007**: System MUST redirect authenticated users to the application dashboard (`/dashboard`) after successful token exchange

- **FR-008**: System MUST implement authentication state check on sign-in page load by:
  - Checking localStorage for existing valid authentication tokens immediately on page mount
  - Validating token expiration timestamp (must not be expired)
  - Performing immediate redirect to `/dashboard` if valid tokens exist, before rendering sign-in UI
  - Continuing with normal sign-in page render if no valid tokens found

- **FR-009**: System MUST handle authentication errors gracefully:
  - Display user-friendly error messages
  - Provide "Try Again" action that returns user to sign-in page
  - Log detailed error information for debugging (without exposing sensitive data to user)

- **FR-009**: System MUST handle organization lookup errors by:
  - Displaying inline error message below the organization input field
  - Differentiating between "not found" (invalid subdomain) and "network error" (temporary failure) messages
  - Keeping the sign-in page interactive and allowing user to edit subdomain
  - Providing immediate retry capability without requiring page reload
  - Disabling the "Login with Zitadel" button until valid organization is loaded

- **FR-010**: System MUST support both subdomain-based and query-parameter-based organization routing:
  - Subdomain: `acme.tech-office.com/signin` → auto-detect "acme"
  - Query parameter: `tech-office.com/signin?org=acme` → use "acme"
  - Manual input: `tech-office.com/signin` → allow user to type organization subdomain

- **FR-011**: System MUST implement session persistence using browser localStorage so that:
  - Authentication tokens (access, refresh, ID) are stored in localStorage
  - User profile data is stored in localStorage
  - Users remain authenticated across page refreshes and browser restarts
  - Token data is namespaced to prevent conflicts with other applications

- **FR-012**: System MUST implement automatic token refresh logic that:
  - Monitors access token expiration time
  - Attempts to refresh tokens before expiration using refresh token
  - Prompts user to re-authenticate if refresh fails

- **FR-013**: System MUST clear authentication state when user explicitly logs out

- **FR-015**: LoginForm component MUST disable the login button and show loading state during authentication initiation

- **FR-016**: Callback page MUST show loading indicator while processing the authorization code and exchanging for tokens

- **FR-017**: System MUST create a placeholder dashboard page at `/dashboard` route that:
  - Displays "Dashboard - Coming Soon" or similar message
  - Shows authenticated user's name and email from token claims
  - Provides a "Logout" button that clears authentication state and redirects to `/signin`
  - Is accessible only to authenticated users (redirects to `/signin` if no valid tokens)

### Non-Functional Requirements

- **NFR-001**: Token storage mechanism MUST use browser localStorage with the following security considerations:
  - All token data stored under a namespaced key prefix (e.g., `tech-office-auth-*`)
  - Implement Content Security Policy (CSP) headers to mitigate XSS attacks
  - Store tokens as-is without additional encryption (handled by HTTPS transport layer)
  - Clear localStorage entries on explicit logout

- **NFR-002**: System MUST complete token exchange and redirect to dashboard within 3 seconds under normal network conditions

- **NFR-003**: Authentication flow MUST work correctly in all modern browsers (Chrome, Firefox, Safari, Edge)

- **NFR-004**: Error messages MUST NOT expose sensitive security information (token values, internal errors, stack traces)

### Key Entities *(data involved)*

- **Authentication Tokens**:
  - Access Token: Used to authorize API requests
  - Refresh Token: Long-lived token used to obtain new access tokens
  - ID Token: Contains user identity claims (name, email, roles, organization ID)
  - Token Metadata: Expiration times, scope, token type

- **User Profile**:
  - User ID (from identity provider)
  - Email address
  - Full name
  - Organization ID (from token claims)
  - Roles/Permissions (if included in token claims)

- **OAuth State**:
  - State parameter (CSRF protection)
  - Code verifier (PKCE)
  - Original redirect URL
  - Timestamp

- **Organization Context**:
  - Organization ID (UUID)
  - Organization Name
  - Subdomain
  - Application ID (for this organization)

---

## Dependencies and Assumptions

### Dependencies
- Authentication library for OIDC/OAuth integration
- Backend rpc method: `GetOrganizationBySubdomain` (already implemented)
- Zitadel instance configured with:
  - Application registered with correct redirect URIs
  - PKCE enabled
  - Organization-specific scopes configured
  - User roles and permissions set up

### Assumptions
- Identity provider (Zitadel) is accessible and configured correctly
- Environment variable for issuer URL is set
- Each organization has a dedicated Zitadel application with unique `application_id`
- Backend API `GetOrganizationBySubdomain` returns valid `application_id` for each organization
- Backend API for organization lookup is operational
- Placeholder dashboard page will be enhanced with actual functionality in a future feature
- Users are already registered in the identity provider and assigned to their respective organizations

---

## Out of Scope

- User registration/sign-up flow (separate feature)
- Password reset functionality (handled by identity provider)
- Multi-factor authentication (handled by identity provider)
- Single Sign-On (SSO) with external identity providers
- Role-based access control (RBAC) enforcement (will be separate feature)
- Organization switching for users with access to multiple organizations
- Remember device functionality
- Social login integration (Google, Microsoft, etc.)

---

## Review & Acceptance Checklist

### Content Quality
- [x] Focused on user value and business needs
- [x] Written for stakeholders (with technical context where needed)
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
- [x] Ambiguities marked (none found)
- [x] User scenarios defined
- [x] Requirements generated
- [x] Entities identified
- [x] Review checklist passed

---

## Success Metrics

- Users can successfully authenticate using OIDC flow
- Authentication completion rate > 95% (successful token exchange / initiated logins)
- Average authentication time < 5 seconds (from button click to dashboard load)
- Zero security vulnerabilities related to token storage or OAuth flow
- Error recovery rate > 90% (users who encounter error and successfully retry)

---

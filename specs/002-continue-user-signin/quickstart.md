# Quickstart: User Sign-In Flow Testing

**Feature**: Complete User Sign-In Flow with Zitadel Integration  
**Date**: 2025-10-25  
**Purpose**: Manual verification and automated test scenarios for authentication flow

---

## Prerequisites

### 1. Environment Setup
```bash
# Frontend environment variables (.env.local)
NEXT_PUBLIC_ZITADEL_ISSUER=https://techofficeinstance-elao17.us1.zitadel.cloud
NEXT_PUBLIC_BASE_URL=http://localhost:13000
```

### 2. Zitadel Configuration
- ✅ Application created (User Agent type, PKCE enabled)
- ✅ Redirect URIs configured:
  - `http://localhost:13000/callback`
  - `https://tech-office.com/callback`
- ✅ Post-logout URI: `http://localhost:13000/signin`
- ✅ Test organization created with test user
- ✅ User assigned to organization with appropriate roles

### 3. Backend Setup
- ✅ Backend server running (`cd backend && go run ./cmd/`)
- ✅ PostgreSQL database accessible
- ✅ Test organization exists in database:
  ```sql
  SELECT id, company_name, subdomain, zitadel_org_id 
  FROM organization.organization 
  WHERE subdomain = 'test-org';
  ```

### 4. Frontend Setup
```bash
cd frontend
pnpm install
pnpm web dev
# App runs on http://localhost:13000
```

---

## Test Scenario 1: Happy Path (Subdomain Routing)

### Story
As an employee of Test Organization, I want to sign in using my organization's subdomain so that I can access my workspace.

### Steps

**1. Navigate to signin with subdomain**
```
URL: test-org.localhost:13000/signin
Expected: OrgSelector auto-detects "test-org" and validates it
```

**Visual Checks**:
- ✅ Organization name displays: "Test Organization"
- ✅ Success message shows subdomain validation
- ✅ "Login with Zitadel" button is enabled

**2. Click "Login with Zitadel"**
```
Action: Click the login button
Expected: Redirect to Zitadel authorization page
```

**Visual Checks**:
- ✅ Button shows loading state with spinner
- ✅ Redirects to Zitadel login page
- ✅ Zitadel URL contains correct parameters:
  - `redirect_uri=http://localhost:13000/callback`
  - `response_type=code`
  - `scope` includes organization ID
  - `code_challenge` present (PKCE)
  - `state` present (CSRF protection)

**3. Authenticate on Zitadel**
```
Action: Enter test user credentials
Email: test@test-org.com
Password: [test password]
Expected: Successful authentication
```

**Visual Checks**:
- ✅ Zitadel accepts credentials
- ✅ No MFA prompt (if not configured)
- ✅ Consent screen (if first-time login)
- ✅ Redirects back to callback URL

**4. Callback page processes authentication**
```
URL: http://localhost:13000/callback?code=xxx&state=yyy
Expected: Token exchange and redirect to dashboard
```

**Visual Checks**:
- ✅ Loading spinner displays: "Completing sign-in..."
- ✅ No error messages
- ✅ Redirect to `/dashboard` within 2 seconds

**5. Dashboard loads with authentication**
```
URL: http://localhost:13000/dashboard
Expected: Authenticated dashboard page
```

**Visual Checks**:
- ✅ Dashboard content displays
- ✅ User info visible (name, email)
- ✅ No redirect to signin page
- ✅ API calls work (check network tab for Authorization header)

**6. Verify token storage**
```
Action: Open browser DevTools → Application → Local Storage
Expected: auth_tokens key present
```

**Technical Checks**:
```javascript
// In browser console
const tokens = JSON.parse(localStorage.getItem('auth_tokens'));
console.log('Access Token:', tokens.access_token.substring(0, 50) + '...');
console.log('Refresh Token:', tokens.refresh_token.substring(0, 20) + '...');
console.log('Expires At:', new Date(tokens.expires_at));
console.log('Scope:', tokens.scope);
// Should include: openid profile email urn:zitadel:iam:org:id:{orgId}
```

**7. Verify JWT claims**
```javascript
// Decode ID token (use jwt.io or decode in console)
function parseJwt(token) {
  const base64Url = token.split('.')[1];
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(base64));
}

const idToken = JSON.parse(localStorage.getItem('auth_tokens')).id_token;
const claims = parseJwt(idToken);
console.log('User ID:', claims.sub);
console.log('Email:', claims.email);
console.log('Organization ID:', claims['urn:zitadel:iam:org:id']);
console.log('Organization Domain:', claims['urn:zitadel:iam:org:domain:primary']);
```

**Expected Claims**:
```json
{
  "sub": "234567890123456789",
  "email": "test@test-org.com",
  "email_verified": true,
  "name": "Test User",
  "urn:zitadel:iam:org:id": "123e4567-e89b-12d3-a456-426614174000",
  "urn:zitadel:iam:org:domain:primary": "test-org"
}
```

### Success Criteria
- ✅ All 7 steps complete without errors
- ✅ User authenticated and on dashboard within 5 seconds
- ✅ Tokens stored in localStorage
- ✅ JWT claims include organization context

---

## Test Scenario 2: Query Parameter Routing

### Story
As a developer testing locally, I want to sign in using a query parameter since localhost doesn't support subdomains.

### Steps

**1. Navigate with query parameter**
```
URL: http://localhost:13000/signin?org=test-org
Expected: OrgSelector uses query parameter
```

**Visual Checks**:
- ✅ Organization name displays: "Test Organization"
- ✅ Input field pre-filled with "test-org"
- ✅ Success message shows validation

**2-7. Continue as in Scenario 1**
Same steps as happy path from step 2 onwards.

### Success Criteria
- ✅ Query parameter routing works same as subdomain routing
- ✅ Full authentication flow completes

---

## Test Scenario 3: Session Persistence

### Story
As a user, I want to stay signed in when I refresh the page so that I don't have to re-authenticate constantly.

### Steps

**1. Complete authentication** (use Scenario 1)

**2. Refresh dashboard page**
```
Action: Press F5 or Cmd+R
Expected: Page reloads, user still authenticated
```

**Visual Checks**:
- ✅ No redirect to signin
- ✅ Dashboard content loads immediately
- ✅ User info still visible
- ✅ Tokens still in localStorage

**3. Open new tab with protected route**
```
Action: Open new tab, navigate to http://localhost:13000/dashboard
Expected: Already authenticated, no redirect
```

**Visual Checks**:
- ✅ Dashboard loads without signin page
- ✅ Same user session (check user info)

**4. Close all tabs, reopen browser**
```
Action: Close browser completely, reopen and navigate to dashboard
Expected: Tokens persist (unless browser clears storage)
```

**Visual Checks**:
- ✅ Still authenticated (if tokens not expired)
- ✅ Or redirect to signin (if tokens expired after 30 days)

### Success Criteria
- ✅ Session persists across page refreshes
- ✅ Session persists across tabs
- ✅ Session persists across browser restarts (if within token lifetime)

---

## Test Scenario 4: Token Refresh

### Story
As a user with an active session, I want my tokens to refresh automatically before they expire so that I don't get logged out unexpectedly.

### Steps

**1. Complete authentication** (use Scenario 1)

**2. Note token expiration**
```javascript
// In browser console
const tokens = JSON.parse(localStorage.getItem('auth_tokens'));
const expiresIn = (tokens.expires_at - Date.now()) / 1000 / 60;
console.log(`Token expires in ${expiresIn.toFixed(1)} minutes`);
```

**3. Wait for auto-refresh** (or mock expired token)
```javascript
// Option A: Wait for real refresh (60s before expiry)
// Option B: Mock expired token for testing
const tokens = JSON.parse(localStorage.getItem('auth_tokens'));
tokens.expires_at = Date.now() + 30000; // Expire in 30 seconds
localStorage.setItem('auth_tokens', JSON.stringify(tokens));
// @zitadel/react will trigger refresh in ~30s
```

**4. Observe refresh** (check network tab)
```
Expected: POST request to /oauth/v2/token with grant_type=refresh_token
Response: New access_token, new refresh_token
```

**Visual Checks**:
- ✅ Network tab shows token refresh request
- ✅ No interruption to user experience
- ✅ No redirect to signin
- ✅ Dashboard continues to work

**5. Verify new tokens stored**
```javascript
// In browser console
const newTokens = JSON.parse(localStorage.getItem('auth_tokens'));
console.log('New Access Token:', newTokens.access_token.substring(0, 50) + '...');
console.log('New Expires At:', new Date(newTokens.expires_at));
// Should be ~1 hour from now
```

### Success Criteria
- ✅ Token refresh happens automatically
- ✅ No user interruption or notification
- ✅ New tokens stored with updated expiration
- ✅ Old tokens replaced

---

## Test Scenario 5: Error Handling - Invalid Subdomain

### Story
As a user, I want to see a clear error message if I enter an invalid organization subdomain so that I know what went wrong.

### Steps

**1. Navigate to signin**
```
URL: http://localhost:13000/signin
```

**2. Enter invalid subdomain**
```
Action: Type "invalid-org-xyz" in subdomain field, blur field
Expected: Error message displays
```

**Visual Checks**:
- ✅ Error message: "Organization not found for subdomain: invalid-org-xyz"
- ✅ Error styling (red border, error icon)
- ✅ Login button stays disabled
- ✅ No success message

**3. Correct the subdomain**
```
Action: Clear field, type "test-org", blur field
Expected: Validation succeeds
```

**Visual Checks**:
- ✅ Error clears
- ✅ Success message appears
- ✅ Login button enables

### Success Criteria
- ✅ Invalid subdomain shows user-friendly error
- ✅ User can recover by entering valid subdomain

---

## Test Scenario 6: Error Handling - Access Denied

### Story
As a user trying to sign in to an organization I don't have access to, I want to see a clear error message explaining why I can't sign in.

### Steps

**1. Navigate to signin with valid org**
```
URL: http://localhost:13000/signin?org=other-org
Expected: Organization validates successfully
```

**2. Click "Login with Zitadel"**

**3. Authenticate with user NOT in this org**
```
Action: Enter credentials for user not assigned to "other-org"
Expected: Zitadel denies access
```

**4. Redirected back with error**
```
URL: http://localhost:13000/callback?error=access_denied&error_description=...
Expected: Error page or redirect to signin with error message
```

**Visual Checks**:
- ✅ Error message: "Access denied. Please contact your administrator."
- ✅ No tokens stored
- ✅ "Try Again" button visible
- ✅ User-friendly explanation (not technical error code)

### Success Criteria
- ✅ Access denied error handled gracefully
- ✅ User-friendly error message
- ✅ Ability to retry

---

## Test Scenario 7: Error Handling - Network Error

### Story
As a user experiencing network issues, I want to see a clear error message and have the option to retry so that I can complete sign-in when connectivity is restored.

### Steps

**1. Simulate network error**
```
Action: Open DevTools → Network → Set throttling to "Offline"
```

**2. Navigate to signin**
```
URL: http://localhost:13000/signin?org=test-org
Expected: Organization validation fails with network error
```

**Visual Checks**:
- ✅ Loading spinner shows briefly
- ✅ Error message: "Network error. Please check your connection and try again."
- ✅ Not "Organization not found" (distinguish network vs validation error)

**3. Restore network**
```
Action: DevTools → Network → Set throttling to "No throttling"
```

**4. Retry validation**
```
Action: Blur subdomain field again or click retry button
Expected: Validation succeeds
```

**Visual Checks**:
- ✅ Error clears
- ✅ Success message appears
- ✅ Login button enables

### Success Criteria
- ✅ Network errors distinguished from validation errors
- ✅ Clear user messaging
- ✅ Retry mechanism works

---

## Test Scenario 8: Logout

### Story
As an authenticated user, I want to sign out so that others using the same device cannot access my account.

### Steps

**1. Complete authentication** (use Scenario 1)

**2. Click logout button** (assuming logout UI exists)
```
Action: Click "Logout" or "Sign Out" button
Expected: Logout flow initiates
```

**Visual Checks**:
- ✅ Redirect to Zitadel logout endpoint
- ✅ Zitadel confirms logout
- ✅ Redirect back to `/signin`

**3. Verify tokens cleared**
```javascript
// In browser console
const tokens = localStorage.getItem('auth_tokens');
console.log('Tokens:', tokens); // Should be null
```

**4. Try accessing protected route**
```
Action: Navigate to http://localhost:13000/dashboard
Expected: Redirect to signin (not authenticated)
```

**Visual Checks**:
- ✅ Redirect to `/signin`
- ✅ No dashboard content loads
- ✅ No error messages (just normal signin page)

### Success Criteria
- ✅ Tokens cleared from localStorage
- ✅ Protected routes redirect to signin
- ✅ Full logout flow completes

---

## Automated Test Checklist

### Component Tests (React Testing Library)
```typescript
// LoginForm.test.tsx
- ✅ Renders with organization selected
- ✅ Renders disabled when no organization
- ✅ Shows loading state on button click
- ✅ Displays error message on failure
- ✅ Calls login function with correct scope

// Callback page.test.tsx
- ✅ Renders loading spinner
- ✅ Calls signinRedirectCallback on mount
- ✅ Redirects to dashboard on success
- ✅ Redirects to signin with error on failure
- ✅ Handles network errors

// OrgSelector.test.tsx (if modified)
- ✅ Validates subdomain on blur
- ✅ Shows error for invalid subdomain
- ✅ Shows success for valid subdomain
- ✅ Handles network errors
```

### Integration Tests (Vitest + MSW)
```typescript
// auth-flow.test.ts
- ✅ Full OAuth flow: signin → callback → dashboard
- ✅ Token storage after successful auth
- ✅ Token refresh before expiration
- ✅ Access denied error handling
- ✅ Invalid state error handling
- ✅ Network error retry logic
- ✅ Logout clears tokens
```

### E2E Tests (Playwright/Cypress)
```typescript
// signin.e2e.ts
- ✅ Subdomain routing: org.localhost/signin
- ✅ Query param routing: localhost/signin?org=test
- ✅ Full authentication flow with real Zitadel
- ✅ Session persistence across page refreshes
- ✅ Protected route redirection when not authenticated
- ✅ Cross-tab authentication sync
```

---

## Performance Validation

### Metrics to Track
```typescript
// Measure with browser DevTools Performance tab

1. **Organization Lookup**: < 200ms p95
   - API call to GetOrganizationBySubdomain

2. **Authentication Flow**: < 5s total
   - Button click → dashboard load
   - Includes Zitadel redirect and token exchange

3. **Token Refresh**: < 1s
   - Background refresh, no user interruption

4. **Page Load (Authenticated)**: < 1s
   - Dashboard load with token validation
```

### Performance Test Steps
```bash
# 1. Use Lighthouse for initial metrics
npx lighthouse http://localhost:13000/signin --view

# 2. Use DevTools Performance for auth flow
# Record from login button click to dashboard load

# 3. Check Network waterfall for token refresh
# Look for /oauth/v2/token request timing
```

---

## Troubleshooting Guide

### Common Issues

**1. "Organization not found" error**
- ✅ Check subdomain spelling
- ✅ Verify organization exists in database
- ✅ Check backend server is running

**2. Infinite redirect loop**
- ✅ Check redirect URIs in Zitadel match exactly
- ✅ Verify NEXT_PUBLIC_BASE_URL is correct
- ✅ Check for trailing slash mismatches

**3. "Invalid state" error on callback**
- ✅ Clear browser storage and cookies
- ✅ Restart from signin page (fresh OAuth flow)
- ✅ Check for browser extensions blocking sessionStorage

**4. Token exchange fails**
- ✅ Check PKCE code_verifier exists in sessionStorage
- ✅ Verify client_id matches Zitadel application
- ✅ Check network tab for error details

**5. "Access denied" even with correct user**
- ✅ Verify user is assigned to organization in Zitadel
- ✅ Check organization scope in request matches user's org
- ✅ Verify organization is active (not suspended)

---

## Success Metrics

### All Scenarios Pass
- ✅ Happy path (subdomain): 100% success
- ✅ Happy path (query param): 100% success  
- ✅ Session persistence: Tokens persist correctly
- ✅ Token refresh: Automatic and transparent
- ✅ Error handling: All 3 error scenarios handled gracefully
- ✅ Logout: Complete cleanup

### Performance Targets
- ✅ Organization lookup: < 200ms
- ✅ Full auth flow: < 5s
- ✅ Token refresh: < 1s (background)

### Test Coverage
- ✅ Component tests: > 80% coverage
- ✅ Integration tests: All critical paths
- ✅ E2E tests: 1+ complete user journey

---

**Status**: Ready for implementation and testing  
**Next Step**: Execute quickstart after feature implementation complete

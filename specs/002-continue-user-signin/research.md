# Research: Zitadel OIDC Integration for Sign-In Flow

**Feature**: Complete User Sign-In Flow with Zitadel Integration  
**Date**: 2025-10-25  
**Status**: Complete

## Overview
This document captures research findings for integrating Zitadel OIDC authentication into the Tech Office sign-in flow. The existing implementation already has organization lookup working; this research focuses on completing the authentication integration using the `@zitadel/react` library.

---

## 1. Zitadel OIDC Integration Pattern

### Decision
Use `@zitadel/react` library (v1.1.0) which wraps `oidc-client-ts` for OAuth 2.0 Authorization Code flow with PKCE.

### Rationale
- **Library already installed**: `@zitadel/react` is in package.json, no new dependencies needed
- **Official Zitadel integration**: Maintained by Zitadel team, follows their best practices
- **PKCE built-in**: Security best practice for SPAs (prevents code interception attacks)
- **React hooks provided**: `useAuth()`, `ZitadelAuth` provider for context management
- **Proven pattern**: Used in official Zitadel React example (https://github.com/zitadel/zitadel-react)

### Implementation Pattern
```typescript
// 1. Create auth service (lib/auth/zitadel.ts)
import { createZitadelAuth } from '@zitadel/react';

export const zitadelAuth = createZitadelAuth({
  issuer: process.env.NEXT_PUBLIC_ZITADEL_ISSUER,
  client_id: process.env.NEXT_PUBLIC_ZITADEL_CLIENT_ID,
  redirect_uri: `${baseUrl}/callback`,
  post_logout_redirect_uri: `${baseUrl}/signin`,
  scope: 'openid profile email urn:zitadel:iam:org:id:{organizationId}',
});

// 2. Wrap app with provider (app/layout.tsx)
<ZitadelAuth config={zitadelAuth}>
  {children}
</ZitadelAuth>

// 3. Use in components (signin/components/LoginForm.tsx)
const { login } = useAuth();
await login({ scope: orgSpecificScope });
```

### Alternatives Considered
- **Manual OIDC implementation**: Rejected - too complex, error-prone, reinventing the wheel
- **NextAuth.js**: Rejected - too heavy, designed for server-side auth, not needed for client-side JWT pattern
- **Direct oidc-client-ts**: Rejected - @zitadel/react provides better Zitadel-specific defaults

### References
- Zitadel React Docs: https://zitadel.com/docs/examples/login/react
- @zitadel/react GitHub: https://github.com/zitadel/zitadel-react
- PKCE Specification: https://oauth.net/2/pkce/

---

## 2. Token Storage Strategy

### Decision
Use **localStorage** for MVP, with migration path to HttpOnly cookies for production.

### Rationale
- **MVP Speed**: localStorage is simpler to implement, no server-side cookie management needed
- **@zitadel/react default**: The library uses localStorage by default for token storage
- **Cross-tab sync**: localStorage events allow token sharing between tabs
- **Acceptable risk for MVP**: Internal business app, not public-facing, short-lived tokens
- **Migration ready**: Can switch to HttpOnly cookies later without API changes

### Security Considerations
- ✅ **PKCE protects auth code**: Even if localStorage compromised, auth code can't be replayed
- ✅ **Short-lived access tokens**: 1-hour expiration (Zitadel default)
- ✅ **Refresh token rotation**: New refresh token issued on each refresh
- ✅ **Strict CORS policy**: API only accepts requests from known origins
- ⚠️ **XSS vulnerability**: If XSS exists, tokens can be stolen (mitigated by CSP headers)

### Implementation
```typescript
// lib/auth/storage.ts
export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  id_token: string;
  expires_at: number;
}

export const storage = {
  save: (tokens: AuthTokens) => {
    localStorage.setItem('auth_tokens', JSON.stringify(tokens));
  },
  load: (): AuthTokens | null => {
    const data = localStorage.getItem('auth_tokens');
    return data ? JSON.parse(data) : null;
  },
  clear: () => {
    localStorage.removeItem('auth_tokens');
  },
};
```

### Future Enhancement (Production)
Move to HttpOnly cookies:
- Server-side middleware sets cookies after token exchange
- Client never sees refresh token
- CSRF protection with sameSite=strict
- Requires backend endpoint for token refresh

### Alternatives Considered
- **SessionStorage**: Rejected - doesn't persist across browser restarts
- **Cookies (client-side)**: Rejected - no better than localStorage, still accessible to JS
- **IndexedDB**: Rejected - overkill for simple token storage

### References
- OWASP Token Storage: https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html#local-storage
- @zitadel/react storage: Uses oidc-client-ts's WebStorageStateStore

---

## 3. OAuth Callback Flow

### Decision
Implement callback page at `/callback` using Next.js App Router page component.

### Rationale
- **Standard OAuth pattern**: Callback URL registered in Zitadel application settings
- **@zitadel/react handles heavy lifting**: Library manages code exchange, state validation
- **Next.js route**: Simple page.tsx at `app/callback/page.tsx`
- **Client-side processing**: All token exchange happens in browser (stateless backend)

### Callback Flow
```
1. User clicks "Login with Zitadel" → redirects to Zitadel
2. User authenticates on Zitadel
3. Zitadel redirects to `/callback?code=xxx&state=yyy`
4. Callback page loads, @zitadel/react hook triggers:
   - Validates state (CSRF protection)
   - Exchanges code for tokens (PKCE code_verifier used)
   - Stores tokens in localStorage
   - Fires auth state change event
5. Callback page redirects to `/dashboard`
```

### Implementation Pattern
```typescript
// app/callback/page.tsx
'use client';
import { useEffect } from 'react';
import { useAuth } from '@zitadel/react';
import { useRouter } from 'next/navigation';

export default function CallbackPage() {
  const { userManager, user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    userManager.signinRedirectCallback()
      .then(() => {
        router.push('/dashboard');
      })
      .catch((error) => {
        console.error('Callback error:', error);
        router.push('/signin?error=auth_failed');
      });
  }, [userManager, router]);

  return <LoadingSpinner message="Completing sign-in..." />;
}
```

### Error Handling
- **Invalid state**: Redirect to signin with error message
- **Code exchange failure**: Show retry option, log error details
- **Network errors**: Retry with exponential backoff
- **User cancellation**: Detect error=access_denied, show friendly message

### Alternatives Considered
- **Server-side callback**: Rejected - adds complexity, not needed for JWT pattern
- **Popup callback**: Rejected - worse UX, blocked by many browsers
- **Silent refresh iframe**: Rejected - Third-party cookie restrictions breaking it

### References
- OAuth 2.0 Callback: https://datatracker.ietf.org/doc/html/rfc6749#section-4.1.2
- @zitadel/react Callback: https://github.com/zitadel/zitadel-react/blob/main/src/components/Callback.tsx

---

## 4. Organization-Specific Scope

### Decision
Dynamically build OIDC scope including organization ID: `urn:zitadel:iam:org:id:{organizationId}`

### Rationale
- **Zitadel organization scope**: Links authentication to specific organization
- **Multi-tenant isolation**: Ensures user can only access their org's data
- **Already implemented**: `buildOidcScope()` function exists in `app/config/auth.ts`
- **Token contains org**: ID token claims include organization ID for API authorization

### Implementation
```typescript
// app/config/auth.ts (already exists)
export function buildOidcScope(organizationId?: string): string {
  const baseScopes = ['openid', 'profile', 'email'];
  if (organizationId) {
    baseScopes.push(`urn:zitadel:iam:org:id:${organizationId}`);
  }
  return baseScopes.join(' ');
}

// signin/components/LoginForm.tsx
const handleLogin = async () => {
  const orgScope = buildOidcScope(organizationId);
  await login({ scope: orgScope });
};
```

### Token Claims
After authentication, ID token contains:
```json
{
  "sub": "user-uuid",
  "email": "user@acme.com",
  "name": "John Doe",
  "urn:zitadel:iam:org:id": "org-uuid",
  "urn:zitadel:iam:org:domain:primary": "acme"
}
```

### API Authorization
Backend extracts organization ID from token:
```go
// Backend middleware verifies token and extracts claims
func (i *Interceptor) Auth(ctx context.Context, req interface{}) (context.Context, error) {
    token := extractToken(ctx)
    claims, err := i.verifier.Verify(ctx, token)
    orgID := claims["urn:zitadel:iam:org:id"].(string)
    
    // Add to context for downstream services
    ctx = context.WithValue(ctx, "organization_id", orgID)
    return ctx, nil
}
```

### Alternatives Considered
- **Session-based org storage**: Rejected - requires server-side sessions
- **Separate org selection after auth**: Rejected - worse UX, allows unauthorized org access
- **Cookie-based org tracking**: Rejected - can be manipulated, not secure

### References
- Zitadel Organization Scope: https://zitadel.com/docs/guides/integrate/token-introspection/organization-claims
- JWT Claims: https://openid.net/specs/openid-connect-core-1_0.html#IDToken

---

## 5. Session Persistence & Token Refresh

### Decision
Implement automatic token refresh using @zitadel/react's built-in silent refresh mechanism.

### Rationale
- **Library handles it**: @zitadel/react monitors token expiration, triggers refresh automatically
- **Refresh token rotation**: Zitadel issues new refresh token on each use (security best practice)
- **Transparent to user**: No interruption, seamless experience
- **Configurable**: Can set refresh threshold (default: 60s before expiration)

### Implementation
```typescript
// lib/auth/zitadel.ts
export const zitadelAuth = createZitadelAuth({
  // ... other config
  automaticSilentRenew: true,
  accessTokenExpiringNotificationTime: 60, // Refresh 60s before expiry
  silentRequestTimeout: 10000, // 10s timeout for refresh
});

// Custom hook for auth state
export function useAuthState() {
  const { user, isLoading } = useAuth();
  
  return {
    isAuthenticated: !!user && !user.expired,
    user,
    isLoading,
  };
}
```

### Refresh Flow
```
1. Access token expires in 60s
2. @zitadel/react automatically calls refresh endpoint
3. New access + refresh tokens returned
4. Tokens updated in localStorage
5. App continues without interruption
```

### Error Handling
- **Refresh token expired**: Redirect to signin (session ended)
- **Network error**: Retry with backoff, eventually redirect to signin
- **Invalid refresh token**: Clear auth state, redirect to signin

### Session Duration
- Access token: 1 hour (Zitadel default)
- Refresh token: 30 days (Zitadel default, configurable)
- Idle timeout: Not implemented in MVP (future enhancement)

### Alternatives Considered
- **Manual refresh**: Rejected - complex, error-prone, library does it better
- **Server-side sessions**: Rejected - adds complexity, not needed for JWT pattern
- **Long-lived access tokens**: Rejected - security risk

### References
- OAuth Token Refresh: https://datatracker.ietf.org/doc/html/rfc6749#section-6
- @zitadel/react Silent Refresh: Uses oidc-client-ts's silent renew feature

---

## 6. Middleware Authentication Check

### Decision
Implement Next.js middleware to verify JWT token and enforce authentication on protected routes.

### Rationale
- **Existing middleware**: `middleware.ts` already exists with TODO comments
- **Edge runtime**: Next.js middleware runs on edge, fast response
- **Route protection**: Block unauthorized access before page renders
- **Token validation**: Check JWT signature, expiration, organization context

### Implementation
```typescript
// middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_ROUTES = ['/signin', '/callback', '/signup'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
  // Allow public routes
  if (PUBLIC_ROUTES.some(route => pathname.startsWith(route))) {
    return NextResponse.next();
  }
  
  // Check for auth token
  const token = request.cookies.get('auth_token')?.value
    || extractTokenFromLocalStorage(request); // Read from header if available
  
  if (!token) {
    const signinUrl = new URL('/signin', request.url);
    return NextResponse.redirect(signinUrl);
  }
  
  // Note: Full JWT validation should be done server-side for sensitive routes
  // For MVP, client-side validation is acceptable
  
  return NextResponse.next();
}
```

### Validation Strategy (MVP)
- **Client-side validation**: Check token exists and not expired
- **Server-side validation**: Backend RPC interceptor verifies signature
- **Organization context**: Extracted from token claims on server

### Future Enhancement (Production)
- Server-side JWT validation in middleware
- Rate limiting on auth endpoints
- Suspicious activity detection
- Device fingerprinting

### Alternatives Considered
- **No middleware**: Rejected - allows unauthorized page loads, poor UX
- **Client-side only**: Current approach for MVP, acceptable risk
- **Full JWT verification in middleware**: Future enhancement, requires edge-compatible crypto

### References
- Next.js Middleware: https://nextjs.org/docs/app/building-your-application/routing/middleware
- JWT Validation: https://jwt.io/introduction

---

## 7. Error Handling & User Feedback

### Decision
Implement comprehensive error handling with user-friendly messages and structured logging.

### Rationale
- **User experience**: Clear messages help users recover from errors
- **Debugging**: Structured logs help diagnose production issues
- **Security**: Don't expose sensitive details to users
- **Monitoring**: Track authentication success/failure rates

### Error Categories
1. **User Errors** (show friendly message):
   - Wrong organization
   - Access denied by Zitadel
   - Network connectivity
   - Token expired (prompt re-login)

2. **System Errors** (log details, show generic message):
   - Invalid OAuth state
   - Token exchange failure
   - Refresh token failure
   - Unexpected exceptions

### Implementation
```typescript
// lib/auth/errors.ts
export class AuthError extends Error {
  constructor(
    public code: string,
    public userMessage: string,
    public debugInfo?: any
  ) {
    super(userMessage);
  }
}

export const authErrors = {
  ACCESS_DENIED: new AuthError(
    'ACCESS_DENIED',
    'Access denied. Please contact your administrator.',
  ),
  INVALID_STATE: new AuthError(
    'INVALID_STATE',
    'Authentication failed. Please try again.',
  ),
  TOKEN_EXPIRED: new AuthError(
    'TOKEN_EXPIRED',
    'Your session has expired. Please sign in again.',
  ),
  NETWORK_ERROR: new AuthError(
    'NETWORK_ERROR',
    'Network error. Please check your connection and try again.',
  ),
};

// Error handling in components
try {
  await login({ scope: orgScope });
} catch (error) {
  if (error.code === 'access_denied') {
    setError(authErrors.ACCESS_DENIED.userMessage);
    logAuthError('ACCESS_DENIED', { organizationId });
  } else {
    setError('An unexpected error occurred. Please try again.');
    logAuthError('UNEXPECTED', { error, organizationId });
  }
}
```

### Logging Strategy
```typescript
// lib/auth/logging.ts
export function logAuthError(code: string, context: any) {
  console.error('[Auth]', {
    timestamp: new Date().toISOString(),
    code,
    context: sanitize(context), // Remove sensitive data
    userAgent: navigator.userAgent,
  });
  
  // TODO: Send to monitoring service (Sentry, Datadog, etc.)
}
```

### User Feedback UI
- **Inline errors**: MUI Alert components in forms
- **Toast notifications**: For background errors (token refresh)
- **Error pages**: For critical failures (callback error page)
- **Retry actions**: Always provide "Try Again" button

### Alternatives Considered
- **Silent failures**: Rejected - poor UX, hard to debug
- **Detailed error messages**: Rejected - security risk, information leakage
- **No logging**: Rejected - impossible to debug production issues

### References
- OWASP Error Handling: https://cheatsheetseries.owasp.org/cheatsheets/Error_Handling_Cheat_Sheet.html
- MUI Alert: https://mui.com/material-ui/react-alert/

---

## 8. Testing Strategy

### Decision
Follow constitution: implement core functionality first, then add tests after manual verification.

### Test Types
1. **Component Tests** (after UI works):
   - LoginForm: button states, error display, loading states
   - Callback page: loading states, error handling
   - Dashboard: authenticated access only

2. **Integration Tests** (after flow works):
   - Full OAuth flow: signin → Zitadel → callback → dashboard
   - Token refresh: automatic renewal before expiration
   - Error scenarios: access denied, invalid state, network errors

3. **E2E Tests** (quickstart validation):
   - User story: employee signs in to their organization
   - Subdomain routing: acme.tech-office.com/signin
   - Cross-tab sync: login in tab A, tab B recognizes auth

### Testing Tools
- **Component**: React Testing Library, Vitest
- **Integration**: Vitest, MSW (mock service worker) for API mocking
- **E2E**: Playwright or Cypress (to be determined)

### Test Data
- **Mock Zitadel**: Use test organization with test users
- **Local testing**: localhost:13000?org=test-org
- **CI/CD**: Zitadel dev instance with CI-specific test org

### Rationale
- **Manual verification first**: Ensures we test correct behavior, not AI hallucinations
- **Comprehensive coverage**: After verification, tests lock in correct behavior
- **Fast feedback**: Unit tests run in milliseconds, catch regressions early

### References
- React Testing Library: https://testing-library.com/docs/react-testing-library/intro
- Vitest: https://vitest.dev/

---

## 9. Existing Patterns to Follow

### Tech Office Authentication Patterns
1. **Organization Context** (`app/config/auth.ts`):
   - `extractOrganization()` - already implemented
   - `buildOidcScope()` - already implemented
   - `createOrgAuthConfig()` - already implemented

2. **RPC Client Pattern** (`packages/apis/src/organization.ts`):
   - Wrapper functions around RPC clients
   - Error mapping: RPC errors → user-friendly APIErrors
   - Example: `getOrganizationBySubdomain()`

3. **MUI Theme** (existing components):
   - Use Material-UI components consistently
   - Follow existing button, alert, loading spinner patterns
   - Example: `OrgSelector` component

4. **App Router Patterns** (`app/signin/page.tsx`):
   - Client components: `'use client'` directive
   - Server components: default, no directive
   - Loading states: `loading.tsx` files

### Files to Reference
- `frontend/apps/web/src/app/signin/components/OrgSelector.tsx` - API error handling
- `frontend/apps/web/src/app/config/auth.ts` - Auth configuration pattern
- `frontend/packages/apis/src/organization.ts` - RPC wrapper pattern
- `frontend/apps/web/src/middleware.ts` - Middleware structure (TODO comments)

---

## 10. Environment Configuration

### Required Environment Variables
```bash
# .env.local (frontend)
NEXT_PUBLIC_ZITADEL_ISSUER=https://techofficeinstance-elao17.us1.zitadel.cloud
NEXT_PUBLIC_BASE_URL=http://localhost:13000

# Production
NEXT_PUBLIC_BASE_URL=https://tech-office.com
```

### Zitadel Application Configuration
Must be configured in Zitadel Console:
1. **Application Type**: User Agent (SPA)
2. **Auth Method**: PKCE (Proof Key for Code Exchange)
3. **Redirect URIs**:
   - http://localhost:13000/callback (dev)
   - https://tech-office.com/callback (prod)
   - https://*.tech-office.com/callback (wildcard for subdomains)
4. **Post Logout URIs**:
   - http://localhost:13000/signin (dev)
   - https://tech-office.com/signin (prod)
5. **Scopes**: openid, profile, email, organization
6. **Grant Types**: authorization_code, refresh_token

### References
- Zitadel App Configuration: https://zitadel.com/docs/guides/integrate/login-ui
- Next.js Environment Variables: https://nextjs.org/docs/app/building-your-application/configuring/environment-variables

---

## Summary

**All technical unknowns resolved:**
- ✅ Zitadel integration pattern using @zitadel/react
- ✅ Token storage strategy (localStorage for MVP)
- ✅ OAuth callback flow implementation
- ✅ Organization-specific scope handling
- ✅ Session persistence and token refresh
- ✅ Middleware authentication checks
- ✅ Error handling and user feedback
- ✅ Testing strategy following constitution
- ✅ Existing patterns to follow identified
- ✅ Environment configuration requirements

**Ready for Phase 1**: Design & Contracts

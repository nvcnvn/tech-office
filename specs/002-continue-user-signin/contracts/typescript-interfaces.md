# TypeScript Interface Contracts

**Feature**: `002-continue-user-signin`  
**Date**: October 25, 2025

This document defines the TypeScript interfaces and contracts for the authentication implementation.

---

## 1. Auth Context Interface

```typescript
// lib/auth/auth-context.tsx
import { User } from 'oidc-client-ts';

interface AuthContextValue {
  // Authentication state
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  
  // Authentication actions
  login: (scope?: string) => Promise<void>;
  logout: () => Promise<void>;
  
  // Organization context
  organization: OrganizationContext | null;
  setOrganization: (org: OrganizationContext) => void;
  
  // Error state
  error: AuthError | null;
  clearError: () => void;
}

interface OrganizationContext {
  id: string;
  name: string;
  subdomain: string;
  applicationId: string;
}

interface AuthError {
  code: string;
  message: string;
  userMessage: string;
}
```

---

## 2. Token Storage Interface

```typescript
// lib/auth/storage.ts

interface TokenStorage {
  /**
   * Get authentication user from storage
   * Returns null if no user or expired token
   */
  getUser(): User | null;
  
  /**
   * Check if user is authenticated and token is valid
   */
  isAuthenticated(): boolean;
  
  /**
   * Get organization context from storage
   */
  getOrganization(): OrganizationContext | null;
  
  /**
   * Save organization context to storage
   */
  saveOrganization(org: OrganizationContext): void;
  
  /**
   * Clear all authentication data
   */
  clear(): void;
}
```

---

## 3. Sign-In Page Props

```typescript
// app/signin/page.tsx

interface SignInPageProps {
  searchParams: {
    org?: string;           // Optional organization subdomain from query string
    error?: string;         // Optional error code from redirect
  };
}

// app/signin/components/LoginForm.tsx

interface LoginFormProps {
  organizationId?: string;
  applicationId?: string;
  organizationName?: string;
  onError?: (error: AuthError) => void;
}

interface LoginFormState {
  isLoading: boolean;
  error: string | null;
}
```

---

## 4. Callback Page Props

```typescript
// app/callback/page.tsx

interface CallbackPageProps {
  searchParams: {
    code?: string;          // OAuth authorization code
    state?: string;         // OAuth state parameter
    error?: string;         // Error code if auth failed
    error_description?: string;
  };
}

interface CallbackState {
  status: 'processing' | 'success' | 'error';
  error?: AuthError;
}
```

---

## 5. Dashboard Page Props

```typescript
// app/dashboard/page.tsx

interface DashboardPageProps {
  // No props needed - reads auth state from context
}

interface DashboardState {
  user: User;
  organization: OrganizationContext;
}
```

---

## 6. Zitadel Configuration Interface

```typescript
// lib/auth/zitadel.ts

import { UserManagerSettings } from 'oidc-client-ts';

interface ZitadelConfig extends UserManagerSettings {
  authority: string;
  client_id: string;
  redirect_uri: string;
  post_logout_redirect_uri: string;
  response_type: 'code';
  scope: string;
  automaticSilentRenew: boolean;
  accessTokenExpiringNotificationTimeInSeconds: number;
  loadUserInfo: boolean;
}

interface DynamicZitadelConfig {
  /**
   * Reconfigure client ID for organization-specific application
   */
  setClientId(clientId: string): void;
  
  /**
   * Build organization-specific scope
   */
  buildScope(organizationId: string): string;
}
```

---

## 7. Organization API Contract

```typescript
// Reusing existing API from packages/apis/src/organization.ts

interface GetOrganizationBySubdomainParams {
  subdomain: string;
}

interface OrganizationResponse {
  id: string;
  name: string;
  subdomain: string;
  applicationId: string;      // NEW FIELD (from clarification) - used as Zitadel client_id
  zitadelOrgId: string;
  zitadelProjectId: string;
}

// Function signature (already exists, no changes needed):
export async function getOrganizationBySubdomain(
  subdomain: string
): Promise<OrganizationResponse>;
```

---

## 8. Auth Error Codes

```typescript
// lib/auth/errors.ts

enum AuthErrorCode {
  // User errors (show friendly message)
  ACCESS_DENIED = 'ACCESS_DENIED',
  ORG_NOT_FOUND = 'ORG_NOT_FOUND',
  NETWORK_ERROR = 'NETWORK_ERROR',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  
  // System errors (log details, show generic message)
  INVALID_STATE = 'INVALID_STATE',
  TOKEN_EXCHANGE_FAILED = 'TOKEN_EXCHANGE_FAILED',
  REFRESH_FAILED = 'REFRESH_FAILED',
  UNEXPECTED_ERROR = 'UNEXPECTED_ERROR',
}

interface AuthErrorMessages {
  [AuthErrorCode.ACCESS_DENIED]: 'Access denied. Please contact your administrator.';
  [AuthErrorCode.ORG_NOT_FOUND]: 'Organization not found. Please check the subdomain.';
  [AuthErrorCode.NETWORK_ERROR]: 'Network error. Please check your connection and try again.';
  [AuthErrorCode.TOKEN_EXPIRED]: 'Your session has expired. Please sign in again.';
  [AuthErrorCode.INVALID_STATE]: 'Authentication failed. Please try again.';
  [AuthErrorCode.TOKEN_EXCHANGE_FAILED]: 'Authentication failed. Please try again.';
  [AuthErrorCode.REFRESH_FAILED]: 'Session refresh failed. Please sign in again.';
  [AuthErrorCode.UNEXPECTED_ERROR]: 'An unexpected error occurred. Please try again.';
}
```

---

## 9. Auth Hooks

```typescript
// lib/auth/hooks.ts

/**
 * Hook to access auth context
 */
function useAuth(): AuthContextValue;

/**
 * Hook to protect routes - redirects to signin if not authenticated
 */
function useRequireAuth(): User;

/**
 * Hook to get organization context
 */
function useOrganization(): OrganizationContext | null;

/**
 * Hook to check if user is authenticated (without redirecting)
 */
function useIsAuthenticated(): boolean;
```

---

## 10. Component Event Handlers

```typescript
// Type definitions for component event handlers

type LoginHandler = () => Promise<void>;
type LogoutHandler = () => Promise<void>;
type ErrorHandler = (error: AuthError) => void;
type OrganizationSelectHandler = (subdomain: string) => Promise<void>;
```

---

## Contract Validation Checklist

### Type Safety
- [ ] All interfaces exported from appropriate modules
- [ ] No `any` types used (except for unavoidable library types)
- [ ] All async functions return `Promise<T>`
- [ ] Error types properly defined and thrown

### Consistency
- [ ] Naming follows camelCase convention
- [ ] Interface names use `I` prefix or descriptive suffix (e.g., `Props`, `State`, `Context`)
- [ ] Hook names start with `use`
- [ ] Event handler names end with `Handler`

### Documentation
- [ ] All public interfaces have JSDoc comments
- [ ] Complex types have usage examples
- [ ] Error codes have user-facing messages defined

### Testing
- [ ] All interfaces can be mocked for testing
- [ ] Hook return values can be stubbed
- [ ] Error scenarios have defined error codes

---

## Summary

**Total Interfaces**: 10 core interfaces + 8 error codes + 4 hooks  
**External Dependencies**: `oidc-client-ts`, `@zitadel/react`  
**No Backend Changes**: Reuses existing `GetOrganizationBySubdomain` RPC  
**Type Safety**: Full TypeScript coverage, no `any` types  

**Next**: Create quickstart.md with test scenarios

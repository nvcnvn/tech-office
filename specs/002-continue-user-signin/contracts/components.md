# Component Contracts

**Feature**: `002-continue-user-signin`  
**Date**: October 25, 2025

This document defines the component hierarchy, props, and behavior contracts for the authentication UI.

---

## Component Hierarchy

```
app/
├── layout.tsx (root)
│   └── AuthProvider (wraps all pages)
│
├── signin/
│   └── page.tsx (SignInPage)
│       ├── OrganizationSelector (existing, may need modifications)
│       └── LoginForm (NEW)
│           ├── Button (MUI)
│           ├── CircularProgress (MUI)
│           └── Alert (MUI - for errors)
│
├── callback/
│   └── page.tsx (CallbackPage) (NEW)
│       ├── CircularProgress (MUI)
│       └── Alert (MUI - for errors)
│
└── dashboard/
    └── page.tsx (DashboardPage) (NEW)
        ├── Card (MUI)
        ├── Typography (MUI)
        ├── Button (MUI - logout)
        └── UserProfile (inline component)
```

---

## 1. AuthProvider Component

**Purpose**: Wrap entire application with authentication context

**File**: `lib/auth/auth-context.tsx`

**Props**:
```typescript
interface AuthProviderProps {
  children: React.ReactNode;
}
```

**State**:
```typescript
interface AuthProviderState {
  user: User | null;
  isLoading: boolean;
  error: AuthError | null;
  organization: OrganizationContext | null;
}
```

**Behavior**:
- Initializes Zitadel auth instance
- Loads user from localStorage on mount
- Provides auth context to all child components
- Handles automatic token refresh via @zitadel/react
- Broadcasts auth state changes

**Context Value**:
```typescript
{
  user,
  isAuthenticated: !!user && !user.expired,
  isLoading,
  error,
  organization,
  login: (scope?) => Promise<void>,
  logout: () => Promise<void>,
  setOrganization: (org) => void,
  clearError: () => void,
}
```

---

## 2. SignInPage Component

**Purpose**: Main sign-in page with organization selection and login

**File**: `app/signin/page.tsx`

**Props**:
```typescript
interface SignInPageProps {
  searchParams: {
    org?: string;
    error?: string;
  };
}
```

**State**:
```typescript
interface SignInPageState {
  organization: OrganizationContext | null;
  isLoadingOrg: boolean;
  orgError: string | null;
}
```

**Behavior**:
- On mount: Check for existing auth (immediate redirect to /dashboard if authenticated)
- Extract subdomain from URL or query param
- Fetch organization details via API
- Handle organization lookup errors inline
- Pass organization to LoginForm
- Display error from query param if present

**Rendering Logic**:
```typescript
if (isAuthenticated) {
  // Immediate redirect, no UI rendered
  router.push('/dashboard');
  return null;
}

if (isLoadingOrg) {
  return <CircularProgress />;
}

if (orgError) {
  return (
    <>
      <Alert severity="error">{orgError}</Alert>
      <OrganizationSelector onSelect={handleOrgSelect} />
    </>
  );
}

return (
  <>
    <OrganizationSelector 
      initialValue={organization?.subdomain}
      onSelect={handleOrgSelect}
    />
    {organization && (
      <LoginForm
        organizationId={organization.id}
        applicationId={organization.applicationId}
        organizationName={organization.name}
      />
    )}
  </>
);
```

---

## 3. LoginForm Component

**Purpose**: Zitadel login button with loading/error states

**File**: `app/signin/components/LoginForm.tsx`

**Props**:
```typescript
interface LoginFormProps {
  organizationId: string;
  applicationId: string;
  organizationName: string;
  onError?: (error: AuthError) => void;
}
```

**State**:
```typescript
interface LoginFormState {
  isLoading: boolean;
  error: string | null;
}
```

**Behavior**:
- Reconfigure Zitadel client_id with applicationId
- Build organization-specific OIDC scope
- On button click: Initiate OAuth flow
- Disable button while loading
- Show error inline if login initiation fails
- Redirect to Zitadel (user leaves the app)

**Rendering**:
```tsx
<Card>
  <Typography variant="h5">
    Sign in to {organizationName}
  </Typography>
  
  {error && (
    <Alert severity="error" onClose={() => setError(null)}>
      {error}
    </Alert>
  )}
  
  <Button
    variant="contained"
    size="large"
    onClick={handleLogin}
    disabled={isLoading}
    startIcon={isLoading ? <CircularProgress size={20} /> : null}
  >
    {isLoading ? 'Signing in...' : 'Login with Zitadel'}
  </Button>
</Card>
```

**Event Handlers**:
```typescript
const handleLogin = async () => {
  try {
    setIsLoading(true);
    setError(null);
    
    // Reconfigure client ID
    zitadelAuth.userManager.settings.client_id = applicationId;
    
    // Build org-specific scope
    const scope = buildOidcScope(organizationId);
    
    // Initiate OAuth flow (redirects to Zitadel)
    await zitadelAuth.signinRedirect({ scope });
  } catch (err) {
    setError('Failed to initiate login. Please try again.');
    setIsLoading(false);
    onError?.(mapToAuthError(err));
  }
};
```

---

## 4. CallbackPage Component

**Purpose**: Handle OAuth callback and token exchange

**File**: `app/callback/page.tsx`

**Props**:
```typescript
interface CallbackPageProps {
  searchParams: {
    code?: string;
    state?: string;
    error?: string;
    error_description?: string;
  };
}
```

**State**:
```typescript
interface CallbackPageState {
  status: 'processing' | 'success' | 'error';
  error?: AuthError;
}
```

**Behavior**:
- On mount: Immediately process callback
- Validate OAuth state parameter (CSRF protection)
- Exchange authorization code for tokens (via @zitadel/react)
- Store tokens in localStorage (automatic)
- On success: Redirect to /dashboard
- On error: Show error and provide "Try Again" button

**Rendering Logic**:
```tsx
if (status === 'processing') {
  return (
    <Box textAlign="center">
      <CircularProgress size={60} />
      <Typography variant="h6">Completing sign-in...</Typography>
    </Box>
  );
}

if (status === 'error') {
  return (
    <Alert severity="error">
      <AlertTitle>Authentication Failed</AlertTitle>
      {error.userMessage}
      <Button onClick={() => router.push('/signin')}>
        Try Again
      </Button>
    </Alert>
  );
}

// Success case - redirect happens before render
return null;
```

**Event Handlers**:
```typescript
useEffect(() => {
  const processCallback = async () => {
    try {
      // Check for OAuth error
      if (searchParams.error) {
        throw new AuthError(
          searchParams.error,
          searchParams.error_description || 'Authentication failed'
        );
      }
      
      // Process callback (exchanges code for tokens)
      await zitadelAuth.userManager.signinRedirectCallback();
      
      setStatus('success');
      router.push('/dashboard');
    } catch (err) {
      setStatus('error');
      setError(mapToAuthError(err));
    }
  };
  
  processCallback();
}, []);
```

---

## 5. DashboardPage Component

**Purpose**: Placeholder dashboard showing user info

**File**: `app/dashboard/page.tsx`

**Props**: None (server component, uses auth context)

**Behavior**:
- Protect route: Redirect to /signin if not authenticated
- Display user profile from token claims
- Show "Dashboard - Coming Soon" message
- Provide logout button

**Rendering**:
```tsx
'use client';

export default function DashboardPage() {
  const { user, organization, logout, isAuthenticated } = useAuth();
  const router = useRouter();
  
  // Protect route
  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/signin');
    }
  }, [isAuthenticated]);
  
  if (!user) {
    return <CircularProgress />;
  }
  
  return (
    <Container>
      <Card>
        <CardContent>
          <Typography variant="h4">
            Dashboard - Coming Soon
          </Typography>
          
          <Box mt={3}>
            <Typography variant="h6">
              Welcome, {user.profile.name}!
            </Typography>
            <Typography color="text.secondary">
              {user.profile.email}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Organization: {organization?.name}
            </Typography>
          </Box>
          
          <Box mt={3}>
            <Button 
              variant="outlined" 
              color="primary"
              onClick={handleLogout}
            >
              Logout
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Container>
  );
}

const handleLogout = async () => {
  await logout();
  router.push('/signin');
};
```

---

## Component Testing Contracts

### SignInPage Tests
```typescript
describe('SignInPage', () => {
  it('redirects to dashboard if already authenticated');
  it('fetches organization from subdomain');
  it('shows inline error if organization not found');
  it('shows inline error if network error');
  it('disables login button until organization loaded');
  it('passes organization data to LoginForm');
});
```

### LoginForm Tests
```typescript
describe('LoginForm', () => {
  it('displays organization name');
  it('disables button while loading');
  it('calls zitadelAuth.signinRedirect with correct scope');
  it('shows error if login initiation fails');
  it('clears error when user clicks close');
});
```

### CallbackPage Tests
```typescript
describe('CallbackPage', () => {
  it('shows loading state while processing');
  it('redirects to dashboard on success');
  it('shows error if callback fails');
  it('shows error if OAuth error in URL');
  it('provides try again button on error');
});
```

### DashboardPage Tests
```typescript
describe('DashboardPage', () => {
  it('redirects to signin if not authenticated');
  it('displays user name and email');
  it('displays organization name');
  it('logs out and redirects on logout button click');
});
```

---

## MUI Components Used

**From @mui/material**:
- `Button` - Primary actions (login, logout, try again)
- `Card` / `CardContent` - Content containers
- `Typography` - Text display
- `Alert` / `AlertTitle` - Error messages
- `CircularProgress` - Loading indicators
- `Box` - Layout/spacing
- `Container` - Page-level container

**Theme Integration**:
- All components use existing MUI theme (no custom styling needed)
- Follow responsive design patterns
- Use theme color palette (`primary`, `error`, `text.secondary`)

---

## Summary

**Total Components**: 5 (1 provider + 4 pages)  
**New Components**: 4 (AuthProvider, LoginForm, CallbackPage, DashboardPage)  
**Modified Components**: 1 (SignInPage - add auth check)  
**MUI Components**: 9 different component types  
**Test Scenarios**: 15 total component tests  

**Next**: Create quickstart.md with end-to-end test scenarios

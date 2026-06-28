# Research: Organization SignUp Implementation

**Feature**: Organization SignUp on Web  
**Date**: October 25, 2025  
**Status**: Complete

## Executive Summary

The organization signup feature requires primarily frontend implementation. The backend RPC service, database schema, and Zitadel integration are already complete. This research confirms existing patterns and identifies specific implementation approaches for the Next.js App Router frontend with MUI components.

## Backend Analysis

### ✅ Existing Implementation Review

**RPC Service**: `backend/internal/organization/organization.go`
- ✅ `RegisterOrganizationWithAdminPassword` endpoint exists
- ✅ Handles atomic transaction with PostgreSQL and Zitadel
- ✅ Creates: organization → identity → organization_owner → identity_role
- ✅ Calls Zitadel API: CreateOrganization, CreateUser, CreateProject, CreateApplication, AddUserToOrg
- ✅ Automatic rollback on any failure
- ✅ Structured logging with slog

**Database Schema**: `backend/database/scripts/schema.sql`
- ✅ Multi-tenant design with organization_id constraints
- ✅ Schemas: `iam` (identity), `public` (organization)
- ✅ Tables: `iam.identity`, `public.organization`, `public.organization_owner`, `iam.identity_role`
- ✅ UUID v7 primary keys
- ✅ Unique constraints: email (identity), subdomain (organization)

**Queries**: `backend/database/scripts/public.query.sql`
- ✅ `CheckOrganizationSubdomainAvailable` - real-time validation
- ✅ `GetOrganizationBySubdomain` - subdomain lookup
- ✅ `CreateOrganization`, `CreateIdentity`, `CreateOrganizationOwner` - entity creation

**Proto Contract**: `backend/rpc/v1/organization.proto`
```protobuf
rpc RegisterOrganizationWithAdminPassword(RegisterOrganizationWithAdminPasswordRequest) 
  returns (RegisterOrganizationWithAdminPasswordResponse) {
  option (rpc.v1.access_control) = {
    allow_unauthenticated: true
  };
}

message RegisterOrganizationWithAdminPasswordRequest {
  string company_name = 1;
  string subdomain = 2;
  string admin_email = 3;
  string admin_password = 4;
  string admin_given_name = 5;
  string admin_family_name = 6;
}
```

**Decision**: No backend changes required. All functionality exists.

---

## Frontend Analysis

### Tech Stack Confirmation

**Next.js 15 App Router**
- **Pattern**: File-based routing with `app/` directory
- **Decision**: Create `/signup/page.tsx` for public-facing signup
- **Rationale**: App Router supports RSC and better performance

**Material-UI v7.2.0**
- **Existing Usage**: Confirmed in `frontend/package.json`
- **Decision**: Use MUI components (TextField, Button, Box, Container, Alert)
- **Pattern**: Custom theme already exists in `apps/web/src/app/`
- **Rationale**: Consistent with existing Tech Office UI

**Form Management**
- **Options Considered**:
  1. React Hook Form + Zod
  2. Formik + Yup
  3. Native React state with custom validation
- **Decision**: React Hook Form + Zod
- **Rationale**:
  - Type-safe validation with Zod schemas
  - Better performance (uncontrolled components)
  - Smaller bundle size vs Formik
  - Easy integration with MUI TextField
- **Existing Pattern**: Not currently used, but widely adopted in Next.js ecosystem

**API Client Pattern**
- **Existing**: `frontend/packages/apis/src/organization.ts`
- **Pattern**: Wrapper functions around RPC client with error mapping
- **Example**:
```typescript
export async function getOrganizationBySubdomain(subdomain: string): Promise<Organization> {
  return rpcCall(async () => {
    const resp = await organizationClient.getOrganizationBySubdomain({ subdomain });
    if (!resp.organization) {
      throw new OrganizationError('ORGANIZATION_NOT_FOUND', ...);
    }
    return { /* map DTO */ };
  });
}
```
- **Decision**: Follow same pattern for `registerOrganizationWithAdminPassword`
- **Error Classes**: Use existing `APIError`, `ValidationError`, `NetworkError` from `errors.ts`

---

## Validation Strategy

### Password Requirements
**Spec**: Minimum 16 characters, must contain numbers and alphabetic characters

**Implementation Approach**:
```typescript
const passwordSchema = z.string()
  .min(16, "Password must be at least 16 characters")
  .regex(/[0-9]/, "Password must contain at least one number")
  .regex(/[a-zA-Z]/, "Password must contain at least one letter");
```

**UI Feedback**: Real-time validation with visual indicators (PasswordStrength component)
- Red/Yellow/Green strength meter
- Checklist: ✓ Min 16 chars, ✓ Contains number, ✓ Contains letter

### Email Validation
**Spec**: Valid email format, unique within organization

**Implementation**:
```typescript
const emailSchema = z.string()
  .email("Please enter a valid email address")
  .max(255, "Email too long");
```

**Backend Validation**: Uniqueness checked in `RegisterOrganizationWithAdminPassword`

### Subdomain Validation
**Spec**: DNS-compliant, alphanumeric + hyphens, max 32 characters

**Implementation**:
```typescript
const subdomainSchema = z.string()
  .min(3, "Subdomain must be at least 3 characters")
  .max(32, "Subdomain must be 32 characters or less")
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, 
    "Subdomain must start and end with letter/number, only lowercase letters, numbers, and hyphens allowed");
```

**Real-Time Availability Check**:
- Debounced API call (500ms) to `CheckOrganizationSubdomainAvailable`
- Visual feedback: Available ✓ / Taken ✗ / Checking...
- Custom hook: `useSubdomainCheck(subdomain, debounceMs=500)`

---

## User Experience Flow

### Happy Path
1. User lands on `/signup` page
2. Fills out form fields (real-time validation feedback)
3. Checks subdomain availability (debounced, shows spinner)
4. Submits form → Button shows loading spinner, is disabled
5. Backend creates organization + identity + Zitadel user (atomic)
6. Success confirmation → "Registration successful! You can now log in."
7. Redirect to `/login` with pre-filled subdomain

### Error Scenarios

**Frontend Validation Errors**:
- Invalid email format → Red helper text under field
- Password too short → Helper text + strength indicator
- Subdomain format invalid → Red helper text
- Missing required fields → Highlight in red on submit

**Backend Errors**:
- Subdomain already taken (race condition) → Alert banner: "This subdomain is no longer available"
- Email already exists → Alert banner: "This email is already registered"
- Zitadel unavailable → Alert banner: "Registration service is temporarily unavailable. Please try again later."
- Network error → Alert banner: "Connection error. Please check your internet and try again."

**Error Handling Pattern**:
```typescript
try {
  await registerOrganization(data);
  router.push('/login?subdomain=' + data.subdomain);
} catch (err) {
  if (err instanceof ValidationError) {
    // Show field-specific errors
  } else if (err instanceof OrganizationError) {
    // Show subdomain/email taken error
  } else if (err instanceof NetworkError) {
    // Show retry message
  } else {
    // Generic error
  }
}
```

---

## Component Architecture

### Page Structure
```
/signup/page.tsx
├── SignupForm (main container)
│   ├── OrganizationFields
│   │   ├── TextField (company_name)
│   │   └── SubdomainField (with availability check)
│   ├── AdminFields
│   │   ├── TextField (email)
│   │   ├── PasswordField (with strength indicator)
│   │   ├── TextField (given_name)
│   │   └── TextField (family_name)
│   ├── SubmitButton (with loading state)
│   └── ErrorAlert (conditional)
└── SignupSuccess (conditional, shown after successful registration)
```

### State Management
**Decision**: Co-located state with React Hook Form
- Form state: `useForm<SignupFormData>()`
- Subdomain availability: `useSubdomainCheck(subdomain)`
- Submission state: `isSubmitting` from useForm
- Error state: Controlled by error boundaries + local state

**Rationale**: Simple, no need for global state (Redux/Zustand) for a single-page form

---

## Security Considerations

### CSRF Protection
**Next.js Built-in**: Server Actions and API Routes have CSRF protection by default
**Decision**: Use Next.js defaults, no additional middleware needed

### Rate Limiting
**Current State**: Not implemented in backend
**Recommendation**: Backend should add rate limiting (future enhancement)
**Frontend Impact**: None (backend concern)

### Input Sanitization
**Frontend**: Validation only (Zod schemas)
**Backend**: PostgreSQL parameterized queries (sqlc) prevent SQL injection
**Zitadel**: API client handles escaping

### Password Security
**Frontend**: Never log or expose password
**Backend**: Sent over HTTPS to Zitadel (not stored in Tech Office DB)
**Zitadel**: Handles password hashing and security

---

## Performance Optimization

### Bundle Size
- **MUI Tree Shaking**: Import only needed components
- **Code Splitting**: Next.js automatic for page routes
- **Dynamic Imports**: Not needed for signup (critical path)

### API Calls
- **Subdomain Check**: Debounced (500ms) to reduce backend load
- **Form Submit**: Single RPC call, atomic backend transaction
- **Optimistic Updates**: Not applicable (registration is stateful)

### Loading States
- **Submit Button**: Show CircularProgress during submission
- **Subdomain Check**: Inline spinner next to field
- **Full Page**: No need for loading.tsx (form is immediate)

---

## Testing Strategy (Post-Implementation)

### Unit Tests
1. **Validation Functions**: `password.test.ts`, `email.test.ts`, `subdomain.test.ts`
2. **Custom Hooks**: `useSubdomainCheck.test.ts`, `useSignupForm.test.ts`
3. **API Wrapper**: `organization.test.ts` (mock RPC client)

### Component Tests
1. **SignupForm.test.tsx**: Form rendering, validation feedback
2. **PasswordStrength.test.tsx**: Strength indicator logic
3. **SubdomainCheck.test.tsx**: Availability check UI states

### Integration Tests
1. **E2E Signup Flow**: Fill form → submit → verify success redirect
2. **Error Scenarios**: Invalid subdomain, network error, backend error

### Manual Testing Checklist
- [ ] Submit valid form → organization created in DB
- [ ] Check Zitadel → user account exists
- [ ] Try duplicate subdomain → error shown
- [ ] Try weak password → validation error
- [ ] Try invalid email → validation error
- [ ] Disconnect network → network error shown
- [ ] Abandon form halfway → no data saved

---

## Dependencies

### New NPM Packages Needed
```json
{
  "react-hook-form": "^7.x",
  "zod": "^3.x",
  "@hookform/resolvers": "^3.x"
}
```

**Installation Command**:
```bash
cd frontend && pnpm add react-hook-form zod @hookform/resolvers -w
```

### Existing Dependencies (No Changes)
- `@mui/material`: ✅ Already installed (v7.2.0)
- `next`: ✅ Already installed (v15)
- `react`: ✅ Already installed
- `frontend/packages/rpc`: ✅ RPC client exists
- `frontend/packages/apis`: ✅ API wrapper patterns exist

---

## Existing Patterns to Follow

### 1. API Wrapper Pattern (`packages/apis/src/organization.ts`)
```typescript
export async function getOrganizationBySubdomain(subdomain: string): Promise<Organization> {
  return rpcCall(async () => {
    const resp = await organizationClient.getOrganizationBySubdomain({ subdomain });
    // Error mapping, DTO conversion
    return { /* typed response */ };
  });
}
```
**Apply to**: `registerOrganizationWithAdminPassword`

### 2. Error Handling (`packages/apis/src/errors.ts`)
```typescript
export class OrganizationError extends APIError { /* ... */ }
export class ValidationError extends APIError { /* ... */ }
export class NetworkError extends APIError { /* ... */ }
```
**Apply to**: Catch and map errors in signup form

### 3. MUI Theme Usage
**Existing**: `apps/web/src/app/theme` (assumed based on monorepo structure)
**Apply to**: Use theme colors, spacing, and component defaults

### 4. Next.js App Router Page Structure
**Pattern**: `apps/web/src/app/[route]/page.tsx`
**Apply to**: Create `apps/web/src/app/signup/page.tsx`

---

## Alternatives Considered

### Form Management
| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| React Hook Form + Zod | Type-safe, performant, small bundle | Extra dependency | ✅ **Selected** |
| Formik + Yup | Popular, mature | Larger bundle, slower | ❌ Rejected |
| Native React state | No dependencies | More boilerplate, no validation lib | ❌ Rejected |

### Component Library
| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| MUI v7 | Already in project, consistent | - | ✅ **Selected** |
| Headless UI | Smaller bundle | Style from scratch, inconsistent | ❌ Rejected |
| Chakra UI | Good DX | Migration cost, bundle size | ❌ Rejected |

### State Management
| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| React Hook Form state | Simple, co-located | - | ✅ **Selected** |
| Redux Toolkit | Global state, middleware | Overkill for single form | ❌ Rejected |
| Zustand | Lightweight global state | Unnecessary complexity | ❌ Rejected |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Subdomain race condition (check → submit) | Medium | Low | Backend handles with unique constraint error |
| Zitadel API failure during signup | Low | High | Backend atomic transaction rolls back DB changes |
| Slow subdomain availability check | Low | Medium | Debounce (500ms), show loading state |
| Password leaked in logs | Low | High | Never log password, use HTTPS, secure headers |
| Frontend bundle size increase | Low | Low | Tree-shake MUI, monitor with Next.js bundle analyzer |

---

## Open Questions (Resolved)

1. ~~Should we add email verification flow?~~ → No, FR-013 confirms email_verified=false initially, separate workflow
2. ~~Should user be auto-logged in after signup?~~ → No, redirect to login page (FR-011)
3. ~~Should we save partial form data?~~ → No, require complete submission (Clarification)
4. ~~Is subdomain check authenticated?~~ → Yes, uses ROLE_EMPLOYEE (see proto), but signup is public
   - **Update**: Use public endpoint `GetOrganizationBySubdomain` for availability check instead

---

## Implementation Recommendations

### Phase 1: Core Signup Form (Priority)
1. Create `/signup/page.tsx` with basic form structure
2. Implement validation with Zod schemas
3. Add API wrapper `registerOrganizationWithAdminPassword` in `packages/apis`
4. Connect form submission to API
5. Add loading states and error handling

### Phase 2: Enhanced UX
1. Real-time subdomain availability check
2. Password strength indicator
3. Success confirmation page/modal
4. Field-specific error messages
5. Form accessibility (ARIA labels, keyboard nav)

### Phase 3: Polish & Testing
1. Add component tests
2. Add E2E signup flow test
3. Manual testing with dev environment
4. Performance profiling (Lighthouse)

---

## References

- **Backend Service**: `backend/internal/organization/organization.go`
- **Proto Contract**: `backend/rpc/v1/organization.proto`
- **Database Schema**: `backend/database/scripts/schema.sql`
- **Existing API Pattern**: `frontend/packages/apis/src/organization.ts`
- **MUI Documentation**: https://mui.com/material-ui/
- **Next.js App Router**: https://nextjs.org/docs/app
- **React Hook Form**: https://react-hook-form.com/
- **Zod**: https://zod.dev/

---

**Status**: ✅ Research complete, ready for Phase 1 (Design & Contracts)

# Tasks: Organization SignUp on Web

**Input**: Design documents from `/Users/nvcnvn/Codes/tech-office/specs/001-organization-signup-on/`
**Prerequisites**: plan.md, research.md, data-model.md, contracts/, quickstart.md

## Execution Summary

This task list implements a **frontend-only** organization signup feature. The backend RPC service, database schema, and Zitadel integration are already complete. Tasks focus on building a Next.js signup form with MUI components, Zod validation, real-time subdomain checking, and comprehensive error handling.

**Key Decisions from Plan**:
- Tech Stack: Next.js 15 (App Router), TypeScript, MUI v7.2.0, React Hook Form + Zod
- No backend changes required (all endpoints exist)
- No codegen required (no SQL or proto changes)
- Constitution compliance: Tests added AFTER manual verification (Phase 3.4)

---

## Phase 3.1: Setup & Dependencies

### T001: Install form management dependencies ✅
**File**: `frontend/package.json`  
**Description**: Install required npm packages for form handling and validation  
**Commands**:
```bash
cd /Users/nvcnvn/Codes/tech-office/frontend
pnpm add react-hook-form zod @hookform/resolvers -w
```
**Expected Output**: Packages added to workspace dependencies  
**Verification**: Check `pnpm list react-hook-form zod @hookform/resolvers` shows installed versions  
**Status**: ✅ Complete - Dependencies installed successfully

---

## Phase 3.2: Core Implementation - Validation Layer

**Implementation-first: Build core functionality before tests**

### T002 [P]: Create password validation schema
**File**: `frontend/apps/web/src/lib/validations/password.ts`  
**Description**: Implement password validation with Zod schema enforcing min 16 chars, numbers + letters  
**Reference**: `contracts/validation-schemas.md` (Password Schema section)  
**Implementation**:
- Export `passwordSchema` (Zod schema)
- Export `calculatePasswordStrength()` function (returns 'weak' | 'medium' | 'strong')
- Export `getPasswordValidationDetails()` function (returns checklist object)
- Export `PasswordStrength` type

**Acceptance Criteria**:
- Password < 16 chars rejected
- Password without numbers rejected
- Password without letters rejected
- Valid password accepted
- Strength calculation works correctly

---

### T003 [P]: Create email validation schema
**File**: `frontend/apps/web/src/lib/validations/email.ts`  
**Description**: Implement email validation with Zod schema  
**Reference**: `contracts/validation-schemas.md` (Email Schema section)  
**Implementation**:
- Export `emailSchema` (Zod schema with email format + max 255 chars)
- Export `extractEmailDomain()` utility function

**Acceptance Criteria**:
- Invalid email formats rejected
- Emails > 255 chars rejected
- Valid emails accepted

---

### T004 [P]: Create subdomain validation schema
**File**: `frontend/apps/web/src/lib/validations/subdomain.ts`  
**Description**: Implement DNS-compliant subdomain validation with Zod  
**Reference**: `contracts/validation-schemas.md` (Subdomain Schema section)  
**Implementation**:
- Export `subdomainSchema` (Zod schema: 3-32 chars, DNS-compliant regex, lowercase transform)
- Export `sanitizeSubdomain()` function (removes invalid chars)
- Export `isValidSubdomainFormat()` function (boolean check)
- Export `generateSubdomainSuggestions()` function (from company name)

**Acceptance Criteria**:
- Uppercase letters normalized to lowercase
- Special chars (except hyphens) rejected
- Subdomains starting/ending with hyphen rejected
- Length constraints enforced (3-32 chars)
- Valid subdomains accepted

---

### T005: Create complete signup form schema
**File**: `frontend/apps/web/src/lib/validations/signup.ts`  
**Description**: Combine all field schemas into complete form schema  
**Dependencies**: T002, T003, T004  
**Reference**: `contracts/validation-schemas.md` (Full Signup Form Schema section)  
**Implementation**:
- Import individual schemas from T002-T004
- Export `signupFormSchema` combining all fields
- Export `SignupFormData` type (inferred from schema)
- Export `validateSignupForm()` function

**Acceptance Criteria**:
- All 6 fields validated (companyName, subdomain, adminEmail, adminPassword, adminGivenName, adminFamilyName)
- Type inference works correctly
- Missing fields rejected
- Complete valid form data accepted

---

## Phase 3.3: API Integration Layer

### T006 [P]: Add API wrapper for organization registration
**File**: `frontend/packages/apis/src/organization.ts` (modify existing)  
**Description**: Add wrapper functions for signup RPC calls  
**Reference**: `contracts/rpc-contract.md` (Frontend API Wrapper section)  
**Implementation**:
- Add `registerOrganizationWithAdminPassword()` function
  - Takes SignupFormData-like object
  - Calls RPC client's `registerOrganizationWithAdminPassword`
  - Maps response DTO to frontend Organization type
  - Throws typed errors (ValidationError, OrganizationError, NetworkError)
- Add `checkSubdomainAvailability()` function
  - Uses `getOrganizationBySubdomain` (unauthenticated)
  - Returns true if NotFound (available), false if found (taken)
  - Handles errors appropriately

**Acceptance Criteria**:
- API wrapper follows existing pattern from `getOrganizationBySubdomain`
- Error mapping works (409 → OrganizationError, 400 → ValidationError, etc.)
- TypeScript types are correct
- Function signatures match contract spec

---

## Phase 3.4: Custom Hooks (State Management)

### T007: Create subdomain availability check hook
**File**: `frontend/apps/web/src/lib/hooks/useSubdomainCheck.ts`  
**Description**: Debounced subdomain availability checker  
**Dependencies**: T006  
**Reference**: `research.md` (Real-Time Availability Check section)  
**Implementation**:
- Export `useSubdomainCheck(subdomain: string, debounceMs = 500)`
- Returns: `{ isChecking, isAvailable, error }`
- Debounce API calls (500ms default)
- Handle empty subdomain (no check)
- Handle API errors gracefully

**Acceptance Criteria**:
- Debouncing works (no API call until 500ms after last keystroke)
- Loading state tracked correctly
- Available/taken status updated
- Errors handled without crashing

---

### T008: Create signup form state hook
**File**: `frontend/apps/web/src/lib/hooks/useSignupForm.ts`  
**Description**: React Hook Form integration with signup schema  
**Dependencies**: T005  
**Reference**: `contracts/validation-schemas.md` (React Hook Form Integration section)  
**Implementation**:
- Export `useSignupForm()`
- Integrate React Hook Form with `signupFormSchema` via zodResolver
- Handle form submission with error mapping
- Return form methods and state

**Acceptance Criteria**:
- Form validation works with Zod schema
- Field errors displayed correctly
- Submission handling integrated
- Type safety maintained

---

## Phase 3.5: UI Components (Presentational Layer)

### T009 [P]: Create PasswordStrength indicator component
**File**: `frontend/apps/web/src/app/signup/components/PasswordStrength.tsx`  
**Description**: Visual password strength indicator  
**Reference**: `contracts/validation-schemas.md` (Password Schema section)  
**Implementation**:
- Accept `password: string` prop
- Display strength meter (weak/medium/strong with colors)
- Show checklist: ✓ Min 16 chars, ✓ Has number, ✓ Has letter
- Use MUI components (LinearProgress, Box, Typography, Chip)

**Acceptance Criteria**:
- Visual indicator updates in real-time
- Checklist items show check/cross icons
- Strength colors: red (weak), yellow (medium), green (strong)
- Accessible (ARIA labels)

---

### T010 [P]: Create SubdomainCheck component
**File**: `frontend/apps/web/src/app/signup/components/SubdomainCheck.tsx`  
**Description**: Real-time subdomain availability indicator  
**Dependencies**: T007  
**Reference**: `research.md` (Real-Time Availability Check section)  
**Implementation**:
- Accept `subdomain: string` prop
- Use `useSubdomainCheck` hook
- Display status: Checking... | Available ✓ | Taken ✗
- Show inline with TextField (InputAdornment)
- Use MUI components (CircularProgress, CheckCircle, Error icons)

**Acceptance Criteria**:
- Loading spinner shown during check
- Available shows green checkmark
- Taken shows red X with message
- Updates reactively as user types (debounced)

---

### T011: Create OrganizationFields component
**File**: `frontend/apps/web/src/app/signup/components/OrganizationFields.tsx`  
**Description**: Company name and subdomain input fields  
**Dependencies**: T004, T010  
**Reference**: `research.md` (Component Architecture section)  
**Implementation**:
- Accept React Hook Form `register`, `errors` props
- Render company name TextField (MUI)
- Render subdomain TextField with SubdomainCheck integration
- Apply validation errors from form state
- Use MUI Grid for layout

**Acceptance Criteria**:
- Fields render correctly with MUI styling
- Validation errors displayed as helper text
- Subdomain availability check integrated
- Responsive layout

---

### T012: Create AdminFields component
**File**: `frontend/apps/web/src/app/signup/components/AdminFields.tsx`  
**Description**: Admin user credential input fields  
**Dependencies**: T002, T003, T009  
**Reference**: `research.md` (Component Architecture section)  
**Implementation**:
- Accept React Hook Form `register`, `errors` props
- Render email TextField
- Render password TextField with:
  - Visibility toggle (show/hide password)
  - PasswordStrength indicator integration
- Render given name TextField
- Render family name TextField
- Use MUI TextField, IconButton (visibility), Grid

**Acceptance Criteria**:
- All fields render with proper validation
- Password visibility toggle works
- Password strength indicator updates real-time
- Error messages shown as helper text
- Accessible (labels, ARIA)

---

### T013 [P]: Create SignupError component
**File**: `frontend/apps/web/src/app/signup/components/SignupError.tsx`  
**Description**: Error alert banner for backend/network errors  
**Reference**: `research.md` (Error Scenarios section)  
**Implementation**:
- Accept `error: Error | null` prop
- Map error types to user-friendly messages:
  - OrganizationError → "Subdomain/email already registered"
  - NetworkError → "Connection error, please try again"
  - Generic → "An error occurred during registration"
- Use MUI Alert component (severity="error")
- Closeable alert

**Acceptance Criteria**:
- Different error types show appropriate messages
- Alert is dismissible
- Only shown when error exists
- Accessible

---

### T014 [P]: Create SignupSuccess component
**File**: `frontend/apps/web/src/app/signup/components/SignupSuccess.tsx`  
**Description**: Success confirmation UI  
**Reference**: `research.md` (User Experience Flow section)  
**Implementation**:
- Accept `organizationName: string` prop
- Display success message: "Registration successful!"
- Show next steps: "You can now log in to [organization]"
- Include link/button to login page
- Use MUI Alert (severity="success"), Box, Button

**Acceptance Criteria**:
- Success message clear and friendly
- Login link/button functional
- Shown only after successful registration
- Accessible

---

## Phase 3.6: Main Signup Form Integration

### T015: Create SignupForm container component
**File**: `frontend/apps/web/src/app/signup/components/SignupForm.tsx`  
**Description**: Main form component composing all subcomponents  
**Dependencies**: T006, T008, T011, T012, T013, T014  
**Reference**: `research.md` (Component Architecture, Page Structure section)  
**Implementation**:
- Use `useSignupForm` hook from T008
- Call `registerOrganizationWithAdminPassword` from T006 on submit
- Compose OrganizationFields (T011) + AdminFields (T012)
- Show SignupError (T013) on error
- Show SignupSuccess (T014) on success
- Submit button with loading state (disabled + CircularProgress)
- Prevent duplicate submissions
- Handle errors with appropriate error component
- Redirect to login on success
- Use MUI Container, Box, Button, CircularProgress

**Acceptance Criteria**:
- Form renders all subcomponents correctly
- Validation works on all fields
- Submit button disabled during submission
- Loading spinner shown during API call
- Success/error states handled correctly
- No duplicate submissions possible
- Redirect to login after success

---

### T016: Create signup page
**File**: `frontend/apps/web/src/app/signup/page.tsx`  
**Description**: Next.js App Router page for signup route  
**Dependencies**: T015  
**Reference**: `research.md` (Existing Patterns - Next.js App Router)  
**Implementation**:
- Export default page component
- Render SignupForm component from T015
- Add page metadata (title: "Sign Up | Tech Office", description)
- Center form on page with proper spacing
- Use Next.js metadata API
- No authentication required (public page)

**Acceptance Criteria**:
- Page accessible at `/signup`
- SignupForm rendered correctly
- Metadata set correctly
- Page styled consistently with app
- No authentication gate

---

### T017 [P]: Create signup layout (optional)
**File**: `frontend/apps/web/src/app/signup/layout.tsx`  
**Description**: Optional signup-specific layout  
**Reference**: Next.js App Router patterns  
**Implementation**:
- Simple centered layout for signup form
- Minimal header/footer (or none)
- Proper spacing and responsiveness
- Use MUI Box, Container

**Acceptance Criteria**:
- Layout provides clean signup experience
- Responsive on mobile/tablet/desktop
- Consistent with brand styling
- Optional: Can skip if default layout sufficient

---

## Phase 3.7: Manual Verification ⚠️ REQUIRED BEFORE TESTS

**Human developer MUST verify behavior is correct before adding tests**

### T018: Manual test - Happy path registration
**Reference**: `quickstart.md` (Test Scenario 1)  
**Steps**:
1. Start backend server and frontend dev server
2. Navigate to `http://localhost:13000/signup`
3. Fill form with valid test data:
   - Company: Test Corporation
   - Subdomain: testcorp
   - Email: admin@testcorp.com
   - Password: SecurePassword12345678
   - First Name: Jane, Last Name: Doe
4. Submit form
5. Verify success message shown
6. Verify redirect to login
7. Check database:
   ```sql
   SELECT * FROM public.organization WHERE subdomain = 'testcorp';
   SELECT * FROM iam.identity WHERE email = 'admin@testcorp.com';
   SELECT * FROM public.organization_owner WHERE organization_id = (SELECT id FROM public.organization WHERE subdomain = 'testcorp');
   ```
8. Verify Zitadel user created (check Zitadel console)

**Expected**: Organization + identity + owner + role records created, Zitadel user exists

---

### T019: Manual test - Subdomain already taken
**Reference**: `quickstart.md` (Test Scenario 2)  
**Steps**:
1. Pre-create organization with subdomain 'taken' in database
2. Navigate to signup page
3. Fill form with subdomain 'taken'
4. Observe real-time validation shows "taken" status
5. Attempt submission
6. Verify error alert: "Subdomain already registered"
7. Verify no new database records created
8. Edit subdomain to different value
9. Verify can retry successfully

**Expected**: Error handled gracefully, no orphaned records, user can retry

---

### T020: Manual test - Invalid password validation
**Reference**: `quickstart.md` (Test Scenario 3)  
**Steps**:
1. Navigate to signup page
2. Test various invalid passwords:
   - Too short: "short" → Error: "At least 16 characters"
   - No numbers: "passwordwithoutnumbers" → Error: "Must contain number"
   - No letters: "1234567890123456" → Error: "Must contain letter"
3. Enter valid password: "ValidPassword123456"
4. Verify errors clear
5. Verify password strength indicator updates (weak → medium → strong)
6. Complete form and submit successfully

**Expected**: Validation errors shown in real-time, strength indicator works

---

### T021: Manual test - Invalid email and subdomain formats
**Reference**: `quickstart.md` (Test Scenarios 4 & 5)  
**Steps**:
1. Test invalid emails: "notanemail", "missing@domain", "@nodomain.com"
2. Verify error: "Please enter a valid email address"
3. Test invalid subdomains:
   - "UPPERCASE" → normalized or error
   - "has spaces" → error
   - "-startswithhyphen" → error
   - "ab" → error (too short)
   - [33+ chars] → error (too long)
4. Enter valid email and subdomain
5. Verify validation passes

**Expected**: Format validation works correctly with clear error messages

---

### T022: Manual test - Missing required fields
**Reference**: `quickstart.md` (Test Scenario 6)  
**Steps**:
1. Leave all fields empty, submit
2. Verify all fields show "required" error
3. Fill only company name and subdomain, submit
4. Verify remaining fields show "required" error
5. Complete all fields
6. Verify errors clear and form submits

**Expected**: All required fields enforced

---

### T023: Manual test - Network error handling
**Reference**: `quickstart.md` (Test Scenario 7)  
**Steps**:
1. Stop backend server
2. Fill form with valid data
3. Submit form
4. Verify error alert: "Connection error. Please check your internet and try again."
5. Verify form data preserved (not lost)
6. Restart backend server
7. Retry submission
8. Verify registration succeeds

**Expected**: Network errors handled gracefully, data preserved, retry works

---

### T024: Manual test - Zitadel API failure rollback
**Reference**: `quickstart.md` (Test Scenario 8)  
**Steps**:
1. Stop Zitadel service (`docker-compose stop zitadel`)
2. Fill form with valid data (subdomain: rollbacktest)
3. Submit form
4. Verify error: "Service temporarily unavailable"
5. Check database: `SELECT * FROM public.organization WHERE subdomain = 'rollbacktest';`
6. Verify 0 rows (transaction rolled back)
7. Restart Zitadel (`docker-compose start zitadel`)
8. Retry submission
9. Verify registration succeeds

**Expected**: Atomic transaction rollback on Zitadel failure, no orphaned records

---

### T025: Manual test - Password visibility toggle
**Reference**: `quickstart.md` (Test Scenario 10)  
**Steps**:
1. Navigate to signup page
2. Enter password: "MySecretPassword123"
3. Verify password shown as dots: `••••••••••••••••••••`
4. Click "Show Password" icon
5. Verify password revealed: "MySecretPassword123"
6. Click "Hide Password" icon
7. Verify password hidden again

**Expected**: Password visibility toggle works correctly

---

### T026: Document verified behavior
**File**: `frontend/apps/web/src/app/signup/__tests__/VERIFIED_BEHAVIOR.md`  
**Description**: Document all manually verified behaviors as test plan  
**Dependencies**: T018-T025  
**Content**:
- List all verified scenarios from T018-T025
- Describe expected behavior for each
- Note any edge cases discovered during testing
- Serve as specification for automated tests (T027-T033)

**Expected**: Clear documentation of correct behavior ready for test implementation

---

## Phase 3.8: Tests (After Verification)

**Add tests ONLY after T018-T026 confirm correct behavior**

### T027 [P]: Unit tests for validation schemas
**File**: `frontend/apps/web/src/lib/validations/__tests__/signup.test.ts`  
**Dependencies**: T002, T003, T004, T005, T026  
**Reference**: `contracts/validation-schemas.md` (Testing section)  
**Test Coverage**:
- `passwordSchema`: reject short/no-numbers/no-letters, accept valid
- `emailSchema`: reject invalid formats, accept valid
- `subdomainSchema`: reject invalid formats, normalize uppercase, accept valid
- `signupFormSchema`: validate complete form, reject missing fields

**Test Framework**: Vitest  
**Assertions**: Use `expect(result.success).toBe(true/false)`

---

### T028 [P]: Unit tests for password utilities
**File**: `frontend/apps/web/src/lib/validations/__tests__/password.test.ts`  
**Dependencies**: T002, T026  
**Test Coverage**:
- `calculatePasswordStrength()`: returns correct strength levels
- `getPasswordValidationDetails()`: returns correct checklist

---

### T029 [P]: Unit tests for subdomain utilities
**File**: `frontend/apps/web/src/lib/validations/__tests__/subdomain.test.ts`  
**Dependencies**: T004, T026  
**Test Coverage**:
- `sanitizeSubdomain()`: removes invalid chars correctly
- `generateSubdomainSuggestions()`: generates valid suggestions
- `isValidSubdomainFormat()`: validates format correctly

---

### T030 [P]: API wrapper tests
**File**: `frontend/packages/apis/src/__tests__/organization.test.ts`  
**Dependencies**: T006, T026  
**Reference**: `contracts/rpc-contract.md` (Testing Contract section)  
**Test Coverage**:
- `registerOrganizationWithAdminPassword()`: successful registration, error mapping (409, 400, 500)
- `checkSubdomainAvailability()`: returns true for available, false for taken

**Mock**: RPC client responses  
**Test Framework**: Vitest

---

### T031 [P]: Component test - PasswordStrength
**File**: `frontend/apps/web/src/app/signup/components/__tests__/PasswordStrength.test.tsx`  
**Dependencies**: T009, T026  
**Test Coverage**:
- Renders strength meter
- Updates colors based on strength
- Shows checklist items correctly

**Test Framework**: React Testing Library + Vitest

---

### T032 [P]: Component test - SubdomainCheck
**File**: `frontend/apps/web/src/app/signup/components/__tests__/SubdomainCheck.test.tsx`  
**Dependencies**: T010, T026  
**Test Coverage**:
- Shows loading spinner during check
- Shows available checkmark
- Shows taken error
- Handles errors gracefully

---

### T033 [P]: Component test - SignupForm
**File**: `frontend/apps/web/src/app/signup/components/__tests__/SignupForm.test.tsx`  
**Dependencies**: T015, T026  
**Reference**: `research.md` (Testing Strategy)  
**Test Coverage**:
- Renders all fields
- Validation errors shown
- Submit button disabled during submission
- Success message shown after registration
- Error alert shown on failure

**Mock**: API calls

---

### T034 [P]: E2E test - Signup flow
**File**: `frontend/apps/web/src/app/signup/__tests__/signup-flow.test.tsx`  
**Dependencies**: T016, T026  
**Reference**: `quickstart.md` (Test Scenarios)  
**Test Coverage**:
- Happy path: fill form → submit → success
- Error scenario: duplicate subdomain → error shown
- Validation: invalid inputs → errors shown

**Test Framework**: React Testing Library + Vitest (or Playwright for true E2E)

---

## Phase 3.9: Polish & Optimization

### T035: Accessibility audit
**Dependencies**: T016  
**Reference**: `quickstart.md` (Accessibility Testing)  
**Tasks**:
1. Add ARIA labels to all form fields
2. Verify keyboard navigation (Tab order)
3. Test with screen reader (VoiceOver/NVDA)
4. Ensure focus indicators visible
5. Verify error announcements

**Tools**: axe DevTools, Lighthouse

---

### T036 [P]: Performance optimization
**Dependencies**: T016  
**Reference**: `research.md` (Performance Optimization)  
**Tasks**:
1. Review bundle size (Next.js bundle analyzer)
2. Verify MUI tree shaking working
3. Check for unnecessary re-renders (React DevTools Profiler)
4. Optimize debounce timing if needed
5. Run Lighthouse audit (target: 90+ performance score)

**Expected**: No performance regressions, < 200ms form interactions

---

### T037 [P]: Update API documentation
**File**: `frontend/packages/apis/README.md` or similar  
**Description**: Document new registration API wrapper  
**Content**:
- Function signature for `registerOrganizationWithAdminPassword`
- Example usage
- Error handling examples
- Link to RPC contract

---

### T038: Browser compatibility testing
**Reference**: `quickstart.md` (Browser Compatibility)  
**Browsers**: Chrome, Firefox, Safari, Edge (latest versions)  
**Verify**:
- UI renders consistently
- Validation works
- Form submission works
- No console errors

---

### T039: Final smoke test
**Dependencies**: All previous tasks  
**Description**: End-to-end smoke test of complete feature  
**Steps**:
1. Fresh signup (new subdomain)
2. Verify all validations work
3. Verify database records created
4. Verify Zitadel user created
5. Verify can login with new account
6. Check logs for errors

**Expected**: Complete feature works end-to-end with no issues

---

## Dependencies Graph

```
Setup:
T001

Validation Layer:
T001 → T002 [P], T003 [P], T004 [P]
T002, T003, T004 → T005

API Layer:
T001 → T006 [P]

Hooks:
T006 → T007
T005 → T008

Components:
T001 → T009 [P], T013 [P], T014 [P]
T007 → T010 [P]
T004, T010 → T011
T002, T003, T009 → T012

Main Form:
T006, T008, T011, T012, T013, T014 → T015

Pages:
T015 → T016
T016 → T017 [P]

Manual Verification (REQUIRED GATE):
T016 → T018, T019, T020, T021, T022, T023, T024, T025
T018-T025 → T026

Tests (After Verification):
T002, T026 → T027 [P], T028 [P]
T004, T026 → T029 [P]
T006, T026 → T030 [P]
T009, T026 → T031 [P]
T010, T026 → T032 [P]
T015, T026 → T033 [P]
T016, T026 → T034 [P]

Polish:
T016 → T035, T036 [P], T037 [P], T038
All → T039
```

---

## Parallel Execution Examples

### Example 1: Validation Schemas (after T001)
```bash
# Launch T002-T004 together (different files, no dependencies):
Task: "Create password validation schema in frontend/apps/web/src/lib/validations/password.ts"
Task: "Create email validation schema in frontend/apps/web/src/lib/validations/email.ts"
Task: "Create subdomain validation schema in frontend/apps/web/src/lib/validations/subdomain.ts"
```

### Example 2: Initial Components (after dependencies)
```bash
# Launch T009, T013, T014 together:
Task: "Create PasswordStrength component in frontend/apps/web/src/app/signup/components/PasswordStrength.tsx"
Task: "Create SignupError component in frontend/apps/web/src/app/signup/components/SignupError.tsx"
Task: "Create SignupSuccess component in frontend/apps/web/src/app/signup/components/SignupSuccess.tsx"
```

### Example 3: All Tests (after T026)
```bash
# Launch T027-T034 together (all independent test files):
Task: "Unit tests for validation schemas"
Task: "Unit tests for password utilities"
Task: "Unit tests for subdomain utilities"
Task: "API wrapper tests"
Task: "Component test - PasswordStrength"
Task: "Component test - SubdomainCheck"
Task: "Component test - SignupForm"
Task: "E2E test - Signup flow"
```

---

## Validation Checklist

**Gate: Checked before marking tasks complete**

- [x] All contracts have corresponding implementations (T006 implements RPC contract)
- [x] All validation schemas implemented (T002-T005)
- [x] Manual verification phase present (T018-T026) before tests
- [x] All implementations have tests after verification (T027-T034)
- [x] Parallel tasks truly independent ([P] markers correct)
- [x] Each task specifies exact file path
- [x] No task modifies same file as another [P] task
- [x] No backend changes required (confirmed in plan)
- [x] No codegen required (no SQL or proto changes)
- [x] Constitution compliance: tests after verification

---

## Notes

- **[P] markers**: Tasks can run in parallel (different files, no shared dependencies)
- **Frontend-only**: All backend functionality already exists
- **No codegen**: No `sqlc generate` or `buf generate` required
- **Constitution**: Tests added AFTER manual verification (T018-T026 gate)
- **Commit strategy**: Commit after each task or logical group
- **Total tasks**: 39 numbered tasks
- **Estimated time**: 18-22 hours total development work
- **Critical path**: Setup → Validation → Hooks → Components → Integration → Manual Testing → Automated Tests → Polish

---

**Status**: ✅ Tasks ready for execution  
**Next**: Begin implementation with T001 (install dependencies)

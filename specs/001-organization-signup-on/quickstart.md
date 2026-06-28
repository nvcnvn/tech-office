# Quickstart Guide: Organization SignUp

**Feature**: Organization SignUp on Web  
**Date**: October 25, 2025  
**Purpose**: Manual testing and validation scenarios

## Prerequisites

### Backend Services Running
```bash
# Terminal 1: Start Backend Server
cd backend
go run ./cmd server
# Expected: Server listening on :8080
```

### Frontend Development Server
```bash
# Terminal 2: Start Next.js Dev Server
cd frontend
pnpm web dev
# Expected: Ready on http://localhost:13000
```

---

## Test Scenario 1: Happy Path - Successful Registration

### Objective
Verify complete signup flow from form submission to organization creation

### Steps

1. **Navigate to signup page**
   ```
   Open browser: http://localhost:13000/signup
   ```

2. **Fill out form with valid data**
   ```
   Company Name: Test Corporation
   Subdomain: testcorp
   Admin Email: admin@testcorp.com
   Admin Password: SecurePassword12345678
   First Name: Jane
   Last Name: Doe
   ```

3. **Submit form**
   - Click "Sign Up" or "Create Organization" button
   - Observe loading state (button disabled, spinner shown)

4. **Verify success confirmation**
   - Success message displayed: "Registration successful!"
   - Redirect to login page with pre-filled subdomain

5. **Verify database records**
   ```bash
   # Connect to PostgreSQL
   psql -U <user> -d techoffice

   # Check organization created
   SELECT id, company_name, subdomain FROM public.organization 
   WHERE subdomain = 'testcorp';

   # Check identity created
   SELECT id, email, email_verified FROM iam.identity 
   WHERE email = 'admin@testcorp.com';

   # Check organization owner link
   SELECT * FROM public.organization_owner 
   WHERE organization_id = (SELECT id FROM public.organization WHERE subdomain = 'testcorp');

   # Check identity role
   SELECT * FROM iam.identity_role 
   WHERE organization_id = (SELECT id FROM public.organization WHERE subdomain = 'testcorp')
   AND role = 'owner';
   ```

6. **Verify Zitadel user creation**
   ```
   Open Zitadel Console: http://localhost:18080/ui/console
   Login as admin
   Navigate to: Users
   Search for: admin@testcorp.com
   Verify: User exists with correct name
   ```

### Expected Results
- ✅ Organization record created in `public.organization`
- ✅ Identity record created in `iam.identity` with `email_verified=false`
- ✅ Organization owner link created in `public.organization_owner`
- ✅ Identity role created with `role='owner'`
- ✅ Zitadel user created and linked to organization
- ✅ Frontend shows success message and redirects

---

## Test Scenario 2: Subdomain Already Taken

### Objective
Verify error handling when subdomain is already registered

### Setup
```bash
# Create an organization with subdomain 'taken'
psql -U <user> -d techoffice <<SQL
INSERT INTO public.organization (id, company_name, subdomain, updated_at)
VALUES (gen_random_uuid(), 'Existing Corp', 'taken', now());
SQL
```

### Steps

1. **Navigate to signup page**
   ```
   http://localhost:13000/signup
   ```

2. **Fill out form with existing subdomain**
   ```
   Company Name: New Corporation
   Subdomain: taken
   Admin Email: newadmin@test.com
   Admin Password: AnotherPassword123456
   First Name: John
   Last Name: Smith
   ```

3. **Observe real-time subdomain validation (if implemented)**
   - As user types 'taken', debounced check triggers
   - Red X or error message appears: "This subdomain is already taken"

4. **Attempt form submission**
   - Click "Sign Up" button
   - Observe error alert: "This subdomain is already registered. Please choose a different one."

5. **Verify no database changes**
   ```bash
   psql -U <user> -d techoffice -c \
   "SELECT COUNT(*) FROM public.organization WHERE subdomain = 'taken';"
   # Expected: 1 (only the pre-existing one)
   ```

### Expected Results
- ✅ Real-time validation shows subdomain is taken (before submit)
- ✅ Backend returns error (409 Conflict or similar)
- ✅ Frontend displays user-friendly error message
- ✅ No new organization created
- ✅ Form remains filled (user doesn't lose other input)
- ✅ User can edit subdomain and retry

---

## Test Scenario 3: Invalid Password

### Objective
Verify password validation enforcement

### Steps

1. **Navigate to signup page**

2. **Fill out form with weak password**
   ```
   Company Name: Weak Pass Corp
   Subdomain: weakpass
   Admin Email: admin@weakpass.com
   Admin Password: short
   First Name: Test
   Last Name: User
   ```

3. **Observe password validation feedback**
   - Password field shows error: "Password must be at least 16 characters"
   - Password strength indicator shows "weak" (red)

4. **Update password to missing numbers**
   ```
   Admin Password: passwordwithoutnumbers
   ```
   - Error: "Password must contain at least one number"

5. **Update password to missing letters**
   ```
   Admin Password: 1234567890123456
   ```
   - Error: "Password must contain at least one letter"

6. **Enter valid password**
   ```
   Admin Password: ValidPassword123456
   ```
   - Errors clear
   - Password strength indicator shows "medium" or "strong" (green/yellow)

7. **Submit form**
   - Registration succeeds

### Expected Results
- ✅ Real-time password validation shows specific errors
- ✅ Password strength indicator updates dynamically
- ✅ Submit button disabled until password is valid
- ✅ Valid password allows successful registration

---

## Test Scenario 4: Invalid Email Format

### Objective
Verify email validation

### Steps

1. **Navigate to signup page**

2. **Enter invalid email formats**
   ```
   Admin Email: notanemail
   ```
   - Error: "Please enter a valid email address"

   ```
   Admin Email: missing@domain
   ```
   - Error: "Please enter a valid email address"

   ```
   Admin Email: @nodomain.com
   ```
   - Error: "Please enter a valid email address"

3. **Enter valid email**
   ```
   Admin Email: valid@example.com
   ```
   - Error clears
   - Field shows green checkmark or success state

### Expected Results
- ✅ Invalid emails rejected with clear error messages
- ✅ Valid email format accepted
- ✅ Validation triggers on blur (not while typing)

---

## Test Scenario 5: Invalid Subdomain Format

### Objective
Verify subdomain format validation (DNS-compliant)

### Steps

1. **Navigate to signup page**

2. **Test various invalid subdomain formats**

   ```
   Subdomain: UPPERCASE
   ```
   - Auto-corrected to lowercase: "uppercase" OR Error shown

   ```
   Subdomain: has spaces
   ```
   - Error: "Subdomain can only contain lowercase letters, numbers, and hyphens"

   ```
   Subdomain: -startswithhyphen
   ```
   - Error: "Subdomain must start and end with a letter or number"

   ```
   Subdomain: endwithhyphen-
   ```
   - Error: "Subdomain must start and end with a letter or number"

   ```
   Subdomain: ab
   ```
   - Error: "Subdomain must be at least 3 characters"

   ```
   Subdomain: [33+ characters long]
   ```
   - Error: "Subdomain must be 32 characters or less"

3. **Enter valid subdomain**
   ```
   Subdomain: valid-subdomain123
   ```
   - Error clears
   - Availability check triggers (if implemented)

### Expected Results
- ✅ Invalid formats rejected with specific error messages
- ✅ Valid DNS-compliant subdomains accepted
- ✅ Real-time validation provides immediate feedback

---

## Test Scenario 6: Missing Required Fields

### Objective
Verify all fields are required

### Steps

1. **Navigate to signup page**

2. **Leave all fields empty and submit**
   - All fields show error: "[Field] is required"

3. **Fill only some fields and submit**
   ```
   Company Name: Partial Corp
   Subdomain: partial
   (Leave others empty)
   ```
   - Errors shown for: Admin Email, Admin Password, First Name, Last Name

4. **Complete all fields**
   - All errors clear
   - Submit button becomes enabled

### Expected Results
- ✅ Empty fields highlighted on submit
- ✅ Clear error messages for each missing field
- ✅ Form prevents submission until all required fields filled

---

## Test Scenario 7: Network Error Handling

### Objective
Verify graceful handling of backend unavailability

### Steps

1. **Stop backend server**
   ```bash
   # In backend terminal, press Ctrl+C
   ```

2. **Navigate to signup page**

3. **Fill out form with valid data**

4. **Submit form**
   - Loading state shown
   - After timeout, error alert: "Connection error. Please check your internet and try again."

5. **Restart backend server**
   ```bash
   cd backend
   go run ./cmd server
   ```

6. **Retry submission**
   - Registration succeeds

### Expected Results
- ✅ Network error detected and handled
- ✅ User-friendly error message shown
- ✅ Form data preserved (user doesn't lose input)
- ✅ Retry succeeds after backend recovers

---

## Test Scenario 8: Zitadel API Failure (Rollback)
SKIPPED

---

## Test Scenario 9: Form Abandonment

### Objective
Verify no partial data saved when user navigates away

### Steps

1. **Navigate to signup page**

2. **Fill out half the form**
   ```
   Company Name: Abandoned Corp
   Subdomain: abandoned
   (Leave other fields empty)
   ```

3. **Navigate away** (e.g., close tab, go to another page)

4. **Verify no database records**
   ```bash
   psql -U <user> -d techoffice -c \
   "SELECT * FROM public.organization WHERE subdomain = 'abandoned';"
   # Expected: 0 rows
   ```

5. **Return to signup page**
   - Form is empty (no pre-filled data from abandoned session)

### Expected Results
- ✅ No database records created for abandoned forms
- ✅ No state persisted between sessions
- ✅ User starts fresh on return

---

## Test Scenario 10: Password Visibility Toggle

### Objective
Verify user can toggle password visibility

### Steps

1. **Navigate to signup page**

2. **Enter password**
   ```
   Admin Password: MySecretPassword123
   ```

3. **Observe password field**
   - Initially shown as: `••••••••••••••••••••`

4. **Click "Show Password" icon/button**
   - Password revealed: `MySecretPassword123`

5. **Click "Hide Password" icon/button**
   - Password hidden again: `••••••••••••••••••••`

### Expected Results
- ✅ Password initially hidden
- ✅ Toggle button visible and functional
- ✅ Password can be shown and hidden
- ✅ Password remains secure (not logged, not in URL)

---

## Accessibility Testing

### Keyboard Navigation
1. Tab through all form fields
   - ✅ Logical tab order
   - ✅ Focus indicators visible
   - ✅ Submit button reachable via keyboard

2. Submit form using Enter key
   - ✅ Form submits correctly

3. Use screen reader (VoiceOver on macOS, NVDA on Windows)
   - ✅ Field labels announced
   - ✅ Error messages announced
   - ✅ Success messages announced

---

## Browser Compatibility

### Test on Multiple Browsers
- [ ] Chrome (latest)
- [ ] Firefox (latest)
- [ ] Safari (latest)
- [ ] Edge (latest)

### Expected
- ✅ Consistent UI rendering
- ✅ All validation works
- ✅ No console errors

---
## Troubleshooting

### Common Issues

**Issue**: "Cannot connect to backend"
- **Solution**: Ensure backend server running on http://localhost:18080
- **Check**: `curl http://localhost:18080/health`

**Issue**: "Database connection error"
- **Solution**: Ensure PostgreSQL running
- **Check**: `docker-compose ps postgres`

**Issue**: "Zitadel API error"
- **Solution**: Ensure Zitadel running
- **Check**: `curl http://localhost:18080/ui/console`

**Issue**: "Frontend not loading"
- **Solution**: Ensure Next.js dev server running
- **Check**: `cd frontend && pnpm web dev`

---

## Test Checklist

Use this checklist during manual testing:

- [ ] Happy path registration succeeds
- [ ] Database records created correctly
- [ ] Zitadel user created correctly
- [ ] Duplicate subdomain rejected
- [ ] Duplicate email rejected (within org)
- [ ] Weak password rejected
- [ ] Invalid email format rejected
- [ ] Invalid subdomain format rejected
- [ ] Missing required fields rejected
- [ ] Network error handled gracefully
- [ ] Zitadel failure triggers rollback
- [ ] Abandoned form doesn't save data
- [ ] Password visibility toggle works
- [ ] Real-time subdomain check works
- [ ] Password strength indicator works
- [ ] Success message shown on completion
- [ ] Redirect to login page works
- [ ] Keyboard navigation works
- [ ] Screen reader compatible
- [ ] Works in all major browsers
- [ ] Performance meets targets

---

**Status**: ✅ Quickstart guide complete, ready for manual testing phase

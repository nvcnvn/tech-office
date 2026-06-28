# Quickstart: Employee Import Feature

**Date**: October 25, 2025  
**Feature**: Employee Import  
**Branch**: `003-feature-import-employees`

## Purpose

This quickstart guide provides step-by-step instructions to test the Employee Import feature end-to-end. Use this as an acceptance test after implementation is complete.

---

## Prerequisites

### Environment Setup
- [ ] Backend server running (`cd backend && go run cmd/main.go`)
- [ ] Frontend dev server running (`cd frontend && pnpm web dev`)
- [ ] PostgreSQL database with migrations applied
- [ ] Zitadel instance running and configured
- [ ] Test organization created with owner account

### Test Data
- [ ] Owner account credentials: `owner@testorg.com` / `test-password`
- [ ] Organization subdomain: `testorg`
- [ ] Test `.xlsx` file prepared (see below)

---

## Test Scenario 1: Manual Form Entry (Happy Path)

### Step 1: Login as Owner
1. Navigate to `http://testorg.localhost:13000/signin`
2. Enter credentials: `owner@testorg.com` / `test-password`
3. Click "Sign In"
4. **Expected**: Redirected to dashboard

### Step 2: Navigate to Employee Import
1. Click "Employees" in sidebar
2. Click "Import Employees" button
3. **Expected**: Redirected to `/employees/import`
4. **Expected**: Two-step stepper shown with "Step 1: Enter Data"

### Step 3: Select Manual Entry Method
1. Click "Manual Entry" tab
2. **Expected**: Form with 3 input rows shown
3. **Expected**: "Add Row" and "Remove Row" buttons visible

### Step 4: Enter Employee Data
Enter the following employees:

| Email | Given Name | Family Name |
|-------|-----------|-------------|
| `alice@example.com` | Alice | Smith |
| `bob@example.com` | Bob | Johnson |
| `carol@example.com` | Carol | Williams |

4. Click "Add Row" to add more if needed
5. **Expected**: Inline email validation (format check)
6. **Expected**: Required field indicators on empty fields

### Step 5: Proceed to Preview
1. Click "Next: Preview" button
2. **Expected**: Loading indicator shown
3. **Expected**: API call to `PreviewImport` RPC
4. **Expected**: Transition to "Step 2: Preview & Confirm"

### Step 6: Review Preview
1. **Expected**: Table showing 3 employees
2. **Expected**: All 3 marked as "Will be imported" (green checkmark)
3. **Expected**: 0 duplicates detected
4. **Expected**: Summary stats: "3 valid, 0 duplicates, 3 will import"
5. **Expected**: "Confirm Import" button enabled

### Step 7: Execute Import
1. Click "Confirm Import" button
2. **Expected**: Loading indicator with "Creating employees..."
3. **Expected**: API call to `ExecuteImport` RPC
4. **Expected**: Progress shown (optional)
5. **Expected**: Transition to "Step 3: Results"

### Step 8: Verify Results
1. **Expected**: Success message displayed
2. **Expected**: Summary: "3 imported, 0 skipped, 0 failed"
3. **Expected**: List of created employees with IDs
4. **Expected**: Message: "Verification emails sent by Zitadel"
5. **Expected**: "Import More Employees" button

### Step 9: Verify in Database
Open psql and run:
```sql
SELECT id, email, given_name, family_name, identity_type, email_verified
FROM iam.identity
WHERE organization_id = (SELECT id FROM public.organization WHERE subdomain = 'testorg')
  AND email IN ('alice@example.com', 'bob@example.com', 'carol@example.com');
```

**Expected**:
- 3 rows returned
- `identity_type` = 'human'
- `email_verified` = false

```sql
SELECT ir.role, i.email
FROM iam.identity_role ir
JOIN iam.identity i ON ir.identity_id = i.id
WHERE ir.organization_id = (SELECT id FROM public.organization WHERE subdomain = 'testorg')
  AND i.email IN ('alice@example.com', 'bob@example.com', 'carol@example.com');
```

**Expected**:
- 3 rows returned
- All with `role` = 'employee'

### Step 10: Verify in Zitadel
1. Login to Zitadel admin console
2. Navigate to organization `testorg`
3. Go to Users section
4. **Expected**: 3 new users visible
5. **Expected**: Verification emails sent (check Zitadel email logs)

---

## Test Scenario 2: File Upload (.xlsx)

### Test File Preparation

Create `employees-test.xlsx` with the following content:

| email | given_name | family_name |
|-------|-----------|-------------|
| david@example.com | David | Brown |
| eve@example.com | Eve | Davis |
| frank@example.com | Frank | Miller |
| grace@example.com | Grace | Wilson |
| henry@example.com | Henry | Moore |

**Note**: First row is header, should be skipped by parser.

### Step 1: Navigate to Import Page
1. Go to `/employees/import`
2. Click "File Upload" tab
3. **Expected**: Drag-drop zone shown with ".xlsx files only" message

### Step 2: Upload File
1. Drag `employees-test.xlsx` into drop zone (or click to browse)
2. **Expected**: File selected indicator
3. **Expected**: File size shown
4. **Expected**: "Parse File" button enabled

### Step 3: Parse File
1. Click "Parse File" button
2. **Expected**: Loading indicator "Parsing file..."
3. **Expected**: API call to `ParseFile` RPC
4. **Expected**: Preview populated with 5 employees
5. **Expected**: All fields populated correctly

### Step 4: Preview and Confirm
1. Review parsed data in preview table
2. **Expected**: 5 employees shown
3. **Expected**: All marked as "Will be imported"
4. **Expected**: Summary: "5 valid, 0 duplicates, 5 will import"
5. Click "Confirm Import"

### Step 5: Verify Results
1. **Expected**: Success message
2. **Expected**: "5 imported, 0 skipped"
3. Verify in database (similar to Scenario 1)

---

## Test Scenario 3: Duplicate Detection

### Setup: Import Initial Employee
1. Manually import employee: `duplicate@example.com`, "Duplicate", "User"
2. Confirm successful import

### Test: Attempt to Import Duplicate
1. Navigate to `/employees/import`
2. Enter same employee data:
   - Email: `duplicate@example.com`
   - Given Name: "Duplicate"
   - Family Name: "User"
3. Click "Next: Preview"

### Expected Results
1. **Expected**: Preview shows 1 employee
2. **Expected**: Employee marked as "Duplicate" with warning icon
3. **Expected**: Duplicate reason: "Email already exists in your organization"
4. **Expected**: "Will be imported" = false (red X)
5. **Expected**: Summary: "0 valid, 1 duplicate, 0 will import"
6. **Expected**: "Confirm Import" button disabled or shows "No employees to import"

### Test: Mixed Batch with Duplicates
1. Import batch with:
   - `duplicate@example.com` (duplicate)
   - `newuser@example.com` (new)
   - `anotherdup@example.com` (duplicate, if previously imported)
2. Click "Next: Preview"

### Expected Results
1. **Expected**: 3 employees shown in preview
2. **Expected**: Duplicates clearly highlighted (yellow background)
3. **Expected**: New employee marked green "Will be imported"
4. **Expected**: Summary: "1 valid, 2 duplicates, 1 will import"
5. Click "Confirm Import"
6. **Expected**: Result: "1 imported, 2 skipped"

---

## Test Scenario 4: Validation Errors

### Test File with Errors

Create `employees-errors.xlsx`:

| email | given_name | family_name |
|-------|-----------|-------------|
| invalid-email | Missing | At |
| valid@example.com | | NoLastName |
| another@example.com | NoFirstName | |
| | EmptyEmail | Test |
| toolongemailaddress@verylongdomainnamethatshouldexceedthe255characterlimit.example.com | TooLong | Email |

### Step 1: Upload Error File
1. Navigate to `/employees/import`
2. Upload `employees-errors.xlsx`
3. Click "Parse File"

### Expected Results
1. **Expected**: Validation errors displayed prominently
2. **Expected**: Error list shows:
   - Row 2: "Invalid email format: invalid-email"
   - Row 3: "Missing required field: family_name"
   - Row 4: "Missing required field: given_name"
   - Row 5: "Missing required field: email"
   - Row 6: "Email too long (max 255 characters)"
3. **Expected**: Summary: "0 valid, 5 invalid, 0 will import"
4. **Expected**: "Confirm Import" button disabled
5. **Expected**: "Fix Errors" or "Try Again" button shown

---

## Test Scenario 5: Batch Size Limit

### Test File Exceeding 100 Employees

Create `employees-large.xlsx` with 101 rows (1 header + 101 employees)

### Step 1: Upload Large File
1. Navigate to `/employees/import`
2. Upload file with 101 employees
3. Click "Parse File"

### Expected Results
1. **Expected**: Error message: "File contains 101 employees. Maximum 100 per batch."
2. **Expected**: Suggestion: "Please split into multiple files."
3. **Expected**: Preview not shown
4. **Expected**: "Fix Errors" button allows re-upload

---

## Test Scenario 6: Transaction Rollback

### Setup: Simulate Zitadel Failure

**Note**: This requires backend code modification to test rollback behavior.

1. Temporarily modify `zitadelClient.CreateUser()` to fail for 3rd employee
2. Import batch of 5 employees

### Expected Results
1. **Expected**: Import fails with error message
2. **Expected**: "Transaction rolled back" message
3. **Expected**: Database verification shows 0 new identities created
4. **Expected**: User can retry import

### Verify Rollback
```sql
-- Should return 0 rows for the attempted import
SELECT COUNT(*)
FROM iam.identity
WHERE organization_id = (SELECT id FROM public.organization WHERE subdomain = 'testorg')
  AND email IN ('rollback1@example.com', 'rollback2@example.com', 'rollback3@example.com', 'rollback4@example.com', 'rollback5@example.com');
```

**Expected**: `count = 0` (rollback successful)

---

## Test Scenario 7: Permission Check

### Test: Non-Owner User

1. Create employee account: `employee@testorg.com` with role 'employee'
2. Sign out owner, sign in as employee
3. Navigate to `/employees/import`

### Expected Results
1. **Expected**: Access denied or 403 error
2. **Expected**: Message: "Only organization owners can import employees"
3. **Expected**: Redirect to dashboard or show permission error

---

## Test Scenario 8: Retry After Failure

### Setup: Previous Failed Import

1. Import employees with intentional failure (e.g., Zitadel down)
2. Import fails, transaction rolled back

### Test: Retry Same Employees

1. Fix issue (restart Zitadel)
2. Navigate to `/employees/import` again
3. Enter same employee data
4. Click "Next: Preview"

### Expected Results
1. **Expected**: Preview shows employees as "Will be imported" (not duplicates)
2. **Expected**: No false duplicate detection from failed attempt
3. Click "Confirm Import"
4. **Expected**: Successful import

---

## Performance Benchmarks

### Target Performance

| Operation | Target | Measurement Method |
|-----------|--------|-------------------|
| File upload (100 employees) | <2s | Browser network timing |
| File parsing | <3s | ParseFile RPC duration |
| Preview generation | <5s | PreviewImport RPC duration |
| Import execution | <30s | ExecuteImport RPC duration |
| Total end-to-end (file to results) | <40s | Stopwatch from upload to success message |

### Test Performance

1. Create `.xlsx` file with exactly 100 employees
2. Open browser dev tools → Network tab
3. Upload file and complete import
4. Record timings:
   - ParseFile: _____ seconds
   - PreviewImport: _____ seconds
   - ExecuteImport: _____ seconds
   - Total: _____ seconds
5. **Expected**: All within target ranges

---

## Checklist: Full Feature Verification

- [ ] Manual form entry works
- [ ] File upload (.xlsx) works
- [ ] File parsing handles valid data
- [ ] File parsing detects errors
- [ ] Duplicate detection works in preview
- [ ] Duplicate detection prevents duplicates in execution
- [ ] Validation errors shown comprehensively
- [ ] Batch size limit (100) enforced
- [ ] Transaction rollback works on failure
- [ ] Permission check: only owners can import
- [ ] Retry after failure works correctly
- [ ] Email verification emails sent by Zitadel
- [ ] Database records created correctly
- [ ] Identity roles assigned correctly
- [ ] Multi-tenant isolation enforced
- [ ] Performance targets met
- [ ] UI responsive and user-friendly
- [ ] Error messages clear and actionable

---

## Common Issues & Troubleshooting

### Issue: "Permission Denied" for Owner

**Cause**: Auth token doesn't include 'owner' role claim  
**Fix**: Check Zitadel project role assignments

### Issue: Duplicate Detection Not Working

**Cause**: organization_id mismatch in queries  
**Fix**: Verify auth context passes correct organization_id

### Issue: Transaction Doesn't Rollback

**Cause**: Missing `defer tx.Rollback()` or premature commit  
**Fix**: Review transaction handling in service code

### Issue: Zitadel Users Not Created

**Cause**: Zitadel CreateUser called after commit  
**Fix**: Ensure Zitadel calls inside transaction scope

### Issue: File Upload Fails

**Cause**: Base64 encoding issues or file size limit  
**Fix**: Check file size limit in backend config

---

## Success Criteria

✅ All test scenarios pass  
✅ No regressions in existing features  
✅ Performance targets met  
✅ Database integrity maintained  
✅ Multi-tenant isolation verified  
✅ Error handling graceful and informative  
✅ UI/UX smooth and intuitive

**Status**: Ready for manual verification after implementation

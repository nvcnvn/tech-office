# Quickstart Test Scenarios: Enhanced Employee Import

**Feature**: 004-import-employee-with  
**Date**: October 26, 2025  
**Status**: Complete

## Purpose
This document provides executable test scenarios for validating the enhanced employee import feature with optional fields. These scenarios should be run manually FIRST to verify correct behavior, then automated as integration tests (post-verification testing principle).

## Prerequisites

### Environment Setup
```bash
# 1. Ensure backend server is running
cd /Users/nvcnvn/Codes/tech-office/backend
go run ./cmd server

# 2. Ensure frontend is running
cd /Users/nvcnvn/Codes/tech-office/frontend
pnpm web dev

# 3. Database is running and migrated
docker-compose up -d postgres

# 4. Test organization exists
# Organization: "test-org" with subdomain "testorg"
# User: owner@testorg.com (password set via Zitadel)
```

### Test Data Files
Create Excel test files in `/tmp/employee-import-tests/`:

**File 1: all-fields.xlsx** (All optional fields populated)
```
| email               | given_name | family_name | hire_date  | date_of_birth | phone_number      | home_address                    |
|---------------------|------------|-------------|------------|---------------|-------------------|---------------------------------|
| alice@example.com   | Alice      | Anderson    | 2022-03-15 | 1990-06-20    | +1-555-123-4567  | 123 Main St, City, State 12345  |
| bob@example.com     | Bob        | Brown       | 2023/01/10 | 1985/12/05    | 5551234567       | 456 Oak Ave, Town, State 67890  |
| carol@example.com   | Carol      | Chen        | 15/02/2024 | 20/08/1992    | +44-20-7946-0958 | 789 Pine Rd, Village, UK        |
```

**File 2: no-optional-fields.xlsx** (Backward compatibility)
```
| email               | given_name | family_name |
|---------------------|------------|-------------|
| dave@example.com    | Dave       | Davis       |
| eve@example.com     | Eve        | Evans       |
```

**File 3: partial-optional-fields.xlsx** (Mix of populated/empty)
```
| email               | given_name | family_name | hire_date  | date_of_birth | phone_number      | home_address                    |
|---------------------|------------|-------------|------------|---------------|-------------------|---------------------------------|
| frank@example.com   | Frank      | Foster      | 2024-01-05 |               | +1-555-987-6543  |                                 |
| grace@example.com   | Grace      | Garcia      |            | 1988-03-12    |                  | 321 Elm St, Metro, State 11111  |
| henry@example.com   | Henry      | Harris      | 2023-06-20 | 1995-11-30    |                  |                                 |
```

**File 4: invalid-dates.xlsx** (Validation errors)
```
| email               | given_name | family_name | hire_date  | date_of_birth |
|---------------------|------------|-------------|------------|---------------|
| irene@example.com   | Irene      | Ivanov      | 2022/13/45 | invalid       |
| jack@example.com    | Jack       | Johnson     | 44575      | 1990-02-30    |
```

**File 5: invalid-phone.xlsx** (Phone validation errors)
```
| email               | given_name | family_name | phone_number       |
|---------------------|------------|-------------|--------------------|
| karen@example.com   | Karen      | Kim         | +1 (555) 123-4567  |
| leo@example.com     | Leo        | Lopez       | 555.123.4567       |
| mary@example.com    | Mary       | Martin      | 1-800-CALL-NOW     |
```

**File 6: invalid-address.xlsx** (Address length error)
```
| email               | given_name | family_name | home_address |
|---------------------|------------|-------------|--------------|
| nancy@example.com   | Nancy      | Nelson      | [601-character address - exceeds 500 limit] |
```

---

## Test Scenarios

### Scenario 1: Import with All Optional Fields ✅

**Objective**: Verify all optional fields are parsed, validated, stored, and displayed correctly

**Steps**:
1. Navigate to `http://localhost:13000/workspace/organization?tab=employees`
2. Click "Import Employees" button
3. Upload `all-fields.xlsx`
4. Wait for parsing (should show "3 employees parsed successfully")
5. Click "Preview Import"
6. **Verify preview table shows**:
   - Email, Given Name, Family Name (existing columns)
   - Hire Date: formatted as "15 Mar 2022", "10 Jan 2023", "15 Feb 2024"
   - Date of Birth: formatted as "20 Jun 1990", "05 Dec 1985", "20 Aug 1992"
   - Phone Number: displayed as-is
   - Home Address: displayed (truncated if > 100 chars)
   - "Will Import" column shows ✅ for all 3 rows
7. Click "Confirm Import"
8. Wait for import completion (should show "3 employees imported successfully")
9. Navigate to employee list
10. Click each employee to view profile
11. **Verify profile page displays all optional fields correctly**

**Expected Results**:
- All 3 employees imported
- All optional fields stored in database
- Dates displayed in unambiguous format
- No validation errors
- Zitadel users created (3 verification emails sent)

**Success Criteria**:
- ✅ File parsing succeeds
- ✅ Preview displays all fields correctly
- ✅ Import completes without errors
- ✅ Database records contain all optional field values
- ✅ Frontend displays all optional fields in employee profiles

---

### Scenario 2: Import without Optional Fields (Backward Compatibility) ✅

**Objective**: Verify existing import functionality unchanged (no optional fields)

**Steps**:
1. Navigate to `http://localhost:13000/workspace/organization?tab=employees`
2. Click "Import Employees" button
3. Upload `no-optional-fields.xlsx`
4. Wait for parsing (should show "2 employees parsed successfully")
5. Click "Preview Import"
6. **Verify preview table shows**:
   - Email, Given Name, Family Name only
   - Optional field columns show "—" (em dash) for all rows
   - "Will Import" column shows ✅ for both rows
7. Click "Confirm Import"
8. Wait for import completion (should show "2 employees imported successfully")
9. View employee profiles
10. **Verify optional fields show as empty/null** (e.g., "Not provided")

**Expected Results**:
- Both employees imported successfully
- Optional fields stored as NULL in database
- No validation errors
- Same behavior as pre-feature import

**Success Criteria**:
- ✅ Import succeeds with only required fields
- ✅ Optional fields NULL in database
- ✅ No regression from existing import feature
- ✅ Zitadel users created normally

---

### Scenario 3: Import with Partial Optional Fields ✅

**Objective**: Verify mixed populated/empty optional fields

**Steps**:
1. Navigate to import page
2. Upload `partial-optional-fields.xlsx`
3. Click "Preview Import"
4. **Verify preview shows**:
   - Frank: hire_date ✅, phone_number ✅, others empty
   - Grace: date_of_birth ✅, home_address ✅, others empty
   - Henry: hire_date ✅, date_of_birth ✅, others empty
   - All 3 marked "Will Import"
5. Click "Confirm Import"
6. View each employee profile
7. **Verify only provided fields are populated** (others show as empty)

**Expected Results**:
- All 3 employees imported
- Database has NULL for unprovided optional fields
- No validation errors
- Mixed populated/null optional fields per employee

**Success Criteria**:
- ✅ Partial optional field data handled correctly
- ✅ NULL vs empty string distinction maintained
- ✅ No errors for omitted optional fields

---

### Scenario 4: Invalid Date Formats ⚠️

**Objective**: Verify date validation errors prevent import

**Steps**:
1. Navigate to import page
2. Upload `invalid-dates.xlsx`
3. Click "Preview Import"
4. **Verify preview shows validation errors**:
   - Irene (Row 2): "Hire date has invalid date format '2022/13/45' - supported formats: ..."
   - Irene (Row 2): "Date of birth has invalid date format 'invalid' - supported formats: ..."
   - Jack (Row 3): "Hire date has invalid date format '44575' - supported formats: ..."
   - Jack (Row 3): "Date of birth has invalid date format '1990-02-30' - supported formats: ..." (Feb 30 doesn't exist)
   - Both rows marked "Will NOT Import" ❌
5. Click "Confirm Import" (should be disabled or show error)
6. **Attempt correction**:
   - Download file, fix dates, re-upload
   - Verify preview succeeds after correction

**Expected Results**:
- Validation errors displayed with row numbers
- Clear guidance on supported date formats
- Import button disabled while errors exist
- Users can fix and retry

**Success Criteria**:
- ✅ Invalid dates caught during preview
- ✅ Error messages clear and actionable
- ✅ Import blocked until errors resolved
- ✅ Retry after correction succeeds

---

### Scenario 5: Invalid Phone Number Formats ⚠️

**Objective**: Verify phone validation errors

**Steps**:
1. Navigate to import page
2. Upload `invalid-phone.xlsx`
3. Click "Preview Import"
4. **Verify validation errors**:
   - Karen (Row 2): "phone number '+1 (555) 123-4567' contains invalid characters - only numbers, +, and - allowed..."
   - Leo (Row 3): "phone number '555.123.4567' contains invalid characters..."
   - Mary (Row 4): "phone number '1-800-CALL-NOW' contains invalid characters..."
   - All 3 rows marked "Will NOT Import" ❌
5. **Attempt correction**:
   - Fix Karen: `+1-555-123-4567` (remove spaces and parentheses)
   - Fix Leo: `5551234567` (remove dots)
   - Fix Mary: `+1-800-225-5669` (replace letters with numbers)
   - Re-upload corrected file
6. Verify preview succeeds

**Expected Results**:
- Phone format errors caught
- Clear message about allowed characters
- Retry after correction succeeds

**Success Criteria**:
- ✅ Invalid phone formats rejected
- ✅ Error messages explain allowed characters
- ✅ Corrected phones accepted

---

### Scenario 6: Address Length Exceeded ⚠️

**Objective**: Verify address length validation (500 char limit)

**Steps**:
1. Navigate to import page
2. Upload `invalid-address.xlsx`
3. Click "Preview Import"
4. **Verify validation error**:
   - Nancy (Row 2): "home address exceeds 500 character limit (current: 601 characters) - please abbreviate..."
   - Row marked "Will NOT Import" ❌
5. **Attempt correction**:
   - Abbreviate address to 480 characters
   - Re-upload
6. Verify preview succeeds

**Expected Results**:
- Length error caught
- Character count shown in error
- Retry after abbreviation succeeds

**Success Criteria**:
- ✅ Addresses > 500 chars rejected
- ✅ Character count displayed
- ✅ Abbreviated address accepted

---

### Scenario 7: Manual Form Entry with Optional Fields ✅

**Objective**: Verify manual form supports optional fields (not just file upload)

**Steps**:
1. Navigate to import page
2. Click "Add Employee Manually" (or similar button)
3. **Fill form**:
   - Email: `zoe@example.com`
   - Given Name: `Zoe`
   - Family Name: `Zhang`
   - Hire Date: Use date picker to select `2024-05-10`
   - Date of Birth: Use date picker to select `1993-08-15`
   - Phone Number: `+1-555-321-7890`
   - Home Address: (multiline) `999 Maple Dr\nUnit 12\nSuburb, State 54321`
4. Click "Add to List" (or "Next")
5. **Verify preview shows all entered data**
6. Click "Confirm Import"
7. Verify employee created with all fields

**Expected Results**:
- Form includes optional field inputs
- Date pickers work correctly
- Multiline address preserved
- Import succeeds

**Success Criteria**:
- ✅ Manual form has optional field inputs
- ✅ Date pickers format correctly
- ✅ Validation happens on form submission
- ✅ Import succeeds with manual entry

---

### Scenario 8: Mixed Valid and Invalid Rows ⚠️

**Objective**: Verify comprehensive error reporting (all rows checked)

**Steps**:
1. Create `mixed-errors.xlsx`:
   ```
   | email               | given_name | family_name | hire_date  | phone_number       | home_address |
   |---------------------|------------|-------------|------------|--------------------|--------------|
   | valid1@example.com  | Valid      | One         | 2024-01-01 | +1-555-111-2222   | 123 Main St  |
   | invalid1@example.com| Invalid    | One         | bad-date   | +1 (555) 333-4444 | [601 chars]  |
   | valid2@example.com  | Valid      | Two         | 2024-02-02 | +1-555-555-6666   | 456 Oak Ave  |
   | invalid2@example.com| Invalid    | Two         | 2024/13/99 | abc-def-ghij      | Valid Addr   |
   ```
2. Upload file
3. Click "Preview Import"
4. **Verify**:
   - Row 1 (valid1): ✅ Will Import
   - Row 2 (invalid1): ❌ Will NOT Import - shows 3 validation errors (date, phone, address)
   - Row 3 (valid2): ✅ Will Import
   - Row 4 (invalid2): ❌ Will NOT Import - shows 2 validation errors (date, phone)
   - Stats show: 2 valid, 2 invalid
5. **All errors reported at once** (not just first error)
6. Click "Confirm Import"
7. Verify only 2 employees imported (valid1, valid2)

**Expected Results**:
- All validation errors reported per row
- Valid rows can import while invalid rows skipped
- Clear distinction between will/won't import

**Success Criteria**:
- ✅ All errors shown, not just first
- ✅ Row-by-row validation status clear
- ✅ Stats accurate (valid/invalid counts)
- ⚠️ **Note**: Current transaction behavior is all-or-nothing; if ANY row has error, NONE import. This scenario tests error REPORTING, but import may be blocked entirely.

---

### Scenario 9: Date Format Ambiguity Resolution ℹ️

**Objective**: Verify preview displays dates unambiguously

**Steps**:
1. Create `ambiguous-dates.xlsx`:
   ```
   | email               | given_name | family_name | hire_date  |
   |---------------------|------------|-------------|------------|
   | user1@example.com   | User       | One         | 01/02/2024 |
   | user2@example.com   | User       | Two         | 02/01/2024 |
   ```
2. Upload file
3. Click "Preview Import"
4. **Verify preview displays**:
   - User One: Hire Date shows "01 Feb 2024" or "02 Jan 2024" (depends on parsing - could be ambiguous!)
   - User Two: Hire Date shows opposite interpretation
5. **User can review and confirm dates are correct before import**
6. If incorrect, user can edit Excel to use unambiguous format (YYYY-MM-DD)

**Expected Results**:
- Preview uses "DD Mon YYYY" format to eliminate confusion
- Users can visually verify parsed dates before confirming
- Documentation encourages YYYY-MM-DD or YYYY/MM/DD formats

**Success Criteria**:
- ✅ Preview format is unambiguous ("02 Jan 2024")
- ✅ Users can verify before confirming
- ℹ️ Note: Parsing ambiguity (MM/DD vs DD/MM) is a known limitation; encourage YYYY-MM-DD

---

### Scenario 10: Import Retry After Failure 🔄

**Objective**: Verify retry behavior with optional fields

**Steps**:
1. Attempt import with `invalid-dates.xlsx` (should fail preview validation)
2. Fix dates in Excel file, re-upload
3. Preview succeeds, confirm import
4. **Simulate Zitadel failure** (disconnect Zitadel or use invalid credentials)
5. Attempt import again (should fail with Zitadel error)
6. Restore Zitadel connection
7. Retry import with same data
8. Verify success

**Expected Results**:
- Validation errors can be corrected and retried
- Zitadel failures trigger full rollback (no partial imports)
- Retry with corrected data succeeds
- Optional fields preserved through retry

**Success Criteria**:
- ✅ Validation errors correctable
- ✅ Zitadel failures rollback cleanly
- ✅ Retry succeeds after fixes
- ✅ Optional field data not lost during retry

---

## Automated Test Checklist (Post-Verification)

After manually verifying all scenarios above, convert to automated tests:

### Backend Integration Tests
- [ ] `TestParseEmployeeFile_WithAllOptionalFields`
- [ ] `TestParseEmployeeFile_WithNoOptionalFields`
- [ ] `TestParseEmployeeFile_WithPartialOptionalFields`
- [ ] `TestPreviewEmployeeImport_InvalidDates`
- [ ] `TestPreviewEmployeeImport_InvalidPhoneNumbers`
- [ ] `TestPreviewEmployeeImport_InvalidAddress`
- [ ] `TestExecuteEmployeeImport_WithOptionalFields`
- [ ] `TestExecuteEmployeeImport_MixedOptionalFields`

### Backend Unit Tests
- [ ] `TestParseDateField_AllFormats`
- [ ] `TestParseDateField_InvalidFormats`
- [ ] `TestValidatePhoneNumber_ValidFormats`
- [ ] `TestValidatePhoneNumber_InvalidFormats`
- [ ] `TestValidateAddress_LengthLimits`
- [ ] `TestValidateAddress_UTF8Characters`

### Frontend Component Tests
- [ ] `ImportDialog.test.tsx` - optional field inputs render
- [ ] `EmployeePreviewTable.test.tsx` - optional fields display
- [ ] `FileUploadSection.test.tsx` - column detection with optional fields

---

## Success Metrics

### Feature Acceptance Criteria
- ✅ All 10 manual scenarios pass without errors
- ✅ Backward compatibility maintained (scenario 2)
- ✅ Validation errors clear and actionable (scenarios 4-6)
- ✅ Data integrity: Optional fields stored and retrieved correctly
- ✅ Multi-tenant isolation: Optional fields scoped to organization_id
- ✅ Transaction atomicity: All-or-nothing import preserved

### Performance Benchmarks
- File parsing: < 2s for 100-row Excel with optional fields
- Preview generation: < 1s for 100 employees
- Import execution: < 5s for 100 employees (including Zitadel API calls)

### Code Quality Gates
- Test coverage: ≥ 80% for new validation functions
- No regressions: Existing employee import tests still pass
- Code review: 2+ approvals (1 maintainer with DB knowledge)

---

## Troubleshooting Guide

### Common Issues

**Issue**: Date parsing fails for all formats  
**Solution**: Check Excel export settings; dates may be exported as numeric format. Re-export with dates formatted as text.

**Issue**: Phone validation rejects valid international numbers  
**Solution**: Ensure no spaces, parentheses, or dots. Use only numeric, "+", and "-" characters.

**Issue**: Address length error but address looks short  
**Solution**: Check for hidden characters (BOM, control chars). UTF-8 character count may differ from visual length.

**Issue**: Optional fields not showing in preview  
**Solution**: Verify column headers match expected names (case-insensitive). Check frontend console for parsing errors.

**Issue**: Import succeeds but optional fields are NULL  
**Solution**: Verify protobuf optional fields are being transmitted. Check browser network tab for RPC request payload.

---

## References

- **Feature Spec**: `/specs/004-import-employee-with/spec.md`
- **Data Model**: `/specs/004-import-employee-with/data-model.md`
- **Validation Rules**: `/specs/004-import-employee-with/contracts/validation.md`
- **Backend Implementation**: `backend/internal/iam/employee_import.go`
- **Frontend Components**: `frontend/apps/web/src/app/workspace/organization/components/`

---

**Next Steps**: 
1. Execute all manual scenarios above
2. Document any deviations or unexpected behaviors
3. Convert passing scenarios to automated tests
4. Run automated test suite as regression tests

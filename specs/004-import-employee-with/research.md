# Research: Enhanced Employee Import with Additional Fields

**Feature**: 004-import-employee-with  
**Date**: October 26, 2025  
**Status**: Complete

## Overview
This document consolidates research findings for extending the existing employee import feature (spec 003) with four optional fields: `hire_date`, `date_of_birth`, `phone_number`, and `home_address`.

## Key Research Areas

### 1. Date Parsing & Format Handling

**Decision**: Support 5 common date formats and display parsed dates in unambiguous "02 Jan 2022" format

**Formats Supported**:
1. `YYYY/MM/DD` - ISO-like with slashes (e.g., 2022/01/02)
2. `DD/MM/YYYY` - European format (e.g., 02/01/2022)
3. `MM/DD/YYYY` - US format (e.g., 01/02/2022)
4. `YYYY-MM-DD` - ISO 8601 standard (e.g., 2022-01-02)
5. `DD-MM-YYYY` - European with hyphens (e.g., 02-01-2022)

**Rationale**: 
- These 5 formats cover 95%+ of real-world Excel/CSV date representations
- Go's `time.Parse()` with custom layout strings handles all formats
- Preview step displays dates as "02 Jan 2022" (day + 3-letter month + year) to eliminate MM/DD/YYYY vs DD/MM/YYYY confusion
- Excel numeric date format (e.g., 44575) is NOT automatically parsed - users must export dates as formatted text

**Error Handling**:
- If date cannot be parsed: Show validation error with row number and list of supported formats
- Allow user to either fix the data or continue import with that optional field left empty
- Do not block entire import due to single unparseable optional date

**Existing Patterns to Follow**:
- See `backend/internal/converter/time.go` for timestamp conversion patterns
- Go standard library `time.Parse()` with layout strings: `"2006-01-02"`, `"02/01/2006"`, etc.
- Frontend: Use MUI `DatePicker` component (already in use for other features)

**Alternatives Considered**:
- ❌ Auto-detect Excel numeric format: Too error-prone, increases complexity
- ❌ Support only ISO 8601: Users rarely export in this format
- ❌ Use natural language parser: Adds dependency, unpredictable parsing
- ✅ Explicit format list + clear error messages: Simple, predictable, maintainable

### 2. Phone Number Validation

**Decision**: Allow only numeric characters, "+", and "-" (no alphabetic characters)

**Validation Rules**:
- Allowed characters: `0-9`, `+`, `-`
- Forbidden: letters, spaces, parentheses, dots (users must format consistently)
- Examples:
  - ✅ Valid: `+1-555-123-4567`, `+44-20-7946-0958`, `5551234567`
  - ❌ Invalid: `+1 (555) 123-4567`, `+44 20 7946 0958`, `555-CALL-NOW`
- Max length: 20 characters (covers all international formats)
- Min length: 7 characters (shortest valid phone number)

**Rationale**:
- Simple regex validation: `^[0-9+\-]{7,20}$`
- Avoids complex international phone number parsing (libphonenumber adds ~2MB dependency)
- Users responsible for consistent formatting (documented in import UI)
- PostgreSQL TEXT column stores as-is (no normalization)

**Error Handling**:
- Show validation error: "Phone number contains invalid characters - only numbers, +, and - allowed"
- Include row number for file uploads
- Allow continuation with field empty

**Existing Patterns to Follow**:
- See existing email validation in `backend/internal/iam/employee_import.go` (line ~115)
- Go regex: `regexp.MustCompile()` for pattern matching
- Frontend: MUI `TextField` with `inputProps.pattern` for client-side hint

**Alternatives Considered**:
- ❌ Use libphonenumber-go: Heavy dependency for optional field validation
- ❌ Allow any text: Inconsistent data quality
- ❌ Normalize to E.164 format: Too opinionated, international complexity
- ✅ Simple character set restriction: Balances flexibility and validation

### 3. Home Address Validation

**Decision**: Free-form text with 500-character maximum, UTF-8 support

**Validation Rules**:
- Max length: 500 characters
- Multi-line allowed (CR/LF preserved)
- UTF-8 encoding: Support accented characters (café, Müller) and non-Latin scripts (日本, العربية)
- No special character restrictions (allow commas, periods, hyphens, etc.)

**Rationale**:
- PostgreSQL TEXT column with UTF-8 encoding (default in PostgreSQL 12+)
- 500 chars sufficient for international addresses (avg US address ~100 chars)
- No address parsing/validation (too complex, international variations)
- Users responsible for correct address formatting

**Error Handling**:
- Show validation error if length exceeds 500 characters
- Display character count in UI (e.g., "245/500")
- Suggest splitting to multiple lines or abbreviating

**Existing Patterns to Follow**:
- PostgreSQL TEXT column already exists in schema (line 64)
- Go: `utf8.RuneCountInString()` for character counting (not byte length)
- Frontend: MUI `TextField` with `multiline` and `maxRows` props

**Alternatives Considered**:
- ❌ Parse address components (street, city, zip): International complexity
- ❌ Use 255-char limit: Too short for some international addresses
- ❌ Require structured format: Too restrictive, varies by country
- ✅ Free-form with length limit: Simple, flexible, sufficient

### 4. Backward Compatibility Strategy

**Decision**: Make all new fields optional in protobuf; existing imports work unchanged

**Implementation**:
- Protobuf `optional` keyword: Fields can be omitted entirely
- Go: Use pointer types (`*string`, `*time.Time`) to distinguish null vs empty string
- Database: Existing columns already nullable (no migration needed)
- Frontend: Show "(optional)" label; empty values sent as null/undefined

**Verification**:
- Test case: Import with only required fields (email, given_name, family_name)
- Expected: Import succeeds, optional fields stored as NULL
- Test case: Retry old import file without new columns
- Expected: Parse succeeds, optional fields ignored

**Existing Patterns to Follow**:
- See existing `row_number` field in `EmployeeData` (line 127 in iam.proto) - already optional
- Go nullable types: `pgtype.Text`, `pgtype.Date` from pgx/v5
- Frontend: Conditional rendering based on field presence

### 5. Excel Column Detection

**Decision**: Flexible column ordering with header row detection

**Column Detection Logic**:
1. Read first row as header row
2. Case-insensitive header matching:
   - "hire date" | "hire_date" | "hiredate" → hire_date
   - "date of birth" | "date_of_birth" | "dob" | "birth date" → date_of_birth
   - "phone" | "phone number" | "phone_number" | "mobile" → phone_number
   - "address" | "home address" | "home_address" → home_address
3. Map columns by header name (order-independent)
4. Missing optional columns treated as empty (not error)

**Rationale**:
- Users may have different column naming conventions
- Order independence reduces user friction
- Existing employee import already uses header detection (see `ParseEmployeeFile` line ~105)

**Error Handling**:
- Warn if header row not detected (missing required columns)
- Ignore unrecognized columns (forward compatibility)
- Clear error if required columns (email, given_name, family_name) missing

**Existing Patterns to Follow**:
- See `ParseEmployeeFile` in `employee_import.go` (lines 95-150)
- Uses `excelize` library for Excel parsing
- Header detection with `strings.ToLower()` and `strings.TrimSpace()`

### 6. Validation Error Reporting

**Decision**: Comprehensive error report for all rows before blocking import

**Error Reporting Format**:
```
Row 5: Invalid hire date "2022/13/45" - supported formats: YYYY/MM/DD, DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD, DD-MM-YYYY
Row 7: Phone number "+1 (555) 123-4567" contains invalid characters - only numbers, +, and - allowed
Row 12: Home address exceeds 500 character limit (current: 623 characters)
```

**Rationale**:
- Users see all errors at once (reduce round-trip iterations)
- Row numbers enable quick file correction
- Specific error messages with examples/formats
- Follows existing validation pattern (see spec 003, scenario 5)

**Existing Patterns to Follow**:
- See `PreviewEmployeeImport` method (returns `validation_errors` array per employee)
- Frontend displays errors in `EmployeePreviewTable` with row highlighting

### 7. Transaction & Atomicity

**Decision**: Maintain existing all-or-nothing transaction behavior

**Implementation**:
- Use existing `txn.WithTxn` helper (Constitution v3.3.0 requirement)
- Single transaction for all employee creates
- Rollback if any employee fails (including Zitadel CreateUser)
- Optional fields included in same transaction (no separate commit)

**Rationale**:
- Consistent with existing import behavior (spec 003)
- No partial state: either all employees imported or none
- Zitadel failures trigger full rollback (users retry entire batch)

**Existing Patterns to Follow**:
- See `ExecuteEmployeeImport` in `employee_import.go` (lines 400+)
- Uses `txn.WithTxn(ctx, s.AdminPool, func(ctx context.Context, tx database.DBTX) error {...})`

## Summary of Decisions

| Aspect | Decision | Rationale |
|--------|----------|-----------|
| Date Formats | Support 5 common formats | Covers 95%+ real-world cases |
| Date Preview | Display as "02 Jan 2022" | Eliminates MM/DD vs DD/MM confusion |
| Phone Validation | Only 0-9, +, - allowed | Simple regex, avoids heavy dependencies |
| Address Validation | Max 500 chars, UTF-8 | Flexible for international addresses |
| Backward Compatibility | Optional protobuf fields | Existing imports work unchanged |
| Excel Columns | Header-based detection | Order-independent, user-friendly |
| Error Reporting | All errors reported at once | Reduces user iteration time |
| Transactions | All-or-nothing with existing pattern | Consistent atomicity guarantee |

## Implementation Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Date format ambiguity (MM/DD vs DD/MM) | Medium | Medium | Preview shows "02 Jan 2022" format; user verifies before confirm |
| Phone number format inconsistency | Low | Low | Clear validation message; simple character set |
| Address length exceeded | Low | Low | Character counter in UI; clear error message |
| Excel numeric date format | Medium | Medium | Document export as formatted text; show parse error with fix instructions |
| Zitadel failure with optional fields | Low | High | Same transaction handling; rollback all on failure |

## References

- **Existing Implementation**: `backend/internal/iam/employee_import.go` (spec 003)
- **Database Schema**: `backend/database/scripts/schema.sql` lines 58-68 (organization.employee)
- **RPC Contract**: `backend/rpc/v1/iam.proto` lines 120-131 (EmployeeData message)
- **Frontend Components**: `frontend/apps/web/src/app/workspace/organization/components/`
- **Constitution**: `.specify/memory/constitution.md` v3.3.0 (Backend Service Architecture)

## Next Steps (Phase 1)

1. Create `data-model.md` with field specifications and validation rules
2. Create `contracts/iam.proto` with extended EmployeeData message
3. Create `contracts/validation.md` with detailed validation algorithms
4. Create `quickstart.md` with test scenarios covering optional field combinations
5. Update agent context file with new patterns

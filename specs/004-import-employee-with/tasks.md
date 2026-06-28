# Tasks: Enhanced Employee Import with Additional Fields

**Input**: Design documents from `/specs/004-import-employee-with/`
**Prerequisites**: plan.md (✅), research.md (✅), data-model.md (✅), contracts/ (✅), quickstart.md (✅)

## Execution Flow
```
1. Load plan.md from feature directory → ✅ Complete
   → Tech stack: Go 1.25+, PostgreSQL 18+, Next.js 15, TypeScript 5.x
   → Structure: Web app (backend + frontend monorepo)
   → Approach: Extend existing employee import feature with 4 optional fields

2. Load design documents → ✅ Complete
   → data-model.md: 4 optional fields (hire_date, date_of_birth, phone_number, home_address)
   → contracts/iam.proto: Extended EmployeeData message with optional fields
   → contracts/validation.md: Validation algorithms for dates, phone, address
   → quickstart.md: 10 manual test scenarios

3. Generate tasks by category:
   → Setup: Protobuf extension and code generation (T001-T002)
   → Core Backend: Validation helpers and parser extensions (T003-T008)
   → Core Frontend: UI components and API wrappers (T009-T014)
   → Verification: Manual testing gate (T015-T016)
   → Tests: Automated tests after verification (T017-T020)
   → Polish: Documentation and final validation (T021-T022)

4. Task rules applied:
   → Different files = marked [P] for parallel execution
   → Same file = sequential (no [P] marker)
   → Implementation before verification, verification before tests
   → Backend codegen before frontend codegen

5. Tasks numbered sequentially: T001-T022
6. Dependencies validated: All clear
7. Parallel execution examples: Provided below
```

## Format: `[ID] [P?] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- All paths are absolute to repository root

## Path Conventions
- **Backend**: `/Users/nvcnvn/Codes/tech-office/backend/`
- **Frontend**: `/Users/nvcnvn/Codes/tech-office/frontend/`
- **Specs**: `/Users/nvcnvn/Codes/tech-office/specs/004-import-employee-with/`

---

## Phase 3.1: Setup & Code Generation

### T001: [X] Extend EmployeeData message in protobuf definition
**File**: `backend/rpc/v1/iam.proto`  
**Type**: Modification (add 4 optional fields to existing message)  
**Constitutional Requirements**: N/A (backward-compatible protobuf extension)

**Task**:
1. Locate the `EmployeeData` message definition (approximately line 120-131)
2. Add 4 new optional fields after `row_number` field:
   ```protobuf
   // NEW OPTIONAL FIELDS (v2 extension - backward compatible):
   optional string hire_date = 5;        // ISO 8601 date string (YYYY-MM-DD)
   optional string date_of_birth = 6;    // ISO 8601 date string (YYYY-MM-DD)
   optional string phone_number = 7;     // International format (numeric, +, -)
   optional string home_address = 8;     // Free-form text (max 500 chars)
   ```
3. Add detailed comments for each field documenting:
   - Format requirements (ISO 8601 for dates)
   - Validation rules (phone: only digits/+/-, address: max 500 UTF-8 chars)
   - Examples (e.g., "2022-03-15", "+1-555-123-4567")

**Reference**: See `contracts/iam.proto` for complete message definition with comments

**Validation**:
- [ ] Message compiles with `buf lint` (no errors)
- [ ] Field numbers 5-8 are sequential (no gaps)
- [ ] All fields use `optional string` type
- [ ] Comments document validation rules

**Estimate**: 15 minutes

---

### T002: [X] Generate protobuf code for backend and frontend
**Files**: 
- Backend: `backend/rpc/v1/iam.pb.go`, `backend/rpc/v1/rpcv1connect/iam.connect.go`
- Frontend: `frontend/packages/rpc/rpc/v1/iam_pb.ts`

**Type**: Code generation (run build commands)  
**Dependencies**: T001 (must complete first)  
**Constitutional Requirements**: 
- Generated code MUST be committed in same PR as proto changes
- CI validates generated code matches committed files

**Task**:
1. Generate backend protobuf code:
   ```bash
   cd /Users/nvcnvn/Codes/tech-office/backend
   buf generate
   ```
2. Verify Go compilation:
   ```bash
   go build ./rpc/v1/...
   ```
3. Generate frontend protobuf types:
   ```bash
   cd /Users/nvcnvn/Codes/tech-office/frontend
   pnpm -r build
   ```
4. Verify TypeScript compilation:
   ```bash
   pnpm -r typecheck
   ```
5. Stage generated files for commit:
   ```bash
   git add backend/rpc/v1/iam.pb.go
   git add backend/rpc/v1/rpcv1connect/iam.connect.go
   git add frontend/packages/rpc/rpc/v1/iam_pb.ts
   ```

**Validation**:
- [ ] `buf generate` completes without errors
- [ ] Go files compile successfully (`go build` passes)
- [ ] TypeScript types include `hireDate?: string`, `dateOfBirth?: string`, `phoneNumber?: string`, `homeAddress?: string`
- [ ] Frontend packages build successfully (`pnpm -r build` passes)
- [ ] Generated files staged for commit

**Estimate**: 10 minutes

---

## Phase 3.2: Core Backend Implementation

### T003 [P]: [X] Implement date parsing helper function
**File**: `backend/internal/iam/employee_import.go`  
**Type**: New function (validation helper)  
**Dependencies**: None (parallel with T004, T005)  
**Constitutional Requirements**: 
- Implement functionality first, tests after manual verification (T015-T016)
- Simple, observable solution (no external date parsing libraries)

**Task**:
1. Add `parseDateField` function to `employee_import.go`:
   ```go
   // parseDateField attempts to parse a date string using 5 common formats.
   // Returns nil, nil for empty strings (optional field not provided).
   // Returns nil, error if parsing fails for all formats.
   func parseDateField(value string, fieldName string) (*time.Time, error) {
       trimmed := strings.TrimSpace(value)
       if trimmed == "" {
           return nil, nil // Empty = not provided, not an error
       }
       
       // 5 supported formats
       layouts := []string{
           "2006/01/02",   // YYYY/MM/DD
           "02/01/2006",   // DD/MM/YYYY
           "01/02/2006",   // MM/DD/YYYY
           "2006-01-02",   // YYYY-MM-DD (ISO 8601)
           "02-01-2006",   // DD-MM-YYYY
       }
       
       for _, layout := range layouts {
           if t, err := time.Parse(layout, trimmed); err == nil {
               return &t, nil
           }
       }
       
       return nil, fmt.Errorf(
           "%s has invalid date format '%s' - supported formats: YYYY/MM/DD, DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD, DD-MM-YYYY",
           fieldName, value,
       )
   }
   ```

2. Add helper for date-to-preview formatting:
   ```go
   // formatDateForPreview formats a date for unambiguous display: "02 Jan 2022"
   func formatDateForPreview(t *time.Time) string {
       if t == nil {
           return "—" // Em dash for empty/null
       }
       return t.Format("02 Jan 2006")
   }
   ```

**Reference**: See `contracts/validation.md` lines 45-95 for complete algorithm and edge cases

**Validation**:
- [ ] Function handles empty strings (returns nil, nil)
- [ ] Function tries all 5 date formats
- [ ] Error messages include supported format list
- [ ] Helper function formats dates as "02 Jan 2006"

**Estimate**: 30 minutes

---

### T004 [P]: [X] Implement phone validation helper function
**File**: `backend/internal/iam/employee_import.go`  
**Type**: New function (validation helper)  
**Dependencies**: None (parallel with T003, T005)  
**Constitutional Requirements**: Simple validation (no libphonenumber dependency)

**Task**:
1. Add `validatePhoneNumber` function to `employee_import.go`:
   ```go
   // validatePhoneNumber validates phone number contains only allowed characters.
   // Returns nil for empty strings (optional field not provided).
   // Returns error if invalid characters or length outside 7-20 range.
   func validatePhoneNumber(phone string) error {
       trimmed := strings.TrimSpace(phone)
       if trimmed == "" {
           return nil // Empty = not provided, not an error
       }
       
       // Pattern: only numeric, "+", and "-" characters, length 7-20
       pattern := regexp.MustCompile(`^[0-9+\-]{7,20}$`)
       if !pattern.MatchString(trimmed) {
           if len(trimmed) < 7 || len(trimmed) > 20 {
               return fmt.Errorf("phone number must be 7-20 characters (got %d)", len(trimmed))
           }
           return fmt.Errorf("phone number contains invalid characters - only digits, +, and - allowed")
       }
       
       return nil
   }
   ```

**Reference**: See `research.md` lines 63-91 for phone validation rationale

**Validation**:
- [ ] Function handles empty strings (returns nil)
- [ ] Regex pattern allows only `0-9`, `+`, `-`
- [ ] Length validation enforces 7-20 character range
- [ ] Error messages are descriptive

**Estimate**: 20 minutes

---

### T005 [P]: [X] Implement address validation helper function
**File**: `backend/internal/iam/employee_import.go`  
**Type**: New function (validation helper)  
**Dependencies**: None (parallel with T003, T004)  
**Constitutional Requirements**: UTF-8 support for international addresses

**Task**:
1. Add `validateAddress` function to `employee_import.go`:
   ```go
   // validateAddress validates address length (max 500 UTF-8 characters).
   // Returns nil for empty strings (optional field not provided).
   // Returns error if length exceeds 500 characters.
   func validateAddress(address string) error {
       trimmed := strings.TrimSpace(address)
       if trimmed == "" {
           return nil // Empty = not provided, not an error
       }
       
       // Count UTF-8 runes (not bytes) for proper international character support
       runeCount := utf8.RuneCountInString(trimmed)
       if runeCount > 500 {
           return fmt.Errorf("address exceeds 500 characters (got %d)", runeCount)
       }
       
       return nil
   }
   ```

**Reference**: See `research.md` lines 93-119 for address validation rationale

**Validation**:
- [ ] Function handles empty strings (returns nil)
- [ ] UTF-8 rune count used (not byte count)
- [ ] Max 500 characters enforced
- [ ] Error message includes actual character count

**Estimate**: 15 minutes

---

### T006: [X] Extend ParseEmployeeFile to read optional columns
**File**: `backend/internal/iam/employee_import.go`  
**Type**: Modification (extend existing method)  
**Dependencies**: T002 (generated code must exist)  
**Constitutional Requirements**: Backward compatibility (existing imports must continue working)

**Task**:
1. Locate `ParseEmployeeFile` method in `employee_import.go`
2. Extend Excel header detection logic to recognize optional field headers (case-insensitive):
   - Hire date: "hire date", "hire_date", "hiredate", "start date", "start_date"
   - Date of birth: "date of birth", "date_of_birth", "dob", "birth date", "birth_date", "birthdate"
   - Phone: "phone", "phone number", "phone_number"
   - Address: "address", "home address", "home_address"
3. Read optional column values from Excel cells (handle nil/empty)
4. Populate `EmployeeData` optional fields (use pointer for optional):
   - Store raw string values (no validation in parse step)
   - Date formatting handled in preview step
5. Preserve existing behavior: required fields (email, given_name, family_name) unchanged

**Reference**: See `data-model.md` lines 100-105, 134-141, 172-177, 211-215 for column header mappings

**Validation**:
- [ ] Header detection is case-insensitive
- [ ] All header aliases recognized (e.g., "dob", "date of birth", "date_of_birth")
- [ ] Empty cells result in nil pointers (not empty strings)
- [ ] Backward compatibility: files without optional columns still parse
- [ ] No validation performed (deferred to preview step)

**Estimate**: 45 minutes

---

### T007: [X] Extend PreviewEmployeeImport to validate optional fields
**File**: `backend/internal/iam/employee_import.go`  
**Type**: Modification (extend existing method)  
**Dependencies**: T003, T004, T005, T006 (requires validation helpers and parser)  
**Constitutional Requirements**: 
- Validation errors do not block preview display
- Users can fix or omit invalid optional fields

**Task**:
1. Locate `PreviewEmployeeImport` method in `employee_import.go`
2. For each `EmployeeData` in request, validate optional fields (only if provided):
   ```go
   var validationErrors []string
   
   // Validate hire_date if provided
   if emp.HireDate != nil && *emp.HireDate != "" {
       if parsedDate, err := parseDateField(*emp.HireDate, "Hire date"); err != nil {
           validationErrors = append(validationErrors, err.Error())
       } else {
           // Store parsed date for preview display
           emp.HireDate = stringPtr(parsedDate.Format("2006-01-02")) // ISO 8601
       }
   }
   
   // Validate date_of_birth if provided
   if emp.DateOfBirth != nil && *emp.DateOfBirth != "" {
       if parsedDate, err := parseDateField(*emp.DateOfBirth, "Date of birth"); err != nil {
           validationErrors = append(validationErrors, err.Error())
       } else {
           emp.DateOfBirth = stringPtr(parsedDate.Format("2006-01-02"))
       }
   }
   
   // Validate phone_number if provided
   if emp.PhoneNumber != nil && *emp.PhoneNumber != "" {
       if err := validatePhoneNumber(*emp.PhoneNumber); err != nil {
           validationErrors = append(validationErrors, err.Error())
       }
   }
   
   // Validate home_address if provided
   if emp.HomeAddress != nil && *emp.HomeAddress != "" {
       if err := validateAddress(*emp.HomeAddress); err != nil {
           validationErrors = append(validationErrors, err.Error())
       }
   }
   ```
3. Append validation errors to `EmployeePreviewItem.validation_errors` array
4. Return preview response even if validation errors exist (allow user to fix)

**Reference**: See `contracts/validation.md` for complete validation flow

**Validation**:
- [ ] Validation only runs for non-empty optional fields
- [ ] Validation errors added to `validation_errors` array (not thrown)
- [ ] Dates converted to ISO 8601 format after successful parsing
- [ ] Preview response includes validation errors per employee

**Estimate**: 30 minutes

---

### T008: [X] Extend ExecuteEmployeeImport to store optional fields
**File**: `backend/internal/iam/employee_import.go`  
**Type**: Modification (extend existing method)  
**Dependencies**: T007 (validation must pass before execution)  
**Constitutional Requirements**: 
- Use `txn.WithTxn` for transaction management (Constitution v3.3.0)
- All-or-nothing import (atomic transaction)
- Multi-tenant isolation (organization_id in all queries)

**Task**:
1. Locate `ExecuteEmployeeImport` method in `employee_import.go`
2. Inside the `txn.WithTxn` transaction block, extend `CreateEmployee` call to include optional fields:
   ```go
   // Convert protobuf optional strings to database types
   var hireDate pgtype.Date
   if emp.HireDate != nil && *emp.HireDate != "" {
       if t, err := time.Parse("2006-01-02", *emp.HireDate); err == nil {
           hireDate = pgtype.Date{Time: t, Valid: true}
       }
   }
   
   var dateOfBirth pgtype.Date
   if emp.DateOfBirth != nil && *emp.DateOfBirth != "" {
       if t, err := time.Parse("2006-01-02", *emp.DateOfBirth); err == nil {
           dateOfBirth = pgtype.Date{Time: t, Valid: true}
       }
   }
   
   var phoneNumber pgtype.Text
   if emp.PhoneNumber != nil && *emp.PhoneNumber != "" {
       phoneNumber = pgtype.Text{String: *emp.PhoneNumber, Valid: true}
   }
   
   var homeAddress pgtype.Text
   if emp.HomeAddress != nil && *emp.HomeAddress != "" {
       homeAddress = pgtype.Text{String: *emp.HomeAddress, Valid: true}
   }
   
   // Pass to CreateEmployee query parameters
   err = s.Queries.CreateEmployee(ctx, tx, database.CreateEmployeeParams{
       // ... existing parameters ...
       HireDate:     hireDate,
       DateOfBirth:  dateOfBirth,
       PhoneNumber:  phoneNumber,
       HomeAddress:  homeAddress,
   })
   ```
3. Verify existing transaction rollback behavior handles optional field errors
4. Ensure `organization_id` context is preserved in all queries

**Reference**: 
- See `data-model.md` lines 1-68 for database schema (no changes needed)
- Existing `CreateEmployee` query in `backend/database/scripts/iam.query.sql` already supports these columns

**Validation**:
- [ ] Optional fields converted to appropriate pgtype (Date, Text)
- [ ] Null vs empty string distinction preserved (Valid: false for null)
- [ ] Transaction uses `txn.WithTxn` helper (no manual Begin/Commit)
- [ ] All queries include `organization_id` filter (multi-tenant isolation)
- [ ] Import is atomic (all employees or none)

**Estimate**: 30 minutes

---

## Phase 3.3: Core Frontend Implementation

### T009: [X] Update RPC exports in frontend packages
**File**: `frontend/packages/rpc/index.ts`  
**Type**: Modification (re-export new types)  
**Dependencies**: T002 (generated TypeScript types must exist)  
**Constitutional Requirements**: Apps MUST import from `packages/apis`, NOT directly from `packages/rpc`

**Task**:
1. Verify `frontend/packages/rpc/rpc/v1/iam_pb.ts` includes optional fields:
   - `hireDate?: string`
   - `dateOfBirth?: string`
   - `phoneNumber?: string`
   - `homeAddress?: string`
2. Update `frontend/packages/rpc/index.ts` to re-export `EmployeeData` type if not already exported:
   ```typescript
   export { EmployeeData } from './rpc/v1/iam_pb';
   ```
3. Verify no other changes needed (existing exports should cover all types)

**Validation**:
- [ ] `EmployeeData` type includes optional fields with correct TypeScript types
- [ ] Type is re-exported from package index
- [ ] Package builds successfully (`pnpm build`)

**Estimate**: 10 minutes

---

### T010: [X] Extend API client wrappers for optional fields
**File**: `frontend/packages/apis/src/iam.ts`  
**Type**: Modification (extend existing wrapper methods)  
**Dependencies**: T009 (RPC exports must be updated)  
**Constitutional Requirements**: Centralized API wrappers enable auth, error handling, tenant context

**Task**:
1. Locate wrapper methods in `iam.ts`:
   - `parseEmployeeFile()`
   - `previewEmployeeImport()`
   - `executeEmployeeImport()`
2. Verify method signatures accept `EmployeeData` with optional fields (should be automatic from generated types)
3. Add JSDoc comments documenting optional field requirements:
   ```typescript
   /**
    * Preview employee import with validation.
    * Optional fields (hireDate, dateOfBirth, phoneNumber, homeAddress) 
    * are validated server-side. Validation errors returned per employee.
    * 
    * Date format: ISO 8601 (YYYY-MM-DD)
    * Phone format: International (digits, +, - only)
    * Address: Max 500 UTF-8 characters
    */
   ```
4. No logic changes needed (wrappers pass-through to RPC client)

**Validation**:
- [ ] Wrapper methods accept optional fields in request types
- [ ] Wrapper methods return optional fields in response types
- [ ] JSDoc comments document validation rules
- [ ] No breaking changes to existing method signatures

**Estimate**: 20 minutes

---

### T011 [P]: [X] Extend ImportDialog form with optional field inputs
**File**: `frontend/apps/web/src/app/workspace/organization/components/ImportDialog.tsx`  
**Type**: Modification (add form fields)  
**Dependencies**: T010 (API wrappers must handle optional fields)  
**Constitutional Requirements**: Workspace pattern (no layout duplication)

**Task**:
1. Locate form section in `ImportDialog.tsx` (manual entry tab)
2. Add 4 optional field inputs after existing required fields:
   ```tsx
   {/* Optional Fields Section */}
   <Divider sx={{ my: 2 }}>Optional Fields</Divider>
   
   {/* Hire Date */}
   <LocalizationProvider dateAdapter={AdapterDateFns}>
     <DatePicker
       label="Hire Date (optional)"
       value={employee.hireDate ? new Date(employee.hireDate) : null}
       onChange={(date) => handleOptionalDateChange('hireDate', date)}
       slotProps={{
         textField: { 
           fullWidth: true,
           helperText: "Format: YYYY-MM-DD (or DD/MM/YYYY, MM/DD/YYYY)"
         }
       }}
     />
   </LocalizationProvider>
   
   {/* Date of Birth */}
   <LocalizationProvider dateAdapter={AdapterDateFns}>
     <DatePicker
       label="Date of Birth (optional)"
       value={employee.dateOfBirth ? new Date(employee.dateOfBirth) : null}
       onChange={(date) => handleOptionalDateChange('dateOfBirth', date)}
       slotProps={{
         textField: { 
           fullWidth: true,
           helperText: "Format: YYYY-MM-DD"
         }
       }}
     />
   </LocalizationProvider>
   
   {/* Phone Number */}
   <TextField
     label="Phone Number (optional)"
     value={employee.phoneNumber || ''}
     onChange={(e) => handleFieldChange('phoneNumber', e.target.value)}
     fullWidth
     helperText="International format: +1-555-123-4567 (digits, +, - only)"
     inputProps={{ pattern: '[0-9+\\-]{7,20}' }}
   />
   
   {/* Home Address */}
   <TextField
     label="Home Address (optional)"
     value={employee.homeAddress || ''}
     onChange={(e) => handleFieldChange('homeAddress', e.target.value)}
     fullWidth
     multiline
     rows={3}
     helperText={`${employee.homeAddress?.length || 0}/500 characters`}
     inputProps={{ maxLength: 500 }}
   />
   ```
3. Add state management for optional fields (extend existing employee state)
4. Add change handlers for date and text fields
5. Ensure form submission includes optional fields (undefined if empty)

**Reference**: See MUI DatePicker and TextField documentation for component props

**Validation**:
- [ ] Optional fields rendered with "(optional)" label
- [ ] Date pickers show format hint
- [ ] Phone field shows pattern hint
- [ ] Address field shows character counter
- [ ] Form state includes optional fields
- [ ] Empty optional fields sent as undefined (not empty strings)

**Estimate**: 1 hour

---

### T012 [P]: [X] Extend EmployeePreviewTable to display optional fields
**File**: `frontend/apps/web/src/app/workspace/organization/components/EmployeePreviewTable.tsx`  
**Type**: Modification (add columns)  
**Dependencies**: T010 (API wrappers must return optional fields)  
**Constitutional Requirements**: Consistent MUI table patterns (parallel with T011)

**Task**:
1. Locate table column definitions in `EmployeePreviewTable.tsx`
2. Add 4 new columns after existing columns (email, given_name, family_name):
   ```tsx
   const columns: GridColDef[] = [
     // ... existing columns ...
     {
       field: 'hireDate',
       headerName: 'Hire Date',
       width: 130,
       valueFormatter: (params) => {
         if (!params.value) return '—'; // Em dash for empty
         return new Date(params.value).toLocaleDateString('en-GB', {
           day: '2-digit',
           month: 'short',
           year: 'numeric'
         }); // "15 Mar 2022"
       }
     },
     {
       field: 'dateOfBirth',
       headerName: 'Date of Birth',
       width: 130,
       valueFormatter: (params) => {
         if (!params.value) return '—';
         return new Date(params.value).toLocaleDateString('en-GB', {
           day: '2-digit',
           month: 'short',
           year: 'numeric'
         });
       }
     },
     {
       field: 'phoneNumber',
       headerName: 'Phone',
       width: 150,
       valueFormatter: (params) => params.value || '—'
     },
     {
       field: 'homeAddress',
       headerName: 'Address',
       width: 200,
       valueFormatter: (params) => {
         if (!params.value) return '—';
         // Truncate long addresses for preview
         return params.value.length > 50 
           ? params.value.substring(0, 50) + '...'
           : params.value;
       },
       renderCell: (params) => (
         <Tooltip title={params.value || 'No address provided'}>
           <span>{params.formattedValue}</span>
         </Tooltip>
       )
     }
   ];
   ```
3. Update row error styling to highlight validation errors for optional fields
4. Ensure validation errors display for optional field issues

**Validation**:
- [ ] Optional columns render in table
- [ ] Empty values show "—" (em dash)
- [ ] Dates formatted as "02 Jan 2022"
- [ ] Addresses truncated with "..." and show full text in tooltip
- [ ] Validation errors highlighted for optional fields
- [ ] Table width adjusts to accommodate new columns

**Estimate**: 45 minutes

---

### T013 [P]: [X] Update FileUploadSection help text
**File**: `frontend/apps/web/src/app/workspace/organization/components/FileUploadSection.tsx`  
**Type**: Modification (update documentation text)  
**Dependencies**: T010 (parallel with T011, T012)  
**Constitutional Requirements**: Clear user guidance for optional columns

**Task**:
1. Locate help text section in `FileUploadSection.tsx`
2. Update Excel column documentation to include optional columns:
   ```tsx
   <Alert severity="info" sx={{ mb: 2 }}>
     <AlertTitle>Excel File Requirements</AlertTitle>
     <Typography variant="body2" component="div">
       <strong>Required columns:</strong>
       <ul>
         <li>email</li>
         <li>given_name (or first_name)</li>
         <li>family_name (or last_name)</li>
       </ul>
       <strong>Optional columns:</strong>
       <ul>
         <li>hire_date (or start_date) - Format: YYYY-MM-DD, DD/MM/YYYY, or MM/DD/YYYY</li>
         <li>date_of_birth (or dob) - Format: YYYY-MM-DD, DD/MM/YYYY, or MM/DD/YYYY</li>
         <li>phone_number (or phone) - Format: +1-555-123-4567 (digits, +, - only)</li>
         <li>home_address (or address) - Max 500 characters</li>
       </ul>
       <Typography variant="caption" display="block" sx={{ mt: 1 }}>
         Column names are case-insensitive. Optional columns can be omitted entirely.
       </Typography>
     </Typography>
   </Alert>
   ```
3. Add example Excel structure showing optional columns
4. Link to quickstart.md or inline validation rules if needed

**Validation**:
- [ ] Required columns clearly listed
- [ ] Optional columns clearly listed with format hints
- [ ] Column aliases documented (e.g., "dob" for "date_of_birth")
- [ ] Case-insensitive matching explained
- [ ] Example structure visible to users

**Estimate**: 15 minutes

---

### T014: [X] Verify frontend packages build successfully
**Files**: All frontend packages and apps  
**Type**: Build verification  
**Dependencies**: T009, T010, T011, T012, T013 (all frontend changes complete)  
**Constitutional Requirements**: Generated code and manual changes must be committed

**Task**:
1. Build all frontend packages:
   ```bash
   cd /Users/nvcnvn/Codes/tech-office/frontend
   pnpm -r build
   ```
2. Run TypeScript type checking:
   ```bash
   pnpm -r typecheck
   ```
3. Run linting:
   ```bash
   pnpm -r lint
   ```
4. Verify no build errors or type errors
5. Stage all changes for commit:
   ```bash
   git add packages/rpc packages/apis apps/web/src/app/workspace/organization
   ```

**Validation**:
- [ ] All packages build without errors
- [ ] Type checking passes (`tsc --noEmit`)
- [ ] Linting passes (ESLint)
- [ ] No console errors when running dev server
- [ ] All changes staged for commit

**Estimate**: 10 minutes

---

## Phase 3.4: Manual Verification ⚠️ REQUIRED BEFORE TESTS

### T015: Manual testing of backend validation logic
**Location**: Run backend server and test with cURL/Postman  
**Type**: Manual verification (REQUIRED gate before automated tests)  
**Dependencies**: T001-T008 (all backend implementation complete)  
**Constitutional Requirements**: 
- Post-verification testing principle (Constitution v3.3.0)
- Human MUST verify correct behavior before writing tests

**Task**:
1. Start backend server:
   ```bash
   cd /Users/nvcnvn/Codes/tech-office/backend
   go run ./cmd server
   ```
2. Execute all test scenarios from `quickstart.md`:
   - **Scenario 1**: Import with all optional fields (verify parsing, validation, storage)
   - **Scenario 2**: Import with no optional fields (backward compatibility)
   - **Scenario 3**: Import with partial optional fields (mixed populated/empty)
   - **Scenario 4**: Import with invalid date formats (verify validation errors)
   - **Scenario 5**: Import with invalid phone formats (verify validation errors)
   - **Scenario 6**: Import with address > 500 chars (verify validation error)
3. For each scenario, verify:
   - ParseEmployeeFile returns correct data structure
   - PreviewEmployeeImport shows validation errors (if applicable)
   - ExecuteEmployeeImport stores data correctly in database
   - Dates formatted as "02 Jan 2022" in preview
   - Optional fields stored as NULL when not provided
4. Document any deviations or unexpected behavior
5. Confirm all 10 quickstart scenarios pass

**Reference**: See `quickstart.md` lines 1-502 for complete test scenarios with expected results

**Validation**:
- [ ] All 10 quickstart scenarios executed manually
- [ ] Date parsing works for all 5 supported formats
- [ ] Phone validation rejects invalid characters
- [ ] Address validation rejects > 500 chars
- [ ] Backward compatibility verified (no optional fields)
- [ ] Validation errors do not block preview display
- [ ] Optional fields stored as NULL in database when empty
- [ ] Deviations documented (if any)

**Estimate**: 2 hours

---

### T016: Manual testing of frontend UI and user flows
**Location**: Run frontend dev server and test in browser  
**Type**: Manual verification (REQUIRED gate before automated tests)  
**Dependencies**: T009-T014 (all frontend implementation complete)  
**Constitutional Requirements**: 
- Post-verification testing principle (Constitution v3.3.0)
- Workspace pattern compliance

**Task**:
1. Start frontend dev server:
   ```bash
   cd /Users/nvcnvn/Codes/tech-office/frontend
   pnpm web dev
   ```
2. Navigate to `http://localhost:13000/workspace/organization?tab=employees`
3. Test manual entry form:
   - Add employee with all optional fields
   - Add employee with no optional fields
   - Add employee with partial optional fields
   - Verify date pickers work correctly
   - Verify phone pattern hint shows
   - Verify address character counter updates
4. Test file upload:
   - Upload `all-fields.xlsx` (verify preview table shows all columns)
   - Upload `no-optional-fields.xlsx` (backward compatibility)
   - Upload `partial-optional-fields.xlsx` (mixed fields)
   - Upload `invalid-dates.xlsx` (verify validation errors display)
   - Upload `invalid-phone.xlsx` (verify validation errors display)
   - Upload `invalid-address.xlsx` (verify validation error)
5. Verify preview display:
   - Dates formatted as "02 Jan 2022"
   - Empty optional fields show "—" (em dash)
   - Address truncated with "..." and tooltip shows full text
   - Validation errors highlighted in red
6. Complete full import flow and verify data in database
7. Document UI/UX issues or unexpected behavior

**Reference**: See `quickstart.md` for test data files and expected results

**Validation**:
- [ ] Manual entry form works with optional fields
- [ ] File upload works with optional columns
- [ ] Preview table displays optional fields correctly
- [ ] Date formatting correct ("02 Jan 2022")
- [ ] Empty fields show "—" consistently
- [ ] Validation errors visible and actionable
- [ ] Full import flow completes successfully
- [ ] Workspace layout used (no duplicate layouts)
- [ ] UI/UX issues documented (if any)

**Estimate**: 1.5 hours

---

## Phase 3.5: Automated Tests (After Verification)

### T017 [P]: Add unit tests for backend validation helpers
**File**: `backend/internal/iam/employee_import_test.go`  
**Type**: New file (unit tests)  
**Dependencies**: T015 (manual verification MUST pass first)  
**Constitutional Requirements**: 
- Tests document verified-correct behavior
- Tests added AFTER human verification

**Task**:
1. Create `employee_import_test.go` if not exists
2. Add unit tests for validation helpers:
   ```go
   func TestParseDateField_AllFormats(t *testing.T) {
       // Test all 5 supported date formats
       tests := []struct {
           name     string
           input    string
           expected string // ISO 8601
       }{
           {"YYYY/MM/DD", "2022/03/15", "2022-03-15"},
           {"DD/MM/YYYY", "15/03/2022", "2022-03-15"},
           {"MM/DD/YYYY", "03/15/2022", "2022-03-15"},
           {"YYYY-MM-DD", "2022-03-15", "2022-03-15"},
           {"DD-MM-YYYY", "15-03-2022", "2022-03-15"},
       }
       // ... test implementation
   }
   
   func TestParseDateField_InvalidFormats(t *testing.T) {
       // Test invalid formats return errors
       // Edge cases: "2022/13/01", "44575", "invalid", "02 Jan 2022"
   }
   
   func TestParseDateField_EmptyString(t *testing.T) {
       // Test empty string returns nil, nil
   }
   
   func TestValidatePhoneNumber_ValidFormats(t *testing.T) {
       // Test valid international formats
       validPhones := []string{
           "+1-555-123-4567",
           "5551234567",
           "+44-20-7946-0958",
       }
       // ... test implementation
   }
   
   func TestValidatePhoneNumber_InvalidFormats(t *testing.T) {
       // Test invalid formats return errors
       invalidPhones := []string{
           "+1 (555) 123-4567",  // spaces and parentheses
           "555.123.4567",       // dots
           "1-800-CALL-NOW",     // letters
           "123",                // too short
           "12345678901234567890123", // too long
       }
       // ... test implementation
   }
   
   func TestValidateAddress_LengthLimits(t *testing.T) {
       // Test boundary conditions (500 chars)
       // Test 499 chars (valid), 500 chars (valid), 501 chars (invalid)
   }
   
   func TestValidateAddress_UTF8Characters(t *testing.T) {
       // Test accented characters, non-Latin scripts
       addresses := []string{
           "Café Müller Straße 123",
           "東京都渋谷区",
           "شارع الملك فهد",
       }
       // ... test implementation
   }
   ```
3. Run tests and verify all pass:
   ```bash
   cd /Users/nvcnvn/Codes/tech-office/backend
   go test ./internal/iam/... -v
   ```

**Validation**:
- [ ] All validation helper functions covered by tests
- [ ] Edge cases tested (empty strings, boundary values, invalid formats)
- [ ] UTF-8 character handling tested
- [ ] All tests pass
- [ ] Test coverage > 80% for validation helpers

**Estimate**: 1.5 hours

---

### T018 [P]: Add integration tests for employee import flow
**File**: `backend/internal/iam/employee_import_integration_test.go`  
**Type**: New file (integration tests)  
**Dependencies**: T015 (manual verification MUST pass first), parallel with T017  
**Constitutional Requirements**: 
- Integration tests validate end-to-end flows with database
- Multi-tenant isolation verified

**Task**:
1. Create `employee_import_integration_test.go`
2. Add integration tests for full import flow:
   ```go
   func TestParseEmployeeFile_WithAllOptionalFields(t *testing.T) {
       // Test Excel file with all optional columns populated
       // Verify EmployeeData includes all optional fields
   }
   
   func TestParseEmployeeFile_WithNoOptionalFields(t *testing.T) {
       // Test backward compatibility
       // Verify import works without optional columns
   }
   
   func TestPreviewEmployeeImport_InvalidDates(t *testing.T) {
       // Test validation error scenarios
       // Verify validation_errors array populated correctly
   }
   
   func TestPreviewEmployeeImport_InvalidPhone(t *testing.T) {
       // Test phone validation errors
   }
   
   func TestPreviewEmployeeImport_InvalidAddress(t *testing.T) {
       // Test address length validation
   }
   
   func TestExecuteEmployeeImport_WithOptionalFields(t *testing.T) {
       // Test database storage
       // Verify optional fields stored correctly (or NULL if empty)
       // Verify transaction atomicity (all-or-nothing)
   }
   
   func TestExecuteEmployeeImport_MultiTenantIsolation(t *testing.T) {
       // Test organization_id isolation
       // Verify employees created in correct organization
       // Verify no cross-tenant data leakage
   }
   ```
3. Use test database with migrations applied
4. Run integration tests:
   ```bash
   cd /Users/nvcnvn/Codes/tech-office/backend
   go test ./internal/iam/... -tags=integration -v
   ```

**Validation**:
- [ ] All import scenarios covered (all fields, no fields, partial fields)
- [ ] Validation error scenarios tested
- [ ] Database storage verified (correct types, NULL handling)
- [ ] Transaction atomicity verified
- [ ] Multi-tenant isolation verified
- [ ] All integration tests pass

**Estimate**: 2 hours

---

### T019 [P]: Add component tests for frontend import UI
**Files**: 
- `frontend/apps/web/src/app/workspace/organization/components/ImportDialog.test.tsx`
- `frontend/apps/web/src/app/workspace/organization/components/EmployeePreviewTable.test.tsx`

**Type**: New files (component tests)  
**Dependencies**: T016 (manual verification MUST pass first), parallel with T017, T018  
**Constitutional Requirements**: Tests document verified UI behavior

**Task**:
1. Create `ImportDialog.test.tsx`:
   ```tsx
   import { render, screen, fireEvent } from '@testing-library/react';
   import { ImportDialog } from './ImportDialog';
   
   describe('ImportDialog - Optional Fields', () => {
     test('renders optional field inputs with correct labels', () => {
       render(<ImportDialog open={true} onClose={jest.fn()} />);
       
       expect(screen.getByLabelText('Hire Date (optional)')).toBeInTheDocument();
       expect(screen.getByLabelText('Date of Birth (optional)')).toBeInTheDocument();
       expect(screen.getByLabelText('Phone Number (optional)')).toBeInTheDocument();
       expect(screen.getByLabelText('Home Address (optional)')).toBeInTheDocument();
     });
     
     test('shows format hints for optional fields', () => {
       // Verify helper text for date formats, phone pattern, address length
     });
     
     test('validates phone number pattern client-side', () => {
       // Test pattern hint (not enforcement - server-side authoritative)
     });
     
     test('shows character counter for address field', () => {
       // Test "0/500" counter updates on input
     });
     
     test('submits form with optional fields as undefined when empty', () => {
       // Verify empty optional fields are undefined, not empty strings
     });
   });
   ```

2. Create `EmployeePreviewTable.test.tsx`:
   ```tsx
   import { render, screen } from '@testing-library/react';
   import { EmployeePreviewTable } from './EmployeePreviewTable';
   
   describe('EmployeePreviewTable - Optional Fields', () => {
     test('renders optional field columns', () => {
       const employees = [
         {
           email: 'test@example.com',
           givenName: 'Test',
           familyName: 'User',
           hireDate: '2022-03-15',
           dateOfBirth: '1990-06-20',
           phoneNumber: '+1-555-123-4567',
           homeAddress: '123 Main St',
         }
       ];
       
       render(<EmployeePreviewTable employees={employees} />);
       
       expect(screen.getByText('15 Mar 2022')).toBeInTheDocument(); // Formatted hire date
       expect(screen.getByText('20 Jun 1990')).toBeInTheDocument(); // Formatted DOB
       expect(screen.getByText('+1-555-123-4567')).toBeInTheDocument();
       expect(screen.getByText('123 Main St')).toBeInTheDocument();
     });
     
     test('shows em dash for empty optional fields', () => {
       const employees = [
         {
           email: 'test@example.com',
           givenName: 'Test',
           familyName: 'User',
           // No optional fields
         }
       ];
       
       render(<EmployeePreviewTable employees={employees} />);
       
       const emDashes = screen.getAllByText('—');
       expect(emDashes.length).toBeGreaterThanOrEqual(4); // One per optional field
     });
     
     test('truncates long addresses with tooltip', () => {
       // Test address > 50 chars shows "..." and tooltip with full text
     });
     
     test('highlights validation errors for optional fields', () => {
       // Test error styling for invalid optional field values
     });
   });
   ```

3. Run component tests:
   ```bash
   cd /Users/nvcnvn/Codes/tech-office/frontend
   pnpm test apps/web/src/app/workspace/organization/components/
   ```

**Validation**:
- [ ] ImportDialog tests cover optional field rendering and behavior
- [ ] EmployeePreviewTable tests cover optional field display
- [ ] Empty field handling tested (em dash display)
- [ ] Validation error display tested
- [ ] All component tests pass

**Estimate**: 1.5 hours

---

### T020: Add contract test for extended EmployeeData message
**File**: `backend/internal/iam/iam_contract_test.go`  
**Type**: New file (contract test)  
**Dependencies**: T002, T015 (protobuf generated and verified)  
**Constitutional Requirements**: Contract tests validate public API surface

**Task**:
1. Create `iam_contract_test.go`
2. Add contract test for protobuf message structure:
   ```go
   func TestEmployeeData_OptionalFieldsContract(t *testing.T) {
       // Test protobuf message has optional fields with correct types
       emp := &rpcv1.EmployeeData{
           Email:        "test@example.com",
           GivenName:    "Test",
           FamilyName:   "User",
           RowNumber:    1,
           HireDate:     stringPtr("2022-03-15"),
           DateOfBirth:  stringPtr("1990-06-20"),
           PhoneNumber:  stringPtr("+1-555-123-4567"),
           HomeAddress:  stringPtr("123 Main St"),
       }
       
       // Verify optional fields are pointers (can be nil)
       require.IsType(t, (*string)(nil), emp.HireDate)
       require.IsType(t, (*string)(nil), emp.DateOfBirth)
       require.IsType(t, (*string)(nil), emp.PhoneNumber)
       require.IsType(t, (*string)(nil), emp.HomeAddress)
       
       // Verify nil optional fields are valid
       empWithoutOptional := &rpcv1.EmployeeData{
           Email:      "test2@example.com",
           GivenName:  "Test2",
           FamilyName: "User2",
       }
       require.Nil(t, empWithoutOptional.HireDate)
       require.Nil(t, empWithoutOptional.DateOfBirth)
       require.Nil(t, empWithoutOptional.PhoneNumber)
       require.Nil(t, empWithoutOptional.HomeAddress)
   }
   
   func TestEmployeeData_BackwardCompatibility(t *testing.T) {
       // Test messages without optional fields can be deserialized
       // (simulates old client sending to new server)
   }
   ```
3. Run contract tests:
   ```bash
   cd /Users/nvcnvn/Codes/tech-office/backend
   go test ./internal/iam/... -tags=contract -v
   ```

**Validation**:
- [ ] Contract test verifies optional field types
- [ ] Backward compatibility tested (nil optional fields valid)
- [ ] Contract test passes
- [ ] No breaking changes to existing message fields

**Estimate**: 30 minutes

---

## Phase 3.6: Documentation & Polish

### T021 [P]: Update feature documentation
**Files**: 
- `specs/004-import-employee-with/README.md` (create if not exists)
- Update user guide (location TBD)

**Type**: Documentation  
**Dependencies**: T015, T016 (manual verification complete)  
**Constitutional Requirements**: Clear user guidance

**Task**:
1. Create feature README in spec directory:
   ```markdown
   # Enhanced Employee Import with Optional Fields
   
   ## Feature Overview
   This feature extends the employee import functionality with 4 optional fields:
   - Hire Date
   - Date of Birth
   - Phone Number
   - Home Address
   
   ## User Guide
   ### Excel Template
   ... (include column headers, format requirements, examples)
   
   ### Manual Entry
   ... (form field descriptions, validation rules)
   
   ### Validation Rules
   ... (date formats, phone pattern, address length)
   
   ## Technical Details
   - Protobuf: EmployeeData message extended with optional fields
   - Backend: Validation in PreviewEmployeeImport step
   - Frontend: Workspace/organization import components
   - Database: Uses existing organization.employee columns
   ```

2. Update user guide (if exists) with optional field documentation:
   - Section on optional fields in employee import
   - Excel template examples with optional columns
   - Date format recommendations (YYYY-MM-DD preferred)
   - Phone number format requirements (international, digits/+/- only)
   - Address guidelines (max 500 chars, multi-line allowed)

3. Add inline API documentation (JSDoc/GoDoc) if not already present

**Validation**:
- [ ] Feature README created with complete documentation
- [ ] User guide updated (if exists)
- [ ] Excel template examples provided
- [ ] Validation rules clearly documented
- [ ] Technical details documented for maintainers

**Estimate**: 45 minutes

---

### T022: Final smoke test and validation
**Location**: Run full stack (backend + frontend + database)  
**Type**: End-to-end validation  
**Dependencies**: T001-T021 (all tasks complete)  
**Constitutional Requirements**: Quickstart scenarios pass

**Task**:
1. Start full stack:
   ```bash
   # Terminal 1: Database
   docker-compose up -d postgres
   
   # Terminal 2: Backend
   cd /Users/nvcnvn/Codes/tech-office/backend
   go run ./cmd server
   
   # Terminal 3: Frontend
   cd /Users/nvcnvn/Codes/tech-office/frontend
   pnpm web dev
   ```

2. Re-run all 10 quickstart scenarios from `quickstart.md`:
   - Scenario 1: Import with all optional fields ✅
   - Scenario 2: Import with no optional fields (backward compatibility) ✅
   - Scenario 3: Import with partial optional fields ✅
   - Scenario 4: Invalid date formats (validation errors) ✅
   - Scenario 5: Invalid phone formats (validation errors) ✅
   - Scenario 6: Invalid address (length error) ✅
   - Scenario 7: Date format ambiguity (DD/MM vs MM/DD) ✅
   - Scenario 8: UTF-8 characters in address ✅
   - Scenario 9: Leap year dates ✅
   - Scenario 10: Edge case phone numbers ✅

3. Run automated test suites:
   ```bash
   # Backend tests
   cd /Users/nvcnvn/Codes/tech-office/backend
   go test ./...
   
   # Frontend tests
   cd /Users/nvcnvn/Codes/tech-office/frontend
   pnpm test
   ```

4. Verify CI/CD pipeline:
   - All tests pass in CI
   - Linting passes
   - Build succeeds
   - No breaking changes detected

5. Verify no regressions:
   - Existing employee import without optional fields still works
   - Multi-tenant isolation preserved
   - RBAC permissions enforced (ROLE_OWNER, ROLE_OPERATOR only)

6. Create checklist for PR:
   - [ ] All quickstart scenarios pass
   - [ ] All automated tests pass
   - [ ] CI/CD pipeline green
   - [ ] Generated code committed (`buf generate`, `pnpm build`)
   - [ ] Documentation updated
   - [ ] No regressions in existing functionality

**Validation**:
- [ ] All 10 quickstart scenarios pass
- [ ] Backend tests pass (`go test ./...`)
- [ ] Frontend tests pass (`pnpm test`)
- [ ] CI/CD pipeline green
- [ ] No regressions detected
- [ ] PR checklist complete

**Estimate**: 1 hour

---

## Dependencies Summary

### Critical Path (Sequential)
```
T001 (proto extension)
  ↓
T002 (code generation)
  ↓
T006 (parser extension)
  ↓
T007 (preview validation)
  ↓
T008 (execute import)
  ↓
T015 (manual backend verification) ← GATE
  ↓
T017, T018, T020 (backend automated tests)
```

### Frontend Chain
```
T002 (code generation)
  ↓
T009 (RPC exports)
  ↓
T010 (API wrappers)
  ↓
T011, T012, T013 (UI components) [parallel]
  ↓
T014 (build verification)
  ↓
T016 (manual frontend verification) ← GATE
  ↓
T019 (frontend automated tests)
```

### Parallel Work Opportunities
```
T003, T004, T005: Validation helpers (parallel - different functions)
T011, T012, T013: Frontend UI components (parallel - different files)
T017, T018, T020: Backend tests (parallel - different test files)
T021: Documentation (parallel with T022)
```

---

## Parallel Execution Examples

### Backend Validation Helpers (after T002)
```bash
# Developer 1
Task: "Implement date parsing helper in backend/internal/iam/employee_import.go"

# Developer 2 (parallel)
Task: "Implement phone validation helper in backend/internal/iam/employee_import.go"

# Developer 3 (parallel)
Task: "Implement address validation helper in backend/internal/iam/employee_import.go"
```

### Frontend UI Components (after T010)
```bash
# Developer 1
Task: "Extend ImportDialog form with optional field inputs in frontend/apps/web/src/app/workspace/organization/components/ImportDialog.tsx"

# Developer 2 (parallel)
Task: "Extend EmployeePreviewTable to display optional fields in frontend/apps/web/src/app/workspace/organization/components/EmployeePreviewTable.tsx"

# Developer 3 (parallel)
Task: "Update FileUploadSection help text in frontend/apps/web/src/app/workspace/organization/components/FileUploadSection.tsx"
```

### Automated Tests (after T015, T016 verification gates)
```bash
# Developer 1
Task: "Add unit tests for backend validation helpers in backend/internal/iam/employee_import_test.go"

# Developer 2 (parallel)
Task: "Add integration tests for employee import flow in backend/internal/iam/employee_import_integration_test.go"

# Developer 3 (parallel)
Task: "Add component tests for frontend import UI in frontend/apps/web/src/app/workspace/organization/components/*.test.tsx"

# Developer 4 (parallel)
Task: "Add contract test for extended EmployeeData message in backend/internal/iam/iam_contract_test.go"
```

---

## Estimated Total Effort

### By Phase
- **Phase 3.1 (Setup)**: 25 minutes (T001-T002)
- **Phase 3.2 (Backend Core)**: 3 hours (T003-T008)
- **Phase 3.3 (Frontend Core)**: 2.5 hours (T009-T014)
- **Phase 3.4 (Manual Verification)**: 3.5 hours (T015-T016) ← CRITICAL GATE
- **Phase 3.5 (Automated Tests)**: 5.5 hours (T017-T020)
- **Phase 3.6 (Documentation & Polish)**: 1.75 hours (T021-T022)

### Total Effort
- **Total**: ~16.75 hours (approximately 2 days for single developer)
- **With Parallel Work**: ~10 hours (if 3+ developers working in parallel)

### CI/CD Validation Time
- Backend tests: ~5 minutes
- Frontend tests: ~3 minutes
- Build & lint: ~2 minutes
- **Total CI time**: ~10 minutes per commit

---

## Notes

### Constitutional Compliance
- ✅ **Schema-First**: No schema changes needed (fields already exist in database)
- ✅ **Post-Verification Testing**: Manual verification (T015-T016) before automated tests (T017-T020)
- ✅ **Backend Service Architecture**: Extends existing compliant service (AdminPool/TenantPool pattern)
- ✅ **Frontend Workspace Pattern**: Extends existing workspace/organization feature (no layout duplication)
- ✅ **Generated Code Propagation**: Explicit tasks for `buf generate` (T002) and `pnpm build` (T014)

### Task Characteristics
- **[P] tasks**: Can be worked on independently (different files, no dependencies)
- **Sequential tasks**: Must complete in order (dependencies exist)
- **Manual verification gates**: T015 and T016 are REQUIRED before automated tests
- **Commit strategy**: Commit after each task or logical group (e.g., T003-T005 together)

### Avoiding Pitfalls
- ❌ **Do NOT skip manual verification**: Automated tests document verified-correct behavior
- ❌ **Do NOT create duplicate layouts**: Extend existing workspace/organization components
- ❌ **Do NOT forget codegen**: Must run `buf generate` and `pnpm build` after proto changes
- ❌ **Do NOT break backward compatibility**: Existing imports without optional fields must work
- ❌ **Do NOT bypass tenant isolation**: All queries must filter by `organization_id`

### Success Criteria
- All 10 quickstart scenarios pass
- All automated tests pass (backend + frontend)
- CI/CD pipeline green
- No regressions in existing employee import
- Documentation complete and accurate
- Code review approved by 2 reviewers (1 maintainer)

---

**Version**: 1.0.0  
**Generated**: October 26, 2025  
**Based On**: Constitution v3.4.0, Spec 004-import-employee-with  
**Ready for Execution**: ✅ YES

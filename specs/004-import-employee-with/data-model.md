# Data Model: Enhanced Employee Import with Additional Fields

**Feature**: 004-import-employee-with  
**Date**: October 26, 2025  
**Status**: Complete

## Overview
This document specifies the data structures and validation rules for the four optional fields being added to the employee import feature. **No database schema changes are required** - all fields already exist in the `organization.employee` table.

## Database Schema (Existing - No Changes)

### organization.employee Table
```sql
-- Existing table from schema.sql lines 58-68
CREATE TABLE IF NOT EXISTS organization.employee (
    id UUID PRIMARY KEY REFERENCES iam.identity(id),
    organization_id UUID REFERENCES public.organization(id) ON DELETE CASCADE,
    given_name TEXT NOT NULL,
    family_name TEXT NOT NULL,
    hire_date DATE,                    -- ← EXISTING optional field
    date_of_birth DATE,                -- ← EXISTING optional field
    phone_number TEXT,                 -- ← EXISTING optional field
    home_address TEXT,                 -- ← EXISTING optional field
    additional_info JSONB,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Schema Notes**:
- All four optional fields already exist as nullable columns
- No migration required (Atlas will detect no changes)
- Multi-tenant isolation via `organization_id` foreign key + RLS policy
- Existing indexes and constraints remain unchanged

## Protobuf Schema (Extension Required)

### Extended EmployeeData Message
```protobuf
// File: backend/rpc/v1/iam.proto (lines 120-131)
message EmployeeData {
  string email = 1;           // Required: user@example.com
  string given_name = 2;      // Required: First name
  string family_name = 3;     // Required: Last name
  int32 row_number = 4;       // Optional: Source row number for error reporting
  
  // NEW OPTIONAL FIELDS (v2 extension):
  optional string hire_date = 5;        // Optional: ISO 8601 date string (YYYY-MM-DD)
  optional string date_of_birth = 6;    // Optional: ISO 8601 date string (YYYY-MM-DD)
  optional string phone_number = 7;     // Optional: International format (numeric, +, -)
  optional string home_address = 8;     // Optional: Free-form text (max 500 chars)
}
```

**Protobuf Design Decisions**:
- `optional` keyword ensures backward compatibility (existing clients can omit fields)
- Date fields transmitted as ISO 8601 strings (YYYY-MM-DD) for unambiguous serialization
- Phone and address transmitted as raw strings (validation on server side)
- Field numbers 5-8 follow sequential numbering (no gaps for future extensions)

**Generated Go Types** (after `buf generate`):
```go
type EmployeeData struct {
    Email        string   `protobuf:"bytes,1,opt,name=email,proto3"`
    GivenName    string   `protobuf:"bytes,2,opt,name=given_name,json=givenName,proto3"`
    FamilyName   string   `protobuf:"bytes,3,opt,name=family_name,json=familyName,proto3"`
    RowNumber    int32    `protobuf:"varint,4,opt,name=row_number,json=rowNumber,proto3"`
    HireDate     *string  `protobuf:"bytes,5,opt,name=hire_date,json=hireDate,proto3,oneof"` // ← Pointer for optional
    DateOfBirth  *string  `protobuf:"bytes,6,opt,name=date_of_birth,json=dateOfBirth,proto3,oneof"`
    PhoneNumber  *string  `protobuf:"bytes,7,opt,name=phone_number,json=phoneNumber,proto3,oneof"`
    HomeAddress  *string  `protobuf:"bytes,8,opt,name=home_address,json=homeAddress,proto3,oneof"`
}
```

**Generated TypeScript Types** (after frontend build):
```typescript
export interface EmployeeData {
  email: string;
  givenName: string;
  familyName: string;
  rowNumber: number;
  hireDate?: string;      // ← Optional in TypeScript
  dateOfBirth?: string;
  phoneNumber?: string;
  homeAddress?: string;
}
```

## Field Specifications

### 1. hire_date (Optional)

**Database Type**: `DATE` (PostgreSQL native date type)  
**Protobuf Type**: `optional string` (ISO 8601: YYYY-MM-DD)  
**Go Type**: `*time.Time` (pointer for nullable)  
**TypeScript Type**: `string | undefined`

**Purpose**: Track employee start date for HR analytics, tenure calculations, anniversary notifications

**Validation Rules**:
1. **Format**: Must be parseable as valid date using one of 5 supported formats:
   - `YYYY/MM/DD` (e.g., 2022/03/15)
   - `DD/MM/YYYY` (e.g., 15/03/2022)
   - `MM/DD/YYYY` (e.g., 03/15/2022)
   - `YYYY-MM-DD` (e.g., 2022-03-15) ← ISO 8601, transmitted format
   - `DD-MM-YYYY` (e.g., 15-03-2022)
2. **Range**: No explicit date range validation (can be past or future)
3. **Nullability**: Can be omitted or explicitly null
4. **Error Handling**: If unparseable, show error message with row number and supported formats; allow user to fix or continue with field empty

**Parsing Algorithm** (Go):
```go
func parseDateField(value string) (*time.Time, error) {
    if strings.TrimSpace(value) == "" {
        return nil, nil // Empty = null, not an error
    }
    
    layouts := []string{
        "2006/01/02",   // YYYY/MM/DD
        "02/01/2006",   // DD/MM/YYYY
        "01/02/2006",   // MM/DD/YYYY
        "2006-01-02",   // YYYY-MM-DD (ISO 8601)
        "02-01-2006",   // DD-MM-YYYY
    }
    
    for _, layout := range layouts {
        if t, err := time.Parse(layout, value); err == nil {
            return &t, nil
        }
    }
    
    return nil, fmt.Errorf("invalid date format '%s' - supported formats: YYYY/MM/DD, DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD, DD-MM-YYYY", value)
}
```

**Display Format** (Preview Step):
- Format: "02 Jan 2022" (day + 3-letter month + year)
- Go: `t.Format("02 Jan 2006")`
- TypeScript: `new Date(isoString).toLocaleDateString('en-GB', {day: '2-digit', month: 'short', year: 'numeric'})`

**Excel Column Headers** (case-insensitive):
- "hire date"
- "hire_date"
- "hiredate"
- "start date"
- "start_date"

---

### 2. date_of_birth (Optional)

**Database Type**: `DATE` (PostgreSQL native date type)  
**Protobuf Type**: `optional string` (ISO 8601: YYYY-MM-DD)  
**Go Type**: `*time.Time` (pointer for nullable)  
**TypeScript Type**: `string | undefined`

**Purpose**: Track employee birthdays for HR records, compliance, benefits eligibility

**Validation Rules**:
1. **Format**: Same 5 date formats as `hire_date` (see above)
2. **Range**: No explicit age validation (no min/max constraints)
3. **Nullability**: Can be omitted or explicitly null
4. **Error Handling**: Same as `hire_date` - show error with supported formats

**Parsing Algorithm**: Use same `parseDateField()` function as `hire_date`

**Display Format** (Preview Step): "02 Jan 1990" (same format as hire_date)

**Excel Column Headers** (case-insensitive):
- "date of birth"
- "date_of_birth"
- "dob"
- "birth date"
- "birth_date"
- "birthdate"

**Privacy Note**: 
- Date of birth is sensitive personal information
- No display in public-facing employee lists (only in admin HR views)
- Consider GDPR/privacy regulations for storage and access

---

### 3. phone_number (Optional)

**Database Type**: `TEXT` (PostgreSQL text, no length limit enforced at DB level)  
**Protobuf Type**: `optional string`  
**Go Type**: `*string` (pointer for nullable)  
**TypeScript Type**: `string | undefined`

**Purpose**: Contact information for employee communication, emergency contact

**Validation Rules**:
1. **Character Set**: Only numeric digits, "+", and "-" allowed
   - ✅ Valid: `+1-555-123-4567`, `5551234567`, `+44-20-7946-0958`
   - ❌ Invalid: `+1 (555) 123-4567`, `555.123.4567`, `1-800-CALL-NOW`
2. **Length**: Minimum 7 characters, maximum 20 characters
3. **Regex Pattern**: `^[0-9+\-]{7,20}$`
4. **Nullability**: Can be omitted or explicitly null
5. **No Normalization**: Stored exactly as provided (no E.164 conversion)

**Validation Algorithm** (Go):
```go
var phoneRegex = regexp.MustCompile(`^[0-9+\-]{7,20}$`)

func validatePhoneNumber(phone string) error {
    trimmed := strings.TrimSpace(phone)
    if trimmed == "" {
        return nil // Empty = null, not an error
    }
    
    if !phoneRegex.MatchString(trimmed) {
        return fmt.Errorf("phone number '%s' contains invalid characters - only numbers, +, and - allowed (no spaces or parentheses)", phone)
    }
    
    return nil
}
```

**Error Messages**:
- Invalid characters: "Phone number contains invalid characters - only numbers, +, and - allowed"
- Too short: "Phone number must be at least 7 characters"
- Too long: "Phone number cannot exceed 20 characters"

**Excel Column Headers** (case-insensitive):
- "phone"
- "phone number"
- "phone_number"
- "mobile"
- "mobile number"
- "contact number"

**Display Format**: Display as-is (no formatting applied)

---

### 4. home_address (Optional)

**Database Type**: `TEXT` (PostgreSQL text with UTF-8 encoding)  
**Protobuf Type**: `optional string`  
**Go Type**: `*string` (pointer for nullable)  
**TypeScript Type**: `string | undefined`

**Purpose**: Employee residential address for HR records, shipping, compliance

**Validation Rules**:
1. **Max Length**: 500 characters (counted as UTF-8 runes, not bytes)
2. **Character Set**: Any UTF-8 characters allowed
   - ✅ Accented: café, Müller, naïve
   - ✅ Non-Latin: 日本, العربية, Москва
   - ✅ Symbols: #, -, /, comma, period
3. **Multi-line**: CR/LF preserved (stored as-is)
4. **Nullability**: Can be omitted or explicitly null
5. **No Parsing**: Free-form text, no address component extraction

**Validation Algorithm** (Go):
```go
func validateAddress(address string) error {
    trimmed := strings.TrimSpace(address)
    if trimmed == "" {
        return nil // Empty = null, not an error
    }
    
    runeCount := utf8.RuneCountInString(trimmed)
    if runeCount > 500 {
        return fmt.Errorf("home address exceeds 500 character limit (current: %d characters)", runeCount)
    }
    
    return nil
}
```

**Error Messages**:
- Too long: "Home address exceeds 500 character limit (current: 623 characters)"

**Excel Column Headers** (case-insensitive):
- "address"
- "home address"
- "home_address"
- "residential address"
- "street address"

**Display Format**: 
- Preview: Show first 100 characters with "..." if longer
- Detail view: Show full address (preserve line breaks)

**Privacy Note**: 
- Home address is sensitive personal information
- Restrict access to HR administrators only
- Consider GDPR/privacy regulations for storage and access

---

## Validation Summary Table

| Field | Type | Required | Max Length | Validation Pattern | Error on Invalid |
|-------|------|----------|------------|-------------------|------------------|
| email | string | ✅ Yes | 255 | Valid email format | ❌ Block import |
| given_name | string | ✅ Yes | unlimited | Any UTF-8 | ❌ Block import |
| family_name | string | ✅ Yes | unlimited | Any UTF-8 | ❌ Block import |
| hire_date | date | ❌ No | N/A | 5 date formats | ⚠️ Show error, allow skip |
| date_of_birth | date | ❌ No | N/A | 5 date formats | ⚠️ Show error, allow skip |
| phone_number | string | ❌ No | 20 chars | `^[0-9+\-]{7,20}$` | ⚠️ Show error, allow skip |
| home_address | string | ❌ No | 500 chars | Any UTF-8 | ⚠️ Show error, must fix |

**Key**:
- ❌ Block import: Validation error prevents progression to preview/confirm
- ⚠️ Show error, allow skip: User can fix data or continue with field empty
- ⚠️ Show error, must fix: User must correct data to continue (address length only)

## Go Type Mappings

### Database to Go (sqlc generated)
```go
type Employee struct {
    ID             dbuuid.UUID        `db:"id"`
    OrganizationID dbuuid.UUID        `db:"organization_id"`
    GivenName      string           `db:"given_name"`
    FamilyName     string           `db:"family_name"`
    HireDate       pgtype.Date      `db:"hire_date"`       // nullable via pgtype
    DateOfBirth    pgtype.Date      `db:"date_of_birth"`   // nullable via pgtype
    PhoneNumber    pgtype.Text      `db:"phone_number"`    // nullable via pgtype
    HomeAddress    pgtype.Text      `db:"home_address"`    // nullable via pgtype
    AdditionalInfo pgtype.JSONB     `db:"additional_info"`
    IsActive       bool             `db:"is_active"`
    UpdatedAt      time.Time        `db:"updated_at"`
}
```

### Go Protobuf to Database
```go
// Convert protobuf EmployeeData to database parameters
func (s *EmployeeImportService) employeeDataToParams(ctx context.Context, emp *v1.EmployeeData, orgID dbuuid.UUID, identityID dbuuid.UUID) database.CreateEmployeeParams {
    params := database.CreateEmployeeParams{
        ID:             identityID,
        OrganizationID: orgID,
        GivenName:      emp.GivenName,
        FamilyName:     emp.FamilyName,
        IsActive:       true,
    }
    
    // Optional hire_date
    if emp.HireDate != nil && *emp.HireDate != "" {
        if t, err := parseDateField(*emp.HireDate); err == nil {
            params.HireDate = pgtype.Date{Time: *t, Valid: true}
        }
    }
    
    // Optional date_of_birth
    if emp.DateOfBirth != nil && *emp.DateOfBirth != "" {
        if t, err := parseDateField(*emp.DateOfBirth); err == nil {
            params.DateOfBirth = pgtype.Date{Time: *t, Valid: true}
        }
    }
    
    // Optional phone_number
    if emp.PhoneNumber != nil && *emp.PhoneNumber != "" {
        params.PhoneNumber = pgtype.Text{String: *emp.PhoneNumber, Valid: true}
    }
    
    // Optional home_address
    if emp.HomeAddress != nil && *emp.HomeAddress != "" {
        params.HomeAddress = pgtype.Text{String: *emp.HomeAddress, Valid: true}
    }
    
    return params
}
```

## Migration Plan

**NONE REQUIRED** - Database schema already supports all fields.

## References

- **Database Schema**: `backend/database/scripts/schema.sql` lines 58-68
- **Existing Protobuf**: `backend/rpc/v1/iam.proto` lines 120-131
- **Existing Service**: `backend/internal/iam/employee_import.go`
- **pgx Types**: `github.com/jackc/pgx/v5/pgtype` for nullable database types
- **Time Parsing**: Go standard library `time.Parse()` with layout strings

## Next Steps

1. Create protobuf contract extension in `contracts/iam.proto`
2. Create validation rules document in `contracts/validation.md`
3. Create quickstart test scenarios in `quickstart.md`
4. Update agent context file (`.github/copilot-instructions.md`)

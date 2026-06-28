# Validation Rules: Enhanced Employee Import Optional Fields

**Feature**: 004-import-employee-with  
**Date**: October 26, 2025  
**Status**: Complete

## Overview
This document specifies the detailed validation algorithms for the four optional fields in the employee import feature. All validation is performed server-side in the `PreviewEmployeeImport` RPC method before any database operations.

## Validation Architecture

### Validation Flow
```
ParseEmployeeFile (parse only, no validation)
    ↓
PreviewEmployeeImport (comprehensive validation)
    ↓
    For each EmployeeData:
        1. Validate required fields (email, given_name, family_name)
        2. Validate optional fields (only if provided):
           - hire_date: parseDateField()
           - date_of_birth: parseDateField()
           - phone_number: validatePhoneNumber()
           - home_address: validateAddress()
    ↓
Return EmployeePreviewItem[] with validation_errors per employee
    ↓
ExecuteEmployeeImport (only if all validation_errors empty)
```

### Error Handling Strategy
- **Required fields**: Validation errors block progression to ExecuteEmployeeImport
- **Optional fields**: 
  - Empty/null values → No validation, stored as NULL
  - Provided values → Validate; if invalid, add to validation_errors
  - Users can fix or remove invalid optional field values

---

## 1. Date Field Validation (hire_date, date_of_birth)

### Algorithm: parseDateField

**Input**: `value string` (from Excel cell or form input)  
**Output**: `(*time.Time, error)` - parsed date or error with supported formats

**Implementation** (Go):
```go
package iam

import (
    "fmt"
    "strings"
    "time"
)

// parseDateField attempts to parse a date string using 5 common formats.
// Returns nil, nil for empty strings (valid - means optional field not provided).
// Returns nil, error if parsing fails for all formats.
func parseDateField(value string, fieldName string) (*time.Time, error) {
    // Step 1: Handle empty/null values
    trimmed := strings.TrimSpace(value)
    if trimmed == "" {
        return nil, nil // Empty = not provided, not an error
    }
    
    // Step 2: Define supported date formats (Go layout strings)
    // Go uses reference time: Mon Jan 2 15:04:05 MST 2006
    layouts := []string{
        "2006/01/02",   // YYYY/MM/DD (e.g., 2022/03/15)
        "02/01/2006",   // DD/MM/YYYY (e.g., 15/03/2022)
        "01/02/2006",   // MM/DD/YYYY (e.g., 03/15/2022)
        "2006-01-02",   // YYYY-MM-DD ISO 8601 (e.g., 2022-03-15)
        "02-01-2006",   // DD-MM-YYYY (e.g., 15-03-2022)
    }
    
    // Step 3: Try each format in order
    for _, layout := range layouts {
        if t, err := time.Parse(layout, trimmed); err == nil {
            // Parsing succeeded - return parsed time
            return &t, nil
        }
    }
    
    // Step 4: All formats failed - return descriptive error
    return nil, fmt.Errorf(
        "%s has invalid date format '%s' - supported formats: YYYY/MM/DD, DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD, DD-MM-YYYY",
        fieldName,
        value,
    )
}
```

### Usage in PreviewEmployeeImport
```go
// Validate hire_date if provided
if emp.HireDate != nil && *emp.HireDate != "" {
    if _, err := parseDateField(*emp.HireDate, "Hire date"); err != nil {
        validationErrors = append(validationErrors, err.Error())
    }
}

// Validate date_of_birth if provided
if emp.DateOfBirth != nil && *emp.DateOfBirth != "" {
    if _, err := parseDateField(*emp.DateOfBirth, "Date of birth"); err != nil {
        validationErrors = append(validationErrors, err.Error())
    }
}
```

### Error Message Examples
```
Row 5: Hire date has invalid date format '2022/13/45' - supported formats: YYYY/MM/DD, DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD, DD-MM-YYYY

Row 12: Date of birth has invalid date format 'invalid' - supported formats: YYYY/MM/DD, DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD, DD-MM-YYYY
```

### Edge Cases
| Input | Result | Reason |
|-------|--------|--------|
| `""` | `nil, nil` | Empty string = optional field not provided |
| `"  "` | `nil, nil` | Whitespace-only trimmed to empty |
| `"2022-02-29"` | `nil, error` | Invalid leap year date (2022 not leap year) |
| `"2024-02-29"` | `time.Time, nil` | Valid leap year date (2024 is leap year) |
| `"2022/13/01"` | `nil, error` | Invalid month (13) |
| `"44575"` | `nil, error` | Excel numeric format not supported |
| `"02 Jan 2022"` | `nil, error` | Display format not parseable |

### Date Conversion for Database Storage
```go
// Convert parsed time.Time to pgtype.Date for database insertion
func timeToPgDate(t *time.Time) pgtype.Date {
    if t == nil {
        return pgtype.Date{Valid: false} // NULL in database
    }
    return pgtype.Date{Time: *t, Valid: true}
}
```

### Date Formatting for Preview Display
```go
// Format date for unambiguous display: "02 Jan 2022"
func formatDateForPreview(t *time.Time) string {
    if t == nil {
        return "—" // Em dash for empty/null
    }
    return t.Format("02 Jan 2006") // e.g., "15 Mar 2022"
}
```

---

## 2. Phone Number Validation

### Algorithm: validatePhoneNumber

**Input**: `phone string` (from Excel cell or form input)  
**Output**: `error` - nil if valid, error if invalid

**Implementation** (Go):
```go
package iam

import (
    "fmt"
    "regexp"
    "strings"
)

// phoneRegex allows only numeric digits, "+", and "-"
// Length: 7-20 characters (covers shortest to longest international formats)
var phoneRegex = regexp.MustCompile(`^[0-9+\-]{7,20}$`)

// validatePhoneNumber checks phone number format.
// Returns nil for empty strings (valid - means optional field not provided).
// Returns error if phone contains invalid characters or wrong length.
func validatePhoneNumber(phone string) error {
    // Step 1: Handle empty/null values
    trimmed := strings.TrimSpace(phone)
    if trimmed == "" {
        return nil // Empty = not provided, not an error
    }
    
    // Step 2: Check character set and length using regex
    if !phoneRegex.MatchString(trimmed) {
        // Determine specific error type
        if len(trimmed) < 7 {
            return fmt.Errorf(
                "phone number '%s' is too short - minimum 7 characters required",
                phone,
            )
        }
        if len(trimmed) > 20 {
            return fmt.Errorf(
                "phone number '%s' is too long - maximum 20 characters allowed",
                phone,
            )
        }
        // Invalid characters
        return fmt.Errorf(
            "phone number '%s' contains invalid characters - only numbers, +, and - allowed (no spaces, parentheses, or letters)",
            phone,
        )
    }
    
    return nil // Valid
}
```

### Usage in PreviewEmployeeImport
```go
// Validate phone_number if provided
if emp.PhoneNumber != nil && *emp.PhoneNumber != "" {
    if err := validatePhoneNumber(*emp.PhoneNumber); err != nil {
        validationErrors = append(validationErrors, err.Error())
    }
}
```

### Error Message Examples
```
Row 3: phone number '+1 (555) 123-4567' contains invalid characters - only numbers, +, and - allowed (no spaces, parentheses, or letters)

Row 8: phone number '555' is too short - minimum 7 characters required

Row 15: phone number '+1-555-123-4567-8901-2345' is too long - maximum 20 characters allowed
```

### Valid Phone Number Examples
| Format | Valid? | Notes |
|--------|--------|-------|
| `+1-555-123-4567` | ✅ | US format with dashes |
| `5551234567` | ✅ | US format, no separators |
| `+44-20-7946-0958` | ✅ | UK format |
| `+81-3-1234-5678` | ✅ | Japan format |
| `+1 (555) 123-4567` | ❌ | Spaces and parentheses not allowed |
| `555.123.4567` | ❌ | Dots not allowed |
| `1-800-CALL-NOW` | ❌ | Letters not allowed |
| `555-123` | ❌ | Too short (< 7 chars) |

### Phone Number Storage
```go
// Store phone number as-is (no normalization)
func phoneToText(phone *string) pgtype.Text {
    if phone == nil || strings.TrimSpace(*phone) == "" {
        return pgtype.Text{Valid: false} // NULL in database
    }
    return pgtype.Text{String: strings.TrimSpace(*phone), Valid: true}
}
```

---

## 3. Home Address Validation

### Algorithm: validateAddress

**Input**: `address string` (from Excel cell or multiline form input)  
**Output**: `error` - nil if valid, error if exceeds 500 characters

**Implementation** (Go):
```go
package iam

import (
    "fmt"
    "strings"
    "unicode/utf8"
)

// validateAddress checks address length (max 500 UTF-8 characters).
// Returns nil for empty strings (valid - means optional field not provided).
// Returns error if address exceeds 500 character limit.
func validateAddress(address string) error {
    // Step 1: Handle empty/null values
    trimmed := strings.TrimSpace(address)
    if trimmed == "" {
        return nil // Empty = not provided, not an error
    }
    
    // Step 2: Count UTF-8 characters (not bytes)
    // Important: "café" is 4 characters, not 5 bytes
    runeCount := utf8.RuneCountInString(trimmed)
    
    // Step 3: Check max length
    if runeCount > 500 {
        return fmt.Errorf(
            "home address exceeds 500 character limit (current: %d characters) - please abbreviate or split into multiple lines",
            runeCount,
        )
    }
    
    return nil // Valid
}
```

### Usage in PreviewEmployeeImport
```go
// Validate home_address if provided
if emp.HomeAddress != nil && *emp.HomeAddress != "" {
    if err := validateAddress(*emp.HomeAddress); err != nil {
        validationErrors = append(validationErrors, err.Error())
    }
}
```

### Error Message Examples
```
Row 7: home address exceeds 500 character limit (current: 623 characters) - please abbreviate or split into multiple lines
```

### Valid Address Examples
| Address | Valid? | Character Count |
|---------|--------|----------------|
| `123 Main St` | ✅ | 12 |
| `123 Main St\nApt 4B\nCity, State 12345` | ✅ | 39 (multi-line) |
| `Café de Flore, 172 Boulevard Saint-Germain` | ✅ | 45 (UTF-8 accents) |
| `東京都渋谷区道玄坂1-2-3` | ✅ | 13 (Japanese) |
| `[500-character address]` | ✅ | 500 (exactly at limit) |
| `[501-character address]` | ❌ | 501 (exceeds limit) |

### Address Storage
```go
// Store address as-is (preserve line breaks, no normalization)
func addressToText(address *string) pgtype.Text {
    if address == nil || strings.TrimSpace(*address) == "" {
        return pgtype.Text{Valid: false} // NULL in database
    }
    return pgtype.Text{String: *address, Valid: true} // Preserve original formatting
}
```

---

## 4. Integration into PreviewEmployeeImport

### Complete Validation Flow
```go
func (s *EmployeeImportService) PreviewEmployeeImport(
    ctx context.Context,
    req *connect.Request[v1.PreviewEmployeeImportRequest],
) (*connect.Response[v1.PreviewEmployeeImportResponse], error) {
    
    var items []*v1.EmployeePreviewItem
    stats := &v1.ImportStats{TotalCount: int32(len(req.Msg.Employees))}
    
    for _, emp := range req.Msg.Employees {
        var validationErrors []string
        
        // 1. Validate required fields (existing logic)
        if emp.Email == "" {
            validationErrors = append(validationErrors, "Email is required")
        }
        if emp.GivenName == "" {
            validationErrors = append(validationErrors, "Given name is required")
        }
        if emp.FamilyName == "" {
            validationErrors = append(validationErrors, "Family name is required")
        }
        
        // 2. Validate optional fields (NEW)
        // hire_date
        if emp.HireDate != nil && *emp.HireDate != "" {
            if _, err := parseDateField(*emp.HireDate, "Hire date"); err != nil {
                validationErrors = append(validationErrors, err.Error())
            }
        }
        
        // date_of_birth
        if emp.DateOfBirth != nil && *emp.DateOfBirth != "" {
            if _, err := parseDateField(*emp.DateOfBirth, "Date of birth"); err != nil {
                validationErrors = append(validationErrors, err.Error())
            }
        }
        
        // phone_number
        if emp.PhoneNumber != nil && *emp.PhoneNumber != "" {
            if err := validatePhoneNumber(*emp.PhoneNumber); err != nil {
                validationErrors = append(validationErrors, err.Error())
            }
        }
        
        // home_address
        if emp.HomeAddress != nil && *emp.HomeAddress != "" {
            if err := validateAddress(*emp.HomeAddress); err != nil {
                validationErrors = append(validationErrors, err.Error())
            }
        }
        
        // 3. Check for duplicates (existing logic with TenantPool)
        isDuplicate, duplicateReason := s.checkDuplicate(ctx, emp, req.Msg.OrganizationId)
        
        // 4. Build preview item
        willBeImported := len(validationErrors) == 0 && !isDuplicate
        items = append(items, &v1.EmployeePreviewItem{
            Employee:          emp,
            IsDuplicate:       isDuplicate,
            DuplicateReason:   duplicateReason,
            ValidationErrors:  validationErrors,
            WillBeImported:    willBeImported,
        })
        
        // 5. Update stats
        if willBeImported {
            stats.ValidCount++
        } else if isDuplicate {
            stats.DuplicateCount++
        } else {
            stats.InvalidCount++
        }
    }
    
    return connect.NewResponse(&v1.PreviewEmployeeImportResponse{
        Items: items,
        Stats: stats,
    }), nil
}
```

---

## 5. Frontend Validation (Client-Side Hints)

### Date Fields (TypeScript)
```typescript
// Optional client-side date validation for immediate feedback
function validateDateFormat(dateStr: string): string | null {
  if (!dateStr.trim()) return null; // Empty = valid (optional)
  
  const formats = [
    /^\d{4}\/\d{2}\/\d{2}$/, // YYYY/MM/DD
    /^\d{2}\/\d{2}\/\d{4}$/, // DD/MM/YYYY or MM/DD/YYYY
    /^\d{4}-\d{2}-\d{2}$/,   // YYYY-MM-DD
    /^\d{2}-\d{2}-\d{4}$/,   // DD-MM-YYYY
  ];
  
  const matches = formats.some(fmt => fmt.test(dateStr));
  if (!matches) {
    return "Expected format: YYYY/MM/DD, DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD, or DD-MM-YYYY";
  }
  
  return null; // Valid format (may still fail server-side parsing)
}
```

### Phone Number (TypeScript)
```typescript
// Optional client-side phone validation
function validatePhoneFormat(phone: string): string | null {
  if (!phone.trim()) return null; // Empty = valid (optional)
  
  const phoneRegex = /^[0-9+\-]{7,20}$/;
  if (!phoneRegex.test(phone)) {
    return "Only numbers, +, and - allowed (7-20 characters)";
  }
  
  return null; // Valid
}
```

### Home Address (TypeScript)
```typescript
// Optional client-side address validation
function validateAddressLength(address: string): string | null {
  if (!address.trim()) return null; // Empty = valid (optional)
  
  const length = address.length; // Approximation (UTF-8 char count done server-side)
  if (length > 500) {
    return `Address too long: ${length}/500 characters`;
  }
  
  return null; // Valid
}
```

---

## 6. Test Scenarios (Post-Verification)

### Unit Tests
```go
// backend/internal/iam/employee_import_test.go

func TestParseDateField(t *testing.T) {
    tests := []struct {
        name    string
        input   string
        wantErr bool
    }{
        {"Empty string", "", false},
        {"YYYY/MM/DD", "2022/03/15", false},
        {"DD/MM/YYYY", "15/03/2022", false},
        {"MM/DD/YYYY", "03/15/2022", false},
        {"YYYY-MM-DD", "2022-03-15", false},
        {"DD-MM-YYYY", "15-03-2022", false},
        {"Invalid format", "invalid", true},
        {"Invalid month", "2022/13/01", true},
        {"Excel numeric", "44575", true},
    }
    // ... test implementation
}

func TestValidatePhoneNumber(t *testing.T) {
    tests := []struct {
        name    string
        input   string
        wantErr bool
    }{
        {"Empty string", "", false},
        {"Valid US", "+1-555-123-4567", false},
        {"Valid UK", "+44-20-7946-0958", false},
        {"No separators", "5551234567", false},
        {"With spaces", "+1 (555) 123-4567", true},
        {"Too short", "555", true},
        {"Too long", "+1-555-123-4567-8901-2345", true},
    }
    // ... test implementation
}

func TestValidateAddress(t *testing.T) {
    tests := []struct {
        name    string
        input   string
        wantErr bool
    }{
        {"Empty string", "", false},
        {"Short address", "123 Main St", false},
        {"Multi-line", "123 Main St\nApt 4B\nCity", false},
        {"UTF-8 chars", "Café de Flore", false},
        {"Exactly 500 chars", strings.Repeat("a", 500), false},
        {"501 chars", strings.Repeat("a", 501), true},
    }
    // ... test implementation
}
```

### Integration Tests
```go
// backend/internal/iam/employee_import_integration_test.go

func TestPreviewEmployeeImport_WithOptionalFields(t *testing.T) {
    // Test scenarios:
    // 1. All optional fields valid
    // 2. Mix of valid and invalid optional fields
    // 3. No optional fields (backward compatibility)
    // 4. Invalid date formats
    // 5. Invalid phone formats
    // 6. Address exceeding 500 chars
}
```

---

## Summary

| Field | Validation Function | Key Rules | Error Handling |
|-------|-------------------|-----------|----------------|
| hire_date | `parseDateField()` | 5 formats supported | Show error, allow skip |
| date_of_birth | `parseDateField()` | Same as hire_date | Show error, allow skip |
| phone_number | `validatePhoneNumber()` | Regex: `^[0-9+\-]{7,20}$` | Show error, allow skip |
| home_address | `validateAddress()` | Max 500 UTF-8 characters | Show error, must fix |

**Validation Philosophy**:
- **Required fields**: Block import on invalid data
- **Optional fields**: Show errors but allow continuation with field empty
- **Server-side validation**: Authoritative (client-side hints optional)
- **Clear error messages**: Include row numbers, expected formats, examples

## References

- **Implementation File**: `backend/internal/iam/employee_import.go`
- **Protobuf Contract**: `backend/rpc/v1/iam.proto`
- **Database Schema**: `backend/database/scripts/schema.sql`
- **Go time package**: `time.Parse()` with layout strings
- **Go regexp package**: `regexp.MustCompile()` for pattern matching
- **Go UTF-8 package**: `unicode/utf8.RuneCountInString()` for character counting

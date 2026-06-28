# Feature Specification: Enhanced Employee Import with Additional Fields

**Feature Branch**: `004-import-employee-with`  
**Created**: October 26, 2025  
**Status**: Draft  
**Input**: User description: "import employee with hire_date, date_of_birth, phone_number, home_address to existing import feature"

## Execution Flow (main)
```
1. Parse user description from Input
   → Feature description provided: Extend existing employee import to include optional fields
2. Extract key concepts from description
   → Actors: organization owner/operator using existing import feature
   → Actions: include additional employee details during bulk import
   → Data: hire_date, date_of_birth, phone_number, home_address (all optional)
   → Constraints: backward compatibility with existing import, validation rules
3. For each unclear aspect:
   → All fields are optional - import still works without them
   → Validation rules for new fields marked below
4. Fill User Scenarios & Testing section
   → Primary flow: admin imports employees with extended profile data
5. Generate Functional Requirements
   → Each requirement testable via UI, file format, and data validation
6. Identify Key Entities
   → Extends organization.employee table (already has these columns)
7. Run Review Checklist
   → WARN: Spec has some validation rule uncertainties marked for clarification
8. Return: SUCCESS (spec ready for planning once clarifications addressed)
```

---

## ⚡ Quick Guidelines
- ✅ Focus on WHAT users need and WHY
- ❌ Avoid HOW to implement (no tech stack, APIs, code structure)
- 👥 Written for business stakeholders, not developers

---

## User Scenarios & Testing

### Primary User Story
As an organization owner, I want to import additional employee information (hire date, date of birth, phone number, and home address) during the bulk employee import process so that I can capture complete employee profiles from the start instead of manually updating records later. These fields are optional - I can still perform imports with just the basic required fields (email, given name, family name) or include any combination of the additional fields. The system validates data format for fields I provide (e.g., valid date formats, phone number format) but allows me to leave fields empty. This enhancement works with both the manual UI form and CSV/Excel file upload methods.

### Acceptance Scenarios

1. **Given** I am an organization owner on the employee import page using the manual form entry, **When** I enter employee details including optional fields like hire date (e.g., "2024-03-15"), date of birth (e.g., "1990-06-20"), phone number (e.g., "+1-555-123-4567"), and home address (e.g., "123 Main St, City, State 12345"), **Then** the system accepts these additional fields and displays them in the preview/verification step along with the required fields.

2. **Given** I am uploading a .xlsx file with employee data, **When** the file includes columns for hire_date, date_of_birth, phone_number, and home_address in addition to the required columns, **Then** the system successfully parses all fields and displays them in the preview step.

3. **Given** I am importing employees, **When** I provide only the required fields (email, given name, family name) and leave the optional fields (hire date, date of birth, phone number, home address) empty, **Then** the import succeeds and creates employee records with null/empty values for the optional fields, maintaining backward compatibility with the existing import feature.

4. **Given** I am uploading a CSV/Excel file with optional fields, **When** some rows have values for optional fields and other rows leave them blank, **Then** the system successfully processes the file with mixed data, creating records with the provided values and null/empty for missing optional fields.

5. **Given** I am in the data entry step, **When** I provide invalid format data for optional fields (e.g., hire_date as "invalid-date", phone_number as "not-a-number"), **Then** the system displays comprehensive validation errors identifying the specific invalid fields with row numbers and does not allow progression to the preview step until corrected.

6. **Given** I am importing employees with hire dates, **When** the hire date is invalid or unparseable, **Then** the system displays validation error with the row number and allows me to fix the data or continue with that field empty.

7. **Given** I am importing employees with dates of birth, **When** the date of birth is invalid or unparseable, **Then** the system displays validation error with the row number and allows me to fix the data or continue with that field empty.

8. **Given** I am importing employees with phone numbers, **When** the phone number contains alphabetic characters or special characters other than "+" and "-", **Then** the system displays validation error identifying the invalid phone number format.

9. **Given** I am importing employees with home addresses, **When** the home address exceeds 500 characters, **Then** the system displays validation error indicating the address is too long.

10. **Given** I have successfully imported employees with all optional fields populated, **When** I view the employee records in the system, **Then** all provided information (hire date, date of birth, phone number, home address) is correctly stored and displayed in the employee profile.

### Edge Cases

- **Phone numbers in different international formats**: System validates that phone numbers contain only numeric characters, "+", and "-" (no alphabetic characters allowed)

- **Home address length limits**: Maximum 500 characters; system shows validation error if exceeded

- **Date format variations in CSV/Excel files**: System attempts to parse dates using 5 common formats (YYYY/MM/DD, DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD, DD-MM-YYYY); preview step displays dates in unambiguous format "02 Jan 2022" to avoid confusion

- **Excel numeric date format**: When dates cannot be parsed from Excel's internal numeric format, system reports parsing error and allows user to either fix the data or continue import with that optional field left empty

- **Special characters and non-ASCII characters**: System supports UTF-8 encoding for all text fields (accented characters, non-Latin scripts in addresses are allowed)

- **Retrying previously failed imports**: Optional fields follow existing retry logic; no special persistence behavior for optional fields

## Requirements

### Functional Requirements

- **FR-001**: System MUST extend the existing employee import interface to accept four additional optional fields per employee:
  - hire_date (date)
  - date_of_birth (date) 
  - phone_number (text)
  - home_address (text)

- **FR-002**: System MUST maintain backward compatibility - imports with only required fields (email, given name, family name) must continue to work without providing optional fields

- **FR-003**: System MUST allow partial completion of optional fields - users can provide any combination of the four optional fields or none at all

- **FR-004**: System MUST support the additional optional fields in both import methods:
  - Manual form entry (with form fields for each optional attribute)
  - File upload (.xlsx Excel format with additional optional columns)

- **FR-005**: System MUST validate hire_date format when provided:
  - Must be parseable as a valid date using one of 5 supported formats: YYYY/MM/DD, DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD, DD-MM-YYYY
  - If parsing fails, display error and allow user to fix or continue with field empty
  - Display parsed dates in preview step using unambiguous format "02 Jan 2022"

- **FR-006**: System MUST validate date_of_birth format when provided:
  - Must be parseable as a valid date using one of 5 supported formats: YYYY/MM/DD, DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD, DD-MM-YYYY
  - If parsing fails, display error and allow user to fix or continue with field empty
  - Display parsed dates in preview step using unambiguous format "02 Jan 2022"

- **FR-007**: System MUST validate phone_number format when provided:
  - Must contain only numeric characters, "+", and "-" (no alphabetic characters)
  - Accept common international phone number formats with these allowed characters

- **FR-008**: System MUST accept home_address as free-form text when provided:
  - Maximum length: 500 characters
  - Support multi-line addresses
  - Support international address formats
  - Support UTF-8 characters (accented letters, non-Latin scripts)
  - Display validation error if length exceeds 500 characters

- **FR-009**: System MUST validate all provided optional fields during file parsing and display comprehensive validation errors in the same manner as existing field validation (all rows checked, all errors reported with row numbers)

- **FR-010**: System MUST display all optional field values in the preview/verification step alongside required fields, clearly showing which fields are populated and which are empty

- **FR-011**: System MUST store all provided optional field values in the organization.employee table when the import is confirmed and executed

- **FR-012**: System MUST handle unparseable date formats gracefully:
  - When Excel numeric date format or other unrecognized format is encountered, report clear parsing error with row number
  - Allow user to either fix the data or continue import with that optional field left empty
  - Do not block entire import due to single unparseable optional field

- **FR-013**: System MUST provide clear validation error messages for optional fields that specify:
  - Which field has an error
  - What the validation issue is (e.g., "Invalid date format - supported formats: YYYY/MM/DD, DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD, DD-MM-YYYY", "Phone number contains invalid characters - only numbers, +, and - allowed", "Home address exceeds 500 character limit")
  - The row number where the error occurred (for file uploads)
  - Expected format or acceptable values
  - Option to continue import with field empty for unparseable optional fields

- **FR-014**: CSV/Excel file template documentation MUST be updated to reflect the additional optional columns and their expected formats (when template feature exists)

### Key Entities

- **organization.employee** (existing table, already contains all required columns):
  - hire_date: Optional date when employee joined the organization
  - date_of_birth: Optional date of birth for the employee
  - phone_number: Optional contact phone number (text format supporting international formats with "+", "-", and numeric characters; no alphabetic characters)
  - home_address: Optional residential address (text format, maximum 500 characters, supports UTF-8 for multi-line and international addresses)

- **EmployeeData message** (in RPC contract - to be extended):
  - Adds four optional fields to existing email, given_name, family_name, row_number structure

---

## Review & Acceptance Checklist
*GATE: Automated checks run during main() execution*

### Content Quality
- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

### Requirement Completeness
- [x] No [NEEDS CLARIFICATION] markers remain - **All clarifications resolved**
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Scope is clearly bounded (extends existing import feature only)
- [x] Dependencies and assumptions identified (depends on spec 003)

### Clarifications Resolved
1. ✅ Date format handling: Support 5 common formats with preview in "02 Jan 2022" format
2. ✅ Unparseable dates: Show error, allow user to fix or continue with field empty
3. ✅ Date of birth/hire date validation: No age/range constraints; focus on parseability
4. ✅ Phone number validation: Allow only numeric, "+", and "-" characters
5. ✅ Home address character limit: 500 characters maximum
6. ✅ Special characters: UTF-8 support (PostgreSQL default)
7. ✅ Import retry behavior: Use existing logic; no special handling for optional fields

---

## Clarifications

### Session 2025-10-26

- Q: What happens when phone numbers are provided in different international formats? → A: Validation allows numeric characters, "+", and "-" only (no alphabetic characters)
- Q: What happens when a home address exceeds typical length limits? → A: Limit to 500 characters maximum
- Q: What happens when date formats vary between different CSV/Excel files? → A: Support 5 common formats (YYYY/MM/DD, DD/MM/YYYY, MM/DD/YYYY, and 2 others); preview shows clear format "02 Jan 2022" to avoid confusion
- Q: What happens when someone uploads dates in Excel's numeric date format? → A: Report parsing error; allow user to fix or continue import with optional field empty
- Q: What happens when optional fields contain special characters or non-ASCII characters? → A: UTF-8 supported by PostgreSQL (accented characters, non-Latin scripts allowed)
- Q: What happens when retrying a previously failed import - are the optional fields remembered? → A: Use existing retry logic; no special handling for optional fields

## Execution Status
*Updated by main() during processing*

- [x] User description parsed
- [x] Key concepts extracted
- [x] Ambiguities marked (7 clarifications identified)
- [x] User scenarios defined
- [x] Requirements generated
- [x] Entities identified
- [x] Clarifications resolved (6 clarifications addressed)
- [x] Review checklist passed

---

## Dependencies

- **Depends on**: Spec 003 (Feature Import Employees) - This feature extends the existing employee import functionality
- **Database Schema**: The organization.employee table already contains all four optional fields (hire_date, date_of_birth, phone_number, home_address) as per schema.sql lines 61-64
- **RPC Contract**: Extends existing EmployeeData message in iam_employee_import.proto
- **UI Components**: Extends existing import form and preview components in frontend/apps/web/src/app/workspace/organization/

## Notes

This is an enhancement to the existing employee import feature (spec 003). The database schema already supports these fields - this specification focuses on:
1. Exposing these fields in the import UI (form and file upload)
2. Adding validation for optional fields
3. Extending the RPC contract to pass additional data
4. Ensuring backward compatibility with imports that don't include optional fields

The implementation should reuse existing patterns from the base import feature and maintain consistency with the two-step import process (entry → preview → confirm).

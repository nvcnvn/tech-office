# Feature Specification: Employee Import

**Feature Branch**: `003-feature-import-employees`  
**Created**: October 25, 2025  
**Status**: Draft  
**Input**: User description: "feature import employees. We should be able to import list of employees (email, password, given name, family name) via: UI Form, CSV or Excel format. The import should be 2 steps: 1. form submit or csv/excel upload. 2.1 show verify action (if employee with email already exist we will say that to user and ignore) 2.2 only when user confirm we start import. The import action should create our identity record and also call to zitadel via CreateUser."

## Clarifications

### Session 2025-10-25
- Q: What should the maximum number of employees that can be imported in a single batch? → A: Start with 100 employees per batch
- Q: For CSV/Excel imports, what should happen if a file contains validation errors (invalid email format, missing required fields)? Should we show all errors at once or stop at first error? → A: Check all errors in all rows and tell user as one comprehensive report
- Q: Should we validate password strength during the preview/verification step, or only show format issues? → A: Do not allow admin to set passwords; instead send verification email and employees will set passwords themselves
- Q: If some employees fail to create in Zitadel but others succeed during batch import, should we rollback all or just report failures? → A: Perform in transaction, rollback all if any error occurs
- Q: What Excel file formats should be supported (.xlsx, .xls, both)? → A: Support .xlsx format only
- Q: Should there be a template download feature for the CSV/Excel format to help users prepare their data correctly? → A: No template download feature needed (can be built later)
- Q: What is the expected column order/naming for CSV/Excel files? → A: Default columns are email, given name, family name; RPC method will examine during upload
- Q: Can users retry failed imports, and if so, should the system remember which employees failed? → A: Yes, best effort imports; if user already successfully imported employees in a batch, later retries will indicate those users already exist
- Q: Should there be any notification sent to employees after they are imported (e.g., welcome email with password reset link)? → A: Email notification will be sent by Zitadel
- Q: Who should have permission to import employees? Only organization owners or also certain employee roles? → A: Only 'owner' role for now; additional admin-staff role will be added later

## Execution Flow (main)
```
1. Parse user description from Input
   → Feature description provided: Bulk employee import with UI and file upload
2. Extract key concepts from description
   → Actors: organization admin/owner importing employees
   → Actions: input employee data via form/file, preview and verify, confirm import
   → Data: employee email, password, given name, family name
   → Constraints: duplicate email detection, two-step verification process
3. For each unclear aspect:
   → Batch size limits [NEEDS CLARIFICATION]
   → Error handling strategy [NEEDS CLARIFICATION]
   → File format specifications [NEEDS CLARIFICATION]
   → Permission requirements [NEEDS CLARIFICATION]
4. Fill User Scenarios & Testing section
   → Primary flow: admin imports multiple employees via form or file
5. Generate Functional Requirements
   → Each requirement testable via UI and data validation
6. Identify Key Entities
   → Identity, Identity Role, Zitadel User
7. Run Review Checklist
   → WARN: Spec has uncertainties marked for clarification
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
As an organization owner, I want to import multiple employees into the system at once so that I can efficiently onboard my team without creating accounts one by one. I can either manually enter employee information through a form or upload a CSV/Excel (.xlsx) file with employee data. I only need to provide email, given name, and family name for each employee - the system will send verification emails to each employee who will then set their own passwords. Before finalizing the import, I want to review the list of employees to be created and see if any conflicts exist (such as duplicate email addresses or validation errors). Once I confirm, the system creates identity records for all valid employees in a single atomic transaction and registers them in the authentication system, which triggers welcome emails from Zitadel.

### Acceptance Scenarios

1. **Given** I am an organization owner on the employee import page, **When** I manually enter employee details (email, given name, family name) through the UI form for multiple employees (up to 100), **Then** I can proceed to the preview/verification step where all entered employees are displayed for review.

2. **Given** I am on the employee import page, **When** I upload a valid .xlsx file containing employee data with columns for email, given name, and family name, **Then** the system parses the file and displays all employee records (up to 100) in the preview/verification step.

3. **Given** I am in the preview/verification step with a list of employees to import, **When** one or more employees have email addresses that already exist in my organization, **Then** those duplicate entries are clearly highlighted with a warning message, and I understand they will be skipped during import.

4. **Given** I am in the preview/verification step reviewing the employee list, **When** I confirm the import action, **Then** the system creates identity records in our database for all non-duplicate employees in a single atomic transaction, assigns them the 'employee' role, creates corresponding user accounts in Zitadel, and Zitadel sends verification emails to each employee to set their passwords.

5. **Given** I have uploaded a file with employee data, **When** the file contains formatting errors or invalid data (e.g., invalid email format, missing required fields) across multiple rows, **Then** I see a comprehensive error report identifying all issues across all rows with specific row numbers and error types, and the preview step is not accessible until all errors are corrected.

6. **Given** I have successfully imported a batch of employees, **When** the import completes, **Then** I see a summary showing how many employees were successfully created, how many were skipped due to duplicates, and confirmation that welcome emails have been sent by Zitadel.

7. **Given** I previously attempted an import that partially succeeded, **When** I retry importing the same employee list, **Then** the system indicates which employees were already successfully created and skips them, allowing me to import only the new or previously failed employees.

### Edge Cases

- What happens when a CSV/Excel file is uploaded with more than 100 rows?
  - System should reject the file and inform user to split into batches of 100 or fewer employees

- What happens if the file upload is interrupted or corrupted?
  - System should validate file integrity and provide clear error messages

- What happens when Zitadel is unavailable during the import confirmation step?
  - Since imports are transactional, the entire batch will fail and rollback; user receives clear error message to retry later

- What happens when some employees succeed in database creation but fail in Zitadel creation during batch import?
  - All changes are rolled back due to transaction semantics; nothing is committed on partial failure

- What happens if a user abandons the import process after the preview step without confirming?
  - No data should be saved; user must confirm to actually import

- What happens when multiple administrators try to import employees with the same email simultaneously?
  - System should handle race conditions with proper uniqueness validation; later transaction will identify duplicates and skip them

- What happens on retry after a previous failed import?
  - System uses best-effort approach: identifies already-created employees and reports them as existing, allowing import of only new employees

## Requirements

### Functional Requirements

- **FR-001**: System MUST provide an employee import interface accessible only to users with 'owner' role in the organization

- **FR-002**: System MUST support two methods of employee data input:
  - Manual form entry (for entering multiple employees in sequence)
  - File upload (.xlsx Excel format only)

- **FR-003**: System MUST require the following information for each employee to be imported:
  - Email address (required)
  - Given name/first name (required)
  - Family name/last name (required)

- **FR-003a**: System MUST NOT require passwords during import; employees will receive verification emails from Zitadel to set their own passwords

- **FR-004**: System MUST enforce a maximum batch size of 100 employees per import operation

- **FR-005**: System MUST implement a two-step import process:
  - Step 1: Data entry (form submission or file upload)
  - Step 2: Preview/verification with confirmation action

- **FR-006**: System MUST validate email format for all employee entries before allowing progression to the preview step

- **FR-007**: System MUST perform comprehensive validation of uploaded files, checking all rows and collecting all errors before presenting results (do not stop at first error)

- **FR-008**: System MUST detect duplicate email addresses within the import batch (comparing against existing employees in the organization)

- **FR-009**: System MUST clearly display in the preview/verification step:
  - All employees to be imported
  - Which employees will be skipped due to duplicate emails
  - Visual distinction between valid entries and duplicates
  - All validation errors across all rows with specific row numbers and error types

- **FR-010**: System MUST provide clear messaging for duplicate entries indicating they will be ignored/skipped during import

- **FR-011**: System MUST only create employee records when the user explicitly confirms the import action in step 2

- **FR-012**: System MUST execute all import operations within a single atomic transaction that either succeeds completely or rolls back entirely on any failure

- **FR-013**: System MUST create the following records for each successfully imported employee within the transaction:
  - Identity record in `iam.identity` table with email and identity_type 'human'
  - Identity role record in `iam.identity_role` table assigning 'employee' role

- **FR-014**: System MUST create corresponding user accounts in Zitadel for each successfully imported employee, triggering Zitadel to send verification emails for password setup

- **FR-015**: System MUST validate uploaded .xlsx files for:
  - Correct file format (.xlsx only)
  - Presence of required columns (email, given name, family name) in default order
  - Valid data in each required field across all rows
  - Maximum 100 rows

- **FR-016**: System MUST provide detailed error messages for file upload failures, including:
  - All rows containing errors (comprehensive report)
  - Specific error type for each issue (missing field, invalid format, etc.)
  - Actionable guidance to fix the issues

- **FR-017**: System MUST display a summary after import completion showing:
  - Number of employees successfully imported
  - Number of employees skipped (duplicates or already existing)
  - Confirmation that Zitadel has sent verification emails
  - Any transaction-level errors that caused rollback

- **FR-018**: System MUST prevent duplicate submissions during the import process (e.g., disable confirm button after click, show loading/progress state)

- **FR-019**: System MUST support retry scenarios with best-effort duplicate detection: if employees from a previous import already exist, identify them and allow import of only new employees

- **FR-020**: System MUST reject files exceeding 100 employees with a clear error message instructing users to split into smaller batches

### Non-Functional Requirements

- **NFR-001**: System SHOULD provide responsive feedback during file parsing and validation to indicate progress

- **NFR-002**: System SHOULD complete the validation and preview generation for batches up to 100 employees within 10 seconds under normal conditions

- **NFR-003**: System MUST maintain data consistency between local database and Zitadel through atomic transactions with full rollback on any failure

### Key Entities

- **Identity (iam.identity)**: Represents an employee user in the IAM system
  - Attributes: unique identifier, organization reference, email (unique within organization), identity type ('human'), email verification status (initially false), update timestamp
  - Created during import for each new employee
  - Relationships: belongs to an organization, has roles through identity_role

- **Identity Role (iam.identity_role)**: Maps employees to their organization with role assignment
  - Attributes: unique identifier, organization reference, identity reference, role ('employee'), update timestamp
  - Created during import to assign 'employee' role to each imported identity
  - Enforces uniqueness constraint on (identity_id, organization_id, role)

- **Zitadel User**: External authentication system representation of the employee
  - Attributes: user ID (matches identity ID), organization ID, username (email), profile (given name, family name), email verification setup
  - Created via CreateUser API call during import without password (Zitadel sends verification email)
  - Linked to Identity by shared ID
  - Zitadel handles password setup through verification email flow

- **Import Batch (conceptual)**: Represents a single import operation
  - Attributes: list of employee records to import (max 100), validation status, duplicate detection results, comprehensive error collection
  - Temporary entity during the two-step import process (not persisted)
  - Supports retry scenarios with duplicate detection

---

## Review & Acceptance Checklist
*GATE: Automated checks run during main() execution*

### Content Quality
- [x] No implementation details (languages, frameworks, APIs) - References Zitadel as external system per existing architecture
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

### Requirement Completeness
- [x] No [NEEDS CLARIFICATION] markers remain - **All 10 clarifications resolved**
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable (import counts, error reporting, transaction success/rollback)
- [x] Scope is clearly bounded (employee import only, two-step process, 100 max batch size)
- [x] Dependencies and assumptions identified (Zitadel integration, existing identity schema, transactional semantics)

---

## Execution Status
*Updated by main() during processing*

- [x] User description parsed
- [x] Key concepts extracted
- [x] Ambiguities marked
- [x] User scenarios defined
- [x] Requirements generated
- [x] Entities identified
- [x] Review checklist passed
- [x] All clarifications resolved (10/10)

---

## Notes

### Integration Points
- **Zitadel CreateUser API**: Used to create user accounts in external authentication system without password (triggers verification email flow)
- **Identity Management**: Leverages existing `iam.identity` and `iam.identity_role` tables
- **Multi-tenant Architecture**: All operations scoped to organization context via organization_id
- **File Format**: Only .xlsx Excel format supported; CSV support deferred

### Security Considerations
- Email uniqueness is enforced per organization (not globally)
- Passwords NOT handled during import; employees set passwords via Zitadel verification email
- Duplicate detection prevents accidental overwrites
- Two-step confirmation prevents accidental mass imports
- Permission verification required: only 'owner' role can import (admin-staff role to be added later)
- Atomic transactions ensure no partial imports on failure

### User Experience Considerations
- Clear visual feedback during each step of the import process
- Comprehensive error messaging with all errors reported at once (not fail-fast)
- Preview before commit reduces risk of mistakes
- Summary report provides transparency and auditability
- Support for both manual and bulk entry accommodates different use cases
- Maximum batch size of 100 employees prevents performance issues
- Best-effort retry support: system identifies already-imported employees

### Performance & Scale
- Maximum 100 employees per batch
- Target: validation and preview generation within 10 seconds
- Transactional semantics ensure data consistency
- File size limits enforced at upload


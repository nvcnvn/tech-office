# Feature Specification: Organization SignUp on Web

**Feature Branch**: `001-organization-signup-on`  
**Created**: October 25, 2025  
**Status**: Draft  
**Input**: User description: "Organization SignUp on Web - The signup will create some tracking record in our database and will create org and user in external zitadel system (later will be use as OIDC provider for login). Since the backend is almost available, this will mostly focus in UI and integration part."

## Clarifications

### Session 2025-10-25
- Q: Password complexity requirements → A: Minimum 16 characters length, must mix numbers and characters
- Q: Should we prevent duplicate emails across all organizations or only within the same organization? → A: Only within the same organization
- Q: What happens if the external authentication system (Zitadel) is unavailable during signup? → A: Ask user to try later
- Q: What happens when a user abandons the signup form halfway through? → A: Require new complete submission
- Q: What happens if organization creation succeeds but user creation in Zitadel fails? → A: Backend already handles atomic transaction
- Q: Subdomain format validation specifics → A: Maximum 32 characters
- Q: What should happen after successful registration? → A: Redirect user to signin page after a countdown of 3 seconds

## Execution Flow (main)
```
1. Parse user description from Input
   → Feature description provided: Organization signup with UI focus
2. Extract key concepts from description
   → Actors: prospective organization admin/owner
   → Actions: register new organization, create admin account
   → Data: organization details, admin user credentials
   → Constraints: subdomain uniqueness, email validation, password requirements
3. For each unclear aspect:
   → Password complexity requirements [NEEDS CLARIFICATION]
   → Email verification workflow [NEEDS CLARIFICATION]
   → Subdomain validation rules [NEEDS CLARIFICATION]
   → Error handling for external system failures [NEEDS CLARIFICATION]
4. Fill User Scenarios & Testing section
   → Primary flow: new user creates organization with admin account
5. Generate Functional Requirements
   → Each requirement testable via UI and API
6. Identify Key Entities
   → Organization, Identity, Identity Role, Organization Owner
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
As a prospective customer, I want to sign up for Tech Office by creating my organization account so that I can start managing my business operations on the platform. During signup, I provide my organization's name, choose a unique subdomain for my organization's web presence, and create my admin account with my email, name, and password. Upon successful registration, I become the organization owner with full administrative access.

### Acceptance Scenarios

1. **Given** I am a new user on the signup page, **When** I enter valid organization details (company name, subdomain) and admin credentials (email, password, first name, last name), **Then** my organization is created, I am registered as the admin/owner, I receive confirmation of successful registration with a 3-second countdown, and I am automatically redirected to the signin page.

2. **Given** I am on the signup page and enter an already-taken subdomain, **When** I attempt to submit the form, **Then** I see an error message indicating the subdomain is unavailable and I must choose a different one.

3. **Given** I am filling out the signup form, **When** I enter an invalid email format, **Then** I see immediate validation feedback prompting me to correct the email address.

4. **Given** I am filling out the signup form, **When** I enter a password that doesn't meet requirements, **Then** I see clear feedback indicating the password must be at least 16 characters and contain both numbers and alphabetic characters.

5. **Given** I successfully complete signup, **When** the system creates my account, **Then** both my organization record and my admin user identity are created with the appropriate ownership and role assignments.

### Edge Cases

- What happens when a user attempts to register with an email that already exists within the same organization?
  - System should prevent duplicate emails within an organization and show an error message (duplicate emails across different organizations are allowed)

- What happens if the external authentication system (Zitadel) is unavailable during signup?
  - System should display a user-friendly error message and ask the user to try again later

- What happens if subdomain validation fails after form submission (e.g., subdomain becomes unavailable between validation check and actual creation)?
  - System should handle race conditions gracefully and inform the user

- What happens when a user abandons the signup form halfway through?
  - System requires new complete submission; partial data is not saved

- What happens if organization creation succeeds but user creation in Zitadel fails?
  - Backend handles this as an atomic transaction with automatic rollback to maintain data consistency

## Requirements

### Functional Requirements

- **FR-001**: System MUST provide a public signup form accessible without authentication to allow new users to register their organization

- **FR-002**: System MUST require the following information during signup:
  - Organization company name
  - Organization subdomain (for tenant-specific URL access)
  - Admin email address
  - Admin password
  - Admin given name (first name)
  - Admin family name (last name)

- **FR-003**: System MUST validate subdomain uniqueness in real-time and prevent registration if subdomain is already taken

- **FR-004**: System MUST validate email format and enforce uniqueness within the same organization (duplicate emails are allowed across different organizations)

- **FR-005**: System MUST enforce password complexity requirements: minimum 16 characters length, must contain both numbers and alphabetic characters

- **FR-006**: System MUST validate subdomain format to ensure it is DNS-compliant (alphanumeric, hyphens, no spaces, maximum 32 characters)

- **FR-007**: System MUST create the following records upon successful signup:
  - Organization record with company name, subdomain, and unique ID
  - Identity record for the admin user with email and identity type 'human'
  - Organization owner relationship linking the identity to the organization
  - Identity role record assigning 'owner' role to the admin user for the organization

- **FR-008**: System MUST create corresponding user account in the external authentication system (Zitadel) with provided credentials

- **FR-009**: System MUST provide clear, actionable error messages for validation failures (e.g., "This subdomain is already taken", "Email format is invalid", "Password must be at least X characters")

- **FR-010**: System MUST prevent duplicate submissions during registration process (e.g., disable submit button after first click, show loading state)

- **FR-011**: System MUST display success confirmation after registration is complete, show a 3-second countdown, and automatically redirect user to the signin page

- **FR-012**: System MUST handle errors from external authentication system gracefully by displaying a user-friendly error message and asking the user to try again later

- **FR-013**: System MUST initially set email_verified to false for newly created identities (email verification is handled separately post-registration)

- **FR-014**: System MUST allow users to check subdomain availability before submitting the full form (real-time validation feedback)

### Key Entities

- **Organization**: Represents a customer/tenant in the system
  - Attributes: unique identifier, company name, unique subdomain, application ID (optional), update timestamp
  - Relationships: has many identities (through identity_role), has many owners (through organization_owner)

- **Identity**: Represents a user (human or service account) in the IAM system
  - Attributes: unique identifier, email (unique), email verification status, identity type (human/service), update timestamp
  - Relationships: can own multiple organizations (through organization_owner), can have roles in multiple organizations (through identity_role)

- **Organization Owner**: Maps ownership relationship between identities and organizations
  - Represents the many-to-many relationship
  - An identity can own multiple organizations
  - An organization can have multiple owners

- **Identity Role**: Maps organizational membership and role assignments
  - Attributes: unique identifier, organization reference, identity reference, role (owner/employee), update timestamp
  - Represents user's role within a specific organization context
  - Used for RBAC (Role-Based Access Control)

---

## Review & Acceptance Checklist

### Content Quality
- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

### Requirement Completeness
- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

---

## Execution Status

- [x] User description parsed
- [x] Key concepts extracted
- [x] Ambiguities marked
- [x] User scenarios defined
- [x] Requirements generated
- [x] Entities identified
- [x] Clarifications addressed
- [x] Review checklist passed

---

## Notes for Implementation Planning

This specification focuses on the user-facing signup experience and business requirements. The following aspects are intentionally left for the implementation planning phase:
- UI/UX design details (form layout, styling, responsive design)
- Frontend framework and component structure
- API integration patterns and error handling mechanisms
- Database transaction management and consistency guarantees
- External system integration details with Zitadel
- Security measures (CSRF protection, rate limiting, etc.)
- Performance requirements and optimization strategies

These technical decisions should be made during the planning phase based on existing system architecture and technical constraints.

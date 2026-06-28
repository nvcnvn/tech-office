# Feature Specification: Organization Departments Management

**Feature Branch**: `006-organization-departments-ver`  
**Created**: October 27, 2025  
**Status**: Draft  
**Input**: User description: "organization departments ver 01 - I want ability to managed departments in directory/folder like, mean we can have nested/tree folder structure. Each department can have 1 manager and many employee. But employee can belong to 1 single derpartment. Once created, ROLE_OWNER and ROLE_OPERATOR or assigned manager (manager is not a system role but just an attribute of this department feature) can add unassigned employee to the department. We don't need to have any inherrit permission system. Only owner or operator can move user around freely. department can have name and description"

## Execution Flow (main)
```
1. Parse user description from Input ✅
   → Feature: Hierarchical department management with tree structure
2. Extract key concepts from description ✅
   → Actors: ROLE_OWNER, ROLE_OPERATOR, Department Managers, Employees
   → Actions: Create/edit/delete departments, add/remove employees, move employees, assign manager
   → Data: Departments (name, description, parent-child relationship), Department memberships (employee assignment, manager designation)
   → Constraints: Tree structure, 1 manager per department, employees belong to 1 department only, managers can only add employees to their own department, only OWNER/OPERATOR can move employees between departments
3. For each unclear aspect:
   → ✅ CLARIFIED: Departments can be empty (no manager/employees) - system will cache counts and show warnings
   → ✅ CLARIFIED: Department deletion blocked until all members migrated out
   → ✅ CLARIFIED: No depth limit on nesting
   → ✅ CLARIFIED: Only ROLE_OWNER/OPERATOR can delete or rename departments
   → ✅ CLARIFIED: Tree view is default display mode
   → ✅ CLARIFIED: Managers must belong to the department they manage (manager is a member role)
   → ✅ CLARIFIED: Departments can temporarily have 0 managers with warning
4. Fill User Scenarios & Testing section ✅
5. Generate Functional Requirements ✅
6. Identify Key Entities ✅
7. Run Review Checklist
   → Spec has uncertainties regarding business rules and data lifecycle
8. Return: SUCCESS (spec ready for planning after clarifications)
```

---

## ⚡ Quick Guidelines
- ✅ Focus on WHAT users need and WHY
- ❌ Avoid HOW to implement (no tech stack, APIs, code structure)
- 👥 Written for business stakeholders, not developers

---

## Clarifications

### Session 2025-10-27
- Q: Can a department have no manager? Can it be empty with no employees? → A: Departments can be empty (no manager, no employees). System should cache member/manager counts and show warnings for empty departments.
- Q: What happens to employees when their department is deleted? → A: Block deletion until all members are migrated out.
- Q: Can a department be nested unlimited levels deep, or is there a maximum depth? → A: No depth limit for now.
- Q: Can department managers delete or rename their own department? → A: No, only ROLE_OWNER or ROLE_OPERATOR can delete or rename departments.
- Q: Should there be a visual representation (tree view) for the nested department structure? → A: Yes, tree view is the default display mode.
- Q: Can an employee be designated as manager while belonging to a different department? → A: No. Manager and member are both department members; employees can only belong to one department.
- Q: What happens when a manager is moved to another department or removed from the organization? → A: Department can temporarily have 0 managers. System should cache manager count and show warnings when this occurs.

---

## User Scenarios & Testing

### Primary User Story
As an organization administrator (ROLE_OWNER or ROLE_OPERATOR), I need to organize employees into a hierarchical department structure that mirrors our company's organizational chart. I want to create nested departments (like folders), assign a manager to oversee each department, and place employees into specific departments. Department managers should be able to add unassigned employees to their own departments, but only administrators can move employees between departments or restructure the hierarchy.

### Acceptance Scenarios

1. **Given** I am logged in as ROLE_OWNER or ROLE_OPERATOR, **When** I navigate to the Departments management page, **Then** I should see a tree view of all departments in the organization, showing the hierarchical structure with expand/collapse controls for parent departments.

2. **Given** I am viewing the department tree as ROLE_OWNER or ROLE_OPERATOR, **When** I click "Create Department" and provide a name, description, and optionally select a parent department, **Then** the system should create a new department and display it in the tree under the selected parent (or at root level if no parent selected).

3. **Given** I am viewing a department's details as ROLE_OWNER or ROLE_OPERATOR, **When** I click "Assign Manager" and select an employee from the same department, **Then** the system should designate that employee as the department manager while maintaining their membership in that department.

4. **Given** I am logged in as a department manager, **When** I view my department's details, **Then** I should see a list of current members and an "Add Employee" button that shows only employees who are not currently assigned to any department.

5. **Given** I am a department manager viewing my department, **When** I click "Add Employee" and select an unassigned employee, **Then** the system should add that employee to my department as a member.

6. **Given** I am logged in as ROLE_OWNER or ROLE_OPERATOR, **When** I select an employee who is currently in Department A and move them to Department B, **Then** the system should remove the employee from Department A and add them to Department B, maintaining the employee's membership in exactly one department.

7. **Given** I am viewing the department tree as ROLE_OWNER or ROLE_OPERATOR, **When** I drag Department B onto Department A, **Then** Department B should become a child of Department A, moving all its sub-departments and members along with it.

8. **Given** I am viewing a department's details as ROLE_OWNER or ROLE_OPERATOR, **When** I click "Edit" and change the department name or description, **Then** the system should update the department information and reflect the changes in the tree view.

9. **Given** I am viewing a department with members as ROLE_OWNER or ROLE_OPERATOR, **When** I click "Delete Department", **Then** the system should prevent deletion and display a message requiring all members to be moved out first. Empty departments (with or without child departments) can be deleted freely.

10. **Given** I am a department manager, **When** I try to move an employee from my department to another department, **Then** the system should prevent this action and show a message indicating only ROLE_OWNER and ROLE_OPERATOR can move employees between departments.

11. **Given** I am viewing a department with no assigned manager or no members, **When** the department details are displayed, **Then** the system should show a warning indicator highlighting that the department is empty or lacks a manager.

12. **Given** I am a department manager, **When** I attempt to rename or delete my own department, **Then** the system should prevent this action and indicate that only ROLE_OWNER and ROLE_OPERATOR can perform these operations.

### Edge Cases
- When the designated manager of a department leaves the organization or is moved to another department, the department's manager designation is cleared and the department enters a "no manager" state with a warning indicator displayed.
- Departments can exist with zero employees and no manager; these empty departments should display warning indicators in the UI.
- When attempting to delete a department with employees, the system blocks deletion and requires all members to be migrated out first.
- Department tree nesting has no depth limit; however, deep hierarchies may impact UI performance and should be monitored.
- The system prevents circular references where a department becomes its own ancestor during move operations.
- When attempting to add an employee who is already in another department, the system prevents the action and shows an error message.
- Department managers cannot edit their department's name, description, or delete their department; these operations are restricted to ROLE_OWNER and ROLE_OPERATOR.
- Departments can have duplicate names across different branches of the tree (name uniqueness is not enforced globally).
- When a manager is moved to another department, they lose manager privileges for their previous department unless reassigned.

## Requirements

### Functional Requirements

- **FR-001**: System MUST support a hierarchical tree structure for departments where each department can have zero or more child departments (nested structure similar to file system folders).

- **FR-002**: System MUST allow ROLE_OWNER and ROLE_OPERATOR to create new departments by providing a department name (required) and description (optional), with the option to specify a parent department for nesting.

- **FR-003**: System MUST allow ROLE_OWNER and ROLE_OPERATOR to edit any department's name and description.

- **FR-004**: System MUST allow each department to have exactly zero or one designated manager. Departments can exist without a manager (empty manager state).

- **FR-005**: System MUST allow ROLE_OWNER and ROLE_OPERATOR to assign or change the manager of any department. The designated manager MUST be a member of that department (managers cannot manage departments they don't belong to).

- **FR-006**: System MUST enforce that each employee can be a member of at most one department at any given time. Employees not assigned to any department are considered "unassigned."

- **FR-007**: System MUST allow department managers to add unassigned employees to their own department. Managers cannot add employees who are already members of another department.

- **FR-008**: System MUST restrict department managers from removing employees from their department, moving employees to other departments, renaming their department, or deleting their department. These operations are reserved for ROLE_OWNER and ROLE_OPERATOR only.

- **FR-009**: System MUST allow ROLE_OWNER and ROLE_OPERATOR to move employees freely between departments, changing the employee's department membership from one department to another in a single atomic operation.

- **FR-010**: System MUST allow ROLE_OWNER and ROLE_OPERATOR to remove employees from departments, making them unassigned.

- **FR-011**: System MUST allow ROLE_OWNER and ROLE_OPERATOR to delete departments. System MUST block deletion if the department has any members (employees or managers) and require all members to be moved out first. Empty departments can be deleted regardless of whether they have child departments.

- **FR-012**: System MUST prevent circular references in the department hierarchy (a department cannot be its own ancestor).

- **FR-013**: System MUST display the department tree structure as the default view with visual indication of parent-child relationships, allowing users to expand and collapse department nodes to view or hide child departments.

- **FR-014**: System MUST display for each department: department name, description, assigned manager (if any), count of direct employees (members), and count of child departments. System MUST cache these counts for performance and use them to display warnings.

- **FR-015**: System MUST allow ROLE_OWNER and ROLE_OPERATOR to move entire department subtrees by changing a department's parent, moving all child departments and employee memberships along with it.

- **FR-016**: System MUST show only unassigned employees when a department manager clicks "Add Employee" to prevent accidental cross-department assignments.

- **FR-017**: System MUST NOT implement permission inheritance through the department hierarchy. Departments are purely organizational structures and do not affect system role-based access control (ROLE_OWNER, ROLE_OPERATOR, ROLE_EMPLOYEE).

- **FR-018**: System MUST display warning indicators for departments that have zero managers or zero employees to alert administrators of potentially incomplete organizational structure.

- **FR-019**: System MUST automatically clear a department's manager designation when that manager is moved to another department or removed from the organization, transitioning the department to a "no manager" state with warning indicator.

### Non-Functional Requirements

- **NFR-001**: System MUST support unlimited department hierarchy depth. Deep hierarchies should be monitored for potential UI performance impact, but no artificial limit is enforced.

- **NFR-002**: System MUST enforce organization-level tenant isolation for all department data, ensuring departments and memberships are scoped to a single organization.

- **NFR-003**: System MUST provide clear visual feedback when operations fail (e.g., attempting to add an already-assigned employee, creating circular references, unauthorized actions).

- **NFR-004**: System MUST maintain referential integrity when employees or departments are deleted, updated, or moved. Department deletion requires member evacuation; manager removal automatically clears manager designation.

- **NFR-005**: System MUST cache member counts and manager counts for each department to enable efficient warning indicators and performance optimization when displaying large department trees.

### Key Entities

- **Department**: Represents an organizational unit within a company. Key attributes include unique identifier (UUID v7), organization membership, department name (required), description (optional), parent department reference (for tree structure, null if root-level), and cached counts (member count, manager count, child department count). A department can have zero or more child departments, zero or more employee members, and zero or one manager. Empty departments (no manager, no members) are valid and should display warning indicators.

- **Department Membership**: Represents an employee's assignment to a specific department. Key attributes include unique identifier, organization membership, department reference, employee reference, and role within department ("member" or "manager" designation). An employee can have at most one active department membership. The manager designation in this entity means the employee is both a member AND the manager of that department.

- **Employee**: Existing entity representing an individual working for the organization. Each employee may belong to zero or one department. Employees designated as managers MUST be members of the department they manage.

- **Identity**: Existing entity representing authentication and authorization. Contains role assignment (ROLE_ADMIN, ROLE_OWNER, ROLE_OPERATOR, ROLE_EMPLOYEE) which determines permissions for department management operations.

- **Department Tree Structure**: Represents the hierarchical organization of all departments. Supports parent-child relationships with multiple root-level departments (departments with no parent). Must prevent circular references and maintain tree integrity during move operations. No depth limit is enforced.

---

## Review & Acceptance Checklist

### Content Quality
- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

### Requirement Completeness
- [x] No [NEEDS CLARIFICATION] markers remain (all 7 clarifications resolved)
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

---

## Execution Status

- [x] User description parsed
- [x] Key concepts extracted
- [x] All clarifications resolved (7 questions answered)
- [x] User scenarios defined
- [x] Requirements generated
- [x] Entities identified
- [x] Review checklist passed

**Clarifications Resolved (Session 2025-10-27):**
1. ✅ **Manager Requirement**: Departments can exist without managers (0 or 1 manager allowed)
2. ✅ **Manager Membership**: Managers must belong to the department they manage
3. ✅ **Department Deletion**: Deletion blocked if department has any members; empty departments can be deleted
4. ✅ **Employee Reassignment on Delete**: Must migrate all members out before deletion
5. ✅ **Manager Lifecycle**: Manager designation automatically cleared when manager leaves/moves
6. ✅ **Maximum Depth**: No depth limit enforced
7. ✅ **Manager Permissions**: Managers cannot rename, delete, or remove employees; only ROLE_OWNER/OPERATOR can

---

## Notes for Planning Phase

Now that clarifications are complete, the planning phase should consider:

1. **Existing Schema**: The database already has `organization.department`, `organization.department_member` tables with basic name, description, and role (member/manager) fields. The schema will need enhancement to support:
   - Parent-child relationships (add `parent_department_id` column)
   - Cached counts (add `member_count`, `manager_count`, `child_count` columns for performance and warnings)
   - Constraint enforcement (one department per employee via unique index)

2. **Integration Points**: 
   - Employee listing page (spec 005) should show department membership
   - Employee import feature (spec 003) should allow department assignment during import
   - Organization page likely needs a new "Departments" tab in the workspace layout

3. **Permission Model**: This feature uses "department manager" as a membership role (not a system role). Managers have limited permissions (add unassigned employees to their department only), while ROLE_OWNER and ROLE_OPERATOR have full control.

4. **Tree Structure Complexity**: Moving department subtrees and preventing circular references requires careful validation logic. No artificial depth limit, but monitor UI performance for deep hierarchies.

5. **User Experience**: The tree view with expand/collapse functionality is the default display mode, critical for usability with large department structures. Warning indicators for empty departments (no manager/no members) must be visually clear.

6. **Data Migration**: Since `organization.department` and `organization.department_member` tables already exist (visible in schema.sql lines 70-96), existing department data needs to be handled during schema enhancement. Likely safe to assume current data is minimal since this is a new system.

7. **Cache Columns**: Add `member_count`, `manager_count`, `child_count` columns to `organization.department` table. These should be updated via database triggers or application logic whenever memberships change to avoid expensive COUNT queries on large datasets.

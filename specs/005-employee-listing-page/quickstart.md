# Quickstart: Employee Listing Page

**Feature**: Employee Listing Page  
**Date**: 2025-10-27  
**Status**: Draft

## Overview

This quickstart guide provides step-by-step instructions to validate the employee listing feature implementation. Each scenario corresponds to a functional requirement in the spec and can serve as an acceptance test.

**Prerequisites**:
- Backend server running (`cd backend && go run cmd/main.go`)
- Frontend development server running (`cd frontend && pnpm web dev`)
- Test organization with sample employees (created via import employees feature)
- Four test users with different roles (ROLE_ADMIN, ROLE_OWNER, ROLE_OPERATOR, ROLE_EMPLOYEE)

---

## Test Data Setup

### Step 1: Create Test Organization

**Action**: Use existing organization onboarding flow or create via database script.

**Result**: Organization with ID `550e8400-e29b-41d4-a716-446655440000` and slug `testorg`.

---

### Step 2: Import Sample Employees

**Action**: Use employee import feature to create 15 test employees.

**Sample Data** (CSV format):
```csv
email,given_name,family_name,hire_date,date_of_birth,phone_number,home_address
alice@testorg.com,Alice,Anderson,2020-01-15,1990-06-20,+1-555-100-1001,123 Main St
bob@testorg.com,Bob,Brown,2021-03-20,1985-12-10,+1-555-200-2002,456 Oak Ave
charlie@testorg.com,Charlie,Chen,2019-06-10,1992-03-15,+1-555-300-3003,789 Elm Rd
diana@testorg.com,Diana,Davis,2022-09-05,1988-11-25,+1-555-400-4004,321 Pine Ln
eve@testorg.com,Eve,Evans,2020-01-15,1995-07-08,+1-555-500-5005,654 Maple Dr
frank@testorg.com,Frank,Foster,2021-11-20,1987-02-28,+1-555-600-6006,987 Birch Ct
grace@testorg.com,Grace,Garcia,2023-02-14,1993-09-30,+1-555-700-7007,135 Cedar Way
henry@testorg.com,Henry,Hill,,1991-05-12,+1-555-800-8008,246 Spruce Ave
iris@testorg.com,Iris,Ivanov,2022-04-01,,+1-555-900-9009,357 Willow St
jack@testorg.com,Jack,Jackson,2020-07-22,1989-12-03,+1-555-000-0010,468 Ash Blvd
karen@testorg.com,Karen,King,2021-08-18,1994-01-17,+1-555-111-1111,579 Fir Pl
leo@testorg.com,Leo,Lee,2019-12-01,1986-08-22,+1-555-222-2222,680 Redwood Ln
maria@testorg.com,Maria,Martinez,2023-05-10,1996-04-05,+1-555-333-3333,791 Sequoia Rd
nina@testorg.com,Nina,Nelson,2022-10-30,1990-10-10,+1-555-444-4444,802 Cypress Way
oscar@testorg.com,Oscar,Ortiz,2020-03-25,1992-06-15,+1-555-555-5555,913 Palm Dr
```

**Note**: 
- Alice and Eve have identical hire_date (2020-01-15) → tests UUID v7 secondary sort
- Henry has NULL hire_date → tests NULL handling
- Iris has NULL date_of_birth → tests NULL handling

**Result**: 15 employees created, all active.

---

### Step 3: Set One Employee to Inactive

**Action**: Update Bob Brown to `is_active = false` via database or future deactivate feature.

```sql
UPDATE organization.employee 
SET is_active = false 
WHERE id = (SELECT id FROM iam.identity WHERE email = 'bob@testorg.com' AND organization_id = '550e8400-e29b-41d4-a716-446655440000');
```

**Result**: Bob Brown is now inactive (will be grayed out in UI).

---

### Step 4: Create Test Users with Different Roles

**Users**:
1. admin@testorg.com - ROLE_ADMIN
2. owner@testorg.com - ROLE_OWNER
3. operator@testorg.com - ROLE_OPERATOR
4. employee@testorg.com - ROLE_EMPLOYEE

**Result**: Four authenticated users for role-based testing.

---

## Test Scenarios

### Scenario 1: View Employee List (Default Settings)

**Acceptance Criteria**: FR-001, FR-002

**Login As**: admin@testorg.com (ROLE_ADMIN)

**Steps**:
1. Navigate to `https://testorg.localhost:13000/workspace/organization?tab=employees`
2. Observe the employee list

**Expected Results**:
- ✅ Page displays 15 employees
- ✅ Default pagination: 50 items per page (all 15 visible on page 1)
- ✅ Columns visible: Name, Email, Hire Date, Date of Birth, Phone, Home Address, Status
- ✅ Bob Brown's row is grayed out (inactive)
- ✅ Other 14 employees have normal styling (active)
- ✅ Default sort: Hire date ascending (Charlie Chen 2019-06-10 appears first)
- ✅ NULLs sorted to end (Henry with NULL hire_date appears last)

**Screenshot Checkpoints**:
- Table header shows all columns
- Bob's row has `opacity-50 text-gray-500` styling
- Pagination shows "Page 1 of 1"

---

### Scenario 2: Role-Based Column Visibility (ROLE_ADMIN)

**Acceptance Criteria**: FR-003

**Login As**: admin@testorg.com (ROLE_ADMIN)

**Steps**:
1. Navigate to Employees tab
2. Observe visible columns

**Expected Results**:
- ✅ Date of Birth column visible
- ✅ Home Address column visible
- ✅ Can see Alice's date_of_birth: "1990-06-20"
- ✅ Can see Alice's home_address: "123 Main St"

---

### Scenario 3: Role-Based Column Visibility (ROLE_EMPLOYEE)

**Acceptance Criteria**: FR-003

**Login As**: employee@testorg.com (ROLE_EMPLOYEE)

**Steps**:
1. Navigate to Employees tab
2. Observe visible columns

**Expected Results**:
- ❌ Date of Birth column NOT visible
- ❌ Home Address column NOT visible
- ✅ Other columns visible: Name, Email, Hire Date, Phone, Status
- ✅ Can still see all 15 employees (access not restricted)

**Screenshot Checkpoints**:
- Table header does not include "Date of Birth" or "Home Address"

---

### Scenario 4: Exact Email Search

**Acceptance Criteria**: FR-004

**Login As**: admin@testorg.com (ROLE_ADMIN)

**Steps**:
1. Navigate to Employees tab
2. Enter "alice@testorg.com" in search field
3. Press Enter or click Search button

**Expected Results**:
- ✅ Only 1 employee displayed: Alice Anderson
- ✅ Email matches exactly (case-insensitive)
- ✅ Pagination shows "Page 1 of 1, Total: 1"

**Steps** (continued):
4. Clear search field
5. Observe list

**Expected Results**:
- ✅ All 15 employees displayed again
- ✅ Search filter cleared, sort order maintained

---

### Scenario 5: Exact Email Search (No Results)

**Acceptance Criteria**: FR-010

**Login As**: admin@testorg.com (ROLE_ADMIN)

**Steps**:
1. Navigate to Employees tab
2. Enter "nonexistent@testorg.com" in search field
3. Press Enter

**Expected Results**:
- ✅ Empty state displayed: "No employees found"
- ✅ Message suggests clearing search or trying different email
- ✅ No error shown (valid UX, not a server error)

---

### Scenario 6: Sort by Hire Date (Ascending)

**Acceptance Criteria**: FR-005

**Login As**: admin@testorg.com (ROLE_ADMIN)

**Steps**:
1. Navigate to Employees tab
2. Click "Hire Date" column header

**Expected Results**:
- ✅ Employees sorted by hire_date ascending
- ✅ First employee: Charlie Chen (2019-06-10)
- ✅ Second employee: Leo Lee (2019-12-01)
- ✅ Alice and Eve (both 2020-01-15) appear consecutively, sorted by ID
- ✅ Last employee: Henry (NULL hire_date)

---

### Scenario 7: Sort by Hire Date (Descending)

**Acceptance Criteria**: FR-005

**Login As**: admin@testorg.com (ROLE_ADMIN)

**Steps**:
1. Navigate to Employees tab
2. Click "Hire Date" column header twice (first click = ASC, second click = DESC)

**Expected Results**:
- ✅ Employees sorted by hire_date descending
- ✅ First employee: Maria Martinez (2023-05-10)
- ✅ Second employee: Grace Garcia (2023-02-14)
- ✅ Last non-NULL: Charlie Chen (2019-06-10)
- ✅ Very last employee: Henry (NULL hire_date)

**Screenshot Checkpoints**:
- Column header shows down arrow icon (↓) indicating DESC sort

---

### Scenario 8: Sort by Date of Birth (ROLE_ADMIN)

**Acceptance Criteria**: FR-006

**Login As**: admin@testorg.com (ROLE_ADMIN)

**Steps**:
1. Navigate to Employees tab
2. Click "Date of Birth" column header

**Expected Results**:
- ✅ Employees sorted by date_of_birth ascending
- ✅ First employee: Bob Brown (1985-12-10)
- ✅ Last non-NULL: Maria Martinez (1996-04-05)
- ✅ Very last employee: Iris Ivanov (NULL date_of_birth)

---

### Scenario 9: Sort by Date of Birth (ROLE_EMPLOYEE - Hidden)

**Acceptance Criteria**: FR-006

**Login As**: employee@testorg.com (ROLE_EMPLOYEE)

**Steps**:
1. Navigate to Employees tab
2. Observe table headers

**Expected Results**:
- ❌ "Date of Birth" column NOT visible
- ✅ Cannot sort by date_of_birth (column does not exist in UI)

---

### Scenario 10: Pagination - Change Page Size

**Acceptance Criteria**: FR-007

**Login As**: admin@testorg.com (ROLE_ADMIN)

**Steps**:
1. Navigate to Employees tab (15 employees total)
2. Change page size selector to "20"

**Expected Results**:
- ✅ All 15 employees visible on page 1
- ✅ Pagination shows "Page 1 of 1"

**Steps** (continued):
3. Change page size selector to "10"

**Expected Results**:
- ✅ Only 10 employees visible on page 1
- ✅ Pagination shows "Page 1 of 2"
- ✅ Click "Next" button

**Expected Results**:
- ✅ Remaining 5 employees visible on page 2
- ✅ Pagination shows "Page 2 of 2"
- ✅ "Next" button disabled
- ✅ "Previous" button enabled

---

### Scenario 11: Pagination - Maintain State Across Pages

**Acceptance Criteria**: FR-008

**Login As**: admin@testorg.com (ROLE_ADMIN)

**Steps**:
1. Navigate to Employees tab
2. Sort by hire_date DESC
3. Change page size to 10
4. Navigate to page 2

**Expected Results**:
- ✅ Page 2 displays employees 11-15
- ✅ Sort order maintained (hire_date DESC still active)
- ✅ Page size maintained (still showing 10 per page setting)

**Steps** (continued):
5. Navigate back to page 1

**Expected Results**:
- ✅ Page 1 displays employees 1-10
- ✅ Sort order still hire_date DESC
- ✅ No re-sorting or re-fetching occurred (state preserved)

---

### Scenario 12: Pagination - Empty Last Page Edge Case

**Login As**: admin@testorg.com (ROLE_ADMIN)

**Steps**:
1. Navigate to Employees tab (15 employees total)
2. Set page size to 10 (creates 2 pages: 10 + 5)
3. Navigate to page 2 (shows 5 employees)
4. Change page size to 200

**Expected Results**:
- ✅ Automatically redirects to page 1
- ✅ All 15 employees visible on single page
- ✅ Pagination shows "Page 1 of 1"

---

### Scenario 13: UUID v7 Secondary Sort (Tie-Breaking)

**Acceptance Criteria**: FR-005

**Login As**: admin@testorg.com (ROLE_ADMIN)

**Steps**:
1. Navigate to Employees tab
2. Sort by hire_date ascending
3. Locate Alice Anderson and Eve Evans (both hired 2020-01-15)

**Expected Results**:
- ✅ Alice and Eve appear consecutively (same hire_date)
- ✅ Order determined by UUID v7 ID (time-sortable)
- ✅ If Alice was created before Eve, Alice appears first
- ✅ Order remains consistent across multiple page loads (deterministic)

**Validation Method**:
- Check database: `SELECT id, given_name, hire_date FROM organization.employee WHERE hire_date = '2020-01-15' ORDER BY id;`
- Verify UI order matches database UUID sort order

---

### Scenario 14: NULL Date Handling

**Acceptance Criteria**: FR-011

**Login As**: admin@testorg.com (ROLE_ADMIN)

**Steps**:
1. Navigate to Employees tab
2. Sort by hire_date ascending
3. Scroll to end of list

**Expected Results**:
- ✅ Henry (NULL hire_date) appears at the end
- ✅ Hire Date column displays "N/A" or empty cell for Henry

**Steps** (continued):
4. Sort by hire_date descending
5. Scroll to end of list

**Expected Results**:
- ✅ Henry (NULL hire_date) still appears at the end (NULLs always last)

---

### Scenario 15: Performance - Large Page Size (200 employees)

**Acceptance Criteria**: NFR-001

**Prerequisite**: Organization has 200 employees (maximum)

**Login As**: admin@testorg.com (ROLE_ADMIN)

**Steps**:
1. Import 185 additional employees (total 200)
2. Navigate to Employees tab
3. Set page size to 200
4. Measure page load time

**Expected Results**:
- ✅ All 200 employees load within 2 seconds (NFR-001 requirement)
- ✅ Table renders without lag or freezing
- ✅ Sorting still responsive (<500ms to re-sort)

**Performance Monitoring**:
- Use Chrome DevTools Performance tab
- Verify API response time <150ms
- Verify frontend render time <100ms

---

### Scenario 16: Multi-Tenant Isolation

**Acceptance Criteria**: Constitution requirement (tenant isolation)

**Prerequisite**: Create second organization "org2" with 10 employees

**Login As**: admin@testorg.com (ROLE_ADMIN in "testorg")

**Steps**:
1. Navigate to Employees tab
2. Observe displayed employees

**Expected Results**:
- ✅ Only employees from "testorg" visible (15 employees)
- ✅ No employees from "org2" visible
- ✅ API response includes only `organization_id = testorg.id`

**Validation Method**:
- Inspect Network tab: Verify API request includes correct organization_id
- Check database query logs: Confirm WHERE organization_id filter applied

---

### Scenario 17: Session Persistence

**Acceptance Criteria**: NFR-002

**Login As**: admin@testorg.com (ROLE_ADMIN)

**Steps**:
1. Navigate to Employees tab
2. Sort by date_of_birth DESC
3. Set page size to 20
4. Navigate to page 2
5. Navigate to different workspace tab (e.g., Departments)
6. Return to Employees tab

**Expected Results**:
- ✅ Page 2 still displayed (pagination state preserved)
- ✅ Sort order still date_of_birth DESC (sort state preserved)
- ✅ Page size still 20 (page size preference preserved)

**Note**: Preferences lost on full page refresh (acceptable per NFR-002)

---

### Scenario 18: Loading States

**Acceptance Criteria**: NFR-003

**Login As**: admin@testorg.com (ROLE_ADMIN)

**Steps**:
1. Navigate to Employees tab
2. Observe initial loading state
3. Throttle network to "Slow 3G" in DevTools
4. Trigger page change or sort

**Expected Results**:
- ✅ Skeleton table with shimmer effect displays during load
- ✅ Loading spinner visible during data fetch
- ✅ No content shift or layout jump when data loads
- ✅ Table placeholders match final table structure

---

### Scenario 19: Error Handling - Network Failure

**Acceptance Criteria**: NFR-003

**Login As**: admin@testorg.com (ROLE_ADMIN)

**Steps**:
1. Navigate to Employees tab
2. Enable "Offline" mode in DevTools
3. Attempt to change page or sort

**Expected Results**:
- ✅ Error alert displayed: "Failed to load employees. Please check your connection."
- ✅ Retry button visible
- ✅ Current data (if any) remains visible (does not clear table)
- ✅ Clicking retry re-fetches data

---

### Scenario 20: Responsive Layout (Wide Screens)

**Acceptance Criteria**: NFR-004

**Login As**: admin@testorg.com (ROLE_ADMIN)

**Steps**:
1. Resize browser window to 1280px width (13-inch laptop)
2. Navigate to Employees tab

**Expected Results**:
- ✅ All columns visible without horizontal scroll
- ✅ Table fits within viewport width
- ✅ Compact vertical spacing (header + tabs + table < 90% viewport height)

**Steps** (continued):
3. Resize to 1920px width (external monitor)

**Expected Results**:
- ✅ Table utilizes horizontal space (max-width: 1280px centered)
- ✅ No excessive whitespace or stretched columns

---

## Automation Test Script

### Backend Integration Test (Go)

```go
// backend/integration/employee_listing_test.go
package integration

import (
    "context"
    "testing"
    "github.com/stretchr/testify/assert"
    "github.com/stretchr/testify/require"
)

func TestListEmployees_DefaultSort(t *testing.T) {
    // Setup: Create test organization and 15 employees
    ctx := context.Background()
    orgID := createTestOrg(t)
    createTestEmployees(t, orgID, 15)
    
    // Execute: Call ListEmployees RPC
    req := &rpcv1.ListEmployeesRequest{
        OrganizationId: orgID,
        Pagination: &rpcv1.PaginationOptions{
            PageNumber: 1,
            PageSize: 50,
        },
    }
    resp, err := iamClient.ListEmployees(ctx, req)
    
    // Verify
    require.NoError(t, err)
    assert.Equal(t, 15, len(resp.Employees))
    assert.Equal(t, int32(15), resp.Pagination.TotalCount)
    
    // Verify default sort (hire_date ASC)
    assert.LessOrEqual(t, resp.Employees[0].HireDate, resp.Employees[1].HireDate)
}

func TestListEmployees_RoleBasedFiltering(t *testing.T) {
    ctx := context.Background()
    orgID := createTestOrg(t)
    createTestEmployees(t, orgID, 5)
    
    // Test as ROLE_ADMIN (should see all fields)
    adminCtx := withRole(ctx, "ROLE_ADMIN")
    resp, _ := iamClient.ListEmployees(adminCtx, &rpcv1.ListEmployeesRequest{...})
    assert.NotNil(t, resp.Employees[0].DateOfBirth) // Sensitive field present
    
    // Test as ROLE_EMPLOYEE (should NOT see sensitive fields)
    employeeCtx := withRole(ctx, "ROLE_EMPLOYEE")
    resp, _ = iamClient.ListEmployees(employeeCtx, &rpcv1.ListEmployeesRequest{...})
    assert.Nil(t, resp.Employees[0].DateOfBirth) // Sensitive field filtered
}

func TestListEmployees_MultiTenantIsolation(t *testing.T) {
    ctx := context.Background()
    org1ID := createTestOrg(t)
    org2ID := createTestOrg(t)
    createTestEmployees(t, org1ID, 10)
    createTestEmployees(t, org2ID, 5)
    
    // Query org1: should only see org1's employees
    resp, _ := iamClient.ListEmployees(ctx, &rpcv1.ListEmployeesRequest{
        OrganizationId: org1ID,
        Pagination: &rpcv1.PaginationOptions{PageNumber: 1, PageSize: 50},
    })
    assert.Equal(t, 10, len(resp.Employees))
    for _, emp := range resp.Employees {
        assert.Equal(t, org1ID, emp.OrganizationId)
    }
}
```

---

### Frontend Component Test (TypeScript)

```typescript
// frontend/apps/web/src/app/workspace/organization/components/EmployeesTab.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EmployeesTab } from './EmployeesTab';

describe('EmployeesTab', () => {
  it('displays employee list with default settings', async () => {
    render(<EmployeesTab />);
    
    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('Alice Anderson')).toBeInTheDocument();
    });
    
    // Verify all columns visible (for ROLE_ADMIN)
    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(screen.getByText('Hire Date')).toBeInTheDocument();
    expect(screen.getByText('Date of Birth')).toBeInTheDocument();
  });
  
  it('filters sensitive columns for ROLE_EMPLOYEE', async () => {
    // Mock user with ROLE_EMPLOYEE
    mockAuth({ role: 'ROLE_EMPLOYEE' });
    
    render(<EmployeesTab />);
    
    await waitFor(() => {
      expect(screen.getByText('Alice Anderson')).toBeInTheDocument();
    });
    
    // Verify sensitive columns NOT visible
    expect(screen.queryByText('Date of Birth')).not.toBeInTheDocument();
    expect(screen.queryByText('Home Address')).not.toBeInTheDocument();
  });
  
  it('searches by exact email', async () => {
    render(<EmployeesTab />);
    const user = userEvent.setup();
    
    // Enter email and search
    const searchInput = screen.getByPlaceholderText('Search by email...');
    await user.type(searchInput, 'alice@testorg.com');
    await user.keyboard('{Enter}');
    
    // Verify only Alice displayed
    await waitFor(() => {
      expect(screen.getByText('Alice Anderson')).toBeInTheDocument();
      expect(screen.queryByText('Bob Brown')).not.toBeInTheDocument();
    });
  });
  
  it('sorts by hire date when column header clicked', async () => {
    render(<EmployeesTab />);
    const user = userEvent.setup();
    
    await waitFor(() => screen.getByText('Alice Anderson'));
    
    // Click hire date column header
    await user.click(screen.getByText('Hire Date'));
    
    // Verify sort order changed
    const rows = screen.getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Charlie Chen'); // 2019-06-10
    expect(rows[rows.length - 1]).toHaveTextContent('Henry Hill'); // NULL
  });
});
```

---

## Success Criteria Summary

### Functional Requirements Validated
- ✅ FR-001: Paginated list with default 50 per page
- ✅ FR-002: Display name, email, hire date, status (active/inactive visual distinction)
- ✅ FR-003: Role-based column visibility (date_of_birth, home_address filtered)
- ✅ FR-004: Exact email search
- ✅ FR-005: Sort by hire_date (ASC/DESC, UUID v7 secondary sort)
- ✅ FR-006: Sort by date_of_birth (role-restricted)
- ✅ FR-007: Page size selector (20, 50, 100, 200)
- ✅ FR-008: State maintained across pagination
- ✅ FR-009: Pagination controls visible and functional
- ✅ FR-010: "No results found" message for empty search
- ✅ FR-011: NULL dates handled (display N/A, sort last)
- ✅ FR-012: All roles can access list
- ✅ FR-013: System handles up to 200 employees

### Non-Functional Requirements Validated
- ✅ NFR-001: Response time <2s for 200 employees
- ✅ NFR-002: Session state preservation
- ✅ NFR-003: Loading indicators and error messages
- ✅ NFR-004: Responsive on 1280px+ screens

### Constitutional Requirements Validated
- ✅ Multi-tenant isolation (no cross-org data leakage)
- ✅ TenantPool used for tenant-aware queries
- ✅ Role-based access control enforced
- ✅ No schema changes required (existing schema sufficient)

---

## Deployment Verification

### Pre-Deployment Checklist
- [ ] All unit tests passing
- [ ] All integration tests passing
- [ ] Frontend component tests passing
- [ ] Manual testing of all 20 scenarios completed
- [ ] Performance benchmarks meet NFR-001 (<2s for 200 employees)
- [ ] Generated code committed (sqlc, buf outputs)

### Post-Deployment Validation
1. Navigate to production Employees tab
2. Run Scenario 1 (View Employee List)
3. Run Scenario 4 (Exact Email Search)
4. Run Scenario 6 (Sort by Hire Date)
5. Monitor logs for errors or performance issues
6. Verify metrics dashboard shows healthy latency (<200ms p95)

### Rollback Trigger Conditions
- API error rate >1%
- API latency p95 >500ms
- Frontend errors in Sentry >10/hour
- User reports of missing data or incorrect results

---

## Next Steps

After successful quickstart validation:
1. Update `.github/copilot-instructions.md` with new API patterns
2. Proceed to `/tasks` command to generate implementation tasks
3. Begin implementation following tasks.md order

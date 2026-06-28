# Workspace Organization Module

This module provides comprehensive organization management functionality including employee management, departments, and permissions.

## Structure

```
workspace/organization/
├── page.tsx                    # Main organization page with tab navigation
├── import-employees/           # Dedicated employee import page
│   ├── page.tsx               # Full-page import wizard (replaces dialog)
│   └── README.md              # Import page documentation
└── components/
    ├── OverviewTab.tsx        # Organization overview with stats and activity
    ├── EmployeesTab.tsx       # Employee directory and management
    ├── DepartmentsTab.tsx     # Department management
    ├── PermissionsTab.tsx     # Roles and permissions management
    ├── EmployeeImportDialog.tsx  # [DEPRECATED] Modal dialog (replaced by dedicated page)
    └── import/                # Employee import components
        ├── ManualEntryForm.tsx      # Manual data entry form
        ├── FileUploadForm.tsx       # Excel file upload and parsing
        ├── PreviewTable.tsx         # Preview import data with validation
        └── ResultsDisplay.tsx       # Display import results
```

## Features

### Overview Tab
- Organization information card with branding
- Quick stats (team members, departments, roles, projects)
- Recent members list
- Activity feed

### Employees Tab
- Employee directory (placeholder for future implementation)
- Quick action buttons:
  - Add Single Employee (coming soon)
  - Import Employees (navigates to dedicated import page)
- Integration with import functionality

### Employee Import (Dedicated Page)
**Route**: `/workspace/organization/import-employees`

Converted from modal dialog to full-page experience for better UX:
- ✅ Non-blocking navigation - users can open links in new tabs
- ✅ More screen space for preview tables and validation
- ✅ Better accessibility with standard page navigation
- ✅ Can bookmark or share the import page URL

**Features**:
- Three-step wizard: Enter Data → Preview → Results
- Two data entry methods:
  - **Manual Entry**: Table-based form with inline validation
  - **File Upload**: Excel (.xlsx) file import with automatic parsing
- Real-time validation and duplicate detection
- Preview before import with comprehensive stats
- Detailed results with success/failure breakdown
- Maximum 100 employees per batch
- Cancel/back navigation to return to organization page

### Departments Tab
- Department grid with member counts
- Add new departments (coming soon)

### Permissions Tab
- Role and permission management (coming soon)

## Navigation

Access through:
- Workspace sidebar: "Organization" (🏢)
- Direct URL: `/workspace/organization`
- Tabs available:
  - 📊 Overview
  - 👥 Employees (with import feature)
  - 🏢 Departments
  - 🔑 Permissions

## Integration Points

### APIs Used
- `previewEmployeeImport()` - Preview employee data before import
- `executeEmployeeImport()` - Execute the bulk import

### Authentication
- Uses `useRequireAuth()` hook for user context
- Organization ID from Zitadel claims: `urn:zitadel:iam:org:id`

### Data Model
Employees are defined with:
- `email` - Email address (required, validated)
- `givenName` - Given/first name (required)
- `familyName` - Family/last name (required)

## User Experience

### Tab Navigation
Clean, icon-enhanced tabs with active state highlighting:
- Blue background for active tab
- Gray hover state for inactive tabs
- Emoji icons for visual distinction

### Import Flow
1. **Enter Data**: Choose manual entry or file upload
2. **Preview & Confirm**: Review data with validation highlights
3. **Results**: See detailed success/failure report

### Modal Dialog
- Full-screen overlay with centered modal
- Maximum 90vh height with scrollable content
- Clear stepper showing progress
- Error messages prominently displayed
- Action buttons contextual to current step

## Design Patterns

- **Tab-based Navigation**: Clean separation of concerns
- **Modal Dialogs**: Non-intrusive import workflow
- **Component Composition**: Reusable tab and import components
- **Responsive Layout**: Works on all screen sizes
- **Consistent Styling**: Tailwind CSS with design system colors
- **Error Handling**: Clear, actionable error messages

## Future Enhancements

- [ ] Real employee data fetching and display
- [ ] Add single employee form
- [ ] Department management CRUD operations
- [ ] Role and permission management
- [ ] Employee profile pages
- [ ] Advanced filtering and search
- [ ] Export functionality
- [ ] Bulk edit operations

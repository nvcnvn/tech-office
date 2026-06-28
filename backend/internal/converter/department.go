package converter

import (
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/nvcnvn/tech-office/backend/database"
	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
	v1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// DepartmentTreeRowToProto converts a database GetDepartmentTreeRow to proto Department message
func DepartmentTreeRowToProto(row *database.GetDepartmentTreeRow) *v1.Department {
	if row == nil {
		return nil
	}

	dept := &v1.Department{
		Id:             UUIDToProto(row.ID),
		OrganizationId: UUIDToProto(row.OrganizationID),
		Name:           row.Name,
		MemberCount:    row.MemberCount,
		ManagerCount:   row.ManagerCount,
		ChildCount:     row.ChildCount,
		UpdatedAt:      TimeToProto(row.UpdatedAt).AsTime().Format("2006-01-02T15:04:05Z07:00"),
		Depth:          row.Depth,
		FullPath:       row.FullPath,
	}

	// Handle nullable description
	if row.Description.Valid {
		dept.Description = row.Description.String
	}

	// Handle nullable parent_department_id
	if row.ParentDepartmentID.Valid {
		dept.ParentDepartmentId = NullUUIDToProto(row.ParentDepartmentID)
	}

	// Handle path array (PostgreSQL UUID array -> []string)
	if pathArray, ok := row.Path.([]interface{}); ok {
		dept.Path = make([]string, len(pathArray))
		for i, p := range pathArray {
			if pathUUID, ok := p.(dbuuid.UUID); ok {
				dept.Path[i] = UUIDToProto(pathUUID)
			}
		}
	}

	return dept
}

// DepartmentToProto converts a database OrganizationDepartment to proto Department message
func DepartmentToProto(dept *database.OrganizationDepartment) *v1.Department {
	if dept == nil {
		return nil
	}

	protoDept := &v1.Department{
		Id:             UUIDToProto(dept.ID),
		OrganizationId: UUIDToProto(dept.OrganizationID),
		Name:           dept.Name,
		MemberCount:    dept.MemberCount,
		ManagerCount:   dept.ManagerCount,
		ChildCount:     dept.ChildCount,
		UpdatedAt:      TimeToProto(dept.UpdatedAt).AsTime().Format("2006-01-02T15:04:05Z07:00"),
	}

	// Handle nullable description
	if dept.Description.Valid {
		protoDept.Description = dept.Description.String
	}

	// Handle nullable parent_department_id
	if dept.ParentDepartmentID.Valid {
		protoDept.ParentDepartmentId = NullUUIDToProto(dept.ParentDepartmentID)
	}

	return protoDept
}

// DepartmentMemberToProto converts a database GetDepartmentMembersRow to proto DepartmentMember message
func DepartmentMemberToProto(row *database.GetDepartmentMembersRow) *v1.DepartmentMember {
	if row == nil {
		return nil
	}

	return &v1.DepartmentMember{
		Id:                UUIDToProto(row.ID),
		OrganizationId:    UUIDToProto(row.OrganizationID),
		DepartmentId:      UUIDToProto(row.DepartmentID),
		EmployeeId:        UUIDToProto(row.EmployeeID),
		Role:              row.Role,
		UpdatedAt:         TimeToProto(row.UpdatedAt).AsTime().Format("2006-01-02T15:04:05Z07:00"),
		EmployeeFirstName: row.EmployeeFirstName,
		EmployeeLastName:  row.EmployeeLastName,
		EmployeeEmail:     row.EmployeeEmail,
	}
}

// OrganizationDepartmentMemberToProto converts a database OrganizationDepartmentMember to proto DepartmentMember message
func OrganizationDepartmentMemberToProto(member *database.OrganizationDepartmentMember) *v1.DepartmentMember {
	if member == nil {
		return nil
	}

	return &v1.DepartmentMember{
		Id:             UUIDToProto(member.ID),
		OrganizationId: UUIDToProto(member.OrganizationID),
		DepartmentId:   UUIDToProto(member.DepartmentID),
		EmployeeId:     UUIDToProto(member.EmployeeID),
		Role:           member.Role,
		UpdatedAt:      TimeToProto(member.UpdatedAt).AsTime().Format("2006-01-02T15:04:05Z07:00"),
		// Note: OrganizationDepartmentMember doesn't have employee details
		// These would need to be fetched separately if needed
	}
}

// UnassignedEmployeeToProto converts a database GetUnassignedEmployeesRow to proto UnassignedEmployee message
func UnassignedEmployeeToProto(row *database.GetUnassignedEmployeesRow) *v1.UnassignedEmployee {
	if row == nil {
		return nil
	}

	return &v1.UnassignedEmployee{
		Id:        UUIDToProto(row.ID),
		FirstName: row.FirstName,
		LastName:  row.LastName,
		Email:     row.Email,
	}
}

// textToString safely converts pgtype.Text to string
func textToString(t pgtype.Text) string {
	if t.Valid {
		return t.String
	}
	return ""
}

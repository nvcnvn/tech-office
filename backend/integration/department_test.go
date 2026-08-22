package integration

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestDepartment covers create, hierarchy, member assignment, and move operations.
func TestDepartment(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	owner := w.withOwner()
	emp := w.withEmployee()

	t.Run("when a root department is created", func(t *testing.T) {
		parentID := w.createDepartment(owner, "Engineering", "")

		t.Run("it appears in the department tree", func(t *testing.T) {
			tree := w.getDepartmentTree(owner)
			d := findDepartment(tree, parentID)
			require.NotNil(t, d)
			assert.Equal(t, "Engineering", d.Name)
		})
	})

	t.Run("when a child department is created under a parent", func(t *testing.T) {
		parentID := w.createDepartment(owner, "Product", "")
		childID := w.createDepartment(owner, "Product-Frontend", parentID)

		t.Run("the child has the correct parent", func(t *testing.T) {
			tree := w.getDepartmentTree(owner)
			child := findDepartment(tree, childID)
			require.NotNil(t, child)
			assert.Equal(t, parentID, child.ParentDepartmentId)
		})
	})

	t.Run("when an employee is assigned to a department", func(t *testing.T) {
		deptID := w.createDepartment(owner, "QA", "")
		w.assignEmployeeToDepartment(owner, deptID, emp.ID)

		t.Run("the employee appears in department members", func(t *testing.T) {
			members := w.getDepartmentMembers(owner, deptID)
			found := false
			for _, m := range members {
				if m.EmployeeId == emp.ID.String() {
					found = true
				}
			}
			require.True(t, found, "assigned employee should appear in members")
		})
	})

	t.Run("when a child department is moved to a different parent", func(t *testing.T) {
		parentA := w.createDepartment(owner, "Division-A", "")
		parentB := w.createDepartment(owner, "Division-B", "")
		child := w.createDepartment(owner, "Movable-Team", parentA)

		w.moveDepartment(owner, child, parentB)

		t.Run("the child now belongs to the new parent", func(t *testing.T) {
			tree := w.getDepartmentTree(owner)
			d := findDepartment(tree, child)
			require.NotNil(t, d)
			assert.Equal(t, parentB, d.ParentDepartmentId)
		})
	})

	t.Run("when a child department is moved to root", func(t *testing.T) {
		parent := w.createDepartment(owner, "Temp-Parent", "")
		child := w.createDepartment(owner, "Promoted-Team", parent)
		emp2 := w.withEmployee()
		w.assignEmployeeToDepartment(owner, child, emp2.ID)

		w.moveDepartment(owner, child, "")

		t.Run("the department has no parent", func(t *testing.T) {
			tree := w.getDepartmentTree(owner)
			d := findDepartment(tree, child)
			require.NotNil(t, d)
			assert.Empty(t, d.ParentDepartmentId)
		})

		t.Run("the member is still assigned after the move", func(t *testing.T) {
			members := w.getDepartmentMembers(owner, child)
			found := false
			for _, m := range members {
				if m.EmployeeId == emp2.ID.String() {
					found = true
				}
			}
			require.True(t, found, "member should persist after move to root")
		})
	})
}

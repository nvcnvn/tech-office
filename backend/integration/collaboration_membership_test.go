package integration

import (
	"testing"

	"connectrpc.com/connect"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestProjectMembership covers member count tracking, RBAC, role mutations, and orphan prevention.
func TestProjectMembership(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	owner := w.withOwner()

	t.Run("when adding members", func(t *testing.T) {
		proj := w.createProject(owner, "Count Test", uniqueProjectKey("CNT"))
		employee := w.withEmployee()

		t.Run("the member count increments", func(t *testing.T) {
			before := w.getProject(owner, proj.ID)
			assert.Equal(t, int32(1), before.MemberCount) // creator = 1

			w.addProjectMember(owner, proj.ID, employee.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)

			after := w.getProject(owner, proj.ID)
			assert.Equal(t, int32(2), after.MemberCount)
		})

		t.Run("removing a member decrements the count", func(t *testing.T) {
			w.removeProjectMember(owner, proj.ID, employee.ID)
			after := w.getProject(owner, proj.ID)
			assert.Equal(t, int32(1), after.MemberCount)
		})
	})

	t.Run("when enforcing role-based access on a private project", func(t *testing.T) {
		employees := w.withEmployees(4)
		viewer := employees[0]
		member := employees[1]
		admin := employees[2]
		nonMember := employees[3]

		proj := w.createPrivateProject(owner, "RBAC Test", uniqueProjectKey("RBAC"))
		w.addProjectMember(owner, proj.ID, viewer.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_VIEWER)
		w.addProjectMember(owner, proj.ID, member.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
		w.addProjectMember(owner, proj.ID, admin.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_ADMIN)

		level0 := levelByDepth(proj.Levels, 0)

		t.Run("non-member cannot access the project", func(t *testing.T) {
			err := w.getProjectError(nonMember, proj.ID)
			require.Error(t, err)
		})

		t.Run("viewer can view but not create tasks", func(t *testing.T) {
			_ = w.getProject(viewer, proj.ID) // view succeeds
			if level0 != nil {
				err := w.createTaskError(viewer, proj.ID, "Attempt", level0.Id)
				require.Error(t, err)
				assert.Equal(t, connect.CodePermissionDenied, connect.CodeOf(err))
			}
		})

		t.Run("member can create tasks", func(t *testing.T) {
			if level0 != nil {
				task := w.createTask(member, proj.ID, "Member Task", level0.Id)
				assert.NotEmpty(t, task.Id)
			}
		})

		t.Run("member cannot add other members", func(t *testing.T) {
			extra := w.withEmployee()
			err := w.addProjectMemberError(member, proj.ID, extra.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
			require.Error(t, err)
			assert.Equal(t, connect.CodePermissionDenied, connect.CodeOf(err))
		})

		t.Run("admin can add members", func(t *testing.T) {
			extra := w.withEmployee()
			w.addProjectMember(admin, proj.ID, extra.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
		})

		t.Run("admin cannot archive (owner-only)", func(t *testing.T) {
			_, err := w.archiveProject(admin, proj.ID, true)
			require.Error(t, err)
			assert.Equal(t, connect.CodePermissionDenied, connect.CodeOf(err))
		})

		t.Run("owner can archive", func(t *testing.T) {
			archived, err := w.archiveProject(owner, proj.ID, true)
			require.NoError(t, err)
			assert.True(t, archived.IsArchived)
			// restore
			_, _ = w.archiveProject(owner, proj.ID, false)
		})
	})

	t.Run("when updating a member role", func(t *testing.T) {
		proj := w.createProject(owner, "Role Update", uniqueProjectKey("ROLE"))
		employee := w.withEmployee()
		w.addProjectMember(owner, proj.ID, employee.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_VIEWER)

		level0 := levelByDepth(proj.Levels, 0)

		t.Run("upgrading viewer to member grants create-task permission", func(t *testing.T) {
			w.updateProjectMemberRole(owner, proj.ID, employee.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
			if level0 != nil {
				task := w.createTask(employee, proj.ID, "Now I Can", level0.Id)
				assert.NotEmpty(t, task.Id)
			}
		})

		t.Run("downgrading member to viewer removes create-task permission", func(t *testing.T) {
			w.updateProjectMemberRole(owner, proj.ID, employee.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_VIEWER)
			if level0 != nil {
				err := w.createTaskError(employee, proj.ID, "Denied", level0.Id)
				require.Error(t, err)
				assert.Equal(t, connect.CodePermissionDenied, connect.CodeOf(err))
			}
		})
	})

	t.Run("when listing project members", func(t *testing.T) {
		proj := w.createProject(owner, "List Members", uniqueProjectKey("LIST"))
		e1 := w.withEmployee()
		e2 := w.withEmployee()
		w.addProjectMember(owner, proj.ID, e1.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_ADMIN)
		w.addProjectMember(owner, proj.ID, e2.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)

		members := w.listProjectMembers(owner, proj.ID)

		t.Run("all members including the owner are returned", func(t *testing.T) {
			assert.Len(t, members, 3)
		})
	})

	t.Run("when removing the last owner", func(t *testing.T) {
		proj := w.createProject(owner, "Orphan Test", uniqueProjectKey("ORPH"))

		t.Run("the removal is rejected to prevent orphan projects", func(t *testing.T) {
			err := w.removeProjectMemberError(owner, proj.ID, owner.ID)
			require.Error(t, err)
			assert.Equal(t, connect.CodeFailedPrecondition, connect.CodeOf(err))
		})
	})
}

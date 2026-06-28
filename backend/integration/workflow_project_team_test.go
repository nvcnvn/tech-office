package integration

import (
	"testing"

	"connectrpc.com/connect"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestProjectTeamWorkflow simulates the full project team management experience:
// Owner creates project -> adds members with roles -> members collaborate on tasks ->
// role changes affect permissions -> member removal cascades to access loss.
func TestProjectTeamWorkflow(t *testing.T) {
	w := newTestWorld(t)
	users := w.withEmployees(4)
	owner, lead, dev1, dev2 := users[0], users[1], users[2], users[3]

	t.Run("when a team is assembled on a private project", func(t *testing.T) {
		proj := w.createPrivateProject(owner, "Secret R&D", uniqueProjectKey("RND"))
		level0 := levelByDepth(proj.Levels, 0)
		require.NotNil(t, level0)

		t.Run("initially only the owner can see the project", func(t *testing.T) {
			ownerProjects := w.listProjects(owner)
			assert.NotNil(t, findProject(ownerProjects, proj.ID))
			leadProjects := w.listProjects(lead)
			assert.Nil(t, findProject(leadProjects, proj.ID))
		})

		w.addProjectMember(owner, proj.ID, lead.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_ADMIN)
		w.addProjectMember(owner, proj.ID, dev1.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
		w.addProjectMember(owner, proj.ID, dev2.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)

		t.Run("all members can now see the private project", func(t *testing.T) {
			for _, u := range []testUser{lead, dev1, dev2} {
				projects := w.listProjects(u)
				assert.NotNil(t, findProject(projects, proj.ID),
					"member should see the private project after being added")
			}
		})

		t.Run("the member list shows correct roles", func(t *testing.T) {
			members := w.listProjectMembers(owner, proj.ID)
			require.GreaterOrEqual(t, len(members), 4)
			roleMap := map[string]rpcv1.ProjectMemberRole{}
			for _, m := range members {
				roleMap[m.EmployeeId] = m.Role
			}
			assert.Equal(t, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_ADMIN, roleMap[lead.ID.String()])
			assert.Equal(t, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER, roleMap[dev1.ID.String()])
		})

		t.Run("when team members work on tasks", func(t *testing.T) {
			task1 := w.createTask(lead, proj.ID, "Research Phase", level0.Id)
			task2 := w.createTask(lead, proj.ID, "Prototype", level0.Id)

			t.Run("all members can see the tasks", func(t *testing.T) {
				tasks := w.listTasks(dev1, proj.ID)
				require.GreaterOrEqual(t, len(tasks), 2)
			})

			w.assignTask(lead, task1.Id, dev1.ID, rpcv1.TaskAssigneeRole_TASK_ASSIGNEE_ROLE_ASSIGNEE)

			t.Run("filtering by assignee shows only their tasks", func(t *testing.T) {
				assigneeFilter := dev1.ID.String()
				filtered := w.listTasksWithFilter(lead, proj.ID, nil, &assigneeFilter)
				require.Len(t, filtered, 1)
				assert.Equal(t, task1.Id, filtered[0].Id)
			})

			t.Run("when a member is removed from the project", func(t *testing.T) {
				w.removeProjectMember(owner, proj.ID, dev2.ID)

				t.Run("the removed member can no longer see the project", func(t *testing.T) {
					projects := w.listProjects(dev2)
					assert.Nil(t, findProject(projects, proj.ID))
				})

				t.Run("the removed member cannot access project tasks", func(t *testing.T) {
					err := w.getTaskError(dev2, task2.Id)
					require.Error(t, err)
					code := connect.CodeOf(err)
					assert.True(t, code == connect.CodePermissionDenied || code == connect.CodeNotFound,
						"removed member should get denied or not-found for tasks")
				})
			})
		})

		t.Run("when a member role is changed", func(t *testing.T) {
			w.updateProjectMemberRole(owner, proj.ID, dev1.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_ADMIN)
			members := w.listProjectMembers(owner, proj.ID)
			for _, m := range members {
				if m.EmployeeId == dev1.ID.String() {
					assert.Equal(t, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_ADMIN, m.Role)
				}
			}
		})

		t.Run("when the project is archived", func(t *testing.T) {
			archProj := w.createProject(owner, "Archive Candidate", uniqueProjectKey("ARCH"))
			w.addProjectMember(owner, archProj.ID, dev1.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)

			archived, err := w.archiveProject(owner, archProj.ID, true)
			require.NoError(t, err)
			assert.True(t, archived.IsArchived)

			t.Run("members no longer see it in default project list", func(t *testing.T) {
				projects := w.listProjects(dev1)
				assert.Nil(t, findProject(projects, archProj.ID))
			})

			t.Run("members see it with includeArchived flag", func(t *testing.T) {
				projects := w.listProjectsIncludeArchived(dev1)
				p := findProject(projects, archProj.ID)
				require.NotNil(t, p)
				assert.True(t, p.IsArchived)
			})

			t.Run("unarchiving restores visibility", func(t *testing.T) {
				unarchived, err := w.archiveProject(owner, archProj.ID, false)
				require.NoError(t, err)
				assert.False(t, unarchived.IsArchived)
				projects := w.listProjects(dev1)
				assert.NotNil(t, findProject(projects, archProj.ID))
			})
		})
	})

	t.Run("when a non-owner tries to manage members", func(t *testing.T) {
		proj := w.createProject(owner, "Permission Test", uniqueProjectKey("PERM"))
		w.addProjectMember(owner, proj.ID, dev1.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)

		t.Run("a regular member cannot add other members to a private project", func(t *testing.T) {
			privProj := w.createPrivateProject(owner, "Strict Private", uniqueProjectKey("STRP"))
			w.addProjectMember(owner, privProj.ID, dev1.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
			err := w.addProjectMemberError(dev1, privProj.ID, dev2.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
			require.Error(t, err)
			assert.Equal(t, connect.CodePermissionDenied, connect.CodeOf(err))
		})

		t.Run("a regular member cannot archive a project", func(t *testing.T) {
			_, err := w.archiveProject(dev1, proj.ID, true)
			require.Error(t, err)
			assert.Equal(t, connect.CodePermissionDenied, connect.CodeOf(err))
		})
	})
}

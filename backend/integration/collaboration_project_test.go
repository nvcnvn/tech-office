package integration

import (
	"testing"

	"connectrpc.com/connect"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestProject covers project creation, visibility filtering, archive, and key immutability.
func TestProject(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	owner := w.withOwner()

	t.Run("when a project is created with defaults", func(t *testing.T) {
		proj := w.createProject(owner, "Default Project", uniqueProjectKey("DEF"))

		t.Run("it has default task states (todo, in_progress, done)", func(t *testing.T) {
			require.GreaterOrEqual(t, len(proj.States), 3)
			cats := map[string]bool{}
			for _, s := range proj.States {
				cats[s.Category.String()] = true
			}
			assert.True(t, cats["STATE_CATEGORY_TODO"])
			assert.True(t, cats["STATE_CATEGORY_IN_PROGRESS"])
			assert.True(t, cats["STATE_CATEGORY_DONE"])
		})

		t.Run("it has default levels (at least 4)", func(t *testing.T) {
			require.GreaterOrEqual(t, len(proj.Levels), 4)
		})

		t.Run("the creator is automatically added as owner", func(t *testing.T) {
			members := w.listProjectMembers(owner, proj.ID)
			require.NotEmpty(t, members)
			ownerFound := false
			for _, m := range members {
				if m.Role == rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_OWNER {
					ownerFound = true
				}
			}
			assert.True(t, ownerFound)
		})
	})

	t.Run("when a private project exists", func(t *testing.T) {
		employee1 := w.withEmployee()
		employee2 := w.withEmployee()

		privProj := w.createPrivateProject(employee1, "Private Proj", uniqueProjectKey("PRIV"))
		pubProj := w.createProject(employee1, "Public Proj", uniqueProjectKey("PUB"))

		t.Run("a non-member cannot see the private project", func(t *testing.T) {
			projects := w.listProjects(employee2)
			assert.Nil(t, findProject(projects, privProj.ID))
			assert.NotNil(t, findProject(projects, pubProj.ID))
		})

		t.Run("a non-member can open the public project details", func(t *testing.T) {
			fetched := w.getProject(employee2, pubProj.ID)
			assert.Equal(t, pubProj.ID, fetched.Id)
			assert.Equal(t, rpcv1.ProjectVisibility_PROJECT_VISIBILITY_PUBLIC, fetched.Visibility)
		})

		t.Run("after being added, the member can see it", func(t *testing.T) {
			w.addProjectMember(employee1, privProj.ID, employee2.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
			projects := w.listProjects(employee2)
			assert.NotNil(t, findProject(projects, privProj.ID))
		})
	})

	t.Run("when archiving a project", func(t *testing.T) {
		employee := w.withEmployee()
		proj := w.createProject(owner, "Archive Test", uniqueProjectKey("ARCH"))

		// Add employee as regular member
		w.addProjectMember(owner, proj.ID, employee.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)

		t.Run("a non-owner cannot archive", func(t *testing.T) {
			_, err := w.archiveProject(employee, proj.ID, true)
			require.Error(t, err)
			assert.Equal(t, connect.CodePermissionDenied, connect.CodeOf(err))
		})

		t.Run("the owner can archive the project", func(t *testing.T) {
			archived, err := w.archiveProject(owner, proj.ID, true)
			require.NoError(t, err)
			assert.True(t, archived.IsArchived)
		})

		t.Run("archived projects are hidden by default in list", func(t *testing.T) {
			projects := w.listProjects(owner)
			assert.Nil(t, findProject(projects, proj.ID))
		})

		t.Run("archived projects appear when includeArchived is set", func(t *testing.T) {
			projects := w.listProjectsIncludeArchived(owner)
			p := findProject(projects, proj.ID)
			require.NotNil(t, p)
			assert.True(t, p.IsArchived)
		})

		t.Run("the owner can unarchive the project", func(t *testing.T) {
			unarchived, err := w.archiveProject(owner, proj.ID, false)
			require.NoError(t, err)
			assert.False(t, unarchived.IsArchived)
		})
	})

	t.Run("when updating a project", func(t *testing.T) {
		proj := w.createProject(owner, "Update Test", uniqueProjectKey("UPD"))
		newName := "Updated Name"
		newDesc := "Updated description"
		updated := w.updateProject(owner, proj.ID, &newName, &newDesc)

		t.Run("the name and description change", func(t *testing.T) {
			assert.Equal(t, "Updated Name", updated.Name)
			assert.Equal(t, "Updated description", updated.Description)
		})

		t.Run("the key remains immutable", func(t *testing.T) {
			assert.Equal(t, proj.Key, updated.Key)
		})
	})
}

// TestProjectCollaborationMode covers project collaboration mode selection and its effect on state bootstrapping.
func TestProjectCollaborationMode(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	owner := w.withOwner()

	t.Run("when creating a project with ritual mode", func(t *testing.T) {
		proj := w.createProjectWithMode(owner, "Ritual Mode Project", uniqueProjectKey("RLMOD"), rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL)

		t.Run("it sets collaboration_mode to ritual", func(t *testing.T) {
			fetched := w.getProject(owner, proj.ID)
			assert.Equal(t, rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL, fetched.CollaborationMode)
		})

		t.Run("it auto-creates ritual-specific states (Scheduled, Verified, Skipped, etc.)", func(t *testing.T) {
			stateNames := make([]string, len(proj.States))
			for i, s := range proj.States {
				stateNames[i] = s.Name
			}
			assert.Contains(t, stateNames, "Scheduled")
			assert.Contains(t, stateNames, "Verified")
			assert.Contains(t, stateNames, "Skipped")
			assert.Contains(t, stateNames, "Missed")
			assert.Contains(t, stateNames, "Submitted")
		})
	})

	t.Run("when creating a project with mixed mode", func(t *testing.T) {
		proj := w.createProjectWithMode(owner, "Mixed Mode Project", uniqueProjectKey("MXMOD"), rpcv1.CollaborationMode_COLLABORATION_MODE_MIXED)

		t.Run("it creates ritual states", func(t *testing.T) {
			assert.NotEmpty(t, proj.States)
			// Mixed mode also uses ritual states
			stateNames := make([]string, len(proj.States))
			for i, s := range proj.States {
				stateNames[i] = s.Name
			}
			assert.Contains(t, stateNames, "Scheduled")
		})
	})

	t.Run("when creating a project with standard mode (default)", func(t *testing.T) {
		proj := w.createProject(owner, "Standard Mode Project", uniqueProjectKey("STMOD"))

		t.Run("it creates only standard states (backward compatible)", func(t *testing.T) {
			stateNames := make([]string, len(proj.States))
			for i, s := range proj.States {
				stateNames[i] = s.Name
			}
			assert.Contains(t, stateNames, "Backlog")
			assert.NotContains(t, stateNames, "Verified")
			assert.NotContains(t, stateNames, "Scheduled")
		})
	})
}

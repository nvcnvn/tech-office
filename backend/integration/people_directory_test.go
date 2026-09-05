package integration

import (
	"context"
	"slices"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// ---------------------------------------------------------------------------
// Act: the directory read
// ---------------------------------------------------------------------------

func (w *testWorld) listDirectory(actor testUser, req *rpcv1.ListDirectoryRequest) (*rpcv1.ListDirectoryResponse, error) {
	w.t.Helper()
	r := connect.NewRequest(req)
	r.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.iamClient.ListDirectory(context.Background(), r)
	if err != nil {
		return nil, err
	}
	return resp.Msg, nil
}

func (w *testWorld) mustListDirectory(actor testUser, req *rpcv1.ListDirectoryRequest) *rpcv1.ListDirectoryResponse {
	w.t.Helper()
	resp, err := w.listDirectory(actor, req)
	require.NoError(w.t, err)
	return resp
}

// ---------------------------------------------------------------------------
// Arrange: employee record fixtures the invite→accept flow cannot express
// ---------------------------------------------------------------------------

func (w *testWorld) setEmployeePhone(user testUser, phone string) {
	w.t.Helper()
	_, err := globalDB.Exec(context.Background(),
		`UPDATE organization.employee SET phone_number = $3 WHERE organization_id = $1 AND id = $2`,
		user.OrgID, user.ID, phone)
	require.NoError(w.t, err, "set employee phone")
}

// clearEmployeeEmail reproduces an org-managed worker who was issued a badge number and
// no mailbox. The column is NOT NULL DEFAULT '', so "no email" is the empty string.
func (w *testWorld) clearEmployeeEmail(user testUser) {
	w.t.Helper()
	_, err := globalDB.Exec(context.Background(),
		`UPDATE organization.employee SET email = '' WHERE organization_id = $1 AND id = $2`,
		user.OrgID, user.ID)
	require.NoError(w.t, err, "clear employee email")
}

func (w *testWorld) deactivateEmployeeRecord(user testUser) {
	w.t.Helper()
	_, err := globalDB.Exec(context.Background(),
		`UPDATE organization.employee SET is_active = FALSE WHERE organization_id = $1 AND id = $2`,
		user.OrgID, user.ID)
	require.NoError(w.t, err, "deactivate employee")
}

// anonymiseEmployeeRecord leaves the de-identified tombstone account deletion leaves
// behind: the row survives so a year of messages and tasks still resolve, stripped of
// everything that names a person. The directory must not offer "Deleted user" as
// somebody to ring.
func (w *testWorld) anonymiseEmployeeRecord(user testUser) {
	w.t.Helper()
	_, err := globalDB.Exec(context.Background(),
		`UPDATE organization.employee
		 SET given_name = 'Deleted', family_name = 'user', email = '',
		     date_of_birth = NULL, phone_number = NULL, home_address = NULL,
		     additional_info = NULL, is_active = FALSE
		 WHERE organization_id = $1 AND id = $2`,
		user.OrgID, user.ID)
	require.NoError(w.t, err, "anonymise employee")
}

// ---------------------------------------------------------------------------
// The world this contract is read against
// ---------------------------------------------------------------------------

const (
	directoryPhoneNumber   = "+44 20 7946 0958"
	directoryKitchenName   = "Kitchen"
	directoryCellarName    = "Cellar"
	directoryOutsiderFamly = "Outsider"
)

type directoryWorld struct {
	w *testWorld

	owner testUser // Olive Owner
	me    testUser // Quinn Zephyr — the caller, sorts last, in no department
	anna  testUser // Anna Aardvark — phone, Kitchen, online
	bruno testUser // Bruno Bianchi — no phone, Kitchen
	wei   testUser // Wei Chen — no email, no department
	olga  testUser // Ольга Иванова — a name in a second script
	porte testUser // Pat Porter — a custom role with iam.listEmployees removed
	gone  testUser // deactivated
	tomb  testUser // de-identified deletion tombstone

	outsider testUser // a person in a different organization entirely

	kitchenID string
	cellarID  string // a department with nobody in it
}

// activeIDs is everybody the directory is expected to return for this org.
func (d *directoryWorld) activeIDs() []string {
	return []string{
		d.owner.ID.String(), d.me.ID.String(), d.anna.ID.String(),
		d.bruno.ID.String(), d.wei.ID.String(), d.olga.ID.String(),
		d.porte.ID.String(),
	}
}

func newDirectoryWorld(t *testing.T) *directoryWorld {
	t.Helper()
	w := newTestWorld(t)
	d := &directoryWorld{w: w}

	d.owner = w.withOwner()
	w.renameEmployee(d.owner, "Olive", "Owner")

	d.me = w.withEmployee()
	w.renameEmployee(d.me, "Quinn", "Zephyr")

	d.anna = w.withEmployee()
	w.renameEmployee(d.anna, "Anna", "Aardvark")
	w.setEmployeePhone(d.anna, directoryPhoneNumber)
	w.updatePresence(d.anna, rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE)

	d.bruno = w.withEmployee()
	w.renameEmployee(d.bruno, "Bruno", "Bianchi")

	d.wei = w.withEmployee()
	w.renameEmployee(d.wei, "Wei", "Chen")
	w.clearEmployeeEmail(d.wei)

	d.olga = w.withEmployee()
	w.renameEmployee(d.olga, "Ольга", "Иванова")

	d.gone = w.withEmployee()
	w.renameEmployee(d.gone, "Gary", "Gone")
	w.deactivateEmployeeRecord(d.gone)

	d.tomb = w.withEmployee()
	w.renameEmployee(d.tomb, "Tara", "Tombstone")
	w.anonymiseEmployeeRecord(d.tomb)

	// A caller whose role does not carry iam.listEmployees. The permission is removed by
	// giving them a custom role and taking the seeded one away, which is how an
	// organization would actually arrive at this state.
	d.porte = w.withEmployee()
	w.renameEmployee(d.porte, "Pat", "Porter")
	restricted := w.createRole(d.owner, "Kitchen Porter", "No roster access", nonListEmployeePermissions(w, d.owner))
	w.assignRole(d.owner, d.porte.ID.String(), restricted.Id)
	for _, r := range w.listEmployeeRoles(d.owner, d.porte.ID.String()) {
		if r.Id != restricted.Id {
			w.revokeRole(d.owner, d.porte.ID.String(), r.Id)
		}
	}

	d.kitchenID = w.createDepartment(d.owner, directoryKitchenName, "")
	d.cellarID = w.createDepartment(d.owner, directoryCellarName, "")
	w.assignEmployeeToDepartment(d.owner, d.kitchenID, d.anna.ID)
	w.assignEmployeeToDepartment(d.owner, d.kitchenID, d.bruno.ID)

	// A separate organization, so tenant isolation has something to fail against.
	other := newTestWorld(t)
	d.outsider = other.withEmployee()
	other.renameEmployee(d.outsider, "Ozzy", directoryOutsiderFamly)

	return d
}

// nonListEmployeePermissions returns every permission the organization can grant except
// the one the directory requires, so the restricted role is a real role rather than an
// empty one.
func nonListEmployeePermissions(w *testWorld, owner testUser) []string {
	w.t.Helper()
	var ids []string
	for _, group := range w.listPermissions(owner, nil) {
		for _, p := range group.Permissions {
			if p.Id != "iam.listEmployees" {
				ids = append(ids, p.Id)
			}
		}
	}
	require.NotEmpty(w.t, ids, "expected the workspace to define permissions")
	return ids
}

func entryIDs(resp *rpcv1.ListDirectoryResponse) []string {
	ids := make([]string, 0, len(resp.Entries))
	for _, e := range resp.Entries {
		ids = append(ids, e.EmployeeId)
	}
	return ids
}

func findEntry(resp *rpcv1.ListDirectoryResponse, id dbuuid.UUID) *rpcv1.DirectoryEntry {
	for _, e := range resp.Entries {
		if e.EmployeeId == id.String() {
			return e
		}
	}
	return nil
}

// sortKey is the browse ordering the query promises: (lower(family), lower(given), id).
func sortKey(e *rpcv1.DirectoryEntry) string {
	return strings.ToLower(e.FamilyName) + "\x1f" + strings.ToLower(e.GivenName) + "\x1f" + e.EmployeeId
}

// TestPeopleDirectory is the behavioural contract for feature 048 — the read-only people
// directory on mobile. The tree below is the one fixed in
// specs/048-people-directory-mobile/quickstart.md before any implementation existed.
func TestPeopleDirectory(t *testing.T) {
	t.Parallel()
	d := newDirectoryWorld(t)
	w := d.w

	t.Run("when a member opens the directory", func(t *testing.T) {
		t.Run("it lists the active colleagues of their own organization", func(t *testing.T) {
			resp := w.mustListDirectory(d.me, &rpcv1.ListDirectoryRequest{})
			assert.ElementsMatch(t, d.activeIDs(), entryIDs(resp))
		})

		t.Run("each entry carries display name, department, role and presence", func(t *testing.T) {
			resp := w.mustListDirectory(d.me, &rpcv1.ListDirectoryRequest{})
			anna := findEntry(resp, d.anna.ID)
			require.NotNil(t, anna, "Anna Aardvark should be listed")

			assert.Equal(t, "Anna", anna.GivenName)
			assert.Equal(t, "Aardvark", anna.FamilyName)
			require.NotNil(t, anna.DepartmentName)
			assert.Equal(t, directoryKitchenName, *anna.DepartmentName)
			assert.NotEmpty(t, anna.RoleNames, "an entry names the role the person holds")
			assert.Equal(t, "online", anna.PresenceStatus)

			// Presence rides inside the payload; a row must never have to ask for it.
			bruno := findEntry(resp, d.bruno.ID)
			require.NotNil(t, bruno)
			assert.Equal(t, "offline", bruno.PresenceStatus,
				"a colleague with no live connection reads offline, not empty")
		})

		t.Run("it never returns date of birth, home address or hire date", func(t *testing.T) {
			// The only way to satisfy FR-008 is for the fields not to exist: a field the
			// client declines to render has still reached the device and its cache.
			fields := (&rpcv1.DirectoryEntry{}).ProtoReflect().Descriptor().Fields()
			present := make([]string, 0, fields.Len())
			for i := range fields.Len() {
				present = append(present, string(fields.Get(i).Name()))
			}
			for _, forbidden := range []string{"date_of_birth", "home_address", "hire_date", "additional_info"} {
				assert.NotContains(t, present, forbidden,
					"DirectoryEntry must not carry %s", forbidden)
			}
		})

		t.Run("it excludes a deactivated employee", func(t *testing.T) {
			resp := w.mustListDirectory(d.me, &rpcv1.ListDirectoryRequest{})
			assert.NotContains(t, entryIDs(resp), d.gone.ID.String())
		})

		t.Run("it excludes a de-identified deletion tombstone", func(t *testing.T) {
			resp := w.mustListDirectory(d.me, &rpcv1.ListDirectoryRequest{})
			assert.NotContains(t, entryIDs(resp), d.tomb.ID.String())

			// Asked for by id, a tombstone is still not a person you can ring.
			byID := w.mustListDirectory(d.me, &rpcv1.ListDirectoryRequest{
				EmployeeIds: []string{d.tomb.ID.String()},
			})
			assert.Empty(t, byID.Entries)
		})

		t.Run("it never returns a person from another organization", func(t *testing.T) {
			resp := w.mustListDirectory(d.me, &rpcv1.ListDirectoryRequest{})
			assert.NotContains(t, entryIDs(resp), d.outsider.ID.String())

			// Not by name, and not by asking for the id outright.
			narrowed := w.mustListDirectory(d.me, &rpcv1.ListDirectoryRequest{Query: directoryOutsiderFamly})
			assert.Empty(t, narrowed.Entries)

			byID := w.mustListDirectory(d.me, &rpcv1.ListDirectoryRequest{
				EmployeeIds: []string{d.outsider.ID.String()},
			})
			assert.Empty(t, byID.Entries)
		})

		t.Run("it marks the caller's own entry as self", func(t *testing.T) {
			resp := w.mustListDirectory(d.me, &rpcv1.ListDirectoryRequest{})
			for _, e := range resp.Entries {
				assert.Equal(t, e.EmployeeId == d.me.ID.String(), e.IsSelf,
					"is_self must be true for exactly the caller's row (%s)", e.EmployeeId)
			}

			// Computed from the JWT, never from the request: the same row read by
			// somebody else is not their own.
			asOwner := w.mustListDirectory(d.owner, &rpcv1.ListDirectoryRequest{
				EmployeeIds: []string{d.me.ID.String()},
			})
			require.Len(t, asOwner.Entries, 1)
			assert.False(t, asOwner.Entries[0].IsSelf)
		})
	})

	t.Run("when the roster is larger than one page", func(t *testing.T) {
		t.Run("the first page returns without waiting for the whole roster", func(t *testing.T) {
			resp := w.mustListDirectory(d.me, &rpcv1.ListDirectoryRequest{PageSize: 2})
			assert.Len(t, resp.Entries, 2, "a page is bounded by the page size, not by the roster")
			assert.NotEmpty(t, resp.NextCursor, "there is more to read")
		})

		t.Run("the cursor walks every person exactly once, in name order", func(t *testing.T) {
			var seen []string
			var keys []string
			cursor := ""
			for range 20 { // a bound, so a broken cursor fails rather than hangs
				resp := w.mustListDirectory(d.me, &rpcv1.ListDirectoryRequest{PageSize: 2, Cursor: cursor})
				for _, e := range resp.Entries {
					seen = append(seen, e.EmployeeId)
					keys = append(keys, sortKey(e))
				}
				cursor = resp.NextCursor
				if cursor == "" {
					break
				}
			}
			assert.Empty(t, cursor, "the walk must terminate")
			assert.ElementsMatch(t, d.activeIDs(), seen, "every person, exactly once")
			assert.True(t, slices.IsSorted(keys), "pages arrive in name order: %v", keys)
		})

		t.Run("an exhausted page returns an empty next cursor", func(t *testing.T) {
			resp := w.mustListDirectory(d.me, &rpcv1.ListDirectoryRequest{PageSize: 100})
			assert.Empty(t, resp.NextCursor)
		})
	})

	t.Run("when the member narrows by name", func(t *testing.T) {
		t.Run("a partial name finds the person", func(t *testing.T) {
			resp := w.mustListDirectory(d.me, &rpcv1.ListDirectoryRequest{Query: "Aard"})
			assert.Contains(t, entryIDs(resp), d.anna.ID.String())
		})

		t.Run("a misspelled name still finds the person", func(t *testing.T) {
			resp := w.mustListDirectory(d.me, &rpcv1.ListDirectoryRequest{Query: "Aardvrk"})
			assert.Contains(t, entryIDs(resp), d.anna.ID.String())
		})

		t.Run("a name in a second script finds the person", func(t *testing.T) {
			resp := w.mustListDirectory(d.me, &rpcv1.ListDirectoryRequest{Query: "Иванов"})
			assert.Contains(t, entryIDs(resp), d.olga.ID.String())
		})

		t.Run("narrowing searches the whole roster, not one page of it", func(t *testing.T) {
			// Zephyr sorts last, so a page-sized search would never reach them.
			firstPage := w.mustListDirectory(d.me, &rpcv1.ListDirectoryRequest{PageSize: 1})
			require.Len(t, firstPage.Entries, 1)
			require.NotEqual(t, d.me.ID.String(), firstPage.Entries[0].EmployeeId)

			resp := w.mustListDirectory(d.me, &rpcv1.ListDirectoryRequest{Query: "Zephyr", PageSize: 1})
			assert.Contains(t, entryIDs(resp), d.me.ID.String())
		})

		t.Run("a narrowed response carries no cursor", func(t *testing.T) {
			resp := w.mustListDirectory(d.me, &rpcv1.ListDirectoryRequest{Query: "Aard"})
			assert.Empty(t, resp.NextCursor)
		})
	})

	t.Run("when a colleague has a phone number recorded", func(t *testing.T) {
		t.Run("the entry carries the number as recorded", func(t *testing.T) {
			resp := w.mustListDirectory(d.me, &rpcv1.ListDirectoryRequest{
				EmployeeIds: []string{d.anna.ID.String()},
			})
			require.Len(t, resp.Entries, 1)
			require.NotNil(t, resp.Entries[0].PhoneNumber)
			assert.Equal(t, directoryPhoneNumber, *resp.Entries[0].PhoneNumber,
				"the number keeps the formatting it was recorded with")
		})
	})

	t.Run("when a colleague has no phone number recorded", func(t *testing.T) {
		t.Run("the entry omits the number rather than returning an empty string", func(t *testing.T) {
			resp := w.mustListDirectory(d.me, &rpcv1.ListDirectoryRequest{
				EmployeeIds: []string{d.bruno.ID.String()},
			})
			require.Len(t, resp.Entries, 1)
			assert.Nil(t, resp.Entries[0].PhoneNumber,
				"absent, not empty — the client hangs the whole call affordance off this")
		})
	})

	t.Run("when a colleague has no email", func(t *testing.T) {
		t.Run("the entry omits the email and still names the person", func(t *testing.T) {
			resp := w.mustListDirectory(d.me, &rpcv1.ListDirectoryRequest{
				EmployeeIds: []string{d.wei.ID.String()},
			})
			require.Len(t, resp.Entries, 1)
			assert.Nil(t, resp.Entries[0].Email)
			assert.Equal(t, "Wei", resp.Entries[0].GivenName)
			assert.Equal(t, "Chen", resp.Entries[0].FamilyName)
		})
	})

	t.Run("when a colleague belongs to no department", func(t *testing.T) {
		t.Run("the entry omits both department id and department name", func(t *testing.T) {
			resp := w.mustListDirectory(d.me, &rpcv1.ListDirectoryRequest{
				EmployeeIds: []string{d.wei.ID.String()},
			})
			require.Len(t, resp.Entries, 1)
			assert.Nil(t, resp.Entries[0].DepartmentId)
			assert.Nil(t, resp.Entries[0].DepartmentName)
		})
	})

	t.Run("when the request names a department", func(t *testing.T) {
		t.Run("it returns that department's active members and no one else", func(t *testing.T) {
			resp := w.mustListDirectory(d.me, &rpcv1.ListDirectoryRequest{DepartmentId: &d.kitchenID})
			assert.ElementsMatch(t,
				[]string{d.anna.ID.String(), d.bruno.ID.String()},
				entryIDs(resp))
		})

		t.Run("an empty department returns no entries and no error", func(t *testing.T) {
			resp, err := w.listDirectory(d.me, &rpcv1.ListDirectoryRequest{DepartmentId: &d.cellarID})
			require.NoError(t, err)
			assert.Empty(t, resp.Entries)
		})

		t.Run("an unknown department id returns no entries and no error", func(t *testing.T) {
			unknown := dbuuid.Must().String()
			resp, err := w.listDirectory(d.me, &rpcv1.ListDirectoryRequest{DepartmentId: &unknown})
			require.NoError(t, err, "a department that is gone is an empty list, not a failure")
			assert.Empty(t, resp.Entries)
		})

		t.Run("a member's own department is still shown on their row", func(t *testing.T) {
			// The filter is an EXISTS, not the display join, so narrowing to a department
			// never changes which department a row shows.
			resp := w.mustListDirectory(d.me, &rpcv1.ListDirectoryRequest{DepartmentId: &d.kitchenID})
			anna := findEntry(resp, d.anna.ID)
			require.NotNil(t, anna)
			require.NotNil(t, anna.DepartmentId)
			require.NotNil(t, anna.DepartmentName)
			assert.Equal(t, d.kitchenID, *anna.DepartmentId)
			assert.Equal(t, directoryKitchenName, *anna.DepartmentName)
		})
	})

	t.Run("when the caller lacks iam.listEmployees", func(t *testing.T) {
		t.Run("the call is rejected before the handler runs", func(t *testing.T) {
			require.NotContains(t, w.getEmployeePermissions(d.owner, d.porte.ID.String()), "iam.listEmployees",
				"fixture: the restricted caller must not hold the permission")

			_, err := w.listDirectory(d.porte, &rpcv1.ListDirectoryRequest{})
			require.Error(t, err)
			var connectErr *connect.Error
			require.ErrorAs(t, err, &connectErr)
			assert.Equal(t, connect.CodePermissionDenied, connectErr.Code())
		})
	})

	t.Run("when the request names more than a hundred people", func(t *testing.T) {
		t.Run("it is rejected as an invalid argument", func(t *testing.T) {
			ids := make([]string, 101)
			for i := range ids {
				ids[i] = dbuuid.Must().String()
			}
			_, err := w.listDirectory(d.me, &rpcv1.ListDirectoryRequest{EmployeeIds: ids})
			require.Error(t, err)
			var connectErr *connect.Error
			require.ErrorAs(t, err, &connectErr)
			assert.Equal(t, connect.CodeInvalidArgument, connectErr.Code())
			assert.Contains(t, connectErr.Message(), "100")
		})
	})
}

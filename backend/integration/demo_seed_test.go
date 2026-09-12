package integration

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
)

// TestDemoSeed covers the properties of the reviewer's workspace that, if wrong,
// are discovered by a store reviewer rather than by us (FR-031, FR-033, and
// feature 055 throughout).
//
// Three of them are load-bearing for a submission. Idempotency: this command is
// run again the morning of a resubmission, and a second "demo" organization
// nobody can find would be worse than no demo at all. A PIN that does not expire:
// the ordinary temporary PIN dies after three days, long before a review queue
// reaches it. And a workspace that is neither empty nor undeletable: a reviewer
// who opens an empty phone or is refused the deletion they were asked to perform
// rejects the build.
func TestDemoSeed(t *testing.T) {
	if testing.Short() {
		t.Skip("seeding builds a whole workspace; skipped in short mode")
	}
	t.Parallel()

	// The full UUID hex, not its first eight characters: those encode the top bits
	// of the millisecond timestamp and repeat for about a minute, so two runs of
	// this test a few seconds apart used to land on the same workspace.
	subdomain := "seedtest" + strings.ReplaceAll(dbuuid.Must().String(), "-", "")[:20]
	backendDir := findBackendDir(t)

	runResult := func() (string, error) {
		cmd := exec.Command("go", "run", "./cmd", "seed-demo-org", "--subdomain", subdomain)
		cmd.Dir = backendDir
		cmd.Env = os.Environ()
		out, err := cmd.CombinedOutput()
		return string(out), err
	}
	run := func() string {
		out, err := runResult()
		require.NoError(t, err, "seed-demo-org failed: %s", out)
		return out
	}

	t.Run("when the seed runs for the first time", func(t *testing.T) {
		output := run()
		// The subprocess created this organisation, so it is not registered for
		// cleanup by the ordinary registration path; hand it to the same purge.
		rememberOrg(demoOrgID(t, subdomain))

		t.Run("it creates the workspace", func(t *testing.T) { // FR-031
			assert.Contains(t, output, "Created demo workspace")
		})

		t.Run("it prints three credentials, primary first and the spare marked for deletion", func(t *testing.T) { // FR-021
			// The order is the order a reviewer reads them in. The spare sits
			// between the two so the account they are asked to destroy is next to
			// the one they are told to keep, and cannot be confused with the
			// admin-provisioned worker further down.
			primaryIdx := indexOf(output, "PRIMARY credential")
			spareIdx := indexOf(output, "SPARE credential")
			workerIdx := indexOf(output, "SECOND credential")
			require.Positive(t, primaryIdx)
			require.Positive(t, spareIdx)
			require.Positive(t, workerIdx)
			assert.Less(t, primaryIdx, spareIdx)
			assert.Less(t, spareIdx, workerIdx)

			assert.Equal(t, 1, strings.Count(output, "the one to delete"),
				"exactly one block may nominate an account for deletion")
		})

		t.Run("it produces at least one reportable message", func(t *testing.T) { // FR-031
			assert.Positive(t, countRows(t,
				`SELECT COUNT(*) FROM chat.message m
				 JOIN public.organization o ON o.id = m.organization_id
				 WHERE o.subdomain = $1`, subdomain),
				"a reviewer testing the report flow needs something to report")
		})

		t.Run("it creates two owner accounts", func(t *testing.T) { // FR-001
			// Two owners is what makes either deletion acceptable to the
			// sole-owner guard. One is the state this feature exists to leave.
			assert.Equal(t, 2, countRows(t,
				`SELECT COUNT(*)
				 FROM iam.employee_role er
				 JOIN iam.role r ON (r.organization_id, r.id) = (er.organization_id, er.role_id)
				 JOIN organization.employee e ON (e.organization_id, e.id) = (er.organization_id, er.employee_id)
				 JOIN public.organization o ON o.id = er.organization_id
				 WHERE o.subdomain = $1 AND r.source_default_role_id = 'owner' AND e.is_active`, subdomain))
		})

		t.Run("both owner accounts are self-registered, not admin-provisioned", func(t *testing.T) { // FR-003
			// is_org_managed decides which account-ending path the settings screen
			// offers. An org-managed owner would be offered the removal request,
			// not deletion, and the demonstration would be impossible.
			assert.Equal(t, 2, countRows(t,
				`SELECT COUNT(*)
				 FROM iam.employee_role er
				 JOIN iam.role r ON (r.organization_id, r.id) = (er.organization_id, er.role_id)
				 JOIN iam."user" u ON u.id = er.employee_id
				 JOIN public.organization o ON o.id = er.organization_id
				 WHERE o.subdomain = $1 AND r.source_default_role_id = 'owner' AND NOT u.is_org_managed`, subdomain))
		})

		t.Run("the admin-provisioned worker is still the only org-managed account", func(t *testing.T) { // FR-007
			assert.Equal(t, 1, countRows(t,
				`SELECT COUNT(*)
				 FROM iam."user" u
				 JOIN organization.employee e ON e.id = u.id
				 JOIN public.organization o ON o.id = e.organization_id
				 WHERE o.subdomain = $1 AND u.is_org_managed`, subdomain))
		})

		t.Run("it creates six work items across two open workflow states", func(t *testing.T) { // FR-009
			assert.Equal(t, 6, countRows(t, countDemoStandardTasks, subdomain))

			openStates := countRows(t,
				`SELECT COUNT(DISTINCT t.state_id)
				 FROM collaboration.task t
				 JOIN collaboration.project_state ps ON (ps.organization_id, ps.id) = (t.organization_id, t.state_id)
				 JOIN public.organization o ON o.id = t.organization_id
				 WHERE o.subdomain = $1 AND t.task_kind = 'standard' AND NOT t.is_deleted AND NOT ps.is_closed`, subdomain)
			assert.Equal(t, 2, openStates, "a board with one column does not read as a workspace in use")
		})

		t.Run("every sign-in credential has at least one work item assigned to it", func(t *testing.T) { // FR-010
			// My Work fans out per project and filters by assignee, so a credential
			// holding nothing sees the empty state however much work exists.
			assert.Equal(t, 3, countRows(t,
				`SELECT COUNT(DISTINCT ta.employee_id)
				 FROM collaboration.task_assignee ta
				 JOIN collaboration.task t ON (t.organization_id, t.id) = (ta.organization_id, ta.task_id)
				 JOIN public.organization o ON o.id = t.organization_id
				 WHERE o.subdomain = $1 AND t.task_kind = 'standard' AND NOT t.is_deleted AND ta.role = 'assignee'`, subdomain))
		})

		t.Run("at least one assigned item is past its due date and at least one is due today", func(t *testing.T) { // FR-011
			// Today's whole-screen empty state clears only when one of these two
			// buckets is populated; a task due next week does not help.
			for _, person := range demoPeople(t, subdomain) {
				late := countRows(t, countDemoAssignedTasksDue+` AND t.due_date < CURRENT_DATE`, subdomain, person.id)
				today := countRows(t, countDemoAssignedTasksDue+` AND t.due_date = CURRENT_DATE`, subdomain, person.id)
				assert.Positive(t, late+today, "%s has nothing in Running late or Due today", person.label)
			}

			assert.Positive(t, countRows(t, countDemoStandardTasks+` AND t.due_date < CURRENT_DATE`, subdomain))
			assert.Positive(t, countRows(t, countDemoStandardTasks+` AND t.due_date = CURRENT_DATE`, subdomain))
		})

		t.Run("it creates one recurring job with exactly two instances", func(t *testing.T) { // FR-013
			assert.Equal(t, 1, countRows(t,
				`SELECT COUNT(*) FROM collaboration.ritual_definition rd
				 JOIN public.organization o ON o.id = rd.organization_id
				 WHERE o.subdomain = $1`, subdomain))
			assert.Equal(t, 2, countRows(t, countDemoRitualInstances, subdomain))
		})

		t.Run("the late instance is in an overdue state and is assigned to the worker", func(t *testing.T) { // FR-014
			// Never an owner: the Team block excludes work assigned to the caller,
			// so an owner-assigned instance is invisible in that owner's own block.
			assert.Equal(t, 1, countRows(t,
				`SELECT COUNT(*)
				 FROM collaboration.task t
				 JOIN collaboration.project_state ps ON (ps.organization_id, ps.id) = (t.organization_id, t.state_id)
				 JOIN collaboration.task_assignee ta ON (ta.organization_id, ta.task_id) = (t.organization_id, t.id)
				 JOIN iam."user" u ON u.id = ta.employee_id
				 JOIN public.organization o ON o.id = t.organization_id
				 WHERE o.subdomain = $1 AND t.task_kind = 'ritual_instance' AND NOT t.is_deleted
				   AND ps.category = 'overdue' AND ta.role = 'assignee' AND u.is_org_managed`, subdomain))
		})

		t.Run("the unassigned instance is scheduled for today and has no assignee", func(t *testing.T) { // FR-013
			// The unassigned leg of the Team block matches on scheduled_date
			// equality, not a range.
			assert.Equal(t, 1, countRows(t, countDemoUnassignedInstances+` AND t.scheduled_date = CURRENT_DATE`, subdomain))
		})

		t.Run("the unassigned instance is in a state that is neither overdue nor closed", func(t *testing.T) { // FR-016
			// Overdue would put it in the wrong category; closed would remove it
			// from the block altogether.
			assert.Equal(t, 1, countRows(t,
				countDemoUnassignedInstances+` AND ps.category <> 'overdue' AND NOT ps.is_closed`, subdomain))
		})

		t.Run("the screens' own predicates return work for every credential", func(t *testing.T) { // SC-003, SC-004
			// This stands in for the excluded Maestro coverage: the same two RPCs
			// the mobile screens call, asked the same questions.
			w := newTestWorld(t)
			orgID := demoOrgID(t, subdomain)
			for _, person := range demoPeople(t, subdomain) {
				actor := testUser{ID: person.id, OrgID: orgID, Token: demoToken(t, person.id, orgID)}

				summary := w.getAssignedWorkSummary(actor, nil, true)
				assert.Positive(t, summary.OverdueCount+summary.DueTodayCount,
					"%s opens My Work on an empty screen", person.label)

				if person.isOwner {
					team := w.getTeamAttentionSummary(actor, nil, nil)
					assert.NotEmpty(t, team.Items, "%s opens Today with an empty Team block", person.label)
				}
			}
		})
	})

	t.Run("when the background sweeps run against the seeded workspace", func(t *testing.T) {
		// Driven in-process rather than waited on: the server's own sweeps run
		// every 5 and every 1 minute against the same rows, and a test that waited
		// for them would be six minutes of nothing.
		orgID := demoOrgID(t, subdomain)
		w := newTestWorld(t)
		sweeper := testUser{OrgID: orgID}

		w.reconcileOrganizationAt(sweeper, time.Now())

		t.Run("the late instance is still overdue rather than written off as missed", func(t *testing.T) { // FR-015
			// The 720-hour completion window is what buys this. With the default
			// 24 hours the instance would be rewritten to the closed Missed state
			// within five minutes of the seed landing, and would vanish from
			// Today, My Work and the Team block at once.
			assert.Equal(t, 1, countRows(t,
				`SELECT COUNT(*)
				 FROM collaboration.task t
				 JOIN collaboration.project_state ps ON (ps.organization_id, ps.id) = (t.organization_id, t.state_id)
				 JOIN public.organization o ON o.id = t.organization_id
				 WHERE o.subdomain = $1 AND t.task_kind = 'ritual_instance' AND NOT t.is_deleted
				   AND ps.category = 'overdue'`, subdomain))
		})

		t.Run("the generation sweep creates no further instances", func(t *testing.T) { // FR-017
			// A monthly rule and a one-day generation window leave the definition
			// live while producing no date inside the window.
			created := w.generateRitualInstances(sweeper)
			assert.Zero(t, created)
			assert.Equal(t, 2, countRows(t, countDemoRitualInstances, subdomain))
		})
	})

	t.Run("when the seed runs again", func(t *testing.T) {
		output := run()

		t.Run("it reuses the existing workspace rather than creating a second one", func(t *testing.T) { // FR-031
			assert.Contains(t, output, "Reusing existing demo workspace")
			assert.Equal(t, 1, countRows(t,
				`SELECT COUNT(*) FROM public.organization WHERE subdomain = $1`, subdomain))
		})

		t.Run("it refreshes the content rather than duplicating it", func(t *testing.T) { // FR-031
			assert.Equal(t, 6, countRows(t,
				`SELECT COUNT(*) FROM chat.message m
				 JOIN public.organization o ON o.id = m.organization_id
				 WHERE o.subdomain = $1`, subdomain), "a second run must not double the conversation")
		})

		t.Run("it leaves exactly one copy of each work item and each instance", func(t *testing.T) { // FR-019
			assert.Equal(t, 6, countRows(t, countDemoStandardTasks, subdomain))
			assert.Equal(t, 2, countRows(t, countDemoRitualInstances, subdomain))
			assert.Equal(t, 1, countRows(t,
				`SELECT COUNT(*) FROM collaboration.ritual_definition rd
				 JOIN public.organization o ON o.id = rd.organization_id
				 WHERE o.subdomain = $1`, subdomain))
		})

		t.Run("it leaves exactly two owner accounts rather than a third", func(t *testing.T) { // FR-001, FR-006
			assert.Equal(t, 2, countRows(t,
				`SELECT COUNT(*)
				 FROM iam.employee_role er
				 JOIN iam.role r ON (r.organization_id, r.id) = (er.organization_id, er.role_id)
				 JOIN organization.employee e ON (e.organization_id, e.id) = (er.organization_id, er.employee_id)
				 JOIN public.organization o ON o.id = er.organization_id
				 WHERE o.subdomain = $1 AND r.source_default_role_id = 'owner' AND e.is_active`, subdomain))
		})

		t.Run("the unassigned instance is dated for the current day", func(t *testing.T) { // FR-020
			// Every date derives from the instant of the run, so a re-seed the
			// morning of a resubmission produces content that reads as current.
			assert.Equal(t, 1, countRows(t, countDemoUnassignedInstances+` AND t.scheduled_date = CURRENT_DATE`, subdomain))
		})

		t.Run("the late instance is still dated so that it reads as late", func(t *testing.T) { // FR-020
			assert.Equal(t, 1, countRows(t,
				`SELECT COUNT(*)
				 FROM collaboration.task t
				 JOIN public.organization o ON o.id = t.organization_id
				 WHERE o.subdomain = $1 AND t.task_kind = 'ritual_instance' AND NOT t.is_deleted
				   AND t.scheduled_date < CURRENT_DATE AND t.completion_deadline < now()`, subdomain))
		})
	})

	// Feature 057, FR-006 and SC-003. The reviewer notes published to Apple and Google
	// promise this command can be re-run; before this feature it could not be, once a
	// reviewer had actually used the workspace. Refreshing the fixture ends in
	// `DELETE FROM chat.message`, and two dependents of chat.message were ON DELETE
	// RESTRICT and refused it outright: the read receipt a reviewer leaves by opening the
	// channel, and a posted voice recording. Neither is cleared by the work refresh that
	// runs first, so neither could be ordered around.
	//
	// The captured task is set up here too, for completeness, though it is not what broke
	// the seed: refreshDemoProjects empties the demo projects before the conversation is
	// touched, so the task is already gone by the time the message delete runs. Its
	// composite ON DELETE SET NULL is exercised by TestChatTaskCapture instead.
	//
	// The residue below is written straight to storage rather than driven through the
	// RPCs, because the demo accounts sign in by password and PIN and this test holds no
	// session for them. The rows are the ones those RPCs produce, and the constraints
	// under test do not care which statement wrote them. The RPC-driven version of the
	// same delete is TestChatTaskCapture's hard-delete block.
	t.Run("when a reviewer has used the workspace before the seed runs again", func(t *testing.T) { // FR-006, SC-003
		ctx := context.Background()
		orgID := demoOrgID(t, subdomain)

		var channelID, messageID, workerID dbuuid.UUID
		require.NoError(t, globalDB.QueryRow(ctx,
			`SELECT c.id, m.id, m.author_employee_id
			   FROM chat.channel c
			   JOIN chat.message m ON (m.organization_id, m.channel_id) = (c.organization_id, c.id)
			  WHERE c.organization_id = $1 AND c.title_slug = 'site-updates'
			  ORDER BY m.id
			  LIMIT 1`, orgID).Scan(&channelID, &messageID, &workerID),
			"the seeded demo conversation is what a reviewer reads")

		// The reviewer opens the channel: a read receipt points at the message.
		_, err := globalDB.Exec(ctx,
			`UPDATE chat.channel_membership SET last_viewed_message_id = $3, last_viewed_at = now()
			  WHERE organization_id = $1 AND channel_id = $2`, orgID, channelID, messageID)
		require.NoError(t, err)

		// The reviewer uses the chat quick action: one demo task now carries an origin.
		var capturedTaskID dbuuid.UUID
		require.NoError(t, globalDB.QueryRow(ctx,
			`UPDATE collaboration.task SET source_channel_id = $2, source_message_id = $3
			  WHERE organization_id = $1 AND task_kind = 'standard' AND NOT is_deleted
			    AND id = (SELECT id FROM collaboration.task
			               WHERE organization_id = $1 AND task_kind = 'standard' AND NOT is_deleted
			               ORDER BY id LIMIT 1)
			  RETURNING id`, orgID, channelID, messageID).Scan(&capturedTaskID))

		// The reviewer records a voice note: a posted recording hangs off a message,
		// and a posted recording is the state that also pins a file_metadata row.
		var fileID dbuuid.UUID
		require.NoError(t, globalDB.QueryRow(ctx,
			`INSERT INTO files.file_metadata
			     (organization_id, original_filename, storage_key, size_bytes, mime_type,
			      upload_context, uploaded_by_employee_id, validation_status)
			 VALUES ($1, 'reviewer-note.webm', 'demo/reviewer-note.webm', 2048, 'audio/webm',
			         'chat', $2, 'verified')
			 RETURNING id`, orgID, workerID).Scan(&fileID))
		_, err = globalDB.Exec(ctx,
			`INSERT INTO voice.voice_message
			     (organization_id, channel_id, sender_employee_id, message_id, file_id,
			      client_deduplication_key, status, duration_ms, mime_type, size_bytes, posted_at)
			 VALUES ($1, $2, $3, $4, $5, 'reviewer-note', 'posted', 3200, 'audio/webm', 2048, now())`,
			orgID, channelID, workerID, messageID, fileID)
		require.NoError(t, err)

		output, runErr := runResult()

		t.Run("the seed succeeds against the used workspace", func(t *testing.T) { // FR-006
			require.NoError(t, runErr, "seed-demo-org must survive having been used: %s", output)
			assert.Contains(t, output, "Reusing existing demo workspace")
		})

		t.Run("the conversation holds exactly one copy of the fixture", func(t *testing.T) { // SC-003
			assert.Equal(t, 6, countRows(t,
				`SELECT COUNT(*) FROM chat.message m
				   JOIN public.organization o ON o.id = m.organization_id
				  WHERE o.subdomain = $1`, subdomain))
		})

		t.Run("the read receipt and the voice recording gave way rather than blocking", func(t *testing.T) { // FR-005
			// These two are what actually blocked the re-run: both foreign keys were
			// ON DELETE RESTRICT, and neither row is cleared by the work refresh that
			// runs before the conversation is cleared.
			assert.Zero(t, countRows(t,
				`SELECT COUNT(*) FROM chat.channel_membership cm
				  WHERE cm.organization_id = $1 AND cm.last_viewed_message_id = $2`,
				orgID, messageID), "the read receipt is nulled, not left dangling")
			assert.Zero(t, countRows(t,
				`SELECT COUNT(*) FROM voice.voice_message vm
				  WHERE vm.organization_id = $1 AND vm.message_id = $2`,
				orgID, messageID), "the recording cascades with the message it lived in")
		})

		t.Run("every surviving task keeps its organization", func(t *testing.T) { // SC-003
			// The captured task itself is gone, and deliberately so: refreshDemoProjects
			// empties the demo projects outright, including anything a reviewer created
			// while looking around. What the origin columns had to survive is the delete,
			// not the refresh — and every surviving task keeps its organization.
			assert.Zero(t, countRows(t,
				`SELECT COUNT(*) FROM collaboration.task
				  WHERE organization_id = $1 AND id = $2`, orgID, capturedTaskID))
			assert.Equal(t, 6, countRows(t, countDemoStandardTasks, subdomain))
			assert.Equal(t, 6, countRows(t,
				countDemoStandardTasks+` AND t.organization_id IS NOT NULL`, subdomain),
				"the tenant column is what a bare composite SET NULL would have erased")
		})
	})

	t.Run("the demo PIN does not expire", func(t *testing.T) { // FR-033
		// The ordinary temporary PIN expires in three days and forces a change at
		// first sign-in. A reviewer reaching the demo a week after submission would
		// find a dead account.
		var state string
		var expiresAt *string
		require.NoError(t, globalDB.QueryRow(context.Background(),
			`SELECT c.state, c.expires_at::text
			 FROM iam.credential c
			 JOIN public.organization o ON o.id = c.organization_id
			 WHERE o.subdomain = $1 AND c.credential_type = 'pin'`, subdomain,
		).Scan(&state, &expiresAt))

		assert.Equal(t, "active", state, "a temporary PIN would force a change at first sign-in")
		assert.Nil(t, expiresAt, "the demo PIN must not expire before a review queue reaches it")
	})

	// Last, because it deliberately breaks the workspace the blocks above read.
	t.Run("when a demo project is missing a workflow state the seed needs", func(t *testing.T) { // FR-018
		ctx := context.Background()
		orgID := demoOrgID(t, subdomain)
		var opsID dbuuid.UUID
		require.NoError(t, globalDB.QueryRow(ctx,
			`SELECT id FROM collaboration.project WHERE organization_id = $1 AND key = 'OPS'`, orgID).Scan(&opsID))

		// The instances hold the state we are about to remove, so they go first.
		_, err := globalDB.Exec(ctx,
			`DELETE FROM collaboration.task WHERE organization_id = $1 AND project_id = $2`, orgID, opsID)
		require.NoError(t, err)
		removed, err := globalDB.Exec(ctx,
			`DELETE FROM collaboration.project_state
			 WHERE organization_id = $1 AND project_id = $2 AND category = 'overdue' AND state_type = 'ritual'`,
			orgID, opsID)
		require.NoError(t, err)
		require.Equal(t, int64(1), removed.RowsAffected())

		output, runErr := runResult()

		t.Run("the command fails naming the project and the missing category", func(t *testing.T) {
			// A half-shaped workspace that reaches a reviewer silently is the
			// failure this loudness exists to prevent.
			require.Error(t, runErr, "the seed must not report success on a project it could not shape")
			assert.Contains(t, output, "OPS")
			assert.Contains(t, output, "overdue")
		})
	})

}

// Shared count fragments. Each is a whole statement or a statement missing only a
// trailing predicate, so callers read as one question rather than as SQL assembly.
const (
	countDemoStandardTasks = `SELECT COUNT(*) FROM collaboration.task t
		 JOIN public.organization o ON o.id = t.organization_id
		 WHERE o.subdomain = $1 AND t.task_kind = 'standard' AND NOT t.is_deleted`

	countDemoRitualInstances = `SELECT COUNT(*) FROM collaboration.task t
		 JOIN public.organization o ON o.id = t.organization_id
		 WHERE o.subdomain = $1 AND t.task_kind = 'ritual_instance' AND NOT t.is_deleted`

	// The My Work / Today predicate: assigned, open, and carrying a due date.
	countDemoAssignedTasksDue = `SELECT COUNT(*) FROM collaboration.task t
		 JOIN collaboration.task_assignee ta ON (ta.organization_id, ta.task_id) = (t.organization_id, t.id)
		 JOIN collaboration.project_state ps ON (ps.organization_id, ps.id) = (t.organization_id, t.state_id)
		 JOIN public.organization o ON o.id = t.organization_id
		 WHERE o.subdomain = $1 AND ta.employee_id = $2 AND ta.role = 'assignee'
		   AND NOT t.is_deleted AND NOT ps.is_closed AND t.due_date IS NOT NULL`

	countDemoUnassignedInstances = `SELECT COUNT(*) FROM collaboration.task t
		 JOIN collaboration.project_state ps ON (ps.organization_id, ps.id) = (t.organization_id, t.state_id)
		 JOIN public.organization o ON o.id = t.organization_id
		 WHERE o.subdomain = $1 AND t.task_kind = 'ritual_instance' AND NOT t.is_deleted
		   AND NOT EXISTS (
		     SELECT 1 FROM collaboration.task_assignee ta
		     WHERE (ta.organization_id, ta.task_id) = (t.organization_id, t.id) AND ta.role = 'assignee'
		   )`
)

func countRows(t *testing.T, query string, args ...any) int {
	t.Helper()
	var count int
	require.NoError(t, globalDB.QueryRow(context.Background(), query, args...).Scan(&count))
	return count
}

func demoOrgID(t *testing.T, subdomain string) dbuuid.UUID {
	t.Helper()
	var orgID dbuuid.UUID
	require.NoError(t, globalDB.QueryRow(context.Background(),
		`SELECT id FROM public.organization WHERE subdomain = $1`, subdomain).Scan(&orgID))
	return orgID
}

type demoPerson struct {
	id      dbuuid.UUID
	label   string
	isOwner bool
}

// demoPeople returns the three accounts a reviewer can sign in as, so an
// assertion can be made once and applied to each rather than written three times.
func demoPeople(t *testing.T, subdomain string) []demoPerson {
	t.Helper()
	orgID := demoOrgID(t, subdomain)
	people := []demoPerson{
		{label: "the primary owner", isOwner: true},
		{label: "the spare owner", isOwner: true},
		{label: "the worker", isOwner: false},
	}
	emails := []string{
		fmt.Sprintf("owner@%s.demo.invalid", subdomain),
		fmt.Sprintf("spare@%s.demo.invalid", subdomain),
	}
	for i, email := range emails {
		require.NoError(t, globalDB.QueryRow(context.Background(),
			`SELECT id FROM organization.employee
			 WHERE organization_id = $1 AND email = $2 AND is_active`, orgID, email).Scan(&people[i].id),
			"seeded account %s is missing", email)
	}
	require.NoError(t, globalDB.QueryRow(context.Background(),
		`SELECT id FROM iam.identity WHERE organization_id = $1 AND login_identifier = 'demo-worker'`, orgID,
	).Scan(&people[2].id))
	return people
}

func demoToken(t *testing.T, employeeID, orgID dbuuid.UUID) string {
	t.Helper()
	token, _, _, err := globalSigner.GenerateTokenWithOrg(employeeID, "", orgID)
	require.NoError(t, err)
	return token
}

func findBackendDir(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	require.NoError(t, err)
	for {
		if _, statErr := os.Stat(filepath.Join(dir, "go.mod")); statErr == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		require.NotEqual(t, parent, dir, "could not find the backend module root")
		dir = parent
	}
}

func indexOf(haystack, needle string) int {
	return strings.Index(haystack, needle)
}

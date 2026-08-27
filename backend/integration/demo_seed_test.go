package integration

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
)

// TestDemoSeed covers the two properties of the reviewer's workspace that, if
// wrong, are discovered by a store reviewer rather than by us (FR-031, FR-033).
//
// The first is idempotency: this command is run again the morning of a
// resubmission, and a second "demo" organization nobody can find would be worse
// than no demo at all. The second is that the demo PIN does not expire — the
// ordinary temporary PIN dies after three days, long before a review queue
// reaches it.
func TestDemoSeed(t *testing.T) {
	if testing.Short() {
		t.Skip("seeding builds a whole workspace; skipped in short mode")
	}
	t.Parallel()

	subdomain := "seedtest" + dbuuid.Must().String()[:8]
	backendDir := findBackendDir(t)

	run := func() string {
		cmd := exec.Command("go", "run", "./cmd", "seed-demo-org", "--subdomain", subdomain)
		cmd.Dir = backendDir
		cmd.Env = os.Environ()
		out, err := cmd.CombinedOutput()
		require.NoError(t, err, "seed-demo-org failed: %s", out)
		return string(out)
	}

	t.Run("when the seed runs for the first time", func(t *testing.T) {
		output := run()

		t.Run("it creates the workspace", func(t *testing.T) { // FR-031
			assert.Contains(t, output, "Created demo workspace")
		})

		t.Run("it prints both credentials, self-registered owner first", func(t *testing.T) { // FR-032
			// The owner is printed first on purpose: it is the only account whose
			// settings show the full deletion path.
			ownerIdx := indexOf(output, "PRIMARY credential")
			workerIdx := indexOf(output, "SECOND credential")
			require.Positive(t, ownerIdx)
			require.Positive(t, workerIdx)
			assert.Less(t, ownerIdx, workerIdx)
		})

		t.Run("it produces at least one reportable message", func(t *testing.T) { // FR-031
			var count int
			require.NoError(t, globalDB.QueryRow(context.Background(),
				`SELECT COUNT(*) FROM chat.message m
				 JOIN public.organization o ON o.id = m.organization_id
				 WHERE o.subdomain = $1`, subdomain).Scan(&count))
			assert.Positive(t, count, "a reviewer testing the report flow needs something to report")
		})
	})

	t.Run("when the seed runs again", func(t *testing.T) {
		output := run()

		t.Run("it reuses the existing workspace rather than creating a second one", func(t *testing.T) { // FR-031
			assert.Contains(t, output, "Reusing existing demo workspace")
			var orgCount int
			require.NoError(t, globalDB.QueryRow(context.Background(),
				`SELECT COUNT(*) FROM public.organization WHERE subdomain = $1`, subdomain).Scan(&orgCount))
			assert.Equal(t, 1, orgCount)
		})

		t.Run("it refreshes the content rather than duplicating it", func(t *testing.T) { // FR-031
			var messageCount int
			require.NoError(t, globalDB.QueryRow(context.Background(),
				`SELECT COUNT(*) FROM chat.message m
				 JOIN public.organization o ON o.id = m.organization_id
				 WHERE o.subdomain = $1`, subdomain).Scan(&messageCount))
			assert.Equal(t, 6, messageCount, "a second run must not double the conversation")
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

	// The seeded organization is not registered with rememberOrg because it was
	// created by a subprocess, so remove it here.
	t.Cleanup(func() {
		if os.Getenv("TECH_OFFICE_KEEP_TEST_DATA") != "" {
			return
		}
		_, _ = globalDB.Exec(context.Background(),
			`SET LOCAL session_replication_role = 'replica'`)
		_, _ = globalDB.Exec(context.Background(),
			`DELETE FROM public.organization WHERE subdomain = $1`, subdomain)
	})
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
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return i
		}
	}
	return -1
}

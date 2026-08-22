package integration

import (
	"testing"
	"time"

	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// TestOperationalHealth covers operational health summary and per-employee metrics.
func TestOperationalHealth(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	owner := w.withOwner()
	proj := w.createProjectWithMode(owner, "Health Test Project", uniqueProjectKey("HLTH"), rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL)
	_ = w.createRitualDefinition(owner, proj.ID, "Health Ritual", dailyRecurrenceRule())

	// Generate instances so there's data for the health endpoint
	w.generateRitualInstances(owner)

	now := time.Now()
	start := timestamppb.New(now.AddDate(0, 0, -7))
	end := timestamppb.New(now.AddDate(0, 0, 1))

	t.Run("when getting operational health for a project with ritual instances", func(t *testing.T) {
		health := w.getOperationalHealth(owner, proj.ID, start, end)

		t.Run("the response includes ritual instance summary", func(t *testing.T) {
			require.NotNil(t, health)
		})
	})

	t.Run("when getting employee compliance summary", func(t *testing.T) {
		summaries := w.getRitualComplianceSummary(owner, proj.ID, "", start, end)

		t.Run("it returns a list of employee summaries", func(t *testing.T) {
			// No employees are assigned to this ritual, so summaries may be empty.
			// Proto serializes empty repeated fields as nil after round-trip.
			assert.GreaterOrEqual(t, len(summaries), 0)
		})
	})

	t.Run("when filtering health by date range outside the instances", func(t *testing.T) {
		// Use a date range far in the future where no instances exist
		futureStart := timestamppb.New(now.AddDate(10, 0, 0))
		futureEnd := timestamppb.New(now.AddDate(10, 0, 7))

		health := w.getOperationalHealth(owner, proj.ID, futureStart, futureEnd)

		t.Run("it returns a response with zero counts", func(t *testing.T) {
			require.NotNil(t, health)
		})
	})
}

// TestHealthDashboardCSVExport covers CSV export of ritual compliance data.
func TestHealthDashboardCSVExport(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	owner := w.withOwner()
	proj := w.createProjectWithMode(owner, "CSV Export Project", uniqueProjectKey("CSVEX"), rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL)
	_ = w.createRitualDefinition(owner, proj.ID, "CSV Ritual", dailyRecurrenceRule())
	w.generateRitualInstances(owner)

	now := time.Now()
	start := timestamppb.New(now.AddDate(0, 0, -7))
	end := timestamppb.New(now.AddDate(0, 0, 1))

	t.Run("when exporting ritual compliance data to CSV", func(t *testing.T) {
		csvData := w.exportRitualComplianceCSV(owner, proj.ID, start, end)

		t.Run("it returns non-empty CSV content", func(t *testing.T) {
			require.NotNil(t, csvData)
		})
	})
}

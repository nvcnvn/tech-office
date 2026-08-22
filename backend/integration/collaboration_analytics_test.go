package integration

import (
	"strings"
	"testing"

	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestTaskAnalytics covers analytics grouping, CSV export, and edge cases.
func TestTaskAnalytics(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	owner := w.withOwner()

	t.Run("when grouping tasks by state", func(t *testing.T) {
		proj := w.createProject(owner, "Analytics State", uniqueProjectKey("ANST"))
		level0 := levelByDepth(proj.Levels, 0)
		require.NotNil(t, level0)

		ipState := stateByCategory(proj.States, rpcv1.StateCategory_STATE_CATEGORY_IN_PROGRESS)
		require.NotNil(t, ipState)

		// Two tasks in todo, one in progress
		w.createTask(owner, proj.ID, "Todo 1", level0.Id)
		w.createTask(owner, proj.ID, "Todo 2", level0.Id)
		ipTask := w.createTask(owner, proj.ID, "IP Task", level0.Id)
		w.moveTask(owner, ipTask.Id, ipState.Id)

		resp := w.getTaskAnalytics(owner, proj.ID, []string{"state"})

		t.Run("the summary reflects total task count", func(t *testing.T) {
			require.NotNil(t, resp.Summary)
			assert.Equal(t, int32(3), resp.Summary.TotalTasks)
		})

		t.Run("rows are grouped by state", func(t *testing.T) {
			assert.NotEmpty(t, resp.Rows)
			totalFromRows := 0.0
			for _, row := range resp.Rows {
				if count, ok := row.Metrics["task_count"]; ok {
					totalFromRows += count
				}
			}
			assert.Equal(t, 3.0, totalFromRows)
		})
	})

	t.Run("when exporting tasks as CSV", func(t *testing.T) {
		proj := w.createProject(owner, "CSV Test", uniqueProjectKey("CSV"))
		level0 := levelByDepth(proj.Levels, 0)
		require.NotNil(t, level0)

		w.createTask(owner, proj.ID, "Export Me", level0.Id)

		csvBytes := w.exportTasksCSV(owner, proj.ID)

		t.Run("the output contains a header and data rows", func(t *testing.T) {
			csvStr := string(csvBytes)
			lines := strings.Split(strings.TrimSpace(csvStr), "\n")
			require.GreaterOrEqual(t, len(lines), 2, "should have header + at least one data row")
		})
	})

	t.Run("when querying an empty project", func(t *testing.T) {
		proj := w.createProject(owner, "Empty Analytics", uniqueProjectKey("EMPT"))
		resp := w.getTaskAnalytics(owner, proj.ID, []string{"state"})

		t.Run("the summary returns zeros", func(t *testing.T) {
			require.NotNil(t, resp.Summary)
			assert.Equal(t, int32(0), resp.Summary.TotalTasks)
		})

		t.Run("the rows are empty", func(t *testing.T) {
			assert.Empty(t, resp.Rows)
		})
	})
}

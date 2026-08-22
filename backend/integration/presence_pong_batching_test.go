package integration

import (
	"context"
	"testing"

	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/stretchr/testify/require"
)

// TestPresencePongBatchingPerformance is the quickstart performance validation (SC-008).
//
// The batcher is the single largest performance lever in the presence feature, and its
// failure mode is silent: everything still works, it just issues one statement per pong
// against the hottest write path in the system. A call count that tracks connection
// count 1:1 is exactly that failure.
//
// Skipped when pg_stat_statements is not loaded, since there is then no way to count
// statements. Enable it with shared_preload_libraries in backend/docker-compose.yml.
func TestPresencePongBatchingPerformance(t *testing.T) {
	w := newTestWorld(t)
	employee := w.withEmployee()

	before, ok := recordPongStatementCalls(t)
	if !ok {
		t.Skip("pg_stat_statements is not loaded; cannot count presence statements")
	}

	const connections = 200

	connIDs := make([]string, connections)
	for i := range connIDs {
		connIDs[i] = w.establishSSE(employee)
	}

	directives := w.sendPongsConcurrently(employee, connIDs)
	require.Len(t, directives, connections)
	for i, d := range directives {
		require.Equal(t, rpcv1.PongDirective_PONG_DIRECTIVE_ACK, d, "pong %d", i)
	}

	after, _ := recordPongStatementCalls(t)
	statements := after - before

	t.Logf("pongs=%d record_presence_pongs_statements=%d", connections, statements)

	require.Greater(t, statements, int64(0), "the batched statement never ran")
	require.Less(t, statements, int64(connections/4),
		"statement count is tracking connection count — the batcher is not batching")
}

// recordPongStatementCalls counts executions of the batched pong statement. The second
// return value is false when pg_stat_statements is unavailable.
func recordPongStatementCalls(t *testing.T) (int64, bool) {
	t.Helper()
	var calls int64
	err := globalDB.QueryRow(context.Background(),
		`SELECT COALESCE(sum(calls), 0) FROM pg_stat_statements
		  WHERE query ILIKE '%active_connection ac%' AND query ILIKE '%generate_subscripts%'`,
	).Scan(&calls)
	if err != nil {
		return 0, false
	}
	return calls, true
}

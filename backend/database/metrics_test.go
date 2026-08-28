package database

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Pools built against an unreachable DSN. MinConns is 0 so nothing dials — the
// pool is real, its statistics are real zeros, and the test needs no database.
// A hand-built &pgxpool.Stat{} cannot stand in: its embedded puddle stat is nil
// and every accessor panics.
func idlePool(t *testing.T) Statter {
	t.Helper()

	pool, err := newPool(t.Context(), testDSN, poolTuning{maxConns: 3}, nil)
	if err != nil {
		t.Fatalf("newPool: %v", err)
	}
	t.Cleanup(pool.Close)

	return pool
}

func TestMetricsHandlerExposition(t *testing.T) {
	h := MetricsHandler(map[string]Statter{
		"tenant": idlePool(t),
		"admin":  idlePool(t),
		"flow":   idlePool(t),
	})

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/metrics", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/plain") {
		t.Errorf("Content-Type = %q, want text/plain", ct)
	}

	body := rec.Body.String()

	t.Run("every pool is labelled and every metric declared", func(t *testing.T) {
		for _, m := range poolMetrics {
			if !strings.Contains(body, "# HELP "+m.name+" ") {
				t.Errorf("missing HELP for %s", m.name)
			}
			if !strings.Contains(body, "# TYPE "+m.name+" "+m.kind) {
				t.Errorf("missing TYPE for %s", m.name)
			}
			for _, pool := range []string{"admin", "flow", "tenant"} {
				if !strings.Contains(body, m.name+`{pool="`+pool+`"} `) {
					t.Errorf("missing sample %s for pool %q", m.name, pool)
				}
			}
		}
	})

	t.Run("samples of one metric stay contiguous", func(t *testing.T) {
		// Prometheus rejects a family whose samples are interleaved with another's.
		var families []string
		for _, line := range strings.Split(strings.TrimSpace(body), "\n") {
			if strings.HasPrefix(line, "#") {
				continue
			}
			name, _, ok := strings.Cut(line, "{")
			if !ok {
				t.Fatalf("unparsable sample line %q", line)
			}
			if len(families) == 0 || families[len(families)-1] != name {
				families = append(families, name)
			}
		}
		seen := make(map[string]bool, len(families))
		for _, name := range families {
			if seen[name] {
				t.Errorf("samples for %s are not contiguous", name)
			}
			seen[name] = true
		}
		if len(seen) != len(poolMetrics) {
			t.Errorf("emitted %d families, want %d", len(seen), len(poolMetrics))
		}
	})
}

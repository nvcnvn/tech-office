package database

import (
	"fmt"
	"io"
	"maps"
	"net/http"
	"slices"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Statter is anything that can report pgx pool statistics. All three pool types
// embed *pgxpool.Pool, so they satisfy it for free.
type Statter interface {
	Stat() *pgxpool.Stat
}

// poolMetrics is the Prometheus exposition of a pool's health. It is written by
// hand because the text format is a few lines of spec and client_golang ships no
// pgxpool collector — using it would mean writing a custom Collector anyway, which
// is more code than this, not less.
//
// EmptyAcquireCount is the one that answers "is the pool too small". It counts
// acquisitions that had to wait for a connection to come back. Near zero means the
// pool never ran dry and is not the constraint, whatever its size; a rising count
// paired with a rising acquire duration means callers are queueing for connections.
var poolMetrics = []struct {
	name  string
	kind  string
	help  string
	value func(*pgxpool.Stat) float64
}{
	{"pgxpool_max_conns", "gauge", "Configured ceiling on connections in this pool.",
		func(s *pgxpool.Stat) float64 { return float64(s.MaxConns()) }},
	{"pgxpool_total_conns", "gauge", "Connections currently open, idle plus acquired plus constructing.",
		func(s *pgxpool.Stat) float64 { return float64(s.TotalConns()) }},
	{"pgxpool_acquired_conns", "gauge", "Connections currently checked out by a caller.",
		func(s *pgxpool.Stat) float64 { return float64(s.AcquiredConns()) }},
	{"pgxpool_idle_conns", "gauge", "Connections open and available.",
		func(s *pgxpool.Stat) float64 { return float64(s.IdleConns()) }},
	{"pgxpool_constructing_conns", "gauge", "Connections currently being established.",
		func(s *pgxpool.Stat) float64 { return float64(s.ConstructingConns()) }},
	{"pgxpool_acquire_count_total", "counter", "Successful acquisitions.",
		func(s *pgxpool.Stat) float64 { return float64(s.AcquireCount()) }},
	{"pgxpool_empty_acquire_count_total", "counter", "Acquisitions that had to wait because the pool was empty.",
		func(s *pgxpool.Stat) float64 { return float64(s.EmptyAcquireCount()) }},
	{"pgxpool_canceled_acquire_count_total", "counter", "Acquisitions abandoned because the caller's context ended first.",
		func(s *pgxpool.Stat) float64 { return float64(s.CanceledAcquireCount()) }},
	{"pgxpool_acquire_duration_seconds_total", "counter", "Time spent waiting on acquisitions. Divide by acquire_count for the mean.",
		func(s *pgxpool.Stat) float64 { return s.AcquireDuration().Seconds() }},
	{"pgxpool_new_conns_count_total", "counter", "Connections established over the lifetime of the pool.",
		func(s *pgxpool.Stat) float64 { return float64(s.NewConnsCount()) }},
	{"pgxpool_max_lifetime_destroy_count_total", "counter", "Connections closed for reaching MaxConnLifetime.",
		func(s *pgxpool.Stat) float64 { return float64(s.MaxLifetimeDestroyCount()) }},
	{"pgxpool_max_idle_destroy_count_total", "counter", "Connections closed for reaching MaxConnIdleTime.",
		func(s *pgxpool.Stat) float64 { return float64(s.MaxIdleDestroyCount()) }},
}

// MetricsHandler exposes the pools in Prometheus text format, labelled by the map
// key. Serve it somewhere the public router cannot reach — Traefik sends all of
// API_DOMAIN to the backend, so this belongs on its own port.
func MetricsHandler(pools map[string]Statter) http.Handler {
	names := slices.Sorted(maps.Keys(pools))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Snapshot every pool first so one family is not read a scrape apart from
		// the next, then emit family by family: Prometheus requires all samples of
		// a metric to be contiguous.
		stats := make(map[string]*pgxpool.Stat, len(pools))
		for _, name := range names {
			stats[name] = pools[name].Stat()
		}

		var b strings.Builder
		for _, m := range poolMetrics {
			fmt.Fprintf(&b, "# HELP %s %s\n# TYPE %s %s\n", m.name, m.help, m.name, m.kind)
			for _, name := range names {
				fmt.Fprintf(&b, "%s{pool=%q} %g\n", m.name, name, m.value(stats[name]))
			}
		}

		w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
		io.WriteString(w, b.String())
	})
}

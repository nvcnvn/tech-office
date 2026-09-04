// Package search answers the workspace search box.
//
// One request, eight sources, one ranked list. This package owns NO SQL and no access
// rule of its own: it depends on the six domains' logic-layer interfaces and merges what
// they return (Constitution IV). Every source enforces its own access rules inside its
// own query, so the access rule for documents has exactly one implementation, used both
// by DocumentService.SearchDocuments and by SearchService.Search.
package search

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"sync"
	"time"

	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// Tuning. These live here rather than in the wire contract, so changing them is a
// one-line change and needs no contract change.
const (
	// perSourceCapMixed is what stops one source crowding the others out of the first
	// screen: eight sources x five hits fills the default mixed page exactly.
	perSourceCapMixed = 5

	mixedLimitDefault = 40
	mixedLimitMax     = 80

	// A narrowed list is deliberately four times deeper than the mixed list's per-source
	// cap, which is what "more of them than the mixed view showed" means.
	narrowedLimitDefault = 20
	narrowedLimitMax     = 50

	// The sources run concurrently, so the handler's floor is the slowest single source.
	// 800ms leaves ~200ms of headroom inside the 1s target for transport and render.
	perSourceDeadline = 800 * time.Millisecond
	overallBudget     = 900 * time.Millisecond

	// A one-character query would fan out to eight sources and match most of every
	// table. Both clients already gate at two; the handler enforces the same number so
	// the guarantee holds for every caller.
	minQueryLength = 2
	maxQueryLength = 200
)

// Params is one search, already authenticated and already clamped by the connect layer.
type Params struct {
	OrgID      dbuuid.UUID
	EmployeeID dbuuid.UUID

	// Query is trimmed and length-checked by the connect layer.
	Query string

	// KindFilter is SEARCH_KIND_UNSPECIFIED for the mixed list over every source, or one
	// kind to narrow to.
	KindFilter rpcv1.SearchKind

	// Limit is the total number of hits to return, already clamped.
	Limit int32

	// NotPermitted names the sources the caller may not search, mapped to the detail to
	// report. They are reported NOT_PERMITTED and are never queried — a permission gap
	// is a skip, not a failure.
	NotPermitted map[rpcv1.SearchKind]string
}

// SearchLogic is the fan-out. It never returns an error: a source that fails is reported
// in its own outcome, and deciding whether "every source failed" is an error is the
// connect layer's call.
type SearchLogic interface {
	Search(ctx context.Context, db database.DBTX, p Params) ([]*rpcv1.SearchHit, []*rpcv1.SourceOutcome)
}

type logicImpl struct {
	sources []source
}

// NewLogic builds the fan-out over the six domains' logic interfaces.
func NewLogic(deps Deps) SearchLogic {
	return &logicImpl{sources: buildSources(deps)}
}

// ClampLimit applies the mixed / narrowed defaults and maxima. Out-of-range values are
// clamped, never rejected.
func ClampLimit(limit int32, kindFilter rpcv1.SearchKind) int32 {
	def, max := int32(mixedLimitDefault), int32(mixedLimitMax)
	if kindFilter != rpcv1.SearchKind_SEARCH_KIND_UNSPECIFIED {
		def, max = int32(narrowedLimitDefault), int32(narrowedLimitMax)
	}
	if limit <= 0 {
		return def
	}
	if limit > max {
		return max
	}
	return limit
}

func (l *logicImpl) Search(ctx context.Context, db database.DBTX, p Params) ([]*rpcv1.SearchHit, []*rpcv1.SourceOutcome) {
	ctx, cancel := context.WithTimeout(ctx, overallBudget)
	defer cancel()

	narrowed := p.KindFilter != rpcv1.SearchKind_SEARCH_KIND_UNSPECIFIED

	perSource := int32(perSourceCapMixed)
	if narrowed {
		perSource = p.Limit
	}

	hitsBySource := make([][]*rpcv1.SearchHit, len(l.sources))
	outcomes := make([]*rpcv1.SourceOutcome, len(l.sources))

	var wg sync.WaitGroup
	for i, s := range l.sources {
		outcomes[i] = &rpcv1.SourceOutcome{Kind: s.kind}

		if narrowed && s.kind != p.KindFilter {
			// Not attempted, and saying OK-with-zero here would claim the source was
			// searched and matched nothing.
			outcomes[i].Detail = "not searched: narrowed to another kind"
			continue
		}
		if detail, denied := p.NotPermitted[s.kind]; denied {
			outcomes[i].Status = rpcv1.SourceStatus_SOURCE_STATUS_NOT_PERMITTED
			outcomes[i].Detail = detail
			continue
		}

		wg.Add(1)
		go func(i int, s source) {
			defer wg.Done()

			start := time.Now()
			sourceCtx, cancelSource := context.WithTimeout(ctx, perSourceDeadline)
			defer cancelSource()

			hits, err := s.fetchSafely(sourceCtx, db, sourceQuery{
				orgID:      p.OrgID,
				employeeID: p.EmployeeID,
				text:       p.Query,
				limit:      perSource,
			})
			if err != nil {
				slog.WarnContext(ctx, "search source failed",
					"kind", s.kind.String(),
					"error", err,
					"duration_ms", time.Since(start).Milliseconds(),
				)
				outcomes[i].Status = rpcv1.SourceStatus_SOURCE_STATUS_UNAVAILABLE
				outcomes[i].Detail = failureDetail(err)
				return
			}

			if int32(len(hits)) > perSource {
				hits = hits[:perSource]
			}
			for rank, h := range hits {
				h.Rank = int32(rank)
			}
			hitsBySource[i] = hits
			outcomes[i].Status = rpcv1.SourceStatus_SOURCE_STATUS_OK
		}(i, s)
	}
	wg.Wait()

	merged := l.merge(hitsBySource, p.Limit)

	// hit_count counts only what is actually in the response, after capping and after
	// the total truncation — never a pre-filter total, because a count of withheld
	// results discloses the existence of work the caller may not know about.
	counts := make(map[rpcv1.SearchKind]int32, len(l.sources))
	for _, h := range merged {
		counts[h.Kind]++
	}
	for i, o := range outcomes {
		if o.Status == rpcv1.SourceStatus_SOURCE_STATUS_OK {
			outcomes[i].HitCount = counts[o.Kind]
		}
	}

	return merged, outcomes
}

// merge is a pure function of the per-source result slices: round-robin by within-source
// rank, with the fixed source priority breaking ties.
//
// The eight matchers produce scores on incomparable scales, so there is no cross-source
// relevance number to sort by. Round-robin by rank needs none, is deterministic — the
// key ends in an id, so the order is total — and directly gives every source's best hit
// a place ahead of any source's second-best, so one matching document sits inside the
// first screen even against a hundred matching messages.
func (l *logicImpl) merge(hitsBySource [][]*rpcv1.SearchHit, limit int32) []*rpcv1.SearchHit {
	type ranked struct {
		hit      *rpcv1.SearchHit
		priority int
		id       string
	}

	var all []ranked
	for i, hits := range hitsBySource {
		for _, h := range hits {
			all = append(all, ranked{hit: h, priority: l.sources[i].priority, id: TargetID(h)})
		}
	}

	sort.Slice(all, func(a, b int) bool {
		x, y := all[a], all[b]
		if x.hit.Rank != y.hit.Rank {
			return x.hit.Rank < y.hit.Rank
		}
		if x.priority != y.priority {
			return x.priority < y.priority
		}
		if x.hit.Kind != y.hit.Kind {
			return x.hit.Kind < y.hit.Kind
		}
		return x.id < y.id
	})

	if int32(len(all)) > limit {
		all = all[:limit]
	}

	out := make([]*rpcv1.SearchHit, len(all))
	for i, r := range all {
		out[i] = r.hit
	}
	return out
}

// failureDetail keeps the reason short and non-sensitive: it is shown to the person
// searching, so it must never carry a query, an identifier or a driver message.
func failureDetail(err error) string {
	if errors.Is(err, context.DeadlineExceeded) {
		return "timed out"
	}
	return "could not be searched"
}

// fetchSafely runs one source's adapter and turns a panicking adapter into that source's
// own failure rather than the whole search's.
func (s source) fetchSafely(ctx context.Context, db database.DBTX, q sourceQuery) (hits []*rpcv1.SearchHit, err error) {
	defer func() {
		if r := recover(); r != nil {
			hits, err = nil, fmt.Errorf("panic in %s source: %v", s.kind.String(), r)
		}
	}()
	return s.fetch(ctx, db, q)
}

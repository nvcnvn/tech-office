package search

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/nvcnvn/tech-office/backend/database"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// The partial-failure behaviour is asserted here rather than in
// backend/integration/federated_search_test.go because there is no way to make one
// source fail through the RPC surface: every source is a healthy query against a healthy
// database, and PGroonga accepts even malformed query syntax rather than erroring. Making
// a source fail on demand means substituting the adapter, which is what this test does.

func fakeSource(kind rpcv1.SearchKind, fetch adapter) source {
	return source{kind: kind, fetch: fetch}
}

func hitsFor(kind rpcv1.SearchKind, n int) adapter {
	return func(context.Context, database.DBTX, sourceQuery) ([]*rpcv1.SearchHit, error) {
		hits := make([]*rpcv1.SearchHit, 0, n)
		for i := range n {
			hits = append(hits, &rpcv1.SearchHit{
				Kind:   kind,
				Title:  string(rune('a' + i)),
				Target: &rpcv1.SearchTarget{EmployeeId: string(rune('a' + i)), DocumentSlug: string(rune('a' + i))},
			})
		}
		return hits, nil
	}
}

func alwaysFails(context.Context, database.DBTX, sourceQuery) ([]*rpcv1.SearchHit, error) {
	return nil, errors.New("boom")
}

func alwaysPanics(context.Context, database.DBTX, sourceQuery) ([]*rpcv1.SearchHit, error) {
	panic("adapter exploded")
}

func neverReturns(ctx context.Context, _ database.DBTX, _ sourceQuery) ([]*rpcv1.SearchHit, error) {
	<-ctx.Done()
	return nil, ctx.Err()
}

func withSources(srcs ...source) *logicImpl {
	for i := range srcs {
		srcs[i].priority = i
	}
	return &logicImpl{sources: srcs}
}

func outcome(outcomes []*rpcv1.SourceOutcome, kind rpcv1.SearchKind) *rpcv1.SourceOutcome {
	for _, o := range outcomes {
		if o.GetKind() == kind {
			return o
		}
	}
	return nil
}

func TestFanOutPartialFailure(t *testing.T) {
	t.Parallel()

	params := Params{Query: "zarquon", Limit: 40}

	t.Run("when one source fails the others still answer", func(t *testing.T) {
		t.Parallel()
		l := withSources(
			fakeSource(rpcv1.SearchKind_SEARCH_KIND_PERSON, hitsFor(rpcv1.SearchKind_SEARCH_KIND_PERSON, 2)),
			fakeSource(rpcv1.SearchKind_SEARCH_KIND_DOCUMENT, alwaysFails),
		)

		hits, outcomes := l.Search(context.Background(), nil, params)

		if len(hits) != 2 {
			t.Fatalf("healthy source lost its hits: got %d, want 2", len(hits))
		}
		if got := outcome(outcomes, rpcv1.SearchKind_SEARCH_KIND_PERSON).GetStatus(); got != rpcv1.SourceStatus_SOURCE_STATUS_OK {
			t.Errorf("person outcome = %s, want OK", got)
		}
		failed := outcome(outcomes, rpcv1.SearchKind_SEARCH_KIND_DOCUMENT)
		if failed.GetStatus() != rpcv1.SourceStatus_SOURCE_STATUS_UNAVAILABLE {
			t.Errorf("document outcome = %s, want UNAVAILABLE", failed.GetStatus())
		}
		if failed.GetDetail() == "" {
			t.Error("an UNAVAILABLE outcome with no detail is silently short after all")
		}
	})

	t.Run("a panicking adapter costs only its own source", func(t *testing.T) {
		t.Parallel()
		l := withSources(
			fakeSource(rpcv1.SearchKind_SEARCH_KIND_PERSON, hitsFor(rpcv1.SearchKind_SEARCH_KIND_PERSON, 1)),
			fakeSource(rpcv1.SearchKind_SEARCH_KIND_MESSAGE, alwaysPanics),
		)

		hits, outcomes := l.Search(context.Background(), nil, params)

		if len(hits) != 1 {
			t.Fatalf("got %d hits, want 1", len(hits))
		}
		if got := outcome(outcomes, rpcv1.SearchKind_SEARCH_KIND_MESSAGE).GetStatus(); got != rpcv1.SourceStatus_SOURCE_STATUS_UNAVAILABLE {
			t.Errorf("message outcome = %s, want UNAVAILABLE", got)
		}
	})

	t.Run("a source past its deadline does not delay the answer", func(t *testing.T) {
		t.Parallel()
		l := withSources(
			fakeSource(rpcv1.SearchKind_SEARCH_KIND_PERSON, hitsFor(rpcv1.SearchKind_SEARCH_KIND_PERSON, 1)),
			fakeSource(rpcv1.SearchKind_SEARCH_KIND_EVENT, neverReturns),
		)

		start := time.Now()
		hits, outcomes := l.Search(context.Background(), nil, params)
		elapsed := time.Since(start)

		if elapsed > overallBudget+200*time.Millisecond {
			t.Errorf("search took %s, over the %s budget", elapsed, overallBudget)
		}
		if len(hits) != 1 {
			t.Fatalf("got %d hits, want the healthy source's 1", len(hits))
		}
		stuck := outcome(outcomes, rpcv1.SearchKind_SEARCH_KIND_EVENT)
		if stuck.GetStatus() != rpcv1.SourceStatus_SOURCE_STATUS_UNAVAILABLE {
			t.Errorf("event outcome = %s, want UNAVAILABLE", stuck.GetStatus())
		}
		if stuck.GetDetail() != "timed out" {
			t.Errorf("event detail = %q, want %q", stuck.GetDetail(), "timed out")
		}
	})

	t.Run("a source that matches nothing is OK with zero, not UNAVAILABLE", func(t *testing.T) {
		t.Parallel()
		l := withSources(fakeSource(rpcv1.SearchKind_SEARCH_KIND_DOCUMENT, hitsFor(rpcv1.SearchKind_SEARCH_KIND_DOCUMENT, 0)))

		_, outcomes := l.Search(context.Background(), nil, params)

		o := outcome(outcomes, rpcv1.SearchKind_SEARCH_KIND_DOCUMENT)
		if o.GetStatus() != rpcv1.SourceStatus_SOURCE_STATUS_OK || o.GetHitCount() != 0 {
			t.Errorf("got %s/%d, want OK/0 — 'no documents match' is not 'documents could not be searched'",
				o.GetStatus(), o.GetHitCount())
		}
	})

	t.Run("every source reports an outcome even when every one of them fails", func(t *testing.T) {
		t.Parallel()
		l := withSources(
			fakeSource(rpcv1.SearchKind_SEARCH_KIND_PERSON, alwaysFails),
			fakeSource(rpcv1.SearchKind_SEARCH_KIND_DOCUMENT, alwaysFails),
		)

		hits, outcomes := l.Search(context.Background(), nil, params)

		if len(hits) != 0 {
			t.Fatalf("got %d hits from two failing sources", len(hits))
		}
		for _, o := range outcomes {
			if o.GetStatus() != rpcv1.SourceStatus_SOURCE_STATUS_UNAVAILABLE {
				t.Errorf("%s = %s, want UNAVAILABLE", o.GetKind(), o.GetStatus())
			}
		}
	})

	t.Run("a not-permitted source is never queried and never fails", func(t *testing.T) {
		t.Parallel()
		queried := false
		l := withSources(fakeSource(rpcv1.SearchKind_SEARCH_KIND_DOCUMENT,
			func(context.Context, database.DBTX, sourceQuery) ([]*rpcv1.SearchHit, error) {
				queried = true
				return nil, nil
			}))

		p := params
		p.NotPermitted = map[rpcv1.SearchKind]string{
			rpcv1.SearchKind_SEARCH_KIND_DOCUMENT: "missing permission docs.view",
		}
		_, outcomes := l.Search(context.Background(), nil, p)

		if queried {
			t.Error("a source the caller may not search was queried anyway")
		}
		o := outcome(outcomes, rpcv1.SearchKind_SEARCH_KIND_DOCUMENT)
		if o.GetStatus() != rpcv1.SourceStatus_SOURCE_STATUS_NOT_PERMITTED {
			t.Errorf("got %s, want NOT_PERMITTED", o.GetStatus())
		}
	})
}

func TestMergeRoundRobin(t *testing.T) {
	t.Parallel()

	t.Run("every source's best hit precedes any source's second-best", func(t *testing.T) {
		t.Parallel()
		// One document against many messages: the document must not be pushed off the
		// first screen.
		l := withSources(
			fakeSource(rpcv1.SearchKind_SEARCH_KIND_MESSAGE, hitsFor(rpcv1.SearchKind_SEARCH_KIND_MESSAGE, 5)),
			fakeSource(rpcv1.SearchKind_SEARCH_KIND_DOCUMENT, hitsFor(rpcv1.SearchKind_SEARCH_KIND_DOCUMENT, 1)),
		)

		hits, _ := l.Search(context.Background(), nil, Params{Query: "z", Limit: 40})

		if len(hits) < 2 || hits[1].GetKind() != rpcv1.SearchKind_SEARCH_KIND_DOCUMENT {
			t.Fatalf("the single document did not land in the first two rows: %v", kinds(hits))
		}
	})

	t.Run("no source contributes more than the per-source cap to a mixed list", func(t *testing.T) {
		t.Parallel()
		l := withSources(fakeSource(rpcv1.SearchKind_SEARCH_KIND_MESSAGE, hitsFor(rpcv1.SearchKind_SEARCH_KIND_MESSAGE, 20)))

		hits, outcomes := l.Search(context.Background(), nil, Params{Query: "z", Limit: 40})

		if len(hits) != perSourceCapMixed {
			t.Errorf("got %d hits, want the per-source cap of %d", len(hits), perSourceCapMixed)
		}
		if got := outcome(outcomes, rpcv1.SearchKind_SEARCH_KIND_MESSAGE).GetHitCount(); got != perSourceCapMixed {
			t.Errorf("hit_count = %d, want %d — it counts what was returned", got, perSourceCapMixed)
		}
	})

	t.Run("narrowing to one kind skips the per-source cap and queries only that source", func(t *testing.T) {
		t.Parallel()
		l := withSources(
			fakeSource(rpcv1.SearchKind_SEARCH_KIND_MESSAGE, hitsFor(rpcv1.SearchKind_SEARCH_KIND_MESSAGE, 20)),
			fakeSource(rpcv1.SearchKind_SEARCH_KIND_PERSON, alwaysFails),
		)

		hits, outcomes := l.Search(context.Background(), nil, Params{
			Query:      "z",
			KindFilter: rpcv1.SearchKind_SEARCH_KIND_MESSAGE,
			Limit:      narrowedLimitDefault,
		})

		if len(hits) != narrowedLimitDefault {
			t.Errorf("got %d hits, want the narrowed default of %d", len(hits), narrowedLimitDefault)
		}
		if got := outcome(outcomes, rpcv1.SearchKind_SEARCH_KIND_PERSON).GetStatus(); got == rpcv1.SourceStatus_SOURCE_STATUS_UNAVAILABLE {
			t.Error("a source outside the narrowing was queried and failed")
		}
	})

	t.Run("the same inputs produce the same order every time", func(t *testing.T) {
		t.Parallel()
		build := func() *logicImpl {
			return withSources(
				fakeSource(rpcv1.SearchKind_SEARCH_KIND_PERSON, hitsFor(rpcv1.SearchKind_SEARCH_KIND_PERSON, 3)),
				fakeSource(rpcv1.SearchKind_SEARCH_KIND_DOCUMENT, hitsFor(rpcv1.SearchKind_SEARCH_KIND_DOCUMENT, 3)),
				fakeSource(rpcv1.SearchKind_SEARCH_KIND_MESSAGE, hitsFor(rpcv1.SearchKind_SEARCH_KIND_MESSAGE, 3)),
			)
		}
		first, _ := build().Search(context.Background(), nil, Params{Query: "z", Limit: 40})
		for range 5 {
			again, _ := build().Search(context.Background(), nil, Params{Query: "z", Limit: 40})
			if len(first) != len(again) {
				t.Fatalf("length changed between runs")
			}
			for i := range first {
				if first[i].GetKind() != again[i].GetKind() || first[i].GetTitle() != again[i].GetTitle() {
					t.Fatalf("order changed at %d: %v vs %v", i, kinds(first), kinds(again))
				}
			}
		}
	})
}

func TestClampLimit(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name  string
		limit int32
		kind  rpcv1.SearchKind
		want  int32
	}{
		{"mixed default", 0, rpcv1.SearchKind_SEARCH_KIND_UNSPECIFIED, mixedLimitDefault},
		{"mixed clamped up from negative", -5, rpcv1.SearchKind_SEARCH_KIND_UNSPECIFIED, mixedLimitDefault},
		{"mixed clamped down", 5000, rpcv1.SearchKind_SEARCH_KIND_UNSPECIFIED, mixedLimitMax},
		{"mixed honoured", 12, rpcv1.SearchKind_SEARCH_KIND_UNSPECIFIED, 12},
		{"narrowed default", 0, rpcv1.SearchKind_SEARCH_KIND_DOCUMENT, narrowedLimitDefault},
		{"narrowed clamped down", 5000, rpcv1.SearchKind_SEARCH_KIND_DOCUMENT, narrowedLimitMax},
	}
	for _, c := range cases {
		if got := ClampLimit(c.limit, c.kind); got != c.want {
			t.Errorf("%s: ClampLimit(%d, %s) = %d, want %d", c.name, c.limit, c.kind, got, c.want)
		}
	}
}

func kinds(hits []*rpcv1.SearchHit) []string {
	out := make([]string, 0, len(hits))
	for _, h := range hits {
		out = append(out, h.GetKind().String()+"/"+h.GetTitle())
	}
	return out
}

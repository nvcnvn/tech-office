package notification

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/tech-office/backend/database"
	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/database/txn"
)

// PongDirective is what the server tells a client after recording its pong.
type PongDirective int

const (
	// PongDirectiveACK — pong recorded; carry on.
	PongDirectiveACK PongDirective = iota
	// PongDirectiveReconnect — this connection no longer exists server-side (removed
	// after prolonged silence, or lost to UNLOGGED-table recovery). The client must
	// close its stream and re-establish. A removed connection is never resurrected
	// by a late pong.
	PongDirectiveReconnect
)

// PongRecord is one client's answer to a presence ping.
type PongRecord struct {
	OrganizationID    dbuuid.UUID
	EmployeeID        dbuuid.UUID
	ConnectionID      dbuuid.UUID
	Status            string
	ActiveChannelID   dbuuid.NullUUID
	LastInteractionAt pgtype.Timestamptz
	// Departing marks a deliberate teardown: the connection is removed in this same
	// flush rather than waiting out the responsive window.
	Departing bool
}

// ErrPongBatcherClosed is returned when a pong arrives after the batcher has drained.
var ErrPongBatcherClosed = errors.New("pong batcher is shut down")

const (
	// defaultPongFlushInterval is the batch window. At the 10k-connection design target
	// pongs arrive at roughly 500/s across the fleet; coalescing them into one statement
	// per organization per tick cuts presence write volume by roughly 30x. The cost is
	// up to one window of latency on a background protocol message nobody waits on.
	defaultPongFlushInterval = 200 * time.Millisecond
	// defaultPongMaxBatch flushes early when the queue fills, so a burst does not sit
	// out the whole window.
	defaultPongMaxBatch = 500
	// pongQueueDepth bounds memory when the database is slower than pongs arrive.
	pongQueueDepth = 4096
)

type pongResult struct {
	directive PongDirective
	err       error
}

type pongRequest struct {
	record PongRecord
	result chan pongResult
}

// pongBatcher coalesces the pongs arriving at one instance into one multi-row UPDATE
// per organization per flush tick.
//
// Every waiting RPC awaits its own result rather than firing and forgetting, which is
// what lets the handler answer authoritatively that a connection no longer exists.
// It also keeps the batcher constitutional (Principle XI): nothing here outlives the
// request that put it there, so this is not a process-local cache and no state is lost
// on instance death beyond requests that were already failing.
type pongBatcher struct {
	pool     database.AdminDatabaseConnector
	presence PresenceLogic

	flushInterval time.Duration
	maxBatch      int

	queue   chan *pongRequest
	stopped chan struct{}
	drained chan struct{}
}

func newPongBatcher(pool database.AdminDatabaseConnector, presence PresenceLogic) *pongBatcher {
	return &pongBatcher{
		pool:          pool,
		presence:      presence,
		flushInterval: defaultPongFlushInterval,
		maxBatch:      defaultPongMaxBatch,
		queue:         make(chan *pongRequest, pongQueueDepth),
		stopped:       make(chan struct{}),
		drained:       make(chan struct{}),
	}
}

// Start launches the flush loop. It returns immediately; call Stop to drain.
func (b *pongBatcher) Start(ctx context.Context) {
	go b.run(ctx)
}

// Stop signals the flush loop to drain what it holds and waits for it.
func (b *pongBatcher) Stop() {
	select {
	case <-b.stopped:
	default:
		close(b.stopped)
	}
	<-b.drained
}

// Submit enqueues a pong and blocks until its flush resolves it.
func (b *pongBatcher) Submit(ctx context.Context, record PongRecord) (PongDirective, error) {
	req := &pongRequest{record: record, result: make(chan pongResult, 1)}

	select {
	case b.queue <- req:
	case <-b.stopped:
		return PongDirectiveACK, ErrPongBatcherClosed
	case <-ctx.Done():
		return PongDirectiveACK, ctx.Err()
	}

	select {
	case res := <-req.result:
		return res.directive, res.err
	case <-ctx.Done():
		return PongDirectiveACK, ctx.Err()
	}
}

func (b *pongBatcher) run(ctx context.Context) {
	defer close(b.drained)

	ticker := time.NewTicker(b.flushInterval)
	defer ticker.Stop()

	pending := make([]*pongRequest, 0, b.maxBatch)

	flush := func(flushCtx context.Context) {
		if len(pending) == 0 {
			return
		}
		b.flush(flushCtx, pending)
		pending = pending[:0]
	}

	for {
		select {
		case <-ctx.Done():
			b.drain(pending)
			return

		case <-b.stopped:
			// Graceful shutdown: flush what is held and resolve anything already queued
			// so no in-flight RPC is left waiting.
			drainCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
			flush(drainCtx)
			for {
				select {
				case req := <-b.queue:
					pending = append(pending, req)
					continue
				default:
				}
				break
			}
			flush(drainCtx)
			cancel()
			return

		case req := <-b.queue:
			pending = append(pending, req)
			if len(pending) >= b.maxBatch {
				flush(ctx)
			}

		case <-ticker.C:
			flush(ctx)
		}
	}
}

// drain resolves outstanding waiters without touching the database. Used when the
// service context is already cancelled, where a flush would fail anyway.
func (b *pongBatcher) drain(pending []*pongRequest) {
	for _, req := range pending {
		req.result <- pongResult{err: ErrPongBatcherClosed}
	}
	for {
		select {
		case req := <-b.queue:
			req.result <- pongResult{err: ErrPongBatcherClosed}
		default:
			return
		}
	}
}

// flush groups the batch by organization — Citus shard locality is mandatory, so a
// cross-organization multi-row update is never issued — and resolves each waiter from
// the RETURNING set of its group's statement.
func (b *pongBatcher) flush(ctx context.Context, pending []*pongRequest) {
	byOrg := make(map[dbuuid.UUID][]*pongRequest, 1)
	for _, req := range pending {
		byOrg[req.record.OrganizationID] = append(byOrg[req.record.OrganizationID], req)
	}

	for orgID, group := range byOrg {
		b.flushOrganization(ctx, orgID, group)
	}
}

func (b *pongBatcher) flushOrganization(ctx context.Context, orgID dbuuid.UUID, group []*pongRequest) {
	started := time.Now()

	records := make([]PongRecord, len(group))
	for i, req := range group {
		records[i] = req.record
	}

	var matched []dbuuid.UUID
	err := txn.WithTxn(ctx, b.pool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		matched, txErr = b.presence.RecordPongs(ctx, tx, orgID, records)
		if txErr != nil {
			return txErr
		}

		departing := make([]PongRecord, 0, len(records))
		for _, rec := range records {
			if rec.Departing {
				departing = append(departing, rec)
			}
		}
		if len(departing) == 0 {
			return nil
		}
		_, txErr = b.presence.RemoveDepartedConnections(ctx, tx, orgID, departing)
		return txErr
	})
	if err != nil {
		slog.ErrorContext(ctx, "presence pong flush failed",
			"function", "pongBatcher.flush",
			"organization_id", orgID.String(),
			"batch_size", len(group),
			"error", err,
		)
		for _, req := range group {
			req.result <- pongResult{err: fmt.Errorf("failed to record presence pong: %w", err)}
		}
		return
	}

	matchedSet := make(map[dbuuid.UUID]struct{}, len(matched))
	for _, id := range matched {
		matchedSet[id] = struct{}{}
	}

	reconnects := 0
	for _, req := range group {
		if _, ok := matchedSet[req.record.ConnectionID]; ok {
			req.result <- pongResult{directive: PongDirectiveACK}
			continue
		}
		reconnects++
		req.result <- pongResult{directive: PongDirectiveReconnect}
	}

	// FR-025: batch size, flush duration, matched count and reconnect-directive count
	// are the four numbers a production presence incident is diagnosed from.
	flushDuration := time.Since(started)
	slog.DebugContext(ctx, "presence pong batch flushed",
		"function", "pongBatcher.flush",
		"organization_id", orgID.String(),
		"batch_size", len(group),
		"flush_duration_ms", flushDuration.Milliseconds(),
		"matched_count", len(matchedSet),
		"reconnect_count", reconnects,
	)
	if flushDuration > b.flushInterval {
		slog.WarnContext(ctx, "presence pong flush exceeded its batch window",
			"function", "pongBatcher.flush",
			"organization_id", orgID.String(),
			"batch_size", len(group),
			"flush_duration_ms", flushDuration.Milliseconds(),
			"flush_window_ms", b.flushInterval.Milliseconds(),
		)
	}
}

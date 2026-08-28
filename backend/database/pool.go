package database

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nvcnvn/tech-office/backend/internal/interceptor"
)

// Each replica opens three pools, and they are not interchangeable: tenant and
// admin are both on the request path, flow belongs to one background worker.
// pgx would default every one of them to max(4, NumCPU) — 12 on a 12-thread box,
// or 108 connections fleet-wide mid-update, for six cores.
//
// The fleet-wide worst case is (tenant + admin + flow) * (BACKEND_REPLICAS + 1),
// the +1 being the extra replica a start-first rolling update briefly runs. That
// has to stay under PG_MAX_CONNECTIONS with room left for postgres-exporter,
// pgBackRest, the migration job and a human with psql. See deploy/README.md.
var (
	// Every authenticated RPC that reads or writes tenant data: chat, docs,
	// calendar, collaboration, voice, compliance. The widest surface, so the
	// highest ceiling, and kept warm because it is hit first on a cold replica.
	tenantPoolTuning = poolTuning{maxConns: 8, minConns: 2}

	// Permission lookups on every request plus the notification/push background
	// loops. Acquisitions are short but constant. One connection is held forever
	// by the notification LISTEN loop and never returns to the pool, so minConns
	// of 2 leaves exactly one warm connection for everyone else.
	adminPoolTuning = poolTuning{maxConns: 6, minConns: 2}

	// One flows worker per replica, polling on a ticker, plus its own permanently
	// held LISTEN connection. It is never a burst source, so it gets the smallest
	// ceiling and the longest idle window — recycling a poller's connection every
	// five minutes is churn with nothing to show for it.
	flowPoolTuning = poolTuning{maxConns: 3, minConns: 1, maxConnIdle: 30 * time.Minute, maxConnLifetime: time.Hour}
)

// poolTuning is the per-pool sizing policy. Zero-valued durations fall back to
// the request-path defaults in apply.
type poolTuning struct {
	maxConns        int32
	minConns        int32
	maxConnIdle     time.Duration
	maxConnLifetime time.Duration
}

func (t poolTuning) apply(config *pgxpool.Config) {
	config.MaxConns = t.maxConns
	config.MinConns = t.minConns

	config.MaxConnIdleTime = t.maxConnIdle
	if config.MaxConnIdleTime == 0 {
		config.MaxConnIdleTime = 5 * time.Minute
	}
	// Recycle so a replica that drifts (a bloated prepared-statement cache, a
	// stale plan) heals itself. Jitter keeps the replicas from reconnecting in
	// lockstep after a deploy.
	config.MaxConnLifetime = t.maxConnLifetime
	if config.MaxConnLifetime == 0 {
		config.MaxConnLifetime = 30 * time.Minute
	}
	config.MaxConnLifetimeJitter = config.MaxConnLifetime / 6
}

type AdminDatabaseConnector interface {
	DBTX
	Begin(ctx context.Context) (pgx.Tx, error)
	Ping(ctx context.Context) error
	Close()
	isAdminPooler()
}

type AdminPool struct {
	*pgxpool.Pool
}

func (p *AdminPool) isAdminPooler() {}

type TenantDatabaseConnector interface {
	DBTX
	Begin(ctx context.Context) (pgx.Tx, error)
	Ping(ctx context.Context) error
	Close()
	isTenantPooler()
}

type TenantPool struct {
	*pgxpool.Pool
}

func (p *TenantPool) isTenantPooler() {}

// NewTenantPool creates RLS tenant-aware database connection from context, should be for authenticated users requests
func NewTenantPool(ctx context.Context, dsl string) (TenantDatabaseConnector, error) {
	beforeAcquire := func(ctx context.Context, c *pgx.Conn) bool {
		userOrgID, foundUserOrgID := interceptor.UserOrgIDFromContext(ctx)
		_ = uuid.MustParse(userOrgID)
		return foundUserOrgID
	}

	pool, err := newPool(ctx, dsl, tenantPoolTuning, beforeAcquire)
	if err != nil {
		return nil, err
	}

	return &TenantPool{Pool: pool}, nil
}

// NewAdminPool creates a database connection pool without tenant context, can query anything
func NewAdminPool(ctx context.Context, dsl string) (AdminDatabaseConnector, error) {
	beforeAcquire := func(ctx context.Context, c *pgx.Conn) bool {
		return true
	}

	pool, err := newPool(ctx, dsl, adminPoolTuning, beforeAcquire)
	if err != nil {
		return nil, err
	}

	return &AdminPool{Pool: pool}, nil
}

// NewFlowPool creates the pool the flows worker owns. It takes no BeforeAcquire:
// workflow rows are not tenant-scoped and the worker runs outside any request.
func NewFlowPool(ctx context.Context, dsl string) (*pgxpool.Pool, error) {
	return newPool(ctx, dsl, flowPoolTuning, nil)
}

// poolConfig parses the DSN and applies a pool's sizing policy. The sizing lives
// here rather than in the DSN because the migration container hands that same
// DATABASE_URL to psql, and libpq rejects pgx's pool_* query parameters.
func poolConfig(dsl string, tuning poolTuning) (*pgxpool.Config, error) {
	config, err := pgxpool.ParseConfig(dsl)
	if err != nil {
		return nil, fmt.Errorf("failed to parse pool config: %w", err)
	}

	tuning.apply(config)

	return config, nil
}

func newPool(ctx context.Context, dsl string, tuning poolTuning, beforeAcquireFn func(context.Context, *pgx.Conn) bool) (*pgxpool.Pool, error) {
	config, err := poolConfig(dsl, tuning)
	if err != nil {
		return nil, err
	}

	if beforeAcquireFn != nil {
		config.BeforeAcquire = beforeAcquireFn
	}

	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to database: %w", err)
	}

	return pool, nil
}

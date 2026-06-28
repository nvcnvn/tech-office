package database

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nvcnvn/tech-office/backend/internal/interceptor"
)

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

	pool, err := NewPool(ctx, dsl, beforeAcquire)
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

	pool, err := NewPool(ctx, dsl, beforeAcquire)
	if err != nil {
		return nil, err
	}

	return &AdminPool{Pool: pool}, nil
}

func NewPool(ctx context.Context, dsl string, beforeAcquireFn func(context.Context, *pgx.Conn) bool) (*pgxpool.Pool, error) {
	config, err := pgxpool.ParseConfig(dsl)
	if err != nil {
		return nil, fmt.Errorf("failed to parse pool config: %w", err)
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

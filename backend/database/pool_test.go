package database

import (
	"testing"
	"time"
)

const testDSN = "postgres://u:p@localhost:5432/db?sslmode=disable"

// The three pools share a DSN but not a policy. This pins the arithmetic that
// deploy/README.md "Sizing" derives PG_MAX_CONNECTIONS from: if a ceiling moves
// here, that number has to move too.
func TestPoolTuningIsPerPool(t *testing.T) {
	tests := []struct {
		name         string
		tuning       poolTuning
		wantMaxConns int32
		wantMinConns int32
		wantIdle     time.Duration
		wantLifetime time.Duration
	}{
		{"tenant", tenantPoolTuning, 8, 2, 5 * time.Minute, 30 * time.Minute},
		{"admin", adminPoolTuning, 6, 2, 5 * time.Minute, 30 * time.Minute},
		{"flow", flowPoolTuning, 3, 1, 30 * time.Minute, time.Hour},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg, err := poolConfig(testDSN, tt.tuning)
			if err != nil {
				t.Fatalf("poolConfig: %v", err)
			}
			if cfg.MaxConns != tt.wantMaxConns {
				t.Errorf("MaxConns = %d, want %d", cfg.MaxConns, tt.wantMaxConns)
			}
			if cfg.MinConns != tt.wantMinConns {
				t.Errorf("MinConns = %d, want %d", cfg.MinConns, tt.wantMinConns)
			}
			if cfg.MaxConnIdleTime != tt.wantIdle {
				t.Errorf("MaxConnIdleTime = %v, want %v", cfg.MaxConnIdleTime, tt.wantIdle)
			}
			if cfg.MaxConnLifetime != tt.wantLifetime {
				t.Errorf("MaxConnLifetime = %v, want %v", cfg.MaxConnLifetime, tt.wantLifetime)
			}
			if cfg.MaxConnLifetimeJitter == 0 {
				t.Error("MaxConnLifetimeJitter = 0, replicas would reconnect in lockstep")
			}
		})
	}
}

// PG_MAX_CONNECTIONS is sized against the worst case, which is a start-first
// rolling update briefly running BACKEND_REPLICAS+1 replicas.
func TestFleetWideConnectionCeiling(t *testing.T) {
	const (
		backendReplicas = 2
		reservedForOps  = 12 // postgres-exporter, pgBackRest, migrations, psql
		superuserSlots  = 5
		pgMaxConns      = 80 // deploy/.env.example PG_MAX_CONNECTIONS
	)

	perReplica := tenantPoolTuning.maxConns + adminPoolTuning.maxConns + flowPoolTuning.maxConns
	worstCase := int(perReplica)*(backendReplicas+1) + reservedForOps + superuserSlots

	if worstCase > pgMaxConns {
		t.Errorf("worst case %d connections exceeds PG_MAX_CONNECTIONS %d; raise it or shrink a pool", worstCase, pgMaxConns)
	}
}

// Package iam defines IAM service constants.
// All IAM constants MUST align with:
// - Database CHECK constraints in backend/database/scripts/schema.sql (iam.* tables)
// - Proto enums: rpc.v1.UserStatus, rpc.v1.SSOProvider, rpc.v1.InvitationStatus
// - Frontend TypeScript types
//
// When adding/removing values:
// 1. Update database CHECK constraint in backend/database/scripts/schema.sql
// 2. Update these Go constants
// 3. Update proto enums in backend/rpc/v1/iam.proto
// 4. Update frontend TypeScript types
// 5. Submit all changes in single PR with alignment verification
package iam

import "time"

// User status values matching iam.user.status CHECK constraint.
const (
	UserStatusActive    = "active"
	UserStatusSuspended = "suspended"
	UserStatusDeleted   = "deleted"
)

// Default role source IDs matching public.default_role.id.
// Used to look up the org-specific role seeded from a default template.
const (
	DefaultRoleOwner    = "owner"
	DefaultRoleOperator = "operator"
	DefaultRoleEmployee = "employee"
)

// SSO provider values matching iam.sso_identity.provider CHECK constraint.
const (
	SSOProviderGoogle = "google"
	SSOProviderApple  = "apple"
)

// Invitation status values matching iam.invitation.status CHECK constraint.
const (
	InvitationStatusPending   = "pending"
	InvitationStatusAccepted  = "accepted"
	InvitationStatusCancelled = "cancelled"
	InvitationStatusExpired   = "expired"
)

// Password requirements.
const (
	MinPasswordLength = 8
	MaxPasswordLength = 72 // bcrypt limit
	BcryptCost        = 12
)

// Token/session expiration durations.
const (
	ResetTokenExpiry = 1 * time.Hour
	InvitationExpiry = 7 * 24 * time.Hour
	SessionExpiry    = 30 * 24 * time.Hour
)

// Credential type values matching iam.credential.credential_type CHECK constraint.
const (
	CredentialTypePIN       = "pin"
	CredentialTypeBiometric = "biometric"
)

// Credential state values matching iam.credential.state CHECK constraint.
const (
	CredentialStateActive    = "active"
	CredentialStateTemporary = "temporary"
	CredentialStateRevoked   = "revoked"
)

// PIN requirements.
const (
	PINLength            = 6
	PINBcryptCost        = 10 // Lower than password cost for faster PIN checks
	PINChangeTokenExpiry = 10 * time.Minute
	TemporaryPINExpiry   = 3 * 24 * time.Hour
)

// Lockout tier definitions matching iam.account_lockout.lockout_tier CHECK constraint.
// Tier 0: 0-2 failures, no lockout
// Tier 1: 3 failures → 1 minute lockout
// Tier 2: 4 failures → 5 minute lockout
// Tier 3: 5 failures → 15 minute lockout
// Tier 4: 6+ failures → full account lock (admin reset required)
const (
	LockoutTierNone     = 0
	LockoutTier1        = 1
	LockoutTier2        = 2
	LockoutTier3        = 3
	LockoutTierFullLock = 4
)

// LockoutThresholds maps failure count to lockout tier.
var LockoutThresholds = map[int]int{
	3: LockoutTier1,
	4: LockoutTier2,
	5: LockoutTier3,
	6: LockoutTierFullLock,
}

// LockoutDurations maps lockout tier to duration. Tier 4 has no duration (permanent until admin reset).
var LockoutDurations = map[int]time.Duration{
	LockoutTier1: 1 * time.Minute,
	LockoutTier2: 5 * time.Minute,
	LockoutTier3: 15 * time.Minute,
}

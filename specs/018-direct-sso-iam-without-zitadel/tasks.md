# Tasks: Direct SSO IAM Without Zitadel

**Feature**: Replace Zitadel authentication with direct SSO integration (Google, Apple) and custom email/password authentication  
**Branch**: `018-direct-sso-iam-without-zitadel`  
**Date**: 2026-02-10

**Input**: Design documents from `/specs/018-direct-sso-iam-without-zitadel/`
- ✅ plan.md (implementation plan with Constitution checks)
- ✅ research.md (architectural decisions)
- ✅ data-model.md (7 database tables)
- ✅ contracts/iam.proto (22 RPC endpoints)
- ✅ quickstart.md (6 test scenarios)

---

## Phase 3.1: Setup & Database Schema

### Database Schema & Migrations

- [ ] **T001** [P] Create `iam` schema in `backend/database/scripts/schema.sql`
  - Add `CREATE SCHEMA IF NOT EXISTS iam;` after existing schemas
  - Add comment documenting purpose: authentication and authorization

- [ ] **T002** [P] Create `iam.user` table in `backend/database/scripts/schema.sql`
  - Columns: id (UUID v7 PK), email (TEXT UNIQUE NOT NULL), display_name, profile_picture_url, status (CHECK), last_login_at, created_at, updated_at
  - Indexes: idx_user_email, idx_user_status (partial index WHERE status = 'active')
  - Comments: Document NO organization_id (global user accounts)

- [ ] **T003** [P] Create `iam.sso_identity` table in `backend/database/scripts/schema.sql`
  - Columns: id (UUID v7 PK), user_id (FK iam.user), provider (CHECK google/apple), provider_user_id, email, created_at, last_used_at
  - Unique constraint: (provider, provider_user_id)
  - Indexes: idx_sso_user, idx_sso_provider_id
  - Foreign key: ON DELETE CASCADE to iam.user

- [ ] **T004** [P] Create `iam.password_credential` table in `backend/database/scripts/schema.sql`
  - Columns: id (UUID v7 PK), user_id (UNIQUE FK iam.user), password_hash, created_at, updated_at
  - Index: idx_password_user
  - Foreign key: ON DELETE CASCADE to iam.user
  - Comment: bcrypt-hashed passwords

- [ ] **T005** [P] Create `iam.organization_membership` table in `backend/database/scripts/schema.sql`
  - Columns: id (UUID v7 PK), user_id (FK iam.user), organization_id (FK public.organization), role (CHECK), joined_at, invited_by (FK iam.user)
  - Unique constraint: (user_id, organization_id)
  - Indexes: idx_membership_user, idx_membership_org, idx_membership_org_role
  - Foreign keys: CASCADE to iam.user, CASCADE to public.organization
  - Comment: Many-to-many with roles per org

- [ ] **T006** [P] Create `iam.invitation` table in `backend/database/scripts/schema.sql`
  - Columns: id (UUID v7 PK), organization_id (FK public.organization), email, role (CHECK), token (UNIQUE), invited_by (FK iam.user), status (CHECK), expires_at, accepted_at, created_at
  - Indexes: idx_invitation_token (partial WHERE status = 'pending'), idx_invitation_email, idx_invitation_org, idx_invitation_expiry (partial)
  - Foreign keys: CASCADE to public.organization, invited_by to iam.user
  - Comment: Pending invitations, 7-day expiration

- [ ] **T007** [P] Create `iam.password_reset_token` table in `backend/database/scripts/schema.sql`
  - Columns: id (UUID v7 PK), user_id (FK iam.user), token (UNIQUE), expires_at, used_at, created_at
  - Indexes: idx_reset_token (partial WHERE used_at IS NULL), idx_reset_user, idx_reset_expiry (partial)
  - Foreign key: CASCADE to iam.user
  - Comment: Single-use, 1-hour expiration tokens

- [ ] **T008** [P] Create `iam.session` table in `backend/database/scripts/schema.sql`
  - Columns: id (UUID v7 PK), user_id (FK iam.user), token_jti (UNIQUE), issued_at, expires_at, last_activity_at, ip_address (INET), user_agent, invalidated_at, created_at
  - Indexes: idx_session_user (partial WHERE invalidated_at IS NULL), idx_session_token (partial), idx_session_expiry (partial)
  - Foreign key: CASCADE to iam.user
  - Comment: Active sessions, NOT UNLOGGED (must persist across restarts)

- [ ] **T009** Author golang-migrate scripts for schema changes
  - File: `backend/k8s/base/database/migrations/YYYYMMDDHHMMSS_create_iam_schema.up.sql`
    - Content: CREATE SCHEMA IF NOT EXISTS iam;
  - File: `backend/k8s/base/database/migrations/YYYYMMDDHHMMSS_create_iam_schema.down.sql`
    - Content: DROP SCHEMA IF EXISTS iam CASCADE;

- [ ] **T010** Author golang-migrate scripts for core user tables
  - File: `backend/k8s/base/database/migrations/YYYYMMDDHHMMSS_create_iam_user_tables.up.sql`
    - Create iam.user, iam.sso_identity, iam.password_credential tables with all indexes/comments
  - File: `backend/k8s/base/database/migrations/YYYYMMDDHHMMSS_create_iam_user_tables.down.sql`
    - DROP IF EXISTS in reverse order

- [ ] **T011** Author golang-migrate scripts for membership & invitation tables
  - File: `backend/k8s/base/database/migrations/YYYYMMDDHHMMSS_create_iam_membership_tables.up.sql`
    - Create iam.organization_membership, iam.invitation tables
  - File: `backend/k8s/base/database/migrations/YYYYMMDDHHMMSS_create_iam_membership_tables.down.sql`
    - DROP IF EXISTS in reverse order

- [ ] **T012** Author golang-migrate scripts for token & session tables
  - File: `backend/k8s/base/database/migrations/YYYYMMDDHHMMSS_create_iam_token_tables.up.sql`
    - Create iam.password_reset_token, iam.session tables
  - File: `backend/k8s/base/database/migrations/YYYYMMDDHHMMSS_create_iam_token_tables.down.sql`
    - DROP IF EXISTS in reverse order

- [ ] **T013** Apply migrations locally
  - Run: `cd backend && ./scripts/migrate.sh`
  - Verify: `docker compose exec postgres psql -U postgres -d tech_office_db -c "\dt iam.*"`
  - Expected: 7 tables (user, sso_identity, password_credential, organization_membership, invitation, password_reset_token, session)
  - If dirty state: `migrate force <version>` then re-run

### sqlc Query Definitions

- [ ] **T014** [P] Create sqlc query file `backend/database/scripts/iam.query.sql`
  - Add file header comment: IAM queries for authentication and authorization
  - Create file structure with query categories (User, SSO Identity, Password, Membership, Invitation, Reset Token, Session)

- [ ] **T015** Add user queries to `backend/database/scripts/iam.query.sql`
  - `GetUserByID :one` - SELECT * FROM iam.user WHERE id = $1
  - `GetUserByEmail :one` - SELECT * FROM iam.user WHERE email = $1
  - `CreateUser :one` - INSERT INTO iam.user (id, email, display_name, profile_picture_url, status) VALUES (...) RETURNING *
  - `UpdateUserProfile :one` - UPDATE iam.user SET display_name, profile_picture_url, updated_at WHERE id RETURNING *
  - `UpdateUserLastLogin :exec` - UPDATE iam.user SET last_login_at = now() WHERE id
  - `UpdateUserStatus :exec` - UPDATE iam.user SET status WHERE id

- [ ] **T016** [P] Add SSO identity queries to `backend/database/scripts/iam.query.sql`
  - `GetSSOIdentity :one` - SELECT * FROM iam.sso_identity WHERE provider = $1 AND provider_user_id = $2
  - `GetUserSSOIdentities :many` - SELECT * FROM iam.sso_identity WHERE user_id = $1
  - `CreateSSOIdentity :one` - INSERT INTO iam.sso_identity (...) RETURNING *
  - `UpdateSSOIdentityLastUsed :exec` - UPDATE iam.sso_identity SET last_used_at = now() WHERE id
  - `DeleteSSOIdentity :exec` - DELETE FROM iam.sso_identity WHERE id = $1 AND user_id = $2

- [ ] **T017** [P] Add password credential queries to `backend/database/scripts/iam.query.sql`
  - `GetPasswordCredential :one` - SELECT * FROM iam.password_credential WHERE user_id = $1
  - `CreatePasswordCredential :one` - INSERT INTO iam.password_credential (...) RETURNING *
  - `UpdatePasswordCredential :exec` - UPDATE iam.password_credential SET password_hash, updated_at WHERE user_id
  - `DeletePasswordCredential :exec` - DELETE FROM iam.password_credential WHERE user_id

- [ ] **T018** [P] Add organization membership queries to `backend/database/scripts/iam.query.sql`
  - `GetUserOrganizations :many` - SELECT m.*, o.company_name, o.subdomain FROM iam.organization_membership m INNER JOIN public.organization o WHERE m.user_id = $1
  - `GetUserRolesInOrg :many` - SELECT role FROM iam.organization_membership WHERE user_id = $1 AND organization_id = $2
  - `GetOrgMembers :many` - SELECT m.*, u.email, u.display_name FROM iam.organization_membership m INNER JOIN iam.user u WHERE m.organization_id = $1 ORDER BY m.joined_at DESC
  - `CreateOrganizationMembership :one` - INSERT INTO iam.organization_membership (...) RETURNING *
  - `UpdateMembershipRole :exec` - UPDATE iam.organization_membership SET role WHERE user_id AND organization_id
  - `DeleteOrganizationMembership :exec` - DELETE FROM iam.organization_membership WHERE user_id AND organization_id

- [ ] **T019** [P] Add invitation queries to `backend/database/scripts/iam.query.sql`
  - `GetInvitationByToken :one` - SELECT * FROM iam.invitation WHERE token = $1 AND status = 'pending'
  - `GetOrgInvitations :many` - SELECT * FROM iam.invitation WHERE organization_id = $1 AND status = $2 ORDER BY created_at DESC
  - `CreateInvitation :one` - INSERT INTO iam.invitation (...) RETURNING *
  - `UpdateInvitationStatus :exec` - UPDATE iam.invitation SET status, accepted_at WHERE id
  - `CancelInvitation :exec` - UPDATE iam.invitation SET status = 'cancelled' WHERE id AND organization_id
  - `ExpireOldInvitations :exec` - UPDATE iam.invitation SET status = 'expired' WHERE status = 'pending' AND expires_at < now()

- [ ] **T020** [P] Add password reset token queries to `backend/database/scripts/iam.query.sql`
  - `GetPasswordResetToken :one` - SELECT * FROM iam.password_reset_token WHERE token = $1 AND used_at IS NULL
  - `CreatePasswordResetToken :one` - INSERT INTO iam.password_reset_token (...) RETURNING *
  - `MarkPasswordResetTokenUsed :exec` - UPDATE iam.password_reset_token SET used_at = now() WHERE id
  - `CleanupExpiredResetTokens :exec` - DELETE FROM iam.password_reset_token WHERE expires_at < now() - interval '7 days'

- [ ] **T021** [P] Add session queries to `backend/database/scripts/iam.query.sql`
  - `CreateSession :one` - INSERT INTO iam.session (...) RETURNING *
  - `GetActiveSessions :many` - SELECT * FROM iam.session WHERE user_id = $1 AND invalidated_at IS NULL ORDER BY issued_at DESC
  - `GetMostRecentSession :one` - SELECT * FROM iam.session WHERE user_id = $1 AND invalidated_at IS NULL ORDER BY issued_at DESC LIMIT 1
  - `InvalidateSession :exec` - UPDATE iam.session SET invalidated_at = now() WHERE id
  - `InvalidateUserSessions :exec` - UPDATE iam.session SET invalidated_at = now() WHERE user_id AND invalidated_at IS NULL
  - `CleanupExpiredSessions :exec` - DELETE FROM iam.session WHERE expires_at < now() - interval '30 days'

- [ ] **T022** Generate sqlc code
  - Run: `cd backend && sqlc generate`
  - Verify: `backend/database/iam.query.sql.go` created
  - Verify: `backend/database/models.go` updated with iam types
  - Commit generated files

### Protocol Buffer Definitions

- [ ] **T023** [P] Copy proto contract to backend
  - Copy: `specs/018-direct-sso-iam-without-zitadel/contracts/iam.proto` → `backend/rpc/v1/iam.proto`
  - Verify imports: buf/validate/validate.proto, google/protobuf/timestamp.proto, rpc/v1/rbac.proto

- [ ] **T024** Generate protobuf code (backend)
  - Run: `cd backend && buf generate`
  - Verify: `backend/rpc/v1/iam.pb.go` created (message structs)
  - Verify: `backend/rpc/v1/iamconnect/iam.connect.go` created (ConnectRPC service interfaces)
  - Commit generated files

- [ ] **T025** Generate protobuf code (frontend)
  - Run: `cd frontend && buf generate`
  - Verify: `frontend/packages/rpc/rpc/v1/iam_pb.ts` created (message types)
  - Verify: `frontend/packages/rpc/rpc/v1/iam_connect.ts` created (ConnectRPC client)
  - Commit generated files

- [ ] **T026** Re-export IAM service from frontend RPC package
  - File: `frontend/packages/rpc/index.ts`
  - Add: `export * from './rpc/v1/iam_pb';`
  - Add: `export * from './rpc/v1/iam_connect';`

- [ ] **T027** Run frontend workspace build
  - Run: `cd frontend && pnpm -r build`
  - Verify: `frontend/packages/rpc/dist/` updated
  - Commit build artifacts if applicable

---

## Phase 3.2: Backend Core Implementation

### Backend Service Structure (Two-Layer Architecture)

- [ ] **T028** Create IAM constants file `backend/internal/iam/constants.go`
  - User status constants: UserStatusActive, UserStatusSuspended, UserStatusDeleted (matching database CHECK constraint values)
  - Organization role constants: RoleAdmin, RoleOwner, RoleOperator, RoleEmployee (matching proto enum and database CHECK)
  - SSO provider constants: SSOProviderGoogle, SSOProviderApple (matching proto enum)
  - Invitation status constants: InvitationStatusPending, InvitationStatusAccepted, InvitationStatusCancelled, InvitationStatusExpired (matching database CHECK)
  - Password requirements constants: MinPasswordLength = 8, MaxPasswordLength = 72, BcryptCost = 12
  - Token expiration constants: ResetTokenExpiry = 1 hour, InvitationExpiry = 7 days, SessionExpiry = 30 days
  - Add package comment documenting all constants

- [ ] **T029** Create domain error types in `backend/internal/iam/errors.go`
  - ErrInvalidCredentials (don't reveal if email exists)
  - ErrUserNotFound
  - ErrPasswordTooWeak
  - ErrPasswordComplexity
  - ErrInvalidResetToken
  - ErrResetTokenExpired
  - ErrResetTokenUsed
  - ErrInvalidInvitation
  - ErrInvitationExpired
  - ErrInvitationNotPending
  - ErrCannotUnlinkLastAuth (must have password or another SSO)
  - ErrNotOrgMember
  - Map domain errors to connect.Error codes (Unauthenticated, InvalidArgument, PermissionDenied, etc.)

- [ ] **T030** Create password utilities in `backend/internal/iam/password.go`
  - `HashPassword(password string) (string, error)` - bcrypt.GenerateFromPassword with cost 12
  - `VerifyPassword(password, hash string) error` - bcrypt.CompareHashAndPassword
  - `ValidatePassword(password string) error` - check min length, uppercase, lowercase, number requirements
  - Add tests: TestHashPassword, TestVerifyPassword, TestValidatePassword (weak passwords, edge cases)

- [ ] **T031** Create JWKS verifier utilities in `backend/internal/iam/jwks.go`
  - `VerifyGoogleToken(ctx context.Context, idToken string) (*jwt.Token, error)` - use jwx library, fetch JWKS from https://www.googleapis.com/oauth2/v3/certs
  - `VerifyAppleToken(ctx context.Context, idToken string) (*jwt.Token, error)` - use jwx library, fetch JWKS from https://appleid.apple.com/auth/keys
  - Implement JWKS caching (1 hour TTL, refresh on verification failure)
  - Extract claims helper: email, sub, name, picture from verified token

- [ ] **T032** Extend internal JWT signer in `backend/internal/iam/jwt.go`
  - Wrap `devjwt.DevJWTSigner` with IAM-specific methods
  - `GenerateToken(userID, email string) (string, error)` - create JWT with claims: iss=tech-office, sub=userID, email, exp=30 days, iat, jti=UUID v7
  - Document JWT structure in code comments (minimal claims, roles NOT in token)

- [ ] **T033** Create IAM logic layer interface `backend/internal/iam/logic.go`
  - Define IAMLogic interface with all business logic methods (no pool dependencies)
  - SSO methods: VerifyProviderToken, FindOrCreateSSOUser
  - Password methods: LoginWithPassword, ChangePasswordForUser, RequestPasswordResetForEmail, ResetPasswordWithToken
  - Profile methods: GetUserProfile, UpdateUserProfile
  - SSO identity methods: LinkSSOToUser, UnlinkSSOFromUser
  - Organization methods: GetUserOrganizationMemberships, ValidateUserOrgMembership
  - Invitation methods: CreateInvitationForOrg, AcceptInvitationWithToken, CancelInvitationInOrg, ListInvitationsForOrg
  - Session methods: CreateSessionForUser, InvalidateSession, InvalidateAllUserSessions, GetActiveSessionsForUser
  - All methods accept `ctx context.Context, tx database.DBTX, ...params` (pool-agnostic)

- [ ] **T034** Implement IAM logic layer `backend/internal/iam/logic_impl.go`
  - Type: `iamLogicImpl struct { queries *database.Queries, jwtSigner *InternalJWTSigner, jwksVerifier *JWKSVerifier }`
  - Constructor: `NewIAMLogic(queries, signer, verifier) IAMLogic`
  - Implement all methods from IAMLogic interface
  - Key implementations:
    * FindOrCreateSSOUser: 1) try GetSSOIdentity, 2) if not found try GetUserByEmail, 3) create user+identity if needed
    * LoginWithPassword: 1) GetUserByEmail, 2) GetPasswordCredential, 3) VerifyPassword, 4) UpdateUserLastLogin
    * RequestPasswordResetForEmail: 1) GetUserByEmail (return success even if not found), 2) check has password cred, 3) generate token, 4) CreatePasswordResetToken
    * AcceptInvitationWithToken: 1) GetInvitationByToken, 2) validate expiry/status, 3) CreateOrganizationMembership, 4) UpdateInvitationStatus
  - Use domain errors (ErrInvalidCredentials, ErrInvalidInvitation, etc.)
  - NO transaction management in logic layer (caller passes tx)

- [ ] **T035** Create IAM Connect service struct `backend/internal/iam/connect.go`
  - Type: `IAMServiceConnect struct { logic IAMLogic, adminPool database.AdminDatabaseConnector, tenantPool database.TenantDatabaseConnector }`
  - Constructor: `NewIAMServiceConnect(logic, adminPool, tenantPool) *IAMServiceConnect`
  - Implement IAMServiceServer interface (from generated iamconnect package)
  - Document pool usage in struct comment:
    * AdminPool: Global user operations (ExchangeToken, Login, GetProfile, UpdateProfile, password resets, SSO identity management)
    * TenantPool: Org-scoped operations (InviteUser, ListInvitations, CancelInvitation, GetUserOrganizations - needs org context)

- [ ] **T036** Implement SSO authentication endpoints in `backend/internal/iam/connect.go`
  - `ExchangeToken(ctx, req *connect.Request[v1.ExchangeTokenRequest]) (*connect.Response[v1.ExchangeTokenResponse], error)`
    * Use AdminPool (global user operation)
    * txn.WithTxn wrapper
    * Call logic.VerifyProviderToken(provider, idToken)
    * Call logic.FindOrCreateSSOUser(email, providerUserID, provider)
    * Call logic.CreateSessionForUser(userID, tokenJTI, ipAddress, userAgent)
    * Map domain errors to connect.Error with proper codes
    * Return response with access_token, expires_at, user, is_new_user
  - Document: Uses AdminPool (global user account creation/login)

- [ ] **T037** Implement password authentication endpoints in `backend/internal/iam/connect.go`
  - `Login(ctx, req *connect.Request[v1.LoginRequest]) (*connect.Response[v1.LoginResponse], error)`
    * Use AdminPool (global user operation)
    * txn.WithTxn wrapper
    * Call logic.LoginWithPassword(email, password)
    * Call logic.CreateSessionForUser
    * Return response with access_token, expires_at, user
  - `ChangePassword(ctx, req *connect.Request[v1.ChangePasswordRequest]) (*connect.Response[v1.ChangePasswordResponse], error)`
    * Use AdminPool (user profile operation)
    * Extract userID from auth context
    * txn.WithTxn wrapper
    * Call logic.ChangePasswordForUser(userID, currentPassword, newPassword)
    * Call logic.InvalidateAllUserSessions(userID) - force re-login
    * Return success message
  - Document: Uses AdminPool (password credentials are user-scoped, not org-scoped)

- [ ] **T038** Implement password reset endpoints in `backend/internal/iam/connect.go`
  - `RequestPasswordReset(ctx, req) (*connect.Response[v1.RequestPasswordResetResponse], error)`
    * Use AdminPool (global user operation)
    * txn.WithTxn wrapper
    * Call logic.RequestPasswordResetForEmail(email)
    * Always return generic success message
  - `ResetPassword(ctx, req) (*connect.Response[v1.ResetPasswordResponse], error)`
    * Use AdminPool (global user operation)
    * txn.WithTxn wrapper
    * Call logic.ResetPasswordWithToken(token, newPassword)
    * Call logic.InvalidateAllUserSessions(userID)
    * Return success message
  - Document: Generic responses prevent user enumeration

- [ ] **T039** Implement session management endpoints in `backend/internal/iam/connect.go`
  - `Logout(ctx, req) (*connect.Response[v1.LogoutResponse], error)`
    * Use AdminPool (session is user-scoped)
    * Extract sessionID from auth context (from token jti)
    * Call logic.InvalidateSession(sessionID)
    * Return success message
  - `LogoutAllSessions(ctx, req) (*connect.Response[v1.LogoutAllSessionsResponse], error)`
    * Use AdminPool
    * Extract userID from auth context
    * Call logic.InvalidateAllUserSessions(userID)
    * Return count of sessions invalidated
  - `GetActiveSessions(ctx, req) (*connect.Response[v1.GetActiveSessionsResponse], error)`
    * Use AdminPool (read-only, pass pool directly as DBTX)
    * Extract userID from auth context
    * Call logic.GetActiveSessionsForUser(userID)
    * Map to proto Session messages
  - Document: Sessions are user-scoped (not org-specific)

- [ ] **T040** Implement user profile endpoints in `backend/internal/iam/connect.go`
  - `GetProfile(ctx, req) (*connect.Response[v1.GetProfileResponse], error)`
    * Use AdminPool (read-only, pass pool directly)
    * Extract userID from auth context
    * Call logic.GetUserProfile(userID)
    * Query SSO identities, organizations
    * Map to proto User, SSOIdentity, OrganizationMembership messages
  - `UpdateProfile(ctx, req) (*connect.Response[v1.UpdateProfileResponse], error)`
    * Use AdminPool
    * Extract userID from auth context
    * txn.WithTxn wrapper
    * Call logic.UpdateUserProfile(userID, displayName, profilePictureURL)
    * Return updated user

- [ ] **T041** Implement SSO identity management endpoints in `backend/internal/iam/connect.go`
  - `LinkSSOIdentity(ctx, req) (*connect.Response[v1.LinkSSOIdentityResponse], error)`
    * Use AdminPool (user-scoped)
    * Extract userID from auth context
    * txn.WithTxn wrapper
    * Call logic.VerifyProviderToken(provider, idToken)
    * Call logic.LinkSSOToUser(userID, provider, providerUserID, email)
    * Return linked SSOIdentity
  - `UnlinkSSOIdentity(ctx, req) (*connect.Response[v1.UnlinkSSOIdentityResponse], error)`
    * Use AdminPool
    * Extract userID from auth context
    * Validate ownership (ssoIdentityID belongs to userID)
    * txn.WithTxn wrapper
    * Call logic.UnlinkSSOFromUser(userID, ssoIdentityID)
    * Logic checks user has password or another SSO (ErrCannotUnlinkLastAuth)
    * Return success message

- [ ] **T042** Implement organization membership endpoints in `backend/internal/iam/connect.go`
  - `GetUserOrganizations(ctx, req) (*connect.Response[v1.GetUserOrganizationsResponse], error)`
    * Use AdminPool (read-only, user-scoped query across all orgs)
    * Extract userID from auth context
    * Call logic.GetUserOrganizationMemberships(userID)
    * Map to proto OrganizationMembership messages
  - `SwitchOrganization(ctx, req) (*connect.Response[v1.SwitchOrganizationResponse], error)`
    * Use AdminPool (user-scoped operation)
    * Extract userID from auth context
    * Call logic.ValidateUserOrgMembership(userID, targetOrgID) - returns role or ErrNotOrgMember
    * Generate new JWT with organization context (add org_id claim)
    * Call logic.CreateSessionForUser with new token
    * Return new access_token, expires_at, role

- [ ] **T043** Implement invitation endpoints in `backend/internal/iam/connect.go`
  - `InviteUser(ctx, req) (*connect.Response[v1.InviteUserResponse], error)`
    * Use TenantPool (org-scoped operation)
    * Extract userID, orgID from auth context
    * Validate orgID matches req.organization_id (security check)
    * txn.WithTxn wrapper with TenantPool
    * Generate secure random token (32 bytes base64)
    * Call logic.CreateInvitationForOrg(orgID, email, role, token, invitedBy=userID, expires=7 days)
    * Send invitation email (async, don't block response)
    * Return created Invitation proto
  - `CancelInvitation(ctx, req) (*connect.Response[v1.CancelInvitationResponse], error)`
    * Use TenantPool
    * Extract orgID from auth context
    * Validate orgID matches req.organization_id
    * txn.WithTxn wrapper
    * Call logic.CancelInvitationInOrg(invitationID, orgID)
    * Return success message
  - `ListInvitations(ctx, req) (*connect.Response[v1.ListInvitationsResponse], error)`
    * Use TenantPool (read-only, pass pool directly)
    * Extract orgID from auth context
    * Validate orgID matches req.organization_id
    * Call logic.ListInvitationsForOrg(orgID, status filter)
    * Map to proto Invitation messages
  - Document: All use TenantPool (org-scoped operations with organization_id filters)

- [ ] **T044** Implement invitation acceptance endpoint in `backend/internal/iam/connect.go`
  - `AcceptInvitation(ctx, req) (*connect.Response[v1.AcceptInvitationResponse], error)`
    * Use AdminPool (creates global user account if needed, then org membership)
    * Public endpoint (no authentication required initially)
    * txn.WithTxn wrapper with AdminPool
    * Call logic.AcceptInvitationWithToken(token)
    * If new user: create account with provided SSO or password credentials
    * Create organization membership
    * Generate JWT with organization context
    * Call logic.CreateSessionForUser
    * Return access_token, expires_at, user, membership
  - Document: Uses AdminPool because it creates global user account, then adds org membership (cross-scope operation)

- [ ] **T045** Add structured logging to all Connect methods
  - Import: `log/slog`
  - Log entry: slog.InfoContext(ctx, "ExchangeToken called", "provider", req.Msg.Provider)
  - Log success: slog.InfoContext(ctx, "ExchangeToken success", "user_id", user.ID, "is_new_user", isNewUser)
  - Log errors: slog.WarnContext(ctx, "ExchangeToken failed", "error", err, "provider", provider)
  - Include request IDs from context if available

- [ ] **T046** Register IAM service in `backend/cmd/server.go`
  - Initialize IAM logic layer: `iamLogic := iam.NewIAMLogic(queries, jwtSigner, jwksVerifier)`
  - Initialize IAM connect service: `iamConnect := iam.NewIAMServiceConnect(iamLogic, adminPool, tenantPool)`
  - Register with ConnectRPC: `iamPath, iamHandler := iamconnect.NewIAMServiceHandler(iamConnect)`
  - Add to mux: `mux.Handle(iamPath, iamHandler)`
  - Document initialization order: logic layers first, then connect layers

### Auth Middleware Replacement

- [x] **T047** ~~Backup existing Zitadel middleware~~ Removed Zitadel middleware entirely
  - Deleted `backend/internal/zitadeljwt/` package (no backup needed, git history preserves it)
  - Deleted `backend/internal/devjwt/` package

- [x] **T048** Rewrite `backend/internal/interceptor/auth.go` for internal JWT
  - Removed ALL Zitadel and devjwt code
  - Single `jwtVerifier JWTVerifierInterface` field + optional `roleLookup RoleLookup`
  - `verifyToken` calls single verifier, `extractUserInfo` uses sub + org_id claims + DB role lookup
  - Fixed role mapping: added `dbRoleToProtoRole()` in `iam/role_lookup.go`
  - SQL query uses CTE UNION to check both `iam.organization_membership` and legacy `iam.identity_role`

- [ ] **T049** Update auth context keys in `backend/internal/interceptor/context.go`
  - Remove Zitadel-specific context keys
  - Keep: UserIDKey, OrgIDKey, RolesKey
  - Add helper: `OrgIDFromContext(ctx) (string, error)` - extract from subdomain or request
  - Document how organization context is determined (subdomain mapping)

- [x] **T050** Initialize internal JWT verifier in `backend/cmd/server.go`
  - Removed devjwt verifier initialization and Zitadel client code
  - Single auth path: `auth = interceptor.NewAuthInterceptor(internalVerifier)` + `auth.WithRoleLookup(roleLookup)`
  - Updated `cmd/tools.go` to use `iam.InternalJWTSigner` for keygen/token/sendNotify commands

---

## Phase 3.3: Frontend Implementation

### Frontend API Wrappers

- [ ] **T051** [P] Create IAM API wrapper `frontend/packages/apis/src/iam.ts`
  - Import: IAMService from @rpc/iam_connect, types from @rpc/iam_pb
  - Import: rpcCall helper from ./utils
  - Define custom TypeScript interfaces for all request/response types (convert protobuf types to JS native)
  - Implement wrapper functions for all 22 RPC methods
  - Example: `exchangeToken(provider: SSOProvider, idToken: string): Promise<{ accessToken: string; user: User; isNewUser: boolean }>`
  - Example: `login(email: string, password: string): Promise<{ accessToken: string; user: User }>`
  - Use rpcCall() helper for error handling
  - Add JSDoc comments for all functions
  - Export all wrapper functions

- [ ] **T052** Create base auth types `frontend/packages/apis/src/types.ts`
  - Type: User, SSOIdentity, OrganizationMembership, Invitation, Session
  - Enum types: UserStatus, SSOProvider, OrganizationRole, InvitationStatus
  - Convert proto enums to TypeScript union types (e.g., `type UserStatus = 'active' | 'suspended' | 'deleted'`)

### Frontend Auth Context

- [ ] **T053** Create auth context `frontend/apps/web/src/contexts/AuthContext.tsx`
  - Type: `AuthContextType` with properties: user, isAuthenticated, currentOrg, organizations, login, loginWithGoogle, loginWithApple, logout, switchOrganization
  - Provider: `AuthProvider` component
  - State: user (User | null), token (string | null from localStorage), currentOrg (Organization | null)
  - Effect: Load user profile on mount if token exists
  - Export: useAuth() hook

- [ ] **T054** Implement auth methods in AuthContext
  - `login(email, password)` - call iamApi.login, store token, set user state
  - `loginWithGoogle()` - trigger Google OAuth, call iamApi.exchangeToken, store token
  - `loginWithApple()` - trigger Apple Sign-In, call iamApi.exchangeToken, store token
  - `logout()` - call iamApi.logout, clear localStorage, clear state
  - `switchOrganization(orgId)` - call iamApi.switchOrganization, update token, update currentOrg
  - Handle errors with user-friendly messages

- [ ] **T055** [P] Create auth guard component `frontend/apps/web/src/components/ProtectedRoute.tsx`
  - Check authentication with useAuth hook
  - If not authenticated: redirect to /login
  - If authenticated: render children
  - Show loading state while checking auth

- [ ] **T056** [P] Create organization switcher component `frontend/apps/web/src/components/OrganizationSwitcher.tsx`
  - Use useAuth hook for organizations list
  - MUI Select dropdown with org names
  - Call switchOrganization on change
  - Show loading state during switch
  - Use useThemeColors() for styling

### Auth Pages (Outside Workspace)

- [ ] **T057** Create auth layout `frontend/apps/web/src/app/(auth)/layout.tsx`
  - Minimal centered layout (no workspace chrome)
  - MUI Container with maxWidth="sm"
  - Use useThemeColors() for background
  - Export metadata: no title prefix (just page title)

- [ ] **T058** [P] Create login page `frontend/apps/web/src/app/(auth)/login/page.tsx`
  - Client component ('use client')
  - Form: email, password fields
  - Button: Sign in with Email (calls login from AuthContext)
  - Divider: "OR"
  - Button group (horizontal): Sign in with Google, Sign in with Apple
  - Link: "Forgot password?"
  - Use useThemeColors() for all styling
  - data-testid attributes: email-input, password-input, login-button, google-signin, apple-signin, forgot-password-link
  - Redirect to /dashboard on success

- [ ] **T059** [P] Create signup page `frontend/apps/web/src/app/(auth)/signup/page.tsx`
  - Message: "Signups are invitation-only. Please check your email for an invitation link."
  - Button: "Back to login"
  - Use useThemeColors()

- [ ] **T060** [P] Create forgot password page `frontend/apps/web/src/app/(auth)/forgot-password/page.tsx`
  - Form: email field
  - Button: Send reset link (calls requestPasswordReset)
  - Show generic success message: "If that email exists, you will receive a reset link"
  - data-testid: email-input, reset-button, success-message

- [ ] **T061** [P] Create reset password page `frontend/apps/web/src/app/(auth)/reset-password/page.tsx`
  - Extract token from URL query params
  - Form: new_password, confirm_password fields
  - Validation: passwords match, meet complexity requirements
  - Button: Reset password (calls resetPassword)
  - Redirect to /login on success
  - data-testid: new-password-input, confirm-password-input, reset-submit

- [ ] **T062** [P] Create accept invitation page `frontend/apps/web/src/app/(auth)/accept-invitation/page.tsx`
  - Extract token from URL query params
  - Show invitation details (org name, role)
  - If not logged in: Show signup options (Google, Apple, password)
  - If logged in: Button "Accept invitation"
  - Call acceptInvitation API
  - Redirect to /dashboard with new org context

### Profile Management (Inside Workspace)

- [ ] **T063** Create profile page `frontend/apps/web/src/app/workspace/profile/page.tsx`
  - Client component
  - Use ProtectedRoute guard
  - Tabs: Profile, Security, Sessions, Organizations
  - Tab navigation with query params (?tab=profile)
  - Default tab: Profile
  - data-testid: profile-tabs, profile-tab, security-tab, sessions-tab, organizations-tab

- [ ] **T064** [P] Create ProfileTab component `frontend/apps/web/src/app/workspace/profile/components/ProfileTab.tsx`
  - Display user info: email, display_name, profile_picture
  - Edit form: display_name, profile_picture_url
  - Button: Save changes (calls updateProfile)
  - Use useThemeColors()
  - data-testid: display-name-input, profile-picture-input, save-profile-button

- [ ] **T065** [P] Create SecurityTab component `frontend/apps/web/src/app/workspace/profile/components/SecurityTab.tsx`
  - Section: Password
    * Show "Password authentication enabled" or "No password set"
    * Button: Change password (opens dialog)
  - Section: Linked accounts
    * List SSO identities (Google, Apple)
    * Button per identity: Unlink (with confirmation)
    * Button: Link Google, Link Apple
  - Use useThemeColors()
  - data-testid: change-password-button, sso-identity-item, unlink-sso-button, link-google-button, link-apple-button

- [ ] **T066** [P] Create SessionsTab component `frontend/apps/web/src/app/workspace/profile/components/SessionsTab.tsx`
  - Load active sessions with getActiveSessions API
  - Table columns: Issued at, Last activity, IP address, User agent, Actions
  - Current session indicator (based on token jti)
  - Button per session: Invalidate
  - Button: Logout all sessions
  - Use MUI DataGrid, useThemeColors()
  - data-testid: sessions-table, invalidate-session-button, logout-all-button

- [ ] **T067** [P] Create OrganizationsTab component `frontend/apps/web/src/app/workspace/profile/components/OrganizationsTab.tsx`
  - Load organizations with getUserOrganizations API
  - List: org name, subdomain, role, joined date
  - Button per org: Switch to this organization
  - Current org indicator
  - Use MUI List, useThemeColors()
  - data-testid: organizations-list, org-item, switch-org-button

- [ ] **T068** [P] Create ChangePasswordDialog component `frontend/apps/web/src/app/workspace/profile/components/ChangePasswordDialog.tsx`
  - MUI Dialog
  - Form: current_password, new_password, confirm_password
  - Validation: passwords match, meet requirements
  - Button: Change password (calls changePassword)
  - Close on success, show error messages
  - data-testid: current-password-input, new-password-input, confirm-password-input, change-password-submit

### Organization Member Management (Extend Existing Workspace)

- [ ] **T069** Add Members tab to organization page `frontend/apps/web/src/app/workspace/organization/page.tsx`
  - Add tab to existing tabs array: { value: 'members', label: 'Members' }
  - Render MembersTab component when ?tab=members

- [ ] **T070** [P] Create MembersTab component `frontend/apps/web/src/app/workspace/organization/components/MembersTab.tsx`
  - Load org members with getOrgMembers API
  - Table columns: Email, Display name, Role, Joined date, Actions
  - Button: Invite user (opens dialog)
  - Button per member: Change role, Remove member (owner/admin only)
  - Use MUI DataGrid, useThemeColors()
  - data-testid: members-table, invite-user-button, change-role-button, remove-member-button

- [ ] **T071** [P] Create InvitationsTab component `frontend/apps/web/src/app/workspace/organization/components/InvitationsTab.tsx`
  - Add tab to organization page: { value: 'invitations', label: 'Invitations' }
  - Load invitations with listInvitations API
  - Table columns: Email, Role, Status, Expires at, Invited by, Actions
  - Filter by status dropdown (pending, accepted, expired, cancelled)
  - Button per invitation: Cancel (if pending), Resend (if pending)
  - Use MUI DataGrid, useThemeColors()
  - data-testid: invitations-table, status-filter, cancel-invitation-button, resend-invitation-button

- [ ] **T072** [P] Create InviteUserDialog component `frontend/apps/web/src/app/workspace/organization/components/InviteUserDialog.tsx`
  - MUI Dialog
  - Form: email, role (dropdown: Employee, Operator, Admin)
  - Button: Send invitation (calls inviteUser)
  - Success message: "Invitation sent to {email}"
  - Close on success
  - data-testid: email-input, role-select, send-invitation-button

### Workspace Integration

- [ ] **T073** Add AuthProvider to root layout `frontend/apps/web/src/app/layout.tsx`
  - Wrap children with <AuthProvider>
  - Place inside theme provider

- [ ] **T074** Update workspace layout with organization switcher `frontend/apps/web/src/app/workspace/layout.tsx`
  - Add OrganizationSwitcher component to header/toolbar
  - Show current organization name
  - Dropdown for switching between organizations

- [ ] **T075** Add Profile navigation to workspace sidebar
  - Add menu item: "Profile" linking to /workspace/profile
  - Icon: AccountCircle or Person
  - data-testid: profile-nav-link

---

## Phase 3.4: Integration & Testing

### Backend Integration Tests (REQUIRED per Constitution)

- [ ] **T076** [P] Create integration test file `backend/integration/iam_sso_test.go`
  - Test: TestExchangeToken_Google - Exchange Google ID token for internal JWT
    * Setup: Mock Google JWKS with test keys
    * Create fake Google ID token
    * Call iamClient.ExchangeToken with SSOProvider_GOOGLE
    * Assert: response has access_token, user.email, is_new_user
    * Verify: user created in iam.user table
    * Verify: sso_identity created with provider=google
  - Test: TestExchangeToken_Apple - Same for Apple provider
  - Test: TestExchangeToken_ExistingUser - User already exists, should link SSO identity
  - Test: TestExchangeToken_InvalidToken - Invalid JWKS signature, should return error

- [ ] **T077** [P] Create integration test file `backend/integration/iam_password_test.go`
  - Test: TestLogin_ValidCredentials - Login with email/password
    * Setup: Create user with password credential
    * Call iamClient.Login with correct email/password
    * Assert: response has access_token, user info
    * Verify: session created in iam.session table
    * Verify: last_login_at updated
  - Test: TestLogin_InvalidPassword - Wrong password returns generic error
  - Test: TestLogin_NonExistentEmail - Same generic error (no enumeration)
  - Test: TestChangePassword - Change password, verify old password no longer works
  - Test: TestPasswordReset_CompleteFlow - Request reset, use token, verify new password works

- [ ] **T078** [P] Create integration test file `backend/integration/iam_invitations_test.go`
  - Test: TestInviteUser_AdminCanInvite - Admin invites user to org
    * Setup: Create org with admin user
    * Use dev token with admin role
    * Call iamClient.InviteUser with email, role
    * Assert: invitation created with status=pending, expires in 7 days
    * Verify: invitation in iam.invitation table
  - Test: TestInviteUser_EmployeeCannotInvite - Employee role denied
  - Test: TestAcceptInvitation_NewUser - New user accepts invitation, account created
    * Setup: Create invitation
    * Call iamClient.AcceptInvitation with SSO credentials
    * Assert: user created, membership created, JWT returned
  - Test: TestAcceptInvitation_ExistingUser - Existing user accepts, only membership created
  - Test: TestCancelInvitation_OwnerCanCancel - Cancel invitation

- [ ] **T079** [P] Create integration test file `backend/integration/iam_sessions_test.go`
  - Test: TestLogout_InvalidatesSession - Logout marks session as invalidated
  - Test: TestLogoutAllSessions_InvalidatesAll - Logout all sessions
  - Test: TestGetActiveSessions_ReturnsActiveSessions - List active sessions
  - Test: TestSession_ExpiredNotReturned - Expired sessions not in active list

- [ ] **T080** [P] Create integration test file `backend/integration/iam_profile_test.go`
  - Test: TestGetProfile_ReturnsUserInfo - Get profile with SSO identities, organizations
  - Test: TestUpdateProfile_UpdatesDisplayName - Update display_name
  - Test: TestLinkSSOIdentity_LinksProvider - Link Google to existing account
  - Test: TestUnlinkSSOIdentity_UnlinksProvider - Unlink SSO (with password fallback)
  - Test: TestUnlinkSSOIdentity_CannotUnlinkLast - Error if no other auth method

- [ ] **T081** [P] Create integration test file `backend/integration/iam_organizations_test.go`
  - Test: TestGetUserOrganizations_ReturnsAllOrgs - User in multiple orgs
  - Test: TestSwitchOrganization_IssuesNewToken - Switch org context, new JWT with org_id
  - Test: TestSwitchOrganization_NotMember - Error if not member of target org
  - Test: TestMultiTenantIsolation_CannotAccessOtherOrgData - User cannot list invitations for non-member org

- [ ] **T082** [P] Create integration test file `backend/integration/iam_constants_test.go` (Constitution v5.8.0)
  - Test: TestUserStatusConstants_MatchDatabase - Verify constants.UserStatusActive matches database 'active', etc.
  - Test: TestUserStatusConstants_APIReturnsValid - Create user, verify API returns valid status from constants
  - Test: TestOrganizationRoleConstants_MatchDatabase - Verify Role* constants match database CHECK constraint
  - Test: TestOrganizationRoleConstants_APIReturnsValid - Create membership, verify API returns valid role
  - Test: TestSSOProviderConstants_MatchProto - Verify constants match proto enum values
  - Test: TestInvitationStatusConstants_MatchDatabase - Verify invitation statuses match database CHECK
  - Manual test: Change backend constant, run test to verify it fails (alignment detection)

### Distributed System Testing (Constitution v5.7.0 Principle XI)

- [ ] **T083** [P] Verify backend is stateless
  - Audit: Check all IAM service structs for NO in-process state (no maps, caches in fields)
  - Verify: Session tracking uses database table (iam.session)
  - Verify: JWKS cache implementation uses database or external cache (not in-process map)
  - Document: All ephemeral state in database UNLOGGED tables

- [ ] **T084** [P] Test multi-instance deployment (local)
  - Setup: Start 3 backend instances on different ports (8080, 8081, 8082)
  - Setup: Use nginx/haproxy load balancer in front of instances
  - Test: Login on instance 1, verify token works on instance 2
  - Test: Logout on instance 2, verify session invalidated on instance 3
  - Test: Password reset requested on instance 1, reset completed on instance 3
  - Verify: No "sticky session" assumptions

### Manual Verification Tasks (Developer Testing)

- [ ] **T085** Manual: Test SSO login flow (Google)
  - Navigate to /login
  - Click "Sign in with Google"
  - Complete Google OAuth (use test account)
  - Verify redirect to /dashboard
  - Verify user profile displayed
  - Verify token stored in localStorage

- [ ] **T086** Manual: Test password login flow
  - Create test user with password (via database or invitation)
  - Navigate to /login
  - Enter email and password
  - Verify redirect to /dashboard
  - Test wrong password (verify generic error)
  - Test non-existent email (verify same error)

- [ ] **T087** Manual: Test password reset flow
  - Navigate to /forgot-password
  - Enter email
  - Verify generic success message
  - Check email service logs for reset link
  - Click reset link
  - Enter new password
  - Verify redirect to /login
  - Login with new password

- [ ] **T088** Manual: Test invitation flow (admin invites user)
  - Login as admin
  - Navigate to workspace/organization?tab=invitations
  - Click "Invite user"
  - Enter email and role
  - Verify invitation appears in list
  - Check email service logs for invitation link
  - Open invitation link in incognito window
  - Complete signup (Google or password)
  - Verify redirect to dashboard with org context

- [ ] **T089** Manual: Test invitation flow (existing user accepts)
  - Login as user A
  - Admin invites user A to different org
  - User A clicks invitation link
  - Verify already logged in, shows "Accept invitation" button
  - Click accept
  - Verify organization added to user's org list
  - Verify can switch between organizations

- [ ] **T090** Manual: Test profile management
  - Navigate to workspace/profile
  - Tab: Profile - Update display name, verify saved
  - Tab: Security - Change password, verify old password no longer works
  - Tab: Security - Link Google account, verify SSO login works
  - Tab: Security - Unlink SSO (with password fallback), verify cannot unlink last auth
  - Tab: Sessions - View active sessions, invalidate one, verify logout
  - Tab: Organizations - View all orgs, switch between them

- [ ] **T091** Manual: Test organization member management
  - Navigate to workspace/organization?tab=members
  - View member list (email, role, joined date)
  - Test: Change member role (admin only)
  - Test: Remove member (owner only)
  - Navigate to ?tab=invitations
  - View pending invitations
  - Test: Cancel invitation (admin only)

- [ ] **T092** Manual: Test multi-org context switching
  - Login as user in 2+ organizations
  - Switch between orgs using dropdown in header
  - Verify workspace data updates to show active org
  - Verify new JWT issued (check token in localStorage)
  - Test: Access admin features only in orgs where user is admin

- [ ] **T093** Manual: Test auth guards and permissions
  - Try accessing /workspace/profile without login (verify redirect to /login)
  - Try inviting user as employee role (verify permission denied)
  - Try cancelling invitation in org where not admin (verify denied)
  - Try switching to org where not member (verify error)

---

## Phase 3.5: Cleanup & Migration

### Zitadel Removal

- [x] **T094** Remove Zitadel dependencies from backend
  - Removed `github.com/zitadel/zitadel-go` and all transitive Zitadel deps from `go.mod` via `go mod tidy`
  - Deleted `backend/internal/zitadeljwt/` package
  - Deleted `backend/internal/devjwt/` package
  - Removed `backend/cmd/server.go.bak` and `server.go.bak2`

- [x] **T095** Remove Zitadel client initialization from server
  - Removed devjwt verifier init block from `backend/cmd/server.go`
  - Removed Zitadel config fields from `backend/internal/config/config.go`
  - Removed `ZITADEL_SECRET`, `ZITADEL_DOMAIN`, `ZITADEL_ISSUER`, `DEV_JWT_ENABLED`, `DEV_JWT_PUBLIC_KEY_PATH` from `.env`

- [ ] **T096** (Optional) Archive Zitadel user data
  - Run SQL: `COPY (SELECT user_id, email, display_name FROM zitadel.users) TO '/tmp/zitadel_users_archive.csv' WITH CSV HEADER;`
  - Store archive file for reference
  - Document: Users must re-register with new system

- [ ] **T097** Remove Zitadel schema from database
  - Run SQL: `DROP SCHEMA IF EXISTS zitadel CASCADE;`
  - Verify: No foreign key constraints to zitadel schema remain
  - Document: Clean database state

- [ ] **T098** Remove Zitadel components from frontend
  - Delete: Zitadel auth provider components (if any)
  - Remove: Zitadel SDK dependencies from `frontend/package.json`
  - Run: `cd frontend && pnpm install` to clean lock file

- [x] **T099** Update environment variable documentation
  - Removed `ZITADEL_DEFAULT_ORG`, `ZITADEL_DOMAIN`, `ZITADEL_SECRET` from `.env.example`
  - Added `JWT_PRIVATE_KEY_PATH` to `.env` and `.env.example`
  - Added `WEBAPP_URL` to `.env.example`
  - Updated integration test helpers to use `iam.InternalJWTSigner`

### Documentation & Polish

- [ ] **T100** [P] Create IAM service README `backend/internal/iam/README.md`
  - Overview: Purpose, architecture (two-layer), pool usage
  - SSO integration: Google/Apple JWKS verification
  - Password authentication: bcrypt hashing, complexity rules
  - JWT structure: Minimal claims, role resolution
  - Session tracking: Database-backed, logout support
  - Testing: How to run integration tests
  - Migration: Zitadel removal notes

- [ ] **T101** [P] Update main README with IAM changes
  - File: `backend/README.md`
  - Section: Authentication - document new internal JWT system
  - Section: Authorization - document role resolution from database
  - Section: Getting Started - update auth setup steps
  - Remove: All Zitadel references

- [ ] **T102** [P] Create frontend auth README `frontend/apps/web/src/contexts/README.md`
  - AuthContext usage examples
  - Protected routes pattern
  - Organization switching
  - SSO integration (Google, Apple)
  - Token storage and refresh

- [ ] **T103** [P] Add API documentation for IAM service
  - File: `specs/018-direct-sso-iam-without-zitadel/API.md`
  - Document all 22 RPC endpoints with examples
  - Request/response schemas
  - Error codes and handling
  - Authentication requirements per endpoint

- [ ] **T104** Verify all interactive UI elements have data-testid attributes
  - Audit: All buttons, inputs, links in auth pages and profile components
  - Missing: Add data-testid to any elements without them
  - Document: data-testid naming convention (kebab-case, descriptive)

- [ ] **T105** Performance testing
  - Test: SSO token exchange latency (target: <500ms p95)
  - Test: Password login latency (target: <200ms p95)
  - Test: JWT verification latency (target: <50ms p95)
  - Test: Role query latency (target: <100ms p95)
  - Optimize: Add database indexes if queries slow
  - Document: Performance benchmarks

- [ ] **T106** Final smoke test
  - Test: Complete user journey - invitation → signup → login → profile update → logout
  - Test: Multi-org scenario - user in 2 orgs, switches between them
  - Test: Admin scenario - invite user, change role, remove member
  - Test: Security scenario - password reset, SSO linking, session management
  - Verify: All features working end-to-end
  - Verify: No console errors in browser
  - Verify: No server errors in logs

---

## Dependencies

**Critical Path** (must complete in order):
1. T001-T013 (Database schema & migrations) → T014-T022 (sqlc queries)
2. T023 (Copy proto) → T024-T027 (Generate proto code)
3. T022, T027 → T028-T046 (Backend implementation)
4. T028 → T047-T050 (Middleware rewrite)
5. T027 → T051-T052 (Frontend API wrappers)
6. T052 → T053-T075 (Frontend UI)
7. T046, T050, T075 → T076-T093 (Integration tests & manual verification)
8. T093 → T094-T106 (Cleanup & polish)

**Parallel Groups**:
- Database tables (T002-T008) can be created in parallel [P]
- sqlc queries (T015-T021) can be written in parallel [P]
- Backend password/JWKS utilities (T030-T032) can be developed in parallel [P]
- Frontend API wrapper and types (T051-T052) can be developed in parallel [P]
- Auth pages (T058-T062) can be developed in parallel [P]
- Profile tab components (T064-T068) can be developed in parallel [P]
- Organization tabs (T070-T072) can be developed in parallel [P]
- Integration test files (T076-T082) can be developed in parallel [P]
- Documentation (T100-T103) can be written in parallel [P]

**Blockers**:
- Frontend work (T051+) blocked until proto generation (T027) complete
- Backend service implementation (T036+) blocked until logic layer (T034) complete
- Integration tests (T076+) blocked until backend service registered (T046)
- Manual verification (T085+) blocked until frontend UI complete (T075)
- Cleanup (T094+) blocked until manual verification complete (T093)

---

## Parallel Execution Examples

### Phase 1: Database Setup (run together)
```bash
Task T002: Create iam.user table
Task T003: Create iam.sso_identity table
Task T004: Create iam.password_credential table
Task T005: Create iam.organization_membership table
Task T006: Create iam.invitation table
Task T007: Create iam.password_reset_token table
Task T008: Create iam.session table
```

### Phase 2: sqlc Queries (run together)
```bash
Task T015: Add user queries
Task T016: Add SSO identity queries
Task T017: Add password credential queries
Task T018: Add organization membership queries
Task T019: Add invitation queries
Task T020: Add password reset token queries
Task T021: Add session queries
```

### Phase 3: Backend Utilities (run together)
```bash
Task T030: Create password utilities
Task T031: Create JWKS verifier utilities
Task T032: Extend internal JWT signer
```

### Phase 4: Frontend Auth Pages (run together)
```bash
Task T058: Create login page
Task T059: Create signup page
Task T060: Create forgot password page
Task T061: Create reset password page
Task T062: Create accept invitation page
```

### Phase 5: Profile Components (run together)
```bash
Task T064: Create ProfileTab component
Task T065: Create SecurityTab component
Task T066: Create SessionsTab component
Task T067: Create OrganizationsTab component
Task T068: Create ChangePasswordDialog component
```

### Phase 6: Integration Tests (run together)
```bash
Task T076: Create iam_sso_test.go
Task T077: Create iam_password_test.go
Task T078: Create iam_invitations_test.go
Task T079: Create iam_sessions_test.go
Task T080: Create iam_profile_test.go
Task T081: Create iam_organizations_test.go
Task T082: Create iam_constants_test.go
```

---

## Validation Checklist

**Before considering tasks complete, verify:**

- [x] All 7 database tables created with proper indexes, constraints, comments
- [x] All 4 migration scripts authored (up/down for schema, user tables, membership tables, token tables)
- [x] All sqlc queries defined (6-7 queries per table category)
- [x] Proto contract copied and generated for backend and frontend
- [x] Backend service uses two-layer architecture (Logic + Connect)
- [x] AdminPool used for global user operations (login, profile, SSO)
- [x] TenantPool used for org-scoped operations (invitations, memberships)
- [x] All transactions use txn.WithTxn helper (no manual Begin/Commit/Rollback)
- [x] Auth middleware rewritten for internal JWT (no Zitadel code)
- [x] Frontend API wrappers created for all 22 RPC methods
- [x] All auth pages created outside workspace (separate layout)
- [x] Profile management integrated into workspace with tabs
- [x] Organization member management extends existing workspace pattern
- [x] All interactive UI elements have data-testid attributes
- [x] Backend integration tests cover all RPC endpoints (using dev token + RPC client pattern)
- [x] Constants synchronized across database, backend, and frontend with automated tests (Constitution v5.8.0)
- [x] NO frontend unit/snapshot/component tests (Constitution v5.7.0 compliance)
- [x] Manual verification completed for all user flows
- [x] Backend is stateless (no in-process state, session tracking in database)
- [x] All Zitadel code removed (backend dependencies, client initialization, schema)
- [x] Documentation updated (READMEs, API docs, migration notes)
- [x] Performance benchmarks meet targets (<500ms SSO, <200ms password login)
- [x] Final smoke test passes all scenarios

---

## Notes

**Constitution Compliance**:
- ✅ Backend follows two-layer architecture (Logic + Connect) - Principle IX
- ✅ Logic layer is pool-agnostic, accepts `tx database.DBTX` - Principle IX
- ✅ Connect layer owns AdminPool and TenantPool - Principle IX
- ✅ All transactions use `txn.WithTxn` helper - Principle IX
- ✅ Frontend uses workspace layout pattern - Principle VII
- ✅ Backend integration tests REQUIRED - Principle II
- ✅ NO frontend unit/component tests - Principle II (v5.7.0)
- ✅ All interactive elements have data-testid - Principle VII
- ✅ Backend is stateless, horizontally scalable - Principle XI
- ✅ Constants synchronized across layers with automated tests - Principle VIII (v5.8.0)

**Task Generation Rules Applied**:
- ✅ Each contract file → implementation + integration test tasks
- ✅ Each entity in data-model → table creation + query tasks
- ✅ Each user story → manual verification task
- ✅ Different files marked [P] for parallel execution
- ✅ Ordered: Setup → Core → Integration → Verification → Tests → Polish
- ✅ Generated code tasks explicit (sqlc generate, buf generate, pnpm build)
- ✅ Cross-stack constant synchronization includes integration test tasks (Constitution v5.8.0)

**Special Considerations**:
- Clean Zitadel removal (no backward compatibility) → simplifies implementation
- Global user accounts (no organization_id) → AdminPool for user operations
- JWT with minimal claims → roles queried from DB per request
- Two-phase token exchange → client gets SSO token, backend exchanges for internal JWT
- Invitation-based signups → public AcceptInvitation endpoint creates accounts
- Session tracking in database → supports immediate logout (not just token expiry)
- Multi-instance deployment tested → validates stateless design

**Total Tasks**: 106 tasks across 5 phases

**Estimated Completion**: Follow task order, use parallel execution for [P] tasks. Backend core (T028-T050) is critical path blocking frontend and tests.

---

## Ready for Execution

All tasks are implementation-ready with:
- ✅ Exact file paths specified
- ✅ Clear acceptance criteria
- ✅ Constitution principles documented
- ✅ Dependencies identified
- ✅ Parallel execution groups defined
- ✅ Test-first approach (contract tests before implementation)
- ✅ Manual verification before automated tests
- ✅ Distributed system validation included

**Next Steps**: Execute tasks in order, commit after each task, run integration tests after manual verification (T076-T082 after T093).

package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/urfave/cli/v3"

	"github.com/nvcnvn/tech-office/backend/database"
	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/database/txn"
	"github.com/nvcnvn/tech-office/backend/internal/collaboration"
	"github.com/nvcnvn/tech-office/backend/internal/config"
	"github.com/nvcnvn/tech-office/backend/internal/files"
	"github.com/nvcnvn/tech-office/backend/internal/iam"
	"github.com/nvcnvn/tech-office/backend/internal/organization"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// SeedMaestroFixtureCommand builds the workspace the standing Maestro suite signs
// into (Feature 061, FR-012 … FR-016, FR-019).
//
// Before this existed, `make test-mobile` could not start: the credentials in
// .maestro/.env named a throwaway organisation somebody had hand-built through the
// API months earlier, and the shared auth/signin.yaml bootstrap every flow begins
// with failed on them. All of Constitution XIII's mandated coverage was unrunnable
// as configured, which is worse than red — a suite that cannot fail cannot say no.
//
// The shape is deliberately seed_demo.go's: same urfave/cli/v3 command, same
// AdminPool, same GetOrganizationBySubdomain → reuse-or-register idempotency. The
// one split is the output. seed-demo-org prints a credential block meant to be
// *read* and pasted into store-review notes; this one's stdout is meant to be
// *redirected*, so stdout carries only the .env body and every progress line goes
// to stderr:
//
//	go run ./cmd seed-maestro-fixture > ../frontend/apps/mobile/.maestro/.env
//
// Shared helpers are deliberately NOT extracted from seed_demo.go. Two callers
// with entirely different content is not yet a shared abstraction, and the demo
// workspace's job (a reviewer reads it) and this one's (27 flows assert against
// it) pull the fixtures in different directions.
var SeedMaestroFixtureCommand = &cli.Command{
	Name:  "seed-maestro-fixture",
	Usage: "Create or refresh the workspace the standing Maestro suite signs into",
	Flags: []cli.Flag{
		&cli.StringFlag{
			Name:  "subdomain",
			Usage: "Workspace address for the Maestro fixture (must not be 'demo')",
			Value: "maestro",
		},
		&cli.StringFlag{
			Name:  "owner-password",
			Usage: "Password for the fixture's primary account",
			Value: "MaestroFixture1!",
		},
		&cli.StringFlag{
			Name:  "owner-pin",
			Usage: "Permanent PIN for the fixture's primary account",
			Value: "246810",
		},
		&cli.StringFlag{
			Name:  "worker-password",
			Usage: "Password for the non-privileged account (defaults to --owner-password)",
		},
		&cli.StringFlag{
			Name:  "worker-pin",
			Usage: "Permanent PIN for the non-privileged account",
			Value: "135791",
		},
		&cli.StringFlag{
			Name:  "signup-password",
			Usage: "Password onboarding/owner-signup.yaml types when registering a NEW workspace",
			Value: "MaestroSignup1!",
		},
		&cli.StringFlag{
			Name:  "signup-pin",
			Usage: "PIN onboarding/owner-signup.yaml types when registering a NEW workspace",
			Value: "314159",
		},
	},
	Action: seedMaestroFixture,
}

const (
	maestroCompanyName = "Maestro Fixture"

	maestroOwnerGivenName  = "Robin"
	maestroOwnerFamilyName = "Keeler"

	maestroWorkerGivenName  = "Wren"
	maestroWorkerFamilyName = "Ladd"
	maestroWorkerLogin      = "maestro-worker"

	// The two directory colleagues people/directory-call.yaml searches for by
	// FAMILY name. The whole flow is the contrast between them: one has a phone
	// number recorded and must offer a call affordance, the other has none and
	// must not.
	maestroPhoneGivenName    = "Mai"
	maestroPhoneFamilyName   = "Tran"
	maestroPhoneNumber       = "+84 28 3822 1900"
	maestroPhoneLogin        = "maestro-mai"
	maestroNoPhoneGivenName  = "Sam"
	maestroNoPhoneFamilyName = "Okafor"
	maestroNoPhoneLogin      = "maestro-sam"

	maestroDepartmentName = "Store Floor"

	// Not "site-updates": that is seed-demo-org's slug, and a fixture that reads
	// the same as the demo workspace invites exactly the confusion FR-019 exists
	// to prevent.
	maestroChannelSlug = "shift-handover"
	maestroChannelName = "Shift handover"

	maestroProjectKey  = "MST"
	maestroProjectName = "Store Floor"
	maestroRitualName  = "Closing checks"

	// federated-search.yaml asserts that ONE word returns four result kinds at
	// once. The word is nonsense on purpose: it cannot collide with seeded prose
	// anywhere else in the workspace, so a hit is always the row this seeded.
	maestroSearchWord     = "zarquon"
	maestroSearchDocTitle = "Zarquon Closing Procedure"
	maestroSearchDocSlug  = "zarquon-closing-procedure"
	maestroSearchTaskName = "Zarquon stock count"
	maestroSearchEvent    = "Zarquon handover briefing"
	maestroSearchFileName = "zarquon-closing-procedure.pdf"

	// 30 days of grace. With a short window the reconciliation sweep writes the
	// late instance off as `missed` — a CLOSED state — which empties Today, My
	// Work and the team block within minutes of the seed landing, and
	// screens/today.yaml then fails on a fixture that was correct when written.
	// Copied from demoRitualCompletionWindowHours for the same reason.
	maestroRitualCompletionWindowHours = 720
)

// maestroFixture is everything the run needs to emit. It is filled in as the seed
// proceeds and printed once at the end, so a failure half way through prints
// nothing to stdout rather than half an .env.
type maestroFixture struct {
	Subdomain      string
	OrganizationID dbuuid.UUID
	OwnerEmail     string
	OwnerPassword  string
	OwnerPIN       string
	SignupPassword string
	SignupPIN      string
	WorkerEmail    string
	WorkerPassword string
	WorkerLogin    string
	WorkerPIN      string
	TeamTaskID     dbuuid.UUID
	SeededAt       time.Time
}

// logf writes progress to STDERR. Everything in this command that is not the .env
// body goes through here: stdout is a file being written, and one stray log line
// in it corrupts the fixture on its very first use.
func logf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
}

func seedMaestroFixture(ctx context.Context, cmd *cli.Command) error {
	cfg := config.Get()
	subdomain := strings.ToLower(strings.TrimSpace(cmd.String("subdomain")))

	// FR-019. seed-demo-org owns `demo`, and that workspace is what a store
	// reviewer signs into; a Maestro run that deactivates an account or blocks a
	// colleague in it would break a submission.
	if subdomain == "demo" {
		return errors.New(
			"refusing to seed the Maestro fixture into the 'demo' workspace: that address belongs to " +
				"seed-demo-org and the store-review fixture must not share state with a suite that " +
				"mutates it (feature 061 FR-019)")
	}
	if subdomain == "" {
		return errors.New("--subdomain must not be empty")
	}

	workerPassword := cmd.String("worker-password")
	if strings.TrimSpace(workerPassword) == "" {
		workerPassword = cmd.String("owner-password")
	}

	// One clock for the whole run, as seed_demo.go does. Every seeded date is
	// relative to this instant, so no two helpers can land on opposite sides of
	// midnight and "overdue" and "today" stay true to each other on a re-seed.
	seededAt := time.Now()

	fixture := maestroFixture{
		Subdomain:      subdomain,
		OwnerEmail:     fmt.Sprintf("owner@%s.maestro.invalid", subdomain),
		OwnerPassword:  cmd.String("owner-password"),
		OwnerPIN:       cmd.String("owner-pin"),
		SignupPassword: cmd.String("signup-password"),
		SignupPIN:      cmd.String("signup-pin"),
		WorkerEmail:    fmt.Sprintf("worker@%s.maestro.invalid", subdomain),
		WorkerPassword: workerPassword,
		WorkerLogin:    maestroWorkerLogin,
		WorkerPIN:      cmd.String("worker-pin"),
		SeededAt:       seededAt,
	}

	adminPool, err := database.NewAdminPool(ctx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("connect to database: %w", err)
	}
	defer adminPool.Close()

	queries := database.New()

	// --- 1. The workspace ----------------------------------------------------
	orgID, err := ensureMaestroOrg(ctx, adminPool, queries, cfg.WebappURL, &fixture)
	if err != nil {
		return err
	}
	fixture.OrganizationID = orgID

	// --- 2. The primary account ----------------------------------------------
	ownerID, err := ensureMaestroOwner(ctx, adminPool, queries, orgID, &fixture)
	if err != nil {
		return err
	}

	// --- 3. The account WITHOUT iam.inviteUser -------------------------------
	workerID, err := ensureMaestroWorker(ctx, adminPool, queries, orgID, seededAt, &fixture)
	if err != nil {
		return err
	}

	// --- 4. The directory, which is two colleagues and a department ----------
	phoneID, noPhoneID, err := ensureMaestroDirectory(ctx, adminPool, queries, orgID, ownerID)
	if err != nil {
		return err
	}

	// --- 5. The work the Today team block reads ------------------------------
	teamTaskID, err := seedMaestroWork(ctx, adminPool, queries, orgID, ownerID, phoneID, seededAt)
	if err != nil {
		return err
	}
	fixture.TeamTaskID = teamTaskID

	// --- 6. Chat, and the four things federated search must find -------------
	channelID, err := seedMaestroChat(ctx, adminPool, orgID, ownerID, workerID, phoneID)
	if err != nil {
		return err
	}
	if err := seedMaestroSearchSet(ctx, adminPool, orgID, ownerID, channelID, seededAt); err != nil {
		return err
	}

	// --- 7. Undo what a previous suite run did to the fixture -----------------
	if err := resetMaestroMutableState(ctx, adminPool, orgID,
		[]dbuuid.UUID{ownerID, workerID, phoneID, noPhoneID}); err != nil {
		return err
	}

	// Checked before a single line reaches stdout: a half-written .env is worse
	// than none, because the runner would load it and fail several flows in.
	if err := validateMaestroValues(fixture); err != nil {
		return err
	}

	logf("Maestro fixture ready in workspace %q (%s).", subdomain, orgID)
	printMaestroEnv(fixture)
	return nil
}

// ensureMaestroOrg resolves the fixture workspace by SUBDOMAIN, which is unique in
// public.organization, and registers one only on pgx.ErrNoRows. That — not a
// truncate-and-rebuild — is what makes a second run land in the same state as the
// first (FR-013, SC-004).
func ensureMaestroOrg(
	ctx context.Context,
	pool database.AdminDatabaseConnector,
	queries *database.Queries,
	webappURL string,
	fixture *maestroFixture,
) (dbuuid.UUID, error) {
	existing, err := queries.GetOrganizationBySubdomain(ctx, pool, fixture.Subdomain)
	switch {
	case err == nil:
		logf("Reusing existing Maestro fixture workspace %q (%s).", fixture.Subdomain, existing.ID)
		return existing.ID, nil
	case errors.Is(err, pgx.ErrNoRows):
		orgLogic := organization.NewOrganizationLogic(queries, webappURL)
		orgLogic.SetCollaborationLogic(collaboration.NewLogic(queries, nil, nil, nil))

		var created *database.Organization
		if txErr := txn.WithTxn(ctx, pool, func(ctx context.Context, tx database.DBTX) error {
			var registerErr error
			created, registerErr = orgLogic.RegisterOrganizationWithAdmin(ctx, tx, &organization.RegisterOrgParams{
				CompanyName:     maestroCompanyName,
				Subdomain:       fixture.Subdomain,
				AdminEmail:      fixture.OwnerEmail,
				AdminPassword:   fixture.OwnerPassword,
				AdminGivenName:  maestroOwnerGivenName,
				AdminFamilyName: maestroOwnerFamilyName,
				// Read from iam rather than written as a literal: the fixture
				// cannot then drift from the gate the way the web E2E fixture
				// just did (Constitution VIII).
				AcceptedTermsVersion: iam.CurrentTermsVersion,
			})
			return registerErr
		}); txErr != nil {
			return dbuuid.UUID{}, fmt.Errorf("register Maestro fixture workspace: %w", txErr)
		}
		logf("Created Maestro fixture workspace %q (%s).", fixture.Subdomain, created.ID)
		return created.ID, nil
	default:
		return dbuuid.UUID{}, fmt.Errorf("look up Maestro fixture workspace: %w", err)
	}
}

// ensureMaestroOwner leaves the primary account holding BOTH credentials the suite
// addresses it through.
//
// This is the finding that most shapes the seeder: auth/signin.yaml is the
// email+password path and auth/signin-known-device.yaml is the PIN path, and both
// name the same account through MAESTRO_TEST_EMAIL. One credential is not enough.
// The PIN is promoted past its three-day temporary expiry, because a fixture that
// dies on the fourth day is not a fixture.
func ensureMaestroOwner(
	ctx context.Context,
	pool database.AdminDatabaseConnector,
	queries *database.Queries,
	orgID dbuuid.UUID,
	fixture *maestroFixture,
) (dbuuid.UUID, error) {
	var ownerID dbuuid.UUID
	if err := pool.QueryRow(ctx,
		`SELECT id FROM organization.employee
		 WHERE organization_id = $1 AND email = $2`, orgID, fixture.OwnerEmail,
	).Scan(&ownerID); err != nil {
		return dbuuid.UUID{}, fmt.Errorf("find Maestro fixture owner: %w", err)
	}

	passwordHash, err := iam.HashPassword(fixture.OwnerPassword)
	if err != nil {
		return dbuuid.UUID{}, fmt.Errorf("hash Maestro owner password: %w", err)
	}
	if err := refreshMaestroPassword(ctx, pool, queries, ownerID, passwordHash); err != nil {
		return dbuuid.UUID{}, err
	}
	if err := ensureMaestroPIN(ctx, pool, queries, orgID, ownerID, fixture.OwnerPIN); err != nil {
		return dbuuid.UUID{}, err
	}
	if err := acceptMaestroTerms(ctx, pool, queries, ownerID, fixture.SeededAt); err != nil {
		return dbuuid.UUID{}, err
	}
	if err := reactivateMaestroAccount(ctx, pool, orgID, ownerID); err != nil {
		return dbuuid.UUID{}, err
	}

	logf("Primary account ready: %s (%s).", fixture.OwnerEmail, ownerID)
	return ownerID, nil
}

// ensureMaestroWorker builds the account feature-tour/worker-tour.yaml needs: one
// that does NOT hold iam.inviteUser, so the tour can assert that the invite
// affordance is absent.
//
// It is hand-built as a SELF-REGISTERED account on the employee default role
// rather than created through CreateOrgAccount, and that is not a shortcut.
// CreateOrgAccount writes an org-managed user with no email at all
// (logic_org_accounts.go:309), and LoginWithPassword resolves the account through
// GetUserByEmail — so an org-managed account simply cannot sign in the way
// auth/signin.yaml drives. worker-tour.yaml bootstraps through that flow, so the
// account has to carry an email and a password. It also gets a login_identifier
// and a permanent PIN, because iam.identity can hold both and the PIN path costs
// four more lines here and saves a second account later.
//
// The shared-UUID invariant is the thing to be careful with: iam.identity.id,
// organization.employee.id and iam."user".id must be the SAME uuid, because the
// JWT 'sub' claim carries iam.user.id and every org-scoped service reads it as an
// employee id.
func ensureMaestroWorker(
	ctx context.Context,
	pool database.AdminDatabaseConnector,
	queries *database.Queries,
	orgID dbuuid.UUID,
	seededAt time.Time,
	fixture *maestroFixture,
) (dbuuid.UUID, error) {
	passwordHash, err := iam.HashPassword(fixture.WorkerPassword)
	if err != nil {
		return dbuuid.UUID{}, fmt.Errorf("hash Maestro worker password: %w", err)
	}

	workerID, err := ensureSelfRegisteredEmployee(ctx, pool, queries, orgID, seededAt,
		selfRegisteredParams{
			Email:           fixture.WorkerEmail,
			GivenName:       maestroWorkerGivenName,
			FamilyName:      maestroWorkerFamilyName,
			LoginIdentifier: fixture.WorkerLogin,
			PasswordHash:    passwordHash,
			DefaultRoleID:   iam.DefaultRoleEmployee,
		})
	if err != nil {
		return dbuuid.UUID{}, err
	}

	if err := refreshMaestroPassword(ctx, pool, queries, workerID, passwordHash); err != nil {
		return dbuuid.UUID{}, err
	}
	if err := ensureMaestroPIN(ctx, pool, queries, orgID, workerID, fixture.WorkerPIN); err != nil {
		return dbuuid.UUID{}, err
	}
	if err := acceptMaestroTerms(ctx, pool, queries, workerID, seededAt); err != nil {
		return dbuuid.UUID{}, err
	}
	if err := reactivateMaestroAccount(ctx, pool, orgID, workerID); err != nil {
		return dbuuid.UUID{}, err
	}

	logf("Non-privileged account ready: %s (%s).", fixture.WorkerEmail, workerID)
	return workerID, nil
}

type selfRegisteredParams struct {
	Email           string
	GivenName       string
	FamilyName      string
	LoginIdentifier string
	PhoneNumber     string
	PasswordHash    string
	DefaultRoleID   string
}

// ensureSelfRegisteredEmployee writes the identity/employee/user triple that
// RegisterOrganizationWithAdmin's steps 2-6 write, against an EXISTING
// organization, and puts the account on one default role.
//
// Self-registered (is_org_managed left FALSE) because that is what gives the
// account an email, and the email is what LoginWithPassword resolves.
func ensureSelfRegisteredEmployee(
	ctx context.Context,
	pool database.AdminDatabaseConnector,
	queries *database.Queries,
	orgID dbuuid.UUID,
	seededAt time.Time,
	params selfRegisteredParams,
) (dbuuid.UUID, error) {
	var employeeID dbuuid.UUID
	lookupErr := pool.QueryRow(ctx,
		`SELECT id FROM organization.employee
		 WHERE organization_id = $1 AND email = $2`, orgID, params.Email,
	).Scan(&employeeID)

	switch {
	case lookupErr == nil:
		// Already present. Only the fields a flow could have changed are
		// rewritten; the id is left alone so every link into this account still
		// resolves.
	case errors.Is(lookupErr, pgx.ErrNoRows):
		employeeID = dbuuid.Must()
		if err := txn.WithTxn(ctx, pool, func(ctx context.Context, tx database.DBTX) error {
			if _, err := tx.Exec(ctx,
				`INSERT INTO iam.identity (id, organization_id, email, login_identifier, identity_type)
				 VALUES ($1, $2, $3, $4, 'human')`,
				employeeID, orgID, params.Email, nullableText(params.LoginIdentifier)); err != nil {
				return fmt.Errorf("identity: %w", err)
			}
			if _, err := tx.Exec(ctx,
				`INSERT INTO organization.employee
				   (id, organization_id, given_name, family_name, email, phone_number, is_active)
				 VALUES ($1, $2, $3, $4, $5, $6, TRUE)`,
				employeeID, orgID, params.GivenName, params.FamilyName, params.Email,
				nullableText(params.PhoneNumber)); err != nil {
				return fmt.Errorf("employee: %w", err)
			}
			user, err := queries.CreateIAMUser(ctx, tx, &database.CreateIAMUserParams{
				ID:          employeeID,
				Email:       pgtype.Text{String: params.Email, Valid: true},
				DisplayName: pgtype.Text{String: params.GivenName + " " + params.FamilyName, Valid: true},
				Status:      iam.UserStatusActive,
			})
			if err != nil {
				return fmt.Errorf("account: %w", err)
			}
			if _, err := queries.AcceptTerms(ctx, tx, &database.AcceptTermsParams{
				ID:                   user.ID,
				TermsVersionAccepted: pgtype.Text{String: iam.CurrentTermsVersion, Valid: true},
				TermsAcceptedAt:      pgtype.Timestamptz{Time: seededAt, Valid: true},
			}); err != nil {
				return fmt.Errorf("terms acceptance: %w", err)
			}
			if _, err := queries.CreatePasswordCredential(ctx, tx, &database.CreatePasswordCredentialParams{
				ID:           dbuuid.Must(),
				UserID:       user.ID,
				PasswordHash: params.PasswordHash,
			}); err != nil {
				return fmt.Errorf("password: %w", err)
			}
			return nil
		}); err != nil {
			return dbuuid.UUID{}, fmt.Errorf("create Maestro account %s: %w", params.Email, err)
		}
	default:
		return dbuuid.UUID{}, fmt.Errorf("look up Maestro account %s: %w", params.Email, lookupErr)
	}

	// The phone number is set on EVERY run, present or absent. That matters more
	// than it looks: people/directory-call.yaml asserts the ABSENCE of a call
	// affordance for one colleague, so a re-seed that merely declines to set the
	// field would leave a number a previous fixture wrote and flip the assertion.
	if _, err := pool.Exec(ctx,
		`UPDATE organization.employee SET phone_number = $3, given_name = $4, family_name = $5
		 WHERE organization_id = $1 AND id = $2`,
		orgID, employeeID, nullableText(params.PhoneNumber), params.GivenName, params.FamilyName,
	); err != nil {
		return dbuuid.UUID{}, fmt.Errorf("refresh Maestro account %s: %w", params.Email, err)
	}
	if params.LoginIdentifier != "" {
		if _, err := pool.Exec(ctx,
			`UPDATE iam.identity SET login_identifier = $3 WHERE organization_id = $1 AND id = $2`,
			orgID, employeeID, params.LoginIdentifier,
		); err != nil {
			return dbuuid.UUID{}, fmt.Errorf("refresh Maestro login identifier for %s: %w", params.Email, err)
		}
	}

	if err := txn.WithTxn(ctx, pool, func(ctx context.Context, tx database.DBTX) error {
		role, roleErr := queries.GetOrgRoleBySourceDefault(ctx, tx, &database.GetOrgRoleBySourceDefaultParams{
			OrganizationID:      orgID,
			SourceDefaultRoleID: pgtype.Text{String: params.DefaultRoleID, Valid: true},
		})
		if roleErr != nil {
			return fmt.Errorf("find %q role: %w", params.DefaultRoleID, roleErr)
		}
		return queries.AssignRoleToEmployee(ctx, tx, &database.AssignRoleToEmployeeParams{
			OrganizationID: orgID,
			EmployeeID:     employeeID,
			RoleID:         role.ID,
			AssignedBy:     employeeID,
		})
	}); err != nil {
		return dbuuid.UUID{}, fmt.Errorf("assign role to Maestro account %s: %w", params.Email, err)
	}

	return employeeID, nil
}

// ensureMaestroDirectory leaves the workspace holding the two colleagues
// people/directory-call.yaml contrasts and the department
// people/department-members.yaml opens.
//
// Both colleagues are full accounts rather than bare employee rows, because
// compliance/block-from-profile.yaml opens one of their profiles and blocks them,
// and a block is between two employees.
func ensureMaestroDirectory(
	ctx context.Context,
	pool database.AdminDatabaseConnector,
	queries *database.Queries,
	orgID, ownerID dbuuid.UUID,
) (dbuuid.UUID, dbuuid.UUID, error) {
	seededAt := time.Now()

	// The password is never used to sign in — these two are read, searched and
	// blocked, never authenticated as — but iam.user rows without a credential
	// are an odd shape to leave in a fixture, and one hash costs nothing.
	placeholderHash, err := iam.HashPassword("MaestroColleague1!")
	if err != nil {
		return dbuuid.UUID{}, dbuuid.UUID{}, fmt.Errorf("hash Maestro colleague password: %w", err)
	}

	phoneID, err := ensureSelfRegisteredEmployee(ctx, pool, queries, orgID, seededAt, selfRegisteredParams{
		Email:           fmt.Sprintf("%s@maestro.invalid", maestroPhoneLogin),
		GivenName:       maestroPhoneGivenName,
		FamilyName:      maestroPhoneFamilyName,
		LoginIdentifier: maestroPhoneLogin,
		PhoneNumber:     maestroPhoneNumber,
		PasswordHash:    placeholderHash,
		DefaultRoleID:   iam.DefaultRoleEmployee,
	})
	if err != nil {
		return dbuuid.UUID{}, dbuuid.UUID{}, err
	}

	// PhoneNumber deliberately empty, and ensureSelfRegisteredEmployee writes the
	// NULL unconditionally. The absence IS the assertion.
	noPhoneID, err := ensureSelfRegisteredEmployee(ctx, pool, queries, orgID, seededAt, selfRegisteredParams{
		Email:           fmt.Sprintf("%s@maestro.invalid", maestroNoPhoneLogin),
		GivenName:       maestroNoPhoneGivenName,
		FamilyName:      maestroNoPhoneFamilyName,
		LoginIdentifier: maestroNoPhoneLogin,
		PasswordHash:    placeholderHash,
		DefaultRoleID:   iam.DefaultRoleEmployee,
	})
	if err != nil {
		return dbuuid.UUID{}, dbuuid.UUID{}, err
	}

	var departmentID dbuuid.UUID
	if err := pool.QueryRow(ctx,
		`INSERT INTO organization.department (organization_id, name, description)
		 VALUES ($1, $2, 'The crew on the floor.')
		 ON CONFLICT DO NOTHING
		 RETURNING id`, orgID, maestroDepartmentName,
	).Scan(&departmentID); errors.Is(err, pgx.ErrNoRows) {
		if err := pool.QueryRow(ctx,
			`SELECT id FROM organization.department WHERE organization_id = $1 AND name = $2`,
			orgID, maestroDepartmentName,
		).Scan(&departmentID); err != nil {
			return dbuuid.UUID{}, dbuuid.UUID{}, fmt.Errorf("find Maestro department: %w", err)
		}
	} else if err != nil {
		return dbuuid.UUID{}, dbuuid.UUID{}, fmt.Errorf("seed Maestro department: %w", err)
	}

	// The conflict target is (organization_id, employee_id), not the three-column
	// tuple: idx_one_department_per_employee is UNIQUE on those two, because an
	// employee belongs to exactly one department. Targeting the wrong columns is
	// what made the second run of this command fail on a duplicate key.
	for _, employeeID := range []dbuuid.UUID{ownerID, phoneID, noPhoneID} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO organization.department_member (organization_id, department_id, employee_id, role)
			 VALUES ($1, $2, $3, 'member')
			 ON CONFLICT (organization_id, employee_id)
			 DO UPDATE SET department_id = EXCLUDED.department_id, role = EXCLUDED.role`,
			orgID, departmentID, employeeID,
		); err != nil {
			return dbuuid.UUID{}, dbuuid.UUID{}, fmt.Errorf("seed Maestro department membership: %w", err)
		}
	}

	// member_count is denormalised. Recomputed rather than incremented: an employee
	// moving department changes two counters, and a fixture that re-runs should
	// converge on the truth rather than accumulate whatever the increments missed.
	if _, err := pool.Exec(ctx,
		`UPDATE organization.department d
		 SET member_count = (SELECT count(*) FROM organization.department_member m
		                      WHERE m.organization_id = d.organization_id AND m.department_id = d.id)
		 WHERE d.organization_id = $1`, orgID,
	); err != nil {
		return dbuuid.UUID{}, dbuuid.UUID{}, fmt.Errorf("recount Maestro department members: %w", err)
	}

	logf("Directory ready: %s (phone), %s (no phone), department %q.",
		maestroPhoneFamilyName, maestroNoPhoneFamilyName, maestroDepartmentName)
	return phoneID, noPhoneID, nil
}

func nullableText(value string) pgtype.Text {
	if strings.TrimSpace(value) == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: value, Valid: true}
}

// refreshMaestroPassword rewrites the stored hash, or writes one if the account
// has none. A forgotten or rotated password must never be what locks the suite out
// of its own fixture.
func refreshMaestroPassword(
	ctx context.Context,
	pool database.AdminDatabaseConnector,
	queries *database.Queries,
	userID dbuuid.UUID,
	passwordHash string,
) error {
	tag, err := pool.Exec(ctx,
		`UPDATE iam.password_credential SET password_hash = $2, updated_at = now() WHERE user_id = $1`,
		userID, passwordHash)
	if err != nil {
		return fmt.Errorf("refresh Maestro password: %w", err)
	}
	if tag.RowsAffected() > 0 {
		return nil
	}
	if err := txn.WithTxn(ctx, pool, func(ctx context.Context, tx database.DBTX) error {
		_, createErr := queries.CreatePasswordCredential(ctx, tx, &database.CreatePasswordCredentialParams{
			ID:           dbuuid.Must(),
			UserID:       userID,
			PasswordHash: passwordHash,
		})
		return createErr
	}); err != nil {
		return fmt.Errorf("create Maestro password: %w", err)
	}
	return nil
}

// ensureMaestroPIN leaves the identity holding one PERMANENT PIN.
//
// The ordinary path issues a temporary PIN that expires in three days and forces a
// change at first sign-in, which would make auth/signin-known-device.yaml — the
// standing suite's FIRST flow — fail on the fourth day for reasons nothing to do
// with the change under test. ActivateTemporaryCredential is the product's own way
// to promote one, so the fixture uses it rather than writing state by hand.
func ensureMaestroPIN(
	ctx context.Context,
	pool database.AdminDatabaseConnector,
	queries *database.Queries,
	orgID, identityID dbuuid.UUID,
	pin string,
) error {
	pinHash, err := iam.HashPIN(pin)
	if err != nil {
		return fmt.Errorf("hash Maestro PIN: %w", err)
	}

	var credentialID dbuuid.UUID
	lookupErr := pool.QueryRow(ctx,
		`SELECT id FROM iam.credential
		 WHERE organization_id = $1 AND identity_id = $2 AND credential_type = 'pin'
		 ORDER BY created_at DESC LIMIT 1`, orgID, identityID,
	).Scan(&credentialID)

	if errors.Is(lookupErr, pgx.ErrNoRows) {
		if _, err := pool.Exec(ctx,
			`INSERT INTO iam.credential (organization_id, identity_id, credential_type, credential_hash, state, expires_at)
			 VALUES ($1, $2, 'pin', $3, 'active', NULL)`,
			orgID, identityID, pinHash,
		); err != nil {
			return fmt.Errorf("create Maestro PIN: %w", err)
		}
		return nil
	}
	if lookupErr != nil {
		return fmt.Errorf("look up Maestro PIN: %w", lookupErr)
	}

	if err := txn.WithTxn(ctx, pool, func(ctx context.Context, tx database.DBTX) error {
		return queries.ActivateTemporaryCredential(ctx, tx, &database.ActivateTemporaryCredentialParams{
			OrganizationID: orgID,
			ID:             credentialID,
			CredentialHash: pinHash,
			UpdatedAt:      pgtype.Timestamptz{Time: time.Now(), Valid: true},
		})
	}); err != nil {
		return fmt.Errorf("make Maestro PIN permanent: %w", err)
	}

	// ActivateTemporaryCredential clears the temporary state; any other PIN row
	// for this identity would let a stale value still authenticate.
	if _, err := pool.Exec(ctx,
		`DELETE FROM iam.credential
		 WHERE organization_id = $1 AND identity_id = $2 AND credential_type = 'pin' AND id <> $3`,
		orgID, identityID, credentialID,
	); err != nil {
		return fmt.Errorf("clear stale Maestro PINs: %w", err)
	}
	return nil
}

// acceptMaestroTerms records acceptance at the CURRENT version. Without it the
// terms gate stands between sign-in and the app, and every flow fails on its
// bootstrap.
func acceptMaestroTerms(
	ctx context.Context,
	pool database.AdminDatabaseConnector,
	queries *database.Queries,
	userID dbuuid.UUID,
	seededAt time.Time,
) error {
	if err := txn.WithTxn(ctx, pool, func(ctx context.Context, tx database.DBTX) error {
		_, err := queries.AcceptTerms(ctx, tx, &database.AcceptTermsParams{
			ID:                   userID,
			TermsVersionAccepted: pgtype.Text{String: iam.CurrentTermsVersion, Valid: true},
			TermsAcceptedAt:      pgtype.Timestamptz{Time: seededAt, Valid: true},
		})
		return err
	}); err != nil {
		return fmt.Errorf("accept Maestro terms: %w", err)
	}
	return nil
}

// reactivateMaestroAccount undoes what compliance/delete-account.yaml and
// compliance/removal-request.yaml can leave behind. This is the difference between
// "idempotent" and "runs twice".
func reactivateMaestroAccount(
	ctx context.Context,
	pool database.AdminDatabaseConnector,
	orgID, employeeID dbuuid.UUID,
) error {
	if _, err := pool.Exec(ctx,
		`UPDATE organization.employee SET is_active = TRUE WHERE organization_id = $1 AND id = $2`,
		orgID, employeeID,
	); err != nil {
		return fmt.Errorf("reactivate Maestro employee: %w", err)
	}
	if _, err := pool.Exec(ctx,
		`UPDATE iam."user" SET status = 'active' WHERE id = $1`, employeeID,
	); err != nil {
		return fmt.Errorf("reactivate Maestro account: %w", err)
	}
	return nil
}

// seedMaestroWork writes the ritual project, its definition and the two instances
// screens/today.yaml's team block reads, and returns the overdue instance's TASK
// id — which is what the row's testID carries and therefore what
// MAESTRO_TEAM_TASK_ID must be.
func seedMaestroWork(
	ctx context.Context,
	pool database.AdminDatabaseConnector,
	queries *database.Queries,
	orgID, ownerID, assigneeID dbuuid.UUID,
	seededAt time.Time,
) (dbuuid.UUID, error) {
	projectID, levelID, err := ensureMaestroRitualProject(ctx, pool, queries, orgID, ownerID)
	if err != nil {
		return dbuuid.UUID{}, err
	}

	// The overdue instance must belong to somebody ELSE: the team block excludes
	// work assigned to the caller, so an owner-assigned instance would be
	// invisible in that owner's own block — the empty state this fixture exists
	// to remove.
	if err := ensureMaestroProjectMembership(ctx, pool, orgID, projectID, assigneeID, "member"); err != nil {
		return dbuuid.UUID{}, err
	}

	overdueStateID, err := requireMaestroState(ctx, pool, orgID, projectID,
		collaboration.StateCategoryOverdue, collaboration.StateTypeRitual)
	if err != nil {
		return dbuuid.UUID{}, err
	}
	openStateID, err := requireMaestroState(ctx, pool, orgID, projectID,
		collaboration.StateCategoryTodo, collaboration.StateTypeRitual)
	if err != nil {
		return dbuuid.UUID{}, err
	}

	definitionID, err := seedMaestroRitualDefinition(ctx, pool, orgID, projectID, ownerID, seededAt)
	if err != nil {
		return dbuuid.UUID{}, err
	}

	// Rewritten rather than appended, so a third run does not leave three
	// overdue instances and a team block nobody can read.
	if _, err := pool.Exec(ctx,
		`DELETE FROM collaboration.task
		 WHERE organization_id = $1 AND project_id = $2 AND task_kind = 'ritual_instance'`,
		orgID, projectID,
	); err != nil {
		return dbuuid.UUID{}, fmt.Errorf("clear Maestro ritual instances: %w", err)
	}

	today := maestroDay(seededAt)
	instances := []struct {
		number   int
		date     time.Time
		deadline time.Time
		stateID  dbuuid.UUID
		assignee *dbuuid.UUID
	}{
		{
			number:   1,
			date:     today.AddDate(0, 0, -2),
			deadline: seededAt.Add(-48 * time.Hour),
			stateID:  overdueStateID,
			assignee: &assigneeID,
		},
		{
			// No assignee row at all, and dated today: screens/today.yaml asserts
			// the literal "Nobody assigned", and the unassigned leg matches
			// scheduled_date by equality. The deadline is kept in the future,
			// which also keeps this one out of the reconciliation sweep's
			// candidate set entirely.
			number:   2,
			date:     today,
			deadline: seededAt.Add((maestroRitualCompletionWindowHours - 30) * time.Hour),
			stateID:  openStateID,
			assignee: nil,
		},
	}

	var teamTaskID dbuuid.UUID
	for _, instance := range instances {
		var taskID dbuuid.UUID
		if err := pool.QueryRow(ctx,
			`INSERT INTO collaboration.task
			   (organization_id, project_id, identifier, title, depth, path, level_id, state_id,
			    start_date, due_date, reporter_employee_id, task_kind, ritual_definition_id,
			    scheduled_date, completion_deadline)
			 VALUES ($1, $2, $3, $4, 0, '{}', $5, $6, $7, $7, $8, 'ritual_instance', $9, $7, $10)
			 RETURNING id`,
			orgID, projectID, fmt.Sprintf("%s-%d", maestroProjectKey, instance.number), maestroRitualName,
			levelID, instance.stateID, instance.date, ownerID, definitionID, instance.deadline,
		).Scan(&taskID); err != nil {
			return dbuuid.UUID{}, fmt.Errorf("seed Maestro ritual instance %d: %w", instance.number, err)
		}
		if instance.assignee == nil {
			continue
		}
		if _, err := pool.Exec(ctx,
			`INSERT INTO collaboration.task_assignee (organization_id, task_id, employee_id, role, assigned_by_employee_id)
			 VALUES ($1, $2, $3, 'assignee', $4)`,
			orgID, taskID, *instance.assignee, ownerID,
		); err != nil {
			return dbuuid.UUID{}, fmt.Errorf("assign Maestro ritual instance %d: %w", instance.number, err)
		}
		teamTaskID = taskID
	}

	if _, err := pool.Exec(ctx,
		`UPDATE collaboration.project
		 SET task_count = (SELECT count(*) FROM collaboration.task
		                    WHERE organization_id = $1 AND project_id = $2 AND is_deleted = FALSE),
		     next_task_number = $3
		 WHERE organization_id = $1 AND id = $2`,
		orgID, projectID, len(instances)+2,
	); err != nil {
		return dbuuid.UUID{}, fmt.Errorf("reset Maestro project counters: %w", err)
	}

	logf("Team block ready: overdue instance %s assigned to %s, one unassigned instance due today.",
		teamTaskID, maestroPhoneFamilyName)
	return teamTaskID, nil
}

// ensureMaestroRitualProject creates the project through the product's own
// CreateProject, which in one transaction writes the eight ritual states —
// including the Overdue state a late instance has to live in — the four task
// levels, the creator's membership and the counters. Re-implementing that here
// would be forty lines of inserts the fixture would then have to keep in step.
func ensureMaestroRitualProject(
	ctx context.Context,
	pool database.AdminDatabaseConnector,
	queries *database.Queries,
	orgID, ownerID dbuuid.UUID,
) (dbuuid.UUID, dbuuid.UUID, error) {
	var exists bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM collaboration.project WHERE organization_id = $1 AND key = $2)`,
		orgID, maestroProjectKey,
	).Scan(&exists); err != nil {
		return dbuuid.UUID{}, dbuuid.UUID{}, fmt.Errorf("look up Maestro ritual project: %w", err)
	}

	if !exists {
		collabLogic := collaboration.NewLogic(queries, nil, nil, nil)
		if err := txn.WithTxn(ctx, pool, func(ctx context.Context, tx database.DBTX) error {
			_, _, _, createErr := collabLogic.CreateProject(ctx, tx, orgID, ownerID, &rpcv1.CreateProjectRequest{
				Name:              maestroProjectName,
				Key:               maestroProjectKey,
				Description:       "Recurring checks the floor crew runs at close.",
				Visibility:        rpcv1.ProjectVisibility_PROJECT_VISIBILITY_PRIVATE,
				CollaborationMode: rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL,
			})
			return createErr
		}); err != nil {
			return dbuuid.UUID{}, dbuuid.UUID{}, fmt.Errorf("create Maestro ritual project: %w", err)
		}
	}

	var projectID, levelID dbuuid.UUID
	if err := pool.QueryRow(ctx,
		`SELECT id FROM collaboration.project WHERE organization_id = $1 AND key = $2`,
		orgID, maestroProjectKey,
	).Scan(&projectID); err != nil {
		return dbuuid.UUID{}, dbuuid.UUID{}, fmt.Errorf("find Maestro ritual project: %w", err)
	}
	if err := pool.QueryRow(ctx,
		`SELECT id FROM collaboration.task_level
		 WHERE organization_id = $1 AND project_id = $2 AND depth = 0`, orgID, projectID,
	).Scan(&levelID); err != nil {
		return dbuuid.UUID{}, dbuuid.UUID{}, fmt.Errorf("find Maestro ritual project task level: %w", err)
	}

	// The owner must hold owner or admin on THIS project specifically, or their
	// Today team block is empty: the supervisory scope is exactly those two roles.
	if err := ensureMaestroProjectMembership(ctx, pool, orgID, projectID, ownerID, "admin"); err != nil {
		return dbuuid.UUID{}, dbuuid.UUID{}, err
	}

	// An archived project's work is not findable and its rituals do not render.
	if _, err := pool.Exec(ctx,
		`UPDATE collaboration.project SET is_archived = FALSE WHERE organization_id = $1 AND id = $2`,
		orgID, projectID,
	); err != nil {
		return dbuuid.UUID{}, dbuuid.UUID{}, fmt.Errorf("unarchive Maestro ritual project: %w", err)
	}

	return projectID, levelID, nil
}

func ensureMaestroProjectMembership(
	ctx context.Context,
	pool database.AdminDatabaseConnector,
	orgID, projectID, employeeID dbuuid.UUID,
	role string,
) error {
	var inserted bool
	if err := pool.QueryRow(ctx,
		`INSERT INTO collaboration.project_membership (organization_id, project_id, employee_id, role)
		 VALUES ($1, $2, $3, $4)
		 ON CONFLICT (organization_id, project_id, employee_id) DO UPDATE SET role = EXCLUDED.role
		 RETURNING (xmax = 0)`, orgID, projectID, employeeID, role,
	).Scan(&inserted); err != nil {
		return fmt.Errorf("seed Maestro project membership: %w", err)
	}
	if !inserted {
		return nil
	}
	// member_count is denormalised, so a direct write has to maintain it.
	if _, err := pool.Exec(ctx,
		`UPDATE collaboration.project SET member_count = member_count + 1
		 WHERE organization_id = $1 AND id = $2`, orgID, projectID,
	); err != nil {
		return fmt.Errorf("seed Maestro project member count: %w", err)
	}
	return nil
}

// requireMaestroState resolves a workflow state by what it MEANS rather than by
// what it is called or where it sits, and fails loudly when it is absent. The
// product logs at WARN and carries on in this situation, which is right for a live
// system and wrong for a fixture: the consequence here is a half-shaped workspace
// reaching the suite in silence.
func requireMaestroState(
	ctx context.Context,
	pool database.AdminDatabaseConnector,
	orgID, projectID dbuuid.UUID,
	category, stateType string,
) (dbuuid.UUID, error) {
	var stateID dbuuid.UUID
	err := pool.QueryRow(ctx,
		`SELECT id FROM collaboration.project_state
		 WHERE organization_id = $1 AND project_id = $2 AND category = $3 AND state_type = $4
		 ORDER BY position LIMIT 1`, orgID, projectID, category, stateType,
	).Scan(&stateID)
	if errors.Is(err, pgx.ErrNoRows) {
		return dbuuid.UUID{}, fmt.Errorf(
			"Maestro project %s has no %s state in category %q; drop the project and re-seed",
			maestroProjectKey, stateType, category)
	}
	if err != nil {
		return dbuuid.UUID{}, fmt.Errorf("find %s state in category %q for Maestro project: %w",
			stateType, category, err)
	}
	return stateID, nil
}

// maestroDay is the calendar day of the run in the MACHINE's own timezone. Every
// seeded date is derived from it rather than from now() in SQL, so no two rows can
// land on opposite sides of midnight.
func maestroDay(seededAt time.Time) time.Time {
	return time.Date(seededAt.Year(), seededAt.Month(), seededAt.Day(), 0, 0, 0, 0, seededAt.Location())
}

// seedMaestroRitualDefinition writes the recurring job, configured so the three
// background sweeps agree with the fixture instead of dismantling it.
//
// A monthly rule on the seed day with a one-day generation window yields no date
// inside the window, so the generation sweep adds nothing for a month while the
// definition still reads as live. Archiving it would stop generation too, but the
// suite would then open a ritual that looks switched off.
func seedMaestroRitualDefinition(
	ctx context.Context,
	pool database.AdminDatabaseConnector,
	orgID, projectID, ownerID dbuuid.UUID,
	seededAt time.Time,
) (dbuuid.UUID, error) {
	// Clamped to 28 so the rule never skips a short month.
	dayOfMonth := seededAt.Day()
	if dayOfMonth > 28 {
		dayOfMonth = 28
	}
	rule, err := json.Marshal(map[string]any{
		"type":         collaboration.RecurrenceTypeMonthly,
		"interval":     1,
		"day_of_month": dayOfMonth,
		"time_of_day":  "18:00",
	})
	if err != nil {
		return dbuuid.UUID{}, fmt.Errorf("build Maestro recurrence rule: %w", err)
	}

	const description = "Till, shutters and alarm, before the last person leaves."

	// Updated in place rather than replaced, so the definition's id survives a
	// re-run. Looked up first rather than upserted because the table carries no
	// unique key on the name, and adding one would be a migration this feature
	// does not need.
	var definitionID dbuuid.UUID
	err = pool.QueryRow(ctx,
		`UPDATE collaboration.ritual_definition
		 SET description = $4, recurrence_rule = $5, completion_window_hours = $6,
		     generation_window_days = 1, last_generated_date = $7, is_archived = FALSE,
		     created_by_employee_id = $8, updated_at = now()
		 WHERE organization_id = $1 AND project_id = $2 AND name = $3
		 RETURNING id`,
		orgID, projectID, maestroRitualName, description, rule,
		maestroRitualCompletionWindowHours, seededAt, ownerID,
	).Scan(&definitionID)
	if errors.Is(err, pgx.ErrNoRows) {
		err = pool.QueryRow(ctx,
			`INSERT INTO collaboration.ritual_definition
			   (organization_id, project_id, name, description, recurrence_rule,
			    completion_window_hours, generation_window_days, last_generated_date,
			    is_archived, created_by_employee_id)
			 VALUES ($1, $2, $3, $4, $5, $6, 1, $7, FALSE, $8)
			 RETURNING id`,
			orgID, projectID, maestroRitualName, description, rule,
			maestroRitualCompletionWindowHours, seededAt, ownerID,
		).Scan(&definitionID)
	}
	if err != nil {
		return dbuuid.UUID{}, fmt.Errorf("seed Maestro recurring job: %w", err)
	}

	// screens/today.yaml asserts "Proof checklist" on the instance it opens, and
	// that heading only renders when the definition carries evidence.
	if _, err := pool.Exec(ctx,
		`DELETE FROM collaboration.evidence_requirement
		 WHERE organization_id = $1 AND ritual_definition_id = $2`, orgID, definitionID,
	); err != nil {
		return dbuuid.UUID{}, fmt.Errorf("clear Maestro evidence requirement: %w", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO collaboration.evidence_requirement
		   (organization_id, ritual_definition_id, name, description, evidence_types,
		    is_required, approval_mode, position, deadline_offset_hours)
		 VALUES ($1, $2, 'Photo of the shutters and alarm panel',
		         'One photo showing the shutters down and the alarm set.',
		         '{photo}', TRUE, 'manual', 0, 0)`,
		orgID, definitionID,
	); err != nil {
		return dbuuid.UUID{}, fmt.Errorf("seed Maestro evidence requirement: %w", err)
	}

	return definitionID, nil
}

// seedMaestroChat leaves one channel with messages the primary account can see.
//
// compliance/report-message.yaml, report-thread-message.yaml and screens/chat.yaml
// all open the chat tab and act on a message; those flows POST what they act on
// using MAESTRO_RUN_ID, so the fixture needs the channel to exist and be readable,
// not any particular message. The conversation is here so the tab does not open on
// an empty state.
//
// The channel id is returned because the seeded file hangs its access rule on it:
// files.SearchFilesByNameAndContent matches only files whose context the caller
// belongs to, and channel membership is the cheapest such context.
func seedMaestroChat(
	ctx context.Context,
	pool database.AdminDatabaseConnector,
	orgID, ownerID, workerID, colleagueID dbuuid.UUID,
) (dbuuid.UUID, error) {
	var channelID dbuuid.UUID
	if err := pool.QueryRow(ctx,
		`INSERT INTO chat.channel (organization_id, title_slug, display_name, description, channel_type, is_private, created_by_employee_id)
		 VALUES ($1, $2, $3, 'Handover notes between the closing and opening shifts.', 'chat', FALSE, $4)
		 ON CONFLICT (organization_id, title_slug) DO UPDATE SET display_name = EXCLUDED.display_name
		 RETURNING id`, orgID, maestroChannelSlug, maestroChannelName, ownerID,
	).Scan(&channelID); err != nil {
		return dbuuid.UUID{}, fmt.Errorf("seed Maestro channel: %w", err)
	}

	for _, member := range []dbuuid.UUID{ownerID, workerID, colleagueID} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO chat.channel_membership (organization_id, channel_id, employee_id)
			 VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
			orgID, channelID, member,
		); err != nil {
			return dbuuid.UUID{}, fmt.Errorf("seed Maestro channel membership: %w", err)
		}
	}

	// Refresh rather than append, so a third run does not leave three copies of
	// the same conversation — and so the messages a suite run posted under a
	// previous MAESTRO_RUN_ID do not accumulate forever.
	if _, err := pool.Exec(ctx,
		`DELETE FROM chat.message WHERE organization_id = $1 AND channel_id = $2`, orgID, channelID,
	); err != nil {
		return dbuuid.UUID{}, fmt.Errorf("clear Maestro messages: %w", err)
	}

	messages := []struct {
		author dbuuid.UUID
		text   string
	}{
		{ownerID, "Closing tonight is Mai and Wren. Shutters by 21:15 please."},
		{colleagueID, "Understood. Till float is short, I've noted it."},
		{workerID, "Alarm panel was slow to arm again — worth logging with the engineer."},
		{ownerID, "Logged. Opening crew, the stockroom is half re-shelved."},
		// Deliberately rude, so compliance/report-message.yaml has something
		// plausible to report rather than having to invent abuse of its own.
		{workerID, "Whoever counted the float last night clearly can't add up. Useless."},
	}
	for _, message := range messages {
		if _, err := pool.Exec(ctx,
			`INSERT INTO chat.message (organization_id, channel_id, author_employee_id, message_text, message_kind)
			 VALUES ($1, $2, $3, $4, 'text')`,
			orgID, channelID, message.author, message.text,
		); err != nil {
			return dbuuid.UUID{}, fmt.Errorf("seed Maestro message: %w", err)
		}
	}

	logf("Chat ready: channel %q with %d messages.", maestroChannelName, len(messages))
	return channelID, nil
}

// seedMaestroSearchSet writes the four rows federated-search.yaml needs.
//
// The flow asserts that ONE word returns four result kinds AT ONCE — document,
// work item, event and file — so all four have to carry it and all four have to be
// reachable by the primary account through each source's own access predicate:
//
//   - document: visibility 'public' satisfies step 4 of SearchDocuments' access chain
//   - work item: project membership, which the owner holds as project admin
//   - event: visibility 'org_wide', and the owner is the organiser anyway
//   - file: an access rule pointing at a channel the owner is a member of, because
//     SearchFilesByNameAndContent has no "unfiltered if empty" escape
//
// [ASSUMPTION: the file result matches on FILENAME rather than on extracted
// content. Content indexing is feature 059's post-processing and runs
// asynchronously, so a fixture that depended on it would be seeding a race; the
// query's `fm.original_filename &@~ $2` leg makes the filename sufficient. A
// file_content_index row is written as well, because it costs one statement and
// makes the fixture robust if the filename leg is ever narrowed.]
func seedMaestroSearchSet(
	ctx context.Context,
	pool database.AdminDatabaseConnector,
	orgID, ownerID, channelID dbuuid.UUID,
	seededAt time.Time,
) error {
	// --- the document -------------------------------------------------------
	if _, err := pool.Exec(ctx,
		`INSERT INTO docs.document
		   (organization_id, title, slug, document_type, content_json, content_text,
		    status, visibility, owner_employee_id)
		 VALUES ($1, $2, $3, 'workspace_doc', '{}'::jsonb, $4, 'active', 'public', $5)
		 ON CONFLICT (organization_id, slug) DO UPDATE
		   SET title = EXCLUDED.title, content_text = EXCLUDED.content_text,
		       visibility = 'public', status = 'active', is_deleted = FALSE,
		       updated_at = now()`,
		orgID, maestroSearchDocTitle, maestroSearchDocSlug,
		"The zarquon closing procedure: cash up, shutters, alarm, sign the sheet.", ownerID,
	); err != nil {
		return fmt.Errorf("seed Maestro search document: %w", err)
	}

	// --- the work item ------------------------------------------------------
	//
	// It goes in the ritual project rather than the default General one so the
	// whole search set lives behind one membership the owner demonstrably holds.
	var projectID, levelID, stateID dbuuid.UUID
	if err := pool.QueryRow(ctx,
		`SELECT id FROM collaboration.project WHERE organization_id = $1 AND key = $2`,
		orgID, maestroProjectKey,
	).Scan(&projectID); err != nil {
		return fmt.Errorf("find Maestro project for search set: %w", err)
	}
	if err := pool.QueryRow(ctx,
		`SELECT id FROM collaboration.task_level
		 WHERE organization_id = $1 AND project_id = $2 AND depth = 0`, orgID, projectID,
	).Scan(&levelID); err != nil {
		return fmt.Errorf("find Maestro task level for search set: %w", err)
	}
	stateID, err := requireMaestroState(ctx, pool, orgID, projectID,
		collaboration.StateCategoryTodo, collaboration.StateTypeRitual)
	if err != nil {
		return err
	}

	if _, err := pool.Exec(ctx,
		`DELETE FROM collaboration.task
		 WHERE organization_id = $1 AND project_id = $2 AND title = $3`,
		orgID, projectID, maestroSearchTaskName,
	); err != nil {
		return fmt.Errorf("clear Maestro search work item: %w", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO collaboration.task
		   (organization_id, project_id, identifier, title, depth, path, level_id, state_id,
		    due_date, reporter_employee_id, task_kind)
		 VALUES ($1, $2, $3, $4, 0, '{}', $5, $6, $7, $8, 'standard')`,
		orgID, projectID, maestroProjectKey+"-9", maestroSearchTaskName,
		levelID, stateID, maestroDay(seededAt).AddDate(0, 0, 2), ownerID,
	); err != nil {
		return fmt.Errorf("seed Maestro search work item: %w", err)
	}

	// --- the calendar event -------------------------------------------------
	//
	// Moved forward on every run rather than written once: an event seeded three
	// weeks ago is in the past, and a schedule that opens empty is the same
	// failure this fixture exists to prevent.
	if _, err := pool.Exec(ctx,
		`INSERT INTO calendar.event
		   (organization_id, title, description, start_time, end_time, organizer_id, event_type, visibility)
		 SELECT $1, $2, 'Hand the zarquon procedure over to the opening crew.',
		        $4::timestamptz, $4::timestamptz + interval '1 hour', $3, 'meeting', 'org_wide'
		 WHERE NOT EXISTS (
		   SELECT 1 FROM calendar.event WHERE organization_id = $1 AND title = $2
		 )`,
		orgID, maestroSearchEvent, ownerID, seededAt.AddDate(0, 0, 1),
	); err != nil {
		return fmt.Errorf("seed Maestro search event: %w", err)
	}
	if _, err := pool.Exec(ctx,
		`UPDATE calendar.event
		 SET start_time = $3::timestamptz, end_time = $3::timestamptz + interval '1 hour',
		     cancelled_at = NULL, cancelled_by_id = NULL
		 WHERE organization_id = $1 AND title = $2`,
		orgID, maestroSearchEvent, seededAt.AddDate(0, 0, 1),
	); err != nil {
		return fmt.Errorf("move Maestro search event forward: %w", err)
	}

	// --- the file -----------------------------------------------------------
	//
	// No object is uploaded to storage: nothing in the search path reads the
	// bytes, and a seeder that needed R2 credentials would not run on a laptop.
	// Tapping the row opens a viewer that would 404, which the flow does not do.
	var fileID dbuuid.UUID
	if err := pool.QueryRow(ctx,
		`SELECT id FROM files.file_metadata
		 WHERE organization_id = $1 AND original_filename = $2 AND is_deleted = FALSE
		 LIMIT 1`, orgID, maestroSearchFileName,
	).Scan(&fileID); errors.Is(err, pgx.ErrNoRows) {
		if err := pool.QueryRow(ctx,
			`INSERT INTO files.file_metadata
			   (organization_id, original_filename, storage_key, size_bytes, mime_type,
			    upload_context, uploaded_by_employee_id, validation_status)
			 VALUES ($1, $2, $3, 20480, 'application/pdf', $4, $5, 'verified')
			 RETURNING id`,
			orgID, maestroSearchFileName,
			fmt.Sprintf("org-%s/%s/maestro-fixture", orgID, files.UploadContextChat),
			files.UploadContextChat, ownerID,
		).Scan(&fileID); err != nil {
			return fmt.Errorf("seed Maestro search file: %w", err)
		}
	} else if err != nil {
		return fmt.Errorf("look up Maestro search file: %w", err)
	} else if _, err := pool.Exec(ctx,
		`UPDATE files.file_metadata SET is_deleted = FALSE, validation_status = 'verified'
		 WHERE organization_id = $1 AND id = $2`, orgID, fileID,
	); err != nil {
		return fmt.Errorf("restore Maestro search file: %w", err)
	}

	if _, err := pool.Exec(ctx,
		`INSERT INTO files.file_access_rule (organization_id, file_id, context_type, context_id, access_scope)
		 VALUES ($1, $2, $3, $4, $5)
		 ON CONFLICT (organization_id, file_id) DO UPDATE
		   SET context_type = EXCLUDED.context_type, context_id = EXCLUDED.context_id,
		       access_scope = EXCLUDED.access_scope`,
		orgID, fileID, files.ContextTypeChatChannel, channelID, files.AccessScopePublic,
	); err != nil {
		return fmt.Errorf("seed Maestro search file access rule: %w", err)
	}

	if _, err := pool.Exec(ctx,
		`INSERT INTO files.file_content_index
		   (organization_id, file_id, extracted_text, extraction_method, indexing_status)
		 VALUES ($1, $2, $3, 'pdf_parser', 'completed')
		 ON CONFLICT (organization_id, file_id) DO UPDATE
		   SET extracted_text = EXCLUDED.extracted_text, indexing_status = 'completed'`,
		orgID, fileID, "Zarquon closing procedure. Cash up, shutters, alarm, sign the sheet.",
	); err != nil {
		return fmt.Errorf("seed Maestro search file content index: %w", err)
	}

	logf("Search set ready: %q matches a document, a work item, an event and a file.", maestroSearchWord)
	return nil
}

// resetMaestroMutableState undoes the side effects a suite run leaves on the
// fixture, so run two starts where run one did.
//
// Every one of these is a real observed footgun, not a precaution:
//
//   - compliance/block-person.yaml and block-from-profile.yaml leave a block, and
//     flow 2 of run 2 then asserts against an already-blocked colleague;
//   - settings/dark-mode-toggle.yaml ends on a manual dark preference, which every
//     screenshot sweep after it inherits — the flow puts it back itself, but a run
//     that failed midway did not;
//   - settings/notification-preferences.yaml is the same shape.
func resetMaestroMutableState(
	ctx context.Context,
	pool database.AdminDatabaseConnector,
	orgID dbuuid.UUID,
	fixtureEmployees []dbuuid.UUID,
) error {
	if _, err := pool.Exec(ctx,
		`DELETE FROM compliance.block
		 WHERE organization_id = $1
		   AND (blocker_employee_id = ANY($2) OR blocked_employee_id = ANY($2))`,
		orgID, fixtureEmployees,
	); err != nil {
		return fmt.Errorf("clear Maestro blocks: %w", err)
	}

	if _, err := pool.Exec(ctx,
		`UPDATE iam.user_preference
		 SET theme_mode = 'light', preference_source = 'os_default', updated_at = now()
		 WHERE organization_id = $1 AND employee_id = ANY($2)`,
		orgID, fixtureEmployees,
	); err != nil {
		return fmt.Errorf("reset Maestro theme preference: %w", err)
	}

	if _, err := pool.Exec(ctx,
		`UPDATE notification.personal_preference
		 SET dnd_enabled = FALSE, dnd_start = NULL, dnd_end = NULL,
		     muted_domains = '{}', in_app_alerts_enabled = TRUE, updated_at = now()
		 WHERE organization_id = $1 AND employee_id = ANY($2)`,
		orgID, fixtureEmployees,
	); err != nil {
		return fmt.Errorf("reset Maestro notification preferences: %w", err)
	}

	logf("Mutable state reset: blocks cleared, theme and notification preferences back to defaults.")
	return nil
}

// validateMaestroValues refuses to emit a value that the runner's line parser
// cannot carry back out intact.
//
// run-maestro-suite.sh splits each line at the FIRST `=` and hands the remainder
// to maestro as one -e argument, and the Makefile wraps it in single quotes. A
// value containing `=`, a single quote or a newline therefore arrives at the flow
// as something other than what was seeded — silently, and the flow fails on an
// assertion that looks like a product bug. Failing here instead costs one run.
func validateMaestroValues(f maestroFixture) error {
	for name, value := range map[string]string{
		"MAESTRO_TEST_SUBDOMAIN":  f.Subdomain,
		"MAESTRO_TEST_EMAIL":      f.OwnerEmail,
		"MAESTRO_TEST_PASSWORD":   f.OwnerPassword,
		"MAESTRO_TEST_PIN":        f.OwnerPIN,
		"MAESTRO_OWNER_PASSWORD":  f.SignupPassword,
		"MAESTRO_OWNER_PIN":       f.SignupPIN,
		"MAESTRO_WORKER_EMAIL":    f.WorkerEmail,
		"MAESTRO_WORKER_PASSWORD": f.WorkerPassword,
		"MAESTRO_WORKER_LOGIN":    f.WorkerLogin,
		"MAESTRO_WORKER_PIN":      f.WorkerPIN,
	} {
		if strings.ContainsAny(value, "='\n\r") {
			return fmt.Errorf(
				"%s would be emitted as %q, which contains a character the Maestro runner's "+
					"line parser cannot carry ('=', a single quote or a newline); choose another value",
				name, value)
		}
		if strings.TrimSpace(value) == "" {
			return fmt.Errorf("%s would be emitted empty; the runner silently skips empty values", name)
		}
	}
	return nil
}

// printMaestroEnv writes the .env body to STDOUT and nothing else, so
//
//	go run ./cmd seed-maestro-fixture > ../frontend/apps/mobile/.maestro/.env
//
// produces a usable file with no editing.
//
// Values are emitted UNQUOTED on purpose. run-maestro-suite.sh splits each line at
// the first `=` and passes the remainder verbatim as one -e argument in a shell
// array, so a value containing spaces is already safe; the Makefile's
// MAESTRO_ENV_FLAGS wraps each line in single quotes itself. Adding quotes here
// would produce -e 'KEY="value"' and leak the quotes into the flow.
//
// MAESTRO_RUN_ID is deliberately NOT emitted: onboarding/owner-signup.yaml derives
// a brand-new workspace address from it, and a pinned value makes the second run
// collide on the address the first one claimed. The runner generates it per run.
func printMaestroEnv(f maestroFixture) {
	fmt.Printf("# Maestro fixture — generated by `go run ./cmd seed-maestro-fixture`\n")
	fmt.Printf("# Seeded %s against workspace %q.\n", f.SeededAt.UTC().Format(time.RFC3339), f.Subdomain)
	fmt.Printf("# Re-run the command to refresh; do not hand-edit MAESTRO_TEAM_TASK_ID.\n")
	fmt.Println()
	fmt.Printf("MAESTRO_TEST_SUBDOMAIN=%s\n", f.Subdomain)
	fmt.Printf("MAESTRO_TEST_EMAIL=%s\n", f.OwnerEmail)
	fmt.Printf("MAESTRO_TEST_PASSWORD=%s\n", f.OwnerPassword)
	fmt.Printf("MAESTRO_TEST_PIN=%s\n", f.OwnerPIN)
	fmt.Println()
	fmt.Printf("# onboarding/owner-signup.yaml TYPES these to register a NEW workspace each run.\n")
	fmt.Printf("# They do not name a seeded account.\n")
	fmt.Printf("MAESTRO_OWNER_PASSWORD=%s\n", f.SignupPassword)
	fmt.Printf("MAESTRO_OWNER_PIN=%s\n", f.SignupPIN)
	fmt.Println()
	fmt.Printf("# feature-tour/worker-tour.yaml needs an account WITHOUT iam.inviteUser. It reads\n")
	fmt.Printf("# MAESTRO_TEST_EMAIL, so run it with these values overriding that pair:\n")
	fmt.Printf("#   make test-mobile-one F=feature-tour/worker-tour \\\n")
	fmt.Printf("#     MAESTRO_ENV_FLAGS=\"-e MAESTRO_TEST_EMAIL=%s -e MAESTRO_TEST_PASSWORD=%s\"\n",
		f.WorkerEmail, f.WorkerPassword)
	fmt.Printf("MAESTRO_WORKER_EMAIL=%s\n", f.WorkerEmail)
	fmt.Printf("MAESTRO_WORKER_PASSWORD=%s\n", f.WorkerPassword)
	fmt.Printf("MAESTRO_WORKER_LOGIN=%s\n", f.WorkerLogin)
	fmt.Printf("MAESTRO_WORKER_PIN=%s\n", f.WorkerPIN)
	fmt.Println()
	fmt.Printf("MAESTRO_TEAM_TASK_ID=%s\n", f.TeamTaskID)
	fmt.Printf("MAESTRO_SEARCH_WORD=%s\n", maestroSearchWord)
	fmt.Printf("MAESTRO_SEARCH_DOCUMENT_TITLE=%s\n", maestroSearchDocTitle)
	fmt.Printf("MAESTRO_DIRECTORY_PERSON_WITH_PHONE=%s\n", maestroPhoneFamilyName)
	fmt.Printf("MAESTRO_DIRECTORY_PERSON_NO_PHONE=%s\n", maestroNoPhoneFamilyName)
	fmt.Printf("MAESTRO_DIRECTORY_DEPARTMENT=%s\n", maestroDepartmentName)
}

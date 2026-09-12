package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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
	"github.com/nvcnvn/tech-office/backend/internal/iam"
	"github.com/nvcnvn/tech-office/backend/internal/organization"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// SeedDemoOrgCommand builds the workspace an App Store or Play reviewer signs into
// (Feature 036 FR-031, Feature 055).
//
// Idempotent by design: a re-run refreshes the content of the existing workspace
// rather than creating a second one. Store review calendars are external and
// unforgiving, so the command has to be safe to run again the morning of a
// resubmission without inventing a second "demo" org nobody can find.
//
// It leaves behind two things a reviewer needs and one earlier version could not
// give them: a second self-registered owner, so the account deletion they are
// asked to demonstrate is accepted rather than refused by the sole-owner guard;
// and enough work — six items and a recurring job with two instances — that none
// of the four mobile tabs opens on an empty state.
var SeedDemoOrgCommand = &cli.Command{
	Name:  "seed-demo-org",
	Usage: "Create or refresh the demo workspace used for App Store and Play review",
	Flags: []cli.Flag{
		&cli.StringFlag{
			Name:  "subdomain",
			Usage: "Workspace address for the demo organization",
			Value: "demo",
		},
		&cli.StringFlag{
			Name:  "owner-password",
			Usage: "Password for the self-registered demo owner",
			Value: "ReviewDemo1!",
		},
		&cli.StringFlag{
			Name:  "spare-password",
			Usage: "Password for the spare demo owner the reviewer deletes (defaults to --owner-password)",
		},
		&cli.StringFlag{
			Name:  "worker-pin",
			Usage: "Permanent PIN for the demo worker",
			Value: "473829",
		},
	},
	Action: seedDemoOrg,
}

const (
	demoOwnerGivenName  = "Ana"
	demoOwnerFamilyName = "Reviewer"
	demoSpareGivenName  = "Ben"
	demoSpareFamilyName = "Keeler"
	demoWorkerLogin     = "demo-worker"
	demoChannelSlug     = "site-updates"
	demoGenProjectKey   = "GEN"
	demoOpsProjectKey   = "OPS"
	demoRitualName      = "Open-up checks"

	// 30 days of grace, so the reconciliation sweep re-derives "overdue" rather
	// than writing the late instance off as "missed" — which is a closed state,
	// and would empty Today, My Work and the Team block within five minutes of
	// the seed landing. See specs/055 research R5.
	demoRitualCompletionWindowHours = 720
)

type demoSeedResult struct {
	OrganizationID dbuuid.UUID
	Subdomain      string
	OwnerEmail     string
	OwnerPassword  string
	SpareEmail     string
	SparePassword  string
	WorkerLogin    string
	WorkerPIN      string
	Created        bool
}

func seedDemoOrg(ctx context.Context, cmd *cli.Command) error {
	cfg := config.Get()
	subdomain := strings.ToLower(strings.TrimSpace(cmd.String("subdomain")))
	ownerPassword := cmd.String("owner-password")
	workerPIN := cmd.String("worker-pin")
	ownerEmail := fmt.Sprintf("owner@%s.demo.invalid", subdomain)
	spareEmail := fmt.Sprintf("spare@%s.demo.invalid", subdomain)

	sparePassword := cmd.String("spare-password")
	if strings.TrimSpace(sparePassword) == "" {
		// One password in the reviewer notes unless somebody deliberately wants two.
		sparePassword = ownerPassword
	}

	// One clock for the whole run. Every seeded date is relative to this instant,
	// so a re-seed the morning of a resubmission produces content that reads as
	// current, and no two helpers can land on opposite sides of midnight.
	seededAt := time.Now()

	adminPool, err := database.NewAdminPool(ctx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("connect to database: %w", err)
	}
	defer adminPool.Close()

	queries := database.New()
	result := demoSeedResult{
		Subdomain:     subdomain,
		OwnerEmail:    ownerEmail,
		OwnerPassword: ownerPassword,
		SpareEmail:    spareEmail,
		SparePassword: sparePassword,
		WorkerLogin:   demoWorkerLogin,
		WorkerPIN:     workerPIN,
	}

	// --- 1. The organization and its owner -----------------------------------
	//
	// The owner is a *self-registered* account on purpose: it is the only kind
	// whose settings screen shows the full deletion path, which is the thing a
	// reviewer is most likely to be looking for (research.md R12).
	existing, err := queries.GetOrganizationBySubdomain(ctx, adminPool, subdomain)
	switch {
	case err == nil:
		result.OrganizationID = existing.ID
		fmt.Printf("Reusing existing demo workspace %q (%s)\n", subdomain, existing.ID)
	case errors.Is(err, pgx.ErrNoRows):
		orgLogic := organization.NewOrganizationLogic(queries, cfg.WebappURL)
		orgLogic.SetCollaborationLogic(collaboration.NewLogic(queries, nil, nil, nil))

		var created *database.Organization
		if txErr := txn.WithTxn(ctx, adminPool, func(ctx context.Context, tx database.DBTX) error {
			var registerErr error
			created, registerErr = orgLogic.RegisterOrganizationWithAdmin(ctx, tx, &organization.RegisterOrgParams{
				CompanyName:          "Demo Builders",
				Subdomain:            subdomain,
				AdminEmail:           ownerEmail,
				AdminPassword:        ownerPassword,
				AdminGivenName:       demoOwnerGivenName,
				AdminFamilyName:      demoOwnerFamilyName,
				AcceptedTermsVersion: iam.CurrentTermsVersion,
			})
			return registerErr
		}); txErr != nil {
			return fmt.Errorf("register demo organization: %w", txErr)
		}
		result.OrganizationID = created.ID
		result.Created = true
		fmt.Printf("Created demo workspace %q (%s)\n", subdomain, created.ID)
	default:
		return fmt.Errorf("look up demo organization: %w", err)
	}

	ownerID, err := demoOwnerID(ctx, adminPool, result.OrganizationID, ownerEmail)
	if err != nil {
		return err
	}

	// --- 2. The PIN worker ---------------------------------------------------
	workerID, err := ensureDemoWorker(ctx, adminPool, queries, result.OrganizationID, ownerID, workerPIN)
	if err != nil {
		return err
	}

	// --- 3. The spare owner, which is the account a reviewer deletes ----------
	spareID, err := ensureDemoSpareOwner(ctx, adminPool, queries, result.OrganizationID, seededAt, spareEmail, sparePassword)
	if err != nil {
		return err
	}

	// --- 4. Content worth reviewing -----------------------------------------
	//
	// The work goes first and the conversation second, but nothing depends on that
	// order any more: fk_task_source_message is ON DELETE SET NULL (source_message_id),
	// so clearing the conversation nulls a captured task's pointer to its message and
	// leaves organization_id — and the rest of the task — untouched. Both steps are
	// idempotent on their own, which is what lets a reviewer use this workspace (read
	// the channel, capture a task from a message, leave a voice note) and have the seed
	// re-run against it afterwards.
	if err := seedDemoWork(ctx, adminPool, queries, result.OrganizationID, ownerID, spareID, workerID, seededAt); err != nil {
		return err
	}
	if err := seedDemoContent(ctx, adminPool, result.OrganizationID, ownerID, workerID, seededAt); err != nil {
		return err
	}

	printDemoCredentials(result)
	return nil
}

// demoOwnerID resolves the PRIMARY owner — the credential the reviewer notes tell
// a reviewer to keep — by the address the seed gave it.
//
// By address rather than by "whichever employee holds the owner role", because
// since this workspace grew a second owner that question has two answers, and
// every row the seed reports as the primary owner's must be the same account the
// notes name.
func demoOwnerID(ctx context.Context, pool database.AdminDatabaseConnector, orgID dbuuid.UUID, email string) (dbuuid.UUID, error) {
	var ownerID dbuuid.UUID
	err := pool.QueryRow(ctx,
		`SELECT id FROM organization.employee
		 WHERE organization_id = $1 AND email = $2 AND is_active = TRUE`, orgID, email,
	).Scan(&ownerID)
	if err != nil {
		return dbuuid.UUID{}, fmt.Errorf("find demo owner: %w", err)
	}
	return ownerID, nil
}

// ensureDemoWorker creates the PIN account if it is missing, and in either case
// leaves it holding a PERMANENT PIN.
//
// The ordinary path issues a temporary PIN that expires in three days and forces a
// change at first sign-in. A reviewer who reaches the demo a week after submission
// would find a dead account, so the credential is promoted to active with no expiry
// (research.md R12).
func ensureDemoWorker(
	ctx context.Context,
	pool database.AdminDatabaseConnector,
	queries *database.Queries,
	orgID, ownerID dbuuid.UUID,
	pin string,
) (dbuuid.UUID, error) {
	var workerID dbuuid.UUID
	err := pool.QueryRow(ctx,
		`SELECT id FROM iam.identity WHERE organization_id = $1 AND login_identifier = $2`,
		orgID, demoWorkerLogin,
	).Scan(&workerID)

	if errors.Is(err, pgx.ErrNoRows) {
		iamLogic := iam.NewIAMLogic(queries, nil)
		if txErr := txn.WithTxn(ctx, pool, func(ctx context.Context, tx database.DBTX) error {
			created, createErr := iamLogic.CreateOrgAccount(ctx, tx, orgID, ownerID, iam.CreateOrgAccountParams{
				LoginIdentifier: demoWorkerLogin,
				DisplayName:     "Sam Field",
				GivenName:       "Sam",
				FamilyName:      "Field",
			})
			if createErr != nil {
				return createErr
			}
			workerID = created.ID
			return nil
		}); txErr != nil {
			return dbuuid.UUID{}, fmt.Errorf("create demo worker: %w", txErr)
		}
	} else if err != nil {
		return dbuuid.UUID{}, fmt.Errorf("look up demo worker: %w", err)
	}

	pinHash, err := iam.HashPIN(pin)
	if err != nil {
		return dbuuid.UUID{}, fmt.Errorf("hash demo PIN: %w", err)
	}
	var credentialID dbuuid.UUID
	if err := pool.QueryRow(ctx,
		`SELECT id FROM iam.credential
		 WHERE organization_id = $1 AND identity_id = $2 AND credential_type = 'pin'
		 ORDER BY created_at DESC LIMIT 1`, orgID, workerID,
	).Scan(&credentialID); err != nil {
		return dbuuid.UUID{}, fmt.Errorf("find demo worker credential: %w", err)
	}

	if err := txn.WithTxn(ctx, pool, func(ctx context.Context, tx database.DBTX) error {
		return queries.ActivateTemporaryCredential(ctx, tx, &database.ActivateTemporaryCredentialParams{
			OrganizationID: orgID,
			ID:             credentialID,
			CredentialHash: pinHash,
			UpdatedAt:      pgtype.Timestamptz{Time: time.Now(), Valid: true},
		})
	}); err != nil {
		return dbuuid.UUID{}, fmt.Errorf("make demo PIN permanent: %w", err)
	}

	// Re-running the seed must not leave a previously deactivated demo account
	// dead, which is the difference between "idempotent" and "runs twice".
	if _, err := pool.Exec(ctx,
		`UPDATE organization.employee SET is_active = TRUE WHERE organization_id = $1 AND id = $2`,
		orgID, workerID,
	); err != nil {
		return dbuuid.UUID{}, fmt.Errorf("reactivate demo worker: %w", err)
	}
	if _, err := pool.Exec(ctx,
		`UPDATE iam.user SET status = 'active' WHERE id = $1`, workerID,
	); err != nil {
		return dbuuid.UUID{}, fmt.Errorf("reactivate demo worker account: %w", err)
	}

	return workerID, nil
}

// ensureDemoSpareOwner leaves the workspace holding a second self-registered
// owner — the account the reviewer notes nominate for deletion.
//
// Two owners is the whole point. The sole-owner guard refuses to strand a
// populated workspace without an owner, and with one owner the demo could not
// demonstrate the deletion the store asks about. The guard is correct and is not
// touched; the fixture is what was wrong.
//
// The rows mirror steps 2–6 of RegisterOrganizationWithAdmin against the
// *existing* organization. The one invariant that matters is that
// iam.identity.id, organization.employee.id and iam.user.id are the same UUID:
// the JWT 'sub' claim carries iam.user.id and every org-scoped service reads it
// as an employee id.
//
// A re-run after a reviewer has performed the deletion finds no active employee
// at this address — the erase anonymised the old row and destroyed its identity —
// and creates a fresh account with a new UUID. The anonymised tombstone is left
// exactly as it is: resurrecting a row the erase de-identified is the one thing
// an erasure guarantee must not do.
func ensureDemoSpareOwner(
	ctx context.Context,
	pool database.AdminDatabaseConnector,
	queries *database.Queries,
	orgID dbuuid.UUID,
	seededAt time.Time,
	email, password string,
) (dbuuid.UUID, error) {
	passwordHash, err := iam.HashPassword(password)
	if err != nil {
		return dbuuid.UUID{}, fmt.Errorf("create spare demo owner: hash password: %w", err)
	}

	var spareID dbuuid.UUID
	lookupErr := pool.QueryRow(ctx,
		`SELECT id FROM organization.employee
		 WHERE organization_id = $1 AND email = $2 AND is_active = TRUE`, orgID, email,
	).Scan(&spareID)

	switch {
	case lookupErr == nil:
		// Already there: refresh only the credential, so a forgotten password in
		// the notes cannot lock a reviewer out of the account they are told to
		// delete.
		if err := refreshDemoPassword(ctx, pool, queries, spareID, passwordHash); err != nil {
			return dbuuid.UUID{}, err
		}
		if _, err := pool.Exec(ctx,
			`UPDATE iam.user SET status = 'active' WHERE id = $1`, spareID,
		); err != nil {
			return dbuuid.UUID{}, fmt.Errorf("reactivate spare demo owner: %w", err)
		}
	case errors.Is(lookupErr, pgx.ErrNoRows):
		spareID = dbuuid.Must()
		if err := txn.WithTxn(ctx, pool, func(ctx context.Context, tx database.DBTX) error {
			if _, err := tx.Exec(ctx,
				`INSERT INTO iam.identity (id, organization_id, email, identity_type)
				 VALUES ($1, $2, $3, 'human')`, spareID, orgID, email); err != nil {
				return fmt.Errorf("identity: %w", err)
			}
			if _, err := tx.Exec(ctx,
				`INSERT INTO organization.employee (id, organization_id, given_name, family_name, email, is_active)
				 VALUES ($1, $2, $3, $4, $5, TRUE)`,
				spareID, orgID, demoSpareGivenName, demoSpareFamilyName, email); err != nil {
				return fmt.Errorf("employee: %w", err)
			}
			// is_org_managed is left at its FALSE default. That is what makes this
			// a self-registered account, and therefore what makes the settings
			// screen offer deletion rather than a removal request.
			user, err := queries.CreateIAMUser(ctx, tx, &database.CreateIAMUserParams{
				ID:          spareID,
				Email:       pgtype.Text{String: email, Valid: true},
				DisplayName: pgtype.Text{String: demoSpareGivenName + " " + demoSpareFamilyName, Valid: true},
				Status:      iam.UserStatusActive,
			})
			if err != nil {
				return fmt.Errorf("account: %w", err)
			}
			// No account may exist without a stored terms acceptance.
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
				PasswordHash: passwordHash,
			}); err != nil {
				return fmt.Errorf("password: %w", err)
			}
			return nil
		}); err != nil {
			return dbuuid.UUID{}, fmt.Errorf("create spare demo owner: %w", err)
		}
	default:
		return dbuuid.UUID{}, fmt.Errorf("look up spare demo owner: %w", lookupErr)
	}

	if err := txn.WithTxn(ctx, pool, func(ctx context.Context, tx database.DBTX) error {
		ownerRole, roleErr := queries.GetOrgRoleBySourceDefault(ctx, tx, &database.GetOrgRoleBySourceDefaultParams{
			OrganizationID:      orgID,
			SourceDefaultRoleID: pgtype.Text{String: iam.DefaultRoleOwner, Valid: true},
		})
		if roleErr != nil {
			return fmt.Errorf("find demo owner role: %w", roleErr)
		}
		return queries.AssignRoleToEmployee(ctx, tx, &database.AssignRoleToEmployeeParams{
			OrganizationID: orgID,
			EmployeeID:     spareID,
			RoleID:         ownerRole.ID,
			AssignedBy:     spareID,
		})
	}); err != nil {
		return dbuuid.UUID{}, fmt.Errorf("create spare demo owner: %w", err)
	}

	return spareID, nil
}

func refreshDemoPassword(
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
		return fmt.Errorf("refresh spare demo owner password: %w", err)
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
		return fmt.Errorf("refresh spare demo owner password: %w", err)
	}
	return nil
}

// seedDemoContent puts something in the workspace worth looking at, including at
// least one message a reviewer can plausibly report (FR-031).
//
// The rows are written directly rather than through each domain's service: this is
// a development fixture, not a user action, and going through five service layers
// would make the command a second implementation of half the product.
func seedDemoContent(ctx context.Context, pool database.AdminDatabaseConnector, orgID, ownerID, workerID dbuuid.UUID, seededAt time.Time) error {
	var channelID dbuuid.UUID
	err := pool.QueryRow(ctx,
		`INSERT INTO chat.channel (organization_id, title_slug, display_name, description, channel_type, is_private, created_by_employee_id)
		 VALUES ($1, $2, 'Site updates', 'Day-to-day coordination for the crew on site.', 'chat', FALSE, $3)
		 ON CONFLICT (organization_id, title_slug) DO UPDATE SET display_name = EXCLUDED.display_name
		 RETURNING id`, orgID, demoChannelSlug, ownerID,
	).Scan(&channelID)
	if err != nil {
		return fmt.Errorf("seed demo channel: %w", err)
	}

	for _, member := range []dbuuid.UUID{ownerID, workerID} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO chat.channel_membership (organization_id, channel_id, employee_id)
			 VALUES ($1, $2, $3)
			 ON CONFLICT DO NOTHING`,
			orgID, channelID, member,
		); err != nil {
			return fmt.Errorf("seed demo channel membership: %w", err)
		}
	}

	// Refresh rather than append, so a third run does not leave three copies of the
	// same conversation.
	if _, err := pool.Exec(ctx,
		`DELETE FROM chat.message WHERE organization_id = $1 AND channel_id = $2`, orgID, channelID,
	); err != nil {
		return fmt.Errorf("clear demo messages: %w", err)
	}

	messages := []struct {
		author dbuuid.UUID
		text   string
	}{
		{ownerID, "Morning both. The Hillside job starts at 8, gate code is 4471."},
		{workerID, "On my way. I'll send a photo once the scaffold is up."},
		{ownerID, "Thanks. Invoice for the last one has gone out."},
		{workerID, "Scaffold up, materials are short by two boards."},
		{ownerID, "Noted, I'll order more this afternoon."},
		// Deliberately rude, so a reviewer testing the report flow has something
		// plausible to report rather than having to invent abuse of their own.
		{workerID, "Whoever loaded the van yesterday clearly can't count. Useless."},
	}
	for _, message := range messages {
		if _, err := pool.Exec(ctx,
			`INSERT INTO chat.message (organization_id, channel_id, author_employee_id, message_text, message_kind)
			 VALUES ($1, $2, $3, $4, 'text')`,
			orgID, channelID, message.author, message.text,
		); err != nil {
			return fmt.Errorf("seed demo message: %w", err)
		}
	}

	// A calendar entry, so the schedule is not empty when a reviewer opens it.
	// Moved forward on every run rather than written once: a visit scheduled for
	// the day after a seed three weeks ago is in the past by the time a reviewer
	// opens the schedule, which is the same empty-looking screen this exists to
	// prevent.
	if _, err := pool.Exec(ctx,
		`INSERT INTO calendar.event (organization_id, title, description, start_time, end_time, organizer_id, event_type, visibility)
		 SELECT $1, 'Hillside site visit', 'Check the scaffold and sign off the first fix.',
		        $3::timestamptz, $3::timestamptz + interval '2 hours', $2, 'meeting', 'org_wide'
		 WHERE NOT EXISTS (
		   SELECT 1 FROM calendar.event WHERE organization_id = $1 AND title = 'Hillside site visit'
		 )`, orgID, ownerID, seededAt.AddDate(0, 0, 1),
	); err != nil {
		// Calendar columns have moved before; a demo fixture must not block the
		// whole seed because one optional table drifted.
		fmt.Printf("note: skipped demo calendar entry (%v)\n", err)
	} else if _, err := pool.Exec(ctx,
		`UPDATE calendar.event SET start_time = $2::timestamptz, end_time = $2::timestamptz + interval '2 hours'
		 WHERE organization_id = $1 AND title = 'Hillside site visit'`,
		orgID, seededAt.AddDate(0, 0, 1),
	); err != nil {
		fmt.Printf("note: skipped moving demo calendar entry forward (%v)\n", err)
	}

	return nil
}

// demoDate is the calendar day of the run, in the machine's own timezone. Every
// seeded date is derived from it rather than from now() in SQL, so no two rows can
// land on opposite sides of midnight and a re-seed moves the whole fixture forward
// together.
func demoDate(seededAt time.Time) time.Time {
	return time.Date(seededAt.Year(), seededAt.Month(), seededAt.Day(), 0, 0, 0, 0, seededAt.Location())
}

// demoProject is a project the seed writes into, with the depth-0 task level every
// row it writes needs.
type demoProject struct {
	id      dbuuid.UUID
	levelID dbuuid.UUID
}

// seedDemoWork fills the two mobile tabs that used to read empty: My Work, which
// needs assigned items with due dates, and Today, which needs at least one of them
// late or due now plus a recurring job for the owners' Team block.
//
// The work is split across two projects because a ritual instance's lateness is a
// project_state row, and the default General project is created in standard mode
// with no state in the overdue category. A recurring job there could not be late,
// which is half of what a reviewer is being shown (research R4).
func seedDemoWork(
	ctx context.Context,
	pool database.AdminDatabaseConnector,
	queries *database.Queries,
	orgID, ownerID, spareID, workerID dbuuid.UUID,
	seededAt time.Time,
) error {
	gen, err := lookupDemoProject(ctx, pool, orgID, demoGenProjectKey)
	if err != nil {
		return err
	}
	ops, err := ensureDemoRitualProject(ctx, pool, queries, orgID, ownerID)
	if err != nil {
		return err
	}

	// Everything the seed writes is rewritten on every run, so the refresh comes
	// first and the rest of this function can write unconditionally.
	if err := refreshDemoProjects(ctx, pool, orgID, []dbuuid.UUID{gen.id, ops.id}); err != nil {
		return err
	}

	// Both projects are private, and My Work fans out per project, so a credential
	// with no membership never sees the work seeded into them. Both owners need
	// owner/admin on OPS specifically, or their Today Team block is empty: the
	// supervisory scope is exactly those two roles.
	for _, m := range []struct {
		project  demoProject
		employee dbuuid.UUID
		role     string
	}{
		{gen, spareID, "admin"},
		{gen, workerID, "member"},
		{ops, spareID, "admin"},
		{ops, workerID, "member"},
	} {
		if err := ensureProjectMembership(ctx, pool, orgID, m.project.id, m.employee, m.role); err != nil {
			return err
		}
	}

	todoStateID, err := requireProjectState(ctx, pool, orgID, gen.id, demoGenProjectKey,
		collaboration.StateCategoryTodo, collaboration.StateTypeStandard)
	if err != nil {
		return err
	}
	inProgressStateID, err := requireProjectState(ctx, pool, orgID, gen.id, demoGenProjectKey,
		collaboration.StateCategoryInProgress, collaboration.StateTypeStandard)
	if err != nil {
		return err
	}
	if err := seedDemoWorkItems(ctx, pool, orgID, gen, ownerID, spareID, workerID,
		todoStateID, inProgressStateID, seededAt); err != nil {
		return err
	}

	definitionID, err := seedDemoRitualDefinition(ctx, pool, orgID, ops.id, ownerID, seededAt)
	if err != nil {
		return err
	}
	return seedDemoRitualInstances(ctx, pool, orgID, ops, definitionID, ownerID, workerID, seededAt)
}

func lookupDemoProject(ctx context.Context, pool database.AdminDatabaseConnector, orgID dbuuid.UUID, key string) (demoProject, error) {
	var p demoProject
	if err := pool.QueryRow(ctx,
		`SELECT id FROM collaboration.project WHERE organization_id = $1 AND key = $2`, orgID, key,
	).Scan(&p.id); err != nil {
		return demoProject{}, fmt.Errorf("find demo project %s: %w", key, err)
	}
	if err := pool.QueryRow(ctx,
		`SELECT id FROM collaboration.task_level
		 WHERE organization_id = $1 AND project_id = $2 AND depth = 0`, orgID, p.id,
	).Scan(&p.levelID); err != nil {
		return demoProject{}, fmt.Errorf("find demo project %s task level: %w", key, err)
	}
	return p, nil
}

// ensureDemoRitualProject creates Site operations through the product's own
// CreateProject, which in one transaction writes the eight ritual states —
// including the Overdue state a late instance has to live in — four task levels,
// the creator's membership and the counters. Re-implementing that here would be
// forty lines of inserts the fixture would then have to keep in step.
func ensureDemoRitualProject(
	ctx context.Context,
	pool database.AdminDatabaseConnector,
	queries *database.Queries,
	orgID, ownerID dbuuid.UUID,
) (demoProject, error) {
	var exists bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM collaboration.project WHERE organization_id = $1 AND key = $2)`,
		orgID, demoOpsProjectKey,
	).Scan(&exists); err != nil {
		return demoProject{}, fmt.Errorf("look up demo ritual project: %w", err)
	}

	if !exists {
		collabLogic := collaboration.NewLogic(queries, nil, nil, nil)
		if err := txn.WithTxn(ctx, pool, func(ctx context.Context, tx database.DBTX) error {
			_, _, _, createErr := collabLogic.CreateProject(ctx, tx, orgID, ownerID, &rpcv1.CreateProjectRequest{
				Name:              "Site operations",
				Key:               demoOpsProjectKey,
				Description:       "Recurring checks the crew runs on every site.",
				Visibility:        rpcv1.ProjectVisibility_PROJECT_VISIBILITY_PRIVATE,
				CollaborationMode: rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL,
			})
			return createErr
		}); err != nil {
			return demoProject{}, fmt.Errorf("create demo ritual project: %w", err)
		}
	}

	return lookupDemoProject(ctx, pool, orgID, demoOpsProjectKey)
}

// requireProjectState resolves a workflow state by what it means rather than by
// what it is called or where it sits, and fails loudly when it is absent.
//
// The product's own behaviour in this situation is to log at WARN and leave the
// row where it is — correct for a live system, wrong for a fixture, where the
// consequence is a half-shaped workspace reaching a store reviewer in silence.
// Position is not a usable key either: project_state is unique on
// (organization_id, project_id, position) only.
func requireProjectState(
	ctx context.Context,
	pool database.AdminDatabaseConnector,
	orgID, projectID dbuuid.UUID,
	projectKey, category, stateType string,
) (dbuuid.UUID, error) {
	var stateID dbuuid.UUID
	err := pool.QueryRow(ctx,
		`SELECT id FROM collaboration.project_state
		 WHERE organization_id = $1 AND project_id = $2 AND category = $3 AND state_type = $4
		 ORDER BY position
		 LIMIT 1`, orgID, projectID, category, stateType,
	).Scan(&stateID)
	if errors.Is(err, pgx.ErrNoRows) {
		return dbuuid.UUID{}, fmt.Errorf(
			"demo project %s has no %s state in category %q; reseed the project", projectKey, stateType, category)
	}
	if err != nil {
		return dbuuid.UUID{}, fmt.Errorf("find %s state in category %q for demo project %s: %w",
			stateType, category, projectKey, err)
	}
	return stateID, nil
}

func ensureProjectMembership(
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
		return fmt.Errorf("seed demo project membership: %w", err)
	}
	if !inserted {
		return nil
	}
	// member_count is denormalised, so a direct write has to maintain it.
	if _, err := pool.Exec(ctx,
		`UPDATE collaboration.project SET member_count = member_count + 1
		 WHERE organization_id = $1 AND id = $2`, orgID, projectID,
	); err != nil {
		return fmt.Errorf("seed demo project member count: %w", err)
	}
	return nil
}

// refreshDemoProjects empties the two demo projects so a second run refreshes
// rather than appends. Every child of a task cascades on delete, and the seed
// writes no subtasks, so one scoped statement cannot strand a row.
//
// This deletes everything in those projects, including anything a reviewer created
// while looking around. That is what "refresh the demo workspace" means, and it is
// what the message seed has always done.
func refreshDemoProjects(ctx context.Context, pool database.AdminDatabaseConnector, orgID dbuuid.UUID, projectIDs []dbuuid.UUID) error {
	if _, err := pool.Exec(ctx,
		`DELETE FROM collaboration.task WHERE organization_id = $1 AND project_id = ANY($2)`,
		orgID, projectIDs,
	); err != nil {
		return fmt.Errorf("clear demo work items: %w", err)
	}
	if _, err := pool.Exec(ctx,
		`UPDATE collaboration.project SET next_task_number = 1, task_count = 0
		 WHERE organization_id = $1 AND id = ANY($2)`, orgID, projectIDs,
	); err != nil {
		return fmt.Errorf("reset demo project counters: %w", err)
	}
	return nil
}

// seedDemoWorkItems writes the six ordinary work items.
//
// The distribution is load-bearing rather than decorative. Two open states so the
// board shows movement; two items each so all three credentials open My Work on
// something; two already late and two due today so Today's whole-screen empty
// state clears for every credential; and two further out so the Upcoming section
// is not itself empty. The titles are the same job as the seeded conversation.
func seedDemoWorkItems(
	ctx context.Context,
	pool database.AdminDatabaseConnector,
	orgID dbuuid.UUID,
	project demoProject,
	ownerID, spareID, workerID dbuuid.UUID,
	todoStateID, inProgressStateID dbuuid.UUID,
	seededAt time.Time,
) error {
	today := demoDate(seededAt)
	items := []struct {
		title    string
		stateID  dbuuid.UUID
		assignee dbuuid.UUID
		dueDate  time.Time
	}{
		{"Order two more scaffold boards for Hillside", inProgressStateID, workerID, today.AddDate(0, 0, -3)},
		{"Send the Hillside first-fix invoice", inProgressStateID, ownerID, today.AddDate(0, 0, -1)},
		{"Book the skip for Thursday", todoStateID, spareID, today},
		{"Confirm the gate code with the site manager", todoStateID, workerID, today},
		{"Chase the electrician's certificate", todoStateID, ownerID, today.AddDate(0, 0, 2)},
		{"Price up the Meadow Lane extension", todoStateID, spareID, today.AddDate(0, 0, 5)},
	}

	for i, item := range items {
		var taskID dbuuid.UUID
		if err := pool.QueryRow(ctx,
			`INSERT INTO collaboration.task
			   (organization_id, project_id, identifier, title, depth, path, level_id, state_id,
			    due_date, reporter_employee_id, task_kind)
			 VALUES ($1, $2, $3, $4, 0, '{}', $5, $6, $7, $8, 'standard')
			 RETURNING id`,
			orgID, project.id, fmt.Sprintf("%s-%d", demoGenProjectKey, i+1), item.title,
			project.levelID, item.stateID, item.dueDate, ownerID,
		).Scan(&taskID); err != nil {
			return fmt.Errorf("seed demo work item %q: %w", item.title, err)
		}
		if _, err := pool.Exec(ctx,
			`INSERT INTO collaboration.task_assignee (organization_id, task_id, employee_id, role, assigned_by_employee_id)
			 VALUES ($1, $2, $3, 'assignee', $4)`,
			orgID, taskID, item.assignee, ownerID,
		); err != nil {
			return fmt.Errorf("assign demo work item %q: %w", item.title, err)
		}
	}

	if _, err := pool.Exec(ctx,
		`UPDATE collaboration.project SET task_count = $3, next_task_number = $4
		 WHERE organization_id = $1 AND id = $2`,
		orgID, project.id, len(items), len(items)+1,
	); err != nil {
		return fmt.Errorf("seed demo project task counters: %w", err)
	}
	return nil
}

// seedDemoRitualDefinition writes the recurring job, configured so the three
// background sweeps agree with the fixture instead of dismantling it.
//
// A monthly rule on the seed day with a one-day generation window yields no date
// inside the window, so the generation sweep adds nothing for a month while the
// definition still reads as live — archiving it would stop generation too, but a
// reviewer would open a ritual that looks switched off.
func seedDemoRitualDefinition(
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
		"time_of_day":  "08:00",
	})
	if err != nil {
		return dbuuid.UUID{}, fmt.Errorf("build demo recurrence rule: %w", err)
	}

	const description = "Gate, scaffold and first-aid kit, before anyone starts work."

	// Updated in place rather than replaced, so the definition's id survives a
	// re-run and any link a reviewer followed still resolves. Looked up first
	// rather than upserted because the table carries no unique key on the name,
	// and adding one would be a migration this feature does not need.
	var definitionID dbuuid.UUID
	err = pool.QueryRow(ctx,
		`UPDATE collaboration.ritual_definition
		 SET description = $4, recurrence_rule = $5, completion_window_hours = $6,
		     generation_window_days = 1, last_generated_date = $7, is_archived = FALSE,
		     created_by_employee_id = $8, updated_at = now()
		 WHERE organization_id = $1 AND project_id = $2 AND name = $3
		 RETURNING id`,
		orgID, projectID, demoRitualName, description, rule,
		demoRitualCompletionWindowHours, seededAt, ownerID,
	).Scan(&definitionID)
	if errors.Is(err, pgx.ErrNoRows) {
		err = pool.QueryRow(ctx,
			`INSERT INTO collaboration.ritual_definition
			   (organization_id, project_id, name, description, recurrence_rule,
			    completion_window_hours, generation_window_days, last_generated_date,
			    is_archived, created_by_employee_id)
			 VALUES ($1, $2, $3, $4, $5, $6, 1, $7, FALSE, $8)
			 RETURNING id`,
			orgID, projectID, demoRitualName, description, rule,
			demoRitualCompletionWindowHours, seededAt, ownerID,
		).Scan(&definitionID)
	}
	if err != nil {
		return dbuuid.UUID{}, fmt.Errorf("seed demo recurring job: %w", err)
	}

	// One required photo, rewritten with the instances: a recurring job with no
	// mandatory evidence reads as unfinished, and it gives a reviewer a real
	// evidence flow to open.
	if _, err := pool.Exec(ctx,
		`DELETE FROM collaboration.evidence_requirement
		 WHERE organization_id = $1 AND ritual_definition_id = $2`, orgID, definitionID,
	); err != nil {
		return dbuuid.UUID{}, fmt.Errorf("clear demo evidence requirement: %w", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO collaboration.evidence_requirement
		   (organization_id, ritual_definition_id, name, description, evidence_types,
		    is_required, approval_mode, position, deadline_offset_hours)
		 VALUES ($1, $2, 'Photo of the gate and scaffold', 'One photo showing the gate secured and the scaffold tagged.',
		         '{photo}', TRUE, 'manual', 0, 0)`,
		orgID, definitionID,
	); err != nil {
		return dbuuid.UUID{}, fmt.Errorf("seed demo evidence requirement: %w", err)
	}

	return definitionID, nil
}

// seedDemoRitualInstances writes the two instances the owners' Team block reads:
// one late, and one nobody is holding.
//
// The late one is assigned to the worker and never to an owner, because the Team
// block excludes work assigned to the caller — an owner-assigned instance would be
// invisible in that owner's own block, which is the empty state this is here to
// remove. The unheld one carries no assignee row at all and is dated today,
// because the unassigned leg matches scheduled_date by equality.
func seedDemoRitualInstances(
	ctx context.Context,
	pool database.AdminDatabaseConnector,
	orgID dbuuid.UUID,
	project demoProject,
	definitionID, ownerID, workerID dbuuid.UUID,
	seededAt time.Time,
) error {
	overdueStateID, err := requireProjectState(ctx, pool, orgID, project.id, demoOpsProjectKey,
		collaboration.StateCategoryOverdue, collaboration.StateTypeRitual)
	if err != nil {
		return err
	}
	openStateID, err := requireProjectState(ctx, pool, orgID, project.id, demoOpsProjectKey,
		collaboration.StateCategoryTodo, collaboration.StateTypeRitual)
	if err != nil {
		return err
	}

	today := demoDate(seededAt)
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
			assignee: &workerID,
		},
		{
			// Deadline still in the future, which also keeps this one out of the
			// reconciliation sweep's candidate set entirely.
			number:   2,
			date:     today,
			deadline: seededAt.Add((demoRitualCompletionWindowHours - 30) * time.Hour),
			stateID:  openStateID,
			assignee: nil,
		},
	}

	for _, instance := range instances {
		var taskID dbuuid.UUID
		if err := pool.QueryRow(ctx,
			`INSERT INTO collaboration.task
			   (organization_id, project_id, identifier, title, depth, path, level_id, state_id,
			    start_date, due_date, reporter_employee_id, task_kind, ritual_definition_id,
			    scheduled_date, completion_deadline)
			 VALUES ($1, $2, $3, $4, 0, '{}', $5, $6, $7, $7, $8, 'ritual_instance', $9, $7, $10)
			 RETURNING id`,
			orgID, project.id, fmt.Sprintf("%s-%d", demoOpsProjectKey, instance.number), demoRitualName,
			project.levelID, instance.stateID, instance.date, ownerID, definitionID, instance.deadline,
		).Scan(&taskID); err != nil {
			return fmt.Errorf("seed demo recurring job instance %d: %w", instance.number, err)
		}
		if instance.assignee == nil {
			continue
		}
		if _, err := pool.Exec(ctx,
			`INSERT INTO collaboration.task_assignee (organization_id, task_id, employee_id, role, assigned_by_employee_id)
			 VALUES ($1, $2, $3, 'assignee', $4)`,
			orgID, taskID, *instance.assignee, ownerID,
		); err != nil {
			return fmt.Errorf("assign demo recurring job instance %d: %w", instance.number, err)
		}
	}

	if _, err := pool.Exec(ctx,
		`UPDATE collaboration.project SET task_count = $3, next_task_number = $4
		 WHERE organization_id = $1 AND id = $2`,
		orgID, project.id, len(instances), len(instances)+1,
	); err != nil {
		return fmt.Errorf("seed demo ritual project task counters: %w", err)
	}
	return nil
}

func printDemoCredentials(result demoSeedResult) {
	fmt.Println()
	fmt.Println("Demo workspace ready.")
	fmt.Printf("  Workspace address : %s\n", result.Subdomain)
	fmt.Printf("  Organization ID   : %s\n", result.OrganizationID)
	fmt.Println()
	fmt.Println("  PRIMARY credential — give this to a reviewer first.")
	fmt.Println("  It is a self-registered account, and therefore one of the two whose")
	fmt.Println("  settings screen shows the full account-deletion path.")
	fmt.Printf("    Email    : %s\n", result.OwnerEmail)
	fmt.Printf("    Password : %s\n", result.OwnerPassword)
	fmt.Println()
	fmt.Println("  SPARE credential — this is the one to delete.")
	fmt.Println("  Deleting it demonstrates in-app account deletion end to end and leaves the")
	fmt.Println("  workspace and the primary credential usable.")
	fmt.Printf("    Email    : %s\n", result.SpareEmail)
	fmt.Printf("    Password : %s\n", result.SparePassword)
	fmt.Println()
	fmt.Println("  SECOND credential — an admin-provisioned worker, to show the other path.")
	fmt.Println("  Its PIN is permanent: the ordinary temporary PIN expires in three days")
	fmt.Println("  and would be dead before a reviewer reached it.")
	fmt.Printf("    Workspace : %s\n", result.Subdomain)
	fmt.Printf("    Login ID  : %s\n", result.WorkerLogin)
	fmt.Printf("    PIN       : %s\n", result.WorkerPIN)
	fmt.Println()
	fmt.Println("  Copy docs/compliance/reviewer-notes.md into App Review notes and Play testing instructions.")
}

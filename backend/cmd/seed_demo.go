package main

import (
	"context"
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
)

// SeedDemoOrgCommand builds the workspace an App Store or Play reviewer signs into
// (Feature 036, FR-031).
//
// Idempotent by design: a re-run refreshes the content of the existing workspace
// rather than creating a second one. Store review calendars are external and
// unforgiving, so the command has to be safe to run again the morning of a
// resubmission without inventing a second "demo" org nobody can find.
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
	demoWorkerLogin     = "demo-worker"
	demoChannelSlug     = "site-updates"
)

type demoSeedResult struct {
	OrganizationID dbuuid.UUID
	Subdomain      string
	OwnerEmail     string
	OwnerPassword  string
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

	ownerID, err := demoOwnerID(ctx, adminPool, result.OrganizationID)
	if err != nil {
		return err
	}

	// --- 2. The PIN worker ---------------------------------------------------
	workerID, err := ensureDemoWorker(ctx, adminPool, queries, result.OrganizationID, ownerID, workerPIN)
	if err != nil {
		return err
	}

	// --- 3. Content worth reviewing -----------------------------------------
	if err := seedDemoContent(ctx, adminPool, result.OrganizationID, ownerID, workerID); err != nil {
		return err
	}

	printDemoCredentials(result)
	return nil
}

func demoOwnerID(ctx context.Context, pool database.AdminDatabaseConnector, orgID dbuuid.UUID) (dbuuid.UUID, error) {
	var ownerID dbuuid.UUID
	err := pool.QueryRow(ctx,
		`SELECT er.employee_id
		 FROM iam.employee_role er
		 JOIN iam.role r ON (r.organization_id, r.id) = (er.organization_id, er.role_id)
		 WHERE er.organization_id = $1 AND r.source_default_role_id = 'owner'
		 ORDER BY er.employee_id
		 LIMIT 1`, orgID,
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

// seedDemoContent puts something in the workspace worth looking at, including at
// least one message a reviewer can plausibly report (FR-031).
//
// The rows are written directly rather than through each domain's service: this is
// a development fixture, not a user action, and going through five service layers
// would make the command a second implementation of half the product.
func seedDemoContent(ctx context.Context, pool database.AdminDatabaseConnector, orgID, ownerID, workerID dbuuid.UUID) error {
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
	if _, err := pool.Exec(ctx,
		`INSERT INTO calendar.event (organization_id, title, description, start_time, end_time, organizer_id, event_type, visibility)
		 SELECT $1, 'Hillside site visit', 'Check the scaffold and sign off the first fix.',
		        now() + interval '1 day', now() + interval '1 day 2 hours', $2, 'meeting', 'org_wide'
		 WHERE NOT EXISTS (
		   SELECT 1 FROM calendar.event WHERE organization_id = $1 AND title = 'Hillside site visit'
		 )`, orgID, ownerID,
	); err != nil {
		// Calendar columns have moved before; a demo fixture must not block the
		// whole seed because one optional table drifted.
		fmt.Printf("note: skipped demo calendar entry (%v)\n", err)
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
	fmt.Println("  It is a self-registered account, and therefore the only one whose")
	fmt.Println("  settings screen shows the full account-deletion path.")
	fmt.Printf("    Email    : %s\n", result.OwnerEmail)
	fmt.Printf("    Password : %s\n", result.OwnerPassword)
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

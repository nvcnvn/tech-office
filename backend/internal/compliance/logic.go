package compliance

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/flows"
	"github.com/nvcnvn/tech-office/backend/database"
	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// ReportTarget is what a reportable item looks like once its owning domain has
// been asked about it: who wrote it, and what it said at the moment it was
// reported. The snapshot is stored inline so the report outlives deletion of its
// subject (FR-018, research.md R7).
type ReportTarget struct {
	AuthorEmployeeID dbuuid.UUID
	Snapshot         string

	// Where the live item can still be found, when it exists. Empty is fine — the
	// snapshot is what makes the report reviewable.
	DeepLink string
}

// TargetResolver answers "who wrote this, and what did it say" for one kind of
// reportable item. Each implementation calls the owning domain's service; none
// joins across schemas (Constitution Principle IV).
type TargetResolver interface {
	ResolveReportTarget(ctx context.Context, tx database.DBTX, orgID, viewerID, targetID dbuuid.UUID) (ReportTarget, error)
}

// NotificationPublisher is the slice of internal/notification this domain needs.
type NotificationPublisher interface {
	PublishNotification(ctx context.Context, tx database.DBTX, req *rpcv1.PublishNotificationRequest) (*rpcv1.PublishNotificationResponse, error)
}

// OwnerLookup finds the people who should hear about a removal request.
type OwnerLookup interface {
	ListOwnerEmployeeIDs(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID) ([]dbuuid.UUID, error)
}

// AccountEraser performs the two halves of an erase for one organization. It is
// implemented by internal/iam, which owns those tables.
type AccountEraser interface {
	// AnonymiseEmployee strips personal data from organization.employee and
	// deactivates the row, leaving the de-identified tombstone the organization's
	// records still point at (FR-006).
	AnonymiseEmployee(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID) error

	// PurgeOrgIdentity deletes the person's per-organization identity rows.
	PurgeOrgIdentity(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID) error

	// PurgeGlobalUserIfLastMembership deletes iam.user — and everything cascading
	// from it — once no iam.identity rows remain anywhere for this person. Returns
	// whether it deleted.
	PurgeGlobalUserIfLastMembership(ctx context.Context, userID dbuuid.UUID) (bool, error)

	// IsOrgManaged reports whether this account was created by an administrator
	// rather than by the person themselves, which decides their removal path.
	IsOrgManaged(ctx context.Context, tx database.DBTX, userID dbuuid.UUID) (bool, error)
}

// Logic holds the business rules. Every method takes a DBTX so the transport
// layer owns transaction boundaries (Constitution Principle III).
type Logic struct {
	Queries   *database.Queries
	Resolvers map[string]TargetResolver
	Notifier  NotificationPublisher
	Owners    OwnerLookup
	Eraser    AccountEraser

	FlowsClient      flows.Client
	DeletionWorkflow flows.Workflow[AccountDeletionInput, AccountDeletionOutput]
}

func NewLogic(queries *database.Queries) *Logic {
	return &Logic{Queries: queries, Resolvers: map[string]TargetResolver{}}
}

func nullText(s string) pgtype.Text {
	s = strings.TrimSpace(s)
	if s == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: s, Valid: true}
}

func nullUUID(u dbuuid.UUID) dbuuid.NullUUID {
	return dbuuid.NullUUID{UUID: uuid.UUID(u), Valid: true}
}

func nowTS(t time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: t, Valid: true}
}

func tsToProto(t pgtype.Timestamptz) *timestamppb.Timestamp {
	if !t.Valid {
		return nil
	}
	return timestamppb.New(t.Time)
}

// =============================================================================
// Reporting
// =============================================================================

type ReportContentParams struct {
	OrganizationID     dbuuid.UUID
	ReporterEmployeeID dbuuid.UUID
	TargetKind         string
	TargetID           dbuuid.UUID
	Reason             string
	Note               string
}

// ReportContent files a report. The reported author and the content snapshot come
// from the owning domain, not from the request, so a client cannot forge who
// authored what (FR-016).
func (l *Logic) ReportContent(ctx context.Context, tx database.DBTX, p ReportContentParams) (*database.ComplianceContentReport, error) {
	resolver, ok := l.Resolvers[p.TargetKind]
	if !ok {
		return nil, ErrInvalidTarget
	}

	existing, err := l.Queries.GetOutstandingReportByReporterAndTarget(ctx, tx, &database.GetOutstandingReportByReporterAndTargetParams{
		OrganizationID:     p.OrganizationID,
		ReporterEmployeeID: p.ReporterEmployeeID,
		TargetKind:         p.TargetKind,
		TargetID:           p.TargetID,
	})
	if err == nil && existing != nil {
		return nil, ErrReportAlreadyFiled
	}
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("check existing report: %w", err)
	}

	target, err := resolver.ResolveReportTarget(ctx, tx, p.OrganizationID, p.ReporterEmployeeID, p.TargetID)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrTargetNotFound, err)
	}

	report, err := l.Queries.CreateContentReport(ctx, tx, &database.CreateContentReportParams{
		OrganizationID:     p.OrganizationID,
		ReporterEmployeeID: p.ReporterEmployeeID,
		ReportedEmployeeID: target.AuthorEmployeeID,
		TargetKind:         p.TargetKind,
		TargetID:           p.TargetID,
		ContentSnapshot:    target.Snapshot,
		Reason:             p.Reason,
		Note:               nullText(p.Note),
	})
	if err != nil {
		return nil, fmt.Errorf("create content report: %w", err)
	}
	slog.InfoContext(ctx, "content report filed",
		"report_id", report.ID.String(),
		"target_kind", p.TargetKind,
		"reason", p.Reason,
	)
	return report, nil
}

// ResolveReportParams records a reviewer's outcome.
type ResolveReportParams struct {
	OrganizationID   dbuuid.UUID
	ReviewerID       dbuuid.UUID
	ReportID         dbuuid.UUID
	Outcome          string
	OutcomeNote      string
	ResolvedAtOrZero time.Time
}

func (l *Logic) ResolveReport(ctx context.Context, tx database.DBTX, p ResolveReportParams) (*database.ComplianceContentReport, error) {
	if !IsReportOutcome(p.Outcome) {
		return nil, ErrInvalidTarget
	}
	if strings.TrimSpace(p.OutcomeNote) == "" {
		return nil, ErrOutcomeNoteRequired
	}
	at := p.ResolvedAtOrZero
	if at.IsZero() {
		at = time.Now()
	}

	report, err := l.Queries.ResolveContentReport(ctx, tx, &database.ResolveContentReportParams{
		OrganizationID:       p.OrganizationID,
		ID:                   p.ReportID,
		Status:               p.Outcome,
		OutcomeNote:          nullText(p.OutcomeNote),
		ReviewedByEmployeeID: nullUUID(p.ReviewerID),
		ReviewedAt:           nowTS(at),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		// The UPDATE matches only outstanding reports, so no row means either the
		// report does not exist or somebody resolved it first. Distinguish the two
		// so the reviewer gets a useful message.
		if _, getErr := l.Queries.GetContentReport(ctx, tx, &database.GetContentReportParams{
			OrganizationID: p.OrganizationID,
			ID:             p.ReportID,
		}); getErr == nil {
			return nil, ErrReportAlreadyClosed
		}
		return nil, ErrReportNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("resolve content report: %w", err)
	}
	return report, nil
}

// =============================================================================
// Blocking
// =============================================================================

// BlockPerson records a one-directional block. It deliberately emits no
// notification: the absence is the requirement (FR-022).
func (l *Logic) BlockPerson(ctx context.Context, tx database.DBTX, orgID, blockerID, blockedID dbuuid.UUID) (*database.ComplianceBlock, error) {
	if blockerID == blockedID {
		return nil, ErrCannotBlockSelf
	}
	block, err := l.Queries.CreateBlock(ctx, tx, &database.CreateBlockParams{
		OrganizationID:    orgID,
		BlockerEmployeeID: blockerID,
		BlockedEmployeeID: blockedID,
	})
	if err != nil {
		return nil, fmt.Errorf("create block: %w", err)
	}
	return block, nil
}

// UnblockPerson is idempotent: unblocking someone who is not blocked succeeds.
func (l *Logic) UnblockPerson(ctx context.Context, tx database.DBTX, orgID, blockerID, blockedID dbuuid.UUID) error {
	if err := l.Queries.DeleteBlock(ctx, tx, &database.DeleteBlockParams{
		OrganizationID:    orgID,
		BlockerEmployeeID: blockerID,
		BlockedEmployeeID: blockedID,
	}); err != nil {
		return fmt.Errorf("delete block: %w", err)
	}
	return nil
}

func (l *Logic) ListBlockedPeople(ctx context.Context, tx database.DBTX, orgID, blockerID dbuuid.UUID) ([]*database.ListBlockedPeopleRow, error) {
	rows, err := l.Queries.ListBlockedPeople(ctx, tx, &database.ListBlockedPeopleParams{
		OrganizationID:    orgID,
		BlockerEmployeeID: blockerID,
	})
	if err != nil {
		return nil, fmt.Errorf("list blocked people: %w", err)
	}
	return rows, nil
}

// IsDirectContactBlocked reports whether direct contact between two people is
// refused. It is symmetric on purpose: the initiator must not be able to work out
// which direction the block runs in by comparing outcomes.
//
// This is the method chat and voice depend on through their own local interfaces,
// which is what keeps the guard a service call rather than a cross-schema join.
func (l *Logic) IsDirectContactBlocked(ctx context.Context, tx database.DBTX, orgID, a, b dbuuid.UUID) (bool, error) {
	if a == b {
		return false, nil
	}
	blocked, err := l.Queries.IsContactBlocked(ctx, tx, &database.IsContactBlockedParams{
		OrganizationID:    orgID,
		BlockerEmployeeID: a,
		BlockedEmployeeID: b,
	})
	if err != nil {
		return false, fmt.Errorf("check block: %w", err)
	}
	return blocked, nil
}

// EnsureDirectContactAllowed is IsDirectContactBlocked as a guard, returning
// ErrContactBlocked so callers do not each invent their own error.
func (l *Logic) EnsureDirectContactAllowed(ctx context.Context, tx database.DBTX, orgID, a, b dbuuid.UUID) error {
	blocked, err := l.IsDirectContactBlocked(ctx, tx, orgID, a, b)
	if err != nil {
		return err
	}
	if blocked {
		return ErrContactBlocked
	}
	return nil
}

// ListBlockedEmployeeIDs returns everyone the caller has blocked, for hiding
// direct history in their own view (FR-021).
func (l *Logic) ListBlockedEmployeeIDs(ctx context.Context, tx database.DBTX, orgID, blockerID dbuuid.UUID) ([]dbuuid.UUID, error) {
	ids, err := l.Queries.ListBlockedEmployeeIDs(ctx, tx, &database.ListBlockedEmployeeIDsParams{
		OrganizationID:    orgID,
		BlockerEmployeeID: blockerID,
	})
	if err != nil {
		return nil, fmt.Errorf("list blocked employee ids: %w", err)
	}
	return ids, nil
}

package iam

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/nvcnvn/tech-office/backend/database"
	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/internal/notification"
	v1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// People directory (Feature 048).
//
// One read, three shapes: the whole active roster, one department's members, or a named
// set of people. A non-empty query narrows any of them through the organization domain's
// fuzzy matcher. Nothing here writes.
//
// Two behaviours are absences done right and are the likeliest to be broken by a later
// change: presence rides inside the payload rather than being fetched per row, and a
// missing phone number is an absent field rather than an empty string — the client hangs
// the entire call affordance off that absence (FR-012).

const (
	directoryDefaultPageSize = 50
	directoryMaxPageSize     = 100
	// directoryMaxEmployeeIDs matches the cap GetEmployeeCards enforces.
	directoryMaxEmployeeIDs = 100
	// directoryCursorSeparator is a unit separator: it cannot occur in a name.
	directoryCursorSeparator = "\x1f"
)

// ErrDirectoryBadRequest marks the directory failures a caller can fix — an over-long id
// list, or an id that is not a UUID. The connect layer maps it to InvalidArgument; every
// other failure is internal.
var ErrDirectoryBadRequest = errors.New("invalid directory request")

// EmployeeSearcher is the organization domain's fuzzy multilingual employee matcher, as
// the IAM domain consumes it. Declared here rather than imported because
// internal/organization imports internal/iam; see SetEmployeeSearcher on IAMLogic.
type EmployeeSearcher interface {
	SearchEmployees(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, queryText string, limit int32, cursor *dbuuid.UUID) ([]*database.SearchEmployeesRow, error)
}

// ── Cursor ───────────────────────────────────────────────────────────────────
//
// The directory is read alphabetically, so the page boundary is the sort key itself —
// (lower(family_name), lower(given_name), id) — not a uuidv7. It is base64 so the client
// treats it as opaque and cannot construct one.

type directoryCursor struct {
	family string
	given  string
	id     dbuuid.UUID
}

func encodeDirectoryCursor(family, given string, id dbuuid.UUID) string {
	raw := strings.Join([]string{
		strings.ToLower(family),
		strings.ToLower(given),
		id.String(),
	}, directoryCursorSeparator)
	return base64.RawURLEncoding.EncodeToString([]byte(raw))
}

func decodeDirectoryCursor(encoded string) (*directoryCursor, error) {
	raw, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		return nil, fmt.Errorf("%w: cursor is not decodable", ErrDirectoryBadRequest)
	}
	parts := strings.Split(string(raw), directoryCursorSeparator)
	if len(parts) != 3 {
		return nil, fmt.Errorf("%w: cursor is malformed", ErrDirectoryBadRequest)
	}
	id, err := dbuuid.Parse(parts[2])
	if err != nil {
		return nil, fmt.Errorf("%w: cursor carries an invalid id", ErrDirectoryBadRequest)
	}
	return &directoryCursor{family: parts[0], given: parts[1], id: id}, nil
}

// ── Bounds ───────────────────────────────────────────────────────────────────

func clampDirectoryPageSize(requested int32) int32 {
	switch {
	case requested <= 0:
		return directoryDefaultPageSize
	case requested > directoryMaxPageSize:
		return directoryMaxPageSize
	default:
		return requested
	}
}

func parseDirectoryEmployeeIDs(raw []string) ([]dbuuid.UUID, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	if len(raw) > directoryMaxEmployeeIDs {
		return nil, fmt.Errorf("%w: too many employee IDs: max %d, got %d",
			ErrDirectoryBadRequest, directoryMaxEmployeeIDs, len(raw))
	}
	ids := make([]dbuuid.UUID, 0, len(raw))
	for _, s := range raw {
		id, err := dbuuid.Parse(s)
		if err != nil {
			return nil, fmt.Errorf("%w: invalid employee ID %q", ErrDirectoryBadRequest, s)
		}
		ids = append(ids, id)
	}
	return ids, nil
}

// ── The read ─────────────────────────────────────────────────────────────────

// ListDirectory implements IAMLogic.
func (l *iamLogicImpl) ListDirectory(
	ctx context.Context,
	tx database.DBTX,
	orgID, callerEmployeeID dbuuid.UUID,
	req *v1.ListDirectoryRequest,
) (*v1.ListDirectoryResponse, error) {
	pageSize := clampDirectoryPageSize(req.GetPageSize())

	requestedIDs, err := parseDirectoryEmployeeIDs(req.GetEmployeeIds())
	if err != nil {
		return nil, err
	}

	var departmentID dbuuid.NullUUID
	if raw := req.GetDepartmentId(); raw != "" {
		id, parseErr := dbuuid.Parse(raw)
		if parseErr != nil {
			return nil, fmt.Errorf("%w: invalid department ID %q", ErrDirectoryBadRequest, raw)
		}
		departmentID = dbuuid.UUIDToNullUUID(id)
	}

	query := strings.TrimSpace(req.GetQuery())
	if query != "" {
		return l.narrowDirectory(ctx, tx, orgID, callerEmployeeID, query, requestedIDs, departmentID)
	}
	return l.browseDirectory(ctx, tx, orgID, callerEmployeeID, req.GetCursor(), pageSize, requestedIDs, departmentID)
}

// browseDirectory walks the roster alphabetically. It reads one row more than the page so
// "there is a next page" is answered by the database rather than guessed from a full page.
func (l *iamLogicImpl) browseDirectory(
	ctx context.Context,
	tx database.DBTX,
	orgID, callerEmployeeID dbuuid.UUID,
	rawCursor string,
	pageSize int32,
	requestedIDs []dbuuid.UUID,
	departmentID dbuuid.NullUUID,
) (*v1.ListDirectoryResponse, error) {
	params := &database.ListDirectoryEntriesParams{
		OrganizationID: orgID,
		EmployeeIds:    requestedIDs,
		DepartmentID:   departmentID,
		PageSize:       pageSize + 1,
	}

	if rawCursor != "" {
		cursor, err := decodeDirectoryCursor(rawCursor)
		if err != nil {
			return nil, err
		}
		params.CursorFamily = pgtype.Text{String: cursor.family, Valid: true}
		params.CursorGiven = pgtype.Text{String: cursor.given, Valid: true}
		params.CursorID = dbuuid.UUIDToNullUUID(cursor.id)
	}

	rows, err := l.queries.ListDirectoryEntries(ctx, tx, params)
	if err != nil {
		return nil, fmt.Errorf("failed to list directory entries: %w", err)
	}

	nextCursor := ""
	if int32(len(rows)) > pageSize {
		rows = rows[:pageSize]
		last := rows[len(rows)-1]
		nextCursor = encodeDirectoryCursor(last.FamilyName, last.GivenName, last.ID)
	}

	entries, err := l.enrichDirectoryRows(ctx, tx, orgID, callerEmployeeID, rows)
	if err != nil {
		return nil, err
	}
	return &v1.ListDirectoryResponse{Entries: entries, NextCursor: nextCursor}, nil
}

// narrowDirectory hands the text to the organization domain's matcher and enriches what
// comes back. The result is one relevance-ordered page and never carries a cursor: the
// matcher orders by relevance, which no keyset can resume, and a directory search that
// needs a second page has not narrowed.
func (l *iamLogicImpl) narrowDirectory(
	ctx context.Context,
	tx database.DBTX,
	orgID, callerEmployeeID dbuuid.UUID,
	query string,
	requestedIDs []dbuuid.UUID,
	departmentID dbuuid.NullUUID,
) (*v1.ListDirectoryResponse, error) {
	if l.employeeSearcher == nil {
		slog.WarnContext(ctx, "directory narrowing requested with no employee searcher wired",
			"org_id", orgID.String())
		return &v1.ListDirectoryResponse{}, nil
	}

	matches, err := l.employeeSearcher.SearchEmployees(ctx, tx, orgID, query, directoryMaxEmployeeIDs, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to narrow directory: %w", err)
	}

	// The matcher searches the whole roster, so an explicit id filter still applies.
	allowed := make(map[dbuuid.UUID]bool, len(requestedIDs))
	for _, id := range requestedIDs {
		allowed[id] = true
	}

	matchedIDs := make([]dbuuid.UUID, 0, len(matches))
	for _, m := range matches {
		if len(allowed) > 0 && !allowed[m.ID] {
			continue
		}
		matchedIDs = append(matchedIDs, m.ID)
	}
	if len(matchedIDs) == 0 {
		return &v1.ListDirectoryResponse{}, nil
	}

	rows, err := l.queries.ListDirectoryEntries(ctx, tx, &database.ListDirectoryEntriesParams{
		OrganizationID: orgID,
		EmployeeIds:    matchedIDs,
		DepartmentID:   departmentID,
		PageSize:       int32(len(matchedIDs)),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to enrich narrowed directory entries: %w", err)
	}

	// The enrichment query returns alphabetically; the matcher ranked by relevance, and
	// the ranking is the point of narrowing, so the matcher's order wins.
	byID := make(map[dbuuid.UUID]*database.ListDirectoryEntriesRow, len(rows))
	for _, row := range rows {
		byID[row.ID] = row
	}
	ordered := make([]*database.ListDirectoryEntriesRow, 0, len(rows))
	for _, id := range matchedIDs {
		if row, ok := byID[id]; ok {
			ordered = append(ordered, row)
		}
	}

	entries, err := l.enrichDirectoryRows(ctx, tx, orgID, callerEmployeeID, ordered)
	if err != nil {
		return nil, err
	}
	return &v1.ListDirectoryResponse{Entries: entries}, nil
}

// enrichDirectoryRows adds role names and presence, then maps to the wire type. Three
// single-schema statements merged in Go rather than one cross-schema join, the same shape
// ListEmployees and GetEmployeeCards already use (Constitution I).
func (l *iamLogicImpl) enrichDirectoryRows(
	ctx context.Context,
	tx database.DBTX,
	orgID, callerEmployeeID dbuuid.UUID,
	rows []*database.ListDirectoryEntriesRow,
) ([]*v1.DirectoryEntry, error) {
	if len(rows) == 0 {
		return nil, nil
	}

	ids := make([]dbuuid.UUID, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.ID)
	}

	rolesByEmployee := make(map[dbuuid.UUID][]string, len(ids))
	roleRows, err := l.queries.GetRoleNamesForEmployeeBatch(ctx, tx, &database.GetRoleNamesForEmployeeBatchParams{
		OrganizationID: orgID,
		EmployeeIds:    ids,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to fetch directory role names: %w", err)
	}
	for _, r := range roleRows {
		rolesByEmployee[r.EmployeeID] = append(rolesByEmployee[r.EmployeeID], r.RoleName)
	}

	presenceByEmployee := make(map[dbuuid.UUID]string, len(ids))
	presenceRows, err := l.queries.GetLatestEmployeePresenceByIDs(ctx, tx, &database.GetLatestEmployeePresenceByIDsParams{
		OrganizationID:          orgID,
		EmployeeIds:             ids,
		ResponsiveWindowSeconds: notification.ResponsiveWindowSeconds,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to fetch directory presence: %w", err)
	}
	for _, p := range presenceRows {
		status, _ := p.PresenceStatus.(string)
		// The query already folds online_hidden into offline; repeated here so a change
		// to the query cannot leak a colleague's hidden presence to a peer.
		if status == "" || status == "online_hidden" {
			status = "offline"
		}
		presenceByEmployee[p.EmployeeID] = status
	}

	entries := make([]*v1.DirectoryEntry, 0, len(rows))
	for _, row := range rows {
		entry := &v1.DirectoryEntry{
			EmployeeId:     row.ID.String(),
			GivenName:      row.GivenName,
			FamilyName:     row.FamilyName,
			RoleNames:      rolesByEmployee[row.ID],
			PresenceStatus: "offline",
			IsSelf:         row.ID == callerEmployeeID,
		}
		if status, ok := presenceByEmployee[row.ID]; ok {
			entry.PresenceStatus = status
		}
		// email is NOT NULL DEFAULT '' — an org-managed worker with no email holds the
		// empty string, and an empty string is "not recorded", not "recorded as nothing".
		if row.Email != "" {
			email := row.Email
			entry.Email = &email
		}
		if row.PhoneNumber.Valid && row.PhoneNumber.String != "" {
			phone := row.PhoneNumber.String
			entry.PhoneNumber = &phone
		}
		// Both or neither: a department id with no name is a row the client cannot label,
		// and a name with no id is a row it cannot open.
		if row.DepartmentID.Valid && row.DepartmentName.Valid {
			deptID := dbuuid.NullUUIDToUUID(row.DepartmentID).String()
			deptName := row.DepartmentName.String
			entry.DepartmentId = &deptID
			entry.DepartmentName = &deptName
		}
		entries = append(entries, entry)
	}
	return entries, nil
}

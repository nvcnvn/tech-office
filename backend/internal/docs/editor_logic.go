package docs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// ============================================================================
// Editor Domain Errors
// ============================================================================

var (
	ErrMaxEditorsReached = errors.New("maximum number of concurrent editors (10) reached")
	ErrEditorNotFound    = errors.New("editor not found")
)

// MaxConcurrentEditors is the maximum number of concurrent editors per document
const MaxConcurrentEditors = 10

// ============================================================================
// Active Editor Tracking Methods (UNLOGGED table)
// ============================================================================

func (l *documentLogicImpl) JoinDocument(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID, docID dbuuid.UUID,
	instanceID string,
) (connID dbuuid.UUID, editors []*rpcv1.ActiveEditor, limitReached bool, err error) {
	slog.DebugContext(ctx, "DocumentLogic.JoinDocument",
		"docID", docID,
		"employeeID", employeeID,
		"instanceID", instanceID,
	)

	connectionID := uuid.New()

	// Check current editor count
	count, err := l.Queries.CountActiveEditors(ctx, tx, &database.CountActiveEditorsParams{
		OrganizationID: orgID,
		DocumentID:     docID,
	})
	if err != nil {
		return dbuuid.UUID{}, nil, false, fmt.Errorf("failed to count active editors: %w", err)
	}

	if count >= MaxConcurrentEditors {
		// Check if this employee already has an editor session
		existingEditors, listErr := l.Queries.ListActiveEditors(ctx, tx, &database.ListActiveEditorsParams{
			OrganizationID: orgID,
			DocumentID:     docID,
		})
		if listErr != nil {
			return dbuuid.UUID{}, nil, false, fmt.Errorf("failed to list active editors: %w", listErr)
		}

		// Check if employee already exists
		employeeAlreadyEditing := false
		for _, e := range existingEditors {
			if dbuuid.UUID(e.EmployeeID) == employeeID {
				employeeAlreadyEditing = true
				break
			}
		}

		if !employeeAlreadyEditing {
			// Employee not already editing, indicate limit reached
			editors = l.editorsToProto(existingEditors)
			return dbuuid.UUID{}, editors, true, nil
		}
		// Employee already has session, allow reconnect
	}

	// Join as editor (upsert)
	now := pgtype.Timestamptz{Time: time.Now(), Valid: true}
	err = l.Queries.JoinDocumentAsEditor(ctx, tx, &database.JoinDocumentAsEditorParams{
		OrganizationID: orgID,
		DocumentID:     docID,
		EmployeeID:     employeeID,
		ConnectionID:   dbuuid.UUID(connectionID),
		InstanceID:     instanceID,
		CursorPosition: nil, // No initial cursor position
		ConnectedAt:    now,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to register editor",
			"error", err,
			"docID", docID,
		)
		return dbuuid.UUID{}, nil, false, fmt.Errorf("failed to register editor: %w", err)
	}

	// Get current editors
	editors, err = l.ListActiveEditors(ctx, tx, orgID, docID)
	if err != nil {
		return dbuuid.UUID{}, nil, false, err
	}

	connID = dbuuid.UUID(connectionID)
	return connID, editors, false, nil
}

func (l *documentLogicImpl) LeaveDocument(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID, docID dbuuid.UUID,
) error {
	slog.DebugContext(ctx, "DocumentLogic.LeaveDocument",
		"docID", docID,
		"employeeID", employeeID,
	)

	return l.Queries.LeaveDocument(ctx, tx, &database.LeaveDocumentParams{
		OrganizationID: orgID,
		DocumentID:     docID,
		EmployeeID:     employeeID,
	})
}

func (l *documentLogicImpl) ListActiveEditors(
	ctx context.Context,
	tx database.DBTX,
	orgID, docID dbuuid.UUID,
) ([]*rpcv1.ActiveEditor, error) {
	editors, err := l.Queries.ListActiveEditors(ctx, tx, &database.ListActiveEditorsParams{
		OrganizationID: orgID,
		DocumentID:     docID,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list active editors: %w", err)
	}

	return l.editorsToProto(editors), nil
}

func (l *documentLogicImpl) UpdateCursor(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID, docID dbuuid.UUID,
	blockID string,
	offset int32,
) error {
	cursorJSON := cursorPositionToJSON(blockID, offset)

	return l.Queries.UpdateEditorCursor(ctx, tx, &database.UpdateEditorCursorParams{
		CursorPosition: cursorJSON,
		OrganizationID: orgID,
		DocumentID:     docID,
		EmployeeID:     employeeID,
	})
}

func (l *documentLogicImpl) Heartbeat(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID, docID dbuuid.UUID,
) error {
	return l.Queries.EditorHeartbeat(ctx, tx, &database.EditorHeartbeatParams{
		OrganizationID: orgID,
		DocumentID:     docID,
		EmployeeID:     employeeID,
	})
}

// ============================================================================
// Editor Helper Functions
// ============================================================================

func (l *documentLogicImpl) editorsToProto(editors []*database.ListActiveEditorsRow) []*rpcv1.ActiveEditor {
	result := make([]*rpcv1.ActiveEditor, len(editors))
	for i, e := range editors {
		blockID, offset := parseCursorPosition(e.CursorPosition)

		employeeName := ""
		if name, ok := e.EmployeeName.(string); ok {
			employeeName = name
		}

		result[i] = &rpcv1.ActiveEditor{
			EmployeeId:    dbuuid.UUID(e.EmployeeID).String(),
			EmployeeName:  employeeName,
			CursorBlockId: blockID,
			CursorOffset:  offset,
			Color:         assignEditorColor(i),
			ConnectedAt:   timestamppb.New(e.ConnectedAt.Time),
		}
	}

	return result
}

func parseCursorPosition(jsonBytes []byte) (blockID string, offset int32) {
	if len(jsonBytes) == 0 {
		return "", 0
	}

	// Parse JSON cursor position
	// Expected format: {"block_id": "uuid", "offset": 123}
	var cursor struct {
		BlockID string `json:"block_id"`
		Offset  int32  `json:"offset"`
	}

	if err := json.Unmarshal(jsonBytes, &cursor); err != nil {
		return "", 0
	}

	return cursor.BlockID, cursor.Offset
}

func cursorPositionToJSON(blockID string, offset int32) []byte {
	cursor := struct {
		BlockID string `json:"block_id"`
		Offset  int32  `json:"offset"`
	}{
		BlockID: blockID,
		Offset:  offset,
	}

	data, err := json.Marshal(cursor)
	if err != nil {
		return nil
	}

	return data
}

// assignEditorColor assigns a consistent color to an editor based on their index
func assignEditorColor(index int) string {
	colors := []string{
		"#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4",
		"#FFEAA7", "#DDA0DD", "#98D8C8", "#F7DC6F",
		"#BB8FCE", "#85C1E9",
	}
	return colors[index%len(colors)]
}

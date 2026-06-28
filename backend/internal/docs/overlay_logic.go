package docs

import (
	"context"
	"time"

	"github.com/nvcnvn/tech-office/backend/database"
	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// GetDocDeadlinesInRange returns documents with deadlines in [from, to) as overlay items.
// Used by the calendar service for overlay rendering.
// Currently returns empty since docs.document does not have a deadline column.
// When a deadline field is added to the schema, implement the query here.
func (l *documentLogicImpl) GetDocDeadlinesInRange(
	_ context.Context,
	_ database.DBTX,
	_ dbuuid.UUID,
	_, _ time.Time,
) ([]*rpcv1.OverlayItem, error) {
	return nil, nil
}

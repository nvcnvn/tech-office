package files

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/nvcnvn/flows"

	"github.com/nvcnvn/tech-office/backend/database"
)

// EnqueueFilePostProcessing records that content indexing has been queued and enqueues
// the post-processing workflow, both in the caller's transaction.
//
// This is the one copy of what the three upload paths — chat, project task and the
// explicit TriggerPDFConversion RPC — each used to spell out inline.
//
// The pending row is what lets a status query made immediately after upload answer
// "queued" rather than "no idea": only the enqueue site knows the moment the attempt
// began. It is written from the client-declared MIME type, which may be wrong; the
// extraction step re-reads the detected type and corrects itself, deleting a stale
// pending row when the file turns out not to be one we read.
//
// Returns the enqueue error rather than deciding what it means. An upload logs it and
// carries on — post-processing is an enhancement, not the point of the upload — while an
// explicit trigger RPC surfaces it, because reporting success for work that was never
// queued is the kind of lie this feature exists to remove.
func EnqueueFilePostProcessing(
	ctx context.Context,
	flowsClient flows.Client,
	tx database.DBTX,
	workflow flows.Workflow[FilePostProcessingWorkflowInput, FilePostProcessingWorkflowOutput],
	indexLogic IndexLogic,
	input *FilePostProcessingWorkflowInput,
) error {
	if workflow == nil {
		return fmt.Errorf("postprocessing workflow not configured")
	}

	if indexLogic != nil {
		if method := indexLogic.ExtractionMethodFor(input.MimeType); method != "" {
			if _, err := indexLogic.UpsertContentIndex(ctx, tx, input.OrganizationID, input.FileID,
				"", method, IndexingStatusPending, "", 0); err != nil {
				return fmt.Errorf("failed to queue content indexing: %w", err)
			}
		}
	}

	if _, err := flows.BeginTx(ctx, flowsClient, tx, workflow, input); err != nil {
		return fmt.Errorf("failed to enqueue postprocessing workflow: %w", err)
	}

	slog.InfoContext(ctx, "post-processing workflow enqueued",
		"file_id", input.FileID,
		"mime_type", input.MimeType)

	return nil
}

package integration

import (
	"testing"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// TestContentReporting covers filing a report, reviewing it, and the one property
// that shapes the whole design: a report has to stay reviewable after its subject
// is gone, which is why the content is snapshotted rather than referenced.
func TestContentReporting(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	owner := w.withOwner()
	users := w.withEmployees(2)
	reporter, author := users[0], users[1]

	channelID := w.createChannel(owner, "Reports", false)
	w.inviteToChannel(owner, channelID, reporter.ID)
	w.inviteToChannel(owner, channelID, author.ID)

	t.Run("when a person reports a chat message", func(t *testing.T) {
		msgID := w.sendMessage(author, channelID, "You are useless and everyone knows it.")
		resp := w.reportContent(reporter, rpcv1.ReportTargetKind_REPORT_TARGET_KIND_CHAT_MESSAGE,
			msgID, rpcv1.ReportReason_REPORT_REASON_HARASSMENT, "Third time this week.")

		t.Run("the report is recorded as outstanding", func(t *testing.T) { // FR-014, FR-016
			require.NotEmpty(t, resp.ReportId)
			report := w.getReport(owner, resp.ReportId).Report
			assert.Equal(t, rpcv1.ReportStatus_REPORT_STATUS_OUTSTANDING, report.Status)
		})

		t.Run("it records who reported, who authored, and when", func(t *testing.T) { // FR-016
			report := w.getReport(owner, resp.ReportId).Report
			assert.Equal(t, reporter.ID.String(), report.ReporterEmployeeId)
			// Authorship comes from the chat domain, not from the request, so a
			// client cannot pin a message on somebody else.
			assert.Equal(t, author.ID.String(), report.ReportedEmployeeId)
			assert.NotNil(t, report.CreatedAt)
			assert.NotEmpty(t, report.ReporterName)
			assert.NotEmpty(t, report.ReportedName)
		})

		t.Run("it stores the content as it stood at report time", func(t *testing.T) { // FR-016
			report := w.getReport(owner, resp.ReportId).Report
			assert.Equal(t, "You are useless and everyone knows it.", report.ContentSnapshot)
		})

		t.Run("the reporter receives confirmation", func(t *testing.T) { // FR-015
			// The confirmation the UI shows is this response: an id and a timestamp
			// the reporter can be told about.
			assert.NotEmpty(t, resp.ReportId)
			assert.NotNil(t, resp.CreatedAt)
		})

		t.Run("a second report of the same item by the same person is rejected", func(t *testing.T) { // edge case
			_, err := w.reportContentResult(reporter, rpcv1.ReportTargetKind_REPORT_TARGET_KIND_CHAT_MESSAGE,
				msgID, rpcv1.ReportReason_REPORT_REASON_SPAM, "")
			require.Error(t, err)
			assert.Equal(t, connect.CodeAlreadyExists, connect.CodeOf(err))
		})
	})

	t.Run("when a person reports without giving a reason", func(t *testing.T) {
		msgID := w.sendMessage(author, channelID, "Anything at all.")

		t.Run("it is rejected", func(t *testing.T) { // FR-015
			_, err := w.reportContentResult(reporter, rpcv1.ReportTargetKind_REPORT_TARGET_KIND_CHAT_MESSAGE,
				msgID, rpcv1.ReportReason_REPORT_REASON_UNSPECIFIED, "")
			require.Error(t, err)
			assert.Equal(t, connect.CodeInvalidArgument, connect.CodeOf(err))
		})
	})

	t.Run("when a person reports a direct message", func(t *testing.T) {
		dmID := w.createOrGetDM(reporter, author.ID)
		dmMsgID := w.sendMessage(author, dmID, "Private and unpleasant.")

		t.Run("it is recorded with the direct-message target kind", func(t *testing.T) { // FR-014
			resp := w.reportContent(reporter, rpcv1.ReportTargetKind_REPORT_TARGET_KIND_DIRECT_MESSAGE,
				dmMsgID, rpcv1.ReportReason_REPORT_REASON_HARASSMENT, "")
			report := w.getReport(owner, resp.ReportId).Report
			assert.Equal(t, rpcv1.ReportTargetKind_REPORT_TARGET_KIND_DIRECT_MESSAGE, report.TargetKind)
			assert.Equal(t, "Private and unpleasant.", report.ContentSnapshot)
		})
	})

	t.Run("when a person reports a reply inside a direct conversation's thread", func(t *testing.T) {
		dmID := w.createOrGetDM(reporter, author.ID)
		rootID := w.sendMessage(author, dmID, "Thread root in a direct conversation.")
		replyID := w.replyToMessage(author, rootID, "And an unpleasant reply under it.")

		t.Run("it is recorded with the direct-message target kind", func(t *testing.T) { // FR-002
			// A report filed from inside a thread belongs to the conversation the
			// thread hangs off, not to a generic channel message.
			resp := w.reportContent(reporter, rpcv1.ReportTargetKind_REPORT_TARGET_KIND_DIRECT_MESSAGE,
				replyID, rpcv1.ReportReason_REPORT_REASON_HARASSMENT, "")
			report := w.getReport(owner, resp.ReportId).Report
			assert.Equal(t, rpcv1.ReportTargetKind_REPORT_TARGET_KIND_DIRECT_MESSAGE, report.TargetKind)
			assert.Equal(t, author.ID.String(), report.ReportedEmployeeId)
			assert.Equal(t, "And an unpleasant reply under it.", report.ContentSnapshot)
		})
	})

	t.Run("when a person reports an uploaded file", func(t *testing.T) {
		fileID := w.seedFile(author, "holiday-rota.png")
		resp := w.reportContent(reporter, rpcv1.ReportTargetKind_REPORT_TARGET_KIND_FILE,
			fileID, rpcv1.ReportReason_REPORT_REASON_SEXUAL_CONTENT, "")

		t.Run("it is recorded with the file target kind", func(t *testing.T) { // FR-015
			report := w.getReport(owner, resp.ReportId).Report
			assert.Equal(t, rpcv1.ReportTargetKind_REPORT_TARGET_KIND_FILE, report.TargetKind)
			assert.Equal(t, fileID, report.TargetId)
		})

		t.Run("the reported author is the person who uploaded it", func(t *testing.T) { // FR-020
			// Resolved from the files domain, not from the request, so a client
			// cannot pin an upload on somebody else.
			report := w.getReport(owner, resp.ReportId).Report
			assert.Equal(t, author.ID.String(), report.ReportedEmployeeId)
		})

		t.Run("the snapshot names the file rather than quoting a message", func(t *testing.T) { // FR-015
			report := w.getReport(owner, resp.ReportId).Report
			assert.Contains(t, report.ContentSnapshot, "holiday-rota.png")
			assert.Contains(t, report.ContentSnapshot, "image/png")
		})

		t.Run("it appears in the owner's report queue alongside message reports", func(t *testing.T) { // FR-017
			list := w.listReports(owner, rpcv1.ReportStatus_REPORT_STATUS_OUTSTANDING, "", 50)
			assert.NotNil(t, findReport(list.Reports, resp.ReportId))
		})
	})

	t.Run("when a person reports a file that no longer exists", func(t *testing.T) {
		fileID := w.seedFile(author, "already-gone.png")
		w.deleteFile(author, fileID)
		_, err := w.reportContentResult(reporter, rpcv1.ReportTargetKind_REPORT_TARGET_KIND_FILE,
			fileID, rpcv1.ReportReason_REPORT_REASON_SEXUAL_CONTENT, "")

		t.Run("it is refused as a target that could not be found", func(t *testing.T) { // FR-019
			require.Error(t, err)
			assert.Equal(t, connect.CodeNotFound, connect.CodeOf(err))
		})

		t.Run("the refusal carries the target-not-found reason, not a raw error", func(t *testing.T) { // Principle X
			// The sheet branches on this reason to say "the reported item could not
			// be found" — never on the message text.
			require.Error(t, err)
			assert.Equal(t, "COMPLIANCE_REPORT_TARGET_NOT_FOUND", errorReason(t, err))
		})
	})

	t.Run("when a person reports a document comment", func(t *testing.T) {
		docID := w.createDocument(author, "Shift handover", `{"type":"doc","content":[]}`)
		commentID := w.addDocumentComment(author, docID, "Nobody here can read anyway.")
		resp := w.reportContent(reporter, rpcv1.ReportTargetKind_REPORT_TARGET_KIND_DOCUMENT_COMMENT,
			commentID, rpcv1.ReportReason_REPORT_REASON_HARASSMENT, "")

		t.Run("it is recorded with the document-comment target kind", func(t *testing.T) { // FR-017
			report := w.getReport(owner, resp.ReportId).Report
			assert.Equal(t, rpcv1.ReportTargetKind_REPORT_TARGET_KIND_DOCUMENT_COMMENT, report.TargetKind)
			assert.Equal(t, commentID, report.TargetId)
		})

		t.Run("the reported author is the person who wrote the comment", func(t *testing.T) { // FR-020
			report := w.getReport(owner, resp.ReportId).Report
			assert.Equal(t, author.ID.String(), report.ReportedEmployeeId)
		})

		t.Run("the snapshot is the comment text as it stood", func(t *testing.T) { // FR-017
			report := w.getReport(owner, resp.ReportId).Report
			assert.Equal(t, "Nobody here can read anyway.", report.ContentSnapshot)
		})
	})

	t.Run("when the reported message is later deleted by its author", func(t *testing.T) {
		msgID := w.sendMessage(author, channelID, "This will be deleted.")
		resp := w.reportContent(reporter, rpcv1.ReportTargetKind_REPORT_TARGET_KIND_CHAT_MESSAGE,
			msgID, rpcv1.ReportReason_REPORT_REASON_HATE_SPEECH, "")
		w.deleteMessage(author, msgID)

		t.Run("the report is still reviewable with its snapshot", func(t *testing.T) { // FR-018
			// This is the reason the snapshot exists. A foreign key alone would leave
			// the reviewer looking at a tombstone.
			report := w.getReport(owner, resp.ReportId).Report
			assert.Equal(t, "This will be deleted.", report.ContentSnapshot)
			assert.Equal(t, rpcv1.ReportStatus_REPORT_STATUS_OUTSTANDING, report.Status)
		})
	})

	t.Run("when an owner lists outstanding reports", func(t *testing.T) {
		list := w.listReports(owner, rpcv1.ReportStatus_REPORT_STATUS_OUTSTANDING, "", 50)

		t.Run("every filed report appears", func(t *testing.T) { // FR-017
			assert.GreaterOrEqual(t, len(list.Reports), 3)
		})

		t.Run("reports are ordered newest first", func(t *testing.T) { // FR-017
			for i := 1; i < len(list.Reports); i++ {
				assert.Greater(t, list.Reports[i-1].Id, list.Reports[i].Id,
					"UUID v7 ids sort by creation time, so newest-first means descending")
			}
		})

		t.Run("reports page by cursor", func(t *testing.T) { // FR-017, Principle IX
			firstPage := w.listReports(owner, rpcv1.ReportStatus_REPORT_STATUS_OUTSTANDING, "", 2)
			require.Len(t, firstPage.Reports, 2)
			require.NotEmpty(t, firstPage.NextCursor, "a full page must offer a cursor")

			secondPage := w.listReports(owner, rpcv1.ReportStatus_REPORT_STATUS_OUTSTANDING, firstPage.NextCursor, 2)
			for _, r := range secondPage.Reports {
				assert.Nil(t, findReport(firstPage.Reports, r.Id),
					"a cursor page must not repeat the previous page")
			}
		})
	})

	t.Run("when an owner resolves a report", func(t *testing.T) {
		msgID := w.sendMessage(author, channelID, "Spam spam spam.")
		filed := w.reportContent(reporter, rpcv1.ReportTargetKind_REPORT_TARGET_KIND_CHAT_MESSAGE,
			msgID, rpcv1.ReportReason_REPORT_REASON_SPAM, "")

		t.Run("resolving without an outcome note is rejected", func(t *testing.T) { // FR-017
			_, err := w.resolveReportResult(owner, filed.ReportId, rpcv1.ReportStatus_REPORT_STATUS_ACTIONED, "   ")
			require.Error(t, err)
			assert.Equal(t, connect.CodeInvalidArgument, connect.CodeOf(err))
		})

		resolved, err := w.resolveReportResult(owner, filed.ReportId,
			rpcv1.ReportStatus_REPORT_STATUS_ACTIONED, "Warned the author and removed the message.")
		require.NoError(t, err)

		t.Run("the outcome and reviewer are recorded", func(t *testing.T) { // FR-017
			assert.Equal(t, rpcv1.ReportStatus_REPORT_STATUS_ACTIONED, resolved.Report.Status)
			assert.Equal(t, "Warned the author and removed the message.", resolved.Report.OutcomeNote)
			assert.Equal(t, owner.ID.String(), resolved.Report.ReviewedByEmployeeId)
			assert.NotNil(t, resolved.Report.ReviewedAt)
		})

		t.Run("it no longer appears as outstanding", func(t *testing.T) { // FR-018
			list := w.listReports(owner, rpcv1.ReportStatus_REPORT_STATUS_OUTSTANDING, "", 50)
			assert.Nil(t, findReport(list.Reports, filed.ReportId))
		})

		t.Run("resolving an already-resolved report is rejected", func(t *testing.T) { // FR-017
			_, err := w.resolveReportResult(owner, filed.ReportId,
				rpcv1.ReportStatus_REPORT_STATUS_DISMISSED, "Changed my mind.")
			require.Error(t, err)
			assert.Equal(t, connect.CodeFailedPrecondition, connect.CodeOf(err))
		})
	})

	t.Run("when an employee tries to list reports", func(t *testing.T) {
		t.Run("it returns permission denied", func(t *testing.T) { // FR-017
			// Review is administrative, which is what keeps it off mobile
			// (Constitution XIII).
			_, err := w.listReportsResult(reporter, rpcv1.ReportStatus_REPORT_STATUS_UNSPECIFIED, "", 10)
			require.Error(t, err)
			assert.Equal(t, connect.CodePermissionDenied, connect.CodeOf(err))
		})
	})

	t.Run("when a person reports a workspace owner", func(t *testing.T) {
		ownerMsgID := w.sendMessage(owner, channelID, "Something an owner said.")

		t.Run("the report is still recorded and visible to owners", func(t *testing.T) { // edge case
			// Nothing exempts an owner from being reported. Whether the same owner
			// should review it is a policy question the product does not answer yet;
			// what matters here is that the report exists.
			resp := w.reportContent(reporter, rpcv1.ReportTargetKind_REPORT_TARGET_KIND_CHAT_MESSAGE,
				ownerMsgID, rpcv1.ReportReason_REPORT_REASON_OTHER, "")
			report := w.getReport(owner, resp.ReportId).Report
			assert.Equal(t, owner.ID.String(), report.ReportedEmployeeId)
		})
	})
}

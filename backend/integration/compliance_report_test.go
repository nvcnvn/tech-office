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

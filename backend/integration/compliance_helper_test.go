package integration

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/require"

	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// ---------------------------------------------------------------------------
// Act: Compliance — reporting
// ---------------------------------------------------------------------------

func (w *testWorld) reportContent(
	actor testUser,
	kind rpcv1.ReportTargetKind,
	targetID string,
	reason rpcv1.ReportReason,
	note string,
) *rpcv1.ReportContentResponse {
	w.t.Helper()
	resp, err := w.reportContentResult(actor, kind, targetID, reason, note)
	require.NoError(w.t, err)
	return resp
}

func (w *testWorld) reportContentResult(
	actor testUser,
	kind rpcv1.ReportTargetKind,
	targetID string,
	reason rpcv1.ReportReason,
	note string,
) (*rpcv1.ReportContentResponse, error) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.ReportContentRequest{
		TargetKind: kind,
		TargetId:   targetID,
		Reason:     reason,
		Note:       note,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.compliance.ReportContent(context.Background(), req)
	if err != nil {
		return nil, err
	}
	return resp.Msg, nil
}

func (w *testWorld) listReports(actor testUser, status rpcv1.ReportStatus, cursor string, limit int32) *rpcv1.ListReportsResponse {
	w.t.Helper()
	resp, err := w.listReportsResult(actor, status, cursor, limit)
	require.NoError(w.t, err)
	return resp
}

func (w *testWorld) listReportsResult(actor testUser, status rpcv1.ReportStatus, cursor string, limit int32) (*rpcv1.ListReportsResponse, error) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.ListReportsRequest{
		StatusFilter: status,
		Cursor:       cursor,
		Limit:        limit,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.compliance.ListReports(context.Background(), req)
	if err != nil {
		return nil, err
	}
	return resp.Msg, nil
}

func (w *testWorld) getReport(actor testUser, reportID string) *rpcv1.GetReportResponse {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.GetReportRequest{ReportId: reportID})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.compliance.GetReport(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg
}

func (w *testWorld) resolveReportResult(actor testUser, reportID string, outcome rpcv1.ReportStatus, note string) (*rpcv1.ResolveReportResponse, error) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.ResolveReportRequest{
		ReportId:    reportID,
		Outcome:     outcome,
		OutcomeNote: note,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.compliance.ResolveReport(context.Background(), req)
	if err != nil {
		return nil, err
	}
	return resp.Msg, nil
}

// findReport returns the report with the given id from a list, or nil.
func findReport(reports []*rpcv1.ContentReport, id string) *rpcv1.ContentReport {
	for _, r := range reports {
		if r.Id == id {
			return r
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// Act: Compliance — blocking
// ---------------------------------------------------------------------------

func (w *testWorld) blockPerson(actor testUser, employeeID dbuuid.UUID) *rpcv1.BlockPersonResponse {
	w.t.Helper()
	resp, err := w.blockPersonResult(actor, employeeID)
	require.NoError(w.t, err)
	return resp
}

func (w *testWorld) blockPersonResult(actor testUser, employeeID dbuuid.UUID) (*rpcv1.BlockPersonResponse, error) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.BlockPersonRequest{EmployeeId: employeeID.String()})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.compliance.BlockPerson(context.Background(), req)
	if err != nil {
		return nil, err
	}
	return resp.Msg, nil
}

func (w *testWorld) unblockPerson(actor testUser, employeeID dbuuid.UUID) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.UnblockPersonRequest{EmployeeId: employeeID.String()})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.compliance.UnblockPerson(context.Background(), req)
	require.NoError(w.t, err)
}

func (w *testWorld) listBlockedPeople(actor testUser) []*rpcv1.BlockedPerson {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.ListBlockedPeopleRequest{})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.compliance.ListBlockedPeople(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Blocked
}

// createOrGetDMResult is createOrGetDM without the require, for the cases where
// the refusal is the thing under test.
func (w *testWorld) createOrGetDMResult(actor testUser, targetID dbuuid.UUID) (string, error) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.CreateOrGetDirectMessageRequest{OtherEmployeeId: targetID.String()})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.chat.CreateOrGetDirectMessage(context.Background(), req)
	if err != nil {
		return "", err
	}
	return resp.Msg.Channel.Id, nil
}

// ---------------------------------------------------------------------------
// Act: Compliance — removal requests and account deletion
// ---------------------------------------------------------------------------

func (w *testWorld) getAccountRemovalPath(actor testUser) *rpcv1.GetAccountRemovalPathResponse {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.GetAccountRemovalPathRequest{})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.compliance.GetAccountRemovalPath(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg
}

func (w *testWorld) requestAccountRemovalResult(actor testUser, note string) (*rpcv1.RequestAccountRemovalResponse, error) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.RequestAccountRemovalRequest{Note: note})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.compliance.RequestAccountRemoval(context.Background(), req)
	if err != nil {
		return nil, err
	}
	return resp.Msg, nil
}

func (w *testWorld) requestAccountRemoval(actor testUser, note string) *rpcv1.RequestAccountRemovalResponse {
	w.t.Helper()
	resp, err := w.requestAccountRemovalResult(actor, note)
	require.NoError(w.t, err)
	return resp
}

func (w *testWorld) listRemovalRequestsResult(actor testUser, status rpcv1.RemovalRequestStatus) (*rpcv1.ListRemovalRequestsResponse, error) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.ListRemovalRequestsRequest{StatusFilter: status, Limit: 50})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.compliance.ListRemovalRequests(context.Background(), req)
	if err != nil {
		return nil, err
	}
	return resp.Msg, nil
}

func (w *testWorld) decideRemovalRequestResult(actor testUser, requestID string, decision rpcv1.RemovalRequestStatus) (*rpcv1.DecideRemovalRequestResponse, error) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.DecideRemovalRequestRequest{RequestId: requestID, Decision: decision})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.compliance.DecideRemovalRequest(context.Background(), req)
	if err != nil {
		return nil, err
	}
	return resp.Msg, nil
}

func (w *testWorld) getAccountDeletionPreview(actor testUser) *rpcv1.GetAccountDeletionPreviewResponse {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.GetAccountDeletionPreviewRequest{})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.iamClient.GetAccountDeletionPreview(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg
}

func (w *testWorld) deleteMyAccountResult(actor testUser, phrase string) (*rpcv1.DeleteMyAccountResponse, error) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.DeleteMyAccountRequest{ConfirmationPhrase: phrase})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.iamClient.DeleteMyAccount(context.Background(), req)
	if err != nil {
		return nil, err
	}
	return resp.Msg, nil
}

// ---------------------------------------------------------------------------
// Arrange: an admin-provisioned worker
// ---------------------------------------------------------------------------

// withOrgManagedWorker creates a PIN worker the ordinary administrative way, so
// their iam.user carries is_org_managed = true and they get the removal-request
// path rather than self-deletion.
func (w *testWorld) withOrgManagedWorker(owner testUser) testUser {
	w.t.Helper()
	ctx := context.Background()
	suffix := strings.ReplaceAll(dbuuid.Must().String(), "-", "")[:12]

	req := connect.NewRequest(&rpcv1.CreateOrgAccountRequest{
		LoginIdentifier: fmt.Sprintf("worker%s", suffix),
		DisplayName:     "Provisioned Worker",
		GivenName:       "Provisioned",
		FamilyName:      "Worker",
	})
	req.Header().Set("Authorization", "Bearer "+owner.Token)
	resp, err := w.iamClient.CreateOrgAccount(ctx, req)
	require.NoError(w.t, err, "create org-managed account")

	workerID, err := dbuuid.Parse(resp.Msg.Id)
	require.NoError(w.t, err)

	token, _, _, err := globalSigner.GenerateTokenWithOrg(workerID, "", owner.OrgID)
	require.NoError(w.t, err, "generate worker JWT")
	return testUser{ID: workerID, OrgID: owner.OrgID, Token: token}
}

// countNotificationsOfType counts a person's notifications of one type, used to
// assert the silence a block must keep.
func (w *testWorld) countNotificationsOfType(t *testing.T, employeeID dbuuid.UUID, notificationType string) int {
	t.Helper()
	var count int
	err := globalDB.QueryRow(context.Background(),
		`SELECT COUNT(*)
		 FROM notification.notification n
		 JOIN notification.notification_recipient r
		   ON (r.organization_id, r.notification_id) = (n.organization_id, n.id)
		 WHERE r.employee_id = $1 AND n.notification_type = $2`,
		employeeID, notificationType,
	).Scan(&count)
	require.NoError(t, err)
	return count
}

// dbUUIDFromString parses a UUID from an RPC response for use in a direct DB
// assertion.
func dbUUIDFromString(t *testing.T, s string) dbuuid.UUID {
	t.Helper()
	id, err := dbuuid.Parse(s)
	require.NoError(t, err)
	return id
}

func (w *testWorld) deleteMessage(actor testUser, messageID string) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.DeleteMessageRequest{MessageId: messageID})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.chat.DeleteMessage(context.Background(), req)
	require.NoError(w.t, err)
}

func (w *testWorld) getTermsStatus(actor testUser) *rpcv1.GetTermsStatusResponse {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.GetTermsStatusRequest{})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.iamClient.GetTermsStatus(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg
}

func (w *testWorld) acceptTermsResult(actor testUser, version string) (*rpcv1.AcceptTermsResponse, error) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.AcceptTermsRequest{TermsVersion: version})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.iamClient.AcceptTerms(context.Background(), req)
	if err != nil {
		return nil, err
	}
	return resp.Msg, nil
}

// secondMembershipFor adds an existing person to a second organization, so a
// deletion has to walk more than one shard.
//
// The membership rows are inserted directly rather than through invite→accept.
// AcceptInvitation does not currently create an organization.employee row for a
// user who already exists, so the invite flow cannot produce a second membership
// today; that is a pre-existing gap in multi-organization membership and not
// something this feature changes. Arranging the state directly keeps the deletion
// behaviour under test rather than that gap.
func (w *testWorld) secondMembershipFor(user testUser) testUser {
	w.t.Helper()
	ctx := context.Background()

	otherOrgID, _, _ := w.mustRegisterNewOrg()

	var email string
	require.NoError(w.t, globalDB.QueryRow(ctx,
		`SELECT COALESCE(email, '') FROM iam.user WHERE id = $1`, user.ID).Scan(&email))

	_, err := globalDB.Exec(ctx,
		`INSERT INTO iam.identity (id, organization_id, email, identity_type)
		 VALUES ($1, $2, $3, 'human')`, user.ID, otherOrgID, email)
	require.NoError(w.t, err, "create identity in second org")

	_, err = globalDB.Exec(ctx,
		`INSERT INTO organization.employee (id, organization_id, given_name, family_name, email)
		 VALUES ($1, $2, 'Second', 'Membership', $3)`, user.ID, otherOrgID, email)
	require.NoError(w.t, err, "create employee in second org")

	var employeeRoleID string
	require.NoError(w.t, globalDB.QueryRow(ctx,
		`SELECT id FROM iam.role WHERE organization_id = $1 AND source_default_role_id = 'employee' LIMIT 1`,
		otherOrgID).Scan(&employeeRoleID))
	_, err = globalDB.Exec(ctx,
		`INSERT INTO iam.employee_role (organization_id, employee_id, role_id)
		 VALUES ($1, $2, $3)`, otherOrgID, user.ID, employeeRoleID)
	require.NoError(w.t, err, "assign employee role in second org")

	token, _, _, err := globalSigner.GenerateTokenWithOrg(user.ID, email, otherOrgID)
	require.NoError(w.t, err)
	return testUser{ID: user.ID, OrgID: otherOrgID, Token: token}
}

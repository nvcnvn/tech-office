package integration

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/require"
	"google.golang.org/genproto/googleapis/rpc/errdetails"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/internal/collaboration"
	"github.com/nvcnvn/tech-office/backend/internal/config"
	"github.com/nvcnvn/tech-office/backend/internal/iam"
	"github.com/nvcnvn/tech-office/backend/internal/notification"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/nvcnvn/tech-office/backend/rpc/v1/rpcv1connect"
)

// ---------------------------------------------------------------------------
// Global infrastructure (shared across all tests in the package)
// ---------------------------------------------------------------------------

const serverBaseURL = "http://localhost:18080"

var (
	globalSigner *iam.InternalJWTSigner
	globalDB     database.AdminDatabaseConnector
	globalQ      *database.Queries
)

func init() {
	keyPath := findJWTKey()
	if keyPath == "" {
		panic("JWT private key not found")
	}
	signer, err := iam.NewInternalJWTSigner(keyPath)
	if err != nil {
		panic("Failed to create InternalJWTSigner: " + err.Error())
	}
	globalSigner = signer

	dbURL := config.Get().DatabaseURL
	if dbURL == "" {
		pgPort := os.Getenv("TECH_OFFICE_PG_PORT")
		if pgPort == "" {
			pgPort = "15432"
		}
		dbURL = fmt.Sprintf("postgres://postgres:tech_office_password@localhost:%s/tech_office_db?sslmode=disable", pgPort)
	}

	pool, err := database.NewAdminPool(context.Background(), dbURL)
	if err != nil {
		panic("Failed to create AdminPool: " + err.Error())
	}
	globalDB = pool
	globalQ = database.New()
}

// registeredOrgs records every organisation this run creates so TestMain can delete
// them afterwards. Tests call rememberOrg from parallel goroutines, hence the mutex.
var (
	registeredOrgsMu sync.Mutex
	registeredOrgs   []dbuuid.UUID
)

func rememberOrg(orgID dbuuid.UUID) {
	registeredOrgsMu.Lock()
	defer registeredOrgsMu.Unlock()
	registeredOrgs = append(registeredOrgs, orgID)
}

// takeRegisteredOrgs returns the recorded organisations and clears the registry.
func takeRegisteredOrgs() []dbuuid.UUID {
	registeredOrgsMu.Lock()
	defer registeredOrgsMu.Unlock()
	orgs := registeredOrgs
	registeredOrgs = nil
	return orgs
}

func findJWTKey() string {
	dir, err := os.Getwd()
	if err != nil {
		return ""
	}
	for {
		keyPath := filepath.Join(dir, ".dev-keys", "jwt-private.pem")
		if _, err := os.Stat(keyPath); err == nil {
			return keyPath
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return ""
}

// ---------------------------------------------------------------------------
// testUser — an authenticated identity
// ---------------------------------------------------------------------------

type testUser struct {
	ID    dbuuid.UUID
	OrgID dbuuid.UUID
	Token string
}

// ---------------------------------------------------------------------------
// testWorld — the shared arrange / act toolkit
//
// Create one per top-level test function. Use its methods to keep subtests
// focused on WHAT is being verified, not HOW the RPC calls are made.
// ---------------------------------------------------------------------------

type testWorld struct {
	t          *testing.T
	OrgID      dbuuid.UUID
	ownerToken string // JWT for the org owner, used to invite employees

	// Cached SSE connection IDs per actor (actor.ID -> connectionID)
	sseConnections map[dbuuid.UUID]string

	// RPC clients
	chat        rpcv1connect.ChatServiceClient
	chatFile    rpcv1connect.ChatFileServiceClient
	voice       rpcv1connect.VoiceServiceClient
	notif       rpcv1connect.NotificationServiceClient
	collab      rpcv1connect.CollaborationServiceClient
	file        rpcv1connect.FileServiceClient
	pref        rpcv1connect.PreferenceServiceClient
	dept        rpcv1connect.DepartmentServiceClient
	org         rpcv1connect.OrganizationServiceClient
	iamClient   rpcv1connect.IAMServiceClient
	doc         rpcv1connect.DocumentServiceClient
	docVersion  rpcv1connect.DocumentVersionServiceClient
	docAccess   rpcv1connect.DocumentAccessServiceClient
	docFollower rpcv1connect.DocumentFollowerServiceClient
	docComment  rpcv1connect.CommentServiceClient
	docEmbed    rpcv1connect.SectionEmbedServiceClient
	docEditor   rpcv1connect.DocumentEditorServiceClient
	docReaction rpcv1connect.DocumentReactionServiceClient
	cal         rpcv1connect.CalendarServiceClient
	compliance  rpcv1connect.ComplianceServiceClient
}

func newTestWorld(t *testing.T) *testWorld {
	t.Helper()
	return &testWorld{
		t:           t,
		chat:        rpcv1connect.NewChatServiceClient(http.DefaultClient, serverBaseURL),
		chatFile:    rpcv1connect.NewChatFileServiceClient(http.DefaultClient, serverBaseURL),
		voice:       rpcv1connect.NewVoiceServiceClient(http.DefaultClient, serverBaseURL),
		notif:       rpcv1connect.NewNotificationServiceClient(http.DefaultClient, serverBaseURL),
		collab:      rpcv1connect.NewCollaborationServiceClient(http.DefaultClient, serverBaseURL),
		file:        rpcv1connect.NewFileServiceClient(http.DefaultClient, serverBaseURL),
		pref:        rpcv1connect.NewPreferenceServiceClient(http.DefaultClient, serverBaseURL),
		dept:        rpcv1connect.NewDepartmentServiceClient(http.DefaultClient, serverBaseURL),
		org:         rpcv1connect.NewOrganizationServiceClient(http.DefaultClient, serverBaseURL),
		iamClient:   rpcv1connect.NewIAMServiceClient(http.DefaultClient, serverBaseURL),
		doc:         rpcv1connect.NewDocumentServiceClient(http.DefaultClient, serverBaseURL),
		docVersion:  rpcv1connect.NewDocumentVersionServiceClient(http.DefaultClient, serverBaseURL),
		docAccess:   rpcv1connect.NewDocumentAccessServiceClient(http.DefaultClient, serverBaseURL),
		docFollower: rpcv1connect.NewDocumentFollowerServiceClient(http.DefaultClient, serverBaseURL),
		docComment:  rpcv1connect.NewCommentServiceClient(http.DefaultClient, serverBaseURL),
		docEmbed:    rpcv1connect.NewSectionEmbedServiceClient(http.DefaultClient, serverBaseURL),
		docEditor:   rpcv1connect.NewDocumentEditorServiceClient(http.DefaultClient, serverBaseURL),
		docReaction: rpcv1connect.NewDocumentReactionServiceClient(http.DefaultClient, serverBaseURL),
		cal:         rpcv1connect.NewCalendarServiceClient(http.DefaultClient, serverBaseURL),
		compliance:  rpcv1connect.NewComplianceServiceClient(http.DefaultClient, serverBaseURL),
	}
}

// ---------------------------------------------------------------------------
// Arrange: identity helpers
// ---------------------------------------------------------------------------

// withOwner registers a fresh organisation and returns the owner.
// It also stores ownerToken on the testWorld so subsequent withEmployee calls
// add employees to the same org.
func (w *testWorld) withOwner() testUser {
	w.t.Helper()
	orgID, ownerID, token := w.mustRegisterNewOrg()
	w.ownerToken = token
	return testUser{ID: ownerID, OrgID: orgID, Token: token}
}

// withEmployee returns a fresh employee.  If withOwner() was already called,
// the employee is added to the same org; otherwise a new org is created.
func (w *testWorld) withEmployee() testUser {
	w.t.Helper()
	if w.OrgID == (dbuuid.UUID{}) {
		_, _, ownerToken := w.mustRegisterNewOrg()
		w.ownerToken = ownerToken
	}
	empID, empToken := w.mustCreateEmployeeInOrg(w.OrgID, w.ownerToken)
	return testUser{ID: empID, OrgID: w.OrgID, Token: empToken}
}

// withEmployees returns n fresh employees all in the same org.
func (w *testWorld) withEmployees(n int) []testUser {
	w.t.Helper()
	if w.OrgID == (dbuuid.UUID{}) {
		_, _, ownerToken := w.mustRegisterNewOrg()
		w.ownerToken = ownerToken
	}
	users := make([]testUser, n)
	for i := range n {
		empID, empToken := w.mustCreateEmployeeInOrg(w.OrgID, w.ownerToken)
		users[i] = testUser{ID: empID, OrgID: w.OrgID, Token: empToken}
	}
	return users
}

// withUsersFromDifferentOrgs returns two employees from two separate orgs.
func (w *testWorld) withUsersFromDifferentOrgs() (testUser, testUser) {
	w.t.Helper()
	orgID1, _, ownerToken1 := w.mustRegisterNewOrg()
	empID1, empToken1 := w.mustCreateEmployeeInOrg(orgID1, ownerToken1)
	u1 := testUser{ID: empID1, OrgID: orgID1, Token: empToken1}

	orgID2, _, ownerToken2 := w.mustRegisterNewOrg()
	empID2, empToken2 := w.mustCreateEmployeeInOrg(orgID2, ownerToken2)
	u2 := testUser{ID: empID2, OrgID: orgID2, Token: empToken2}

	require.NotEqual(w.t, u1.OrgID, u2.OrgID, "need users from different orgs")
	return u1, u2
}

func (w *testWorld) systemToken() string {
	w.t.Helper()
	require.NotEqual(w.t, w.OrgID, dbuuid.UUID{}, "OrgID not set — call withOwner/withEmployee first")
	return generateSystemTokenForOrg(w.OrgID)
}

// mustRegisterNewOrg registers a brand-new organisation via the public API and
// returns its ID together with the owner's user-ID and a valid JWT.
func (w *testWorld) mustRegisterNewOrg() (orgID dbuuid.UUID, ownerID dbuuid.UUID, ownerToken string) {
	w.t.Helper()
	ctx := context.Background()
	// Use the full UUID (stripped of dashes) so the suffix is always unique;
	// the first 8 hex chars of a UUID v7 encode the millisecond timestamp and
	// repeat across tests that run within the same millisecond.
	uid := dbuuid.Must()
	suffix := strings.ReplaceAll(uid.String(), "-", "")
	email := fmt.Sprintf("owner+%s@test.invalid", suffix)
	subdomain := fmt.Sprintf("to%s", suffix[:20]) // varchar(63) limit is not a concern
	password := "Test1234!"

	resp, err := w.org.RegisterOrganizationWithAdminPassword(ctx, connect.NewRequest(&rpcv1.RegisterOrganizationWithAdminPasswordRequest{
		CompanyName:     fmt.Sprintf("Test Org %s", suffix),
		Subdomain:       subdomain,
		AdminEmail:      email,
		AdminPassword:   password,
		AdminGivenName:  "Test",
		AdminFamilyName: "Owner",
		// Required since Feature 036: an account cannot be created without a
		// recorded acceptance of the current terms.
		AcceptedTermsVersion: iam.CurrentTermsVersion,
	}))
	require.NoError(w.t, err, "register org")

	orgID, err = dbuuid.Parse(resp.Msg.Organization.Id)
	require.NoError(w.t, err, "parse org ID")
	w.OrgID = orgID
	rememberOrg(orgID)

	// Fetch the owner's user ID from the DB (registration response only returns the org).
	err = globalDB.QueryRow(ctx,
		`SELECT er.employee_id FROM iam.employee_role er
		 JOIN iam.role r ON r.organization_id = er.organization_id AND r.id = er.role_id
		 WHERE er.organization_id = $1 AND r.source_default_role_id = 'owner'
		 LIMIT 1`, orgID,
	).Scan(&ownerID)
	require.NoError(w.t, err, "find owner user in DB")

	ownerToken, _, _, err = globalSigner.GenerateTokenWithOrg(ownerID, email, orgID)
	require.NoError(w.t, err, "generate owner JWT")
	return orgID, ownerID, ownerToken
}

// mustCreateEmployeeInOrg invites a fresh employee to an existing org via the
// invite→accept flow and returns their user-ID and a valid JWT.
func (w *testWorld) mustCreateEmployeeInOrg(orgID dbuuid.UUID, ownerToken string) (empID dbuuid.UUID, empToken string) {
	w.t.Helper()
	ctx := context.Background()
	suffix := strings.ReplaceAll(dbuuid.Must().String(), "-", "")
	email := fmt.Sprintf("emp+%s@test.invalid", suffix)
	password := "Test1234!"

	// Look up the "employee" role ID for this org.
	var employeeRoleID string
	err := globalDB.QueryRow(ctx,
		`SELECT id FROM iam.role
		 WHERE organization_id = $1 AND source_default_role_id = 'employee'
		 LIMIT 1`, orgID,
	).Scan(&employeeRoleID)
	require.NoError(w.t, err, "find employee role ID")

	// Owner sends the invitation.
	inviteReq := connect.NewRequest(&rpcv1.InviteUserRequest{
		OrganizationId: orgID.String(),
		Email:          email,
		RoleId:         employeeRoleID,
	})
	inviteReq.Header().Set("Authorization", "Bearer "+ownerToken)
	_, err = w.iamClient.InviteUser(ctx, inviteReq)
	require.NoError(w.t, err, "invite employee")

	// Retrieve the invitation token directly from the DB (no email available in tests).
	var invToken string
	err = globalDB.QueryRow(ctx,
		`SELECT token FROM iam.invitation
		 WHERE organization_id = $1 AND email = $2 AND status = 'pending'
		 LIMIT 1`, orgID, email,
	).Scan(&invToken)
	require.NoError(w.t, err, "find invitation token in DB")

	// Employee accepts the invitation.
	displayName := "Test Employee"
	acceptResp, err := w.iamClient.AcceptInvitation(ctx, connect.NewRequest(&rpcv1.AcceptInvitationRequest{
		Token:                invToken,
		Password:             &password,
		DisplayName:          &displayName,
		AcceptedTermsVersion: iam.CurrentTermsVersion,
	}))
	require.NoError(w.t, err, "accept invitation")

	empID, err = dbuuid.Parse(acceptResp.Msg.User.Id)
	require.NoError(w.t, err, "parse employee user ID")

	empToken, _, _, err = globalSigner.GenerateTokenWithOrg(empID, email, orgID)
	require.NoError(w.t, err, "generate employee JWT")
	return empID, empToken
}

// ---------------------------------------------------------------------------
// Act: IAM — Roles & Permissions
// ---------------------------------------------------------------------------

func (w *testWorld) listPermissions(actor testUser, domain *string) []*rpcv1.PermissionGroup {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.ListPermissionsRequest{Domain: domain})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.iamClient.ListPermissions(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Groups
}

func (w *testWorld) listRoles(actor testUser) []*rpcv1.OrgRole {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.ListRolesRequest{})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.iamClient.ListRoles(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Roles
}

func (w *testWorld) getRole(actor testUser, roleID string) *rpcv1.OrgRole {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.GetRoleRequest{RoleId: roleID})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.iamClient.GetRole(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Role
}

func (w *testWorld) getProfile(actor testUser) *rpcv1.GetProfileResponse {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.GetProfileRequest{})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.iamClient.GetProfile(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg
}

func (w *testWorld) createRole(actor testUser, name, description string, permissionIDs []string) *rpcv1.OrgRole {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.CreateRoleRequest{
		Name:          name,
		Description:   description,
		PermissionIds: permissionIDs,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.iamClient.CreateRole(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Role
}

func (w *testWorld) updateRole(actor testUser, roleID string, name, description *string, permissionIDs []string) *rpcv1.OrgRole {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.UpdateRoleRequest{
		RoleId:            roleID,
		Name:              name,
		Description:       description,
		PermissionIds:     permissionIDs,
		UpdatePermissions: permissionIDs != nil,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.iamClient.UpdateRole(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Role
}

func (w *testWorld) deleteRole(actor testUser, roleID string) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.DeleteRoleRequest{RoleId: roleID})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.iamClient.DeleteRole(context.Background(), req)
	require.NoError(w.t, err)
}

func (w *testWorld) assignRole(actor testUser, employeeID, roleID string) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.AssignRoleRequest{
		EmployeeId: employeeID,
		RoleId:     roleID,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.iamClient.AssignRole(context.Background(), req)
	require.NoError(w.t, err)
}

func (w *testWorld) revokeRole(actor testUser, employeeID, roleID string) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.RevokeRoleRequest{
		EmployeeId: employeeID,
		RoleId:     roleID,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.iamClient.RevokeRole(context.Background(), req)
	require.NoError(w.t, err)
}

func (w *testWorld) listEmployeeRoles(actor testUser, employeeID string) []*rpcv1.OrgRole {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.ListEmployeeRolesRequest{EmployeeId: employeeID})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.iamClient.ListEmployeeRoles(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Roles
}

func (w *testWorld) getEmployeePermissions(actor testUser, employeeID string) []string {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.GetEmployeePermissionsRequest{EmployeeId: employeeID})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.iamClient.GetEmployeePermissions(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.PermissionIds
}

// ---------------------------------------------------------------------------
// Act: Chat
// ---------------------------------------------------------------------------

func (w *testWorld) createChannel(actor testUser, name string, private bool) string {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.CreateChannelRequest{
		TitleSlug:   fmt.Sprintf("test-%s-%s", strings.ToLower(strings.ReplaceAll(name, " ", "-")), uuid.New().String()[:8]),
		DisplayName: name,
		ChannelType: rpcv1.ChannelType_CHANNEL_TYPE_CHAT,
		IsPrivate:   private,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.chat.CreateChannel(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Channel.Id
}

func (w *testWorld) sendMessage(actor testUser, channelID, text string) string {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.SendMessageRequest{
		ChannelId:   channelID,
		MessageText: text,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.chat.SendMessage(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Message.Id
}

func (w *testWorld) sendMentionMessage(actor testUser, channelID string, mentionedUserID dbuuid.UUID) string {
	w.t.Helper()
	html := fmt.Sprintf(
		`<p>Hey <span data-type="mention" data-id="%s" data-label="Colleague" class="text-blue-600 font-medium bg-blue-50 px-1 rounded">@Colleague</span>, check this</p>`,
		mentionedUserID.String(),
	)
	return w.sendMessage(actor, channelID, html)
}

func (w *testWorld) sendDeptMentionMessage(actor testUser, channelID string, deptID dbuuid.UUID) string {
	w.t.Helper()
	html := fmt.Sprintf(
		`<p>Attention <span data-type="mention" data-id="dept-%s" data-label="Team" class="text-blue-600 font-medium bg-blue-50 px-1 rounded">@Team</span>!</p>`,
		deptID.String(),
	)
	return w.sendMessage(actor, channelID, html)
}

func (w *testWorld) sendMixedMentionMessage(actor testUser, channelID string, userID, deptID dbuuid.UUID) string {
	w.t.Helper()
	html := fmt.Sprintf(
		`<p>Hey <span data-type="mention" data-id="%s" data-label="Alice">@Alice</span> and <span data-type="mention" data-id="dept-%s" data-label="Team">@Team</span>, check this!</p>`,
		userID.String(), deptID.String(),
	)
	return w.sendMessage(actor, channelID, html)
}

func (w *testWorld) inviteToChannel(actor testUser, channelID string, inviteeID dbuuid.UUID) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.InviteMemberRequest{
		ChannelId:  channelID,
		EmployeeId: inviteeID.String(),
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.chat.InviteMember(context.Background(), req)
	require.NoError(w.t, err)
}

func (w *testWorld) createOrGetDM(actor testUser, targetID dbuuid.UUID) string {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.CreateOrGetDirectMessageRequest{
		OtherEmployeeId: targetID.String(),
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.chat.CreateOrGetDirectMessage(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Channel.Id
}

func (w *testWorld) markChannelAsRead(actor testUser, channelID string) int32 {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.MarkChannelAsReadRequest{
		ChannelId: channelID,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.chat.MarkChannelAsRead(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.UnreadCount
}

func (w *testWorld) replyToMessage(actor testUser, parentMessageID, text string) string {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.ReplyToMessageRequest{
		ParentMessageId: parentMessageID,
		MessageText:     text,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.chat.ReplyToMessage(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Message.Id
}

func (w *testWorld) addReaction(actor testUser, messageID, emoji string) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.AddReactionRequest{
		MessageId: messageID,
		EmojiCode: emoji,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.chat.AddReaction(context.Background(), req)
	require.NoError(w.t, err)
}

func (w *testWorld) listMessages(actor testUser, channelID string) []*rpcv1.Message {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.ListMessagesRequest{
		ChannelId: channelID,
		PageSize:  100,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.chat.ListMessages(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Messages
}

// ---------------------------------------------------------------------------
// Act: Voice
// ---------------------------------------------------------------------------

func (w *testWorld) startVoiceCall(actor testUser, channelID string) (*rpcv1.VoiceCallSession, *rpcv1.VoiceJoinCredentials) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.StartVoiceCallRequest{ChannelId: channelID})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.voice.StartVoiceCall(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Call, resp.Msg.JoinCredentials
}

func (w *testWorld) startVoiceCallError(actor testUser, channelID string) error {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.StartVoiceCallRequest{ChannelId: channelID})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.voice.StartVoiceCall(context.Background(), req)
	return err
}

func (w *testWorld) getActiveVoiceCall(actor testUser, channelID string) (*rpcv1.VoiceCallSession, bool) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.GetActiveVoiceCallRequest{ChannelId: channelID})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.voice.GetActiveVoiceCall(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Call, resp.Msg.HasActiveCall
}

func (w *testWorld) getActiveVoiceCallError(actor testUser, channelID string) error {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.GetActiveVoiceCallRequest{ChannelId: channelID})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.voice.GetActiveVoiceCall(context.Background(), req)
	return err
}

func (w *testWorld) joinVoiceCall(actor testUser, callID string) (*rpcv1.VoiceCallSession, *rpcv1.VoiceJoinCredentials) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.JoinVoiceCallRequest{CallId: callID})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.voice.JoinVoiceCall(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Call, resp.Msg.JoinCredentials
}

func (w *testWorld) joinVoiceCallError(actor testUser, callID string) error {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.JoinVoiceCallRequest{CallId: callID})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.voice.JoinVoiceCall(context.Background(), req)
	return err
}

func (w *testWorld) leaveVoiceCall(actor testUser, callID string) *rpcv1.VoiceCallSession {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.LeaveVoiceCallRequest{CallId: callID})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.voice.LeaveVoiceCall(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Call
}

func (w *testWorld) endVoiceCall(actor testUser, callID string) *rpcv1.VoiceCallSession {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.EndVoiceCallRequest{CallId: callID})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.voice.EndVoiceCall(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Call
}

func (w *testWorld) inviteToVoiceCall(actor testUser, callID string, employeeIDs ...string) (*rpcv1.VoiceCallSession, []*rpcv1.VoiceCallInvitation) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.InviteToVoiceCallRequest{CallId: callID, EmployeeIds: employeeIDs})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.voice.InviteToVoiceCall(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Call, resp.Msg.Invitations
}

func (w *testWorld) inviteToVoiceCallError(actor testUser, callID string, employeeIDs ...string) error {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.InviteToVoiceCallRequest{CallId: callID, EmployeeIds: employeeIDs})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.voice.InviteToVoiceCall(context.Background(), req)
	return err
}

func (w *testWorld) respondToVoiceCallInvite(actor testUser, invitationID string, response rpcv1.VoiceInviteResponse) (*rpcv1.VoiceCallInvitation, *rpcv1.VoiceJoinCredentials) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.RespondToVoiceCallInviteRequest{InvitationId: invitationID, Response: response})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.voice.RespondToVoiceCallInvite(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Invitation, resp.Msg.JoinCredentials
}

func (w *testWorld) respondToVoiceCallInviteError(actor testUser, invitationID string, response rpcv1.VoiceInviteResponse) error {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.RespondToVoiceCallInviteRequest{InvitationId: invitationID, Response: response})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.voice.RespondToVoiceCallInvite(context.Background(), req)
	return err
}

func (w *testWorld) listCallRecords(actor testUser, channelID string) []*rpcv1.VoiceCallRecord {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.ListCallRecordsRequest{ChannelId: channelID, Limit: 10})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.voice.ListCallRecords(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Records
}

func (w *testWorld) getCallRecord(actor testUser, callID string) *rpcv1.VoiceCallRecord {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.GetCallRecordRequest{CallId: callID})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.voice.GetCallRecord(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Record
}

func (w *testWorld) requestVoiceMessageUpload(actor testUser, channelID, dedupKey, filename, mimeType string, sizeBytes, expectedDurationMs int64) *rpcv1.RequestVoiceMessageUploadResponse {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.RequestVoiceMessageUploadRequest{
		ChannelId:              channelID,
		ClientDeduplicationKey: dedupKey,
		Filename:               filename,
		MimeType:               mimeType,
		SizeBytes:              sizeBytes,
		ExpectedDurationMs:     expectedDurationMs,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.voice.RequestVoiceMessageUpload(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg
}

func (w *testWorld) requestVoiceMessageUploadError(actor testUser, channelID, dedupKey, filename, mimeType string, sizeBytes, expectedDurationMs int64) error {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.RequestVoiceMessageUploadRequest{
		ChannelId:              channelID,
		ClientDeduplicationKey: dedupKey,
		Filename:               filename,
		MimeType:               mimeType,
		SizeBytes:              sizeBytes,
		ExpectedDurationMs:     expectedDurationMs,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.voice.RequestVoiceMessageUpload(context.Background(), req)
	return err
}

func (w *testWorld) confirmVoiceMessageUpload(actor testUser, voiceMessageID, fileID, dedupKey string, durationMs int64, waveformPeaks []float32) *rpcv1.VoiceMessage {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.ConfirmVoiceMessageUploadRequest{
		VoiceMessageId:         voiceMessageID,
		FileId:                 fileID,
		ClientDeduplicationKey: dedupKey,
		DurationMs:             durationMs,
		WaveformPeaks:          waveformPeaks,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.voice.ConfirmVoiceMessageUpload(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.VoiceMessage
}

func (w *testWorld) confirmVoiceMessageUploadError(actor testUser, voiceMessageID, fileID, dedupKey string, durationMs int64, waveformPeaks []float32) error {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.ConfirmVoiceMessageUploadRequest{
		VoiceMessageId:         voiceMessageID,
		FileId:                 fileID,
		ClientDeduplicationKey: dedupKey,
		DurationMs:             durationMs,
		WaveformPeaks:          waveformPeaks,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.voice.ConfirmVoiceMessageUpload(context.Background(), req)
	return err
}

func (w *testWorld) cancelVoiceMessage(actor testUser, voiceMessageID string) *rpcv1.VoiceMessage {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.CancelVoiceMessageRequest{VoiceMessageId: voiceMessageID})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.voice.CancelVoiceMessage(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.VoiceMessage
}

func (w *testWorld) putUploadObject(uploadURL, mimeType string, content []byte) {
	w.t.Helper()
	putReq, err := http.NewRequest("PUT", uploadURL, bytes.NewReader(content))
	require.NoError(w.t, err)
	putReq.Header.Set("Content-Type", mimeType)
	putResp, err := http.DefaultClient.Do(putReq)
	require.NoError(w.t, err)
	defer putResp.Body.Close()
	require.Equal(w.t, http.StatusOK, putResp.StatusCode)
}

func (w *testWorld) getVoiceMessagePersistence(voiceMessageID string) (status, messageID, fileID string, durationMs, sizeBytes int64) {
	w.t.Helper()
	parsedID, err := dbuuid.Parse(voiceMessageID)
	require.NoError(w.t, err)
	err = globalDB.QueryRow(context.Background(), `
SELECT status,
       COALESCE(message_id::text, ''),
       COALESCE(file_id::text, ''),
       COALESCE(duration_ms, 0),
       size_bytes
FROM voice.voice_message
WHERE organization_id = $1 AND id = $2`, w.OrgID, parsedID).Scan(&status, &messageID, &fileID, &durationMs, &sizeBytes)
	require.NoError(w.t, err)
	return status, messageID, fileID, durationMs, sizeBytes
}

// ---------------------------------------------------------------------------
// Act: Chat — Notification preferences
// ---------------------------------------------------------------------------

func (w *testWorld) updateChannelNotificationPreference(actor testUser, channelID string, pref rpcv1.NotificationPreference) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.UpdateNotificationPreferenceRequest{
		ChannelId:  channelID,
		Preference: pref,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.chat.UpdateNotificationPreference(context.Background(), req)
	require.NoError(w.t, err)
}

// ---------------------------------------------------------------------------
// Act: Notification
// ---------------------------------------------------------------------------

func (w *testWorld) publishNotification(recipientID dbuuid.UUID, title string) string {
	w.t.Helper()
	sysToken := w.systemToken()
	req := connect.NewRequest(&rpcv1.PublishNotificationRequest{
		OrganizationId: w.OrgID.String(),
		Recipients: &rpcv1.NotificationRecipients{
			EmployeeIds: []string{recipientID.String()},
		},
		SourceDomain:        "chat",
		NotificationType:    "message",
		Title:               title,
		Message:             "Integration test notification",
		ActionCategory:      "integration",
		Priority:            1,
		PublishingServiceId: "integration-tests",
		ActionData:          map[string]string{"testRun": title},
	})
	req.Header().Set("Authorization", "Bearer "+sysToken)
	resp, err := w.notif.PublishNotification(context.Background(), req)
	require.NoError(w.t, err)
	require.NotEmpty(w.t, resp.Msg.NotificationId)
	return resp.Msg.NotificationId
}

func (w *testWorld) listNotifications(actor testUser, unreadOnly bool) []*rpcv1.NotificationSummary {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.ListNotificationsRequest{
		UnreadOnly: unreadOnly,
		PageSize:   100,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.notif.ListNotifications(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Notifications
}

func (w *testWorld) waitForNotificationCountStable(actor testUser, unreadOnly bool, stableFor, timeout time.Duration) []*rpcv1.NotificationSummary {
	w.t.Helper()

	deadline := time.Now().Add(timeout)
	lastCount := -1
	stableSince := time.Time{}
	var last []*rpcv1.NotificationSummary

	for time.Now().Before(deadline) {
		current := w.listNotifications(actor, unreadOnly)
		if len(current) != lastCount {
			lastCount = len(current)
			stableSince = time.Now()
			last = current
		} else if !stableSince.IsZero() && time.Since(stableSince) >= stableFor {
			return current
		}

		time.Sleep(200 * time.Millisecond)
	}

	if last != nil {
		return last
	}
	return w.listNotifications(actor, unreadOnly)
}

func (w *testWorld) waitForNotificationCountIncreaseAndStable(actor testUser, unreadOnly bool, previousCount int, stableFor, timeout time.Duration) []*rpcv1.NotificationSummary {
	w.t.Helper()

	deadline := time.Now().Add(timeout)
	lastCount := previousCount
	stableSince := time.Time{}
	var last []*rpcv1.NotificationSummary

	for time.Now().Before(deadline) {
		current := w.listNotifications(actor, unreadOnly)
		currentCount := len(current)
		if currentCount <= previousCount {
			stableSince = time.Time{}
			last = current
			time.Sleep(200 * time.Millisecond)
			continue
		}

		if currentCount != lastCount {
			lastCount = currentCount
			stableSince = time.Now()
			last = current
		} else if !stableSince.IsZero() && time.Since(stableSince) >= stableFor {
			return current
		}

		time.Sleep(200 * time.Millisecond)
	}

	if last != nil {
		return last
	}
	return w.listNotifications(actor, unreadOnly)
}

func (w *testWorld) getUnreadCount(actor testUser) int32 {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.GetUnreadCountRequest{})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.notif.GetUnreadCount(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.UnreadCount
}

func (w *testWorld) markAsRead(actor testUser, recipientIDs ...string) int32 {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.MarkAsReadRequest{
		NotificationRecipientIds: recipientIDs,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.notif.MarkAsRead(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.UpdatedCount
}

func (w *testWorld) markAllBeforeTimestamp(actor testUser, ts time.Time) int32 {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.MarkAllBeforeTimestampAsReadRequest{
		BeforeTimestamp: timestamppb.New(ts),
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.notif.MarkAllBeforeTimestampAsRead(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.UpdatedCount
}

// markAllNoTimestamp simulates what the frontend sends when it omits the timestamp
// (i.e., BeforeTimestamp = nil). The backend should treat this as "mark everything
// up to now as read" rather than treating nil as epoch and matching nothing.
func (w *testWorld) markAllNoTimestamp(actor testUser) int32 {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.MarkAllBeforeTimestampAsReadRequest{
		BeforeTimestamp: nil,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.notif.MarkAllBeforeTimestampAsRead(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.UpdatedCount
}

func (w *testWorld) deleteNotification(actor testUser, recipientID string) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.DeleteNotificationRequest{
		NotificationRecipientId: recipientID,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.notif.DeleteNotification(context.Background(), req)
	require.NoError(w.t, err)
}

func (w *testWorld) acknowledgeNotifications(actor testUser, action string, recipientIDs ...string) int32 {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.AcknowledgeNotificationsRequest{
		NotificationRecipientIds: recipientIDs,
		AcknowledgementAction:    action,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.notif.AcknowledgeNotifications(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.AcknowledgedCount
}

func (w *testWorld) acknowledgeAllBeforeTimestamp(actor testUser, ts time.Time, action string) int32 {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.AcknowledgeAllBeforeTimestampRequest{
		BeforeTimestamp:       timestamppb.New(ts),
		AcknowledgementAction: action,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.notif.AcknowledgeAllBeforeTimestamp(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.AcknowledgedCount
}

func (w *testWorld) confirmNotificationReceipt(actor testUser, connectionID, platform, appState, visibilityState string, recipientIDs ...string) int32 {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.ConfirmNotificationReceiptRequest{
		NotificationRecipientIds: recipientIDs,
		ConnectionId:             connectionID,
		Platform:                 platform,
		AppState:                 appState,
		VisibilityState:          visibilityState,
		ReceivedAt:               timestamppb.Now(),
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.notif.ConfirmNotificationReceipt(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.ConfirmedCount
}

func (w *testWorld) publishPersistentNotification(recipientID dbuuid.UUID, title string) string {
	w.t.Helper()
	sysToken := w.systemToken()
	req := connect.NewRequest(&rpcv1.PublishNotificationRequest{
		OrganizationId: w.OrgID.String(),
		Recipients: &rpcv1.NotificationRecipients{
			EmployeeIds: []string{recipientID.String()},
		},
		SourceDomain:        "chat",
		NotificationType:    "message",
		Title:               title,
		Message:             "Integration test persistent notification",
		ActionCategory:      "integration",
		Priority:            1,
		PublishingServiceId: "integration-tests",
		PolicyKey:           "chat_message",
		DeliveryClass:       "persistent",
		SourceCategory:      "activity",
		NavigationTarget: &rpcv1.NavigationTarget{
			Domain:       "chat",
			ResourceType: "channel",
			ResourceId:   "test-channel-id",
		},
	})
	req.Header().Set("Authorization", "Bearer "+sysToken)
	resp, err := w.notif.PublishNotification(context.Background(), req)
	require.NoError(w.t, err)
	require.NotEmpty(w.t, resp.Msg.NotificationId)
	return resp.Msg.NotificationId
}

func (w *testWorld) publishLiveOnlyNotification(recipientID dbuuid.UUID, title string) string {
	w.t.Helper()
	sysToken := w.systemToken()
	// live_only (ephemeral) notifications require a channel UUID for pg-NOTIFY routing;
	// use a dummy channel ID since no real SSE listeners exist in this test.
	dummyChannelID := dbuuid.Must().String()
	req := connect.NewRequest(&rpcv1.PublishNotificationRequest{
		OrganizationId: w.OrgID.String(),
		Recipients: &rpcv1.NotificationRecipients{
			EmployeeIds: []string{recipientID.String()},
		},
		SourceDomain:        "chat",
		NotificationType:    "typing",
		Title:               title,
		Message:             "Integration test live-only notification",
		ActionCategory:      "integration",
		Priority:            0,
		PublishingServiceId: "integration-tests",
		PolicyKey:           "chat_typing_live",
		DeliveryClass:       "live_only",
		SourceCategory:      "activity",
		ActiveChannelId:     dummyChannelID,
	})
	req.Header().Set("Authorization", "Bearer "+sysToken)
	resp, err := w.notif.PublishNotification(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.NotificationId
}

// ---------------------------------------------------------------------------
// Act: Presence
// ---------------------------------------------------------------------------

// pongRequest builds a PresencePongRequest with sane defaults so scenarios only state
// what they are actually varying.
type pongRequest struct {
	ConnectionID      string
	PingID            string
	Status            rpcv1.PresenceStatus
	ActiveChannelID   string
	LastInteractionAt *timestamppb.Timestamp
	Departing         bool
}

// sendPong answers a presence ping and returns the server's directive.
func (w *testWorld) sendPong(actor testUser, p pongRequest) rpcv1.PongDirective {
	w.t.Helper()
	directive, err := w.sendPongErr(actor, p)
	require.NoError(w.t, err)
	return directive
}

// sendPongErr is sendPong for scenarios that assert on the error contract.
func (w *testWorld) sendPongErr(actor testUser, p pongRequest) (rpcv1.PongDirective, error) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.PresencePongRequest{
		ConnectionId:      p.ConnectionID,
		PingId:            p.PingID,
		Status:            p.Status,
		ActiveChannelId:   p.ActiveChannelID,
		LastInteractionAt: p.LastInteractionAt,
		Departing:         p.Departing,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.notif.PresencePong(context.Background(), req)
	if err != nil {
		return rpcv1.PongDirective_PONG_DIRECTIVE_UNSPECIFIED, err
	}
	return resp.Msg.Directive, nil
}

// updatePresence reports a status on the actor's cached stream connection.
func (w *testWorld) updatePresence(actor testUser, status rpcv1.PresenceStatus) {
	w.t.Helper()
	w.sendPong(actor, pongRequest{ConnectionID: w.cachedSSEConnection(actor), Status: status})
}

func (w *testWorld) updatePresenceWithConnection(actor testUser, status rpcv1.PresenceStatus, connectionID string) {
	w.t.Helper()
	w.sendPong(actor, pongRequest{ConnectionID: connectionID, Status: status})
}

func (w *testWorld) updatePresenceWithChannel(actor testUser, status rpcv1.PresenceStatus, channelID string) {
	w.t.Helper()
	w.sendPong(actor, pongRequest{
		ConnectionID:    w.cachedSSEConnection(actor),
		Status:          status,
		ActiveChannelID: channelID,
	})
}

func (w *testWorld) getPresence(actor testUser, targetID dbuuid.UUID) *rpcv1.EmployeePresence {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.GetEmployeePresenceRequest{EmployeeId: targetID.String()})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.notif.GetEmployeePresence(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Presence
}

func (w *testWorld) getBatchPresence(actor testUser, targetIDs ...dbuuid.UUID) []*rpcv1.EmployeePresence {
	w.t.Helper()
	ids := make([]string, len(targetIDs))
	for i, id := range targetIDs {
		ids[i] = id.String()
	}
	req := connect.NewRequest(&rpcv1.GetBatchEmployeePresenceRequest{EmployeeIds: ids})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.notif.GetBatchEmployeePresence(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Presences
}

func (w *testWorld) getEmployeeCards(actor testUser, employeeIDs ...dbuuid.UUID) ([]*rpcv1.EmployeeCard, error) {
	w.t.Helper()
	ids := make([]string, len(employeeIDs))
	for i, id := range employeeIDs {
		ids[i] = id.String()
	}
	req := connect.NewRequest(&rpcv1.GetEmployeeCardsRequest{EmployeeIds: ids})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.iamClient.GetEmployeeCards(context.Background(), req)
	if err != nil {
		return nil, err
	}
	return resp.Msg.Cards, nil
}

func (w *testWorld) getResourceSubscription(actor testUser, resourceDomain, resourceID string) *rpcv1.GetResourceSubscriptionResponse {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.GetResourceSubscriptionRequest{
		ResourceDomain: resourceDomain,
		ResourceId:     resourceID,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.notif.GetResourceSubscription(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg
}

func (w *testWorld) setResourceSubscriptionPreference(actor testUser, resourceDomain, resourceID string, level rpcv1.SubscriptionPreferenceLevel) *rpcv1.SetResourceSubscriptionPreferenceResponse {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.SetResourceSubscriptionPreferenceRequest{
		ResourceDomain:  resourceDomain,
		ResourceId:      resourceID,
		PreferenceLevel: level,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.notif.SetResourceSubscriptionPreference(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg
}

// establishSSE opens an SSE stream and returns the connectionID.
// The stream is automatically cleaned up when the test ends.
func (w *testWorld) establishSSE(actor testUser) string {
	w.t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	w.t.Cleanup(cancel)

	req := connect.NewRequest(&rpcv1.StreamNotificationsRequest{})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	stream, err := w.notif.StreamNotifications(ctx, req)
	require.NoError(w.t, err)
	require.True(w.t, stream.Receive(), "should receive connection_established event")
	connID := stream.Msg().ConnectionId
	require.NotEmpty(w.t, connID)
	return connID
}

// openNotificationStream opens a notification stream for an actor with a timeout,
// consumes the initial connection_established event, and returns the live stream
// together with the issued connection ID.
func (w *testWorld) openNotificationStream(actor testUser, timeout time.Duration) (*connect.ServerStreamForClient[rpcv1.NotificationEvent], string, context.CancelFunc) {
	w.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), timeout)

	req := connect.NewRequest(&rpcv1.StreamNotificationsRequest{})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	stream, err := w.notif.StreamNotifications(ctx, req)
	if err != nil {
		cancel()
	}
	require.NoError(w.t, err)
	require.True(w.t, stream.Receive(), "should receive connection_established event")
	require.Equal(w.t, "connection_established", stream.Msg().EventType)
	require.NotEmpty(w.t, stream.Msg().ConnectionId)
	return stream, stream.Msg().ConnectionId, cancel
}

// receiveNextNotificationEvent waits for the next notification event on a live stream,
// skipping non-notification events such as heartbeats.
func (w *testWorld) receiveNextNotificationEvent(stream *connect.ServerStreamForClient[rpcv1.NotificationEvent]) *rpcv1.NotificationEvent {
	w.t.Helper()
	for stream.Receive() {
		event := stream.Msg()
		if event.EventType == "notification" {
			return event
		}
	}
	require.FailNow(w.t, "expected notification event before stream closed")
	return nil
}

type httpNotificationSummary struct {
	NotificationID          string            `json:"notificationId"`
	NotificationRecipientID string            `json:"notificationRecipientId"`
	SourceDomain            string            `json:"sourceDomain"`
	NotificationType        string            `json:"notificationType"`
	Title                   string            `json:"title"`
	Message                 string            `json:"message"`
	ActionData              map[string]string `json:"actionData"`
	ReadStatus              bool              `json:"readStatus"`
	DeliveryStatus          string            `json:"deliveryStatus"`
}

type httpNotificationEvent struct {
	EventID      string                   `json:"eventId"`
	EventType    string                   `json:"eventType"`
	Notification *httpNotificationSummary `json:"notification"`
	ConnectionID string                   `json:"connectionId"`
}

type httpNotificationStream struct {
	reader *bufio.Reader
	body   io.ReadCloser
}

func (w *testWorld) openNotificationHTTPStream(actor testUser, timeout time.Duration) (*httpNotificationStream, string, context.CancelFunc) {
	w.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), timeout)

	streamURL := serverBaseURL + "/api/notifications/stream?token=" + url.QueryEscape(actor.Token)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, streamURL, nil)
	require.NoError(w.t, err)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		cancel()
	}
	require.NoError(w.t, err)
	require.Equal(w.t, http.StatusOK, resp.StatusCode)

	stream := &httpNotificationStream{
		reader: bufio.NewReader(resp.Body),
		body:   resp.Body,
	}

	firstEvent := w.receiveNextHTTPNotificationEvent(stream)
	require.NotNil(w.t, firstEvent)
	require.Equal(w.t, "connection_established", firstEvent.EventType)
	require.NotEmpty(w.t, firstEvent.ConnectionID)

	return stream, firstEvent.ConnectionID, func() {
		_ = resp.Body.Close()
		cancel()
	}
}

func (w *testWorld) receiveNextHTTPNotificationEvent(stream *httpNotificationStream) *httpNotificationEvent {
	w.t.Helper()
	event, ok := w.readNextHTTPNotificationEvent(stream)
	if !ok {
		require.FailNow(w.t, "expected notification event before stream closed")
	}
	return event
}

func (w *testWorld) tryReceiveNextHTTPNotificationEvent(stream *httpNotificationStream) *httpNotificationEvent {
	w.t.Helper()
	event, _ := w.readNextHTTPNotificationEvent(stream)
	return event
}

func (w *testWorld) readNextHTTPNotificationEvent(stream *httpNotificationStream) (*httpNotificationEvent, bool) {
	w.t.Helper()

	var eventType string
	var eventID string
	var dataLines []string

	for {
		line, err := stream.reader.ReadString('\n')
		if err != nil {
			return nil, false
		}

		line = strings.TrimRight(line, "\r\n")
		if line == "" {
			if len(dataLines) == 0 {
				continue
			}

			payload := &httpNotificationEvent{}
			require.NoError(w.t, json.Unmarshal([]byte(strings.Join(dataLines, "\n")), payload))
			if eventType != "" {
				payload.EventType = eventType
			}
			if eventID != "" {
				payload.EventID = eventID
			}
			if payload.EventType == "heartbeat" {
				eventType = ""
				eventID = ""
				dataLines = nil
				continue
			}
			return payload, true
		}

		if strings.HasPrefix(line, "event: ") {
			eventType = strings.TrimSpace(strings.TrimPrefix(line, "event: "))
			continue
		}
		if strings.HasPrefix(line, "id: ") {
			eventID = strings.TrimSpace(strings.TrimPrefix(line, "id: "))
			continue
		}
		if strings.HasPrefix(line, "data: ") {
			dataLines = append(dataLines, strings.TrimPrefix(line, "data: "))
		}
	}
}

// cachedSSEConnection lazily establishes an SSE connection per actor and caches the connectionID.
// Subsequent calls for the same actor reuse the existing connection.
func (w *testWorld) cachedSSEConnection(actor testUser) string {
	w.t.Helper()
	if w.sseConnections == nil {
		w.sseConnections = make(map[dbuuid.UUID]string)
	}
	if connID, ok := w.sseConnections[actor.ID]; ok {
		return connID
	}
	connID := w.establishSSE(actor)
	w.sseConnections[actor.ID] = connID
	return connID
}

// ---------------------------------------------------------------------------
// Act: Presence visibility
// ---------------------------------------------------------------------------

func (w *testWorld) setPresenceVisibility(actor testUser, mode rpcv1.VisibilityMode, statusText, emoji string) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.SetPresenceVisibilityRequest{
		VisibilityMode:    mode,
		CustomStatusText:  statusText,
		CustomStatusEmoji: emoji,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.notif.SetPresenceVisibility(context.Background(), req)
	require.NoError(w.t, err)
}

func (w *testWorld) getPresenceSettings(actor testUser) *rpcv1.PresenceVisibility {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.GetPresenceSettingsRequest{})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.notif.GetPresenceSettings(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Visibility
}

// ---------------------------------------------------------------------------
// Act: Push tokens
// ---------------------------------------------------------------------------

func (w *testWorld) registerPushToken(actor testUser, deviceID string) string {
	w.t.Helper()
	fcm := "test_fcm_" + uuid.New().String()
	req := connect.NewRequest(&rpcv1.RegisterPushTokenRequest{
		FcmToken:         fcm,
		DeviceIdentifier: deviceID,
		PermissionState:  rpcv1.PermissionState_PERMISSION_STATE_GRANTED,
		Endpoint:         "https://fcm.googleapis.com/fcm/send/test",
		KeysJson:         `{"p256dh":"test_key","auth":"test_auth"}`,
		UserAgent:        "Mozilla/5.0 (Test)",
		TokenType:        rpcv1.PushTokenType_PUSH_TOKEN_TYPE_FCM,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.notif.RegisterPushToken(context.Background(), req)
	require.NoError(w.t, err)
	require.NotEmpty(w.t, resp.Msg.TokenId)
	return resp.Msg.TokenId
}

func (w *testWorld) registerPushTokenFull(actor testUser, fcmToken, deviceID string) string {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.RegisterPushTokenRequest{
		FcmToken:         fcmToken,
		DeviceIdentifier: deviceID,
		PermissionState:  rpcv1.PermissionState_PERMISSION_STATE_GRANTED,
		Endpoint:         "https://fcm.googleapis.com/fcm/send/test",
		KeysJson:         `{"p256dh":"test_key","auth":"test_auth"}`,
		UserAgent:        "Mozilla/5.0 (Test)",
		TokenMetadata:    map[string]string{"test": "integration"},
		TokenType:        rpcv1.PushTokenType_PUSH_TOKEN_TYPE_FCM,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.notif.RegisterPushToken(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.TokenId
}

func (w *testWorld) listPushTokens(actor testUser) []*rpcv1.PushTokenInfo {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.ListPushTokensRequest{})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.notif.ListPushTokens(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Tokens
}

func (w *testWorld) revokePushTokenByID(actor testUser, tokenID string) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.RevokePushTokenRequest{
		Target: &rpcv1.RevokePushTokenRequest_TokenId{TokenId: tokenID},
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.notif.RevokePushToken(context.Background(), req)
	require.NoError(w.t, err)
}

func (w *testWorld) revokePushTokenByDevice(actor testUser, deviceID string) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.RevokePushTokenRequest{
		Target: &rpcv1.RevokePushTokenRequest_DeviceIdentifier{DeviceIdentifier: deviceID},
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.notif.RevokePushToken(context.Background(), req)
	require.NoError(w.t, err)
}

// ---------------------------------------------------------------------------
// Act: Collaboration — Projects
// ---------------------------------------------------------------------------

type projectResult struct {
	ID     string
	Key    string
	States []*rpcv1.ProjectState
	Levels []*rpcv1.TaskLevel
}

func (w *testWorld) createProject(actor testUser, name, key string) projectResult {
	w.t.Helper()
	return w.createProjectWithVisibility(actor, name, key, rpcv1.ProjectVisibility_PROJECT_VISIBILITY_PUBLIC)
}

func (w *testWorld) createPrivateProject(actor testUser, name, key string) projectResult {
	w.t.Helper()
	return w.createProjectWithVisibility(actor, name, key, rpcv1.ProjectVisibility_PROJECT_VISIBILITY_PRIVATE)
}

func (w *testWorld) createProjectWithVisibility(actor testUser, name, key string, vis rpcv1.ProjectVisibility) projectResult {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.CreateProjectRequest{
		Name:       name,
		Key:        key,
		Visibility: vis,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.collab.CreateProject(context.Background(), req)
	require.NoError(w.t, err)
	return projectResult{
		ID:     resp.Msg.Project.Id,
		Key:    resp.Msg.Project.Key,
		States: resp.Msg.States,
		Levels: resp.Msg.Levels,
	}
}

func (w *testWorld) createProjectWithMode(actor testUser, name, key string, mode rpcv1.CollaborationMode) projectResult {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.CreateProjectRequest{
		Name:              name,
		Key:               key,
		Visibility:        rpcv1.ProjectVisibility_PROJECT_VISIBILITY_PUBLIC,
		CollaborationMode: mode,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.collab.CreateProject(context.Background(), req)
	require.NoError(w.t, err)
	return projectResult{
		ID:     resp.Msg.Project.Id,
		Key:    resp.Msg.Project.Key,
		States: resp.Msg.States,
		Levels: resp.Msg.Levels,
	}
}

func (w *testWorld) getProject(actor testUser, projectID string) *rpcv1.Project {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.GetProjectRequest{ProjectId: projectID})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.collab.GetProject(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Project
}

func (w *testWorld) getProjectError(actor testUser, projectID string) error {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.GetProjectRequest{ProjectId: projectID})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.collab.GetProject(context.Background(), req)
	return err
}

func (w *testWorld) listProjects(actor testUser) []*rpcv1.Project {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.ListProjectsRequest{})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.collab.ListProjects(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Projects
}

func (w *testWorld) listProjectsIncludeArchived(actor testUser) []*rpcv1.Project {
	w.t.Helper()
	include := true
	req := connect.NewRequest(&rpcv1.ListProjectsRequest{IncludeArchived: &include})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.collab.ListProjects(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Projects
}

func (w *testWorld) archiveProject(actor testUser, projectID string, archive bool) (*rpcv1.Project, error) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.ArchiveProjectRequest{ProjectId: projectID, Archive: archive})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.collab.ArchiveProject(context.Background(), req)
	if err != nil {
		return nil, err
	}
	return resp.Msg.Project, nil
}

func (w *testWorld) updateProject(actor testUser, projectID string, name, desc *string) *rpcv1.Project {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.UpdateProjectRequest{
		ProjectId:   projectID,
		Name:        name,
		Description: desc,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.collab.UpdateProject(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Project
}

// ---------------------------------------------------------------------------
// Act: Collaboration — Members
// ---------------------------------------------------------------------------

func (w *testWorld) addProjectMember(actor testUser, projectID string, memberID dbuuid.UUID, role rpcv1.ProjectMemberRole) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.AddProjectMemberRequest{
		ProjectId:  projectID,
		EmployeeId: memberID.String(),
		Role:       role,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.collab.AddProjectMember(context.Background(), req)
	require.NoError(w.t, err)
}

func (w *testWorld) addProjectMemberError(actor testUser, projectID string, memberID dbuuid.UUID, role rpcv1.ProjectMemberRole) error {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.AddProjectMemberRequest{
		ProjectId:  projectID,
		EmployeeId: memberID.String(),
		Role:       role,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.collab.AddProjectMember(context.Background(), req)
	return err
}

func (w *testWorld) removeProjectMember(actor testUser, projectID string, memberID dbuuid.UUID) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.RemoveProjectMemberRequest{
		ProjectId:  projectID,
		EmployeeId: memberID.String(),
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.collab.RemoveProjectMember(context.Background(), req)
	require.NoError(w.t, err)
}

func (w *testWorld) removeProjectMemberError(actor testUser, projectID string, memberID dbuuid.UUID) error {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.RemoveProjectMemberRequest{
		ProjectId:  projectID,
		EmployeeId: memberID.String(),
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.collab.RemoveProjectMember(context.Background(), req)
	return err
}

func (w *testWorld) listProjectMembers(actor testUser, projectID string) []*rpcv1.ProjectMember {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.ListProjectMembersRequest{ProjectId: projectID})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.collab.ListProjectMembers(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Members
}

func (w *testWorld) updateProjectMemberRole(actor testUser, projectID string, memberID dbuuid.UUID, role rpcv1.ProjectMemberRole) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.UpdateProjectMemberRoleRequest{
		ProjectId:  projectID,
		EmployeeId: memberID.String(),
		Role:       role,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.collab.UpdateProjectMemberRole(context.Background(), req)
	require.NoError(w.t, err)
}

// ---------------------------------------------------------------------------
// Act: Collaboration — Tasks
// ---------------------------------------------------------------------------

func (w *testWorld) createTask(actor testUser, projectID, title, levelID string) *rpcv1.Task {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.CreateTaskRequest{
		ProjectId: projectID,
		Title:     title,
		LevelId:   levelID,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.collab.CreateTask(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Task
}

func (w *testWorld) createTaskError(actor testUser, projectID, title, levelID string) error {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.CreateTaskRequest{
		ProjectId: projectID,
		Title:     title,
		LevelId:   levelID,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.collab.CreateTask(context.Background(), req)
	return err
}

func (w *testWorld) createChildTask(actor testUser, projectID, title, levelID, parentID string) *rpcv1.Task {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.CreateTaskRequest{
		ProjectId:    projectID,
		Title:        title,
		LevelId:      levelID,
		ParentTaskId: &parentID,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.collab.CreateTask(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Task
}

func (w *testWorld) createChildTaskError(actor testUser, projectID, title, levelID, parentID string) error {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.CreateTaskRequest{
		ProjectId:    projectID,
		Title:        title,
		LevelId:      levelID,
		ParentTaskId: &parentID,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.collab.CreateTask(context.Background(), req)
	return err
}

func (w *testWorld) getTask(actor testUser, taskID string) *rpcv1.Task {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.GetTaskRequest{TaskId: taskID})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.collab.GetTask(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Task
}

func (w *testWorld) getTaskError(actor testUser, taskID string) error {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.GetTaskRequest{TaskId: taskID})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.collab.GetTask(context.Background(), req)
	return err
}

func (w *testWorld) moveTask(actor testUser, taskID, stateID string) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.MoveTaskRequest{TaskId: taskID, NewStateId: stateID})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.collab.MoveTask(context.Background(), req)
	require.NoError(w.t, err)
}

func (w *testWorld) assignTask(actor testUser, taskID string, assigneeID dbuuid.UUID, role rpcv1.TaskAssigneeRole) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.AssignTaskRequest{
		TaskId:     taskID,
		EmployeeId: assigneeID.String(),
		Role:       role,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.collab.AssignTask(context.Background(), req)
	require.NoError(w.t, err)
}

func (w *testWorld) updateTaskDueDate(actor testUser, taskID, dueDate string) *rpcv1.Task {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.UpdateTaskRequest{
		TaskId:  taskID,
		DueDate: &dueDate,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.collab.UpdateTask(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Task
}

func (w *testWorld) getAssignedWorkSummary(actor testUser, limit *int32, includeRitualInstances bool) *rpcv1.GetAssignedWorkSummaryResponse {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.GetAssignedWorkSummaryRequest{
		Limit:                  limit,
		IncludeRitualInstances: includeRitualInstances,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.collab.GetAssignedWorkSummary(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg
}

func (w *testWorld) listTasks(actor testUser, projectID string) []*rpcv1.Task {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.ListTasksRequest{ProjectId: projectID})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.collab.ListTasks(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Tasks
}

func (w *testWorld) watchTask(actor testUser, taskID string) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.WatchTaskRequest{TaskId: taskID})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.collab.WatchTask(context.Background(), req)
	require.NoError(w.t, err)
}

func (w *testWorld) unwatchTask(actor testUser, taskID string) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.UnwatchTaskRequest{TaskId: taskID})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.collab.UnwatchTask(context.Background(), req)
	require.NoError(w.t, err)
}

func (w *testWorld) listTasksWithFilter(actor testUser, projectID string, stateID, assigneeID *string) []*rpcv1.Task {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.ListTasksRequest{
		ProjectId:          projectID,
		StateId:            stateID,
		AssigneeEmployeeId: assigneeID,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.collab.ListTasks(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Tasks
}

// ---------------------------------------------------------------------------
// Act: Collaboration — Custom Fields
// ---------------------------------------------------------------------------

func (w *testWorld) createCustomField(actor testUser, projectID, name string, fieldType rpcv1.CustomFieldType) string {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.CreateCustomFieldRequest{
		ProjectId: projectID,
		Name:      name,
		FieldType: fieldType,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.collab.CreateCustomField(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Field.Id
}

func (w *testWorld) createSelectField(actor testUser, projectID, name string, options []string) string {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.CreateCustomFieldRequest{
		ProjectId: projectID,
		Name:      name,
		FieldType: rpcv1.CustomFieldType_CUSTOM_FIELD_TYPE_SINGLE_SELECT,
		Options:   options,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.collab.CreateCustomField(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Field.Id
}

func (w *testWorld) setCustomFieldStringValue(actor testUser, taskID, fieldID, value string) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.SetCustomFieldValueRequest{
		TaskId:  taskID,
		FieldId: fieldID,
		Value:   &rpcv1.SetCustomFieldValueRequest_StringValue{StringValue: value},
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.collab.SetCustomFieldValue(context.Background(), req)
	require.NoError(w.t, err)
}

func (w *testWorld) setCustomFieldStringValueError(actor testUser, taskID, fieldID, value string) error {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.SetCustomFieldValueRequest{
		TaskId:  taskID,
		FieldId: fieldID,
		Value:   &rpcv1.SetCustomFieldValueRequest_StringValue{StringValue: value},
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.collab.SetCustomFieldValue(context.Background(), req)
	return err
}

func (w *testWorld) listCustomFields(actor testUser, projectID string) []*rpcv1.CustomFieldDefinition {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.ListCustomFieldsRequest{ProjectId: projectID})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.collab.ListCustomFields(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Fields
}

func (w *testWorld) listCustomFieldsIncludeArchived(actor testUser, projectID string) []*rpcv1.CustomFieldDefinition {
	w.t.Helper()
	include := true
	req := connect.NewRequest(&rpcv1.ListCustomFieldsRequest{ProjectId: projectID, IncludeArchived: &include})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.collab.ListCustomFields(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Fields
}

func (w *testWorld) getTaskWithCustomFields(actor testUser, taskID string) *rpcv1.Task {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.GetTaskRequest{TaskId: taskID, IncludeCustomFields: true})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.collab.GetTask(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Task
}

func (w *testWorld) archiveCustomField(actor testUser, fieldID string) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.ArchiveCustomFieldRequest{FieldId: fieldID, Archive: true})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.collab.ArchiveCustomField(context.Background(), req)
	require.NoError(w.t, err)
}

// ---------------------------------------------------------------------------
// Act: Collaboration — Analytics
// ---------------------------------------------------------------------------

func (w *testWorld) getTaskAnalytics(actor testUser, projectID string, groupBy []string) *rpcv1.GetTaskAnalyticsResponse {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.GetTaskAnalyticsRequest{
		ProjectId: projectID,
		GroupBy:   groupBy,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.collab.GetTaskAnalytics(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg
}

func (w *testWorld) exportTasksCSV(actor testUser, projectID string) []byte {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.ExportTasksCSVRequest{ProjectId: projectID})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.collab.ExportTasksCSV(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.CsvData
}

// ---------------------------------------------------------------------------
// Act: Files
// ---------------------------------------------------------------------------

func (w *testWorld) uploadChannelFile(actor testUser, channelID, filename, mimeType string, content []byte) string {
	w.t.Helper()
	reqUpload := connect.NewRequest(&rpcv1.RequestChannelFileUploadRequest{
		ChannelId: channelID,
		Filename:  filename,
		MimeType:  mimeType,
		SizeBytes: int64(len(content)),
	})
	reqUpload.Header().Set("Authorization", "Bearer "+actor.Token)
	uploadResp, err := w.chatFile.RequestChannelFileUpload(context.Background(), reqUpload)
	require.NoError(w.t, err)
	fileID := uploadResp.Msg.FileId
	uploadURL := uploadResp.Msg.UploadUrl

	putReq, err := http.NewRequest("PUT", uploadURL, bytes.NewReader(content))
	require.NoError(w.t, err)
	putReq.Header.Set("Content-Type", mimeType)
	putResp, err := http.DefaultClient.Do(putReq)
	require.NoError(w.t, err)
	defer putResp.Body.Close()
	require.Equal(w.t, http.StatusOK, putResp.StatusCode)

	confirmReq := connect.NewRequest(&rpcv1.ConfirmChannelFileUploadRequest{
		ChannelId: channelID,
		FileId:    fileID,
	})
	confirmReq.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err = w.chatFile.ConfirmChannelFileUpload(context.Background(), confirmReq)
	require.NoError(w.t, err)

	return fileID
}

func (w *testWorld) requestChannelFileUploadError(actor testUser, channelID, filename, mimeType string, size int64) error {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.RequestChannelFileUploadRequest{
		ChannelId: channelID,
		Filename:  filename,
		MimeType:  mimeType,
		SizeBytes: size,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.chatFile.RequestChannelFileUpload(context.Background(), req)
	return err
}

func (w *testWorld) checkFileAccess(actor testUser, fileID string) (hasAccess bool, reason string) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.CheckFileAccessRequest{FileId: fileID})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.file.CheckFileAccess(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.HasAccess, resp.Msg.DenialReason
}

func (w *testWorld) getDownloadURL(actor testUser, fileID string) (string, error) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.GetDownloadUrlRequest{FileId: fileID})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.file.GetDownloadUrl(context.Background(), req)
	if err != nil {
		return "", err
	}
	return resp.Msg.DownloadUrl, nil
}

func (w *testWorld) getFileMetadataBatch(actor testUser, fileIDs []string) []*rpcv1.FileMetadata {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.GetFileMetadataBatchRequest{FileIds: fileIDs})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.file.GetFileMetadataBatch(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Files
}

func (w *testWorld) getFileMetadataBatchError(actor testUser, fileIDs []string) error {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.GetFileMetadataBatchRequest{FileIds: fileIDs})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.file.GetFileMetadataBatch(context.Background(), req)
	return err
}

func (w *testWorld) searchFiles(actor testUser, query string, limit int32) *rpcv1.SearchFilesResponse {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.SearchFilesRequest{Query: query, Limit: limit})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.file.SearchFiles(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg
}

func (w *testWorld) validateFile(actor testUser, fileID string) (*rpcv1.ValidateFileResponse, error) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.ValidateFileRequest{FileId: fileID})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.file.ValidateFile(context.Background(), req)
	if err != nil {
		return nil, err
	}
	return resp.Msg, nil
}

func (w *testWorld) triggerPDFConversion(actor testUser, fileID string) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.TriggerPDFConversionRequest{FileId: fileID})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.file.TriggerPDFConversion(context.Background(), req)
	require.NoError(w.t, err)
}

func (w *testWorld) getPDFConversionStatus(actor testUser, fileID string) *rpcv1.GetPDFConversionStatusResponse {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.GetPDFConversionStatusRequest{FileId: fileID})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.file.GetPDFConversionStatus(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg
}

func (w *testWorld) getContentIndexStatus(actor testUser, fileID string) *rpcv1.GetContentIndexStatusResponse {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.GetContentIndexStatusRequest{FileId: fileID})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.file.GetContentIndexStatus(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg
}

func (w *testWorld) deleteFile(actor testUser, fileID string) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.DeleteFileRequest{FileId: fileID})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.file.DeleteFile(context.Background(), req)
	require.NoError(w.t, err)
}

// ---------------------------------------------------------------------------
// Act: Documents
// ---------------------------------------------------------------------------

func (w *testWorld) createDocument(actor testUser, title, contentJSON string) string {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.CreateDocumentRequest{
		Title:       title,
		ContentJson: contentJSON,
		Visibility:  rpcv1.DocumentVisibility_DOCUMENT_VISIBILITY_PRIVATE,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.doc.CreateDocument(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Document.Id
}

func (w *testWorld) updateDocument(actor testUser, docID, contentJSON string) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.UpdateDocumentRequest{Id: docID, ContentJson: contentJSON})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.doc.UpdateDocument(context.Background(), req)
	require.NoError(w.t, err)
}

func (w *testWorld) deleteDocument(actor testUser, docID string) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.DeleteDocumentRequest{Id: docID})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.doc.DeleteDocument(context.Background(), req)
	require.NoError(w.t, err)
}

func (w *testWorld) listDocuments(actor testUser, limit int32) []*rpcv1.DocumentSummary {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.ListDocumentsRequest{Limit: limit})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.doc.ListDocuments(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Documents
}

func (w *testWorld) getVersionDiff(actor testUser, docID string, fromV, toV int32) []*rpcv1.DiffChange {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.GetVersionDiffRequest{
		DocumentId:  docID,
		FromVersion: fromV,
		ToVersion:   toV,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.docVersion.GetVersionDiff(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Changes
}

// ---------------------------------------------------------------------------
// Act: Preferences
// ---------------------------------------------------------------------------

func (w *testWorld) updatePreference(actor testUser, theme rpcv1.ThemeMode, source rpcv1.PreferenceSource) *rpcv1.UserPreference {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.UpdateUserPreferenceRequest{
		ThemeMode:        theme,
		PreferenceSource: source,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.pref.UpdateUserPreference(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Preference
}

func (w *testWorld) getPreference(actor testUser) *rpcv1.GetUserPreferenceResponse {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.GetUserPreferenceRequest{})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.pref.GetUserPreference(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg
}

func (w *testWorld) resetPreference(actor testUser) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.ResetUserPreferenceRequest{})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.pref.ResetUserPreference(context.Background(), req)
	require.NoError(w.t, err)
}

// ---------------------------------------------------------------------------
// Act: Departments
// ---------------------------------------------------------------------------

func (w *testWorld) createDepartment(actor testUser, name string, parentID string) string {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.CreateDepartmentRequest{
		Name:               name,
		ParentDepartmentId: parentID,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.dept.CreateDepartment(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Department.Id
}

func (w *testWorld) getDepartmentTree(actor testUser) []*rpcv1.Department {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.GetDepartmentTreeRequest{})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.dept.GetDepartmentTree(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Departments
}

func (w *testWorld) assignEmployeeToDepartment(actor testUser, deptID string, employeeID dbuuid.UUID) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.AssignEmployeeToDepartmentRequest{
		DepartmentId: deptID,
		EmployeeId:   employeeID.String(),
		Role:         "member",
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.dept.AssignEmployeeToDepartment(context.Background(), req)
	require.NoError(w.t, err)
}

func (w *testWorld) moveDepartment(actor testUser, deptID string, newParentID string) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.MoveDepartmentRequest{
		DepartmentId: deptID,
		NewParentId:  newParentID,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.dept.MoveDepartment(context.Background(), req)
	require.NoError(w.t, err)
}

func (w *testWorld) getDepartmentMembers(actor testUser, deptID string) []*rpcv1.DepartmentMember {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.GetDepartmentMembersRequest{DepartmentId: deptID})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.dept.GetDepartmentMembers(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Members
}

// ---------------------------------------------------------------------------
// Assert: search/find helpers
// ---------------------------------------------------------------------------

func findNotification(list []*rpcv1.NotificationSummary, notifID string) *rpcv1.NotificationSummary {
	for _, n := range list {
		if n.GetNotificationId() == notifID {
			return n
		}
	}
	return nil
}

func findPresence(list []*rpcv1.EmployeePresence, employeeID string) *rpcv1.EmployeePresence {
	for _, p := range list {
		if p.EmployeeId == employeeID {
			return p
		}
	}
	return nil
}

func findPushTokenByID(tokens []*rpcv1.PushTokenInfo, tokenID string) *rpcv1.PushTokenInfo {
	for _, t := range tokens {
		if t.TokenId == tokenID {
			return t
		}
	}
	return nil
}

func findPushTokenByDevice(tokens []*rpcv1.PushTokenInfo, deviceID string) *rpcv1.PushTokenInfo {
	for _, t := range tokens {
		if t.DeviceIdentifier == deviceID {
			return t
		}
	}
	return nil
}

func findProject(projects []*rpcv1.Project, id string) *rpcv1.Project {
	for _, p := range projects {
		if p.Id == id {
			return p
		}
	}
	return nil
}

func stateByCategory(states []*rpcv1.ProjectState, cat rpcv1.StateCategory) *rpcv1.ProjectState {
	for _, s := range states {
		if s.Category == cat {
			return s
		}
	}
	return nil
}

func levelByDepth(levels []*rpcv1.TaskLevel, depth int32) *rpcv1.TaskLevel {
	for _, l := range levels {
		if l.Depth == depth {
			return l
		}
	}
	return nil
}

func findDepartment(depts []*rpcv1.Department, id string) *rpcv1.Department {
	for _, d := range depts {
		if d.Id == id {
			return d
		}
	}
	return nil
}

func findDocument(docs []*rpcv1.DocumentSummary, id string) *rpcv1.DocumentSummary {
	for _, d := range docs {
		if d.Id == id {
			return d
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// DB helpers (for tests needing direct data access)
// ---------------------------------------------------------------------------

// recipientRowID resolves the notification_recipient row for one employee, which is
// what the delivery and fallback columns hang off.
func (w *testWorld) recipientRowID(notificationID string, employeeID dbuuid.UUID) string {
	w.t.Helper()
	notifUUID, err := dbuuid.Parse(notificationID)
	require.NoError(w.t, err)
	var id dbuuid.UUID
	err = globalDB.QueryRow(context.Background(),
		`SELECT id FROM notification.notification_recipient
		  WHERE organization_id = $1 AND notification_id = $2 AND employee_id = $3`,
		w.OrgID, notifUUID, employeeID,
	).Scan(&id)
	require.NoError(w.t, err)
	return id.String()
}

// connectionLastPongAge reports how long ago the database observed this connection's
// last pong.
func (w *testWorld) connectionLastPongAge(connID dbuuid.UUID) time.Duration {
	w.t.Helper()
	var seconds float64
	err := globalDB.QueryRow(context.Background(),
		`SELECT EXTRACT(EPOCH FROM (now() - last_pong_at))
		   FROM notification.active_connection WHERE connection_id = $1`, connID,
	).Scan(&seconds)
	require.NoError(w.t, err)
	return time.Duration(seconds * float64(time.Second))
}

// connectionRow reads the mutable presence columns of one connection.
func (w *testWorld) connectionRow(connID dbuuid.UUID) (presenceStatus, activeChannelID string, lastInteractionAt time.Time) {
	w.t.Helper()
	var channel dbuuid.NullUUID
	err := globalDB.QueryRow(context.Background(),
		`SELECT presence_status, active_channel_id, last_interaction_at
		   FROM notification.active_connection WHERE connection_id = $1`, connID,
	).Scan(&presenceStatus, &channel, &lastInteractionAt)
	require.NoError(w.t, err)
	if channel.Valid {
		activeChannelID = dbuuid.UUID(channel.UUID).String()
	}
	return
}

// pongCall pairs an actor with a pong so a batch can span employees and organizations.
type pongCall struct {
	Actor   testUser
	Request pongRequest
}

// sendPongsConcurrently fires one pong per connection at the same moment, so they land
// in the same batcher flush window, and returns the directives in input order.
func (w *testWorld) sendPongsConcurrently(actor testUser, connectionIDs []string) []rpcv1.PongDirective {
	w.t.Helper()
	calls := make([]pongCall, len(connectionIDs))
	for i, connID := range connectionIDs {
		calls[i] = pongCall{
			Actor:   actor,
			Request: pongRequest{ConnectionID: connID, Status: rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE},
		}
	}
	return w.sendPongsConcurrentlyForUsers(calls)
}

func (w *testWorld) sendPongsConcurrentlyForUsers(calls []pongCall) []rpcv1.PongDirective {
	w.t.Helper()
	directives := make([]rpcv1.PongDirective, len(calls))
	errs := make([]error, len(calls))

	var start sync.WaitGroup
	var done sync.WaitGroup
	start.Add(1)
	for i, call := range calls {
		done.Add(1)
		go func(i int, call pongCall) {
			defer done.Done()
			start.Wait()
			req := connect.NewRequest(&rpcv1.PresencePongRequest{
				ConnectionId:      call.Request.ConnectionID,
				PingId:            call.Request.PingID,
				Status:            call.Request.Status,
				ActiveChannelId:   call.Request.ActiveChannelID,
				LastInteractionAt: call.Request.LastInteractionAt,
				Departing:         call.Request.Departing,
			})
			req.Header().Set("Authorization", "Bearer "+call.Actor.Token)
			resp, err := w.notif.PresencePong(context.Background(), req)
			if err != nil {
				errs[i] = err
				return
			}
			directives[i] = resp.Msg.Directive
		}(i, call)
	}
	start.Done()
	done.Wait()

	for i, err := range errs {
		require.NoError(w.t, err, "pong %d failed", i)
	}
	return directives
}

// callRemovedUpdatePresenceStatus invokes the deleted UpdatePresenceStatus method by
// its wire path. The generated client no longer has it, which is the point: this proves
// the method is gone from the served contract rather than merely unused.
func (w *testWorld) callRemovedUpdatePresenceStatus(actor testUser, connectionID string) (connect.Code, error) {
	w.t.Helper()
	body := fmt.Sprintf(`{"status":"PRESENCE_STATUS_OFFLINE","connectionId":%q}`, connectionID)
	httpReq, err := http.NewRequest(http.MethodPost,
		serverBaseURL+"/rpc.v1.NotificationService/UpdatePresenceStatus",
		strings.NewReader(body))
	require.NoError(w.t, err)
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Connect-Protocol-Version", "1")
	httpReq.Header.Set("Authorization", "Bearer "+actor.Token)

	resp, err := http.DefaultClient.Do(httpReq)
	require.NoError(w.t, err)
	defer resp.Body.Close()
	payload, err := io.ReadAll(resp.Body)
	require.NoError(w.t, err)

	if resp.StatusCode == http.StatusOK {
		return 0, nil
	}
	return connectCodeFromHTTPStatus(resp.StatusCode), fmt.Errorf("removed endpoint returned %d: %s", resp.StatusCode, payload)
}

// connectCodeFromHTTPStatus maps the Connect protocol's HTTP status mapping back to a
// code, so scenarios can assert on the semantic outcome rather than a number.
func connectCodeFromHTTPStatus(status int) connect.Code {
	switch status {
	case http.StatusNotFound, http.StatusNotImplemented:
		return connect.CodeUnimplemented
	case http.StatusBadRequest:
		return connect.CodeInvalidArgument
	case http.StatusUnauthorized:
		return connect.CodeUnauthenticated
	case http.StatusForbidden:
		return connect.CodePermissionDenied
	default:
		return connect.CodeUnknown
	}
}

// publishNotificationForChannel publishes a notification tied to a channel, so routing
// can decide whether the recipient is already looking at it.
func (w *testWorld) publishNotificationForChannel(recipientID dbuuid.UUID, title, channelID string) string {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.PublishNotificationRequest{
		OrganizationId: w.OrgID.String(),
		Recipients: &rpcv1.NotificationRecipients{
			EmployeeIds: []string{recipientID.String()},
		},
		SourceDomain:        "chat",
		NotificationType:    "message",
		Title:               title,
		Message:             "Integration test channel notification",
		ActionCategory:      "integration",
		Priority:            1,
		PublishingServiceId: "integration-tests",
		PolicyKey:           "chat_message",
		DeliveryClass:       "persistent",
		SourceCategory:      "activity",
		ActiveChannelId:     channelID,
		NavigationTarget: &rpcv1.NavigationTarget{
			Domain:       "chat",
			ResourceType: "channel",
			ResourceId:   channelID,
		},
	})
	req.Header().Set("Authorization", "Bearer "+w.systemToken())
	resp, err := w.notif.PublishNotification(context.Background(), req)
	require.NoError(w.t, err)
	require.NotEmpty(w.t, resp.Msg.NotificationId)
	return resp.Msg.NotificationId
}

// deliveryAttemptReasons lists the reasons recorded against one recipient's delivery
// attempts, newest first. The routing decision lives here; notification_recipient's
// fallback_reason ends up describing the delivery outcome instead.
func (w *testWorld) deliveryAttemptReasons(notifRecipientID string) []string {
	w.t.Helper()
	recipientUUID, err := dbuuid.Parse(notifRecipientID)
	require.NoError(w.t, err)
	rows, err := globalDB.Query(context.Background(),
		`SELECT COALESCE(reason, '')
		   FROM notification.delivery_attempt
		  WHERE organization_id = $1 AND notification_recipient_id = $2
		  ORDER BY attempted_at DESC`,
		w.OrgID, recipientUUID)
	require.NoError(w.t, err)
	defer rows.Close()

	reasons := make([]string, 0, 4)
	for rows.Next() {
		var reason string
		require.NoError(w.t, rows.Scan(&reason))
		reasons = append(reasons, reason)
	}
	require.NoError(w.t, rows.Err())
	return reasons
}

// responsiveConnectionIDs lists the connections that currently count as live-delivery
// targets for an employee — the same derived predicate presence reads and routing use.
func (w *testWorld) responsiveConnectionIDs(employeeID dbuuid.UUID) []dbuuid.UUID {
	w.t.Helper()
	rows, err := globalQ.GetEmployeeActiveConnections(context.Background(), globalDB, &database.GetEmployeeActiveConnectionsParams{
		OrganizationID:          w.OrgID,
		EmployeeID:              employeeID,
		ResponsiveWindowSeconds: notification.ResponsiveWindowSeconds,
	})
	require.NoError(w.t, err)
	ids := make([]dbuuid.UUID, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.ConnectionID)
	}
	return ids
}

// awaitPingEvent waits for the next ping challenge on a live stream.
func (w *testWorld) awaitPingEvent(stream *connect.ServerStreamForClient[rpcv1.NotificationEvent]) *rpcv1.NotificationEvent {
	w.t.Helper()
	for stream.Receive() {
		if event := stream.Msg(); event.EventType == notification.EventTypePing {
			return event
		}
	}
	require.FailNow(w.t, "expected a ping event before the stream closed", "stream error: %v", stream.Err())
	return nil
}

func (w *testWorld) queryDeliveryStatus(notifRecipientID string) (status string, deliveredAt pgtype.Timestamptz) {
	w.t.Helper()
	err := globalDB.QueryRow(context.Background(),
		`SELECT delivery_status, delivered_at FROM notification.notification_recipient WHERE organization_id = $1 AND id = $2`,
		w.OrgID, notifRecipientID,
	).Scan(&status, &deliveredAt)
	require.NoError(w.t, err)
	return
}

func (w *testWorld) queryFallbackState(notifRecipientID string) (status, reason string, dueAt pgtype.Timestamptz) {
	w.t.Helper()
	err := globalDB.QueryRow(context.Background(),
		`SELECT fallback_status, COALESCE(fallback_reason, ''), fallback_due_at FROM notification.notification_recipient WHERE organization_id = $1 AND id = $2`,
		w.OrgID, notifRecipientID,
	).Scan(&status, &reason, &dueAt)
	require.NoError(w.t, err)
	return
}

func (w *testWorld) insertStaleConnection(employeeID dbuuid.UUID, age time.Duration, instanceID string) dbuuid.UUID {
	w.t.Helper()
	connID := dbuuid.Must()
	ts := time.Now().Add(-age)
	_, err := globalDB.Exec(context.Background(), `
		INSERT INTO notification.active_connection (
			connection_id, organization_id, employee_id, instance_id,
			presence_status, last_pong_at, last_interaction_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		connID, w.OrgID, employeeID, instanceID, "online", ts, ts)
	require.NoError(w.t, err)
	return connID
}

// setConnectionLastPongAt rewrites a connection's last_pong_at directly through the
// admin pool so scenarios can simulate elapsed silence instead of sleeping. The suite
// runs under -timeout 120s and cannot wait out the 90-second removal window.
func (w *testWorld) setConnectionLastPongAt(connID dbuuid.UUID, age time.Duration) {
	w.t.Helper()
	tag, err := globalDB.Exec(context.Background(),
		`UPDATE notification.active_connection
		    SET last_pong_at = now() - $2::interval
		  WHERE connection_id = $1`,
		connID, fmt.Sprintf("%d milliseconds", age.Milliseconds()))
	require.NoError(w.t, err)
	require.EqualValues(w.t, 1, tag.RowsAffected(), "expected exactly one connection row to age")
}

func (w *testWorld) connectionExists(connID dbuuid.UUID) bool {
	w.t.Helper()
	var count int
	err := globalDB.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM notification.active_connection WHERE connection_id = $1`, connID,
	).Scan(&count)
	require.NoError(w.t, err)
	return count > 0
}

// deleteExpiredConnections runs the presence janitor's sweep for this org.
func (w *testWorld) deleteExpiredConnections() int64 {
	w.t.Helper()
	removed, err := globalQ.DeleteExpiredConnections(context.Background(), globalDB, &database.DeleteExpiredConnectionsParams{
		OrganizationID:       w.OrgID,
		RemovalWindowSeconds: notification.RemovalWindowSeconds,
	})
	require.NoError(w.t, err)
	return removed
}

func (w *testWorld) lookupDepartment() (dbuuid.UUID, bool) {
	w.t.Helper()
	var deptID dbuuid.UUID
	err := globalDB.QueryRow(context.Background(),
		`SELECT id FROM organization.department WHERE organization_id = $1 LIMIT 1`, w.OrgID,
	).Scan(&deptID)
	if err != nil {
		return dbuuid.UUID{}, false
	}
	return deptID, true
}

func (w *testWorld) countDepartmentMembers(deptID dbuuid.UUID) int {
	w.t.Helper()
	var count int
	err := globalDB.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM organization.department_member WHERE department_id = $1 AND organization_id = $2`,
		deptID, w.OrgID).Scan(&count)
	require.NoError(w.t, err)
	return count
}

func (w *testWorld) queryResourceSubscription(employeeID dbuuid.UUID, resourceDomain, resourceID string) (state, preference string, found bool) {
	w.t.Helper()
	resourceUUID, err := dbuuid.Parse(resourceID)
	require.NoError(w.t, err)
	err = globalDB.QueryRow(context.Background(),
		`SELECT subscription_state, preference_level
		 FROM notification.resource_subscription
		 WHERE organization_id = $1 AND employee_id = $2 AND resource_domain = $3 AND resource_id = $4`,
		w.OrgID, employeeID, resourceDomain, resourceUUID,
	).Scan(&state, &preference)
	if err != nil {
		if strings.Contains(err.Error(), "no rows") {
			return "", "", false
		}
		require.NoError(w.t, err)
	}
	return state, preference, true
}

func (w *testWorld) queryResourceSubscriptionReasons(employeeID dbuuid.UUID, resourceDomain, resourceID string) []string {
	w.t.Helper()
	resourceUUID, err := dbuuid.Parse(resourceID)
	require.NoError(w.t, err)
	rows, err := globalDB.Query(context.Background(),
		`SELECT rsr.reason_type
		 FROM notification.resource_subscription rs
		 JOIN notification.resource_subscription_reason rsr
		   ON (rs.organization_id, rs.id) = (rsr.organization_id, rsr.subscription_id)
		 WHERE rs.organization_id = $1
		   AND rs.employee_id = $2
		   AND rs.resource_domain = $3
		   AND rs.resource_id = $4
		 ORDER BY rsr.created_at ASC`,
		w.OrgID, employeeID, resourceDomain, resourceUUID,
	)
	require.NoError(w.t, err)
	defer rows.Close()

	var reasons []string
	for rows.Next() {
		var reason string
		require.NoError(w.t, rows.Scan(&reason))
		reasons = append(reasons, reason)
	}
	require.NoError(w.t, rows.Err())
	return reasons
}

func generateSystemTokenForOrg(orgID dbuuid.UUID) string {
	token, _, _, err := globalSigner.GenerateSystemTokenWithOrg(orgID)
	if err != nil {
		panic(fmt.Sprintf("failed to generate system jwt: %v", err))
	}
	return token
}

// ---------------------------------------------------------------------------
// Act: Collaboration — Task File Upload (3-step: request → PUT → confirm)
// ---------------------------------------------------------------------------

func (w *testWorld) uploadTaskFile(actor testUser, taskID, filename, mimeType string, content []byte) (fileID string, task *rpcv1.Task) {
	w.t.Helper()
	reqUpload := connect.NewRequest(&rpcv1.RequestTaskFileUploadRequest{
		TaskId:    taskID,
		Filename:  filename,
		MimeType:  mimeType,
		SizeBytes: int64(len(content)),
	})
	reqUpload.Header().Set("Authorization", "Bearer "+actor.Token)
	uploadResp, err := w.collab.RequestTaskFileUpload(context.Background(), reqUpload)
	require.NoError(w.t, err)
	fileID = uploadResp.Msg.FileId
	uploadURL := uploadResp.Msg.UploadUrl

	putReq, err := http.NewRequest("PUT", uploadURL, bytes.NewReader(content))
	require.NoError(w.t, err)
	putReq.Header.Set("Content-Type", mimeType)
	putResp, err := http.DefaultClient.Do(putReq)
	require.NoError(w.t, err)
	defer putResp.Body.Close()
	require.Equal(w.t, http.StatusOK, putResp.StatusCode)

	confirmReq := connect.NewRequest(&rpcv1.ConfirmTaskFileUploadRequest{
		TaskId: taskID,
		FileId: fileID,
	})
	confirmReq.Header().Set("Authorization", "Bearer "+actor.Token)
	confirmResp, err := w.collab.ConfirmTaskFileUpload(context.Background(), confirmReq)
	require.NoError(w.t, err)

	return fileID, confirmResp.Msg.Task
}

func (w *testWorld) requestTaskFileUploadError(actor testUser, taskID, filename, mimeType string, size int64) error {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.RequestTaskFileUploadRequest{
		TaskId:    taskID,
		Filename:  filename,
		MimeType:  mimeType,
		SizeBytes: size,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.collab.RequestTaskFileUpload(context.Background(), req)
	return err
}

// ---------------------------------------------------------------------------
// Act: Documents — Access control
// ---------------------------------------------------------------------------

func (w *testWorld) getDocument(actor testUser, docID string) *rpcv1.GetDocumentResponse {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.GetDocumentRequest{
		Identifier:     &rpcv1.GetDocumentRequest_Id{Id: docID},
		IncludeContent: true,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.doc.GetDocument(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg
}

func (w *testWorld) getDocumentError(actor testUser, docID string) error {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.GetDocumentRequest{
		Identifier: &rpcv1.GetDocumentRequest_Id{Id: docID},
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.doc.GetDocument(context.Background(), req)
	return err
}

func (w *testWorld) setDocumentAccess(actor testUser, docID, granteeID string, level rpcv1.AccessLevel) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.SetAccessRequest{
		DocumentId:  docID,
		GranteeType: rpcv1.GranteeType_GRANTEE_TYPE_EMPLOYEE,
		GranteeId:   granteeID,
		AccessLevel: level,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.docAccess.SetAccess(context.Background(), req)
	require.NoError(w.t, err)
}

func (w *testWorld) checkDocumentAccess(actor testUser, docID string) (rpcv1.AccessLevel, bool) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.CheckAccessRequest{DocumentId: docID})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.docAccess.CheckAccess(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.AccessLevel, resp.Msg.IsOwner
}

// ---------------------------------------------------------------------------
// Act: Documents — Followers
// ---------------------------------------------------------------------------

func (w *testWorld) followDocument(actor testUser, docID string) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.FollowDocumentRequest{DocumentId: docID})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.docFollower.FollowDocument(context.Background(), req)
	require.NoError(w.t, err)
}

func (w *testWorld) unfollowDocument(actor testUser, docID string) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.UnfollowDocumentRequest{DocumentId: docID})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.docFollower.UnfollowDocument(context.Background(), req)
	require.NoError(w.t, err)
}

func (w *testWorld) listFollowedDocuments(actor testUser) []*rpcv1.DocumentSummary {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.ListFollowedDocumentsRequest{Limit: 100})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.docFollower.ListFollowedDocuments(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Documents
}

// ---------------------------------------------------------------------------
// Act: Documents — Collaborative editing
// ---------------------------------------------------------------------------

func (w *testWorld) joinDocument(actor testUser, docID string) (connID string, editors []*rpcv1.ActiveEditor) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.JoinDocumentRequest{DocumentId: docID})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.docEditor.JoinDocument(context.Background(), req)
	require.NoError(w.t, err)
	require.True(w.t, resp.Msg.Success)
	return resp.Msg.ConnectionId, resp.Msg.CurrentEditors
}

func (w *testWorld) leaveDocument(actor testUser, docID, _ string) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.LeaveDocumentRequest{
		DocumentId: docID,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.docEditor.LeaveDocument(context.Background(), req)
	require.NoError(w.t, err)
}

func (w *testWorld) listActiveEditors(actor testUser, docID string) []*rpcv1.ActiveEditor {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.ListActiveEditorsRequest{DocumentId: docID})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.docEditor.ListActiveEditors(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Editors
}

// ---------------------------------------------------------------------------
// Act: Chat — Message retrieval
// ---------------------------------------------------------------------------

func (w *testWorld) getMessage(actor testUser, messageID string) *rpcv1.Message {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.GetMessageRequest{MessageId: messageID})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.chat.GetMessage(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Message
}

func (w *testWorld) getMessageError(actor testUser, messageID string) error {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.GetMessageRequest{MessageId: messageID})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.chat.GetMessage(context.Background(), req)
	return err
}

// ---------------------------------------------------------------------------
// Act: Documents — Comments
// ---------------------------------------------------------------------------

func (w *testWorld) addDocumentComment(actor testUser, docID, text string) string {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.AddCommentRequest{
		DocumentId:  docID,
		CommentText: text,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.docComment.AddComment(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Comment.Id
}

// ---------------------------------------------------------------------------
// Act: Collaboration — Task discussion helpers (V2)
// ---------------------------------------------------------------------------

// sendTaskComment sends a plain-text comment to a task's discussion channel.
// The task must have been created with a chat channel (channel_id is set).
// This models the V2 concept of task discussion as a bundled surface.
func (w *testWorld) sendTaskComment(actor testUser, task *rpcv1.Task, text string) string {
	w.t.Helper()
	require.NotNil(w.t, task.ChannelId, "task must have a discussion channel (channel_id must be set)")
	return w.sendMessage(actor, *task.ChannelId, text)
}

// updateTaskDescriptionDocument edits the task's linked description document.
// The task must have a description document (description_document_id is set).
// This models the V2 task_description_modified event surface.
func (w *testWorld) updateTaskDescriptionDocument(actor testUser, task *rpcv1.Task, contentJSON string) {
	w.t.Helper()
	require.NotNil(w.t, task.DescriptionDocumentId, "task must have a description document (description_document_id must be set)")
	w.updateDocument(actor, *task.DescriptionDocumentId, contentJSON)
}

// ---------------------------------------------------------------------------
// Assert: V2 resource subscription helpers
// ---------------------------------------------------------------------------

type resourceSurface struct {
	SurfaceType          string
	SurfaceDomain        string
	SurfaceResourceID    string
	InheritsSubscription bool
}

// queryResourceSurfaces returns all resource_surface rows for a given parent resource.
// Used in V2 tests to verify that task/document child surfaces are correctly registered.
func (w *testWorld) queryResourceSurfaces(parentDomain, parentResourceID string) []resourceSurface {
	w.t.Helper()
	resourceUUID, err := dbuuid.Parse(parentResourceID)
	require.NoError(w.t, err)
	rows, queryErr := globalDB.Query(context.Background(),
		`SELECT surface_type, surface_domain, surface_resource_id, inherits_subscription
		 FROM notification.resource_surface
		 WHERE organization_id = $1 AND parent_domain = $2 AND parent_resource_id = $3
		 ORDER BY surface_type ASC`,
		w.OrgID, parentDomain, resourceUUID,
	)
	require.NoError(w.t, queryErr)
	defer rows.Close()

	var surfaces []resourceSurface
	for rows.Next() {
		var s resourceSurface
		var surfaceResID dbuuid.UUID
		require.NoError(w.t, rows.Scan(&s.SurfaceType, &s.SurfaceDomain, &surfaceResID, &s.InheritsSubscription))
		s.SurfaceResourceID = surfaceResID.String()
		surfaces = append(surfaces, s)
	}
	require.NoError(w.t, rows.Err())
	return surfaces
}

// findSurfaceByType returns the first resource_surface row matching the given surface type, or nil.
func findSurfaceByType(surfaces []resourceSurface, surfaceType string) *resourceSurface {
	for i := range surfaces {
		if surfaces[i].SurfaceType == surfaceType {
			return &surfaces[i]
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

func ptr[T any](v T) *T { return &v }

func uniqueSlug(prefix string) string {
	return fmt.Sprintf("%s-%s", prefix, uuid.New().String()[:8])
}

// uniqueProjectKey generates a unique project key matching the DB constraint: ^[A-Z][A-Z0-9_]{0,9}$
func uniqueProjectKey(prefix string) string {
	const maxLen = 10
	remaining := maxLen - len(prefix)
	if remaining <= 0 {
		return prefix[:maxLen]
	}
	hex := strings.ToUpper(strings.ReplaceAll(uuid.New().String(), "-", ""))
	return prefix + hex[:remaining]
}

// ---------------------------------------------------------------------------
// Act: Collaboration — Ritual Definitions
// ---------------------------------------------------------------------------

func (w *testWorld) createRitualDefinition(actor testUser, projectID, name string, rule *rpcv1.RecurrenceRule) *rpcv1.RitualDefinition {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.CreateRitualDefinitionRequest{
		ProjectId:             projectID,
		Name:                  name,
		RecurrenceRule:        rule,
		CompletionWindowHours: 8,
		Timezone:              "UTC",
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.collab.CreateRitualDefinition(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.RitualDefinition
}

func (w *testWorld) createRitualDefinitionError(actor testUser, projectID, name string, rule *rpcv1.RecurrenceRule) error {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.CreateRitualDefinitionRequest{
		ProjectId:             projectID,
		Name:                  name,
		RecurrenceRule:        rule,
		CompletionWindowHours: 8,
		Timezone:              "UTC",
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.collab.CreateRitualDefinition(context.Background(), req)
	return err
}

func (w *testWorld) createRitualDefinitionWithAssigneesAndRequirements(
	actor testUser,
	projectID, name string,
	rule *rpcv1.RecurrenceRule,
	assigneeIDs []string,
	requirements []*rpcv1.CreateEvidenceRequirementInput,
) *rpcv1.RitualDefinition {
	return w.createRitualDefinitionWithAssigneesRequirementsAndWindow(
		actor,
		projectID,
		name,
		rule,
		8,
		assigneeIDs,
		requirements,
	)
}

func (w *testWorld) createRitualDefinitionWithAssigneesRequirementsAndWindow(
	actor testUser,
	projectID, name string,
	rule *rpcv1.RecurrenceRule,
	completionWindowHours int32,
	assigneeIDs []string,
	requirements []*rpcv1.CreateEvidenceRequirementInput,
) *rpcv1.RitualDefinition {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.CreateRitualDefinitionRequest{
		ProjectId:             projectID,
		Name:                  name,
		RecurrenceRule:        rule,
		CompletionWindowHours: completionWindowHours,
		Timezone:              "UTC",
		DefaultAssigneeIds:    assigneeIDs,
		EvidenceRequirements:  requirements,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.collab.CreateRitualDefinition(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.RitualDefinition
}

func (w *testWorld) createRitualDefinitionWithPool(
	actor testUser,
	projectID, name string,
	rule *rpcv1.RecurrenceRule,
	departmentID string,
	assignmentStrategy string,
) *rpcv1.RitualDefinition {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.CreateRitualDefinitionRequest{
		ProjectId:             projectID,
		Name:                  name,
		RecurrenceRule:        rule,
		CompletionWindowHours: 8,
		Timezone:              "UTC",
		DefaultDepartmentPools: []*rpcv1.RitualDepartmentPoolInput{
			{
				DepartmentId:       departmentID,
				AssignmentStrategy: assignmentStrategy,
			},
		},
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.collab.CreateRitualDefinition(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.RitualDefinition
}

func (w *testWorld) createRitualDefinitionDirectWithAssigneesAndRequirements(
	actor testUser,
	projectID, name string,
	rule *rpcv1.RecurrenceRule,
	assigneeIDs []string,
	requirements []*rpcv1.CreateEvidenceRequirementInput,
) *rpcv1.RitualDefinition {
	w.t.Helper()
	logic := collaboration.NewLogic(globalQ, nil, nil, nil)
	def, err := logic.CreateRitualDefinition(context.Background(), globalDB, actor.OrgID, actor.ID, &rpcv1.CreateRitualDefinitionRequest{
		ProjectId:             projectID,
		Name:                  name,
		RecurrenceRule:        rule,
		CompletionWindowHours: 8,
		Timezone:              "UTC",
		DefaultAssigneeIds:    assigneeIDs,
		EvidenceRequirements:  requirements,
	})
	require.NoError(w.t, err)
	return def
}

func (w *testWorld) createRitualDefinitionDirectWithPool(
	actor testUser,
	projectID, name string,
	rule *rpcv1.RecurrenceRule,
	departmentID string,
	assignmentStrategy string,
) *rpcv1.RitualDefinition {
	w.t.Helper()
	logic := collaboration.NewLogic(globalQ, nil, nil, nil)
	def, err := logic.CreateRitualDefinition(context.Background(), globalDB, actor.OrgID, actor.ID, &rpcv1.CreateRitualDefinitionRequest{
		ProjectId:             projectID,
		Name:                  name,
		RecurrenceRule:        rule,
		CompletionWindowHours: 8,
		Timezone:              "UTC",
		DefaultDepartmentPools: []*rpcv1.RitualDepartmentPoolInput{
			{
				DepartmentId:       departmentID,
				AssignmentStrategy: assignmentStrategy,
			},
		},
	})
	require.NoError(w.t, err)
	return def
}

func (w *testWorld) getRitualDefinition(actor testUser, defID string) *rpcv1.RitualDefinition {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.GetRitualDefinitionRequest{RitualDefinitionId: defID})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.collab.GetRitualDefinition(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.RitualDefinition
}

func (w *testWorld) updateRitualDefinition(actor testUser, defID string, name *string) *rpcv1.RitualDefinition {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.UpdateRitualDefinitionRequest{
		RitualDefinitionId: defID,
		Name:               name,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.collab.UpdateRitualDefinition(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.RitualDefinition
}

func (w *testWorld) archiveRitualDefinition(actor testUser, defID string, archive bool) (*rpcv1.RitualDefinition, error) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.ArchiveRitualDefinitionRequest{
		RitualDefinitionId: defID,
		Archive:            archive,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.collab.ArchiveRitualDefinition(context.Background(), req)
	if err != nil {
		return nil, err
	}
	return resp.Msg.RitualDefinition, nil
}

func (w *testWorld) listRitualDefinitions(actor testUser, projectID string, includeArchived bool) []*rpcv1.RitualDefinition {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.ListRitualDefinitionsRequest{
		ProjectId:       projectID,
		IncludeArchived: includeArchived,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.collab.ListRitualDefinitions(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.RitualDefinitions
}

// ---------------------------------------------------------------------------
// Act: Collaboration — Evidence Requirements
// ---------------------------------------------------------------------------

func (w *testWorld) createEvidenceRequirement(actor testUser, defID, name string, evidenceType rpcv1.EvidenceType, approvalMode rpcv1.ApprovalMode) *rpcv1.EvidenceRequirementDetail {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.CreateEvidenceRequirementRequest{
		RitualDefinitionId: defID,
		Name:               name,
		EvidenceTypes:      []rpcv1.EvidenceType{evidenceType},
		IsRequired:         true,
		ApprovalMode:       approvalMode,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.collab.CreateEvidenceRequirement(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.EvidenceRequirement
}

func (w *testWorld) createEvidenceRequirementError(actor testUser, defID, name string, evidenceType rpcv1.EvidenceType, approvalMode rpcv1.ApprovalMode) error {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.CreateEvidenceRequirementRequest{
		RitualDefinitionId: defID,
		Name:               name,
		EvidenceTypes:      []rpcv1.EvidenceType{evidenceType},
		IsRequired:         true,
		ApprovalMode:       approvalMode,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.collab.CreateEvidenceRequirement(context.Background(), req)
	return err
}

func (w *testWorld) updateEvidenceRequirement(actor testUser, reqID string, name *string) *rpcv1.EvidenceRequirementDetail {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.UpdateEvidenceRequirementRequest{
		EvidenceRequirementId: reqID,
		Name:                  name,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.collab.UpdateEvidenceRequirement(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.EvidenceRequirement
}

func (w *testWorld) deleteEvidenceRequirement(actor testUser, reqID string) error {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.DeleteEvidenceRequirementRequest{
		EvidenceRequirementId: reqID,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.collab.DeleteEvidenceRequirement(context.Background(), req)
	return err
}

func (w *testWorld) listEvidenceRequirements(actor testUser, defID string) []*rpcv1.EvidenceRequirementDetail {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.ListEvidenceRequirementsRequest{
		RitualDefinitionId: defID,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.collab.ListEvidenceRequirements(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.EvidenceRequirements
}

// ---------------------------------------------------------------------------
// Act: Collaboration — Evidence Submissions
// ---------------------------------------------------------------------------

func (w *testWorld) submitTextEvidence(actor testUser, taskID, requirementID, text string) *rpcv1.EvidenceSubmission {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.SubmitEvidenceRequest{
		TaskId:                taskID,
		EvidenceRequirementId: requirementID,
		EvidenceType:          rpcv1.EvidenceType_EVIDENCE_TYPE_TEXT_NOTE,
		TextContent:           text,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.collab.SubmitEvidence(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.EvidenceSubmission
}

func (w *testWorld) submitEvidenceWithGPS(actor testUser, taskID, requirementID string, lat, lng float64, accuracyMeters float64) *rpcv1.EvidenceSubmission {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.SubmitEvidenceRequest{
		TaskId:                taskID,
		EvidenceRequirementId: requirementID,
		EvidenceType:          rpcv1.EvidenceType_EVIDENCE_TYPE_GPS_CHECKIN,
		GpsCoordinates: &rpcv1.GpsCoordinates{
			Latitude:       lat,
			Longitude:      lng,
			AccuracyMeters: accuracyMeters,
		},
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.collab.SubmitEvidence(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.EvidenceSubmission
}

func (w *testWorld) approveEvidence(actor testUser, submissionID, comment string) *rpcv1.EvidenceSubmission {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.ApproveEvidenceRequest{
		EvidenceSubmissionId: submissionID,
		Comment:              comment,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.collab.ApproveEvidence(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.EvidenceSubmission
}

func (w *testWorld) rejectEvidence(actor testUser, submissionID, comment string) *rpcv1.EvidenceSubmission {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.RejectEvidenceRequest{
		EvidenceSubmissionId: submissionID,
		Comment:              comment,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.collab.RejectEvidence(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.EvidenceSubmission
}

func (w *testWorld) listEvidenceSubmissions(actor testUser, taskID string) []*rpcv1.EvidenceSubmission {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.ListEvidenceSubmissionsRequest{TaskId: taskID})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.collab.ListEvidenceSubmissions(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.EvidenceSubmissions
}

// ---------------------------------------------------------------------------
// Act: Collaboration — Ritual Instance Operations
// ---------------------------------------------------------------------------

func (w *testWorld) skipRitualInstance(actor testUser, taskID, reason string) (*rpcv1.Task, error) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.SkipRitualInstanceRequest{
		TaskId: taskID,
		Reason: reason,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.collab.SkipRitualInstance(context.Background(), req)
	if err != nil {
		return nil, err
	}
	return resp.Msg.Task, nil
}

func (w *testWorld) listTasksWithKind(actor testUser, projectID string, kind *rpcv1.TaskKind) []*rpcv1.Task {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.ListTasksRequest{
		ProjectId: projectID,
		TaskKind:  kind,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.collab.ListTasks(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Tasks
}

// ---------------------------------------------------------------------------
// Act: Collaboration — Operational Health
// ---------------------------------------------------------------------------

func (w *testWorld) getOperationalHealth(actor testUser, projectID string, start, end *timestamppb.Timestamp) *rpcv1.GetOperationalHealthResponse {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.GetOperationalHealthRequest{
		ProjectId: projectID,
		StartDate: start,
		EndDate:   end,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.collab.GetOperationalHealth(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg
}

func (w *testWorld) getRitualComplianceSummary(actor testUser, projectID, defID string, start, end *timestamppb.Timestamp) []*rpcv1.EmployeeComplianceSummary {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.GetRitualComplianceSummaryRequest{
		ProjectId:          projectID,
		RitualDefinitionId: defID,
		StartDate:          start,
		EndDate:            end,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.collab.GetRitualComplianceSummary(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.EmployeeSummaries
}

func (w *testWorld) exportRitualComplianceCSV(actor testUser, projectID string, start, end *timestamppb.Timestamp) []byte {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.ExportRitualComplianceCSVRequest{
		ProjectId: projectID,
		StartDate: start,
		EndDate:   end,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.collab.ExportRitualComplianceCSV(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.CsvData
}

// ---------------------------------------------------------------------------
// Helpers: Ritual Definition lookup
// ---------------------------------------------------------------------------

func findRitualDefinition(defs []*rpcv1.RitualDefinition, id string) *rpcv1.RitualDefinition {
	for _, d := range defs {
		if d.Id == id {
			return d
		}
	}
	return nil
}

// dailyRecurrenceRule returns a simple daily recurrence rule for testing.
func dailyRecurrenceRule() *rpcv1.RecurrenceRule {
	return &rpcv1.RecurrenceRule{
		Type:      rpcv1.RecurrenceType_RECURRENCE_TYPE_DAILY,
		Interval:  1,
		TimeOfDay: "08:00",
	}
}

// generateRitualInstances directly invokes the scheduler logic for a given actor's org.
// This is used in integration tests to trigger instance generation without waiting for the
// hourly background scheduler.
func (w *testWorld) generateRitualInstances(actor testUser) int {
	w.t.Helper()
	logic := collaboration.NewLogic(globalQ, nil, nil, &rpcNotificationPublisher{orgID: actor.OrgID})
	count, err := logic.GenerateRitualInstances(context.Background(), globalDB, actor.OrgID, time.Now())
	require.NoError(w.t, err)
	return count
}

// generateRitualInstancesAt invokes the scheduler logic with a custom "now" time.
// This allows testing that the scheduler correctly generates new instances when invoked
// on future dates (simulating the daily cron trigger).
func (w *testWorld) generateRitualInstancesAt(actor testUser, now time.Time) int {
	w.t.Helper()
	logic := collaboration.NewLogic(globalQ, nil, nil, &rpcNotificationPublisher{orgID: actor.OrgID})
	count, err := logic.GenerateRitualInstances(context.Background(), globalDB, actor.OrgID, now)
	require.NoError(w.t, err)
	return count
}

// runRitualGenerationSweep drives one cycle of the global ritual generation sweep
// in-process, the same way generateRitualInstancesAt drives single-org generation.
// The sweep is platform-wide, so it also generates for organizations other tests own —
// generation is idempotent per definition and date, so that is harmless. Scope
// assertions to the caller's own organizations.
func (w *testWorld) runRitualGenerationSweep() *collaboration.RitualGenerationOutput {
	w.t.Helper()
	return w.runRitualGenerationSweepAt(time.Now())
}

// runRitualGenerationSweepAt drives one sweep cycle with a custom "now".
func (w *testWorld) runRitualGenerationSweepAt(now time.Time) *collaboration.RitualGenerationOutput {
	w.t.Helper()
	sweep := &collaboration.RitualGenerationWorkflow{
		Logic:     collaboration.NewLogic(globalQ, nil, nil, nil),
		Queries:   globalQ,
		AdminPool: globalDB,
	}
	out, err := sweep.Sweep(context.Background(), now)
	require.NoError(w.t, err)
	return out
}

type rpcNotificationPublisher struct {
	orgID dbuuid.UUID
}

func (p *rpcNotificationPublisher) PublishNotification(ctx context.Context, tx database.DBTX, req *rpcv1.PublishNotificationRequest) (*rpcv1.PublishNotificationResponse, error) {
	rpcReq := connect.NewRequest(req)
	rpcReq.Header().Set("Authorization", "Bearer "+generateSystemTokenForOrg(p.orgID))
	resp, err := rpcv1connect.NewNotificationServiceClient(http.DefaultClient, serverBaseURL).PublishNotification(ctx, rpcReq)
	if err != nil {
		return nil, err
	}
	return resp.Msg, nil
}

// suppress "unused" for imported packages used only in other test files
var (
	_ = timestamppb.New
	_ bytes.Buffer
)

func (w *testWorld) joinChannel(actor testUser, channelID string) *rpcv1.ChannelMembership {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.JoinChannelRequest{
		ChannelId: channelID,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.chat.JoinChannel(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Membership
}

func (w *testWorld) createOrGetDirectMessage(actor testUser, otherEmployeeID string) *rpcv1.CreateOrGetDirectMessageResponse {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.CreateOrGetDirectMessageRequest{
		OtherEmployeeId: otherEmployeeID,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.chat.CreateOrGetDirectMessage(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg
}

func (w *testWorld) getChannelContextSummary(actor testUser, channelID string) *rpcv1.GetChannelContextSummaryResponse {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.GetChannelContextSummaryRequest{
		ChannelId: channelID,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.chat.GetChannelContextSummary(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg
}

func (w *testWorld) getChannelContextSummaryError(actor testUser, channelID string) error {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.GetChannelContextSummaryRequest{
		ChannelId: channelID,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.chat.GetChannelContextSummary(context.Background(), req)
	return err
}

// ---------------------------------------------------------------------------
// Act: Organization — workspace address (feature 035)
// ---------------------------------------------------------------------------

// checkSubdomainAvailable asks whether a workspace address is free. Unauthenticated:
// a signup form calls this before an account exists.
func (w *testWorld) checkSubdomainAvailable(subdomain string) *rpcv1.CheckSubdomainAvailableResponse {
	w.t.Helper()
	resp, err := w.org.CheckSubdomainAvailable(context.Background(),
		connect.NewRequest(&rpcv1.CheckSubdomainAvailableRequest{Subdomain: subdomain}))
	require.NoError(w.t, err, "checkSubdomainAvailable")
	return resp.Msg
}

func (w *testWorld) checkSubdomainAvailableError(subdomain string) error {
	w.t.Helper()
	_, err := w.org.CheckSubdomainAvailable(context.Background(),
		connect.NewRequest(&rpcv1.CheckSubdomainAvailableRequest{Subdomain: subdomain}))
	return err
}

// registerOrganization registers a workspace and returns the owner's email, the created
// organization, and the subdomain actually stored. Unauthenticated.
func (w *testWorld) registerOrganization(companyName, subdomain string) (*rpcv1.Organization, string) {
	w.t.Helper()
	email := uniqueTestEmail("owner")
	resp, err := w.org.RegisterOrganizationWithAdminPassword(context.Background(),
		connect.NewRequest(&rpcv1.RegisterOrganizationWithAdminPasswordRequest{
			CompanyName:     companyName,
			Subdomain:       subdomain,
			AdminEmail:      email,
			AdminPassword:   "Test1234!",
			AdminGivenName:  "Test",
			AdminFamilyName: "Owner",
			// Required since Feature 036.
			AcceptedTermsVersion: iam.CurrentTermsVersion,
		}))
	require.NoError(w.t, err, "registerOrganization")
	orgID, parseErr := dbuuid.Parse(resp.Msg.Organization.Id)
	require.NoError(w.t, parseErr, "parse org ID")
	rememberOrg(orgID)
	return resp.Msg.Organization, email
}

func (w *testWorld) registerOrganizationError(companyName, subdomain string) error {
	w.t.Helper()
	_, err := w.org.RegisterOrganizationWithAdminPassword(context.Background(),
		connect.NewRequest(&rpcv1.RegisterOrganizationWithAdminPasswordRequest{
			CompanyName:     companyName,
			Subdomain:       subdomain,
			AdminEmail:      uniqueTestEmail("owner"),
			AdminPassword:   "Test1234!",
			AdminGivenName:  "Test",
			AdminFamilyName: "Owner",
			// Required since Feature 036. Supplied here so this helper still tests
			// what it is named for — a rejected subdomain, not a missing acceptance.
			AcceptedTermsVersion: iam.CurrentTermsVersion,
		}))
	return err
}

// ---------------------------------------------------------------------------
// Act: IAM — PIN (feature 035)
// ---------------------------------------------------------------------------

// setPIN calls SetPIN with a session token. currentPIN is empty for a first-time set and
// populated for a voluntary change of an established PIN.
func (w *testWorld) setPIN(actor testUser, newPIN, currentPIN string) (*rpcv1.SetPINResponse, error) {
	w.t.Helper()
	msg := &rpcv1.SetPINRequest{NewPin: newPIN}
	if currentPIN != "" {
		msg.CurrentPin = &currentPIN
	}
	req := connect.NewRequest(msg)
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.iamClient.SetPIN(context.Background(), req)
	if err != nil {
		return nil, err
	}
	return resp.Msg, nil
}

// subdomainOf returns the subdomain stored for an organization.
func (w *testWorld) subdomainOf(orgID dbuuid.UUID) string {
	w.t.Helper()
	var subdomain string
	err := globalDB.QueryRow(context.Background(),
		`SELECT subdomain FROM public.organization WHERE id = $1`, orgID,
	).Scan(&subdomain)
	require.NoError(w.t, err, "query org subdomain")
	return subdomain
}

// ownerUserOf returns the owner identity of an organization as an authenticated testUser.
func (w *testWorld) ownerUserOf(orgID dbuuid.UUID, email string) testUser {
	w.t.Helper()
	var ownerID dbuuid.UUID
	err := globalDB.QueryRow(context.Background(),
		`SELECT er.employee_id FROM iam.employee_role er
		 JOIN iam.role r ON r.organization_id = er.organization_id AND r.id = er.role_id
		 WHERE er.organization_id = $1 AND r.source_default_role_id = 'owner'
		 LIMIT 1`, orgID,
	).Scan(&ownerID)
	require.NoError(w.t, err, "find owner user in DB")

	token, _, _, err := globalSigner.GenerateTokenWithOrg(ownerID, email, orgID)
	require.NoError(w.t, err, "generate owner JWT")
	return testUser{ID: ownerID, OrgID: orgID, Token: token}
}

// retryDelayFromError extracts the google.rpc.RetryInfo delay attached to a lockout error.
// Returns ok=false when the detail is absent, which is the tier-4 (full lock) case.
func retryDelayFromError(t *testing.T, err error) (time.Duration, bool) {
	t.Helper()
	var connectErr *connect.Error
	if !errors.As(err, &connectErr) {
		return 0, false
	}
	for _, detail := range connectErr.Details() {
		value, valueErr := detail.Value()
		if valueErr != nil {
			continue
		}
		if retryInfo, ok := value.(*errdetails.RetryInfo); ok {
			return retryInfo.GetRetryDelay().AsDuration(), true
		}
	}
	return 0, false
}

// fieldViolations returns the google.rpc.BadRequest field names carried by an error.
func fieldViolations(t *testing.T, err error) []string {
	t.Helper()
	var connectErr *connect.Error
	if !errors.As(err, &connectErr) {
		return nil
	}
	var fields []string
	for _, detail := range connectErr.Details() {
		value, valueErr := detail.Value()
		if valueErr != nil {
			continue
		}
		if badRequest, ok := value.(*errdetails.BadRequest); ok {
			for _, violation := range badRequest.GetFieldViolations() {
				fields = append(fields, violation.GetField())
			}
		}
	}
	return fields
}

// employeeEmail returns the email recorded on an actor's employee record.
func (w *testWorld) employeeEmail(actor testUser) string {
	w.t.Helper()
	var email string
	err := globalDB.QueryRow(context.Background(),
		`SELECT email FROM organization.employee WHERE organization_id = $1 AND id = $2`,
		actor.OrgID, actor.ID,
	).Scan(&email)
	require.NoError(w.t, err, "query employee email")
	return email
}

// identityIDByLoginIdentifier resolves an org-managed account's identity ID.
func (w *testWorld) identityIDByLoginIdentifier(orgID dbuuid.UUID, loginIdentifier string) dbuuid.UUID {
	w.t.Helper()
	var id dbuuid.UUID
	err := globalDB.QueryRow(context.Background(),
		`SELECT id FROM iam.identity WHERE organization_id = $1 AND login_identifier = $2`,
		orgID, loginIdentifier,
	).Scan(&id)
	require.NoError(w.t, err, "query identity by login identifier")
	return id
}

// forceLockout puts an identity into a given lockout tier directly. Escalation past tier 1
// needs the previous lockout to expire in wall-clock time, which a test cannot wait out, so
// tests that exercise a specific tier arrange it rather than provoke it. Pass a zero
// duration for the full lock, which has no expiry.
func (w *testWorld) forceLockout(orgID, identityID dbuuid.UUID, tier int, remaining time.Duration) {
	w.t.Helper()
	var lockoutUntil any
	if remaining > 0 {
		lockoutUntil = time.Now().Add(remaining)
	}
	_, err := globalDB.Exec(context.Background(),
		`INSERT INTO iam.account_lockout
		     (organization_id, identity_id, failed_attempts, lockout_tier, lockout_until, last_failed_at, updated_at)
		 VALUES ($1, $2, $3, $3, $4, now(), now())
		 ON CONFLICT (organization_id, identity_id) DO UPDATE
		 SET failed_attempts = EXCLUDED.failed_attempts,
		     lockout_tier    = EXCLUDED.lockout_tier,
		     lockout_until   = EXCLUDED.lockout_until,
		     last_failed_at  = EXCLUDED.last_failed_at,
		     updated_at      = EXCLUDED.updated_at`,
		orgID, identityID, tier, lockoutUntil)
	require.NoError(w.t, err, "force lockout tier %d", tier)
}

// ---------------------------------------------------------------------------
// Arrange / Assert: native call wakeup (Feature 037)
// ---------------------------------------------------------------------------

// registerCallWakeDevice registers one device that can be woken natively for a call.
//
// On iOS that means two rows under one device identifier — the FCM token for routine
// notifications and the APNs VoIP token for calls — which is the arrangement the
// dispatcher fans out over. Passing "android" registers the single FCM row that platform
// uses for both.
func (w *testWorld) registerCallWakeDevice(actor testUser, deviceID, platform string, nativeCallCapable bool) {
	w.t.Helper()

	register := func(token string, tokenType rpcv1.PushTokenType, provider string) {
		req := connect.NewRequest(&rpcv1.RegisterPushTokenRequest{
			FcmToken:         token,
			DeviceIdentifier: deviceID,
			PermissionState:  rpcv1.PermissionState_PERMISSION_STATE_GRANTED,
			Endpoint:         "https://fcm.googleapis.com/fcm/send/test",
			KeysJson:         `{"p256dh":"test_key","auth":"test_auth"}`,
			UserAgent:        "TechOffice-Mobile/" + platform,
			TokenMetadata: map[string]string{
				"platform":         platform,
				"deliveryProvider": provider,
			},
			TokenType:         tokenType,
			NativeCallCapable: nativeCallCapable,
		})
		req.Header().Set("Authorization", "Bearer "+actor.Token)
		_, err := w.notif.RegisterPushToken(context.Background(), req)
		require.NoError(w.t, err)
	}

	register("test_fcm_"+uuid.New().String(), rpcv1.PushTokenType_PUSH_TOKEN_TYPE_FCM, "fcm")
	if platform == "ios" && nativeCallCapable {
		register("test_voip_"+uuid.New().String(), rpcv1.PushTokenType_PUSH_TOKEN_TYPE_APNS_VOIP, "apns")
	}
}

// callWakeAttempt is one row of the per-device call wake audit.
type callWakeAttempt struct {
	Status           string
	Reason           string
	Event            string
	DeviceIdentifier string
	Tier             string
}

// callWakeAttempts reads the call wake audit for one call, oldest first.
//
// It joins through the call's incoming-call notification because every wake for a call —
// terminal ones included — is recorded against that notification's recipient row, which
// is what makes one call read back as one trail.
func (w *testWorld) callWakeAttempts(callID string) []callWakeAttempt {
	w.t.Helper()
	rows, err := globalDB.Query(context.Background(),
		`SELECT da.attempt_status,
		        COALESCE(da.reason, ''),
		        COALESCE(da.metadata->>'event', ''),
		        COALESCE(da.metadata->>'deviceIdentifier', ''),
		        COALESCE(da.metadata->>'tier', '')
		   FROM notification.delivery_attempt da
		   JOIN notification.notification_recipient nr
		     ON (da.organization_id, da.notification_recipient_id) = (nr.organization_id, nr.id)
		   JOIN notification.notification n
		     ON (nr.organization_id, nr.notification_id) = (n.organization_id, n.id)
		  WHERE da.organization_id = $1
		    AND da.channel = 'call_wake'
		    AND n.action_data->>'callId' = $2
		  ORDER BY da.attempted_at ASC`,
		w.OrgID, callID)
	require.NoError(w.t, err)
	defer rows.Close()

	attempts := make([]callWakeAttempt, 0, 4)
	for rows.Next() {
		var a callWakeAttempt
		require.NoError(w.t, rows.Scan(&a.Status, &a.Reason, &a.Event, &a.DeviceIdentifier, &a.Tier))
		attempts = append(attempts, a)
	}
	require.NoError(w.t, rows.Err())
	return attempts
}

// waitForCallWakeAttempts polls until the audit holds at least min rows for the call, or
// gives up. The dispatch runs on a background worker tick, so an assertion made the
// instant after an RPC returns would be racing it rather than testing it.
func (w *testWorld) waitForCallWakeAttempts(callID string, min int) []callWakeAttempt {
	w.t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	var attempts []callWakeAttempt
	for time.Now().Before(deadline) {
		attempts = w.callWakeAttempts(callID)
		if len(attempts) >= min {
			return attempts
		}
		time.Sleep(200 * time.Millisecond)
	}
	return attempts
}

// callSessionRow reads the state a call ended in, and its ring deadline.
func (w *testWorld) callSessionRow(callID string) (state, outcome string, ringDeadlineAt *time.Time) {
	w.t.Helper()
	callUUID, err := dbuuid.Parse(callID)
	require.NoError(w.t, err)
	var outcomeText, stateText string
	var deadline *time.Time
	err = globalDB.QueryRow(context.Background(),
		`SELECT state, COALESCE(outcome, ''), ring_deadline_at
		   FROM voice.call_session
		  WHERE organization_id = $1 AND id = $2`,
		w.OrgID, callUUID).Scan(&stateText, &outcomeText, &deadline)
	require.NoError(w.t, err)
	return stateText, outcomeText, deadline
}

// expireCallRingDeadline moves a ringing call's deadline into the past so the ring
// timeout sweep claims it on its next tick, instead of the test waiting 45 seconds.
func (w *testWorld) expireCallRingDeadline(callID string) {
	w.t.Helper()
	callUUID, err := dbuuid.Parse(callID)
	require.NoError(w.t, err)
	_, err = globalDB.Exec(context.Background(),
		`UPDATE voice.call_session
		    SET ring_deadline_at = now() - interval '1 second'
		  WHERE organization_id = $1 AND id = $2 AND state = 'ringing'`,
		w.OrgID, callUUID)
	require.NoError(w.t, err)
}

// callWakeAttemptCount counts every call wake attempt in the organisation. Used where
// the assertion is that nothing was woken at all and there is no call id to key on,
// because the call was refused before it could be created.
func (w *testWorld) callWakeAttemptCount() int {
	w.t.Helper()
	var count int
	err := globalDB.QueryRow(context.Background(),
		`SELECT count(*) FROM notification.delivery_attempt
		  WHERE organization_id = $1 AND channel = 'call_wake'`,
		w.OrgID).Scan(&count)
	require.NoError(w.t, err)
	return count
}

package notification

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type routingLogicStub struct {
	decisions map[dbuuid.UUID]FallbackDecision
}

func TestRescuePushPayloadIncludesRecipientRoutingData(t *testing.T) {
	notificationID := dbuuid.Must()
	recipientID := dbuuid.Must()
	actionData, err := json.Marshal(map[string]string{
		"projectId": "project-123",
		"taskId":    "task-456",
	})
	require.NoError(t, err)
	navigationTarget, err := json.Marshal(map[string]string{
		"domain":       SourceDomainProjects,
		"resourceType": "task",
		"resourceId":   "task-456",
		"action":       "open",
	})
	require.NoError(t, err)

	data := pushDataFromNotificationFields(
		notificationID,
		recipientID,
		actionData,
		navigationTarget,
		SourceDomainProjects,
		NotificationTypeTaskAssigned,
		PolicyKeyTaskAssignment,
	)

	assert.Equal(t, recipientID.String(), data["notificationRecipientId"])
	assert.Equal(t, recipientID.String(), data["notification_recipient_id"])
	assert.Equal(t, "/workspace/tasks/project-123/tasks/task-456", data["click_action"])
}

func (s routingLogicStub) RouteEphemeralSignal(context.Context, dbuuid.UUID, *dbuuid.UUID, *rpcv1.NotificationEvent) error {
	return nil
}

func (s routingLogicStub) ShouldSendPush(context.Context, database.DBTX, dbuuid.UUID, dbuuid.UUID, int32, *dbuuid.UUID) (bool, string, error) {
	return false, "", nil
}

func (s routingLogicStub) ShouldSuppressPush(context.Context, database.DBTX, dbuuid.UUID, dbuuid.UUID, int32, string) (bool, error) {
	return false, nil
}

func (s routingLogicStub) DecideFallback(
	_ context.Context,
	_ database.DBTX,
	employeeID, _ dbuuid.UUID,
	_ int32,
	_ string,
	_ *dbuuid.UUID,
) FallbackDecision {
	decision, ok := s.decisions[employeeID]
	if !ok {
		return FallbackDecision{}
	}
	return decision
}

func TestCollectPushFallbackRecipients(t *testing.T) {
	employeeVisible := dbuuid.Must()
	employeeHidden := dbuuid.Must()
	orgID := dbuuid.Must()

	recipients := collectPushFallbackRecipients(
		context.Background(),
		nil,
		routingLogicStub{decisions: map[dbuuid.UUID]FallbackDecision{
			employeeVisible: {ShouldSend: false, Reason: FallbackReasonRecipientOnline},
			employeeHidden:  {ShouldSend: true},
		}},
		[]dbuuid.UUID{employeeVisible, employeeHidden},
		orgID,
		1,
		"chat",
		nil,
	)

	require.Len(t, recipients, 1)
	assert.Equal(t, employeeHidden, recipients[0])
}

func TestPlanPushFallbacks(t *testing.T) {
	employeeVisible := dbuuid.Must()
	employeeHidden := dbuuid.Must()
	employeeMuted := dbuuid.Must()
	orgID := dbuuid.Must()

	plan := planPushFallbacks(
		context.Background(),
		nil,
		routingLogicStub{decisions: map[dbuuid.UUID]FallbackDecision{
			employeeVisible: {ShouldSend: false, Reason: FallbackReasonRecipientOnline},
			employeeHidden:  {ShouldSend: true},
			employeeMuted:   {ShouldSend: false, Reason: FallbackReasonSuppressedByPreference},
		}},
		[]dbuuid.UUID{employeeVisible, employeeHidden, employeeMuted},
		orgID,
		1,
		SourceDomainChat,
		nil,
	)

	assert.Equal(t, []dbuuid.UUID{employeeHidden}, plan.immediatePushRecipients)
	assert.Equal(t, []dbuuid.UUID{employeeVisible}, plan.rescueQueueRecipients)
	assert.Equal(t, map[dbuuid.UUID]string{employeeMuted: FallbackReasonSuppressedByPreference}, plan.skippedRecipients)
}

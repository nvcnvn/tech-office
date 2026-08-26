package notification

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	firebase "firebase.google.com/go"
	"firebase.google.com/go/messaging"
	"github.com/jackc/pgx/v5"

	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
)

// RegisterPushTokenParams groups push token registration inputs.
type RegisterPushTokenParams struct {
	FCMToken         string
	DeviceIdentifier string
	Endpoint         *string
	Keys             *string
	UserAgent        *string
	TokenMetadata    *string
	PermissionState  string
}

// PushLogic encapsulates push notification and token management business rules.
type PushLogic interface {
	RegisterPushToken(ctx context.Context, tx database.DBTX, employeeID, orgID dbuuid.UUID, params *RegisterPushTokenParams) (*database.NotificationPushToken, error)
	ValidatePushToken(ctx context.Context, tx database.DBTX, tokenID, orgID dbuuid.UUID) error
	GetEmployeePushTokens(ctx context.Context, tx database.DBTX, employeeID, orgID dbuuid.UUID) ([]*database.GetEmployeePushTokensRow, error)
	MarkTokenInvalid(ctx context.Context, tx database.DBTX, tokenID, orgID dbuuid.UUID) error
	RevokePushToken(ctx context.Context, tx database.DBTX, employeeID, orgID dbuuid.UUID, tokenID dbuuid.NullUUID, deviceID *string) (int64, error)
	SendPushNotification(ctx context.Context, employeeID, orgID dbuuid.UUID, notification *PushNotificationPayload) error
}

// PushNotificationPayload represents a notification to be sent via FCM.
type PushNotificationPayload struct {
	Title    string
	Body     string
	Data     map[string]string
	ImageURL *string
	Priority string // "high" or "normal"
}

func isIncomingVoiceCallPush(notification *PushNotificationPayload) bool {
	if notification == nil || notification.Data == nil {
		return false
	}
	notificationType := notification.Data["notificationType"]
	if notificationType == "" {
		notificationType = notification.Data["notification_type"]
	}
	return notificationType == NotificationTypeVoiceCallIncoming
}

type pushLogicImpl struct {
	queries     *database.Queries
	adminPool   database.AdminDatabaseConnector
	fcmClient   *messaging.Client
	nowSupplier func() time.Time
}

type pushTokenMetadata struct {
	DeliveryProvider string `json:"deliveryProvider"`
	TokenType        string `json:"tokenType"`
	Platform         string `json:"platform"`
}

// fcmBatchTimeout bounds a single employee's push fan-out.
const fcmBatchTimeout = 10 * time.Second

const deleteDuplicatePushTokensByFCM = `
DELETE FROM notification.push_token
WHERE organization_id = $1
  AND fcm_token = $2
  AND token_id <> $3
`

// NewPushLogic constructs a PushLogic implementation.
func NewPushLogic(queries *database.Queries, adminPool database.AdminDatabaseConnector, fcmClient *messaging.Client) PushLogic {
	return &pushLogicImpl{
		queries:     queries,
		adminPool:   adminPool,
		fcmClient:   fcmClient,
		nowSupplier: time.Now,
	}
}

func (l *pushLogicImpl) RegisterPushToken(ctx context.Context, tx database.DBTX, employeeID, orgID dbuuid.UUID, params *RegisterPushTokenParams) (*database.NotificationPushToken, error) {
	if params == nil {
		return nil, fmt.Errorf("register push token params required")
	}
	if params.FCMToken == "" {
		return nil, fmt.Errorf("fcm_token is required")
	}
	if params.DeviceIdentifier == "" {
		return nil, fmt.Errorf("device_identifier is required")
	}

	slog.DebugContext(ctx, "registering push token",
		"function", "PushLogic.RegisterPushToken",
		"employee_id", employeeID.String(),
		"organization_id", orgID.String(),
		"device_identifier", params.DeviceIdentifier,
	)

	// Generate token ID
	tokenID := dbuuid.Must()
	now := timestamptzFromTime(l.nowSupplier())

	// Tokens are stored as valid on registration. Invalid tokens are identified
	// during delivery (delivery failures mark tokens invalid via MarkTokenInvalid).
	// Pre-validating tokens during registration introduces latency and causes
	// test tokens to be incorrectly rejected.
	isValid := true

	permissionState := params.PermissionState
	if permissionState == "" {
		permissionState = "granted" // default
	}

	token, err := l.queries.UpsertPushToken(ctx, tx, &database.UpsertPushTokenParams{
		TokenID:          tokenID,
		OrganizationID:   orgID,
		EmployeeID:       employeeID,
		DeviceIdentifier: params.DeviceIdentifier,
		FcmToken:         params.FCMToken,
		PermissionState:  permissionState,
		Endpoint:         stringToPG(params.Endpoint),
		Keys:             bytesToPG(params.Keys),
		UserAgent:        stringToPG(params.UserAgent),
		RegisteredAt:     now,
		LastUsedAt:       now,
		UpdatedAt:        now,
		IsValid:          isValid,
		TokenMetadata:    bytesToPG(params.TokenMetadata),
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to upsert push token",
			"function", "PushLogic.RegisterPushToken",
			"error", err,
		)
		return nil, fmt.Errorf("failed to upsert push token: %w", err)
	}

	removedDuplicates, err := l.deleteDuplicatePushTokensByFCM(ctx, tx, orgID, params.FCMToken, token.TokenID)
	if err != nil {
		slog.WarnContext(ctx, "failed to cleanup duplicate push tokens with same fcm token",
			"function", "PushLogic.RegisterPushToken",
			"employee_id", employeeID.String(),
			"organization_id", orgID.String(),
			"error", err,
		)
	} else if removedDuplicates > 0 {
		slog.InfoContext(ctx, "removed duplicate push token rows for reused fcm token",
			"function", "PushLogic.RegisterPushToken",
			"employee_id", employeeID.String(),
			"organization_id", orgID.String(),
			"removed_count", removedDuplicates,
		)
	}

	slog.InfoContext(ctx, "push token registered successfully",
		"token_id", token.TokenID.String(),
		"employee_id", employeeID.String(),
		"is_valid", isValid,
	)

	return token, nil
}

func (l *pushLogicImpl) deleteDuplicatePushTokensByFCM(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	fcmToken string,
	keepTokenID dbuuid.UUID,
) (int64, error) {
	result, err := tx.Exec(ctx, deleteDuplicatePushTokensByFCM, orgID, fcmToken, keepTokenID)
	if err != nil {
		return 0, fmt.Errorf("failed to delete duplicate push tokens by fcm token: %w", err)
	}
	return result.RowsAffected(), nil
}

func (l *pushLogicImpl) ValidatePushToken(ctx context.Context, tx database.DBTX, tokenID, orgID dbuuid.UUID) error {
	token, err := l.queries.GetPushTokenByID(ctx, tx, &database.GetPushTokenByIDParams{
		OrganizationID: orgID,
		TokenID:        tokenID,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return fmt.Errorf("push token not found")
		}
		return fmt.Errorf("failed to get push token: %w", err)
	}

	if !token.IsValid {
		return fmt.Errorf("push token is marked invalid")
	}

	// Test with dry-run send (skip if no FCM client configured)
	if l.fcmClient != nil {
		testMsg := &messaging.Message{
			Token: token.FcmToken,
			Data: map[string]string{
				"test": "validation",
			},
		}
		_, err = l.fcmClient.Send(ctx, testMsg)
		if err != nil {
			slog.WarnContext(ctx, "fcm token validation failed",
				"function", "PushLogic.ValidatePushToken",
				"error", err,
				"token_id", tokenID.String(),
			)
			// Mark token as invalid
			_ = l.MarkTokenInvalid(ctx, tx, tokenID, orgID)
			return fmt.Errorf("fcm token validation failed: %w", err)
		}
	}

	return nil
}

func (l *pushLogicImpl) GetEmployeePushTokens(ctx context.Context, tx database.DBTX, employeeID, orgID dbuuid.UUID) ([]*database.GetEmployeePushTokensRow, error) {
	tokens, err := l.queries.GetEmployeePushTokens(ctx, tx, &database.GetEmployeePushTokensParams{
		OrganizationID: orgID,
		EmployeeID:     employeeID,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get employee push tokens: %w", err)
	}
	return tokens, nil
}

func (l *pushLogicImpl) MarkTokenInvalid(ctx context.Context, tx database.DBTX, tokenID, orgID dbuuid.UUID) error {
	slog.DebugContext(ctx, "marking push token as invalid",
		"function", "PushLogic.MarkTokenInvalid",
		"token_id", tokenID.String(),
		"organization_id", orgID.String(),
	)

	err := l.queries.MarkPushTokenInvalid(ctx, tx, &database.MarkPushTokenInvalidParams{
		UpdatedAt:      timestamptzFromTime(l.nowSupplier()),
		OrganizationID: orgID,
		TokenID:        tokenID,
	})
	if err != nil {
		return fmt.Errorf("failed to mark push token invalid: %w", err)
	}
	return nil
}

func (l *pushLogicImpl) RevokePushToken(ctx context.Context, tx database.DBTX, employeeID, orgID dbuuid.UUID, tokenID dbuuid.NullUUID, deviceID *string) (int64, error) {
	slog.DebugContext(ctx, "revoking push token",
		"function", "PushLogic.RevokePushToken",
		"employee_id", employeeID.String(),
		"organization_id", orgID.String(),
		"token_id", tokenID.UUID.String(),
		"device_id", deviceID,
	)

	// DeletePushToken uses positional parameters Column2, Column3, Column4
	// Column2 = token_id (nullable)
	// Column3 = employee_id (nullable)
	// Column4 = device_identifier (nullable)
	var col2TokenID dbuuid.UUID    // token_id
	var col3EmployeeID dbuuid.UUID // employee_id
	var col4DeviceID string        // device_identifier

	if tokenID.Valid {
		col2TokenID = dbuuid.UUID(tokenID.UUID)
	}

	if deviceID != nil && *deviceID != "" {
		col3EmployeeID = employeeID
		col4DeviceID = *deviceID
	}

	count, err := l.queries.DeletePushToken(ctx, tx, &database.DeletePushTokenParams{
		OrganizationID: orgID,
		Column2:        col2TokenID,
		Column3:        col3EmployeeID,
		Column4:        col4DeviceID,
	})
	if err != nil {
		return 0, fmt.Errorf("failed to revoke push token: %w", err)
	}

	slog.InfoContext(ctx, "push token revoked",
		"revoked_count", count,
	)

	return count, nil
}

func (l *pushLogicImpl) SendPushNotification(ctx context.Context, employeeID, orgID dbuuid.UUID, notification *PushNotificationPayload) error {
	if notification == nil {
		return fmt.Errorf("notification payload required")
	}

	if l.fcmClient == nil {
		slog.ErrorContext(ctx, "❌ FCM CLIENT NOT CONFIGURED - Push notifications will not be sent!",
			"function", "PushLogic.SendPushNotification",
			"employee_id", employeeID.String(),
			"help", "Set GOOGLE_APPLICATION_CREDENTIALS environment variable pointing to Firebase service account JSON file. See backend/docs/FCM-SETUP.md for setup instructions.",
		)
		return fmt.Errorf("FCM client not initialized - check GOOGLE_APPLICATION_CREDENTIALS environment variable")
	}

	slog.DebugContext(ctx, "sending push notification",
		"function", "PushLogic.SendPushNotification",
		"employee_id", employeeID.String(),
		"organization_id", orgID.String(),
		"title", notification.Title,
	)

	// Get employee's valid push tokens (use adminPool for direct query)
	tokens, err := l.GetEmployeePushTokens(ctx, l.adminPool, employeeID, orgID)
	if err != nil {
		slog.ErrorContext(ctx, "❌ failed to query push tokens",
			"employee_id", employeeID.String(),
			"error", err,
		)
		return fmt.Errorf("failed to get employee push tokens: %w", err)
	}

	if len(tokens) == 0 {
		slog.WarnContext(ctx, "⚠️ no push tokens registered for offline employee",
			"employee_id", employeeID.String(),
			"help", "Employee needs to grant notification permission in browser and register FCM token via RegisterPushToken RPC",
		)
		return nil // Not an error - employee has no registered tokens
	}

	slog.InfoContext(ctx, "📲 found push tokens for offline employee",
		"employee_id", employeeID.String(),
		"token_count", len(tokens),
	)

	// Bound the whole FCM batch: these sends happen inside the caller's request
	// transaction, so an unresponsive FCM must not stall message delivery.
	sendCtx, cancelSend := context.WithTimeout(ctx, fcmBatchTimeout)
	defer cancelSend()

	// Send to all valid tokens (one by one for Firebase v3 compatibility)
	successCount := 0
	failureCount := 0
	duplicateCount := 0
	unsupportedCount := 0
	invalidatedCount := 0
	credentialFailure := false
	seenFCMTokens := make(map[string]struct{}, len(tokens))

	for _, token := range tokens {
		if _, seen := seenFCMTokens[token.FcmToken]; seen {
			duplicateCount++
			slog.WarnContext(ctx, "skipping duplicate push token row with identical fcm token",
				"token_id", token.TokenID.String(),
				"employee_id", employeeID.String(),
			)
			continue
		}
		seenFCMTokens[token.FcmToken] = struct{}{}

		if !isFirebaseSendableToken(token.TokenMetadata) {
			unsupportedCount++
			slog.WarnContext(ctx, "skipping unsupported push token for Firebase delivery",
				"token_id", token.TokenID.String(),
				"employee_id", employeeID.String(),
			)
			continue
		}

		androidNotification := &messaging.AndroidNotification{
			Title: notification.Title,
			Body:  notification.Body,
		}
		var apnsConfig *messaging.APNSConfig

		if isIncomingVoiceCallPush(notification) {
			androidNotification.ChannelID = "voice-calls"
			androidNotification.Sound = "default"
			androidNotification.DefaultSound = true
			androidNotification.DefaultVibrateTimings = true
			androidNotification.Priority = messaging.PriorityMax
			apnsConfig = &messaging.APNSConfig{
				Headers: map[string]string{
					"apns-priority":  "10",
					"apns-push-type": "alert",
				},
				Payload: &messaging.APNSPayload{
					Aps: &messaging.Aps{
						Alert: &messaging.ApsAlert{
							Title: notification.Title,
							Body:  notification.Body,
						},
						Sound:    "default",
						ThreadID: "voice-calls",
						CustomData: map[string]interface{}{
							"interruption-level": "time-sensitive",
						},
					},
				},
			}
		}

		msg := &messaging.Message{
			Token: token.FcmToken,
			Notification: &messaging.Notification{
				Title: notification.Title,
				Body:  notification.Body,
			},
			Data: notification.Data,
			Android: &messaging.AndroidConfig{
				Priority:     notification.Priority,
				Notification: androidNotification,
			},
			APNS: apnsConfig,
			Webpush: &messaging.WebpushConfig{
				Notification: &messaging.WebpushNotification{
					Title: notification.Title,
					Body:  notification.Body,
				},
			},
		}

		if notification.ImageURL != nil {
			msg.Notification.ImageURL = *notification.ImageURL
		}

		_, err := l.fcmClient.Send(sendCtx, msg)
		if err != nil {
			failureCount++

			// A 403 is reported as "mismatched-credential" whether the token belongs
			// to another Firebase project or the server's own service account lacks
			// cloudmessaging.messages.create. The second case is a server
			// misconfiguration that would fail for every token, so abandon the batch
			// instead of burning a round-trip each — and never invalidate tokens over
			// it, they are fine and the devices would have no way to know.
			if messaging.IsMismatchedCredential(err) {
				slog.ErrorContext(ctx, "❌ FCM rejected the server credentials - abandoning push batch",
					"error", err,
					"token_id", token.TokenID.String(),
					"employee_id", employeeID.String(),
					"help", "The GOOGLE_APPLICATION_CREDENTIALS service account must belong to the same Firebase project as the app and hold roles/firebasecloudmessaging.admin.",
				)
				credentialFailure = true
				break
			}

			// An unregistered token is dead for good (app uninstalled, token
			// rotated), so stop paying a round-trip for it on every notification.
			// A re-registration from the device flips is_valid back to true.
			unregistered := messaging.IsRegistrationTokenNotRegistered(err)
			slog.ErrorContext(ctx, "❌ FCM send failed for token",
				"error", err,
				"token_id", token.TokenID.String(),
				"employee_id", employeeID.String(),
				"unregistered", unregistered,
			)
			if unregistered {
				invalidatedCount++
				if markErr := l.MarkTokenInvalid(ctx, l.adminPool, token.TokenID, orgID); markErr != nil {
					slog.WarnContext(ctx, "failed to mark unregistered push token invalid",
						"error", markErr,
						"token_id", token.TokenID.String(),
					)
				}
			}
		} else {
			slog.InfoContext(ctx, "✅ push notification sent successfully",
				"token_id", token.TokenID.String(),
				"employee_id", employeeID.String(),
			)
			successCount++
		}
	}

	slog.InfoContext(ctx, "📊 push notification batch complete",
		"success_count", successCount,
		"failure_count", failureCount,
		"duplicate_count", duplicateCount,
		"unsupported_count", unsupportedCount,
		"invalidated_count", invalidatedCount,
		"credential_failure", credentialFailure,
		"employee_id", employeeID.String(),
	)

	if credentialFailure {
		return fmt.Errorf("FCM rejected the server credentials for organization %s", orgID.String())
	}

	return nil
}

// InitFCMClient initializes the Firebase Cloud Messaging client.
func InitFCMClient(ctx context.Context) (*messaging.Client, error) {
	app, err := firebase.NewApp(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize firebase app: %w", err)
	}

	client, err := app.Messaging(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get messaging client: %w", err)
	}

	slog.Info("FCM client initialized successfully")
	return client, nil
}

// Helper functions for type conversions

// stringToPG converts optional string pointer to string (empty if nil)
func stringToPG(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

// bytesToPG converts optional string pointer to bytes (empty JSON object if nil for JSONB columns)
func bytesToPG(value *string) []byte {
	if value == nil {
		return []byte("{}")
	}
	if *value == "" {
		return []byte("{}")
	}
	return []byte(*value)
}

func isFirebaseSendableToken(rawMetadata []byte) bool {
	if len(rawMetadata) == 0 {
		return true
	}

	var metadata pushTokenMetadata
	if err := json.Unmarshal(rawMetadata, &metadata); err != nil {
		return true
	}

	deliveryProvider := strings.ToLower(strings.TrimSpace(metadata.DeliveryProvider))
	tokenType := strings.ToLower(strings.TrimSpace(metadata.TokenType))

	if deliveryProvider == "expo" || deliveryProvider == "apns" {
		return false
	}

	if tokenType == "expo" {
		return false
	}

	return true
}

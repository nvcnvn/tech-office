package notification

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"time"

	"github.com/sideshow/apns2"
	apnstoken "github.com/sideshow/apns2/token"
)

// APNs VoIP pushes go straight to Apple rather than through Firebase: FCM will not
// accept apns-push-type: voip, and that header is what makes iOS deliver the push to
// PushKit on a locked, force-quit phone (research R1).
//
// Everything else the backend sends still goes through the Firebase client. This
// provider exists for one traffic class — live call events on the call_wake channel.

// Environment variables carrying the APNs VoIP credential. They follow the same shape
// as GOOGLE_APPLICATION_CREDENTIALS: a path to a key file plus the identifiers Apple
// needs to attribute it.
const (
	EnvAPNsVoIPKeyPath = "APNS_VOIP_KEY_PATH"
	EnvAPNsVoIPKeyID   = "APNS_VOIP_KEY_ID"
	EnvAPNsVoIPTeamID  = "APNS_VOIP_TEAM_ID"
	EnvAPNsVoIPTopic   = "APNS_VOIP_TOPIC"
	// EnvAPNsVoIPUseSandbox routes to Apple's sandbox gateway, which is where a
	// development build's VoIP token is registered. Unset means production.
	EnvAPNsVoIPUseSandbox = "APNS_VOIP_USE_SANDBOX"
)

// apnsVoIPTimeout bounds one push. A call wake that has not left the building inside
// this is already past its usefulness: the ring budget is 5 seconds end to end.
const apnsVoIPTimeout = 3 * time.Second

// ErrAPNsTokenUnregistered reports Apple's 410 Unregistered. The device token is dead
// for good — the app was uninstalled or the token rotated — so the caller marks the
// push_token row invalid, exactly as an FCM UNREGISTERED does.
var ErrAPNsTokenUnregistered = errors.New("apns: device token is no longer registered")

// APNsVoIPSender sends one VoIP push. Declared as an interface so the call wake
// dispatcher can be tested without reaching Apple.
type APNsVoIPSender interface {
	// SendVoIP delivers payload to deviceToken. collapseID lets a superseded wake
	// replace its predecessor rather than queue behind it, and expiration tells APNs
	// to drop a wake that is already stale instead of delivering it late.
	SendVoIP(ctx context.Context, deviceToken string, payload []byte, collapseID string, expiration time.Time) error
}

type apnsVoIPClient struct {
	client *apns2.Client
	topic  string
}

// NewAPNsVoIPClientFromEnv builds the VoIP provider from the environment.
//
// It returns (nil, nil) when the credential is not configured. That is deliberate and
// mirrors how the Firebase client behaves without GOOGLE_APPLICATION_CREDENTIALS: the
// server starts, logs loudly, and every iOS device falls to tier B — today's already
// shipped high-priority ring — rather than the process refusing to boot.
func NewAPNsVoIPClientFromEnv() (APNsVoIPSender, error) {
	keyPath := os.Getenv(EnvAPNsVoIPKeyPath)
	keyID := os.Getenv(EnvAPNsVoIPKeyID)
	teamID := os.Getenv(EnvAPNsVoIPTeamID)
	topic := os.Getenv(EnvAPNsVoIPTopic)

	if keyPath == "" && keyID == "" && teamID == "" && topic == "" {
		slog.Warn("⚠️ APNs VoIP credential not configured - iOS devices will fall back to the tier-B call ring",
			"help", fmt.Sprintf("Set %s, %s, %s and %s. See backend/docs/APNS-VOIP-SETUP.md.",
				EnvAPNsVoIPKeyPath, EnvAPNsVoIPKeyID, EnvAPNsVoIPTeamID, EnvAPNsVoIPTopic),
		)
		return nil, nil
	}

	// A partial credential is a misconfiguration, not a deliberate opt-out. Say so
	// rather than silently degrading a deployment that meant to enable this.
	for name, value := range map[string]string{
		EnvAPNsVoIPKeyPath: keyPath,
		EnvAPNsVoIPKeyID:   keyID,
		EnvAPNsVoIPTeamID:  teamID,
		EnvAPNsVoIPTopic:   topic,
	} {
		if value == "" {
			return nil, fmt.Errorf("APNs VoIP is partially configured: %s is empty", name)
		}
	}

	authKey, err := apnstoken.AuthKeyFromFile(keyPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read APNs VoIP auth key from %s: %w", keyPath, err)
	}

	// apns2 refreshes the JWT on the interval Apple requires; the token object is
	// shared by the client and re-signed as it ages.
	client := apns2.NewTokenClient(&apnstoken.Token{
		AuthKey: authKey,
		KeyID:   keyID,
		TeamID:  teamID,
	})

	useSandbox, _ := strconv.ParseBool(os.Getenv(EnvAPNsVoIPUseSandbox))
	if useSandbox {
		client = client.Development()
	} else {
		client = client.Production()
	}

	slog.Info("APNs VoIP client initialized",
		"topic", topic,
		"key_id", keyID,
		"team_id", teamID,
		"sandbox", useSandbox,
	)

	return &apnsVoIPClient{client: client, topic: topic}, nil
}

func (c *apnsVoIPClient) SendVoIP(ctx context.Context, deviceToken string, payload []byte, collapseID string, expiration time.Time) error {
	sendCtx, cancel := context.WithTimeout(ctx, apnsVoIPTimeout)
	defer cancel()

	notification := &apns2.Notification{
		DeviceToken: deviceToken,
		// The VoIP topic is the bundle identifier with a .voip suffix, and is a
		// different topic from the one alert pushes use.
		Topic:      c.topic,
		PushType:   apns2.PushTypeVOIP,
		Priority:   apns2.PriorityHigh,
		Expiration: expiration,
		CollapseID: collapseID,
		Payload:    payload,
	}

	response, err := c.client.PushWithContext(sendCtx, notification)
	if err != nil {
		return fmt.Errorf("apns voip push failed: %w", err)
	}
	if response.Sent() {
		return nil
	}
	if response.Reason == apns2.ReasonUnregistered {
		return fmt.Errorf("%w (apns-id %s)", ErrAPNsTokenUnregistered, response.ApnsID)
	}
	return fmt.Errorf("apns voip push rejected: status %d reason %s (apns-id %s)",
		response.StatusCode, response.Reason, response.ApnsID)
}

// marshalCallWakePayload encodes a call wake for a VoIP push.
//
// A VoIP push carries no aps dictionary and no alert — it is not a notification, it is
// a wake — so the module's envelope sits at the top level of the JSON body.
func marshalCallWakePayload(payload *CallWakePayload, eventID string) ([]byte, error) {
	encoded, err := json.Marshal(payload.toEnvelope(eventID))
	if err != nil {
		return nil, fmt.Errorf("failed to encode call wake payload: %w", err)
	}
	return encoded, nil
}

// isAPNsUnregistered reports Apple's 410. Kept next to the provider so the dispatcher
// does not need to know how the error is shaped.
func isAPNsUnregistered(err error) bool {
	return errors.Is(err, ErrAPNsTokenUnregistered)
}

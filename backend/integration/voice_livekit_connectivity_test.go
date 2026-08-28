package integration

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	lklivekit "github.com/livekit/protocol/livekit"
	lksdk "github.com/livekit/server-sdk-go/v2"
	"github.com/nvcnvn/tech-office/backend/internal/voice"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestVoiceLiveKitConnectivity validates that the local LiveKit server is
// reachable, that the backend mints tokens LiveKit accepts, and that rooms
// are created on the media plane — without requiring a real browser or WebRTC
// stack. Run this after changing docker/livekit.yaml or the voice config.
func TestVoiceLiveKitConnectivity(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	alice := w.withOwner()
	bob := w.withEmployee()
	channelID := w.createOrGetDM(alice, bob.ID)
	// A direct call to an unreachable callee is refused before the media plane is
	// touched (Feature 037), so give the callee a device before testing LiveKit.
	w.registerCallWakeDevice(bob, "device-bob-livekit", "ios", true)

	cfg, err := voice.LoadConfigFromEnv()
	require.NoError(t, err, "voice config must load without error")

	t.Run("when the backend starts a voice call", func(t *testing.T) {
		call, credentials := w.startVoiceCall(alice, channelID)
		require.NotNil(t, credentials, "join credentials must be present")
		require.NotEmpty(t, credentials.LivekitUrl, "LiveKit URL must not be empty")
		require.NotEmpty(t, credentials.LivekitToken, "LiveKit token must not be empty")
		require.NotEmpty(t, credentials.RoomName, "room name must not be empty")

		t.Cleanup(func() { w.endVoiceCall(alice, call.Id) })

		livekitHTTPURL := wsToHTTP(credentials.LivekitUrl)

		t.Run("the join contract leaves ICE and TURN discovery to LiveKit", func(t *testing.T) {
			assert.Equal(t, cfg.PublicLiveKitURL, credentials.LivekitUrl)
			assert.NotContains(t, credentials.String(), "turn:")
			assert.NotContains(t, credentials.String(), "turns:")
		})

		t.Run("the LiveKit HTTP endpoint is reachable at the URL returned to clients", func(t *testing.T) {
			client := &http.Client{Timeout: 5 * time.Second}
			resp, err := client.Get(livekitHTTPURL + "/")
			require.NoError(t, err, "LiveKit server must be listening at %s", livekitHTTPURL)
			defer resp.Body.Close()
			assert.Equal(t, http.StatusOK, resp.StatusCode)
		})

		t.Run("the backend-minted join token is accepted by the LiveKit media server", func(t *testing.T) {
			validateURL := fmt.Sprintf("%s/rtc/validate?access_token=%s", livekitHTTPURL, credentials.LivekitToken)
			client := &http.Client{Timeout: 5 * time.Second}
			resp, err := client.Get(validateURL)
			require.NoError(t, err, "LiveKit validate endpoint must be reachable")
			defer resp.Body.Close()
			assert.Equal(t, http.StatusOK, resp.StatusCode,
				"expected 200 OK; 401 = wrong key/secret, 404 = wrong LiveKit URL path")
		})

		t.Run("the media room exists in LiveKit after the backend creates it", func(t *testing.T) {
			roomClient := lksdk.NewRoomServiceClient(cfg.LiveKitURL, cfg.LiveKitAPIKey, cfg.LiveKitAPISecret)
			rooms, err := roomClient.ListRooms(context.Background(), &lklivekit.ListRoomsRequest{
				Names: []string{credentials.RoomName},
			})
			require.NoError(t, err, "room service must be reachable")
			require.NotEmpty(t, rooms.Rooms, "room %q must exist on the LiveKit server", credentials.RoomName)
			assert.Equal(t, credentials.RoomName, rooms.Rooms[0].Name)
		})
	})

	t.Run("when a second participant joins the same call", func(t *testing.T) {
		call, aliceCreds := w.startVoiceCall(alice, channelID)
		require.NotNil(t, aliceCreds)

		t.Cleanup(func() { w.endVoiceCall(alice, call.Id) })

		_, bobCreds := w.joinVoiceCall(bob, call.Id)
		require.NotNil(t, bobCreds)

		t.Run("both tokens point at the same room and are independently valid", func(t *testing.T) {
			assert.Equal(t, aliceCreds.RoomName, bobCreds.RoomName)
			assert.NotEqual(t, aliceCreds.LivekitToken, bobCreds.LivekitToken,
				"each participant must have a unique token")

			livekitHTTPURL := wsToHTTP(aliceCreds.LivekitUrl)
			client := &http.Client{Timeout: 5 * time.Second}

			aliceValidateURL := fmt.Sprintf("%s/rtc/validate?access_token=%s", livekitHTTPURL, aliceCreds.LivekitToken)
			r1, err := client.Get(aliceValidateURL)
			require.NoError(t, err)
			defer r1.Body.Close()
			assert.Equal(t, http.StatusOK, r1.StatusCode, "alice's token must be valid")

			bobValidateURL := fmt.Sprintf("%s/rtc/validate?access_token=%s", livekitHTTPURL, bobCreds.LivekitToken)
			r2, err := client.Get(bobValidateURL)
			require.NoError(t, err)
			defer r2.Body.Close()
			assert.Equal(t, http.StatusOK, r2.StatusCode, "bob's token must be valid")
		})
	})

	t.Run("when the call ends", func(t *testing.T) {
		call, credentials := w.startVoiceCall(alice, channelID)
		require.NotNil(t, credentials)

		roomClient := lksdk.NewRoomServiceClient(cfg.LiveKitURL, cfg.LiveKitAPIKey, cfg.LiveKitAPISecret)
		rooms, err := roomClient.ListRooms(context.Background(), &lklivekit.ListRoomsRequest{
			Names: []string{credentials.RoomName},
		})
		require.NoError(t, err)
		require.NotEmpty(t, rooms.Rooms, "the room must exist before the call ends")

		w.endVoiceCall(alice, call.Id)

		// Room teardown is the only terminal signal that does not depend on the
		// client being reachable: voice_call_ended is live_only and never replayed,
		// so a caller whose stream was down when the callee declined would otherwise
		// sit in a room forever with the UI still showing a call in progress.
		t.Run("the media room is torn down so nobody is left in a call that is over", func(t *testing.T) {
			require.Eventually(t, func() bool {
				remaining, err := roomClient.ListRooms(context.Background(), &lklivekit.ListRoomsRequest{
					Names: []string{credentials.RoomName},
				})
				return err == nil && len(remaining.Rooms) == 0
			}, 5*time.Second, 200*time.Millisecond,
				"room %q must be deleted when the call ends", credentials.RoomName)
		})
	})
}

// wsToHTTP converts a ws:// or wss:// URL to the equivalent http:// or https://.
func wsToHTTP(wsURL string) string {
	return strings.NewReplacer(
		"wss://", "https://",
		"ws://", "http://",
	).Replace(wsURL)
}

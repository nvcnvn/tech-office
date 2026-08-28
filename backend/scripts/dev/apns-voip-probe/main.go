// apns-voip-probe answers one question before you wire a credential into the server:
// does this .p8 authenticate to APNs for this team, and will it carry a VoIP push to
// this topic?
//
// Usage:
//
//	go run ./scripts/dev/apns-voip-probe <key.p8> <keyID> <teamID> <topic>
//	go run ./scripts/dev/apns-voip-probe AuthKey_ABC1234567.p8 ABC1234567 DEF7654321 com.devguards.TechOffice.voip
//
// Worth running because the alternative is a device that silently never rings: an
// unusable credential degrades every iPhone to the tier-B ring rather than failing
// loudly. See backend/docs/APNS-VOIP-SETUP.md.
//
// It sends one push to a deliberately invalid device token. The device token is not the
// question — the JWT is. Read the reason code:
//
//	BadDeviceToken      the key, key ID, team and topic were all accepted. Success.
//	InvalidProviderToken the key is not an APNs key, or key ID / team ID do not match it.
//	TopicDisallowed     the key is real but not permitted to send to this topic.
package main

import (
	"fmt"
	"os"
	"time"

	"github.com/sideshow/apns2"
	"github.com/sideshow/apns2/token"
)

func main() {
	keyPath, keyID, teamID, topic := os.Args[1], os.Args[2], os.Args[3], os.Args[4]

	authKey, err := token.AuthKeyFromFile(keyPath)
	if err != nil {
		fmt.Printf("cannot read %s as a PKCS#8 key: %v\n", keyPath, err)
		os.Exit(1)
	}
	tok := &token.Token{AuthKey: authKey, KeyID: keyID, TeamID: teamID}

	for _, env := range []string{"sandbox", "production"} {
		client := apns2.NewTokenClient(tok)
		if env == "sandbox" {
			client = client.Development()
		} else {
			client = client.Production()
		}

		res, err := client.Push(&apns2.Notification{
			// 64 hex chars: well-formed, and certainly not a real device.
			DeviceToken: "00000000000000000000000000000000000000000000000000000000000000ff",
			Topic:       topic,
			PushType:    apns2.PushTypeVOIP,
			Priority:    apns2.PriorityHigh,
			Expiration:  time.Now().Add(30 * time.Second),
			Payload:     []byte(`{"incomingCall":{"eventId":"00000000-0000-0000-0000-000000000000","serverCallId":"probe","hasVideo":false,"caller":{"id":"probe"},"metadata":{"event":"ended"}}}`),
		})
		if err != nil {
			fmt.Printf("%-10s transport error: %v\n", env, err)
			continue
		}

		verdict := "unexpected — read the reason above"
		switch res.Reason {
		case "BadDeviceToken":
			verdict = "KEY WORKS for this topic (only the fake device token was rejected)"
		case "InvalidProviderToken":
			verdict = "not an APNs key, or key ID / team ID do not match it"
		case "TopicDisallowed":
			verdict = "key is real but not allowed to send to this topic"
		case "MissingTopic":
			verdict = "topic was not accepted"
		}
		fmt.Printf("%-10s status=%d reason=%-22s -> %s\n", env, res.StatusCode, res.Reason, verdict)
	}
}

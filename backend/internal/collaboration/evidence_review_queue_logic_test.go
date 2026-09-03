package collaboration

import (
	"encoding/base64"
	"testing"
	"time"

	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
)

// The cursor is the queue's page boundary. If it does not survive a round trip exactly, a
// reviewer either sees a row twice or never sees it at all — so the round trip is the one
// property worth pinning down without a database.
func TestReviewQueueCursorRoundTrip(t *testing.T) {
	t.Run("when a cursor is encoded and decoded", func(t *testing.T) {
		t.Run("every leg of the sort tuple survives", func(t *testing.T) {
			want := reviewQueueCursor{
				urgencyRank:     0,
				serverTimestamp: time.Date(2026, 9, 3, 14, 5, 6, 123456789, time.UTC),
				submissionID:    dbuuid.Must(),
			}

			got, err := decodeReviewQueueCursor(encodeReviewQueueCursor(want))
			if err != nil {
				t.Fatalf("decode failed: %v", err)
			}
			if got.urgencyRank != want.urgencyRank {
				t.Errorf("urgencyRank = %d, want %d", got.urgencyRank, want.urgencyRank)
			}
			// Nanosecond precision matters: server_timestamp is the ordering leg, and a
			// truncated cursor would re-serve the row it points at.
			if !got.serverTimestamp.Equal(want.serverTimestamp) {
				t.Errorf("serverTimestamp = %v, want %v", got.serverTimestamp, want.serverTimestamp)
			}
			if got.submissionID != want.submissionID {
				t.Errorf("submissionID = %v, want %v", got.submissionID, want.submissionID)
			}
		})

		t.Run("the encoding is opaque", func(t *testing.T) {
			encoded := encodeReviewQueueCursor(reviewQueueCursor{
				urgencyRank:     1,
				serverTimestamp: time.Now(),
				submissionID:    dbuuid.Must(),
			})
			if encoded == "" {
				t.Fatal("encoded cursor is empty")
			}
			for _, c := range encoded {
				if c == '|' || c == ':' {
					t.Errorf("encoded cursor leaks its structure: %q", encoded)
					break
				}
			}
		})
	})

	t.Run("when the cursor is malformed", func(t *testing.T) {
		cases := map[string]string{
			"not base64":         "not-valid-base64!!!",
			"too few parts":      encodeRaw("0|2026-09-03T14:05:06Z"),
			"too many parts":     encodeRaw("0|2026-09-03T14:05:06Z|" + dbuuid.Must().String() + "|extra"),
			"rank not a number":  encodeRaw("late|2026-09-03T14:05:06Z|" + dbuuid.Must().String()),
			"timestamp not time": encodeRaw("0|yesterday|" + dbuuid.Must().String()),
			"id not a uuid":      encodeRaw("0|2026-09-03T14:05:06Z|not-a-uuid"),
			"empty":              "",
		}

		for name, encoded := range cases {
			t.Run("it is refused: "+name, func(t *testing.T) {
				if _, err := decodeReviewQueueCursor(encoded); err == nil {
					t.Errorf("decode(%q) succeeded, want an error", encoded)
				}
			})
		}
	})
}

// encodeRaw base64-encodes a cursor body directly, so a malformed tuple can be fed to the
// decoder without going through the encoder that would never produce it.
func encodeRaw(body string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(body))
}

package notification

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestPreferenceLogic covers the two pure transforms behind the personal preference
// record. Everything else in preference_logic.go is a query call and is covered by
// TestNotificationPersonalPreference in backend/integration.
func TestPreferenceLogic(t *testing.T) {
	t.Parallel()

	// This is the case no integration test can reach: muted_domains_valid makes a row
	// naming an unknown domain unwritable through any supported path. It becomes
	// reachable the moment a migration narrows the domain list, and when it does the
	// person must still be able to read and save their preferences.
	t.Run("filterKnownDomains drops what the system no longer recognises", func(t *testing.T) {
		cases := []struct {
			name  string
			given []string
			want  []string
		}{
			{"nothing stored", []string{}, []string{}},
			{"all known, order preserved", []string{"calendar", "chat", "docs"}, []string{"calendar", "chat", "docs"}},
			{"a retired domain is dropped, the rest keep their order",
				[]string{"calendar", "marketing", "chat"}, []string{"calendar", "chat"}},
			{"every stored domain retired", []string{"marketing", "telex"}, []string{}},
		}
		for _, tc := range cases {
			t.Run(tc.name, func(t *testing.T) {
				assert.Equal(t, tc.want, filterKnownDomains(tc.given))
			})
		}
	})

	// FR-007, FR-008.
	t.Run("normalizeMutedDomains deduplicates, sorts, and names the first refusal", func(t *testing.T) {
		cases := []struct {
			name       string
			given      []string
			want       []string
			wantErrFor string
		}{
			{"nothing muted", []string{}, []string{}, ""},
			{"sorted so two clients sending the same set store the same array",
				[]string{"system", "calendar", "chat"}, []string{"calendar", "chat", "system"}, ""},
			{"a domain named twice is stored once",
				[]string{"chat", "chat", "calendar"}, []string{"calendar", "chat"}, ""},
			{"every domain at once is legal", AllSourceDomains(), nil, ""},
			{"an unknown domain is refused by name", []string{"chat", "marketing"}, nil, "marketing"},
			{"the first unknown domain is the one reported",
				[]string{"marketing", "telex"}, nil, "marketing"},
			{"the empty string is not a domain", []string{""}, nil, `""`},
		}
		for _, tc := range cases {
			t.Run(tc.name, func(t *testing.T) {
				got, err := normalizeMutedDomains(tc.given)
				if tc.wantErrFor != "" {
					require.Error(t, err)
					assert.ErrorIs(t, err, ErrInvalidPreference)
					assert.Contains(t, err.Error(), tc.wantErrFor,
						"the message must name the value so the person knows what to fix")
					return
				}
				require.NoError(t, err)
				if tc.want != nil {
					assert.Equal(t, tc.want, got)
				} else {
					assert.Len(t, got, len(AllSourceDomains()))
				}
			})
		}
	})

	// The wire shape for the do-not-disturb window. No screen in feature 051 edits
	// these, but the contract accepts them, so it validates them.
	t.Run("do-not-disturb times are HH:MM or empty", func(t *testing.T) {
		cases := []struct {
			given     string
			wantValid bool
			roundTrip string
		}{
			{"", false, ""},
			{"00:00", true, "00:00"},
			{"22:00", true, "22:00"},
			{"23:59", true, "23:59"},
			{"06:30", true, "06:30"},
		}
		for _, tc := range cases {
			t.Run("accepts "+tc.given, func(t *testing.T) {
				parsed, err := parseDayTime("dnd_start", tc.given)
				require.NoError(t, err)
				assert.Equal(t, tc.wantValid, parsed.Valid)
				assert.Equal(t, tc.roundTrip, formatDayTime(parsed))
			})
		}

		for _, bad := range []string{"25:00", "22:60", "10", "10:00:00", "ten o'clock", "-1:00"} {
			t.Run("refuses "+bad, func(t *testing.T) {
				_, err := parseDayTime("dnd_start", bad)
				require.Error(t, err)
				assert.ErrorIs(t, err, ErrInvalidPreference)
				assert.Contains(t, err.Error(), "dnd_start", "the message names the field")
			})
		}
	})
}

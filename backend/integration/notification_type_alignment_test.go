package integration

// The Go constant list and the database CHECK on notification.notification_type are two
// halves of one contract, and nothing used to compare them: the V2 contract test asserted
// the Go list against the Go validator, so it passed while the two disagreed. This reads
// the constraint out of the live schema instead.

import (
	"context"
	"regexp"
	"sort"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nvcnvn/tech-office/backend/internal/notification"
)

func TestNotificationTypeCheckMatchesGoConstants(t *testing.T) {
	t.Parallel()

	var definition string
	err := globalDB.QueryRow(context.Background(),
		`SELECT pg_get_constraintdef(oid)
		   FROM pg_constraint
		  WHERE conname = 'notification_notification_type_valid'`,
	).Scan(&definition)
	require.NoError(t, err, "the notification_type CHECK must exist")

	literal := regexp.MustCompile(`'([a-z_]+)'`)
	var inSchema []string
	for _, match := range literal.FindAllStringSubmatch(definition, -1) {
		inSchema = append(inSchema, match[1])
	}
	sort.Strings(inSchema)

	inGo := append([]string(nil), notification.AllNotificationTypes()...)
	sort.Strings(inGo)

	assert.Equal(t, inSchema, inGo,
		"notification.AllNotificationTypes() and the notification_type CHECK must list the same types; "+
			"add the type to both, in one change set")

	for _, notifType := range inSchema {
		assert.True(t, notification.IsValidNotificationType(notifType),
			"IsValidNotificationType rejects %q, which the database accepts", notifType)
	}
}

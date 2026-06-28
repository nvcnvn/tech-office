package notification

import (
	"context"
	"fmt"
	"time"

	lru "github.com/hashicorp/golang-lru/v2"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
)

// DeduplicationCache manages notification deduplication using LRU cache.
type DeduplicationCache struct {
	cache *lru.Cache[string, DeduplicationEntry]
	ttl   time.Duration
}

// DeduplicationEntry stores cached notification information.
type DeduplicationEntry struct {
	NotificationID dbuuid.UUID
	Timestamp      time.Time
}

// NewDeduplicationCache creates a new deduplication cache.
// cacheSize: Maximum number of entries (default: 10000)
// ttl: Time to live for entries (default: 5 minutes)
func NewDeduplicationCache(cacheSize int, ttl time.Duration) (*DeduplicationCache, error) {
	if cacheSize <= 0 {
		cacheSize = 10000
	}
	if ttl <= 0 {
		ttl = 5 * time.Minute
	}

	cache, err := lru.New[string, DeduplicationEntry](cacheSize)
	if err != nil {
		return nil, fmt.Errorf("failed to create LRU cache: %w", err)
	}

	return &DeduplicationCache{
		cache: cache,
		ttl:   ttl,
	}, nil
}

// checkDuplicate checks if a notification with the same action category, source user, and resource
// was recently created (within TTL window).
//
// Cache key format: {organization_id}:{action_category}:{source_user_id}:{resource_id}
//
// Returns:
// - isDuplicate: true if a recent notification exists
// - existingNotificationID: UUID of the existing notification (if isDuplicate is true)
func (dc *DeduplicationCache) checkDuplicate(
	ctx context.Context,
	orgID dbuuid.UUID,
	actionCategory string,
	sourceUserID string,
	resourceID string,
) (bool, dbuuid.UUID) {
	key := fmt.Sprintf("%s:%s:%s:%s", orgID.String(), actionCategory, sourceUserID, resourceID)

	entry, ok := dc.cache.Get(key)
	if !ok {
		return false, dbuuid.UUID{}
	}

	// Check if entry is expired
	if time.Since(entry.Timestamp) > dc.ttl {
		dc.cache.Remove(key)
		return false, dbuuid.UUID{}
	}

	return true, entry.NotificationID
}

// recordNotification records a notification in the deduplication cache.
func (dc *DeduplicationCache) recordNotification(
	ctx context.Context,
	orgID dbuuid.UUID,
	actionCategory string,
	sourceUserID string,
	resourceID string,
	notificationID dbuuid.UUID,
) {
	key := fmt.Sprintf("%s:%s:%s:%s", orgID.String(), actionCategory, sourceUserID, resourceID)

	entry := DeduplicationEntry{
		NotificationID: notificationID,
		Timestamp:      time.Now(),
	}

	dc.cache.Add(key, entry)
}

// normalization action category for deduplication grouping.
// Example: "react:like" and "react:unlike" both map to "react"
func normalizeActionCategory(category string) string {
	// For now, return as-is. In the future, implement grouping logic.
	// Example implementation:
	// if strings.HasPrefix(category, "react:") {
	//     return "react"
	// }
	return category
}

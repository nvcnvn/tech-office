package linking

import (
	"context"
	"log/slog"

	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
)

// MaxPreviewURLsPerRequest bounds one preview request. Over the bound is a 400 rather than
// a truncation: the clients hold the same bound, so exceeding it is a client bug, not a
// user action (research D1). Mirrored as MAX_PREVIEW_URLS_PER_REQUEST in packages/apis.
const MaxPreviewURLsPerRequest = 20

// PreviewTarget is one link the request asked about, already normalised.
type PreviewTarget struct {
	// Key is string(ResourceType) + "/" + ResourceID — how a provider's result map is
	// addressed, so the same resource linked twice is looked up once.
	Key          string
	Target       CanonicalLinkTarget
	CanonicalURL string
}

// PreviewKey is the map key a provider must answer under.
func PreviewKey(resourceType ResourceType, resourceID string) string {
	return string(resourceType) + "/" + resourceID
}

// PreviewReader is who is asking. A preview is only ever composed for a reader whose
// organization matches the link's tenant.
type PreviewReader struct {
	EmployeeID     dbuuid.UUID
	OrganizationID dbuuid.UUID
}

// PreviewProvider resolves every target of its own resource types in one call.
//
// A target the reader may not see is simply absent from the returned map — the provider
// never reports why, which is what makes access-denied and not-found indistinguishable to
// the caller (FR-010). The access predicate lives in the provider's SQL, so a row the
// reader may not see is never loaded in the first place.
type PreviewProvider interface {
	// Handles reports whether this provider answers for a resource type.
	Handles(resourceType ResourceType) bool

	// Preview resolves the given targets, keyed by PreviewTarget.Key.
	Preview(ctx context.Context, tx database.DBTX, reader PreviewReader, targets []PreviewTarget) (map[string]*LinkPreviewMetadata, error)
}

// PreviewAggregator groups a request's targets by the first provider that Handles their
// type and calls each provider exactly once, so a request costs one query per resource
// type present rather than one per link (FR-020, SC-005).
//
// There is deliberately no default branch: a target no provider resolves is unavailable,
// not a card naming a UUID. That default was the defect this feature closes (FR-006).
type PreviewAggregator struct {
	providers []PreviewProvider
}

func NewPreviewAggregator(providers ...PreviewProvider) *PreviewAggregator {
	return &PreviewAggregator{providers: providers}
}

// Preview resolves every target it can. A provider that errors contributes nothing and is
// logged; the other providers' results still render (FR-023).
//
// The returned int is how many provider calls the request cost — logged by the caller and
// asserted by the SC-005 cost scenario.
func (a *PreviewAggregator) Preview(
	ctx context.Context,
	tx database.DBTX,
	reader PreviewReader,
	targets []PreviewTarget,
) (map[string]*LinkPreviewMetadata, int) {
	results := make(map[string]*LinkPreviewMetadata, len(targets))
	if len(targets) == 0 {
		return results, 0
	}

	// Group by provider index so each provider is called once with all of its targets.
	grouped := make(map[int][]PreviewTarget, len(a.providers))
	for _, target := range targets {
		for index, provider := range a.providers {
			if !provider.Handles(target.Target.ResourceType) {
				continue
			}
			grouped[index] = append(grouped[index], target)
			break
		}
	}

	calls := 0
	for index, providerTargets := range grouped {
		provider := a.providers[index]
		calls++
		previews, err := provider.Preview(ctx, tx, reader, providerTargets)
		if err != nil {
			slog.WarnContext(ctx, "link preview provider failed",
				"resourceType", providerTargets[0].Target.ResourceType,
				"targets", len(providerTargets),
				"error", err,
			)
			continue
		}
		for key, preview := range previews {
			if preview != nil {
				results[key] = preview
			}
		}
	}
	return results, calls
}

// bookingPreviewProvider is the one provider that reads no row: there is no per-reader
// booking record to describe, so the card stays generic. It is here rather than in a
// domain package precisely because it owns no SQL.
type bookingPreviewProvider struct{}

func NewBookingPreviewProvider() PreviewProvider { return bookingPreviewProvider{} }

func (bookingPreviewProvider) Handles(resourceType ResourceType) bool {
	return resourceType == ResourceTypeBookingItem
}

func (bookingPreviewProvider) Preview(
	_ context.Context,
	_ database.DBTX,
	_ PreviewReader,
	targets []PreviewTarget,
) (map[string]*LinkPreviewMetadata, error) {
	results := make(map[string]*LinkPreviewMetadata, len(targets))
	for _, target := range targets {
		results[target.Key] = &LinkPreviewMetadata{
			Title:        "Booking",
			Subtitle:     "Schedule a meeting",
			ResourceType: ResourceTypeBookingItem,
			Badge:        "Booking",
			Href:         target.CanonicalURL,
		}
	}
	return results, nil
}

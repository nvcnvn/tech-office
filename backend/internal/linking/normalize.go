package linking

import (
	"fmt"
	"net/url"
	"strings"
)

type NormalizeResult struct {
	Target           CanonicalLinkTarget
	IgnoredQueryKeys []string
	FallbackURL      string
}

func Normalize(raw string) (NormalizeResult, error) {
	parsed, err := url.Parse(raw)
	if err != nil {
		return NormalizeResult{}, fmt.Errorf("parse url: %w", err)
	}
	parts := strings.Split(strings.Trim(parsed.Path, "/"), "/")
	if len(parts) >= 5 && parts[0] == "o" && parts[2] == "r" {
		resourceType, err := normalizeResourceType(parts[3])
		if err != nil {
			return NormalizeResult{}, err
		}
		allowed, ignored := NormalizeAllowedQuery(parsed.Query())
		target := CanonicalLinkTarget{
			TenantKey:        parts[1],
			ResourceType:     resourceType,
			ResourceID:       parts[4],
			FocusIntent:      allowed.Get("focusIntent"),
			EntryContext:     allowed.Get("entryContext"),
			RequirementID:    allowed.Get("requirementId"),
			AnchorType:       AnchorType(allowed.Get("anchorType")),
			AnchorID:         allowed.Get("anchorId"),
			CanonicalVersion: CanonicalVersion,
		}
		if err := target.Validate(); err != nil {
			return NormalizeResult{}, err
		}
		return NormalizeResult{Target: target, IgnoredQueryKeys: ignored}, nil
	}

	return NormalizeResult{}, fmt.Errorf("unsupported canonical path")
}

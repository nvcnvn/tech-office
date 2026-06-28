package linking

import (
	"fmt"
	"net/url"
	"strings"
)

type NormalizeResult struct {
	Target           CanonicalLinkTarget
	IgnoredQueryKeys []string
	LegacyNormalized bool
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

	legacy := normalizeLegacyRoute(parsed)
	if legacy == nil {
		return NormalizeResult{}, fmt.Errorf("unsupported canonical or legacy path")
	}
	return *legacy, nil
}

func normalizeLegacyRoute(parsed *url.URL) *NormalizeResult {
	hostParts := strings.Split(parsed.Hostname(), ".")
	pathParts := strings.Split(strings.Trim(parsed.Path, "/"), "/")
	if len(hostParts) < 3 || len(pathParts) == 0 {
		return nil
	}
	tenantKey := hostParts[0]
	var resourceType ResourceType
	var resourceID string
	switch pathParts[0] {
	case "workspace":
		if len(pathParts) >= 4 && pathParts[1] == "projects" && pathParts[3] == "tasks" && len(pathParts) >= 5 {
			resourceType = ResourceTypeTaskInstance
			resourceID = pathParts[4]
		} else if len(pathParts) >= 3 && pathParts[1] == "tasks" {
			resourceType = ResourceTypeTaskInstance
			resourceID = pathParts[2]
		}
	case "chat":
		if len(pathParts) >= 2 {
			resourceType = ResourceTypeChatChannel
			resourceID = pathParts[1]
		}
	case "docs":
		if len(pathParts) >= 2 {
			resourceType = ResourceTypeDocumentPage
			resourceID = pathParts[1]
		}
	case "calendar":
		if len(pathParts) >= 2 {
			resourceType = ResourceTypeCalendarEvent
			resourceID = pathParts[1]
		}
	}
	if resourceType == "" || resourceID == "" {
		return nil
	}
	allowed, ignored := NormalizeAllowedQuery(parsed.Query())
	result := &NormalizeResult{
		Target: CanonicalLinkTarget{
			TenantKey:        tenantKey,
			ResourceType:     resourceType,
			ResourceID:       resourceID,
			FocusIntent:      allowed.Get("focusIntent"),
			EntryContext:     allowed.Get("entryContext"),
			RequirementID:    allowed.Get("requirementId"),
			AnchorType:       AnchorType(allowed.Get("anchorType")),
			AnchorID:         allowed.Get("anchorId"),
			CanonicalVersion: CanonicalVersion,
		},
		IgnoredQueryKeys: ignored,
		LegacyNormalized: true,
	}
	return result
}

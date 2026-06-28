package linking

import (
	"fmt"
	"net/url"
	"strings"

	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
)

type ResourceType string

const (
	ResourceTypeTaskInstance       ResourceType = "task"
	ResourceTypeChatChannel        ResourceType = "chat"
	ResourceTypeChatThread         ResourceType = "thread"
	ResourceTypeChatMessageAnchor  ResourceType = "message"
	ResourceTypeProjectDestination ResourceType = "project"
	ResourceTypeWorkspace          ResourceType = "workspace"
	ResourceTypeDocumentPage       ResourceType = "document"
	ResourceTypeCalendarEvent      ResourceType = "calendar"
	ResourceTypeBookingItem        ResourceType = "booking"
)

type AnchorType string

const (
	AnchorTypeMessage     AnchorType = "message"
	AnchorTypeThread      AnchorType = "thread"
	AnchorTypeRequirement AnchorType = "requirement"
	AnchorTypeSection     AnchorType = "section"
)

type ResolutionStatus string

const (
	ResolutionStatusOK           ResolutionStatus = "ok"
	ResolutionStatusAuthRequired ResolutionStatus = "auth_required"
	ResolutionStatusAccessDenied ResolutionStatus = "access_denied"
	ResolutionStatusNotFound     ResolutionStatus = "not_found"
	ResolutionStatusFallback     ResolutionStatus = "fallback"
)

type Platform string

const (
	PlatformWeb    Platform = "web"
	PlatformMobile Platform = "mobile"
)

const CanonicalVersion = "v1"

var allowedQueryKeys = map[string]struct{}{
	"focusIntent":   {},
	"entryContext":  {},
	"requirementId": {},
	"anchorType":    {},
	"anchorId":      {},
}

type CanonicalLinkTarget struct {
	ResourceType     ResourceType `json:"resourceType"`
	ResourceID       string       `json:"resourceId"`
	TenantKey        string       `json:"tenantKey"`
	FocusIntent      string       `json:"focusIntent,omitempty"`
	EntryContext     string       `json:"entryContext,omitempty"`
	RequirementID    string       `json:"requirementId,omitempty"`
	AnchorType       AnchorType   `json:"anchorType,omitempty"`
	AnchorID         string       `json:"anchorId,omitempty"`
	CanonicalVersion string       `json:"canonicalVersion"`
}

type CanonicalLink struct {
	Host   string              `json:"host"`
	Path   string              `json:"path"`
	Query  url.Values          `json:"query,omitempty"`
	RawURL string              `json:"rawUrl,omitempty"`
	Target CanonicalLinkTarget `json:"target"`
}

type LinkPreviewMetadata struct {
	Title        string       `json:"title"`
	Subtitle     string       `json:"subtitle,omitempty"`
	ResourceType ResourceType `json:"resourceType"`
	Badge        string       `json:"badge,omitempty"`
	Href         string       `json:"href"`
	Thumbnail    string       `json:"thumbnail,omitempty"`
}

type LinkResolutionResult struct {
	NormalizedTarget       CanonicalLinkTarget  `json:"normalizedTarget"`
	ResolutionStatus       ResolutionStatus     `json:"status"`
	WebRoute               string               `json:"webRoute,omitempty"`
	MobileRoute            string               `json:"mobileRoute,omitempty"`
	RequiresAuthentication bool                 `json:"requiresAuthentication,omitempty"`
	Preview                *LinkPreviewMetadata `json:"preview,omitempty"`
	AppliedContext         []string             `json:"appliedContext,omitempty"`
	IgnoredContext         []string             `json:"ignoredContext,omitempty"`
	FallbackURL            string               `json:"fallbackUrl,omitempty"`
	LegacyNormalized       bool                 `json:"legacyNormalized,omitempty"`
}

type ClientRouteTranslation struct {
	Platform    Platform `json:"platform"`
	LocalRoute  string   `json:"localRoute"`
	TenantValid bool     `json:"tenantValid"`
}

func (t CanonicalLinkTarget) Validate() error {
	if t.TenantKey == "" {
		return fmt.Errorf("tenantKey is required")
	}
	if t.ResourceType == "" {
		return fmt.Errorf("resourceType is required")
	}
	if t.ResourceID == "" {
		return fmt.Errorf("resourceId is required")
	}
	if _, err := normalizeResourceType(string(t.ResourceType)); err != nil {
		return err
	}
	if strings.Contains(t.TenantKey, "/") {
		return fmt.Errorf("tenantKey must not contain path separators")
	}
	if t.RequirementID != "" {
		if _, err := dbuuid.Parse(t.RequirementID); err != nil {
			return fmt.Errorf("requirementId must be a UUID: %w", err)
		}
	}
	if t.AnchorID != "" && t.AnchorType == "" {
		return fmt.Errorf("anchorType is required when anchorId is set")
	}
	if t.AnchorType != "" {
		switch t.AnchorType {
		case AnchorTypeMessage, AnchorTypeThread, AnchorTypeRequirement, AnchorTypeSection:
		default:
			return fmt.Errorf("unsupported anchorType %q", t.AnchorType)
		}
	}
	return nil
}

func (t CanonicalLinkTarget) QueryValues() url.Values {
	query := url.Values{}
	if t.FocusIntent != "" {
		query.Set("focusIntent", t.FocusIntent)
	}
	if t.EntryContext != "" {
		query.Set("entryContext", t.EntryContext)
	}
	if t.RequirementID != "" {
		query.Set("requirementId", t.RequirementID)
	}
	if t.AnchorType != "" {
		query.Set("anchorType", string(t.AnchorType))
	}
	if t.AnchorID != "" {
		query.Set("anchorId", t.AnchorID)
	}
	return query
}

func normalizeResourceType(value string) (ResourceType, error) {
	switch ResourceType(strings.TrimSpace(value)) {
	case ResourceTypeTaskInstance,
		ResourceTypeChatChannel,
		ResourceTypeChatThread,
		ResourceTypeChatMessageAnchor,
		ResourceTypeProjectDestination,
		ResourceTypeWorkspace,
		ResourceTypeDocumentPage,
		ResourceTypeCalendarEvent,
		ResourceTypeBookingItem:
		return ResourceType(value), nil
	default:
		return "", fmt.Errorf("unsupported resourceType %q", value)
	}
}

func NormalizeAllowedQuery(query url.Values) (allowed url.Values, ignored []string) {
	allowed = url.Values{}
	for key, values := range query {
		if _, ok := allowedQueryKeys[key]; !ok {
			ignored = append(ignored, key)
			continue
		}
		for _, value := range values {
			allowed.Add(key, value)
		}
	}
	return allowed, ignored
}

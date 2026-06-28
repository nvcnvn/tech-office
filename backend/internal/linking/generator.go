package linking

import (
	"fmt"
	"net/url"
	"path"
	"strings"
)

type Generator struct {
	canonicalHost string
}

type TargetOptions struct {
	FocusIntent   string
	EntryContext  string
	RequirementID string
	AnchorType    AnchorType
	AnchorID      string
}

func NewGenerator(webappURL string) (*Generator, error) {
	parsed, err := url.Parse(webappURL)
	if err != nil {
		return nil, fmt.Errorf("parse webapp URL: %w", err)
	}
	if parsed.Scheme == "" || parsed.Host == "" {
		return nil, fmt.Errorf("webapp URL must include scheme and host")
	}
	return &Generator{canonicalHost: fmt.Sprintf("%s://%s", parsed.Scheme, parsed.Host)}, nil
}

func (g *Generator) Generate(target CanonicalLinkTarget) (CanonicalLink, string, error) {
	if err := target.Validate(); err != nil {
		return CanonicalLink{}, "", err
	}
	target.CanonicalVersion = CanonicalVersion
	canonicalPath := path.Join("/o", target.TenantKey, "r", string(target.ResourceType), target.ResourceID)
	query := target.QueryValues()
	canonicalURL := g.canonicalHost + canonicalPath
	if encoded := stableEncode(query); encoded != "" {
		canonicalURL += "?" + encoded
	}
	return CanonicalLink{
		Host:   g.canonicalHost,
		Path:   canonicalPath,
		Query:  query,
		Target: target,
	}, canonicalURL, nil
}

func stableEncode(values url.Values) string {
	if len(values) == 0 {
		return ""
	}
	encoded := values.Encode()
	return strings.ReplaceAll(encoded, "+", "%20")
}

func NewTaskTarget(tenantKey, taskID string, options TargetOptions) CanonicalLinkTarget {
	return newTarget(tenantKey, ResourceTypeTaskInstance, taskID, options)
}

func NewProjectTarget(tenantKey, projectID string) CanonicalLinkTarget {
	return newTarget(tenantKey, ResourceTypeProjectDestination, projectID, TargetOptions{})
}

func NewWorkspaceTarget(tenantKey string) CanonicalLinkTarget {
	return newTarget(tenantKey, ResourceTypeWorkspace, tenantKey, TargetOptions{})
}

func NewChatChannelTarget(tenantKey, channelID string, options TargetOptions) CanonicalLinkTarget {
	return newTarget(tenantKey, ResourceTypeChatChannel, channelID, options)
}

func NewCalendarEventTarget(tenantKey, eventID string, options TargetOptions) CanonicalLinkTarget {
	return newTarget(tenantKey, ResourceTypeCalendarEvent, eventID, options)
}

func NewDocumentTarget(tenantKey, documentID string, options TargetOptions) CanonicalLinkTarget {
	return newTarget(tenantKey, ResourceTypeDocumentPage, documentID, options)
}

func newTarget(tenantKey string, resourceType ResourceType, resourceID string, options TargetOptions) CanonicalLinkTarget {
	return CanonicalLinkTarget{
		TenantKey:     tenantKey,
		ResourceType:  resourceType,
		ResourceID:    resourceID,
		FocusIntent:   options.FocusIntent,
		EntryContext:  options.EntryContext,
		RequirementID: options.RequirementID,
		AnchorType:    options.AnchorType,
		AnchorID:      options.AnchorID,
	}
}

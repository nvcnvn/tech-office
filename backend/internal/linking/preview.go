package linking

import "fmt"

type PreviewProvider interface {
	Preview(target CanonicalLinkTarget, canonicalURL string) (*LinkPreviewMetadata, bool)
}

type PreviewAggregator struct {
	providers []PreviewProvider
}

func NewPreviewAggregator(providers ...PreviewProvider) *PreviewAggregator {
	return &PreviewAggregator{providers: providers}
}

func (a *PreviewAggregator) Preview(target CanonicalLinkTarget, canonicalURL string) *LinkPreviewMetadata {
	for _, provider := range a.providers {
		preview, ok := provider.Preview(target, canonicalURL)
		if ok {
			return preview
		}
	}
	return &LinkPreviewMetadata{
		Title:        defaultPreviewTitle(target),
		ResourceType: target.ResourceType,
		Href:         canonicalURL,
	}
}

func defaultPreviewTitle(target CanonicalLinkTarget) string {
	return fmt.Sprintf("%s %s", target.ResourceType, target.ResourceID)
}

// ChatChannelPreviewProvider returns a preview for chat channel links.
type chatChannelPreviewProvider struct{}

func NewChatChannelPreviewProvider() PreviewProvider { return chatChannelPreviewProvider{} }

func (chatChannelPreviewProvider) Preview(target CanonicalLinkTarget, canonicalURL string) (*LinkPreviewMetadata, bool) {
	if target.ResourceType != ResourceTypeChatChannel {
		return nil, false
	}
	return &LinkPreviewMetadata{
		Title:        fmt.Sprintf("Channel %s", target.ResourceID),
		Subtitle:     "Chat channel",
		ResourceType: target.ResourceType,
		Badge:        "Chat",
		Href:         canonicalURL,
	}, true
}

// ChatThreadPreviewProvider returns a preview for chat thread links.
type chatThreadPreviewProvider struct{}

func NewChatThreadPreviewProvider() PreviewProvider { return chatThreadPreviewProvider{} }

func (chatThreadPreviewProvider) Preview(target CanonicalLinkTarget, canonicalURL string) (*LinkPreviewMetadata, bool) {
	if target.ResourceType != ResourceTypeChatThread {
		return nil, false
	}
	return &LinkPreviewMetadata{
		Title:        "Thread",
		Subtitle:     "Chat thread",
		ResourceType: target.ResourceType,
		Badge:        "Thread",
		Href:         canonicalURL,
	}, true
}

// CalendarEventPreviewProvider returns a preview for calendar event links.
type calendarEventPreviewProvider struct{}

func NewCalendarEventPreviewProvider() PreviewProvider { return calendarEventPreviewProvider{} }

func (calendarEventPreviewProvider) Preview(target CanonicalLinkTarget, canonicalURL string) (*LinkPreviewMetadata, bool) {
	if target.ResourceType != ResourceTypeCalendarEvent {
		return nil, false
	}
	return &LinkPreviewMetadata{
		Title:        fmt.Sprintf("Event %s", target.ResourceID),
		Subtitle:     "Calendar event",
		ResourceType: target.ResourceType,
		Badge:        "Calendar",
		Href:         canonicalURL,
	}, true
}

// ProjectPreviewProvider returns a preview for project links.
type projectPreviewProvider struct{}

func NewProjectPreviewProvider() PreviewProvider { return projectPreviewProvider{} }

func (projectPreviewProvider) Preview(target CanonicalLinkTarget, canonicalURL string) (*LinkPreviewMetadata, bool) {
	if target.ResourceType != ResourceTypeProjectDestination {
		return nil, false
	}
	return &LinkPreviewMetadata{
		Title:        fmt.Sprintf("Project %s", target.ResourceID),
		Subtitle:     "Project",
		ResourceType: target.ResourceType,
		Badge:        "Project",
		Href:         canonicalURL,
	}, true
}

// BookingPreviewProvider returns a preview for booking links.
type bookingPreviewProvider struct{}

func NewBookingPreviewProvider() PreviewProvider { return bookingPreviewProvider{} }

func (bookingPreviewProvider) Preview(target CanonicalLinkTarget, canonicalURL string) (*LinkPreviewMetadata, bool) {
	if target.ResourceType != ResourceTypeBookingItem {
		return nil, false
	}
	return &LinkPreviewMetadata{
		Title:        "Booking",
		Subtitle:     "Schedule a meeting",
		ResourceType: target.ResourceType,
		Badge:        "Booking",
		Href:         canonicalURL,
	}, true
}

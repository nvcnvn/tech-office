package linking

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"path"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/internal/interceptor"
)

type Service struct {
	generator *Generator
	preview   *PreviewAggregator
	queries   *database.Queries
	adminPool database.AdminDatabaseConnector
}

func NewService(
	webappURL string,
	queries *database.Queries,
	adminPool database.AdminDatabaseConnector,
	previewProviders ...PreviewProvider,
) (*Service, error) {
	generator, err := NewGenerator(webappURL)
	if err != nil {
		return nil, err
	}
	return &Service{
		generator: generator,
		preview:   NewPreviewAggregator(previewProviders...),
		queries:   queries,
		adminPool: adminPool,
	}, nil
}

func (s *Service) Generate(target CanonicalLinkTarget) (CanonicalLink, string, error) {
	return s.generator.Generate(target)
}

func (s *Service) Resolve(ctx context.Context, rawURL string, platform Platform, isAuthenticated bool) (*LinkResolutionResult, error) {
	normalized, err := Normalize(rawURL)
	if err != nil {
		return nil, err
	}
	organizationID, err := s.resolveTenantID(ctx, normalized.Target.TenantKey)
	if err != nil {
		return &LinkResolutionResult{
			NormalizedTarget: normalized.Target,
			ResolutionStatus: ResolutionStatusNotFound,
			IgnoredContext:   normalized.IgnoredQueryKeys,
		}, nil
	}
	_, canonicalURL, err := s.generator.Generate(normalized.Target)
	if err != nil {
		return nil, err
	}
	result := &LinkResolutionResult{
		NormalizedTarget: normalized.Target,
		ResolutionStatus: ResolutionStatusOK,
		AppliedContext:   appliedContext(normalized.Target),
		IgnoredContext:   normalized.IgnoredQueryKeys,
		FallbackURL:      canonicalURL,
		LegacyNormalized: normalized.LegacyNormalized,
		Preview:          s.preview.Preview(normalized.Target, canonicalURL),
	}
	result.WebRoute = s.buildWebRoute(ctx, organizationID, normalized.Target)
	result.MobileRoute = s.buildMobileRoute(ctx, organizationID, normalized.Target)
	actor, actorAuthenticated := principalFromContext(ctx)
	if !isAuthenticated && !actorAuthenticated {
		result.ResolutionStatus = ResolutionStatusAuthRequired
		result.RequiresAuthentication = true
		return withPlatformFallback(result, platform), nil
	}
	if actorAuthenticated {
		resourceStatus, err := s.resolveResourceStatus(ctx, organizationID, actor, normalized.Target)
		if err != nil {
			return nil, err
		}
		if resourceStatus != ResolutionStatusOK {
			result.ResolutionStatus = resourceStatus
			return withPlatformFallback(result, platform), nil
		}
	}
	return withPlatformFallback(result, platform), nil
}

type resolutionActor struct {
	EmployeeID     dbuuid.UUID
	OrganizationID dbuuid.UUID
}

func principalFromContext(ctx context.Context) (resolutionActor, bool) {
	userID, ok := interceptor.UserIDFromContext(ctx)
	if !ok || userID == "" {
		return resolutionActor{}, false
	}
	orgID, ok := interceptor.UserOrgIDFromContext(ctx)
	if !ok || orgID == "" {
		return resolutionActor{}, false
	}
	parsedUserID, err := dbuuid.Parse(userID)
	if err != nil {
		return resolutionActor{}, false
	}
	parsedOrgID, err := dbuuid.Parse(orgID)
	if err != nil {
		return resolutionActor{}, false
	}
	return resolutionActor{EmployeeID: parsedUserID, OrganizationID: parsedOrgID}, true
}

func withPlatformFallback(result *LinkResolutionResult, platform Platform) *LinkResolutionResult {
	if platform == PlatformWeb && result.WebRoute == "" {
		result.ResolutionStatus = ResolutionStatusFallback
	}
	if platform == PlatformMobile && result.MobileRoute == "" {
		result.ResolutionStatus = ResolutionStatusFallback
	}
	return result
}

func (s *Service) resolveResourceStatus(ctx context.Context, organizationID dbuuid.UUID, actor resolutionActor, target CanonicalLinkTarget) (ResolutionStatus, error) {
	if actor.OrganizationID != organizationID {
		return ResolutionStatusAccessDenied, nil
	}
	switch target.ResourceType {
	case ResourceTypeTaskInstance:
		return s.resolveTaskStatus(ctx, organizationID, actor, target.ResourceID)
	case ResourceTypeProjectDestination:
		return s.resolveProjectStatus(ctx, organizationID, actor, target.ResourceID)
	case ResourceTypeDocumentPage:
		return s.resolveDocumentStatus(ctx, organizationID, target.ResourceID)
	case ResourceTypeChatChannel:
		return s.resolveChannelStatus(ctx, organizationID, actor, target.ResourceID)
	case ResourceTypeCalendarEvent:
		return s.resolveCalendarEventStatus(ctx, organizationID, target.ResourceID)
	default:
		return ResolutionStatusOK, nil
	}
}

func (s *Service) resolveProjectStatus(ctx context.Context, organizationID dbuuid.UUID, actor resolutionActor, projectID string) (ResolutionStatus, error) {
	if s.queries == nil || s.adminPool == nil {
		return ResolutionStatusOK, nil
	}
	parsedID, err := dbuuid.Parse(projectID)
	if err != nil {
		return ResolutionStatusNotFound, nil
	}
	project, err := s.queries.GetProject(ctx, s.adminPool, &database.GetProjectParams{
		OrganizationID: organizationID,
		ID:             parsedID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ResolutionStatusNotFound, nil
		}
		return ResolutionStatusFallback, nil
	}
	if project.Visibility != "private" || actor.EmployeeID == project.OwnerEmployeeID {
		return ResolutionStatusOK, nil
	}
	_, err = s.queries.GetProjectMembership(ctx, s.adminPool, &database.GetProjectMembershipParams{
		OrganizationID: organizationID,
		ProjectID:      project.ID,
		EmployeeID:     actor.EmployeeID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ResolutionStatusAccessDenied, nil
		}
		return ResolutionStatusFallback, nil
	}
	return ResolutionStatusOK, nil
}

func (s *Service) resolveDocumentStatus(ctx context.Context, organizationID dbuuid.UUID, documentID string) (ResolutionStatus, error) {
	if s.queries == nil || s.adminPool == nil {
		return ResolutionStatusOK, nil
	}
	parsedID, err := dbuuid.Parse(documentID)
	if err != nil {
		return ResolutionStatusNotFound, nil
	}
	_, err = s.queries.GetDocumentByID(ctx, s.adminPool, &database.GetDocumentByIDParams{
		OrganizationID: organizationID,
		ID:             parsedID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ResolutionStatusNotFound, nil
		}
		return ResolutionStatusFallback, nil
	}
	return ResolutionStatusOK, nil
}

func (s *Service) resolveChannelStatus(ctx context.Context, organizationID dbuuid.UUID, actor resolutionActor, channelID string) (ResolutionStatus, error) {
	if s.queries == nil || s.adminPool == nil {
		return ResolutionStatusOK, nil
	}
	parsedID, err := dbuuid.Parse(channelID)
	if err != nil {
		return ResolutionStatusNotFound, nil
	}
	_, err = s.queries.GetChannelByID(ctx, s.adminPool, &database.GetChannelByIDParams{
		ID:             parsedID,
		OrganizationID: organizationID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ResolutionStatusNotFound, nil
		}
		return ResolutionStatusFallback, nil
	}
	_, err = s.queries.GetChannelMembership(ctx, s.adminPool, &database.GetChannelMembershipParams{
		ChannelID:      parsedID,
		EmployeeID:     actor.EmployeeID,
		OrganizationID: organizationID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ResolutionStatusAccessDenied, nil
		}
		return ResolutionStatusFallback, nil
	}
	return ResolutionStatusOK, nil
}

func (s *Service) resolveCalendarEventStatus(ctx context.Context, organizationID dbuuid.UUID, eventID string) (ResolutionStatus, error) {
	if s.queries == nil || s.adminPool == nil {
		return ResolutionStatusOK, nil
	}
	parsedID, err := dbuuid.Parse(eventID)
	if err != nil {
		return ResolutionStatusNotFound, nil
	}
	_, err = s.queries.GetEvent(ctx, s.adminPool, &database.GetEventParams{
		OrganizationID: organizationID,
		ID:             parsedID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ResolutionStatusNotFound, nil
		}
		return ResolutionStatusFallback, nil
	}
	return ResolutionStatusOK, nil
}

func (s *Service) resolveTaskStatus(ctx context.Context, organizationID dbuuid.UUID, actor resolutionActor, taskID string) (ResolutionStatus, error) {
	if s.queries == nil || s.adminPool == nil {
		return ResolutionStatusOK, nil
	}
	parsedTaskID, err := dbuuid.Parse(taskID)
	if err != nil {
		return ResolutionStatusNotFound, nil
	}
	task, err := s.queries.GetTask(ctx, s.adminPool, &database.GetTaskParams{
		OrganizationID: organizationID,
		ID:             parsedTaskID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ResolutionStatusNotFound, nil
		}
		return ResolutionStatusFallback, nil
	}
	project, err := s.queries.GetProject(ctx, s.adminPool, &database.GetProjectParams{
		OrganizationID: organizationID,
		ID:             task.ProjectID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ResolutionStatusNotFound, nil
		}
		return ResolutionStatusFallback, nil
	}
	if project.Visibility != "private" || actor.EmployeeID == project.OwnerEmployeeID {
		return ResolutionStatusOK, nil
	}
	_, err = s.queries.GetProjectMembership(ctx, s.adminPool, &database.GetProjectMembershipParams{
		OrganizationID: organizationID,
		ProjectID:      project.ID,
		EmployeeID:     actor.EmployeeID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ResolutionStatusAccessDenied, nil
		}
		return ResolutionStatusFallback, nil
	}
	return ResolutionStatusOK, nil
}

func appliedContext(target CanonicalLinkTarget) []string {
	items := make([]string, 0, 5)
	if target.FocusIntent != "" {
		items = append(items, "focusIntent")
	}
	if target.EntryContext != "" {
		items = append(items, "entryContext")
	}
	if target.RequirementID != "" {
		items = append(items, "requirementId")
	}
	if target.AnchorType != "" {
		items = append(items, "anchorType")
	}
	if target.AnchorID != "" {
		items = append(items, "anchorId")
	}
	return items
}

func (s *Service) buildWebRoute(ctx context.Context, organizationID dbuuid.UUID, target CanonicalLinkTarget) string {
	base := "/workspace"
	switch target.ResourceType {
	case ResourceTypeTaskInstance:
		projectID, ok := s.lookupTaskProjectID(ctx, organizationID, target.ResourceID)
		if !ok {
			return withCanonicalContext(path.Join(base, "tasks"), target)
		}
		return withCanonicalContext(path.Join(base, "projects", projectID, "tasks", target.ResourceID), target)
	case ResourceTypeProjectDestination:
		return path.Join(base, "projects", target.ResourceID)
	case ResourceTypeDocumentPage:
		return path.Join(base, "docs", target.ResourceID)
	case ResourceTypeChatChannel:
		return withCanonicalContext(path.Join(base, "chat"), target)
	case ResourceTypeCalendarEvent:
		return path.Join(base, "calendar", target.ResourceID)
	case ResourceTypeWorkspace:
		return base
	default:
		return ""
	}
}

func (s *Service) buildMobileRoute(ctx context.Context, organizationID dbuuid.UUID, target CanonicalLinkTarget) string {
	switch target.ResourceType {
	case ResourceTypeTaskInstance:
		projectID, ok := s.lookupTaskProjectID(ctx, organizationID, target.ResourceID)
		if !ok {
			return withCanonicalContext("/(app)/(tasks)", target)
		}
		return withCanonicalContext(path.Join("/(app)/(tasks)", projectID, target.ResourceID), target)
	case ResourceTypeProjectDestination:
		return path.Join("/(app)/(tasks)", target.ResourceID)
	case ResourceTypeDocumentPage:
		return path.Join("/(app)/(more)/docs", target.ResourceID)
	case ResourceTypeChatChannel:
		return path.Join("/(app)/(chat)", target.ResourceID)
	case ResourceTypeChatThread:
		return path.Join("/(app)/(chat)/thread", target.ResourceID)
	case ResourceTypeCalendarEvent:
		return path.Join("/(app)/(calendar)", target.ResourceID)
	case ResourceTypeWorkspace:
		return "/(app)"
	default:
		return ""
	}
}

func (s *Service) lookupTaskProjectID(ctx context.Context, organizationID dbuuid.UUID, taskID string) (string, bool) {
	if s.queries == nil || s.adminPool == nil {
		return "", false
	}
	parsedTaskID, err := dbuuid.Parse(taskID)
	if err != nil {
		return "", false
	}
	task, err := s.queries.GetTask(ctx, s.adminPool, &database.GetTaskParams{
		OrganizationID: organizationID,
		ID:             parsedTaskID,
	})
	if err != nil {
		return "", false
	}
	return task.ProjectID.String(), true
}

func (s *Service) resolveTenantID(ctx context.Context, tenantKey string) (dbuuid.UUID, error) {
	if s.queries == nil || s.adminPool == nil {
		return dbuuid.UUID{}, nil
	}
	organization, err := s.queries.GetOrganizationBySubdomain(ctx, s.adminPool, tenantKey)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return dbuuid.UUID{}, fmt.Errorf("tenant not found")
		}
		return dbuuid.UUID{}, err
	}
	return organization.ID, nil
}

func withCanonicalContext(base string, target CanonicalLinkTarget) string {
	params := url.Values{}
	if target.FocusIntent != "" {
		params.Set("focusIntent", target.FocusIntent)
	}
	if target.EntryContext != "" {
		params.Set("entryContext", target.EntryContext)
	}
	if target.RequirementID != "" {
		params.Set("requirementId", target.RequirementID)
	}
	if target.AnchorType != "" {
		params.Set("anchorType", string(target.AnchorType))
	}
	if target.AnchorID != "" {
		params.Set("anchorId", target.AnchorID)
	}
	if len(params) == 0 {
		return base
	}
	return fmt.Sprintf("%s?%s", strings.TrimSuffix(base, "/"), stableEncode(params))
}

package integration

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/url"
	"path"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/require"

	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/internal/linking"
)

type canonicalGenerateResponse struct {
	CanonicalURL     string                      `json:"canonicalUrl"`
	NormalizedTarget linking.CanonicalLinkTarget `json:"normalizedTarget"`
}

type canonicalResolveResponse struct {
	Status           linking.ResolutionStatus    `json:"status"`
	NormalizedTarget linking.CanonicalLinkTarget `json:"normalizedTarget"`
	WebRoute         string                      `json:"webRoute"`
	MobileRoute      string                      `json:"mobileRoute"`
	RequiresAuth     bool                        `json:"requiresAuthentication"`
	AppliedContext   []string                    `json:"appliedContext"`
	IgnoredContext   []string                    `json:"ignoredContext"`
	FallbackURL      string                      `json:"fallbackUrl"`
}

type canonicalPreviewResponse struct {
	Preview struct {
		Title        string               `json:"title"`
		Subtitle     string               `json:"subtitle"`
		ResourceType linking.ResourceType `json:"resourceType"`
		Href         string               `json:"href"`
	} `json:"preview"`
	NormalizedTarget linking.CanonicalLinkTarget `json:"normalizedTarget"`
	Status           linking.ResolutionStatus    `json:"status"`
	FallbackURL      string                      `json:"fallbackUrl"`
}

func postCanonicalGenerate(t *testing.T, target linking.CanonicalLinkTarget) canonicalGenerateResponse {
	t.Helper()
	body, err := json.Marshal(map[string]any{"target": target})
	require.NoError(t, err)

	resp, err := http.Post(serverBaseURL+"/api/linking/generate", "application/json", bytes.NewReader(body))
	require.NoError(t, err)
	defer resp.Body.Close()
	require.Equal(t, http.StatusOK, resp.StatusCode)

	var payload canonicalGenerateResponse
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&payload))
	return payload
}

func postCanonicalResolve(t *testing.T, rawURL string, platform linking.Platform, isAuthenticated bool) canonicalResolveResponse {
	t.Helper()
	return postCanonicalResolveWithToken(t, rawURL, platform, isAuthenticated, "")
}

func postCanonicalResolveWithToken(t *testing.T, rawURL string, platform linking.Platform, isAuthenticated bool, bearerToken string) canonicalResolveResponse {
	t.Helper()
	body, err := json.Marshal(map[string]any{
		"url":             rawURL,
		"platform":        platform,
		"isAuthenticated": isAuthenticated,
	})
	require.NoError(t, err)

	req, err := http.NewRequest(http.MethodPost, serverBaseURL+"/api/linking/resolve", bytes.NewReader(body))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	if bearerToken != "" {
		req.Header.Set("Authorization", "Bearer "+bearerToken)
	}

	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()
	require.Equal(t, http.StatusOK, resp.StatusCode)

	var payload canonicalResolveResponse
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&payload))
	return payload
}

func getCanonicalPreview(t *testing.T, rawURL string, bearerToken string) (int, canonicalPreviewResponse) {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, serverBaseURL+"/api/linking/preview?url="+url.QueryEscape(rawURL), nil)
	require.NoError(t, err)
	if bearerToken != "" {
		req.Header.Set("Authorization", "Bearer "+bearerToken)
	}

	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()

	var payload canonicalPreviewResponse
	if resp.StatusCode == http.StatusOK {
		require.NoError(t, json.NewDecoder(resp.Body).Decode(&payload))
	}
	return resp.StatusCode, payload
}

func containsString(items []string, expected string) bool {
	for _, item := range items {
		if item == expected {
			return true
		}
	}
	return false
}

func deleteTask(t *testing.T, w *testWorld, actor testUser, taskID string) {
	t.Helper()
	parsedTaskID, err := dbuuid.Parse(taskID)
	require.NoError(t, err)
	err = globalQ.SoftDeleteTask(t.Context(), globalDB, &database.SoftDeleteTaskParams{
		OrganizationID: actor.OrgID,
		ID:             parsedTaskID,
		UpdatedAt:      pgtype.Timestamptz{Time: time.Now(), Valid: true},
	})
	require.NoError(t, err)
}

func TestCanonicalLinks(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	owner := w.withOwner()
	tenantKey := w.orgSubdomain()
	project := w.createProject(owner, "Canonical Project", "CAN")
	task := w.createTask(owner, project.ID, "Canonical Task", project.Levels[0].Id)
	requirementID := dbuuid.Must().String()

	// FR-001 FR-002 FR-003 FR-006 FR-008 FR-009
	t.Run("when a canonical link is generated for each supported resource type", func(t *testing.T) {
		targets := []linking.CanonicalLinkTarget{
			{TenantKey: tenantKey, ResourceType: linking.ResourceTypeTaskInstance, ResourceID: task.Id, FocusIntent: "review_pending", RequirementID: requirementID},
			{TenantKey: tenantKey, ResourceType: linking.ResourceTypeChatChannel, ResourceID: dbuuid.Must().String()},
			{TenantKey: tenantKey, ResourceType: linking.ResourceTypeChatThread, ResourceID: dbuuid.Must().String()},
			{TenantKey: tenantKey, ResourceType: linking.ResourceTypeChatMessageAnchor, ResourceID: dbuuid.Must().String()},
			{TenantKey: tenantKey, ResourceType: linking.ResourceTypeProjectDestination, ResourceID: project.ID},
			{TenantKey: tenantKey, ResourceType: linking.ResourceTypeWorkspace, ResourceID: tenantKey},
			{TenantKey: tenantKey, ResourceType: linking.ResourceTypeDocumentPage, ResourceID: dbuuid.Must().String()},
			{TenantKey: tenantKey, ResourceType: linking.ResourceTypeCalendarEvent, ResourceID: dbuuid.Must().String()},
			{TenantKey: tenantKey, ResourceType: linking.ResourceTypeBookingItem, ResourceID: dbuuid.Must().String()},
		}

		t.Run("it returns a single HTTPS link on the canonical host", func(t *testing.T) {
			for _, target := range targets {
				payload := postCanonicalGenerate(t, target)
				parsed, err := url.Parse(payload.CanonicalURL)
				require.NoError(t, err)
				require.NotEmpty(t, parsed.Scheme)
				require.NotEmpty(t, parsed.Host)
				require.Equal(t, path.Join("/o", tenantKey, "r", string(target.ResourceType), target.ResourceID), parsed.Path)
			}
		})
		t.Run("it encodes only stable identity and supported context", func(t *testing.T) {
			payload := postCanonicalGenerate(t, targets[0])
			parsed, err := url.Parse(payload.CanonicalURL)
			require.NoError(t, err)
			require.Equal(t, "review_pending", parsed.Query().Get("focusIntent"))
			require.Equal(t, requirementID, parsed.Query().Get("requirementId"))
			require.Empty(t, parsed.Query().Get("canonicalVersion"))
			require.Equal(t, targets[0].TenantKey, payload.NormalizedTarget.TenantKey)
			require.Equal(t, targets[0].ResourceType, payload.NormalizedTarget.ResourceType)
			require.Equal(t, targets[0].ResourceID, payload.NormalizedTarget.ResourceID)
		})
		t.Run("it preserves the same canonical target meaning for web and mobile", func(t *testing.T) {
			for _, target := range targets {
				payload := postCanonicalGenerate(t, target)
				web := postCanonicalResolve(t, payload.CanonicalURL, linking.PlatformWeb, true)
				mobile := postCanonicalResolve(t, payload.CanonicalURL, linking.PlatformMobile, true)
				require.Equal(t, target.TenantKey, web.NormalizedTarget.TenantKey)
				require.Equal(t, target.ResourceType, web.NormalizedTarget.ResourceType)
				require.Equal(t, target.ResourceID, web.NormalizedTarget.ResourceID)
				require.Equal(t, web.NormalizedTarget, mobile.NormalizedTarget)
			}
		})
	})

	// FR-010 FR-011
	t.Run("when a task link includes supported focus context", func(t *testing.T) {
		generated := postCanonicalGenerate(t, linking.CanonicalLinkTarget{
			TenantKey:     tenantKey,
			ResourceType:  linking.ResourceTypeTaskInstance,
			ResourceID:    task.Id,
			FocusIntent:   "review_pending",
			RequirementID: requirementID,
		})

		t.Run("it resolves to the correct task instance", func(t *testing.T) {
			resolved := postCanonicalResolve(t, generated.CanonicalURL, linking.PlatformWeb, true)
			require.Equal(t, linking.ResolutionStatusOK, resolved.Status)
			require.Equal(t, task.Id, resolved.NormalizedTarget.ResourceID)
			require.Equal(t, "/workspace/projects/"+project.ID+"/tasks/"+task.Id+"?focusIntent=review_pending&requirementId="+requirementID, resolved.WebRoute)
			require.Equal(t, "/(app)/(tasks)/"+project.ID+"/"+task.Id+"?focusIntent=review_pending&requirementId="+requirementID, resolved.MobileRoute)
		})
		t.Run("it returns the supported context as applied when the client can honor it", func(t *testing.T) {
			resolved := postCanonicalResolve(t, generated.CanonicalURL, linking.PlatformMobile, true)
			require.True(t, containsString(resolved.AppliedContext, "focusIntent"))
			require.True(t, containsString(resolved.AppliedContext, "requirementId"))
			require.Empty(t, resolved.IgnoredContext)
		})
		t.Run("it keeps the task destination even when some context is ignored", func(t *testing.T) {
			parsed, err := url.Parse(generated.CanonicalURL)
			require.NoError(t, err)
			parsed.RawQuery += "&debugToken=ignored"

			resolved := postCanonicalResolve(t, parsed.String(), linking.PlatformWeb, true)
			require.Equal(t, linking.ResolutionStatusOK, resolved.Status)
			require.Equal(t, "/workspace/projects/"+project.ID+"/tasks/"+task.Id+"?focusIntent=review_pending&requirementId="+requirementID, resolved.WebRoute)
			require.True(t, containsString(resolved.IgnoredContext, "debugToken"))
		})
	})

	// FR-020 FR-021 FR-022 FR-023
	t.Run("when a canonical link is opened under auth and access edge cases", func(t *testing.T) {
		privateProject := w.createPrivateProject(owner, "Canonical Private Project", "CPR")
		privateTask := w.createTask(owner, privateProject.ID, "Private Canonical Task", privateProject.Levels[0].Id)
		outsider := w.withEmployee()

		t.Run("it returns auth required for signed-out users", func(t *testing.T) {
			generated := postCanonicalGenerate(t, linking.CanonicalLinkTarget{
				TenantKey:    tenantKey,
				ResourceType: linking.ResourceTypeTaskInstance,
				ResourceID:   task.Id,
			})

			resolved := postCanonicalResolve(t, generated.CanonicalURL, linking.PlatformWeb, false)
			require.Equal(t, linking.ResolutionStatusAuthRequired, resolved.Status)
			require.True(t, resolved.RequiresAuth)
			require.Equal(t, "/workspace/projects/"+project.ID+"/tasks/"+task.Id, resolved.WebRoute)
		})
		t.Run("it returns access denied for unauthorized users", func(t *testing.T) {
			generated := postCanonicalGenerate(t, linking.CanonicalLinkTarget{
				TenantKey:    tenantKey,
				ResourceType: linking.ResourceTypeTaskInstance,
				ResourceID:   privateTask.Id,
			})

			resolved := postCanonicalResolveWithToken(t, generated.CanonicalURL, linking.PlatformWeb, false, outsider.Token)
			require.Equal(t, linking.ResolutionStatusAccessDenied, resolved.Status)
			require.Equal(t, "/workspace/projects/"+privateProject.ID+"/tasks/"+privateTask.Id, resolved.WebRoute)
		})
		t.Run("it returns not found for deleted resources", func(t *testing.T) {
			deletedTask := w.createTask(owner, project.ID, "Deleted Canonical Task", project.Levels[0].Id)
			generated := postCanonicalGenerate(t, linking.CanonicalLinkTarget{
				TenantKey:    tenantKey,
				ResourceType: linking.ResourceTypeTaskInstance,
				ResourceID:   deletedTask.Id,
			})
			deleteTask(t, w, owner, deletedTask.Id)

			resolved := postCanonicalResolveWithToken(t, generated.CanonicalURL, linking.PlatformWeb, false, owner.Token)
			require.Equal(t, linking.ResolutionStatusNotFound, resolved.Status)
			require.Equal(t, generated.CanonicalURL, resolved.FallbackURL)
		})
		t.Run("it never returns a blank or ambiguous outcome", func(t *testing.T) {
			generated := postCanonicalGenerate(t, linking.CanonicalLinkTarget{
				TenantKey:    tenantKey,
				ResourceType: linking.ResourceTypeChatThread,
				ResourceID:   dbuuid.Must().String(),
			})

			fallback := postCanonicalResolveWithToken(t, generated.CanonicalURL, linking.PlatformWeb, false, owner.Token)
			require.Equal(t, linking.ResolutionStatusFallback, fallback.Status)
			require.NotEmpty(t, fallback.FallbackURL)
		})
	})

	// FR-024 FR-025 FR-028
	t.Run("when a legacy product link is normalized", func(t *testing.T) {
		t.Run("it resolves to the current canonical target when the mapping is supported", func(t *testing.T) {
			t.Skip("TODO: implement after scenario review")
		})
		t.Run("it degrades to a recoverable fallback when full normalization is unavailable", func(t *testing.T) {
			t.Skip("TODO: implement after scenario review")
		})
	})

	// FR-016 FR-017 FR-018
	t.Run("when preview metadata is requested for an internal canonical link", func(t *testing.T) {
		t.Run("it returns preview metadata when the target is available", func(t *testing.T) {
			generated := postCanonicalGenerate(t, linking.CanonicalLinkTarget{
				TenantKey:    tenantKey,
				ResourceType: linking.ResourceTypeTaskInstance,
				ResourceID:   task.Id,
			})

			statusCode, preview := getCanonicalPreview(t, generated.CanonicalURL, owner.Token)
			require.Equal(t, http.StatusOK, statusCode)
			require.Equal(t, linking.ResolutionStatusOK, preview.Status)
			require.Equal(t, generated.CanonicalURL, preview.Preview.Href)
			require.Equal(t, linking.ResourceTypeTaskInstance, preview.Preview.ResourceType)
			require.Contains(t, preview.Preview.Title, task.Id)
			require.Equal(t, task.Id, preview.NormalizedTarget.ResourceID)
		})
		t.Run("it allows raw-link rendering when metadata lookup fails", func(t *testing.T) {
			deletedTask := w.createTask(owner, project.ID, "Deleted Preview Task", project.Levels[0].Id)
			generated := postCanonicalGenerate(t, linking.CanonicalLinkTarget{
				TenantKey:    tenantKey,
				ResourceType: linking.ResourceTypeTaskInstance,
				ResourceID:   deletedTask.Id,
			})
			deleteTask(t, w, owner, deletedTask.Id)

			statusCode, _ := getCanonicalPreview(t, generated.CanonicalURL, owner.Token)
			require.Equal(t, http.StatusNotFound, statusCode)
		})
	})
}

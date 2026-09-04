package linking

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/nvcnvn/tech-office/backend/internal/interceptor"
)

type ResolveRequest struct {
	URL             string   `json:"url"`
	Platform        Platform `json:"platform"`
	IsAuthenticated bool     `json:"isAuthenticated"`
}

// PreviewsRequest is the batch preview request body. The bound is enforced rather than
// truncated: the clients hold the same constant, so exceeding it is a client bug.
type PreviewsRequest struct {
	URLs []string `json:"urls"`
}

type PreviewsResponse struct {
	Items []PreviewItem `json:"items"`
}

type GenerateRequest struct {
	Target CanonicalLinkTarget `json:"target"`
}

type ConnectHandler struct {
	service *Service
	auth    *interceptor.AuthInterceptor
}

func NewConnectHandler(service *Service, auth *interceptor.AuthInterceptor) *ConnectHandler {
	return &ConnectHandler{service: service, auth: auth}
}

func (h *ConnectHandler) Register(mux *http.ServeMux) {
	mux.HandleFunc("/api/linking/generate", h.handleGenerate)
	mux.HandleFunc("/api/linking/resolve", h.handleResolve)
	mux.HandleFunc("/api/linking/previews", h.handlePreviews)
}

func (h *ConnectHandler) handleGenerate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req GenerateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.writeError(w, http.StatusBadRequest, err)
		return
	}
	link, canonicalURL, err := h.service.Generate(req.Target)
	if err != nil {
		h.writeError(w, http.StatusBadRequest, err)
		return
	}
	h.writeJSON(w, map[string]any{
		"canonicalUrl":     canonicalURL,
		"normalizedTarget": link.Target,
	})
}

func (h *ConnectHandler) handleResolve(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req ResolveRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.writeError(w, http.StatusBadRequest, err)
		return
	}
	if req.IsAuthenticated == false {
		ctx := h.authenticateContext(r)
		r = r.WithContext(ctx)
		_, ok := interceptor.UserIDFromContext(r.Context())
		if ok {
			req.IsAuthenticated = true
		}
	}
	result, err := h.service.Resolve(r.Context(), req.URL, req.Platform, req.IsAuthenticated)
	if err != nil {
		status := http.StatusBadRequest
		if strings.Contains(err.Error(), "unsupported") {
			status = http.StatusNotFound
		}
		h.writeError(w, status, err)
		return
	}
	h.writeJSON(w, result)
}

// handlePreviews answers a page of canonical links in one request. It is always a 200
// unless the request itself is malformed: a link the reader may not see, one that does not
// exist and one that was never previewable are the same "unavailable" answer, which is
// what stops the endpoint being a disclosure oracle (FR-010).
func (h *ConnectHandler) handlePreviews(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	// 1. Decode and bound.
	var req PreviewsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.writeError(w, http.StatusBadRequest, err)
		return
	}
	if len(req.URLs) == 0 {
		h.writeError(w, http.StatusBadRequest, errors.New("urls is required"))
		return
	}
	if len(req.URLs) > MaxPreviewURLsPerRequest {
		h.writeError(w, http.StatusBadRequest, errors.New("too many urls"))
		return
	}

	// 2. Authenticate, from the Authorization header only. Unlike resolve, a preview is
	// never the landing of a navigation, so there is no EventSource-style ?token= fallback
	// to support. Without a principal every item is unavailable and no row is read — a
	// signed-out reader must not be able to tell "you are signed out" from "you may not
	// see this", and must not cost the database anything either.
	ctx := r.Context()
	if r.Header.Get("Authorization") != "" {
		ctx = h.authenticateContext(r)
	}
	actor, ok := principalFromContext(ctx)
	if !ok {
		h.writeJSON(w, PreviewsResponse{Items: unavailableItems(req.URLs)})
		return
	}

	// 3-7. Normalise, tenant-scope and resolve, in request order.
	items := h.service.PreviewBatch(ctx, PreviewReader{
		EmployeeID:     actor.EmployeeID,
		OrganizationID: actor.OrganizationID,
	}, req.URLs)
	h.writeJSON(w, PreviewsResponse{Items: items})
}

func unavailableItems(urls []string) []PreviewItem {
	items := make([]PreviewItem, len(urls))
	for i, raw := range urls {
		items[i] = PreviewItem{URL: raw, Status: PreviewStatusUnavailable}
	}
	return items
}

func (h *ConnectHandler) authenticateContext(r *http.Request) context.Context {
	ctx := r.Context()
	if h.auth == nil {
		return ctx
	}
	if r.Header.Get("Authorization") == "" && strings.TrimSpace(r.URL.Query().Get("token")) == "" {
		return ctx
	}
	authCtx, err := h.auth.AuthenticateHTTPRequest(ctx, r, nil)
	if err != nil {
		if errors.Is(err, interceptor.ErrAuthTokenRequired) {
			return ctx
		}
		return ctx
	}
	return authCtx
}

func (h *ConnectHandler) writeJSON(w http.ResponseWriter, payload any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(payload)
}

func (h *ConnectHandler) writeError(w http.ResponseWriter, status int, err error) {
	w.WriteHeader(status)
	h.writeJSON(w, map[string]string{"error": err.Error()})
}

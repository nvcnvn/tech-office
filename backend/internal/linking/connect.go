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

type PreviewResponse struct {
	Preview          *LinkPreviewMetadata `json:"preview,omitempty"`
	NormalizedTarget CanonicalLinkTarget  `json:"normalizedTarget"`
	Status           ResolutionStatus     `json:"status"`
	FallbackURL      string               `json:"fallbackUrl,omitempty"`
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
	mux.HandleFunc("/api/linking/preview", h.handlePreview)
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

func (h *ConnectHandler) handlePreview(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	ctx := h.authenticateContext(r)
	result, err := h.service.Resolve(ctx, r.URL.Query().Get("url"), PlatformWeb, false)
	if err != nil {
		h.writeError(w, http.StatusBadRequest, err)
		return
	}
	switch result.ResolutionStatus {
	case ResolutionStatusOK:
		h.writeJSON(w, PreviewResponse{
			Preview:          result.Preview,
			NormalizedTarget: result.NormalizedTarget,
			Status:           result.ResolutionStatus,
			FallbackURL:      result.FallbackURL,
		})
	case ResolutionStatusAuthRequired:
		h.writeError(w, http.StatusUnauthorized, errors.New("authentication required for preview"))
	case ResolutionStatusAccessDenied:
		h.writeError(w, http.StatusForbidden, errors.New("access denied"))
	case ResolutionStatusNotFound:
		h.writeError(w, http.StatusNotFound, errors.New("resource not found"))
	default:
		h.writeError(w, http.StatusBadGateway, errors.New("preview unavailable"))
	}
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

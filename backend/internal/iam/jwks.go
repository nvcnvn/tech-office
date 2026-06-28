package iam

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/lestrrat-go/jwx/v3/jwk"
	"github.com/lestrrat-go/jwx/v3/jwt"
)

// SSOClaims holds the extracted claims from an SSO provider JWT.
type SSOClaims struct {
	Subject        string // Provider user ID (sub claim)
	Email          string
	Name           string
	ProfilePicture string
}

// JWKSVerifier verifies SSO provider JWTs using JWKS endpoints.
type JWKSVerifier struct {
	google          *jwksPool
	apple           *jwksPool
	googleAudiences []string // allowed values for the `aud` claim in Google tokens
	appleAudiences  []string // allowed values for the `aud` claim in Apple tokens
}

type jwksPool struct {
	url      string
	mu       sync.RWMutex
	set      jwk.Set
	client   *http.Client
	lastSync time.Time
	ttl      time.Duration
}

const (
	googleJWKSURL = "https://www.googleapis.com/oauth2/v3/certs"
	appleJWKSURL  = "https://appleid.apple.com/auth/keys"
	jwksCacheTTL  = 1 * time.Hour
)

// NewJWKSVerifier creates a new JWKS verifier with caching for Google and Apple.
// googleClientIDs and appleClientIDs are the expected audience values for each provider.
// Pass nil/empty slices to skip audience validation (dev-only — not recommended for production).
func NewJWKSVerifier(ctx context.Context, googleClientIDs, appleClientIDs []string) (*JWKSVerifier, error) {
	google := &jwksPool{
		url:    googleJWKSURL,
		client: &http.Client{Timeout: 10 * time.Second},
		ttl:    jwksCacheTTL,
	}
	if err := google.refresh(ctx); err != nil {
		return nil, fmt.Errorf("failed to fetch Google JWKS: %w", err)
	}

	apple := &jwksPool{
		url:    appleJWKSURL,
		client: &http.Client{Timeout: 10 * time.Second},
		ttl:    jwksCacheTTL,
	}
	if err := apple.refresh(ctx); err != nil {
		return nil, fmt.Errorf("failed to fetch Apple JWKS: %w", err)
	}

	return &JWKSVerifier{
		google:          google,
		apple:           apple,
		googleAudiences: googleClientIDs,
		appleAudiences:  appleClientIDs,
	}, nil
}

func (p *jwksPool) refresh(ctx context.Context) error {
	set, err := jwk.Fetch(ctx, p.url, jwk.WithHTTPClient(p.client))
	if err != nil {
		return err
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	p.set = set
	p.lastSync = time.Now()
	return nil
}

func (p *jwksPool) get(ctx context.Context) (jwk.Set, error) {
	p.mu.RLock()
	needsRefresh := time.Since(p.lastSync) > p.ttl
	p.mu.RUnlock()

	if needsRefresh {
		if err := p.refresh(ctx); err != nil {
			slog.WarnContext(ctx, "JWKS refresh failed, using cached", "error", err, "url", p.url)
		}
	}

	p.mu.RLock()
	defer p.mu.RUnlock()
	if p.set == nil {
		return nil, fmt.Errorf("no JWKS available for %s", p.url)
	}
	return p.set, nil
}

// VerifyGoogleToken verifies a Google ID token and extracts claims.
func (v *JWKSVerifier) VerifyGoogleToken(ctx context.Context, idToken string) (*SSOClaims, error) {
	keySet, err := v.google.get(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch Google JWKS: %w", err)
	}

	token, err := jwt.Parse([]byte(idToken),
		jwt.WithKeySet(keySet),
		jwt.WithValidate(true),
	)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidSSOToken, err)
	}

	if len(v.googleAudiences) > 0 {
		var aud []string
		if err := token.Get("aud", &aud); err != nil || !hasAnyAudience(aud, v.googleAudiences) {
			return nil, fmt.Errorf("%w: google token audience not allowed", ErrInvalidSSOToken)
		}
	}

	return extractSSOClaims(token)
}

// VerifyAppleToken verifies an Apple ID token and extracts claims.
func (v *JWKSVerifier) VerifyAppleToken(ctx context.Context, idToken string) (*SSOClaims, error) {
	keySet, err := v.apple.get(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch Apple JWKS: %w", err)
	}

	token, err := jwt.Parse([]byte(idToken),
		jwt.WithKeySet(keySet),
		jwt.WithValidate(true),
	)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidSSOToken, err)
	}

	if len(v.appleAudiences) > 0 {
		var aud []string
		if err := token.Get("aud", &aud); err != nil || !hasAnyAudience(aud, v.appleAudiences) {
			return nil, fmt.Errorf("%w: apple token audience not allowed", ErrInvalidSSOToken)
		}
	}

	return extractSSOClaims(token)
}

// hasAnyAudience reports whether any element of allowed appears in tokenAud.
func hasAnyAudience(tokenAud, allowed []string) bool {
	for _, a := range allowed {
		for _, ta := range tokenAud {
			if a == ta {
				return true
			}
		}
	}
	return false
}

// VerifyProviderToken dispatches to the appropriate provider verifier.
func (v *JWKSVerifier) VerifyProviderToken(ctx context.Context, provider, idToken string) (*SSOClaims, error) {
	switch provider {
	case SSOProviderGoogle:
		return v.VerifyGoogleToken(ctx, idToken)
	case SSOProviderApple:
		return v.VerifyAppleToken(ctx, idToken)
	default:
		return nil, fmt.Errorf("unsupported SSO provider: %s", provider)
	}
}

func extractSSOClaims(token jwt.Token) (*SSOClaims, error) {
	sub, ok := token.Subject()
	if !ok || sub == "" {
		return nil, fmt.Errorf("%w: missing subject claim", ErrInvalidSSOToken)
	}

	claims := &SSOClaims{Subject: sub}

	var email string
	if err := token.Get("email", &email); err == nil && email != "" {
		claims.Email = email
	}
	if claims.Email == "" {
		return nil, fmt.Errorf("%w: missing email claim", ErrInvalidSSOToken)
	}

	var name string
	if err := token.Get("name", &name); err == nil {
		claims.Name = name
	}

	var picture string
	if err := token.Get("picture", &picture); err == nil {
		claims.ProfilePicture = picture
	}

	return claims, nil
}

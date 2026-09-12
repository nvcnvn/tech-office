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
	google *jwksPool
	apple  *jwksPool
	// An empty audience slice means the provider is disabled, and its pool is nil.
	googleAudiences []string // accepted values for the `aud` claim in Google tokens
	appleAudiences  []string // accepted values for the `aud` claim in Apple tokens
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
//
// googleClientIDs and appleClientIDs are the accepted audience values for each provider,
// and an empty slice means the provider is **disabled**: its JWKS endpoint is not
// fetched, and every verification for it is refused. That is not only a startup saving —
// this constructor aborts startup when a JWKS endpoint is unreachable, so before this an
// air-gapped deployment using neither provider could not boot at all.
func NewJWKSVerifier(ctx context.Context, googleClientIDs, appleClientIDs []string) (*JWKSVerifier, error) {
	v := &JWKSVerifier{
		googleAudiences: googleClientIDs,
		appleAudiences:  appleClientIDs,
	}

	if len(googleClientIDs) > 0 {
		google := &jwksPool{
			url:    googleJWKSURL,
			client: &http.Client{Timeout: 10 * time.Second},
			ttl:    jwksCacheTTL,
		}
		if err := google.refresh(ctx); err != nil {
			return nil, fmt.Errorf("failed to fetch Google JWKS: %w", err)
		}
		v.google = google
	}

	if len(appleClientIDs) > 0 {
		apple := &jwksPool{
			url:    appleJWKSURL,
			client: &http.Client{Timeout: 10 * time.Second},
			ttl:    jwksCacheTTL,
		}
		if err := apple.refresh(ctx); err != nil {
			return nil, fmt.Errorf("failed to fetch Apple JWKS: %w", err)
		}
		v.apple = apple
	}

	return v, nil
}

// EnabledProviders returns the providers this deployment accepts tokens for, Google
// before Apple, for the startup log line that tells an operator which sign-in methods
// exist without grepping for an absence (FR-027).
func (v *JWKSVerifier) EnabledProviders() []string {
	var enabled []string
	if len(v.googleAudiences) > 0 {
		enabled = append(enabled, SSOProviderGoogle)
	}
	if len(v.appleAudiences) > 0 {
		enabled = append(enabled, SSOProviderApple)
	}
	return enabled
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

// verifyToken verifies an ID token against one provider's keys and audience list.
//
// The audience comparison is unconditional: a provider that reaches this point has a
// non-empty audience list, because an empty one means disabled and is refused above.
// There is no configuration in which a token is accepted without its audience being
// checked (FR-025).
func (v *JWKSVerifier) verifyToken(ctx context.Context, provider string, pool *jwksPool, audiences []string, idToken string) (*SSOClaims, error) {
	if len(audiences) == 0 || pool == nil {
		return nil, &ssoProviderNotEnabledError{provider: provider}
	}

	keySet, err := pool.get(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch %s JWKS: %w", provider, err)
	}

	token, err := jwt.Parse([]byte(idToken),
		jwt.WithKeySet(keySet),
		jwt.WithValidate(true),
	)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidSSOToken, err)
	}

	var aud []string
	if err := token.Get("aud", &aud); err != nil || !hasAnyAudience(aud, audiences) {
		return nil, fmt.Errorf("%w: %s token audience not allowed", ErrInvalidSSOToken, provider)
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

// VerifyProviderToken verifies an ID token for one provider and extracts its claims.
//
// This is the single place the "is this provider enabled here" decision is made, so
// every call site — ExchangeToken, LinkSSOIdentity, and the SSO path of
// AcceptInvitation — gets it without an edit, and a call site added later cannot miss it.
func (v *JWKSVerifier) VerifyProviderToken(ctx context.Context, provider, idToken string) (*SSOClaims, error) {
	switch provider {
	case SSOProviderGoogle:
		return v.verifyToken(ctx, SSOProviderGoogle, v.google, v.googleAudiences, idToken)
	case SSOProviderApple:
		return v.verifyToken(ctx, SSOProviderApple, v.apple, v.appleAudiences, idToken)
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

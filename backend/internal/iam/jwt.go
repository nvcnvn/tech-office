package iam

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/lestrrat-go/jwx/v3/jwa"
	"github.com/lestrrat-go/jwx/v3/jwk"
	"github.com/lestrrat-go/jwx/v3/jws"
	jwxjwt "github.com/lestrrat-go/jwx/v3/jwt"

	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
)

const jwtIssuer = "tech-office"

// InternalJWTSigner signs internal JWTs with RSA private key.
type InternalJWTSigner struct {
	privateKey *rsa.PrivateKey
	publicKey  *rsa.PublicKey
}

// NewInternalJWTSigner creates a signer from a PEM-encoded private key file.
func NewInternalJWTSigner(privateKeyPath string) (*InternalJWTSigner, error) {
	keyData, err := os.ReadFile(privateKeyPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read JWT private key: %w", err)
	}

	block, _ := pem.Decode(keyData)
	if block == nil || block.Type != "RSA PRIVATE KEY" {
		return nil, errors.New("failed to decode PEM block containing private key")
	}

	privateKey, err := x509.ParsePKCS1PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("failed to parse RSA private key: %w", err)
	}

	return &InternalJWTSigner{
		privateKey: privateKey,
		publicKey:  &privateKey.PublicKey,
	}, nil
}

// NewEphemeralSigner creates a signer with a new ephemeral key pair (for testing).
func NewEphemeralSigner() (*InternalJWTSigner, error) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, err
	}

	return &InternalJWTSigner{
		privateKey: privateKey,
		publicKey:  &privateKey.PublicKey,
	}, nil
}

// InternalTokenClaims for internal JWT. Minimal claims — roles are queried from DB.
// The Roles field is used for system tokens that have no DB presence.
type InternalTokenClaims struct {
	jwt.RegisteredClaims
	Email string   `json:"email"`
	OrgID string   `json:"org_id,omitempty"`
	Roles []string `json:"roles,omitempty"`
}

// GenerateToken creates a signed internal JWT.
func (s *InternalJWTSigner) GenerateToken(userID dbuuid.UUID, email string) (string, string, int64, error) {
	jti := dbuuid.Must().String()
	expiresAt := time.Now().Add(SessionExpiry)

	claims := InternalTokenClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    jwtIssuer,
			Subject:   userID.String(),
			ID:        jti,
			ExpiresAt: jwt.NewNumericDate(expiresAt),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
		Email: email,
	}

	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	signedToken, err := token.SignedString(s.privateKey)
	if err != nil {
		return "", "", 0, fmt.Errorf("failed to sign token: %w", err)
	}

	return signedToken, jti, expiresAt.Unix(), nil
}

// GenerateTokenWithOrg creates a signed internal JWT with organization context.
func (s *InternalJWTSigner) GenerateTokenWithOrg(userID dbuuid.UUID, email string, orgID dbuuid.UUID) (string, string, int64, error) {
	jti := dbuuid.Must().String()
	expiresAt := time.Now().Add(SessionExpiry)

	claims := InternalTokenClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    jwtIssuer,
			Subject:   userID.String(),
			ID:        jti,
			ExpiresAt: jwt.NewNumericDate(expiresAt),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
		Email: email,
		OrgID: orgID.String(),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	signedToken, err := token.SignedString(s.privateKey)
	if err != nil {
		return "", "", 0, fmt.Errorf("failed to sign token: %w", err)
	}

	return signedToken, jti, expiresAt.Unix(), nil
}

// GenerateSystemTokenWithOrg creates a signed system JWT with ROLE_SYSTEM for internal service-to-service calls.
func (s *InternalJWTSigner) GenerateSystemTokenWithOrg(orgID dbuuid.UUID) (string, string, int64, error) {
	systemUserID := dbuuid.Must()
	jti := dbuuid.Must().String()
	expiresAt := time.Now().Add(SessionExpiry)

	claims := InternalTokenClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    jwtIssuer,
			Subject:   systemUserID.String(),
			ID:        jti,
			ExpiresAt: jwt.NewNumericDate(expiresAt),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
		Email: fmt.Sprintf("system-%s@tech-office.dev", orgID.String()),
		OrgID: orgID.String(),
		Roles: []string{"ROLE_SYSTEM"},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	signedToken, err := token.SignedString(s.privateKey)
	if err != nil {
		return "", "", 0, fmt.Errorf("failed to sign system token: %w", err)
	}

	return signedToken, jti, expiresAt.Unix(), nil
}

// PublicKey returns the RSA public key for verification.
func (s *InternalJWTSigner) PublicKey() *rsa.PublicKey {
	return s.publicKey
}

// ParseToken parses and validates a JWT signed by this signer.
// Used to verify PIN change tokens.
func (s *InternalJWTSigner) ParseToken(tokenString string) (*InternalTokenClaims, error) {
	claims := &InternalTokenClaims{}
	token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (any, error) {
		if _, ok := token.Method.(*jwt.SigningMethodRSA); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return s.publicKey, nil
	})
	if err != nil {
		return nil, fmt.Errorf("failed to parse token: %w", err)
	}
	if !token.Valid {
		return nil, errors.New("invalid token")
	}
	return claims, nil
}

// InternalJWTVerifier verifies internal JWTs using RSA public key.
type InternalJWTVerifier struct {
	publicKey *rsa.PublicKey
	jwkKey    jwk.Key
}

// NewInternalJWTVerifier creates a verifier from an RSA public key.
func NewInternalJWTVerifier(publicKey *rsa.PublicKey) (*InternalJWTVerifier, error) {
	key, err := jwk.Import(publicKey)
	if err != nil {
		return nil, fmt.Errorf("failed to import public key to JWK: %w", err)
	}
	if err := key.Set(jwk.AlgorithmKey, jwa.RS256()); err != nil {
		return nil, fmt.Errorf("failed to set algorithm: %w", err)
	}

	return &InternalJWTVerifier{publicKey: publicKey, jwkKey: key}, nil
}

// NewInternalJWTVerifierFromFile creates a verifier from a PEM-encoded public key file.
func NewInternalJWTVerifierFromFile(publicKeyPath string) (*InternalJWTVerifier, error) {
	keyData, err := os.ReadFile(publicKeyPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read JWT public key: %w", err)
	}

	block, _ := pem.Decode(keyData)
	if block == nil {
		return nil, errors.New("failed to decode PEM block containing public key")
	}

	pubKey, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("failed to parse public key: %w", err)
	}

	rsaPubKey, ok := pubKey.(*rsa.PublicKey)
	if !ok {
		return nil, errors.New("public key is not RSA")
	}

	return NewInternalJWTVerifier(rsaPubKey)
}

// VerifyToken verifies the JWT signature and returns the parsed token.
func (v *InternalJWTVerifier) VerifyToken(tokenString string) (jwxjwt.Token, error) {
	token, err := jwxjwt.Parse([]byte(tokenString),
		jwxjwt.WithKey(jwa.RS256(), v.jwkKey),
		jwxjwt.WithValidate(true),
		jwxjwt.WithIssuer(jwtIssuer),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to verify token: %w", err)
	}

	return token, nil
}

// VerifyTokenRaw verifies the JWT using jws.Verify directly (for compatibility with interceptor).
func (v *InternalJWTVerifier) VerifyTokenRaw(tokenBytes []byte) ([]byte, error) {
	payload, err := jws.Verify(tokenBytes, jws.WithKey(jwa.RS256(), v.jwkKey))
	if err != nil {
		return nil, fmt.Errorf("failed to verify token signature: %w", err)
	}
	return payload, nil
}

// Verify implements interceptor.JWTVerifierInterface for use as a connect interceptor verifier.
func (v *InternalJWTVerifier) Verify(_ context.Context, tokenString string) (jwxjwt.Token, error) {
	return v.VerifyToken(tokenString)
}

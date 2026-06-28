# OAuth Authentication Flow Contract

**Feature**: Complete User Sign-In Flow with Zitadel Integration  
**Date**: 2025-10-25

---

## Overview

This document defines the OAuth 2.0 Authorization Code flow with PKCE for Zitadel authentication integration. All interactions follow the OAuth 2.0 and OpenID Connect specifications.

---

## 1. Authorization Request (Login Initiation)

### Frontend Action
User clicks "Login with Zitadel" button in LoginForm component.

### Request Parameters
```http
GET /oauth/v2/authorize HTTP/1.1
Host: techofficeinstance-elao17.us1.zitadel.cloud

Query Parameters:
- redirect_uri: http://localhost:13000/callback (or production URL)
- response_type: code
- scope: openid profile email urn:zitadel:iam:org:id:{organizationId}
- state: <random-string-32-bytes>
- code_challenge: <base64url-encoded-sha256-hash>
- code_challenge_method: S256
- nonce: <optional-random-string>
```

### Example
```
https://techofficeinstance-elao17.us1.zitadel.cloud/oauth/v2/authorize?
  client_id=341858311794190186&
  redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fcallback&
  response_type=code&
  scope=openid+profile+email+urn%3Azitadel%3Aiam%3Aorg%3Aid%3A123e4567-e89b-12d3-a456-426614174000&
  state=abc123xyz789&
  code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&
  code_challenge_method=S256
```

### Managed By
`@zitadel/react` library's `login()` function handles parameter generation.

### Security
- **state**: Random 32-byte string, stored in sessionStorage, validated on callback
- **code_challenge**: SHA256 hash of code_verifier (PKCE), prevents code interception
- **code_verifier**: Random 43-128 character string, stored in sessionStorage

---

## 2. User Authentication (Zitadel)

### User Actions
1. Enters email/username and password on Zitadel login page
2. Completes MFA if enabled (optional, configured in Zitadel)
3. Consents to requested scopes (if first-time login)

### Zitadel Validation
- User exists in specified organization (`urn:zitadel:iam:org:id` scope)
- User has access to the organization
- Organization is active (not suspended)
- User email is verified (configurable)

### Success Response
Redirect to callback URL with authorization code:
```
http://localhost:13000/callback?
  code=xyz789abc123&
  state=abc123xyz789
```

### Error Response
Redirect to callback URL with error:
```
http://localhost:13000/callback?
  error=access_denied&
  error_description=User+not+authorized+for+this+organization&
  state=abc123xyz789
```

---

## 3. Authorization Code Exchange (Token Request)

### Frontend Action
Callback page component automatically exchanges code for tokens.

### Request
```http
POST /oauth/v2/token HTTP/1.1
Host: techofficeinstance-elao17.us1.zitadel.cloud
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&
code=xyz789abc123&
redirect_uri=http://localhost:13000/callback&
client_id=341858311794190186&
code_verifier=<original-random-string-stored-in-session>
```

### Success Response
```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIsImtpZCI6IjEyMyJ9...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "opaque-refresh-token-string",
  "id_token": "eyJhbGciOiJSUzI1NiIsImtpZCI6IjEyMyJ9...",
  "scope": "openid profile email urn:zitadel:iam:org:id:123e4567-e89b-12d3-a456-426614174000"
}
```

### Error Response
```json
{
  "error": "invalid_grant",
  "error_description": "Authorization code is invalid or expired"
}
```

### Managed By
`@zitadel/react` library's `signinRedirectCallback()` function.

### Validation
- **State match**: Callback state parameter must match stored state
- **Code verifier**: Must match the code_challenge sent in authorization request
- **Redirect URI**: Must match exactly (including trailing slashes)

---

## 4. Token Validation

### ID Token Claims (JWT)
```json
{
  "iss": "https://techofficeinstance-elao17.us1.zitadel.cloud",
  "sub": "234567890123456789",
  "aud": "341858311794190186",
  "exp": 1730000000,
  "iat": 1729996400,
  "auth_time": 1729996400,
  "nonce": "abc123",
  "email": "user@acme.com",
  "email_verified": true,
  "name": "John Doe",
  "given_name": "John",
  "family_name": "Doe",
  "picture": "https://...",
  "locale": "en",
  "urn:zitadel:iam:org:id": "123e4567-e89b-12d3-a456-426614174000",
  "urn:zitadel:iam:org:domain:primary": "acme",
  "urn:zitadel:iam:user:resourceowner:id": "123e4567-e89b-12d3-a456-426614174000",
  "urn:zitadel:iam:user:resourceowner:name": "Acme Corporation"
}
```

### Validation Steps
1. **Signature**: Verify JWT signature using Zitadel's public key (JWKS endpoint)
2. **Issuer**: Match expected issuer URL
3. **Audience**: Match client ID
4. **Expiration**: Token must not be expired (`exp > now`)
5. **Nonce**: Match nonce sent in authorization request (if used)

### Managed By
`@zitadel/react` library automatically validates ID token.

---

## 5. Token Storage

### Storage Location
`localStorage.setItem('auth_tokens', JSON.stringify(tokens))`

### Stored Data
```typescript
interface StoredTokens {
  access_token: string;      // JWT (1 hour expiry)
  refresh_token: string;     // Opaque token (30 day expiry)
  id_token: string;          // JWT with user claims
  token_type: 'Bearer';
  expires_at: number;        // Unix timestamp (calculated from expires_in)
  scope: string;
}
```

### Security Notes
- ✅ PKCE prevents code interception even if localStorage compromised
- ✅ Short-lived access tokens (1 hour)
- ✅ Refresh token rotation (new token on each refresh)
- ⚠️ XSS vulnerability (mitigated by CSP headers)
- 🔄 Future: Migrate to HttpOnly cookies

---

## 6. Token Refresh

### Automatic Refresh
`@zitadel/react` monitors token expiration and automatically refreshes 60s before expiry.

### Request
```http
POST /oauth/v2/token HTTP/1.1
Host: techofficeinstance-elao17.us1.zitadel.cloud
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token&
refresh_token=opaque-refresh-token-string&
client_id=341858311794190186&
scope=openid profile email urn:zitadel:iam:org:id:123e4567-e89b-12d3-a456-426614174000
```

### Success Response
```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIsImtpZCI6IjEyMyJ9...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "new-opaque-refresh-token-string",
  "id_token": "eyJhbGciOiJSUzI1NiIsImtpZCI6IjEyMyJ9...",
  "scope": "openid profile email urn:zitadel:iam:org:id:123e4567-e89b-12d3-a456-426614174000"
}
```

### Error Response
```json
{
  "error": "invalid_grant",
  "error_description": "Refresh token is expired or revoked"
}
```

### Error Handling
- Refresh token expired → Clear auth state, redirect to signin
- Network error → Retry with exponential backoff (max 3 retries)
- Invalid grant → Clear auth state, redirect to signin

---

## 7. API Authorization

### Backend API Call
Frontend includes access token in API requests:

```http
POST /v1/iam.IAMService/GetUser HTTP/1.1
Host: api.tech-office.com
Authorization: Bearer eyJhbGciOiJSUzI1NiIsImtpZCI6IjEyMyJ9...
Content-Type: application/json

{"userId": "234567890123456789"}
```

### Backend Token Verification
```go
// Backend RPC Interceptor
func (i *Interceptor) Auth(ctx context.Context, req interface{}) (context.Context, error) {
    // 1. Extract token from Authorization header
    token := extractBearerToken(ctx)
    
    // 2. Verify JWT signature using Zitadel's public key
    claims, err := i.verifier.Verify(ctx, token)
    if err != nil {
        return nil, status.Error(codes.Unauthenticated, "invalid token")
    }
    
    // 3. Extract organization ID from claims
    orgID := claims["urn:zitadel:iam:org:id"].(string)
    userID := claims["sub"].(string)
    
    // 4. Add to context for downstream services
    ctx = context.WithValue(ctx, "organization_id", orgID)
    ctx = context.WithValue(ctx, "user_id", userID)
    
    // 5. Check expiration
    exp := claims["exp"].(int64)
    if time.Now().Unix() > exp {
        return nil, status.Error(codes.Unauthenticated, "token expired")
    }
    
    return ctx, nil
}
```

### Multi-Tenant Isolation
All database queries must include organization_id filter:
```go
func (s *Service) GetUser(ctx context.Context, req *GetUserRequest) (*GetUserResponse, error) {
    orgID := ctx.Value("organization_id").(string)
    
    // Query with tenant isolation
    user, err := s.queries.GetUser(ctx, db.GetUserParams{
        ID:             req.UserId,
        OrganizationID: orgID, // REQUIRED: Enforces multi-tenant isolation
    })
    
    return &GetUserResponse{User: user}, nil
}
```

---

## 8. Logout

### Frontend Action
User clicks "Logout" button.

### Request
```http
GET /oidc/v1/end_session HTTP/1.1
Host: techofficeinstance-elao17.us1.zitadel.cloud

Query Parameters:
- id_token_hint: eyJhbGciOiJSUzI1NiIsImtpZCI6IjEyMyJ9...
- post_logout_redirect_uri: http://localhost:13000/signin
- state: <optional-random-string>
```

### Frontend Actions After Logout
1. Call `@zitadel/react`'s `logout()` function
2. Clear tokens from localStorage
3. Redirect to post_logout_redirect_uri

### Managed By
`@zitadel/react` library's `logout()` function.

---

## Error Codes Reference

### OAuth Errors (from Zitadel)
| Error Code | Description | User Action |
|------------|-------------|-------------|
| `access_denied` | User denied access or not authorized | Contact administrator |
| `invalid_request` | Missing or invalid parameters | Retry, report if persists |
| `unauthorized_client` | Client not authorized for this flow | Configuration error |
| `unsupported_response_type` | Response type not supported | Configuration error |
| `invalid_scope` | Requested scope invalid | Configuration error |
| `server_error` | Zitadel internal error | Retry later |
| `temporarily_unavailable` | Service temporarily down | Retry later |

### Token Exchange Errors
| Error Code | Description | User Action |
|------------|-------------|-------------|
| `invalid_grant` | Code expired or already used | Restart login flow |
| `invalid_client` | Client authentication failed | Configuration error |
| `invalid_request` | Missing required parameters | Technical error |
| `unsupported_grant_type` | Grant type not supported | Configuration error |

### Refresh Token Errors
| Error Code | Description | User Action |
|------------|-------------|-------------|
| `invalid_grant` | Refresh token expired/revoked | Re-authenticate |
| `invalid_scope` | Scope exceeds original grant | Re-authenticate |

---

## Security Checklist

- ✅ **PKCE**: Prevents authorization code interception
- ✅ **State parameter**: CSRF protection on callback
- ✅ **Nonce**: Replay attack prevention (optional)
- ✅ **Short-lived access tokens**: 1 hour expiration
- ✅ **Refresh token rotation**: New refresh token on each use
- ✅ **JWT signature validation**: Public key verification
- ✅ **Organization scope**: Multi-tenant isolation
- ✅ **HTTPS only**: All communication over TLS
- ✅ **Redirect URI validation**: Exact match required
- ✅ **Token expiration checks**: Both frontend and backend

---

## References

- **OAuth 2.0 RFC 6749**: https://datatracker.ietf.org/doc/html/rfc6749
- **PKCE RFC 7636**: https://datatracker.ietf.org/doc/html/rfc7636
- **OpenID Connect Core**: https://openid.net/specs/openid-connect-core-1_0.html
- **Zitadel OIDC Docs**: https://zitadel.com/docs/apis/openidoauth/endpoints
- **@zitadel/react**: https://github.com/zitadel/zitadel-react

---

## Testing

### Manual Testing Checklist
- [ ] Authorization request generates correct URL with PKCE parameters
- [ ] State parameter is preserved and validated on callback
- [ ] Authorization code can be exchanged for tokens
- [ ] ID token claims include organization ID
- [ ] Access token works for API calls
- [ ] Token refresh works automatically before expiration
- [ ] Logout clears tokens and redirects correctly
- [ ] Error handling displays user-friendly messages

### Integration Test Scenarios
- [ ] Full OAuth flow: signin → auth → callback → dashboard
- [ ] Invalid state on callback → error message
- [ ] Expired authorization code → error message
- [ ] Access denied by Zitadel → error message
- [ ] Token refresh before expiration → seamless
- [ ] Refresh token expired → redirect to signin
- [ ] Network error during token exchange → retry logic

---

**Status**: Ready for implementation

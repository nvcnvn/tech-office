package config

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"strings"
)

// Profile is the declared runtime posture of this process. It is the only input that
// decides whether a failing safety check is fatal.
type Profile string

const (
	ProfileDevelopment Profile = "development"
	ProfileProduction  Profile = "production"
)

// ParseProfile turns the raw APP_ENV value into a Profile.
//
// An absent or blank value resolves to production: the safe posture is the one you get
// by not thinking about it (FR-002). Anything that is neither accepted value is a typo
// and is rejected rather than guessed at — accepting "prod" would also mean accepting
// "Production" on a machine where the difference decides whether a failing check stops
// the process (FR-003).
func ParseProfile(raw string) (Profile, error) {
	switch p := Profile(strings.TrimSpace(raw)); p {
	case "":
		return ProfileProduction, nil
	case ProfileDevelopment, ProfileProduction:
		return p, nil
	default:
		return "", fmt.Errorf(
			"tech-office: APP_ENV=%q is not a runtime profile. Accepted values: %s, %s",
			p, ProfileDevelopment, ProfileProduction)
	}
}

// SafetyViolation is one failed startup-time assertion about configuration.
//
// Every field is operator-facing prose or an environment variable name. No field ever
// holds a configured value, because a configured value may be a secret and the report
// goes to a log that may be shipped off the box (FR-012). Naming the *shape* of a
// correct value is enough to fix the setting, which is what SC-002 asks for.
type SafetyViolation struct {
	Check    string // stable identifier: "durable-signing-key" | "cross-origin" | "sso-audience"
	Setting  string // the environment variable to change
	Exposure string // what the current state exposes, in one sentence
	Fix      string // what a correct value looks like
}

// SafetyViolations evaluates every check and returns the complete list.
//
// Nothing short-circuits: an operator fixing a deployment should need one restart to see
// every problem, not one restart per problem (FR-010, SC-003). The order is fixed —
// signing key, cross-origin, then SSO with Google before Apple — so the report reads the
// same way twice and a test can assert on the whole slice.
//
// The profile is an argument rather than a field read because the checks themselves do
// not depend on it; only their severity does. It is passed so a future check that is
// genuinely profile-specific has somewhere to look.
func (c *Config) SafetyViolations(_ Profile) []SafetyViolation {
	var violations []SafetyViolation

	if v, ok := c.durableSigningKeyViolation(); ok {
		violations = append(violations, v)
	}
	if v, ok := c.crossOriginViolation(); ok {
		violations = append(violations, v)
	}
	violations = append(violations, c.ssoAudienceViolations()...)

	return violations
}

// durableSigningKeyViolation reports an unset JWT_PRIVATE_KEY_PATH (FR-013).
//
// A path that is set but unreadable is deliberately *not* this check's business:
// iam.NewInternalJWTSigner already fails startup on it, in every profile, with an error
// that names the file (FR-015). Duplicating that here would only mean two places to keep
// in step.
func (c *Config) durableSigningKeyViolation() (SafetyViolation, bool) {
	if strings.TrimSpace(c.JWTPrivateKeyPath) != "" {
		return SafetyViolation{}, false
	}
	return SafetyViolation{
		Check:   "durable-signing-key",
		Setting: "JWT_PRIVATE_KEY_PATH",
		Exposure: "session tokens are signed with a key generated for this process, " +
			"so every signed-in person is signed out when the server restarts, " +
			"and two replicas reject each other's tokens",
		Fix: "point it at a readable PEM-encoded RSA private key that outlives the process " +
			"— the Swarm stack mounts one at /run/secrets/jwt.pem",
	}, true
}

// crossOriginViolation reports an origin policy that cannot be right in production.
//
// At most one violation is returned even when both halves fail, because the fix is the
// same edit to the same pair of settings and a doubled entry would only pad the list.
func (c *Config) crossOriginViolation() (SafetyViolation, bool) {
	for _, origin := range c.CORSAllowedOrigins {
		if strings.TrimSpace(origin) == "*" {
			// FR-017
			return SafetyViolation{
				Check:   "cross-origin",
				Setting: "CORS_ALLOWED_ORIGINS",
				Exposure: "every website a signed-in person visits is allowed to make " +
					"browser requests to this server",
				Fix: "remove the * entry and list only the origins your own clients are " +
					"served from, e.g. https://admin.example.com",
			}, true
		}
	}

	// FR-018. The allowed browser origin is derived from WEBAPP_URL, so an address that
	// no browser could ever present means the server allows nobody.
	const (
		webappFix = "set it to the absolute address people type to reach the workspace, " +
			"e.g. https://office.example.com, and add CORS_ALLOWED_ORIGINS for any further origin"
	)
	u, err := url.Parse(strings.TrimSpace(c.WebappURL))
	if err != nil || u.Scheme == "" || u.Host == "" {
		return SafetyViolation{
			Check:   "cross-origin",
			Setting: "WEBAPP_URL",
			Exposure: "it is not an absolute URL with a scheme and a host, so no allowed " +
				"browser origin can be derived and no browser request is permitted",
			Fix: webappFix,
		}, true
	}
	if isLoopbackHost(u.Hostname()) {
		return SafetyViolation{
			Check:   "cross-origin",
			Setting: "WEBAPP_URL",
			Exposure: "it is a loopback address, so the only allowed browser origin is one " +
				"no browser on any other machine can ever present",
			Fix: webappFix,
		}, true
	}

	return SafetyViolation{}, false
}

// isLoopbackHost reports whether a host can only ever be reached from the machine the
// server runs on.
//
// Private LAN ranges and .local/.internal names deliberately pass: deploy/README.md
// documents LAN-only and air-gapped fleets as supported, and a private-range origin is a
// real, working browser origin for the people on that network (research D7). Loopback is
// different in kind — it names the server's own machine and nothing else.
func isLoopbackHost(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && (ip.IsLoopback() || ip.IsUnspecified())
}

// ssoAudienceViolations reports a provider whose audience list was configured and did
// not take: the raw value holds something, and none of it survived parsing (FR-026).
//
// A provider left entirely unset yields nothing. That is not a misconfiguration — it is
// how a workspace running on passwords and worker PINs turns SSO off (FR-028).
func (c *Config) ssoAudienceViolations() []SafetyViolation {
	var violations []SafetyViolation
	for _, p := range []struct {
		setting, raw, label string
		parsed              []string
	}{
		{"GOOGLE_CLIENT_IDS", c.GoogleClientIDsRaw, "Google", c.GoogleClientIDs},
		{"APPLE_CLIENT_IDS", c.AppleClientIDsRaw, "Apple", c.AppleClientIDs},
	} {
		// Unset is silence; anything else — even a lone comma — is an attempt that did
		// not take. getEnvStringSlice drops blanks, so only the raw value tells them apart.
		if strings.TrimSpace(p.raw) == "" || len(p.parsed) > 0 {
			continue
		}
		violations = append(violations, SafetyViolation{
			Check:   "sso-audience",
			Setting: p.setting,
			Exposure: p.label + " sign-in appears to be configured and is not, so it is " +
				"refused at the moment somebody tries to use it rather than now",
			Fix: "set it to a comma-separated list of the OAuth client IDs your apps use, " +
				"or unset it entirely to turn " + p.label + " sign-in off deliberately",
		})
	}
	return violations
}

// AllowedOrigins returns the browser origins the CORS handler accepts.
//
// Development allows everything, which is byte-for-byte what a contributor's machine
// does today (FR-020). Production derives the first origin from WEBAPP_URL and appends
// CORS_ALLOWED_ORIGINS, so a single-domain deployment needs no new setting at all
// (FR-016, FR-019).
func (c *Config) AllowedOrigins(p Profile) []string {
	if p == ProfileDevelopment {
		return []string{"*"}
	}

	var origins []string
	// A browser's Origin header carries no path and never a trailing slash, and rs/cors
	// compares it literally — so an operator who pastes "https://office.example.com/"
	// would otherwise get a check that passes and a browser that is still blocked.
	if u, err := url.Parse(strings.TrimSpace(c.WebappURL)); err == nil && u.Scheme != "" && u.Host != "" {
		origins = append(origins, u.Scheme+"://"+u.Host)
	}
	for _, extra := range c.CORSAllowedOrigins {
		if e := strings.TrimSpace(extra); e != "" {
			origins = append(origins, e)
		}
	}
	return origins
}

// EnforceSafety resolves the runtime profile, reports it, and decides whether this
// process may continue.
//
// Call it as the first statement of the server command, before any pool is opened and
// before any port is bound, so a refusal leaves nothing listening and no connection
// open (FR-007, FR-008). The resolved profile is returned so the caller can pass it to
// the handlers whose behaviour depends on it, rather than re-deriving it.
func (c *Config) EnforceSafety(ctx context.Context) (Profile, error) {
	profile, err := ParseProfile(c.AppEnvRaw)
	if err != nil {
		return "", err
	}
	slog.InfoContext(ctx, "runtime profile resolved", "profile", string(profile))

	violations := c.SafetyViolations(profile)
	if len(violations) == 0 {
		return profile, nil
	}

	if profile == ProfileDevelopment {
		// FR-009: the local loop is unchanged in effort, but a contributor sees the
		// production verdict on their own machine rather than discovering it on deploy.
		for _, v := range violations {
			slog.WarnContext(ctx, "safety check would fail in the production profile",
				"check", v.Check, "setting", v.Setting, "exposes", v.Exposure, "fix", v.Fix)
		}
		return profile, nil
	}

	return "", fmt.Errorf("%s", formatSafetyReport(violations))
}

// formatSafetyReport renders the operator-facing refusal.
//
// The wording is part of the contract, not an implementation detail: SC-002 requires
// that whoever reads this can fix every flagged setting without opening source code.
// See specs/060-production-safety-defaults/contracts/startup-report.md.
func formatSafetyReport(violations []SafetyViolation) string {
	var b strings.Builder
	fmt.Fprintf(&b, "tech-office: refusing to start in the production profile — %d safety checks failed.\n",
		len(violations))
	for i, v := range violations {
		fmt.Fprintf(&b, "\n  %d. %s\n", i+1, v.Setting)
		fmt.Fprintf(&b, "     Exposes: %s.\n", v.Exposure)
		fmt.Fprintf(&b, "     Fix:     %s.\n", v.Fix)
	}
	b.WriteString("\nSet APP_ENV=development to run with these defaults on a developer's machine.")
	return b.String()
}

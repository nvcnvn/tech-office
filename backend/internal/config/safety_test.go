package config

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestRuntimeProfile covers the resolution of APP_ENV into a Profile.
//
// The inputs are supplied as plain strings rather than through t.Setenv, because
// config.Get is a sync.Once singleton that cannot be re-loaded inside one test binary.
// ParseProfile takes the raw string, so no test seam is needed.
func TestRuntimeProfile(t *testing.T) {
	t.Run("an absent APP_ENV resolves to production", func(t *testing.T) {
		// FR-002: the safe posture is what you get by not thinking about it.
		for _, raw := range []string{"", "   ", "\t\n"} {
			p, err := ParseProfile(raw)
			require.NoError(t, err, "raw=%q", raw)
			assert.Equal(t, ProfileProduction, p, "raw=%q", raw)
		}
	})

	t.Run("development and production are the only accepted values", func(t *testing.T) {
		// FR-001
		p, err := ParseProfile("development")
		require.NoError(t, err)
		assert.Equal(t, ProfileDevelopment, p)

		p, err = ParseProfile("production")
		require.NoError(t, err)
		assert.Equal(t, ProfileProduction, p)

		t.Run("surrounding whitespace is trimmed", func(t *testing.T) {
			p, err := ParseProfile("  development  ")
			require.NoError(t, err)
			assert.Equal(t, ProfileDevelopment, p)
		})
	})

	t.Run("an unrecognised value is rejected and the error lists the accepted values", func(t *testing.T) {
		// FR-003
		_, err := ParseProfile("staging")
		require.Error(t, err)
		assert.Contains(t, err.Error(), "staging", "the message should quote what the operator wrote")
		assert.Contains(t, err.Error(), "development")
		assert.Contains(t, err.Error(), "production")
		assert.Contains(t, err.Error(), "APP_ENV", "the message should name the setting to change")
	})

	t.Run("the rejection covers casing and abbreviation typos", func(t *testing.T) {
		// Edge case: a near miss is a typo, not a synonym, because silently accepting
		// "prod" would mean silently accepting "Production" that was meant as "production"
		// on a machine where the difference decides whether checks are fatal.
		for _, raw := range []string{"Production", "PRODUCTION", "prod", "Development", "dev", "test"} {
			_, err := ParseProfile(raw)
			require.Error(t, err, "raw=%q should be rejected", raw)
			assert.Contains(t, strings.ToLower(err.Error()), "accepted values", "raw=%q", raw)
		}
	})
}

// safeProductionConfig returns a configuration that passes every check, so each subtest
// below can introduce exactly one problem and attribute the verdict to it.
func safeProductionConfig() *Config {
	return &Config{
		JWTPrivateKeyPath: "/run/secrets/jwt.pem",
		WebappURL:         "https://office.example.com",
	}
}

// checksOf reduces a report to its stable check identifiers, so a subtest can assert
// which checks fired without depending on the prose.
func checksOf(violations []SafetyViolation) []string {
	out := make([]string, 0, len(violations))
	for _, v := range violations {
		out = append(out, v.Check)
	}
	return out
}

func TestStartupSafetyReport(t *testing.T) {
	t.Run("when the production profile is active", func(t *testing.T) {
		t.Run("an unset signing key path is a violation", func(t *testing.T) {
			// FR-013
			c := safeProductionConfig()
			c.JWTPrivateKeyPath = ""

			assert.Equal(t, []string{"durable-signing-key"}, checksOf(c.SafetyViolations(ProfileProduction)))
		})

		t.Run("the signing key violation states sessions die on restart and differ across replicas", func(t *testing.T) {
			// FR-014: the operator has to understand the consequence, not just the setting.
			c := safeProductionConfig()
			c.JWTPrivateKeyPath = ""

			v := c.SafetyViolations(ProfileProduction)
			require.Len(t, v, 1)
			exposure := strings.ToLower(v[0].Exposure)
			assert.Contains(t, exposure, "restart")
			assert.Contains(t, exposure, "replica")
			assert.Equal(t, "JWT_PRIVATE_KEY_PATH", v[0].Setting)
		})

		t.Run("a set signing key path is not this check's business", func(t *testing.T) {
			// FR-015: an unreadable path still fails startup, but in the signer, in every
			// profile. This check only asks whether a durable key was configured at all.
			c := safeProductionConfig()
			c.JWTPrivateKeyPath = "/does/not/exist.pem"

			assert.Empty(t, c.SafetyViolations(ProfileProduction))
		})

		t.Run("a wildcard origin list is a violation", func(t *testing.T) {
			// FR-017
			c := safeProductionConfig()
			c.CORSAllowedOrigins = []string{"https://admin.example.com", "*"}

			assert.Equal(t, []string{"cross-origin"}, checksOf(c.SafetyViolations(ProfileProduction)))
		})

		t.Run("a loopback workspace address is a violation", func(t *testing.T) {
			// FR-018: no browser on another machine can ever present a loopback origin,
			// so a production deployment holding the development default allows nobody.
			for _, addr := range []string{
				"http://localhost:13000",
				"http://127.0.0.1:13000",
				"http://127.5.5.5",
				"http://[::1]:13000",
				"http://0.0.0.0:13000",
			} {
				c := safeProductionConfig()
				c.WebappURL = addr

				assert.Equal(t, []string{"cross-origin"}, checksOf(c.SafetyViolations(ProfileProduction)),
					"WEBAPP_URL=%q should fail the cross-origin check", addr)
			}
		})

		t.Run("a private or internal workspace address is not a violation", func(t *testing.T) {
			// Research D7: LAN-only and air-gapped fleets are documented, supported
			// deployments, and a private-range origin is a working origin for them.
			for _, addr := range []string{
				"https://10.1.2.3",
				"https://192.168.1.10:8443",
				"https://172.20.0.5",
				"https://office.local",
				"https://office.internal",
			} {
				c := safeProductionConfig()
				c.WebappURL = addr

				assert.Empty(t, c.SafetyViolations(ProfileProduction),
					"WEBAPP_URL=%q should pass the cross-origin check", addr)
			}
		})

		t.Run("an absent workspace address is a violation", func(t *testing.T) {
			// FR-018
			for _, addr := range []string{"", "   ", "office.example.com", "https://", "not a url"} {
				c := safeProductionConfig()
				c.WebappURL = addr

				assert.Equal(t, []string{"cross-origin"}, checksOf(c.SafetyViolations(ProfileProduction)),
					"WEBAPP_URL=%q should fail the cross-origin check", addr)
			}
		})

		t.Run("a single cross-origin violation is reported even when both halves fail", func(t *testing.T) {
			// The fix is the same edit, so reporting it twice would only pad the list.
			c := safeProductionConfig()
			c.WebappURL = "http://localhost:13000"
			c.CORSAllowedOrigins = []string{"*"}

			assert.Equal(t, []string{"cross-origin"}, checksOf(c.SafetyViolations(ProfileProduction)))
		})

		t.Run("a provider whose audience list is whitespace-only is a violation", func(t *testing.T) {
			// FR-026: the operator wrote something and none of it was usable.
			c := safeProductionConfig()
			c.GoogleClientIDsRaw = " , "

			v := c.SafetyViolations(ProfileProduction)
			require.Equal(t, []string{"sso-audience"}, checksOf(v))
			assert.Equal(t, "GOOGLE_CLIENT_IDS", v[0].Setting)

			t.Run("both providers are reported, Google first", func(t *testing.T) {
				c := safeProductionConfig()
				c.GoogleClientIDsRaw = " , "
				c.AppleClientIDsRaw = ","

				v := c.SafetyViolations(ProfileProduction)
				require.Len(t, v, 2)
				assert.Equal(t, "GOOGLE_CLIENT_IDS", v[0].Setting)
				assert.Equal(t, "APPLE_CLIENT_IDS", v[1].Setting)
			})
		})

		t.Run("a provider left entirely unset is not a violation", func(t *testing.T) {
			// FR-028: unset means deliberately disabled, which a password-and-PIN-only
			// deployment relies on.
			c := safeProductionConfig()

			assert.Empty(t, c.SafetyViolations(ProfileProduction))
		})

		t.Run("a provider with usable audiences is not a violation", func(t *testing.T) {
			c := safeProductionConfig()
			c.GoogleClientIDsRaw = "123.apps.googleusercontent.com"
			c.GoogleClientIDs = []string{"123.apps.googleusercontent.com"}

			assert.Empty(t, c.SafetyViolations(ProfileProduction))
		})

		t.Run("three simultaneous problems are reported together", func(t *testing.T) {
			// FR-010, SC-003: one restart shows the whole list, so fixing the deployment
			// is one edit rather than three restarts.
			c := &Config{
				JWTPrivateKeyPath:  "",
				WebappURL:          "http://localhost:13000",
				GoogleClientIDsRaw: " , ",
			}

			assert.Equal(t,
				[]string{"durable-signing-key", "cross-origin", "sso-audience"},
				checksOf(c.SafetyViolations(ProfileProduction)))
		})

		t.Run("every violation names its setting, its exposure and a correct value", func(t *testing.T) {
			// FR-011: SC-002 requires the message alone to be enough to fix the setting.
			c := &Config{
				JWTPrivateKeyPath:  "",
				WebappURL:          "",
				GoogleClientIDsRaw: " , ",
				AppleClientIDsRaw:  " , ",
			}

			v := c.SafetyViolations(ProfileProduction)
			require.Len(t, v, 4)
			for _, violation := range v {
				assert.NotEmpty(t, violation.Check)
				assert.NotEmpty(t, violation.Setting)
				assert.NotEmpty(t, violation.Exposure, "check=%s", violation.Check)
				assert.NotEmpty(t, violation.Fix, "check=%s", violation.Check)
			}
		})

		t.Run("no violation message contains a secret value", func(t *testing.T) {
			// FR-012: the report is written to a log that may be shipped off the box.
			const (
				secretKeyPath  = "/etc/secrets/tenant-signing-key.pem"
				secretClientID = "893471-supersecret.apps.googleusercontent.com"
				secretHost     = "internal-tenant-7.example.com"
			)
			c := &Config{
				JWTPrivateKeyPath:  "",
				WebappURL:          "http://localhost:13000",
				CORSAllowedOrigins: []string{"*", "https://" + secretHost},
				GoogleClientIDsRaw: secretClientID + " ,,",
				AppleClientIDsRaw:  " , ",
			}
			// The signing key path is unset in the failing case, but assert against a
			// plausible value too so a future implementation that echoes it is caught.
			c.PostgresPassword = "hunter2"
			c.DatabaseURL = "postgres://postgres:hunter2@db:5432/office"

			for _, v := range c.SafetyViolations(ProfileProduction) {
				for field, text := range map[string]string{
					"Check": v.Check, "Setting": v.Setting, "Exposure": v.Exposure, "Fix": v.Fix,
				} {
					for _, secret := range []string{secretKeyPath, secretClientID, secretHost, "hunter2", c.DatabaseURL} {
						assert.NotContains(t, text, secret,
							"%s.%s must not echo a configured value", v.Check, field)
					}
				}
			}
		})

		t.Run("a fully safe configuration reports nothing", func(t *testing.T) {
			// US1 AS5
			c := safeProductionConfig()
			c.CORSAllowedOrigins = []string{"https://kiosk.example.com"}
			c.GoogleClientIDsRaw = "123.apps.googleusercontent.com"
			c.GoogleClientIDs = []string{"123.apps.googleusercontent.com"}

			assert.Empty(t, c.SafetyViolations(ProfileProduction))

			t.Run("and the process is allowed to start", func(t *testing.T) {
				profile, err := c.EnforceSafety(context.Background())
				require.NoError(t, err)
				assert.Equal(t, ProfileProduction, profile)
			})
		})

		t.Run("the refusal names every violation at once", func(t *testing.T) {
			// FR-008, FR-010, FR-011: the operator-facing shape, per
			// contracts/startup-report.md.
			c := &Config{
				JWTPrivateKeyPath:  "",
				WebappURL:          "http://localhost:13000",
				GoogleClientIDsRaw: " , ",
			}

			_, err := c.EnforceSafety(context.Background())
			require.Error(t, err)

			msg := err.Error()
			assert.Contains(t, msg, "refusing to start in the production profile")
			assert.Contains(t, msg, "3 safety checks failed")
			assert.Contains(t, msg, "JWT_PRIVATE_KEY_PATH")
			assert.Contains(t, msg, "WEBAPP_URL")
			assert.Contains(t, msg, "GOOGLE_CLIENT_IDS")
			assert.Contains(t, msg, "Exposes:")
			assert.Contains(t, msg, "Fix:")
			assert.Contains(t, msg, "Set APP_ENV=development")
		})

		t.Run("an unparseable profile is refused before any check is evaluated", func(t *testing.T) {
			// The severity of every check depends on the profile, so a profile that does
			// not resolve cannot be checked against.
			c := safeProductionConfig()
			c.AppEnvRaw = "staging"

			_, err := c.EnforceSafety(context.Background())
			require.Error(t, err)
			assert.Contains(t, err.Error(), "APP_ENV")
			assert.NotContains(t, err.Error(), "safety checks failed")
		})
	})

	t.Run("when the development profile is active", func(t *testing.T) {
		t.Run("the same violations are reported but are not fatal", func(t *testing.T) {
			// FR-009, SC-004: the local loop is unchanged in effort.
			c := &Config{
				AppEnvRaw:          "development",
				JWTPrivateKeyPath:  "",
				WebappURL:          "http://localhost:13000",
				GoogleClientIDsRaw: " , ",
			}

			assert.Equal(t,
				[]string{"durable-signing-key", "cross-origin", "sso-audience"},
				checksOf(c.SafetyViolations(ProfileDevelopment)))

			profile, err := c.EnforceSafety(context.Background())
			require.NoError(t, err, "a development start with violations must still start")
			assert.Equal(t, ProfileDevelopment, profile)
		})

		t.Run("each warning states it would prevent startup in production", func(t *testing.T) {
			// FR-009: a contributor sees the production verdict on their own machine.
			c := &Config{
				AppEnvRaw:         "development",
				JWTPrivateKeyPath: "",
				WebappURL:         "http://localhost:13000",
			}

			var buf bytes.Buffer
			restore := slog.Default()
			slog.SetDefault(slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelWarn})))
			_, err := c.EnforceSafety(context.Background())
			slog.SetDefault(restore)
			require.NoError(t, err)

			logged := buf.String()
			assert.Contains(t, logged, "would fail in the production profile")
			assert.Contains(t, logged, "durable-signing-key")
			assert.Contains(t, logged, "cross-origin")
			assert.Equal(t, 2, strings.Count(logged, "would fail in the production profile"),
				"one warning per violation")
		})
	})
}

func TestAllowedOrigins(t *testing.T) {
	t.Run("the workspace address becomes the allowed origin", func(t *testing.T) {
		// FR-016. A browser's Origin header carries no path and no trailing slash, and
		// rs/cors compares it literally, so the derived value must be normalised.
		for _, tc := range []struct{ webappURL, want string }{
			{"https://office.example.com", "https://office.example.com"},
			{"https://office.example.com/", "https://office.example.com"},
			{"https://office.example.com/app/inbox?x=1#top", "https://office.example.com"},
			{"https://office.example.com:8443/", "https://office.example.com:8443"},
		} {
			c := &Config{WebappURL: tc.webappURL}
			assert.Equal(t, []string{tc.want}, c.AllowedOrigins(ProfileProduction),
				"WEBAPP_URL=%q", tc.webappURL)
		}
	})

	t.Run("extra origins are appended to the workspace address", func(t *testing.T) {
		// FR-019
		c := &Config{
			WebappURL:          "https://office.example.com",
			CORSAllowedOrigins: []string{"https://admin.example.com", "https://kiosk.example.com"},
		}

		assert.Equal(t, []string{
			"https://office.example.com",
			"https://admin.example.com",
			"https://kiosk.example.com",
		}, c.AllowedOrigins(ProfileProduction))
	})

	t.Run("a whitespace-only origin list is treated as empty", func(t *testing.T) {
		// Edge case: getEnvStringSlice already drops blanks, but AllowedOrigins is also
		// called with a hand-built Config in tests and must not emit an empty origin.
		c := &Config{
			WebappURL:          "https://office.example.com",
			CORSAllowedOrigins: []string{"  ", ""},
		}

		assert.Equal(t, []string{"https://office.example.com"}, c.AllowedOrigins(ProfileProduction))
	})

	t.Run("the development profile allows every origin", func(t *testing.T) {
		// FR-020: byte-for-byte today's behaviour on a contributor's machine.
		c := &Config{
			WebappURL:          "https://office.example.com",
			CORSAllowedOrigins: []string{"https://admin.example.com"},
		}

		assert.Equal(t, []string{"*"}, c.AllowedOrigins(ProfileDevelopment))
	})
}

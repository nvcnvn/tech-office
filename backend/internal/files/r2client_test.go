package files

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestValidateR2Config(t *testing.T) {
	t.Run("reports missing required environment variables", func(t *testing.T) {
		err := validateR2Config(R2Config{})

		require.EqualError(t, err, "missing R2 configuration: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_ENDPOINT")
	})

	t.Run("accepts config when required fields are populated", func(t *testing.T) {
		err := validateR2Config(R2Config{
			AccessKeyID:     "access-key",
			SecretAccessKey: "secret-key",
			BucketName:      "bucket",
			Endpoint:        "https://example.r2.cloudflarestorage.com",
		})

		require.NoError(t, err)
	})
}

func TestValidateR2ConfigPublicURL(t *testing.T) {
	base := R2Config{
		AccessKeyID:     "access-key",
		SecretAccessKey: "secret-key",
		BucketName:      "bucket",
		Endpoint:        "https://example.r2.cloudflarestorage.com",
	}

	t.Run("rejects a custom domain without its HMAC secret", func(t *testing.T) {
		cfg := base
		cfg.PublicURL = "https://transformar.file.devguards.com"

		err := validateR2Config(cfg)

		require.EqualError(t, err, "missing R2 configuration: R2_PUBLIC_URL_HMAC_SECRET")
	})
}

func TestSignedPublicURL(t *testing.T) {
	client := &R2Client{
		publicURL:  "https://transformar.file.devguards.com",
		hmacSecret: "mysecrettoken",
	}

	t.Run("matches the MAC Cloudflare recomputes from the request URI", func(t *testing.T) {
		signed, expiresAt := client.signedPublicURL("org-1/chat/file-1", time.Hour)

		parsed, err := url.Parse(signed)
		require.NoError(t, err)
		require.Equal(t, "transformar.file.devguards.com", parsed.Host)
		require.Equal(t, "/org-1/chat/file-1", parsed.Path)
		require.WithinDuration(t, time.Now().Add(time.Hour), expiresAt, time.Minute)

		timestamp, token, found := strings.Cut(parsed.Query().Get("verify"), "-")
		require.True(t, found)

		mac := hmac.New(sha256.New, []byte("mysecrettoken"))
		mac.Write([]byte(parsed.Path + timestamp))
		require.Equal(t, base64.StdEncoding.EncodeToString(mac.Sum(nil)), token)
	})
}

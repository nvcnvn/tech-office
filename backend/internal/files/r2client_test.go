package files

import (
	"testing"

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

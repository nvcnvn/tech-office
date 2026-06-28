package voice

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLoadConfigFromEnvUsesSharedLiveKitKeys(t *testing.T) {
	t.Setenv("LIVEKIT_URL", "ws://livekit.example.com")
	t.Setenv("PUBLIC_LIVEKIT_URL", "wss://voice.example.com")
	t.Setenv("LIVEKIT_API_KEY", "")
	t.Setenv("LIVEKIT_API_SECRET", "")
	t.Setenv("LIVEKIT_KEYS", "prodkey: super-secret-value-1234567890")

	cfg, err := LoadConfigFromEnv()
	require.NoError(t, err)
	assert.Equal(t, "prodkey", cfg.LiveKitAPIKey)
	assert.Equal(t, "super-secret-value-1234567890", cfg.LiveKitAPISecret)
}

func TestLoadConfigFromEnvUsesSharedLiveKitSecretForMissingExplicitSecret(t *testing.T) {
	t.Setenv("LIVEKIT_URL", "ws://livekit.example.com")
	t.Setenv("PUBLIC_LIVEKIT_URL", "wss://voice.example.com")
	t.Setenv("LIVEKIT_API_KEY", "prodkey")
	t.Setenv("LIVEKIT_API_SECRET", "")
	t.Setenv("LIVEKIT_KEYS", "prodkey: shared-secret-1234567890")

	cfg, err := LoadConfigFromEnv()
	require.NoError(t, err)
	assert.Equal(t, "prodkey", cfg.LiveKitAPIKey)
	assert.Equal(t, "shared-secret-1234567890", cfg.LiveKitAPISecret)
}

func TestLoadConfigFromEnvPrefersExplicitLiveKitCredentials(t *testing.T) {
	t.Setenv("LIVEKIT_URL", "ws://livekit.example.com")
	t.Setenv("PUBLIC_LIVEKIT_URL", "wss://voice.example.com")
	t.Setenv("LIVEKIT_API_KEY", "explicit-key")
	t.Setenv("LIVEKIT_API_SECRET", "explicit-secret-1234567890")
	t.Setenv("LIVEKIT_KEYS", "prodkey: shared-secret-1234567890")

	cfg, err := LoadConfigFromEnv()
	require.NoError(t, err)
	assert.Equal(t, "explicit-key", cfg.LiveKitAPIKey)
	assert.Equal(t, "explicit-secret-1234567890", cfg.LiveKitAPISecret)
}

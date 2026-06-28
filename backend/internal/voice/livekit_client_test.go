package voice

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gopkg.in/yaml.v3"
)

type localLiveKitConfig struct {
	Keys map[string]string `yaml:"keys"`
	Turn struct {
		Enabled     bool   `yaml:"enabled"`
		Domain      string `yaml:"domain"`
		TLSPort     int    `yaml:"tls_port"`
		ExternalTLS bool   `yaml:"external_tls"`
	} `yaml:"turn"`
}

func TestMintJoinCredentialsUsesLiveKitOnlyJoinContract(t *testing.T) {
	cfg := Config{
		LiveKitURL:       "ws://localhost:7880",
		PublicLiveKitURL: "wss://voice.example.com",
		LiveKitAPIKey:    DefaultLiveKitAPIKey,
		LiveKitAPISecret: DefaultLiveKitAPISecret,
		JoinTokenTTL:     5 * time.Minute,
	}

	client := NewLiveKitClient(cfg)
	creds, err := client.MintJoinCredentials(context.Background(), JoinTokenOptions{
		EmployeeID: dbuuid.Must(),
		RoomName:   "room-123",
		Identity:   "voice_identity_123",
	})
	require.NoError(t, err)

	assert.Equal(t, cfg.PublicLiveKitURL, creds.LiveKitURL)
	assert.Equal(t, "room-123", creds.RoomName)
	assert.NotEmpty(t, creds.Token)
	assert.WithinDuration(t, time.Now().Add(cfg.JoinTokenTTL), creds.ExpiresAt, time.Minute)
}

func TestConfigValidateDoesNotRequireAppManagedTURN(t *testing.T) {
	cfg := Config{
		LiveKitURL:           "ws://localhost:7880",
		PublicLiveKitURL:     "wss://voice.example.com",
		LiveKitAPIKey:        DefaultLiveKitAPIKey,
		LiveKitAPISecret:     DefaultLiveKitAPISecret,
		JoinTokenTTL:         5 * time.Minute,
		MaxParticipants:      DefaultMaxParticipants,
		QualityPolicy:        QualityPolicyBalanced,
		AudioOnlyBitrateKbps: 48,
	}

	err := cfg.Validate()
	require.NoError(t, err)
}

func TestLocalLiveKitDockerConfigSupportsDevStartup(t *testing.T) {
	configPath := findLocalLiveKitConfig(t)
	configBytes, err := os.ReadFile(configPath)
	require.NoError(t, err)

	var cfg localLiveKitConfig
	require.NoError(t, yaml.Unmarshal(configBytes, &cfg))

	t.Run("the default API secret is long enough for LiveKit validation", func(t *testing.T) {
		secret, ok := cfg.Keys[DefaultLiveKitAPIKey]
		require.True(t, ok, "local LiveKit config must define the backend default API key")
		assert.Equal(t, DefaultLiveKitAPISecret, secret)
		assert.GreaterOrEqual(t, len(secret), 32)
	})

	t.Run("the local TURN TLS listener uses a valid development domain", func(t *testing.T) {
		assert.True(t, cfg.Turn.Enabled)
		assert.Equal(t, 5349, cfg.Turn.TLSPort)
		assert.True(t, cfg.Turn.ExternalTLS)
		assert.NotEqual(t, "localhost", cfg.Turn.Domain)
		assert.Contains(t, cfg.Turn.Domain, ".")
	})
}

func findLocalLiveKitConfig(t *testing.T) string {
	t.Helper()

	workingDirectory, err := os.Getwd()
	require.NoError(t, err)

	for currentDirectory := workingDirectory; ; currentDirectory = filepath.Dir(currentDirectory) {
		candidate := filepath.Join(currentDirectory, "docker", "livekit.yaml")
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}

		if strings.HasSuffix(currentDirectory, string(filepath.Separator)+"backend") {
			break
		}

		parentDirectory := filepath.Dir(currentDirectory)
		if parentDirectory == currentDirectory {
			break
		}
	}

	t.Fatalf("backend/docker/livekit.yaml was not found from %s", workingDirectory)
	return ""
}

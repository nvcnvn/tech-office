package voice

import (
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	DefaultLiveKitAPIKey    = "devkey"
	DefaultLiveKitAPISecret = "devsecretdevsecretdevsecretdevsecret"

	QualityPolicyBalanced     = "balanced"
	QualityPolicyLowBandwidth = "low_bandwidth"
	QualityPolicyHighQuality  = "high_quality"
)

type Config struct {
	LiveKitURL       string
	PublicLiveKitURL string
	LiveKitAPIKey    string
	LiveKitAPISecret string
	JoinTokenTTL     time.Duration

	MaxParticipants int
	QualityPolicy   string

	AudioOnlyBitrateKbps int

	RecordingEnabled         bool
	RecordingBucket          string
	RecordingEndpoint        string
	RecordingRegion          string
	RecordingAccessKeyID     string
	RecordingSecretAccessKey string
	RecordingForcePathStyle  bool
	RecordingPrefix          string

	TranscriptionEnabled bool
	WhisperAPIKey        string
	WhisperAPIURL        string
	WhisperModel         string
	WhisperLanguage      string
}

type liveKitCredentialPair struct {
	APIKey    string
	APISecret string
}

func LoadConfigFromEnv() (Config, error) {
	liveKitAPIKey, liveKitAPISecret := resolveLiveKitCredentialsFromEnv()

	cfg := Config{
		LiveKitURL:               getEnv("LIVEKIT_URL", "ws://localhost:7880"),
		PublicLiveKitURL:         getEnv("PUBLIC_LIVEKIT_URL", ""),
		LiveKitAPIKey:            liveKitAPIKey,
		LiveKitAPISecret:         liveKitAPISecret,
		JoinTokenTTL:             getEnvDuration("VOICE_JOIN_TOKEN_TTL", 5*time.Minute),
		MaxParticipants:          getEnvInt("VOICE_MAX_PARTICIPANTS", DefaultMaxParticipants),
		QualityPolicy:            getEnv("VOICE_QUALITY_POLICY", QualityPolicyBalanced),
		AudioOnlyBitrateKbps:     getEnvInt("VOICE_AUDIO_ONLY_BITRATE_KBPS", 48),
		RecordingEnabled:         getEnvBool("VOICE_RECORDING_ENABLED", false),
		RecordingBucket:          getEnv("VOICE_RECORDING_BUCKET", getEnv("R2_BUCKET_NAME", "")),
		RecordingEndpoint:        getEnv("VOICE_RECORDING_ENDPOINT", getEnv("R2_ENDPOINT", "")),
		RecordingRegion:          getEnv("VOICE_RECORDING_REGION", "auto"),
		RecordingAccessKeyID:     getEnv("VOICE_RECORDING_ACCESS_KEY_ID", getEnv("R2_ACCESS_KEY_ID", "")),
		RecordingSecretAccessKey: getEnv("VOICE_RECORDING_SECRET_ACCESS_KEY", getEnv("R2_SECRET_ACCESS_KEY", "")),
		RecordingForcePathStyle:  getEnvBool("VOICE_RECORDING_FORCE_PATH_STYLE", true),
		RecordingPrefix:          getEnv("VOICE_RECORDING_PREFIX", "voice-recordings"),
		TranscriptionEnabled:     getEnvBool("VOICE_TRANSCRIPTION_ENABLED", false),
		WhisperAPIKey:            getEnv("WHISPER_API_KEY", ""),
		WhisperAPIURL:            getEnv("WHISPER_API_URL", "https://api.openai.com/v1"),
		WhisperModel:             getEnv("WHISPER_MODEL", "whisper-1"),
		WhisperLanguage:          getEnv("WHISPER_LANGUAGE", ""),
	}
	if cfg.PublicLiveKitURL == "" {
		cfg.PublicLiveKitURL = cfg.LiveKitURL
	}
	return cfg, cfg.Validate()
}

func resolveLiveKitCredentialsFromEnv() (string, string) {
	apiKey := strings.TrimSpace(os.Getenv("LIVEKIT_API_KEY"))
	apiSecret := strings.TrimSpace(os.Getenv("LIVEKIT_API_SECRET"))
	parsedKeys := parseLiveKitKeys(os.Getenv("LIVEKIT_KEYS"))

	if apiKey == "" && apiSecret == "" && len(parsedKeys) > 0 {
		return parsedKeys[0].APIKey, parsedKeys[0].APISecret
	}

	if apiKey != "" && apiSecret == "" {
		for _, pair := range parsedKeys {
			if pair.APIKey == apiKey {
				apiSecret = pair.APISecret
				break
			}
		}
	}

	if apiKey == "" && apiSecret != "" {
		for _, pair := range parsedKeys {
			if pair.APISecret == apiSecret {
				apiKey = pair.APIKey
				break
			}
		}
	}

	if apiKey == "" && apiSecret == "" {
		return DefaultLiveKitAPIKey, DefaultLiveKitAPISecret
	}

	return apiKey, apiSecret
}

func parseLiveKitKeys(raw string) []liveKitCredentialPair {
	lines := strings.Split(raw, "\n")
	pairs := make([]liveKitCredentialPair, 0, len(lines))

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}

		parts := strings.SplitN(trimmed, ":", 2)
		if len(parts) != 2 {
			continue
		}

		apiKey := strings.Trim(strings.TrimSpace(parts[0]), `"'`)
		apiSecret := strings.Trim(strings.TrimSpace(parts[1]), `"'`)
		if apiKey == "" || apiSecret == "" {
			continue
		}

		pairs = append(pairs, liveKitCredentialPair{
			APIKey:    apiKey,
			APISecret: apiSecret,
		})
	}

	return pairs
}

func (c Config) Validate() error {
	if err := validateURL("LIVEKIT_URL", c.LiveKitURL, "ws", "wss", "http", "https"); err != nil {
		return err
	}
	if err := validateURL("PUBLIC_LIVEKIT_URL", c.PublicLiveKitURL, "ws", "wss", "http", "https"); err != nil {
		return err
	}
	if strings.TrimSpace(c.LiveKitAPIKey) == "" {
		return fmt.Errorf("LIVEKIT_API_KEY is required")
	}
	if strings.TrimSpace(c.LiveKitAPISecret) == "" {
		return fmt.Errorf("LIVEKIT_API_SECRET is required")
	}
	if c.JoinTokenTTL <= 0 || c.JoinTokenTTL > 15*time.Minute {
		return fmt.Errorf("VOICE_JOIN_TOKEN_TTL must be between 1ns and 15m")
	}
	if c.MaxParticipants < 2 || c.MaxParticipants > 100 {
		return fmt.Errorf("VOICE_MAX_PARTICIPANTS must be between 2 and 100")
	}
	if !isValidQualityPolicy(c.QualityPolicy) {
		return fmt.Errorf("VOICE_QUALITY_POLICY must be one of %s, %s, %s", QualityPolicyBalanced, QualityPolicyLowBandwidth, QualityPolicyHighQuality)
	}
	if c.AudioOnlyBitrateKbps < 16 || c.AudioOnlyBitrateKbps > 128 {
		return fmt.Errorf("VOICE_AUDIO_ONLY_BITRATE_KBPS must be between 16 and 128")
	}
	if c.RecordingEnabled {
		missingRecording := make([]string, 0, 3)
		if strings.TrimSpace(c.RecordingBucket) == "" {
			missingRecording = append(missingRecording, "VOICE_RECORDING_BUCKET")
		}
		if strings.TrimSpace(c.RecordingAccessKeyID) == "" {
			missingRecording = append(missingRecording, "VOICE_RECORDING_ACCESS_KEY_ID")
		}
		if strings.TrimSpace(c.RecordingSecretAccessKey) == "" {
			missingRecording = append(missingRecording, "VOICE_RECORDING_SECRET_ACCESS_KEY")
		}
		if len(missingRecording) > 0 {
			return fmt.Errorf("missing recording configuration: %s", strings.Join(missingRecording, ", "))
		}
		if strings.TrimSpace(c.RecordingEndpoint) != "" {
			if err := validateURL("VOICE_RECORDING_ENDPOINT", c.RecordingEndpoint, "http", "https"); err != nil {
				return err
			}
		}
	}
	return nil
}

func isValidQualityPolicy(policy string) bool {
	switch policy {
	case QualityPolicyBalanced, QualityPolicyLowBandwidth, QualityPolicyHighQuality:
		return true
	default:
		return false
	}
}

func validateURL(name, raw string, allowedSchemes ...string) error {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme == "" || (parsed.Host == "" && parsed.Opaque == "") {
		return fmt.Errorf("%s must be a valid URL", name)
	}
	for _, scheme := range allowedSchemes {
		if parsed.Scheme == scheme {
			return nil
		}
	}
	return fmt.Errorf("%s must use one of these schemes: %s", name, strings.Join(allowedSchemes, ", "))
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getEnvInt(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		parsed, err := strconv.Atoi(value)
		if err == nil {
			return parsed
		}
	}
	return defaultValue
}

func getEnvBool(key string, defaultValue bool) bool {
	if value := os.Getenv(key); value != "" {
		parsed, err := strconv.ParseBool(value)
		if err == nil {
			return parsed
		}
	}
	return defaultValue
}

func getEnvDuration(key string, defaultValue time.Duration) time.Duration {
	if value := os.Getenv(key); value != "" {
		parsed, err := time.ParseDuration(value)
		if err == nil {
			return parsed
		}
	}
	return defaultValue
}

package config

import (
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/joho/godotenv"
)

type Config struct {
	ServerPort           string
	MetricsPort          string
	DatabaseURL          string
	FlowShardCount       int
	PostgresDB           string
	PostgresUser         string
	PostgresPassword     string
	WebappURL            string
	AWSRegion            string
	InstanceID           string // Backend instance identifier for notification routing
	GoogleAppCredentials string // Path to Google service account JSON for FCM

	// Internal JWT settings (IAM auth)
	JWTPrivateKeyPath string
	JWTPublicKeyPath  string

	// SSO audience validation — comma-separated lists of OAuth client/service IDs
	// that the backend will accept in the `aud` claim of Google/Apple id_tokens.
	// If empty, audience validation is skipped (dev-only fallback).
	GoogleClientIDs []string
	AppleClientIDs  []string

	// File Storage (Cloudflare R2)
	R2AccountID         string
	R2AccessKeyID       string
	R2SecretAccessKey   string
	R2BucketName        string
	R2Endpoint          string
	R2PublicURL         string
	SESFromEmail        string
	SESReplyToEmail     string
	SESConfigurationSet string
	DefaultMaxFileSize  int64
	DefaultQuotaBytes   int64
	ClamAVHost          string
	ClamAVPort          string
	GotenbergURL        string // Base URL for Gotenberg API (Office->PDF)
}

var (
	instance *Config
	once     sync.Once
)

// Get returns the singleton config instance
func Get() *Config {
	once.Do(func() {
		instance = load()
	})
	return instance
}

func load() *Config {
	// Load .env file from project root
	if err := loadEnvFile(); err != nil {
		slog.Info("Could not load .env file", "error", err)
	}

	return &Config{
		ServerPort:           getEnv("SERVER_PORT", "18080"),
		MetricsPort:          getEnv("METRICS_PORT", "18090"),
		DatabaseURL:          getEnv("DATABASE_URL", ""),
		FlowShardCount:       getEnvInt("FLOW_SHARD_COUNT", 32),
		PostgresDB:           getEnv("POSTGRES_DB", "office"),
		PostgresUser:         getEnv("POSTGRES_USER", "postgres"),
		PostgresPassword:     getEnv("POSTGRES_PASSWORD", ""),
		WebappURL:            getEnv("WEBAPP_URL", "http://localhost:13000"),
		AWSRegion:            getEnv("AWS_REGION", ""),
		InstanceID:           getEnv("INSTANCE_ID", generateDefaultInstanceID()),
		JWTPrivateKeyPath:    getEnv("JWT_PRIVATE_KEY_PATH", ""),
		JWTPublicKeyPath:     getEnv("JWT_PUBLIC_KEY_PATH", ""),
		GoogleAppCredentials: getEnv("GOOGLE_APPLICATION_CREDENTIALS", ""),
		GoogleClientIDs:      getEnvStringSlice("GOOGLE_CLIENT_IDS"),
		AppleClientIDs:       getEnvStringSlice("APPLE_CLIENT_IDS"),
		R2AccountID:          getEnv("R2_ACCOUNT_ID", ""),
		R2AccessKeyID:        getEnv("R2_ACCESS_KEY_ID", ""),
		R2SecretAccessKey:    getEnv("R2_SECRET_ACCESS_KEY", ""),
		R2BucketName:         getEnv("R2_BUCKET_NAME", ""),
		R2Endpoint:           getEnv("R2_ENDPOINT", ""),
		R2PublicURL:          getEnv("R2_PUBLIC_URL", ""),
		SESFromEmail:         getEnv("SES_FROM_EMAIL", ""),
		SESReplyToEmail:      getEnv("SES_REPLY_TO_EMAIL", ""),
		SESConfigurationSet:  getEnv("SES_CONFIGURATION_SET", ""),
		DefaultMaxFileSize:   getEnvInt64("DEFAULT_MAX_FILE_SIZE_BYTES", 104857600), // 100MB
		DefaultQuotaBytes:    getEnvInt64("DEFAULT_QUOTA_BYTES", 0),                 // 0 = unlimited
		ClamAVHost:           getEnv("CLAMAV_HOST", "localhost"),
		ClamAVPort:           getEnv("CLAMAV_PORT", "3310"),
		GotenbergURL:         getEnv("GOTENBERG_URL", "http://localhost:18081"),
	}
}

func loadEnvFile() error {
	// Try to find .env file starting from current directory and going up
	dir, err := os.Getwd()
	if err != nil {
		return err
	}

	for {
		envPath := filepath.Join(dir, ".env")
		if _, err := os.Stat(envPath); err == nil {
			return godotenv.Load(envPath)
		}

		parent := filepath.Dir(dir)
		if parent == dir {
			break // reached root directory
		}
		dir = parent
	}

	return fmt.Errorf(".env file not found")
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getEnvInt64(key string, defaultValue int64) int64 {
	if value := os.Getenv(key); value != "" {
		// Use fmt.Sscanf for simple parsing
		var result int64
		if _, err := fmt.Sscanf(value, "%d", &result); err == nil {
			return result
		}
	}
	return defaultValue
}

func getEnvInt(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		var result int
		if _, err := fmt.Sscanf(value, "%d", &result); err == nil {
			return result
		}
	}
	return defaultValue
}

// getEnvStringSlice reads a comma-separated env var and returns a trimmed, non-empty slice.
func getEnvStringSlice(key string) []string {
	value := os.Getenv(key)
	if value == "" {
		return nil
	}
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if s := strings.TrimSpace(p); s != "" {
			out = append(out, s)
		}
	}
	return out
}

// generateDefaultInstanceID creates a unique instance identifier for this backend instance.
// Uses hostname + process ID for local development. In production, use INSTANCE_ID env var.
func generateDefaultInstanceID() string {
	hostname, err := os.Hostname()
	if err != nil {
		hostname = "unknown"
	}
	return fmt.Sprintf("%s-%d", hostname, os.Getpid())
}

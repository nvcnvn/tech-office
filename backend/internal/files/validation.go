package files

import (
	"context"
	"fmt"
	"io"
	"log/slog"

	"github.com/h2non/filetype"
)

// ValidationResult contains the result of file type validation
type ValidationResult struct {
	Status           string // "pending", "verified", "warning", "failed", "skipped"
	Message          string
	DeclaredMimeType string
	DetectedMimeType string
}

// ValidateFileType validates file type by reading magic bytes from R2
// Returns ValidationResult indicating whether declared MIME type matches detected type
// Policy: WARN on mismatch, don't block upload (security by visibility, not rejection)
func ValidateFileType(ctx context.Context, r2Client *R2Client, storageKey string, declaredMimeType string) (*ValidationResult, error) {
	slog.DebugContext(ctx, "ValidateFileType",
		"storage_key", storageKey,
		"declared_mime_type", declaredMimeType)

	// Read first 8KB from R2 for magic byte detection
	// This is sufficient for filetype library to detect most file types
	const headerSize = 8192

	// Read file header from R2
	header, err := r2Client.ReadRange(ctx, storageKey, 0, headerSize)
	if err != nil && err != io.EOF {
		slog.ErrorContext(ctx, "failed to read file header from R2",
			"error", err,
			"storage_key", storageKey)
		return nil, fmt.Errorf("failed to read file for validation: %w", err)
	}

	// Detect file type from magic bytes
	kind, err := filetype.Match(header)
	if err != nil {
		// Unknown file type - could be text file or unsupported binary
		slog.WarnContext(ctx, "file type detection failed",
			"error", err,
			"storage_key", storageKey)
		return &ValidationResult{
			Status:           ValidationStatusSkipped,
			Message:          "Unable to detect file type from content",
			DeclaredMimeType: declaredMimeType,
			DetectedMimeType: "",
		}, nil
	}

	detectedMimeType := kind.MIME.Value

	// Compare detected vs declared MIME type
	if detectedMimeType == "" {
		// Unknown type, skip validation
		slog.InfoContext(ctx, "file type unknown, skipping validation",
			"storage_key", storageKey,
			"declared_mime_type", declaredMimeType)
		return &ValidationResult{
			Status:           ValidationStatusSkipped,
			Message:          "File type could not be determined",
			DeclaredMimeType: declaredMimeType,
			DetectedMimeType: "",
		}, nil
	}

	if detectedMimeType == declaredMimeType {
		// Perfect match
		slog.InfoContext(ctx, "file type verified",
			"storage_key", storageKey,
			"mime_type", declaredMimeType)
		return &ValidationResult{
			Status:           ValidationStatusVerified,
			Message:          "File type matches declared type",
			DeclaredMimeType: declaredMimeType,
			DetectedMimeType: detectedMimeType,
		}, nil
	}

	// Type mismatch - WARN but don't block
	slog.WarnContext(ctx, "file type mismatch detected",
		"storage_key", storageKey,
		"declared_mime_type", declaredMimeType,
		"detected_mime_type", detectedMimeType)

	return &ValidationResult{
		Status:           ValidationStatusWarning,
		Message:          fmt.Sprintf("File type mismatch: declared as %s but appears to be %s", declaredMimeType, detectedMimeType),
		DeclaredMimeType: declaredMimeType,
		DetectedMimeType: detectedMimeType,
	}, nil
}

// IsEligibleForValidation checks if file should be validated based on MIME type
// Some file types don't have reliable magic bytes (e.g., plain text, JSON)
func IsEligibleForValidation(mimeType string) bool {
	// Skip validation for text-based formats (no magic bytes)
	skipTypes := map[string]bool{
		"text/plain":       true,
		"text/html":        true,
		"text/css":         true,
		"text/javascript":  true,
		"application/json": true,
		"application/xml":  true,
		"text/xml":         true,
		"text/csv":         true,
		"text/markdown":    true,
	}

	return !skipTypes[mimeType]
}

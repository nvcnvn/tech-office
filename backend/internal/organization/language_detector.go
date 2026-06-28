package organization

import (
	"log/slog"
	"sync"

	"github.com/pemistahl/lingua-go"
)

// Language code constants (ISO 639-1)
// MUST align with database CHECK constraint in chat.message.language
// and frontend TypeScript types
const (
	LangEnglish    = "en"
	LangMandarin   = "zh"
	LangSpanish    = "es"
	LangHindi      = "hi"
	LangGerman     = "de"
	LangJapanese   = "ja"
	LangFrench     = "fr"
	LangPortuguese = "pt"
	LangVietnamese = "vi"
	LangUnknown    = "unknown"
)

var (
	languageDetector     lingua.LanguageDetector
	languageDetectorOnce sync.Once
)

// GetLanguageDetector returns a singleton instance of the lingua-go language detector.
// The detector is initialized with the 9 supported languages:
// English, Mandarin Chinese, Spanish, Hindi, German, Japanese, French, Portuguese, Vietnamese.
func GetLanguageDetector() lingua.LanguageDetector {
	languageDetectorOnce.Do(func() {
		slog.Info("initializing lingua-go language detector",
			"languages", []string{
				LangEnglish, LangMandarin, LangSpanish, LangHindi, LangGerman,
				LangJapanese, LangFrench, LangPortuguese, LangVietnamese,
			})

		languageDetector = lingua.NewLanguageDetectorBuilder().
			FromLanguages(
				lingua.English,
				lingua.Chinese,
				lingua.Spanish,
				lingua.Hindi,
				lingua.German,
				lingua.Japanese,
				lingua.French,
				lingua.Portuguese,
				lingua.Vietnamese,
			).
			Build()

		slog.Info("lingua-go language detector initialized successfully")
	})
	return languageDetector
}

// DetectLanguage detects the language of the given text and returns an ISO 639-1 language code.
// Returns "unknown" if the language cannot be detected or if the text is too short.
//
// Supported languages: en, zh, es, hi, de, ja, fr, pt, vi
func DetectLanguage(text string) string {
	if text == "" {
		return LangUnknown
	}

	// Short text may not have enough information for reliable detection
	if len(text) < 20 {
		slog.Debug("text too short for reliable language detection",
			"textLength", len(text),
			"text", text)
		return LangUnknown
	}

	detector := GetLanguageDetector()
	detectedLanguage, exists := detector.DetectLanguageOf(text)

	if !exists {
		slog.Debug("language detection failed",
			"textLength", len(text),
			"textPreview", truncateText(text, 50))
		return LangUnknown
	}

	code := convertLinguaLanguageToISO(detectedLanguage)
	slog.Debug("language detected",
		"language", code,
		"textLength", len(text),
		"textPreview", truncateText(text, 50))

	return code
}

// convertLinguaLanguageToISO converts lingua.Language to ISO 639-1 code
func convertLinguaLanguageToISO(lang lingua.Language) string {
	switch lang {
	case lingua.English:
		return LangEnglish
	case lingua.Chinese:
		return LangMandarin
	case lingua.Spanish:
		return LangSpanish
	case lingua.Hindi:
		return LangHindi
	case lingua.German:
		return LangGerman
	case lingua.Japanese:
		return LangJapanese
	case lingua.French:
		return LangFrench
	case lingua.Portuguese:
		return LangPortuguese
	case lingua.Vietnamese:
		return LangVietnamese
	default:
		return LangUnknown
	}
}

// truncateText truncates text to maxLen characters for logging
func truncateText(text string, maxLen int) string {
	if len(text) <= maxLen {
		return text
	}
	return text[:maxLen] + "..."
}

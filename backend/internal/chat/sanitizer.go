package chat

import (
	stdhtml "html"
	"strings"
	"unicode/utf8"

	"github.com/microcosm-cc/bluemonday"
	golanghtml "golang.org/x/net/html"
)

// isHTMLContentEmpty returns true if the HTML contains no visible text.
// This catches cases like "<p></p>", "<p><br></p>", "<p> </p>" that pass
// a raw length check but have no actual user-visible content.
func isHTMLContentEmpty(html string) bool {
	return strings.TrimSpace(extractPlainTextFromHTML(html)) == ""
}

// sanitizeMessageHTML sanitizes user-provided HTML to prevent XSS attacks.
// Allows only safe formatting tags: <b>, <strong>, <i>, <em>, <u>, <code>, <pre>, <a>, <ul>, <ol>, <li>, <p>, <br>
// Allows mention spans: <span data-type="mention" data-id="[uuid]" data-label="[name]">
// Strips all dangerous tags, attributes (except allowed), JavaScript, and styles.
// Plaintext input (no HTML tags) passes through unchanged.
func sanitizeMessageHTML(html string) string {
	// Create a strict policy that only allows specific tags
	policy := bluemonday.NewPolicy()

	// Text formatting
	policy.AllowElements("b", "strong", "i", "em", "u")

	// Code
	policy.AllowElements("code", "pre")

	// Links (only allow href attribute with http/https protocols)
	policy.AllowAttrs("href").OnElements("a")
	policy.AllowURLSchemes("http", "https", "mailto") // Only safe protocols
	policy.RequireNoFollowOnLinks(true)               // Add rel="nofollow" for security

	// Lists
	policy.AllowElements("ul", "ol", "li")

	// Paragraphs and line breaks
	policy.AllowElements("p", "br")

	// Mentions (TipTap format): <span data-type="mention" data-id="[id]" data-label="[label]">@label</span>
	policy.AllowElements("span")
	policy.AllowAttrs("data-type", "data-id", "data-label", "class").OnElements("span")

	// Sanitize the HTML
	sanitized := policy.Sanitize(html)

	// Trim whitespace
	return strings.TrimSpace(sanitized)
}

func messageNotificationPreview(htmlText string, maxRunes int) string {
	plainText := extractPlainTextFromHTML(htmlText)
	if plainText == "" || maxRunes <= 0 {
		return ""
	}

	if utf8.RuneCountInString(plainText) <= maxRunes {
		return plainText
	}

	runes := []rune(plainText)
	if maxRunes <= 3 {
		return string(runes[:maxRunes])
	}

	return string(runes[:maxRunes-3]) + "..."
}

func extractPlainTextFromHTML(htmlText string) string {
	tokenizer := golanghtml.NewTokenizer(strings.NewReader(htmlText))
	var builder strings.Builder
	lastRune := rune(0)
	hasContent := false

	for {
		tokenType := tokenizer.Next()
		switch tokenType {
		case golanghtml.ErrorToken:
			return strings.TrimSpace(builder.String())
		case golanghtml.TextToken:
			text := normalizePreviewText(tokenizer.Token().Data)
			if text == "" {
				continue
			}
			if hasContent && shouldInsertPreviewSpace(lastRune, []rune(text)[0]) {
				builder.WriteByte(' ')
			}
			builder.WriteString(text)
			lastRune = []rune(text)[len([]rune(text))-1]
			hasContent = true
		case golanghtml.StartTagToken, golanghtml.EndTagToken, golanghtml.SelfClosingTagToken:
			token := tokenizer.Token()
			if !hasContent {
				continue
			}
			if isPreviewSeparatorTag(token.Data) && lastRune != ' ' {
				builder.WriteByte(' ')
				lastRune = ' '
			}
		}
	}
}

func normalizePreviewText(text string) string {
	return strings.Join(strings.Fields(stdhtml.UnescapeString(text)), " ")
}

func shouldInsertPreviewSpace(previous, next rune) bool {
	if previous == 0 || previous == ' ' {
		return false
	}
	if strings.ContainsRune(",.;:!?)]}", next) {
		return false
	}
	if strings.ContainsRune("([{", previous) {
		return false
	}
	return true
}

func isPreviewSeparatorTag(tag string) bool {
	switch strings.ToLower(tag) {
	case "br", "p", "div", "li", "ul", "ol", "pre", "blockquote":
		return true
	default:
		return false
	}
}

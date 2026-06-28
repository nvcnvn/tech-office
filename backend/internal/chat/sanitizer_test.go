package chat

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestSanitizeMessageHTML(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "plaintext passes through unchanged",
			input:    "Hello, world!",
			expected: "Hello, world!",
		},
		{
			name:     "bold tag preserved",
			input:    "This is <b>bold</b> text",
			expected: "This is <b>bold</b> text",
		},
		{
			name:     "strong tag preserved",
			input:    "This is <strong>important</strong> text",
			expected: "This is <strong>important</strong> text",
		},
		{
			name:     "italic tag preserved",
			input:    "This is <i>italic</i> text",
			expected: "This is <i>italic</i> text",
		},
		{
			name:     "em tag preserved",
			input:    "This is <em>emphasized</em> text",
			expected: "This is <em>emphasized</em> text",
		},
		{
			name:     "underline tag preserved",
			input:    "This is <u>underlined</u> text",
			expected: "This is <u>underlined</u> text",
		},
		{
			name:     "code tag preserved",
			input:    "This is <code>code</code> text",
			expected: "This is <code>code</code> text",
		},
		{
			name:     "pre tag preserved",
			input:    "<pre>Code block\nLine 2</pre>",
			expected: "<pre>Code block\nLine 2</pre>",
		},
		{
			name:     "link with href preserved",
			input:    `<a href="https://example.com">Link</a>`,
			expected: `<a href="https://example.com" rel="nofollow">Link</a>`,
		},
		{
			name:     "bullet list preserved",
			input:    "<ul><li>Item 1</li><li>Item 2</li></ul>",
			expected: "<ul><li>Item 1</li><li>Item 2</li></ul>",
		},
		{
			name:     "numbered list preserved",
			input:    "<ol><li>First</li><li>Second</li></ol>",
			expected: "<ol><li>First</li><li>Second</li></ol>",
		},
		{
			name:     "paragraph preserved",
			input:    "<p>This is a paragraph.</p>",
			expected: "<p>This is a paragraph.</p>",
		},
		{
			name:     "br tag preserved",
			input:    "Line 1<br>Line 2",
			expected: "Line 1<br>Line 2",
		},
		{
			name:     "script tag stripped (XSS prevention)",
			input:    `Hello <script>alert('xss')</script> world`,
			expected: "Hello  world",
		},
		{
			name:     "img tag stripped",
			input:    `<img src="x" onerror="alert('xss')">`,
			expected: "",
		},
		{
			name:     "onclick attribute stripped (fragment link removed)",
			input:    `<a href="#" onclick="alert('xss')">Link</a>`,
			expected: `Link`, // # is not an allowed scheme, link is removed
		},
		{
			name:     "style attribute stripped",
			input:    `<p style="color: red;">Styled text</p>`,
			expected: "<p>Styled text</p>",
		},
		{
			name:     "class attribute stripped",
			input:    `<p class="danger">Text</p>`,
			expected: "<p>Text</p>",
		},
		{
			name:     "div tag stripped",
			input:    "<div>Content</div>",
			expected: "Content",
		},
		{
			name:     "iframe stripped (XSS prevention)",
			input:    `<iframe src="https://evil.com"></iframe>`,
			expected: "",
		},
		{
			name:     "javascript: protocol stripped",
			input:    `<a href="javascript:alert('xss')">Link</a>`,
			expected: "Link",
		},
		{
			name:     "data: protocol stripped",
			input:    `<a href="data:text/html,<script>alert('xss')</script>">Link</a>`,
			expected: "Link",
		},
		{
			name:     "mixed formatting preserved",
			input:    "This is <b>bold</b> and <i>italic</i> and <code>code</code>",
			expected: "This is <b>bold</b> and <i>italic</i> and <code>code</code>",
		},
		{
			name:     "nested allowed tags preserved",
			input:    "<p>This is <b>bold <i>and italic</i></b> text</p>",
			expected: "<p>This is <b>bold <i>and italic</i></b> text</p>",
		},
		{
			name:     "empty string returns empty",
			input:    "",
			expected: "",
		},
		{
			name:     "whitespace trimmed",
			input:    "  <p>Text</p>  ",
			expected: "<p>Text</p>",
		},
		{
			name:     "multiple script tags stripped",
			input:    `<script>alert(1)</script>Hello<script>alert(2)</script>`,
			expected: "Hello",
		},
		{
			name:     "event handlers stripped from all elements",
			input:    `<p onload="alert('xss')">Text</p><b onclick="alert('xss')">Bold</b>`,
			expected: "<p>Text</p><b>Bold</b>",
		},
		{
			name:     "svg with script stripped",
			input:    `<svg><script>alert('xss')</script></svg>`,
			expected: "",
		},
		{
			name:     "object tag stripped",
			input:    `<object data="data:text/html,<script>alert('xss')</script>"></object>`,
			expected: "",
		},
		{
			name:     "embed tag stripped",
			input:    `<embed src="data:text/html,<script>alert('xss')</script>">`,
			expected: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := sanitizeMessageHTML(tt.input)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestSanitizeMessageHTML_RealWorldExamples(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name: "formatted message with mentions",
			input: `<p>Hey <b>@john</b>, can you review this <a href="https://github.com/org/repo/pull/123">PR</a>?</p>
<ul>
<li>Added feature X</li>
<li>Fixed bug Y</li>
</ul>
<p>Thanks!</p>`,
			expected: `<p>Hey <b>@john</b>, can you review this <a href="https://github.com/org/repo/pull/123" rel="nofollow">PR</a>?</p>
<ul>
<li>Added feature X</li>
<li>Fixed bug Y</li>
</ul>
<p>Thanks!</p>`,
		},
		{
			name: "code block with syntax highlighting attempt (stripped)",
			input: `<p>Here's the code:</p>
<pre><code class="language-javascript">
function hello() {
  console.log('Hello');
}
</code></pre>`,
			expected: `<p>Here&#39;s the code:</p>
<pre><code>
function hello() {
  console.log(&#39;Hello&#39;);
}
</code></pre>`,
		},
		{
			name: "numbered list with bold items",
			input: `<p>Steps to reproduce:</p>
<ol>
<li><b>Step 1:</b> Open the app</li>
<li><b>Step 2:</b> Click settings</li>
<li><b>Step 3:</b> See the bug</li>
</ol>`,
			expected: `<p>Steps to reproduce:</p>
<ol>
<li><b>Step 1:</b> Open the app</li>
<li><b>Step 2:</b> Click settings</li>
<li><b>Step 3:</b> See the bug</li>
</ol>`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := sanitizeMessageHTML(tt.input)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestIsHTMLContentEmpty(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected bool
	}{
		{
			name:     "empty string is empty",
			input:    "",
			expected: true,
		},
		{
			name:     "plain text is not empty",
			input:    "Hello, world!",
			expected: false,
		},
		{
			name:     "empty paragraph tag is empty",
			input:    "<p></p>",
			expected: true,
		},
		{
			name:     "paragraph with only br is empty",
			input:    "<p><br></p>",
			expected: true,
		},
		{
			name:     "paragraph with whitespace is empty",
			input:    "<p> </p>",
			expected: true,
		},
		{
			name:     "multiple empty paragraphs are empty",
			input:    "<p></p><p><br></p>",
			expected: true,
		},
		{
			name:     "paragraph with text is not empty",
			input:    "<p>Hello</p>",
			expected: false,
		},
		{
			name:     "bold text is not empty",
			input:    "<b>bold</b>",
			expected: false,
		},
		{
			name:     "mention span is not empty",
			input:    `<span data-type="mention" data-id="123" data-label="John">@John</span>`,
			expected: false,
		},
		{
			name:     "whitespace-only string is empty",
			input:    "   \n\t  ",
			expected: true,
		},
		{
			name:     "list with empty items is empty",
			input:    "<ul><li></li><li></li></ul>",
			expected: true,
		},
		{
			name:     "list with text is not empty",
			input:    "<ul><li>Item 1</li></ul>",
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := isHTMLContentEmpty(tt.input)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestMessageNotificationPreview(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		maxRunes int
		expected string
	}{
		{
			name:     "strips tags and preserves mention punctuation",
			input:    `<p>Hello <span data-type="mention" data-id="123" data-label="John">@John</span>, review &amp; ship<br><b>today</b>.</p>`,
			maxRunes: 200,
			expected: "Hello @John, review & ship today.",
		},
		{
			name:     "truncates by rune count",
			input:    strings.Repeat("ấ", 7),
			maxRunes: 5,
			expected: "ấấ...",
		},
		{
			name:     "returns empty for HTML-only content with no text",
			input:    `<p></p><br><ul><li></li></ul>`,
			maxRunes: 200,
			expected: "",
		},
		{
			name:     "returns empty for whitespace-only content",
			input:    "   \n\t  ",
			maxRunes: 200,
			expected: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expected, messageNotificationPreview(tt.input, tt.maxRunes))
		})
	}
}

package collaboration

import (
	"strings"
	"testing"
)

// TestTitleFromMessageBody covers the string transformation that decides what the quick
// sheet opens with. It is a unit test rather than an integration scenario because it has
// no I/O at all: the interesting cases are formatting, whitespace and boundary conditions,
// which are cheaper and more exhaustively covered here than through an RPC.
func TestTitleFromMessageBody(t *testing.T) {
	longWord := strings.Repeat("x", MaxTaskTitleLength+40)

	tests := []struct {
		name string
		body string
		want string
	}{
		{
			name: "plain text passes through unchanged",
			body: "Ship the invoice export",
			want: "Ship the invoice export",
		},
		{
			name: "formatting is stripped to plain text",
			body: "<p>Ship the <strong>invoice</strong> export</p>",
			want: "Ship the invoice export",
		},
		{
			name: "block tags separate words rather than joining them",
			body: "<p>First line</p><p>Second line</p>",
			want: "First line Second line",
		},
		{
			name: "runs of whitespace collapse to single spaces",
			body: "Ship   the\n\n invoice\texport",
			want: "Ship the invoice export",
		},
		{
			name: "html entities are decoded",
			body: "<p>Fix Q&amp;A page</p>",
			want: "Fix Q&A page",
		},
		{
			name: "leading and trailing whitespace is trimmed",
			body: "   Ship it   ",
			want: "Ship it",
		},
		{
			name: "an empty body yields an empty title",
			body: "",
			want: "",
		},
		{
			name: "an attachment-only message yields an empty title",
			body: "<p></p>",
			want: "",
		},
		{
			name: "a whitespace-only body yields an empty title",
			body: "   \n\t  ",
			want: "",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := TitleFromMessageBody(tc.body); got != tc.want {
				t.Errorf("TitleFromMessageBody(%q) = %q, want %q", tc.body, got, tc.want)
			}
		})
	}

	t.Run("a long message is truncated at a word boundary", func(t *testing.T) {
		body := strings.Repeat("word ", 200)
		got := TitleFromMessageBody(body)

		if len([]rune(got)) > MaxTaskTitleLength {
			t.Errorf("title is %d runes, want at most %d", len([]rune(got)), MaxTaskTitleLength)
		}
		if strings.HasSuffix(got, " ") {
			t.Errorf("truncated title should not end in whitespace, got %q", got)
		}
		// Cutting at a boundary means the last word survives whole, never as a fragment.
		if !strings.HasSuffix(got, "word") {
			t.Errorf("truncation should land on a word boundary, got %q", got)
		}
	})

	t.Run("a single word longer than the limit is cut hard", func(t *testing.T) {
		// There is no boundary to fall back to, so a hard cut is the only option left.
		got := TitleFromMessageBody(longWord)

		if len([]rune(got)) != MaxTaskTitleLength {
			t.Errorf("title is %d runes, want exactly %d", len([]rune(got)), MaxTaskTitleLength)
		}
	})

	t.Run("truncation never splits a multibyte character", func(t *testing.T) {
		// Counted in bytes rather than runes, this would slice a character in half and
		// produce mojibake in the title the user is shown.
		got := TitleFromMessageBody(strings.Repeat("日", MaxTaskTitleLength+20))

		if len([]rune(got)) != MaxTaskTitleLength {
			t.Errorf("title is %d runes, want exactly %d", len([]rune(got)), MaxTaskTitleLength)
		}
		if strings.ContainsRune(got, '�') {
			t.Errorf("truncation split a multibyte character: %q", got)
		}
	})
}

package organization

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
	"unicode"

	"golang.org/x/text/runes"
	"golang.org/x/text/transform"
	"golang.org/x/text/unicode/norm"
)

// Subdomain format rules. The value is the workspace address a team signs in at, so it has
// to survive being read aloud, typed on a phone keypad, and placed in a hostname label.
const (
	SubdomainMinLength = 3
	SubdomainMaxLength = 63 // a DNS label cannot exceed 63 octets
)

// ErrSubdomainInvalid is returned for any format violation. The message names the rule that
// was broken so the client can show it verbatim.
var ErrSubdomainInvalid = errors.New("invalid workspace address")

// ErrSubdomainTaken is returned when a well-formed address is already in use.
var ErrSubdomainTaken = errors.New("workspace address already in use")

// reservedSubdomains are addresses the platform needs for itself. Registering one would
// shadow a real host, so they are refused regardless of availability in the table.
var reservedSubdomains = map[string]struct{}{
	"www":    {},
	"api":    {},
	"app":    {},
	"admin":  {},
	"mail":   {},
	"static": {},
	"assets": {},
}

var subdomainPattern = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$`)

// Normalize lower-cases and trims a candidate address. It does not validate; callers that
// need a verdict follow it with Validate.
func Normalize(subdomain string) string {
	return strings.ToLower(strings.TrimSpace(subdomain))
}

// Validate reports whether a normalized address satisfies the format rules.
// Callers should Normalize first; Validate normalizes defensively so a raw value cannot
// slip past on casing alone.
func Validate(subdomain string) error {
	s := Normalize(subdomain)

	switch {
	case len(s) < SubdomainMinLength:
		return fmt.Errorf("%w: must be at least %d characters", ErrSubdomainInvalid, SubdomainMinLength)
	case len(s) > SubdomainMaxLength:
		return fmt.Errorf("%w: must be at most %d characters", ErrSubdomainInvalid, SubdomainMaxLength)
	case !subdomainPattern.MatchString(s):
		return fmt.Errorf("%w: use letters, numbers and hyphens, starting and ending with a letter or number", ErrSubdomainInvalid)
	case strings.Contains(s, "--"):
		return fmt.Errorf("%w: cannot contain two hyphens in a row", ErrSubdomainInvalid)
	}

	if _, reserved := reservedSubdomains[s]; reserved {
		return fmt.Errorf("%w: %q is reserved", ErrSubdomainInvalid, s)
	}

	return nil
}

// accentFolder decomposes characters and drops the combining marks, so "Café" folds to
// "Cafe" rather than losing the letter entirely.
var accentFolder = transform.Chain(norm.NFD, runes.Remove(runes.In(unicode.Mn)), norm.NFC)

// Derive turns a company name into a candidate workspace address: "Anna's Café" → "annas-cafe".
// It returns an empty string when the name yields nothing usable — a name written entirely in
// a script that folds away, or one shorter than the minimum — in which case the caller must
// ask for an address rather than inventing one.
func Derive(companyName string) string {
	folded, _, err := transform.String(accentFolder, companyName)
	if err != nil {
		folded = companyName
	}

	var b strings.Builder
	lastHyphen := false
	for _, r := range strings.ToLower(folded) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
			lastHyphen = false
		case strings.ContainsRune("'\u2019`\u00b4", r):
			// Apostrophes join a word rather than separating one: "Anna's" is "annas",
			// not "anna-s".
		default:
			// Collapse any run of non-alphanumerics into a single hyphen.
			if !lastHyphen && b.Len() > 0 {
				b.WriteByte('-')
				lastHyphen = true
			}
		}
	}

	candidate := strings.Trim(b.String(), "-")
	if len(candidate) > SubdomainMaxLength {
		candidate = strings.Trim(candidate[:SubdomainMaxLength], "-")
	}

	if Validate(candidate) != nil {
		return ""
	}
	return candidate
}

// NextVariant returns the nth disambiguated form of a base address: "annas-cafe" with n=2
// gives "annas-cafe-2". The base is truncated if the suffix would push it past the DNS
// label limit, so the result is always a valid address when the base is.
func NextVariant(base string, n int) string {
	suffix := fmt.Sprintf("-%d", n)
	trimmed := base
	if len(trimmed)+len(suffix) > SubdomainMaxLength {
		trimmed = strings.Trim(trimmed[:SubdomainMaxLength-len(suffix)], "-")
	}
	return trimmed + suffix
}

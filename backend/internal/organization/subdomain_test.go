package organization

import "testing"

func TestDerive(t *testing.T) {
	cases := []struct {
		name    string
		company string
		want    string
	}{
		{"plain", "Acme Corp", "acme-corp"},
		{"apostrophe and accent", "Anna's Café", "annas-cafe"},
		{"punctuation runs collapse", "Bob  &&  Sons, Ltd.", "bob-sons-ltd"},
		{"leading and trailing junk", "  ***Zed***  ", "zed"},
		{"digits kept", "Studio 54", "studio-54"},
		{"already an address", "annas-cafe", "annas-cafe"},
		{"too short after folding", "A&", ""},
		{"nothing usable", "北京", ""},
		{"reserved word is not offered", "API", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := Derive(tc.company); got != tc.want {
				t.Fatalf("Derive(%q) = %q, want %q", tc.company, got, tc.want)
			}
		})
	}
}

func TestDeriveTruncatesToDNSLabelLimit(t *testing.T) {
	long := ""
	for range 100 {
		long += "ab "
	}
	got := Derive(long)
	if len(got) > SubdomainMaxLength {
		t.Fatalf("Derive produced %d characters, limit is %d", len(got), SubdomainMaxLength)
	}
	if err := Validate(got); err != nil {
		t.Fatalf("Derive produced an invalid address %q: %v", got, err)
	}
}

func TestValidate(t *testing.T) {
	valid := []string{"abc", "annas-cafe", "a1", "studio-54"}
	for _, s := range valid {
		err := Validate(s)
		if len(s) < SubdomainMinLength {
			if err == nil {
				t.Fatalf("Validate(%q) accepted a value below the minimum length", s)
			}
			continue
		}
		if err != nil {
			t.Fatalf("Validate(%q) = %v, want nil", s, err)
		}
	}

	invalid := map[string]string{
		"too short":        "ab",
		"leading hyphen":   "-acme",
		"trailing hyphen":  "acme-",
		"double hyphen":    "an--nas",
		"uppercase folded": "", // covered by Normalize; empty is invalid on length
		"underscore":       "an_nas",
		"space":            "an nas",
		"reserved":         "admin",
		"at sign":          "an@nas",
	}
	for name, s := range invalid {
		if err := Validate(s); err == nil {
			t.Fatalf("Validate(%q) (%s) = nil, want an error", s, name)
		}
	}

	if err := Validate("  ANNAS-CAFE  "); err != nil {
		t.Fatalf("Validate should normalize casing and whitespace defensively, got %v", err)
	}
}

func TestNextVariant(t *testing.T) {
	if got := NextVariant("annas-cafe", 2); got != "annas-cafe-2" {
		t.Fatalf("NextVariant = %q, want annas-cafe-2", got)
	}

	base := ""
	for range SubdomainMaxLength {
		base += "a"
	}
	got := NextVariant(base, 12)
	if len(got) > SubdomainMaxLength {
		t.Fatalf("NextVariant produced %d characters, limit is %d", len(got), SubdomainMaxLength)
	}
	if err := Validate(got); err != nil {
		t.Fatalf("NextVariant produced an invalid address %q: %v", got, err)
	}
}

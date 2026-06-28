package iam

import (
	"strings"
	"testing"
	"time"
)

func TestRenderPasswordResetEmail(t *testing.T) {
	message, err := renderPasswordResetEmail("https://app.example.com", PasswordResetEmailInput{
		ToEmail:   "person@example.com",
		Token:     "reset-token-123",
		ExpiresIn: ResetTokenExpiry,
	})
	if err != nil {
		t.Fatalf("renderPasswordResetEmail returned error: %v", err)
	}

	if message.Subject != "Reset your Tech Office password" {
		t.Fatalf("unexpected subject: %q", message.Subject)
	}

	resetURL := "https://app.example.com/reset-password?token=reset-token-123"
	if !strings.Contains(message.TextBody, resetURL) {
		t.Fatalf("text body did not contain reset URL: %s", message.TextBody)
	}
	if !strings.Contains(message.HTMLBody, resetURL) {
		t.Fatalf("html body did not contain reset URL: %s", message.HTMLBody)
	}
	if !strings.Contains(message.TextBody, "1 hour") {
		t.Fatalf("text body did not include expiry: %s", message.TextBody)
	}
}

func TestRenderOrganizationInvitationEmail(t *testing.T) {
	message, err := renderOrganizationInvitationEmail("https://app.example.com", OrganizationInvitationEmailInput{
		ToEmail:          "person@example.com",
		Token:            "invite-token-456",
		OrganizationName: "Acme Factory",
		RoleName:         "Operator",
		ExpiresIn:        7 * 24 * time.Hour,
	})
	if err != nil {
		t.Fatalf("renderOrganizationInvitationEmail returned error: %v", err)
	}

	if message.Subject != "You're invited to join Acme Factory" {
		t.Fatalf("unexpected subject: %q", message.Subject)
	}

	inviteURL := "https://app.example.com/accept-invitation?token=invite-token-456"
	if !strings.Contains(message.TextBody, inviteURL) {
		t.Fatalf("text body did not contain invitation URL: %s", message.TextBody)
	}
	if !strings.Contains(message.TextBody, "Role: Operator") {
		t.Fatalf("text body did not include role: %s", message.TextBody)
	}
	if !strings.Contains(message.HTMLBody, "Acme Factory") {
		t.Fatalf("html body did not include organization name: %s", message.HTMLBody)
	}
	if !strings.Contains(message.TextBody, "7 days") {
		t.Fatalf("text body did not include expiry: %s", message.TextBody)
	}
}

func TestBuildAppURLRejectsInvalidBaseURL(t *testing.T) {
	_, err := buildAppURL("not-a-valid-url", "/reset-password", map[string]string{"token": "x"})
	if err == nil {
		t.Fatal("expected error for invalid WEBAPP_URL")
	}
}

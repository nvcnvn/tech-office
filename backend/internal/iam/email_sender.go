package iam

import (
	"context"
	"fmt"
	"html"
	"log/slog"
	"net/url"
	"strings"
	"time"
)

type EmailSender interface {
	SendPasswordReset(ctx context.Context, input PasswordResetEmailInput) error
	SendOrganizationInvitation(ctx context.Context, input OrganizationInvitationEmailInput) error
}

type PasswordResetEmailInput struct {
	ToEmail   string
	Token     string
	ExpiresIn time.Duration
}

type OrganizationInvitationEmailInput struct {
	ToEmail          string
	Token            string
	OrganizationName string
	RoleName         string
	ExpiresIn        time.Duration
}

type emailMessage struct {
	ToEmail  string
	Subject  string
	HTMLBody string
	TextBody string
}

type loggingEmailSender struct {
	webappURL string
}

func NewLoggingEmailSender(webappURL string) EmailSender {
	return &loggingEmailSender{webappURL: webappURL}
}

func (s *loggingEmailSender) SendPasswordReset(ctx context.Context, input PasswordResetEmailInput) error {
	message, err := renderPasswordResetEmail(s.webappURL, input)
	if err != nil {
		return err
	}

	slog.InfoContext(ctx, "IAM email delivery disabled; password reset email logged",
		"to", message.ToEmail,
		"subject", message.Subject,
		"body", message.TextBody,
	)
	return nil
}

func (s *loggingEmailSender) SendOrganizationInvitation(ctx context.Context, input OrganizationInvitationEmailInput) error {
	message, err := renderOrganizationInvitationEmail(s.webappURL, input)
	if err != nil {
		return err
	}

	slog.InfoContext(ctx, "IAM email delivery disabled; invitation email logged",
		"to", message.ToEmail,
		"subject", message.Subject,
		"body", message.TextBody,
	)
	return nil
}

func renderPasswordResetEmail(webappURL string, input PasswordResetEmailInput) (*emailMessage, error) {
	resetURL, err := buildAppURL(webappURL, "/reset-password", map[string]string{"token": input.Token})
	if err != nil {
		return nil, err
	}

	expiryText := humanizeEmailExpiry(input.ExpiresIn)
	subject := "Reset your Tech Office password"
	textBody := fmt.Sprintf(
		"You requested a password reset for your Tech Office account.\n\nReset your password here:\n%s\n\nThis link expires in %s. If you did not request this, you can ignore this email.\n",
		resetURL,
		expiryText,
	)
	htmlBody := fmt.Sprintf(
		"<p>You requested a password reset for your Tech Office account.</p><p><a href=\"%s\">Reset your password</a></p><p>This link expires in %s. If you did not request this, you can ignore this email.</p>",
		html.EscapeString(resetURL),
		html.EscapeString(expiryText),
	)

	return &emailMessage{
		ToEmail:  input.ToEmail,
		Subject:  subject,
		HTMLBody: htmlBody,
		TextBody: textBody,
	}, nil
}

func renderOrganizationInvitationEmail(webappURL string, input OrganizationInvitationEmailInput) (*emailMessage, error) {
	invitationURL, err := buildAppURL(webappURL, "/accept-invitation", map[string]string{"token": input.Token})
	if err != nil {
		return nil, err
	}

	workspaceName := strings.TrimSpace(input.OrganizationName)
	if workspaceName == "" {
		workspaceName = "your Tech Office workspace"
	}

	roleName := strings.TrimSpace(input.RoleName)
	roleText := ""
	roleHTML := ""
	if roleName != "" {
		roleText = fmt.Sprintf("\nRole: %s\n", roleName)
		roleHTML = fmt.Sprintf("<p><strong>Role:</strong> %s</p>", html.EscapeString(roleName))
	}

	expiryText := humanizeEmailExpiry(input.ExpiresIn)
	subject := fmt.Sprintf("You're invited to join %s", workspaceName)
	textBody := fmt.Sprintf(
		"You've been invited to join %s in Tech Office.%s\nAccept your invitation here:\n%s\n\nThis invitation expires in %s.\n",
		workspaceName,
		roleText,
		invitationURL,
		expiryText,
	)
	htmlBody := fmt.Sprintf(
		"<p>You've been invited to join <strong>%s</strong> in Tech Office.</p>%s<p><a href=\"%s\">Accept your invitation</a></p><p>This invitation expires in %s.</p>",
		html.EscapeString(workspaceName),
		roleHTML,
		html.EscapeString(invitationURL),
		html.EscapeString(expiryText),
	)

	return &emailMessage{
		ToEmail:  input.ToEmail,
		Subject:  subject,
		HTMLBody: htmlBody,
		TextBody: textBody,
	}, nil
}

func buildAppURL(baseURL, path string, query map[string]string) (string, error) {
	baseURL = strings.TrimSpace(baseURL)
	if baseURL == "" {
		return "", fmt.Errorf("WEBAPP_URL is required for IAM email links")
	}

	base, err := url.Parse(baseURL)
	if err != nil || base.Scheme == "" || base.Host == "" {
		return "", fmt.Errorf("invalid WEBAPP_URL %q", baseURL)
	}

	target := base.ResolveReference(&url.URL{Path: path})
	values := target.Query()
	for key, value := range query {
		values.Set(key, value)
	}
	target.RawQuery = values.Encode()
	return target.String(), nil
}

func humanizeEmailExpiry(duration time.Duration) string {
	if duration <= 0 {
		return "soon"
	}

	rounded := duration.Round(time.Minute)
	if rounded%(24*time.Hour) == 0 {
		days := int(rounded / (24 * time.Hour))
		if days == 1 {
			return "1 day"
		}
		return fmt.Sprintf("%d days", days)
	}

	if rounded%time.Hour == 0 {
		hours := int(rounded / time.Hour)
		if hours == 1 {
			return "1 hour"
		}
		return fmt.Sprintf("%d hours", hours)
	}

	minutes := int(rounded / time.Minute)
	if minutes == 1 {
		return "1 minute"
	}
	return fmt.Sprintf("%d minutes", minutes)
}

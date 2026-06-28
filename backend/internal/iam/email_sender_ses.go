package iam

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/sesv2"
	sestypes "github.com/aws/aws-sdk-go-v2/service/sesv2/types"
)

type EmailConfig struct {
	AWSRegion           string
	WebappURL           string
	SESFromEmail        string
	SESReplyToEmail     string
	SESConfigurationSet string
}

type sesEmailSender struct {
	client           *sesv2.Client
	webappURL        string
	fromEmail        string
	replyToEmail     string
	configurationSet string
}

func NewEmailSender(ctx context.Context, cfg EmailConfig) (EmailSender, error) {
	if strings.TrimSpace(cfg.SESFromEmail) == "" {
		slog.WarnContext(ctx, "SES_FROM_EMAIL not set, IAM emails will be logged instead of delivered")
		return NewLoggingEmailSender(cfg.WebappURL), nil
	}

	if strings.TrimSpace(cfg.AWSRegion) == "" {
		return nil, fmt.Errorf("AWS_REGION is required when SES_FROM_EMAIL is set")
	}
	if strings.TrimSpace(cfg.WebappURL) == "" {
		return nil, fmt.Errorf("WEBAPP_URL is required for IAM email links")
	}

	awsCfg, err := awsconfig.LoadDefaultConfig(ctx, awsconfig.WithRegion(cfg.AWSRegion))
	if err != nil {
		return nil, fmt.Errorf("load AWS config for SES: %w", err)
	}

	return &sesEmailSender{
		client:           sesv2.NewFromConfig(awsCfg),
		webappURL:        cfg.WebappURL,
		fromEmail:        cfg.SESFromEmail,
		replyToEmail:     cfg.SESReplyToEmail,
		configurationSet: cfg.SESConfigurationSet,
	}, nil
}

func (s *sesEmailSender) SendPasswordReset(ctx context.Context, input PasswordResetEmailInput) error {
	message, err := renderPasswordResetEmail(s.webappURL, input)
	if err != nil {
		return err
	}
	return s.send(ctx, message)
}

func (s *sesEmailSender) SendOrganizationInvitation(ctx context.Context, input OrganizationInvitationEmailInput) error {
	message, err := renderOrganizationInvitationEmail(s.webappURL, input)
	if err != nil {
		return err
	}
	return s.send(ctx, message)
}

func (s *sesEmailSender) send(ctx context.Context, message *emailMessage) error {
	input := &sesv2.SendEmailInput{
		FromEmailAddress: aws.String(s.fromEmail),
		Destination: &sestypes.Destination{
			ToAddresses: []string{message.ToEmail},
		},
		Content: &sestypes.EmailContent{
			Simple: &sestypes.Message{
				Subject: &sestypes.Content{
					Charset: aws.String("UTF-8"),
					Data:    aws.String(message.Subject),
				},
				Body: &sestypes.Body{
					Text: &sestypes.Content{
						Charset: aws.String("UTF-8"),
						Data:    aws.String(message.TextBody),
					},
					Html: &sestypes.Content{
						Charset: aws.String("UTF-8"),
						Data:    aws.String(message.HTMLBody),
					},
				},
			},
		},
	}

	if replyTo := strings.TrimSpace(s.replyToEmail); replyTo != "" {
		input.ReplyToAddresses = []string{replyTo}
	}
	if configurationSet := strings.TrimSpace(s.configurationSet); configurationSet != "" {
		input.ConfigurationSetName = aws.String(configurationSet)
	}

	if _, err := s.client.SendEmail(ctx, input); err != nil {
		return fmt.Errorf("send SES email to %s: %w", message.ToEmail, err)
	}
	return nil
}

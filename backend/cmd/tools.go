package main

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5"
	"github.com/urfave/cli/v3"

	"github.com/nvcnvn/tech-office/backend/database"
	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/internal/config"
	"github.com/nvcnvn/tech-office/backend/internal/iam"
	"github.com/nvcnvn/tech-office/backend/internal/notification"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/nvcnvn/tech-office/backend/rpc/v1/rpcv1connect"
)

var ToolsCommand = &cli.Command{
	Name:  "tools",
	Usage: "Development and testing utilities",
	Commands: []*cli.Command{
		{
			Name:  "keygen",
			Usage: "Generate RSA key pair for JWT tokens",
			Flags: []cli.Flag{
				&cli.StringFlag{
					Name:  "output-dir",
					Usage: "Directory to save key files",
					Value: ".dev-keys",
				},
			},
			Action: generateKeyPair,
		},
		{
			Name:  "token",
			Usage: "Generate a signed JWT token for development/testing",
			Flags: []cli.Flag{
				&cli.StringFlag{
					Name:     "org-id",
					Usage:    "Organization UUID",
					Required: true,
				},
				&cli.StringFlag{
					Name:     "user-id",
					Usage:    "User UUID",
					Required: true,
				},
				&cli.StringFlag{
					Name:  "email",
					Usage: "User email",
					Value: "dev@tech-office.local",
				},
				&cli.StringFlag{
					Name:  "key",
					Usage: "Path to private key PEM file",
					Value: ".dev-keys/jwt-private.pem",
				},
			},
			Action: generateToken,
		},
		{
			Name:  "sendNotify",
			Usage: "Send a test notification via RPC (with auto-generated token)",
			Flags: []cli.Flag{
				&cli.StringFlag{
					Name:     "to-org-id",
					Usage:    "Target organization UUID",
					Required: true,
				},
				&cli.StringFlag{
					Name:     "to-user-id",
					Usage:    "Target user ID",
					Required: true,
				},
				&cli.StringFlag{
					Name:  "title",
					Usage: "Notification title",
					Value: "Test Notification",
				},
				&cli.StringFlag{
					Name:  "message",
					Usage: "Notification message",
					Value: "This is a test notification from dev CLI",
				},
				&cli.StringFlag{
					Name:  "type",
					Usage: "Notification type",
					Value: "NOTIFICATION_TYPE_SYSTEM_INFO",
				},
				&cli.StringFlag{
					Name:  "domain",
					Usage: "Source domain",
					Value: "SOURCE_DOMAIN_SYSTEM",
				},
				&cli.StringFlag{
					Name:  "key",
					Usage: "Path to private key PEM file",
					Value: ".dev-keys/jwt-private.pem",
				},
				&cli.StringFlag{
					Name:  "server",
					Usage: "Backend server URL",
					Value: "http://localhost:18080",
				},
			},
			Action: sendNotification,
		},
		{
			Name:  "invitation-url",
			Usage: "Print the latest pending invitation URL for an email",
			Flags: []cli.Flag{
				&cli.StringFlag{
					Name:     "email",
					Usage:    "Invited user email address",
					Required: true,
				},
				&cli.StringFlag{
					Name:  "org-id",
					Usage: "Optional organization UUID to narrow the invitation lookup",
				},
				&cli.StringFlag{
					Name:  "webapp-url",
					Usage: "Override the web app base URL used to build the accept-invitation link",
				},
			},
			Action: printInvitationURL,
		},
		{
			Name:  "sse-connections",
			Usage: "Inspect SSE notification connections and the backend instances hosting them",
			Flags: []cli.Flag{
				&cli.StringFlag{
					Name:  "org-id",
					Usage: "Optional organization UUID filter",
				},
				&cli.StringFlag{
					Name:  "user-id",
					Usage: "Optional employee UUID filter",
				},
				&cli.StringFlag{
					Name:  "instance-id",
					Usage: "Optional backend instance filter",
				},
				&cli.StringFlag{
					Name:  "status",
					Usage: "Liveness filter: responsive (pongged within the responsive window), unresponsive, or all",
					Value: "responsive",
				},
				&cli.BoolFlag{
					Name:  "json",
					Usage: "Print machine-readable JSON instead of the grouped text view",
				},
			},
			Action: debugSSEConnections,
		},
	},
}

type invitationLookupResult struct {
	ID             dbuuid.UUID
	OrganizationID dbuuid.UUID
	Email          string
	Token          string
	Status         string
	ExpiresAt      string
	CreatedAt      string
}

type sseConnectionDebugRow struct {
	OrganizationID     dbuuid.UUID `json:"organization_id"`
	EmployeeID         dbuuid.UUID `json:"employee_id"`
	GivenName          string      `json:"given_name"`
	FamilyName         string      `json:"family_name"`
	Email              string      `json:"email"`
	InstanceID         string      `json:"instance_id"`
	ConnectionID       dbuuid.UUID `json:"connection_id"`
	PresenceStatus     string      `json:"presence_status"`
	ActiveChannelID    string      `json:"active_channel_id"`
	ConnectedAt        string      `json:"connected_at"`
	LastPongAt         string      `json:"last_pong_at"`
	LastInteractionAt  string      `json:"last_interaction_at"`
	DeviceIdentifier   string      `json:"device_identifier"`
	UserAgent          string      `json:"user_agent"`
	IPAddress          string      `json:"ip_address"`
	Contexts           string      `json:"contexts"`
	ListenTopic        string      `json:"listen_topic"`
	ListenStatus       string      `json:"listen_status"`
	ListenHeartbeatAt  string      `json:"listen_heartbeat_at"`
	ListenConnectedAt  string      `json:"listen_connected_at"`
	ListenBackendPID   int32       `json:"listen_backend_pid"`
	ListenRegistered   bool        `json:"listen_registered"`
	ConsumerStatus     string      `json:"consumer_status"`
	ConsumerLastActive string      `json:"consumer_last_active_at"`
	ReconnectCount     int32       `json:"reconnect_count"`
	LastError          string      `json:"last_error,omitempty"`
	LastErrorAt        string      `json:"last_error_at,omitempty"`
}

type sseListenerStatus struct {
	InstanceID         string
	ListenTopic        string
	ListenStatus       string
	ListenHeartbeatAt  string
	ListenConnectedAt  string
	ListenBackendPID   int32
	ListenRegistered   bool
	ConsumerStatus     string
	ConsumerLastActive string
	ReconnectCount     int32
	LastError          string
	LastErrorAt        string
}

func generateKeyPair(ctx context.Context, cmd *cli.Command) error {
	outputDir := cmd.String("output-dir")

	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return fmt.Errorf("failed to generate key pair: %w", err)
	}

	// Create output directory
	if err := os.MkdirAll(outputDir, 0700); err != nil {
		return fmt.Errorf("failed to create output directory: %w", err)
	}

	// Save private key (PKCS1)
	privateKeyPath := filepath.Join(outputDir, "jwt-private.pem")
	privPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "RSA PRIVATE KEY",
		Bytes: x509.MarshalPKCS1PrivateKey(privateKey),
	})
	if err := os.WriteFile(privateKeyPath, privPEM, 0600); err != nil {
		return fmt.Errorf("failed to write private key: %w", err)
	}

	// Save public key (PKIX)
	pubASN1, err := x509.MarshalPKIXPublicKey(&privateKey.PublicKey)
	if err != nil {
		return fmt.Errorf("failed to marshal public key: %w", err)
	}
	publicKeyPath := filepath.Join(outputDir, "jwt-public.pem")
	pubPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "PUBLIC KEY",
		Bytes: pubASN1,
	})
	if err := os.WriteFile(publicKeyPath, pubPEM, 0644); err != nil {
		return fmt.Errorf("failed to write public key: %w", err)
	}

	fmt.Printf("Key pair generated:\n")
	fmt.Printf("   Private key: %s (keep secret!)\n", privateKeyPath)
	fmt.Printf("   Public key:  %s\n", publicKeyPath)
	fmt.Printf("\nServer configuration:\n")
	fmt.Printf("   JWT_PRIVATE_KEY_PATH=%s\n", privateKeyPath)

	return nil
}

func generateToken(ctx context.Context, cmd *cli.Command) error {
	cfg := config.Get()
	keyPath := cmd.String("key")

	signer, err := iam.NewInternalJWTSigner(keyPath)
	if err != nil {
		return fmt.Errorf("failed to create JWT signer: %w", err)
	}

	orgID := dbuuid.MustParse(cmd.String("org-id"))
	userID := dbuuid.MustParse(cmd.String("user-id"))
	email := cmd.String("email")

	token, jti, expiresAt, err := signer.GenerateTokenWithOrg(userID, email, orgID)
	if err != nil {
		return fmt.Errorf("failed to generate token: %w", err)
	}

	slog.InfoContext(ctx, "Generated JWT",
		"org_id", orgID,
		"user_id", userID,
		"email", email,
		"jti", jti,
		"expires_at", expiresAt,
	)

	fmt.Println("\nJWT Token (roles resolved from DB at request time):")
	fmt.Println(token)
	fmt.Println("\nUsage:")
	fmt.Printf("curl -H 'Authorization: Bearer %s' http://localhost:%s/...\n", token, cfg.ServerPort)

	return nil
}

func sendNotification(ctx context.Context, cmd *cli.Command) error {
	keyPath := cmd.String("key")
	toOrgID := dbuuid.MustParse(cmd.String("to-org-id"))
	toUserID := cmd.String("to-user-id")
	title := cmd.String("title")
	message := cmd.String("message")
	notifType := cmd.String("type")
	domain := cmd.String("domain")
	serverURL := cmd.String("server")

	// Generate token with system identity for the target org
	signer, err := iam.NewInternalJWTSigner(keyPath)
	if err != nil {
		return fmt.Errorf("failed to create JWT signer: %w", err)
	}

	systemUserID := dbuuid.Must()
	token, _, _, err := signer.GenerateTokenWithOrg(systemUserID, "cli@tech-office.local", toOrgID)
	if err != nil {
		return fmt.Errorf("failed to generate token: %w", err)
	}

	slog.InfoContext(ctx, "Generated token",
		"org_id", toOrgID,
		"system_user_id", systemUserID,
	)

	// Create RPC client
	client := rpcv1connect.NewNotificationServiceClient(
		http.DefaultClient,
		serverURL,
	)

	// Create request
	req := connect.NewRequest(&rpcv1.PublishNotificationRequest{
		OrganizationId: toOrgID.String(),
		Recipients: &rpcv1.NotificationRecipients{
			EmployeeIds: []string{toUserID},
		},
		SourceDomain:        domain,
		NotificationType:    notifType,
		Title:               title,
		Message:             message,
		Priority:            1, // Not offline (default)
		PublishingServiceId: "dev-cli",
	})

	// Add authorization header
	req.Header().Set("Authorization", "Bearer "+token)

	// Make RPC call
	fmt.Printf("Sending notification to org=%s, user=%s\n", toOrgID, toUserID)
	fmt.Printf("   Title: %s\n", title)
	fmt.Printf("   Message: %s\n", message)
	fmt.Println()

	resp, err := client.PublishNotification(ctx, req)
	if err != nil {
		return fmt.Errorf("failed to send notification: %w", err)
	}

	fmt.Println("Notification sent successfully!")
	fmt.Printf("   Notification ID: %s\n", resp.Msg.NotificationId)
	fmt.Printf("   Recipient count: %d\n", resp.Msg.RecipientCount)
	if len(resp.Msg.RecipientEmployeeIds) > 0 {
		fmt.Printf("   Recipients: %v\n", resp.Msg.RecipientEmployeeIds)
	}

	return nil
}

func printInvitationURL(ctx context.Context, cmd *cli.Command) error {
	cfg := config.Get()
	if cfg.DatabaseURL == "" {
		return fmt.Errorf("DATABASE_URL is required")
	}

	adminPool, err := database.NewAdminPool(ctx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("failed to connect to database: %w", err)
	}
	defer adminPool.Close()

	email := strings.TrimSpace(cmd.String("email"))
	webappURL := strings.TrimSpace(cmd.String("webapp-url"))
	if webappURL == "" {
		webappURL = cfg.WebappURL
	}
	if webappURL == "" {
		return fmt.Errorf("WEBAPP_URL is required")
	}

	orgIDRaw := strings.TrimSpace(cmd.String("org-id"))
	var invitation invitationLookupResult

	if orgIDRaw == "" {
		const lookupInvitationByEmail = `
SELECT id, organization_id, email, token, status, expires_at::text, created_at::text
FROM iam.invitation
WHERE lower(email) = lower($1)
  AND status = 'pending'
ORDER BY created_at DESC
LIMIT 1
`

		err = adminPool.QueryRow(ctx, lookupInvitationByEmail, email).Scan(
			&invitation.ID,
			&invitation.OrganizationID,
			&invitation.Email,
			&invitation.Token,
			&invitation.Status,
			&invitation.ExpiresAt,
			&invitation.CreatedAt,
		)
	} else {
		orgID, parseErr := dbuuid.Parse(orgIDRaw)
		if parseErr != nil {
			return fmt.Errorf("invalid org-id: %w", parseErr)
		}

		const lookupInvitationByOrgAndEmail = `
SELECT id, organization_id, email, token, status, expires_at::text, created_at::text
FROM iam.invitation
WHERE organization_id = $1
  AND lower(email) = lower($2)
  AND status = 'pending'
ORDER BY created_at DESC
LIMIT 1
`

		err = adminPool.QueryRow(ctx, lookupInvitationByOrgAndEmail, orgID, email).Scan(
			&invitation.ID,
			&invitation.OrganizationID,
			&invitation.Email,
			&invitation.Token,
			&invitation.Status,
			&invitation.ExpiresAt,
			&invitation.CreatedAt,
		)
	}
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("no pending invitation found for email %q", email)
		}
		return fmt.Errorf("failed to look up invitation: %w", err)
	}

	inviteURL := strings.TrimRight(webappURL, "/") + "/accept-invitation?token=" + url.QueryEscape(invitation.Token)

	fmt.Printf("Invitation URL: %s\n", inviteURL)
	fmt.Printf("   Invitation ID: %s\n", invitation.ID)
	fmt.Printf("   Organization ID: %s\n", invitation.OrganizationID)
	fmt.Printf("   Email: %s\n", invitation.Email)
	fmt.Printf("   Status: %s\n", invitation.Status)
	fmt.Printf("   Created at: %s\n", invitation.CreatedAt)
	fmt.Printf("   Expires at: %s\n", invitation.ExpiresAt)

	return nil
}

func debugSSEConnections(ctx context.Context, cmd *cli.Command) error {
	cfg := config.Get()
	if cfg.DatabaseURL == "" {
		return fmt.Errorf("DATABASE_URL is required")
	}

	adminPool, err := database.NewAdminPool(ctx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("failed to connect to database: %w", err)
	}
	defer adminPool.Close()

	// Liveness is derived from last_pong_at, not stored, so the filter is a comparison
	// rather than a column value.
	status := strings.TrimSpace(strings.ToLower(cmd.String("status")))
	if status == "" {
		status = "responsive"
	}
	if status != "responsive" && status != "unresponsive" && status != "all" {
		return fmt.Errorf("invalid status %q: expected responsive, unresponsive, or all", status)
	}

	orgID, err := parseOptionalUUIDFlag(cmd.String("org-id"), "org-id")
	if err != nil {
		return err
	}
	userID, err := parseOptionalUUIDFlag(cmd.String("user-id"), "user-id")
	if err != nil {
		return err
	}
	instanceID := strings.TrimSpace(cmd.String("instance-id"))

	query, args := buildSSEConnectionsDebugQuery(status, orgID, userID, instanceID)
	rows, err := adminPool.Query(ctx, query, args...)
	if err != nil {
		return fmt.Errorf("failed to query SSE connections: %w", err)
	}
	defer rows.Close()

	connections := make([]sseConnectionDebugRow, 0)
	for rows.Next() {
		var row sseConnectionDebugRow
		if err := rows.Scan(
			&row.OrganizationID,
			&row.EmployeeID,
			&row.GivenName,
			&row.FamilyName,
			&row.Email,
			&row.InstanceID,
			&row.ConnectionID,
			&row.PresenceStatus,
			&row.ActiveChannelID,
			&row.ConnectedAt,
			&row.LastPongAt,
			&row.LastInteractionAt,
			&row.DeviceIdentifier,
			&row.UserAgent,
			&row.IPAddress,
			&row.Contexts,
		); err != nil {
			return fmt.Errorf("failed to scan SSE connection row: %w", err)
		}
		connections = append(connections, row)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("failed to iterate SSE connections: %w", err)
	}

	listenerStatuses, err := fetchSSEListenerStatuses(ctx, adminPool, collectSSEDebugInstanceIDs(connections, instanceID))
	if err != nil {
		return fmt.Errorf("failed to inspect LISTEN status: %w", err)
	}
	if instanceID == "" {
		allListenerStatuses, err := fetchAllSSEListenerStatuses(ctx, adminPool)
		if err != nil {
			return fmt.Errorf("failed to inspect all LISTEN statuses: %w", err)
		}
		for currentInstanceID, listenerStatus := range allListenerStatuses {
			listenerStatuses[currentInstanceID] = listenerStatus
		}
	}
	applySSEListenerStatuses(connections, listenerStatuses)

	if cmd.Bool("json") {
		encoder := json.NewEncoder(os.Stdout)
		encoder.SetIndent("", "  ")
		if err := encoder.Encode(connections); err != nil {
			return fmt.Errorf("failed to encode JSON output: %w", err)
		}
		return nil
	}

	printSSEConnectionsDebug(connections, listenerStatuses, status, orgID, userID, instanceID)
	return nil
}

func parseOptionalUUIDFlag(raw string, flagName string) (*dbuuid.UUID, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, nil
	}

	parsed, err := dbuuid.Parse(trimmed)
	if err != nil {
		return nil, fmt.Errorf("invalid %s: %w", flagName, err)
	}

	return &parsed, nil
}

func buildSSEConnectionsDebugQuery(status string, orgID *dbuuid.UUID, userID *dbuuid.UUID, instanceID string) (string, []any) {
	var query strings.Builder
	query.WriteString(`
SELECT
  ac.organization_id,
  ac.employee_id,
  e.given_name,
  e.family_name,
  e.email,
  ac.instance_id,
  ac.connection_id,
  ac.presence_status,
  COALESCE(ac.active_channel_id::text, '') AS active_channel_id,
	COALESCE(to_char(ac.connected_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), '') AS connected_at,
	COALESCE(to_char(ac.last_pong_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), '') AS last_pong_at,
	COALESCE(to_char(ac.last_interaction_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), '') AS last_interaction_at,
  ac.device_identifier,
  COALESCE(ac.user_agent, '') AS user_agent,
  COALESCE(ac.ip_address::text, '') AS ip_address,
  COALESCE(ctx.contexts, '') AS contexts
FROM notification.active_connection ac
JOIN organization.employee e
  ON e.organization_id = ac.organization_id
 AND e.id = ac.employee_id
LEFT JOIN LATERAL (
  SELECT string_agg(
           actx.context_type || ':' || actx.context_id::text,
           ', '
           ORDER BY actx.context_type, actx.last_seen_at DESC
         ) AS contexts
  FROM notification.active_context actx
  WHERE actx.organization_id = ac.organization_id
    AND actx.connection_id = ac.connection_id
) ctx ON TRUE
WHERE 1 = 1`)

	args := make([]any, 0, 4)
	addArg := func(value any) string {
		args = append(args, value)
		return fmt.Sprintf("$%d", len(args))
	}

	switch status {
	case "responsive":
		query.WriteString("\n  AND ac.last_pong_at >= now() - make_interval(secs => ")
		query.WriteString(addArg(int32(notification.ResponsiveWindowSeconds)))
		query.WriteString("::int)")
	case "unresponsive":
		query.WriteString("\n  AND ac.last_pong_at < now() - make_interval(secs => ")
		query.WriteString(addArg(int32(notification.ResponsiveWindowSeconds)))
		query.WriteString("::int)")
	}
	if orgID != nil {
		query.WriteString("\n  AND ac.organization_id = ")
		query.WriteString(addArg(*orgID))
	}
	if userID != nil {
		query.WriteString("\n  AND ac.employee_id = ")
		query.WriteString(addArg(*userID))
	}
	if instanceID != "" {
		query.WriteString("\n  AND ac.instance_id = ")
		query.WriteString(addArg(instanceID))
	}

	query.WriteString("\nORDER BY ac.instance_id, e.given_name, e.family_name, ac.connected_at, ac.connection_id")

	return query.String(), args
}

func printSSEConnectionsDebug(connections []sseConnectionDebugRow, listenerStatuses map[string]sseListenerStatus, status string, orgID *dbuuid.UUID, userID *dbuuid.UUID, instanceID string) {
	if len(connections) == 0 {
		if instanceID != "" {
			printEmptySSEDebugResult(listenerStatuses, instanceID)
			return
		}
		fmt.Println("No matching SSE connections found.")
		return
	}

	grouped := make(map[string][]sseConnectionDebugRow)
	seenInstances := make(map[string]bool)
	for _, connection := range connections {
		grouped[connection.InstanceID] = append(grouped[connection.InstanceID], connection)
	}
	instanceOrder := make([]string, 0, len(grouped)+len(listenerStatuses))
	for instanceIDFromConnections := range grouped {
		seenInstances[instanceIDFromConnections] = true
		instanceOrder = append(instanceOrder, instanceIDFromConnections)
	}
	for instanceIDFromListeners := range listenerStatuses {
		if seenInstances[instanceIDFromListeners] {
			continue
		}
		seenInstances[instanceIDFromListeners] = true
		instanceOrder = append(instanceOrder, instanceIDFromListeners)
	}
	sort.Strings(instanceOrder)

	filterParts := []string{fmt.Sprintf("status=%s", status)}
	if orgID != nil {
		filterParts = append(filterParts, fmt.Sprintf("org=%s", orgID.String()))
	}
	if userID != nil {
		filterParts = append(filterParts, fmt.Sprintf("user=%s", userID.String()))
	}
	if instanceID != "" {
		filterParts = append(filterParts, fmt.Sprintf("instance=%s", instanceID))
	}

	uniqueUsers := make(map[string]struct{})
	for _, connection := range connections {
		uniqueUsers[connection.OrganizationID.String()+":"+connection.EmployeeID.String()] = struct{}{}
	}

	fmt.Printf("SSE connections: %d rows, %d unique users, %d instances (%s)\n", len(connections), len(uniqueUsers), len(instanceOrder), strings.Join(filterParts, ", "))

	for _, currentInstanceID := range instanceOrder {
		instanceConnections := grouped[currentInstanceID]
		instanceUsers := make(map[string]struct{})
		listenerStatus, exists := listenerStatuses[currentInstanceID]
		if !exists && len(instanceConnections) > 0 {
			listenerStatus = sseListenerStatus{
				InstanceID:         currentInstanceID,
				ListenTopic:        instanceConnections[0].ListenTopic,
				ListenStatus:       instanceConnections[0].ListenStatus,
				ListenHeartbeatAt:  instanceConnections[0].ListenHeartbeatAt,
				ListenConnectedAt:  instanceConnections[0].ListenConnectedAt,
				ListenBackendPID:   instanceConnections[0].ListenBackendPID,
				ListenRegistered:   instanceConnections[0].ListenRegistered,
				ConsumerStatus:     instanceConnections[0].ConsumerStatus,
				ConsumerLastActive: instanceConnections[0].ConsumerLastActive,
				ReconnectCount:     instanceConnections[0].ReconnectCount,
				LastError:          instanceConnections[0].LastError,
				LastErrorAt:        instanceConnections[0].LastErrorAt,
			}
		}
		for _, connection := range instanceConnections {
			instanceUsers[connection.OrganizationID.String()+":"+connection.EmployeeID.String()] = struct{}{}
		}

		fmt.Printf("\nInstance: %s (%d connections, %d users)\n", currentInstanceID, len(instanceConnections), len(instanceUsers))
		fmt.Printf("  listen_topic=%s listen_registered=%t listen_status=%s backend_pid=%d heartbeat=%s\n",
			listenerStatus.ListenTopic,
			listenerStatus.ListenRegistered,
			listenerStatus.ListenStatus,
			listenerStatus.ListenBackendPID,
			formatTimestamp(listenerStatus.ListenHeartbeatAt),
		)
		// Consumer health line
		consumerLine := fmt.Sprintf("  consumer_status=%s last_active=%s reconnects=%d",
			listenerStatus.ConsumerStatus,
			formatTimestampWithAge(listenerStatus.ConsumerLastActive),
			listenerStatus.ReconnectCount,
		)
		if listenerStatus.LastError != "" {
			consumerLine += fmt.Sprintf(" last_error=%q at=%s",
				truncateForDebug(listenerStatus.LastError, 120),
				formatTimestamp(listenerStatus.LastErrorAt),
			)
		}
		fmt.Println(consumerLine)
		if len(instanceConnections) == 0 {
			fmt.Println("  no active SSE connections")
			continue
		}
		for _, connection := range instanceConnections {
			fmt.Printf("  - %s <%s>\n", formatEmployeeDisplayName(connection), connection.Email)
			fmt.Printf("    org=%s employee=%s connection=%s presence=%s\n",
				connection.OrganizationID,
				connection.EmployeeID,
				connection.ConnectionID,
				connection.PresenceStatus,
			)
			fmt.Printf("    connected=%s last_pong=%s (%s ago) interaction=%s (%s ago)\n",
				formatTimestamp(connection.ConnectedAt),
				formatTimestamp(connection.LastPongAt),
				formatAge(connection.LastPongAt),
				formatTimestamp(connection.LastInteractionAt),
				formatAge(connection.LastInteractionAt),
			)

			metadata := make([]string, 0, 4)
			if connection.ActiveChannelID != "" {
				metadata = append(metadata, "active_channel="+connection.ActiveChannelID)
			}
			if connection.Contexts != "" {
				metadata = append(metadata, "contexts="+connection.Contexts)
			}
			if connection.DeviceIdentifier != "" {
				metadata = append(metadata, "device="+connection.DeviceIdentifier)
			}
			if connection.IPAddress != "" {
				metadata = append(metadata, "ip="+connection.IPAddress)
			}
			if connection.UserAgent != "" {
				metadata = append(metadata, "user_agent="+truncateForDebug(connection.UserAgent, 96))
			}

			if len(metadata) > 0 {
				fmt.Printf("    %s\n", strings.Join(metadata, " | "))
			}
		}
	}
}

func formatEmployeeDisplayName(connection sseConnectionDebugRow) string {
	name := strings.TrimSpace(strings.TrimSpace(connection.GivenName + " " + connection.FamilyName))
	if name != "" {
		return name
	}
	if connection.Email != "" {
		return connection.Email
	}
	return connection.EmployeeID.String()
}

func formatAge(raw string) string {
	t, ok := parseDebugTimestamp(raw)
	if !ok {
		return "unknown"
	}

	delta := time.Since(t).Round(time.Second)
	if delta < 0 {
		delta = 0
	}
	return delta.String()
}

func formatTimestamp(raw string) string {
	t, ok := parseDebugTimestamp(raw)
	if !ok {
		if strings.TrimSpace(raw) == "" {
			return "unknown"
		}
		return raw
	}
	return t.Format(time.RFC3339)
}

func formatTimestampWithAge(raw string) string {
	t, ok := parseDebugTimestamp(raw)
	if !ok {
		return "never"
	}
	delta := time.Since(t).Round(time.Second)
	if delta < 0 {
		delta = 0
	}
	return fmt.Sprintf("%s (%s ago)", t.Format(time.RFC3339), delta)
}

func parseDebugTimestamp(raw string) (time.Time, bool) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return time.Time{}, false
	}

	parsed, err := time.Parse(time.RFC3339Nano, trimmed)
	if err != nil {
		return time.Time{}, false
	}

	return parsed, true
}

func collectSSEDebugInstanceIDs(connections []sseConnectionDebugRow, explicitInstanceID string) []string {
	seen := make(map[string]struct{})
	instanceIDs := make([]string, 0, len(connections)+1)
	if explicitInstanceID != "" {
		seen[explicitInstanceID] = struct{}{}
		instanceIDs = append(instanceIDs, explicitInstanceID)
	}
	for _, connection := range connections {
		if _, exists := seen[connection.InstanceID]; exists {
			continue
		}
		seen[connection.InstanceID] = struct{}{}
		instanceIDs = append(instanceIDs, connection.InstanceID)
	}
	sort.Strings(instanceIDs)
	return instanceIDs
}

func fetchSSEListenerStatuses(ctx context.Context, adminPool database.AdminDatabaseConnector, instanceIDs []string) (map[string]sseListenerStatus, error) {
	statuses := make(map[string]sseListenerStatus, len(instanceIDs))
	if len(instanceIDs) == 0 {
		return statuses, nil
	}

	const query = `
WITH requested AS (
  SELECT *
  FROM unnest($1::text[]) AS req(instance_id)
)
SELECT
  req.instance_id,
  COALESCE(al.listen_topic, '') AS listen_topic,
  COALESCE(al.listener_status, '') AS listen_status,
  COALESCE(to_char(al.last_heartbeat AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), '') AS listen_heartbeat_at,
  COALESCE(to_char(al.connected_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), '') AS listen_connected_at,
  COALESCE(al.backend_pid, 0) AS listen_backend_pid,
  COALESCE(al.consumer_status, '') AS consumer_status,
  COALESCE(to_char(al.consumer_last_active_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), '') AS consumer_last_active_at,
  COALESCE(al.reconnect_count, 0) AS reconnect_count,
  COALESCE(al.last_error, '') AS last_error,
  COALESCE(to_char(al.last_error_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), '') AS last_error_at
FROM requested req
LEFT JOIN notification.active_listener al
  ON al.instance_id = req.instance_id
ORDER BY req.instance_id`

	rows, err := adminPool.Query(ctx, query, instanceIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var status sseListenerStatus
		if err := rows.Scan(
			&status.InstanceID,
			&status.ListenTopic,
			&status.ListenStatus,
			&status.ListenHeartbeatAt,
			&status.ListenConnectedAt,
			&status.ListenBackendPID,
			&status.ConsumerStatus,
			&status.ConsumerLastActive,
			&status.ReconnectCount,
			&status.LastError,
			&status.LastErrorAt,
		); err != nil {
			return nil, err
		}
		status.ListenRegistered = status.ListenStatus == "active"
		statuses[status.InstanceID] = status
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	for _, currentInstanceID := range instanceIDs {
		if _, exists := statuses[currentInstanceID]; exists {
			continue
		}
		statuses[currentInstanceID] = sseListenerStatus{
			InstanceID:       currentInstanceID,
			ListenTopic:      notificationListenTopicForInstance(currentInstanceID),
			ListenStatus:     "missing",
			ListenRegistered: false,
			ConsumerStatus:   "missing",
		}
	}

	return statuses, nil
}

func fetchAllSSEListenerStatuses(ctx context.Context, adminPool database.AdminDatabaseConnector) (map[string]sseListenerStatus, error) {
	const query = `
SELECT
  instance_id,
  listen_topic,
  listener_status,
  COALESCE(to_char(last_heartbeat AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), '') AS listen_heartbeat_at,
  COALESCE(to_char(connected_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), '') AS listen_connected_at,
  COALESCE(backend_pid, 0) AS listen_backend_pid,
  COALESCE(consumer_status, '') AS consumer_status,
  COALESCE(to_char(consumer_last_active_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), '') AS consumer_last_active_at,
  COALESCE(reconnect_count, 0) AS reconnect_count,
  COALESCE(last_error, '') AS last_error,
  COALESCE(to_char(last_error_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), '') AS last_error_at
FROM notification.active_listener
ORDER BY instance_id`

	rows, err := adminPool.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	statuses := make(map[string]sseListenerStatus)
	for rows.Next() {
		var status sseListenerStatus
		if err := rows.Scan(
			&status.InstanceID,
			&status.ListenTopic,
			&status.ListenStatus,
			&status.ListenHeartbeatAt,
			&status.ListenConnectedAt,
			&status.ListenBackendPID,
			&status.ConsumerStatus,
			&status.ConsumerLastActive,
			&status.ReconnectCount,
			&status.LastError,
			&status.LastErrorAt,
		); err != nil {
			return nil, err
		}
		status.ListenRegistered = status.ListenStatus == "active"
		statuses[status.InstanceID] = status
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return statuses, nil
}

func applySSEListenerStatuses(connections []sseConnectionDebugRow, statuses map[string]sseListenerStatus) {
	for index := range connections {
		status, exists := statuses[connections[index].InstanceID]
		if !exists {
			status = sseListenerStatus{
				InstanceID:       connections[index].InstanceID,
				ListenTopic:      notificationListenTopicForInstance(connections[index].InstanceID),
				ListenStatus:     "missing",
				ListenRegistered: false,
				ConsumerStatus:   "missing",
			}
		}
		connections[index].ListenTopic = status.ListenTopic
		connections[index].ListenStatus = status.ListenStatus
		connections[index].ListenHeartbeatAt = status.ListenHeartbeatAt
		connections[index].ListenConnectedAt = status.ListenConnectedAt
		connections[index].ListenBackendPID = status.ListenBackendPID
		connections[index].ListenRegistered = status.ListenRegistered
		connections[index].ConsumerStatus = status.ConsumerStatus
		connections[index].ConsumerLastActive = status.ConsumerLastActive
		connections[index].ReconnectCount = status.ReconnectCount
		connections[index].LastError = status.LastError
		connections[index].LastErrorAt = status.LastErrorAt
	}
}

func printEmptySSEDebugResult(listenerStatuses map[string]sseListenerStatus, explicitInstanceID string) {
	status, exists := listenerStatuses[explicitInstanceID]
	if !exists {
		fmt.Println("No matching SSE connections found.")
		return
	}

	fmt.Println("No matching SSE connections found.")
	fmt.Printf("Instance: %s\n", explicitInstanceID)
	fmt.Printf("  listen_topic=%s listen_registered=%t listen_status=%s backend_pid=%d heartbeat=%s\n",
		status.ListenTopic,
		status.ListenRegistered,
		status.ListenStatus,
		status.ListenBackendPID,
		formatTimestamp(status.ListenHeartbeatAt),
	)
	fmt.Printf("  consumer_status=%s last_active=%s reconnects=%d\n",
		status.ConsumerStatus,
		formatTimestampWithAge(status.ConsumerLastActive),
		status.ReconnectCount,
	)
	if status.LastError != "" {
		fmt.Printf("  last_error=%q at=%s\n",
			truncateForDebug(status.LastError, 120),
			formatTimestamp(status.LastErrorAt),
		)
	}
}

func notificationListenTopicForInstance(instanceID string) string {
	replacer := strings.NewReplacer(
		"-", "_",
		".", "_",
		" ", "_",
		":", "_",
		"/", "_",
		"\\", "_",
	)
	sanitized := replacer.Replace(instanceID)
	return "instance_" + strings.ToLower(sanitized) + "_notifications"
}

func truncateForDebug(value string, limit int) string {
	if len(value) <= limit {
		return value
	}
	if limit <= 3 {
		return value[:limit]
	}
	return value[:limit-3] + "..."
}

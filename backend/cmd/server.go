package main

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"connectrpc.com/connect"
	"firebase.google.com/go/messaging"
	"github.com/rs/cors"
	"github.com/urfave/cli/v3"

	"github.com/nvcnvn/flows"
	"github.com/nvcnvn/tech-office/backend/database"
	"github.com/nvcnvn/tech-office/backend/database/txn"
	"github.com/nvcnvn/tech-office/backend/internal/calendar"
	"github.com/nvcnvn/tech-office/backend/internal/chat"
	"github.com/nvcnvn/tech-office/backend/internal/collaboration"
	"github.com/nvcnvn/tech-office/backend/internal/compliance"
	"github.com/nvcnvn/tech-office/backend/internal/config"
	"github.com/nvcnvn/tech-office/backend/internal/department"
	"github.com/nvcnvn/tech-office/backend/internal/docs"
	"github.com/nvcnvn/tech-office/backend/internal/files"
	"github.com/nvcnvn/tech-office/backend/internal/iam"
	"github.com/nvcnvn/tech-office/backend/internal/interceptor"
	"github.com/nvcnvn/tech-office/backend/internal/linking"
	"github.com/nvcnvn/tech-office/backend/internal/notification"
	"github.com/nvcnvn/tech-office/backend/internal/organization"
	"github.com/nvcnvn/tech-office/backend/internal/preference"
	"github.com/nvcnvn/tech-office/backend/internal/tour"
	"github.com/nvcnvn/tech-office/backend/internal/voice"
	"github.com/nvcnvn/tech-office/backend/rpc/v1/rpcv1connect"
)

var StartServer = &cli.Command{
	Name:   "server",
	Usage:  "start the server",
	Action: startServer,
	Flags: []cli.Flag{
		&cli.StringFlag{
			Name: "add",
		},
	},
}

func startServer(ctx context.Context, cmd *cli.Command) error {
	cfg := config.Get()
	port := cfg.ServerPort
	slog.InfoContext(ctx, "startServer with", "port", port)
	dsl := cfg.DatabaseURL

	var auth *interceptor.AuthInterceptor

	slog.InfoContext(ctx, "new privilege db connection pool")
	adminPool, err := database.NewAdminPool(ctx, dsl)
	if err != nil {
		slog.ErrorContext(ctx, "failed to create privilege database pool", "error", err)
		return err
	}
	defer adminPool.Close()

	if err := adminPool.Ping(ctx); err != nil {
		slog.ErrorContext(ctx, "failed to ping privilege database pool", "error", err)
		return err
	} else {
		slog.InfoContext(ctx, "successfully connected to privilege database")
	}

	slog.InfoContext(ctx, "new tenant-aware db connection pool")
	tenantPool, err := database.NewTenantPool(ctx, dsl)
	if err != nil {
		slog.ErrorContext(ctx, "failed to create database pool", "error", err)
		return err
	}
	defer tenantPool.Close()

	flowPool, err := database.NewFlowPool(ctx, dsl)
	if err != nil {
		slog.ErrorContext(ctx, "failed to create flow database pool", "error", err)
		return err
	}
	defer flowPool.Close()

	flowsDBConfig := flows.DBConfig{Schema: "flows", ShardCount: cfg.FlowShardCount}
	flowsClient := flows.Client{DBConfig: flowsDBConfig}
	flowsRegistry := flows.NewRegistry()

	mux := http.NewServeMux()

	// Create shared components
	queries := database.New()

	// Initialize IAM JWT signer
	var jwtSigner *iam.InternalJWTSigner
	if cfg.JWTPrivateKeyPath != "" {
		jwtSigner, err = iam.NewInternalJWTSigner(cfg.JWTPrivateKeyPath)
		if err != nil {
			slog.ErrorContext(ctx, "failed to create JWT signer", "error", err)
			return err
		}
		slog.InfoContext(ctx, "JWT signer initialized", "key_path", cfg.JWTPrivateKeyPath)
	} else {
		slog.WarnContext(ctx, "JWT_PRIVATE_KEY_PATH not set, using ephemeral key (dev only)")
		jwtSigner, err = iam.NewEphemeralSigner()
		if err != nil {
			slog.ErrorContext(ctx, "failed to create ephemeral JWT signer", "error", err)
			return err
		}
	}

	// Initialize internal JWT verifier from signer's public key
	internalVerifier, err := iam.NewInternalJWTVerifier(jwtSigner.PublicKey())
	if err != nil {
		slog.ErrorContext(ctx, "failed to create internal JWT verifier", "error", err)
		return err
	}
	slog.InfoContext(ctx, "internal JWT verifier initialized")

	// Initialize JWKS verifier for SSO (Google, Apple)
	// Audience validation is skipped when GOOGLE_CLIENT_IDS / APPLE_CLIENT_IDS are unset (dev only).
	if len(cfg.GoogleClientIDs) == 0 {
		slog.WarnContext(ctx, "GOOGLE_CLIENT_IDS not set — Google token audience validation disabled (dev only)")
	}
	if len(cfg.AppleClientIDs) == 0 {
		slog.WarnContext(ctx, "APPLE_CLIENT_IDS not set — Apple token audience validation disabled (dev only)")
	}
	jwksVerifier, err := iam.NewJWKSVerifier(ctx, cfg.GoogleClientIDs, cfg.AppleClientIDs)
	if err != nil {
		slog.ErrorContext(ctx, "failed to create JWKS verifier", "error", err)
		return err
	}
	slog.InfoContext(ctx, "JWKS verifier initialized (Google, Apple)")

	// Build auth interceptor with internal JWT verifier
	auth = interceptor.NewAuthInterceptor(internalVerifier)

	// Wire PermissionLookup for DB-based permission resolution (uses AdminPool for global queries)
	permissionLookup := iam.NewPermissionLookup(queries, adminPool)
	auth = auth.WithPermissionLookup(permissionLookup)

	interceptors := connect.WithInterceptors(
		interceptor.AccessLogInterceptor(slog.Default()),
		auth,
	)

	// Initialize Logic Layers (NO pools in constructors)
	orgLogic := organization.NewOrganizationLogic(queries, cfg.WebappURL)
	iamLogic := iam.NewIAMLogic(queries, jwtSigner)
	iamEmailSender, err := iam.NewEmailSender(ctx, iam.EmailConfig{
		AWSRegion:           cfg.AWSRegion,
		WebappURL:           cfg.WebappURL,
		SESFromEmail:        cfg.SESFromEmail,
		SESReplyToEmail:     cfg.SESReplyToEmail,
		SESConfigurationSet: cfg.SESConfigurationSet,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to initialize IAM email sender", "error", err)
		return err
	}

	// Initialize Connect Layers (own pools, wrap logic)
	orgConnect := organization.NewOrganizationServiceConnect(orgLogic, adminPool, tenantPool)
	iamConnect := iam.NewIAMServiceConnect(iamLogic, adminPool, tenantPool, jwtSigner, jwksVerifier, iamEmailSender)

	// Register services with connect handlers
	mux.Handle(rpcv1connect.NewOrganizationServiceHandler(orgConnect, interceptors))
	mux.Handle(rpcv1connect.NewIAMServiceHandler(iamConnect, interceptors))

	// Register Department Service
	mux.Handle(rpcv1connect.NewDepartmentServiceHandler(department.NewDepartmentService(
		adminPool,
		tenantPool,
		database.New(),
	), interceptors))

	// Register Notification Service
	slog.InfoContext(ctx, "initializing notification service", "instanceID", cfg.InstanceID)

	// Initialize Notification Logic layers (before service creation)
	notificationLogic := notification.NewNotificationLogic(queries)

	// Initialize FCM client for push notifications (before service creation)
	var fcmClient *messaging.Client
	if cfg.GoogleAppCredentials != "" {
		fcmClient, err = notification.InitFCMClient(ctx)
		if err != nil {
			slog.WarnContext(ctx, "FCM client initialization failed, push notifications disabled",
				"error", err,
			)
			fcmClient = nil // Ensure nil on failure
		} else {
			slog.InfoContext(ctx, "FCM client initialized successfully")
		}
	} else {
		slog.WarnContext(ctx, "GOOGLE_APPLICATION_CREDENTIALS not set, push notifications disabled")
	}

	// APNs VoIP is a second push provider, needed because Firebase cannot carry
	// apns-push-type: voip — the header that makes iOS deliver a call to PushKit on a
	// locked, force-quit phone. It follows the FCM client's posture exactly: when the
	// credential is absent the server still starts, says so loudly, and every iOS
	// device rings on the tier-B path this app already shipped.
	apnsVoIPSender, err := notification.NewAPNsVoIPClientFromEnv()
	if err != nil {
		slog.WarnContext(ctx, "APNs VoIP client initialization failed, iOS calls will use the fallback ring",
			"error", err,
		)
		apnsVoIPSender = nil
	}

	// Initialize Presence, Push, and Visibility logic layers (before service creation)
	visibilityLogic := notification.NewVisibilityLogic(queries)
	presenceLogic := notification.NewPresenceLogic(queries, visibilityLogic)
	pushLogic := notification.NewPushLogic(queries, adminPool, fcmClient)

	// Create notification service with push logic for fallback delivery
	notificationService, err := notification.NewNotificationService(
		adminPool,
		tenantPool,
		queries,
		cfg.InstanceID,
		pushLogic, // Pass push logic for delivery fallback
	)
	if err != nil {
		slog.ErrorContext(ctx, "failed to create notification service", "error", err)
		return err
	}

	// Initialize Routing logic for presence-aware notification routing
	// Wire into notificationService so publishers can check DND/suppression before push fallback
	routingLogic := notification.NewRoutingLogic(queries, notificationService, presenceLogic)
	notificationService.RoutingLogic = routingLogic
	slog.InfoContext(ctx, "routing logic initialized for presence-aware notification routing")

	// Background cleanup workers for stale connections (30s) and push tokens (24h)
	// are already started in notificationService.Start() above

	// Initialize Notification Connect layer with all logic dependencies
	notificationConnect := notification.NewNotificationServiceConnect(
		notificationLogic,
		presenceLogic,
		pushLogic,
		visibilityLogic,
		adminPool,
		tenantPool,
		notificationService, // Pass original service for SSE/registry/publisher
	)

	mux.Handle(rpcv1connect.NewNotificationServiceHandler(notificationConnect, interceptors))
	slog.InfoContext(ctx, "notification service registered")

	// Raw HTTP SSE endpoint for notifications (used by frontend EventSource clients)
	mux.Handle("/api/notifications/stream", notification.NewNotificationStreamHTTPHandler(notificationService, auth))

	// Health check endpoint (k8s probes, monitoring)
	mux.Handle("/healthz", notification.NewHealthHandler(notificationService))

	// Internal status endpoint (detailed JSON for dashboards/scraping)
	mux.Handle("/api/internal/status", notification.NewStatusHandler(notificationService))

	// Register Preference Service
	slog.InfoContext(ctx, "initializing preference service")
	preferenceLogic := preference.NewLogic(queries)
	preferenceConnect := preference.NewService(tenantPool, preferenceLogic)
	mux.Handle(rpcv1connect.NewPreferenceServiceHandler(preferenceConnect, interceptors))
	slog.InfoContext(ctx, "preference service registered")

	// Register Tour Service
	slog.InfoContext(ctx, "initializing tour service")
	tourLogic := tour.NewLogic(queries)
	tourConnect := tour.NewService(tenantPool, tourLogic)
	mux.Handle(rpcv1connect.NewTourServiceHandler(tourConnect, interceptors))
	slog.InfoContext(ctx, "tour service registered")

	// Register File Storage Service (before Chat Service - Chat depends on FileLogic)
	slog.InfoContext(ctx, "initializing file storage service")

	// Create R2 client
	r2Config := files.R2Config{
		AccountID:        cfg.R2AccountID,
		AccessKeyID:      cfg.R2AccessKeyID,
		SecretAccessKey:  cfg.R2SecretAccessKey,
		BucketName:       cfg.R2BucketName,
		Endpoint:         cfg.R2Endpoint,
		PublicURL:        cfg.R2PublicURL,
		PublicHMACSecret: cfg.R2PublicHMACSecret,
	}
	r2Client, err := files.NewR2Client(r2Config)
	if err != nil {
		slog.ErrorContext(ctx, "failed to create R2 client", "error", err)
		return err
	}

	// Initialize logic layers in order (Feature 015)
	// fileLogic: Upload logic (NO auth checks, trusts caller - domain service)
	// Initialize logic layers dependencies first
	// accessLogic: Access control checks (uses queries directly for membership checks)
	accessLogic := files.NewAccessLogic(queries)

	// pdfLogic: PDF conversion status and triggering
	pdfLogic := files.NewPDFLogic(queries, r2Client)

	// indexLogic: Content indexing status
	indexLogic := files.NewIndexLogic(queries)

	// searchLogic: Search with access control (uses queries directly)
	searchLogic := files.NewSearchLogic(queries)

	// Initialize ClamAV client
	clamavHost := cfg.ClamAVHost
	clamavPort := cfg.ClamAVPort
	clamAVClient := files.NewClamAVClient(clamavHost, clamavPort)

	// Initialize file validation workflow components (before creating logic)
	fileValidationServices := &files.FileValidationServices{
		Queries:      queries,
		AdminPool:    adminPool,
		R2Client:     r2Client,
		ClamAVClient: clamAVClient,
		PDFLogic:     pdfLogic,
	}
	fileValidationSteps := files.NewFileValidationSteps(fileValidationServices)
	fileValidationWorkflows := files.NewFileValidationWorkflows(fileValidationSteps)
	flows.Register(flowsRegistry, fileValidationWorkflows.FileValidation, flows.WithConcurrency(9))

	// Post-processing workflow is currently a skeleton (conversion/indexing pending),
	// but we still register it so the worker can execute runs if/when they are enqueued.
	filePostProcessingServices := &files.FilePostProcessingServices{
		Queries:         queries,
		AdminPool:       adminPool,
		R2Client:        r2Client,
		PDFLogic:        pdfLogic,
		GotenbergClient: files.NewGotenbergClient(cfg.GotenbergURL),
	}
	filePostProcessingSteps := files.NewFilePostProcessingSteps(filePostProcessingServices)
	filePostProcessingWorkflows := files.NewFilePostProcessingWorkflows(filePostProcessingSteps)
	flows.Register(flowsRegistry, filePostProcessingWorkflows.FilePostProcessing)

	slog.InfoContext(ctx, "file validation workflow initialized")

	// Initialize fileLogic with dependencies (Feature 015)
	// Now depends on accessLogic and validation workflow
	fileLogic := files.NewLogic(queries, r2Client, flowsClient, fileValidationWorkflows, accessLogic)

	// Generate instance ID for distributed deployment tracking
	// In production, this would come from k8s pod name or container hostname
	instanceID := os.Getenv("HOSTNAME")
	if instanceID == "" {
		instanceID = "backend-local"
	}

	// Create file service connect layer (with workflow for triggering validation)
	fileConnect := files.NewService(
		tenantPool,
		adminPool,
		fileLogic,
		accessLogic,
		pdfLogic,
		indexLogic,
		searchLogic,
		queries,
		instanceID,
		clamAVClient,
		flowsClient,
		filePostProcessingWorkflows.FilePostProcessing,
	)
	mux.Handle(rpcv1connect.NewFileServiceHandler(fileConnect, interceptors))
	slog.InfoContext(ctx, "file storage service registered")

	// Register Chat Service (depends on fileLogic for Feature 015 upload flow)
	slog.InfoContext(ctx, "initializing chat service")
	chatLogic := chat.NewChatLogic(queries, notificationService)
	chatConnect := chat.NewChatServiceConnect(
		chatLogic,
		tenantPool,
		fileLogic,
		r2Client,
		queries,
		flowsClient,
		filePostProcessingWorkflows.FilePostProcessing, // Feature 015: Enable post-processing workflow trigger on upload
	)
	mux.Handle(rpcv1connect.NewChatServiceHandler(chatConnect, interceptors))
	mux.Handle(rpcv1connect.NewChatFileServiceHandler(chatConnect, interceptors)) // Feature 015: Register ChatFileService
	slog.InfoContext(ctx, "chat service registered")

	// Register Voice Communication Service (Feature 032 shell)
	slog.InfoContext(ctx, "initializing voice service")
	voiceConfig, err := voice.LoadConfigFromEnv()
	if err != nil {
		slog.ErrorContext(ctx, "failed to load voice configuration", "error", err)
		return err
	}
	voiceLiveKitClient := voice.NewLiveKitClient(voiceConfig)
	voiceLogic := voice.NewLogic(queries, chatLogic, voiceLiveKitClient, voiceConfig)
	voiceLogic.FileLogic = fileLogic
	voiceLogic.ChatAnnouncer = chatLogic
	voiceLogic.NotificationPublisher = notificationService
	voiceLogic.AdminPool = adminPool
	voiceLogic.TranscriptionWorker = &voice.TranscriptionWorker{
		AdminPool: adminPool,
		MainR2:    r2Client,
		Logic:     voiceLogic,
		Config:    voiceConfig,
	}
	// The call wake dispatcher is the seam between the two domains: internal/voice
	// decides that a call event happened, internal/notification decides how a device
	// learns about it. Wiring it here, after both exist, is what keeps neither package
	// importing the other's implementation (Constitution IV).
	//
	// voiceLogic doubles as the dispatcher's liveness check: before waking a phone the
	// sender confirms the call is still live, so a transaction that rolled back after
	// queueing a wake cannot leave a device ringing for a call that never existed.
	callWakeDispatcher := notification.NewCallWakeDispatcher(
		ctx,
		queries,
		adminPool,
		apnsVoIPSender,
		fcmClient,
		pushLogic,
		voiceLogic,
		cfg.InstanceID,
	)
	notificationService.CallWakeDispatcher = callWakeDispatcher
	voiceLogic.CallWakeDispatcher = callWakeDispatcher

	voiceConnect := voice.NewServiceConnect(voiceLogic, tenantPool)
	mux.Handle(rpcv1connect.NewVoiceServiceHandler(voiceConnect, interceptors))
	mux.Handle("/api/livekit/webhook", voice.NewLiveKitWebhookHandler(voiceLogic, adminPool, voiceConfig))
	slog.InfoContext(ctx, "voice service registered", "livekit_url", voiceConfig.LiveKitURL, "max_participants", voiceConfig.MaxParticipants)

	// Register Document Management Service (Feature 016)
	slog.InfoContext(ctx, "initializing document management service")
	docsLogic := docs.NewDocumentLogic(queries, notificationService)
	docsConnect := docs.NewDocumentServiceConnect(docsLogic, tenantPool)
	docsVersionConnect := docs.NewVersionServiceConnect(docsLogic, tenantPool)
	docsAccessConnect := docs.NewAccessServiceConnect(docsLogic, tenantPool)
	docsFollowerConnect := docs.NewFollowerServiceConnect(docsLogic, tenantPool)
	docsCommentConnect := docs.NewCommentServiceConnect(docsLogic, tenantPool)
	docsReactionConnect := docs.NewReactionServiceConnect(docsLogic, tenantPool)
	docsEmbedConnect := docs.NewEmbedServiceConnect(docsLogic, tenantPool)
	docsEditorConnect := docs.NewEditorServiceConnect(docsLogic, tenantPool)
	mux.Handle(rpcv1connect.NewDocumentServiceHandler(docsConnect, interceptors))
	mux.Handle(rpcv1connect.NewDocumentVersionServiceHandler(docsVersionConnect, interceptors))
	mux.Handle(rpcv1connect.NewDocumentAccessServiceHandler(docsAccessConnect, interceptors))
	mux.Handle(rpcv1connect.NewDocumentFollowerServiceHandler(docsFollowerConnect, interceptors))
	mux.Handle(rpcv1connect.NewCommentServiceHandler(docsCommentConnect, interceptors))
	mux.Handle(rpcv1connect.NewDocumentReactionServiceHandler(docsReactionConnect, interceptors))
	mux.Handle(rpcv1connect.NewSectionEmbedServiceHandler(docsEmbedConnect, interceptors))
	mux.Handle(rpcv1connect.NewDocumentEditorServiceHandler(docsEditorConnect, interceptors))
	slog.InfoContext(ctx, "document management service registered")

	// Register Collaboration Service (Feature 017: Realtime Task Collaboration System)
	// Must be after chat, docs, and notification services are initialized
	slog.InfoContext(ctx, "initializing collaboration service")
	collaborationLogic := collaboration.NewLogic(queries, chatLogic, docsLogic, notificationService)

	// Feature 034: one platform-wide ritual generation sweep replaces per-definition
	// schedules. Registration alone does NOT schedule anything — the ScheduleTx bootstrap
	// below is what makes the job run. ScheduleTx upserts by schedule ID, so every instance
	// and every restart converges on exactly one row.
	ritualGenerationWorkflow := &collaboration.RitualGenerationWorkflow{
		Logic:     collaborationLogic,
		Queries:   queries,
		AdminPool: adminPool,
	}
	flows.Register(flowsRegistry, ritualGenerationWorkflow)
	if err := txn.WithTxn(ctx, adminPool, func(ctx context.Context, tx database.DBTX) error {
		return flows.ScheduleTx(ctx, flowsClient, tx, ritualGenerationWorkflow,
			&collaboration.RitualGenerationInput{},
			ritualGenerationWorkflow.Name(), flows.Every(1*time.Minute))
	}); err != nil {
		slog.ErrorContext(ctx, "failed to bootstrap ritual generation sweep schedule", "error", err)
		return err
	}
	slog.InfoContext(ctx, "ritual generation sweep scheduled", "cadence", "1m")

	collaborationConnect := collaboration.NewCollaborationServiceConnect(
		collaborationLogic,
		tenantPool,
		fileLogic,
		queries,
		flowsClient,
		filePostProcessingWorkflows.FilePostProcessing,
	)
	mux.Handle(rpcv1connect.NewCollaborationServiceHandler(collaborationConnect, interceptors))
	slog.InfoContext(ctx, "collaboration service registered")

	linkingService, err := linking.NewService(
		cfg.WebappURL,
		queries,
		adminPool,
		collaboration.NewTaskPreviewProvider(),
		docs.NewPreviewProvider(),
		linking.NewProjectPreviewProvider(),
		linking.NewChatChannelPreviewProvider(),
		linking.NewChatThreadPreviewProvider(),
		linking.NewCalendarEventPreviewProvider(),
		linking.NewBookingPreviewProvider(),
	)
	if err != nil {
		slog.ErrorContext(ctx, "failed to initialize canonical linking service", "error", err)
		return err
	}
	linking.NewConnectHandler(linkingService, auth).Register(mux)
	slog.InfoContext(ctx, "canonical linking service registered")

	// Inject collaboration logic into organization logic for default project creation
	orgLogic.SetCollaborationLogic(collaborationLogic)
	slog.InfoContext(ctx, "collaboration logic injected into organization logic for default project creation")

	// Register Calendar Service (Feature 026: Calendar System)
	slog.InfoContext(ctx, "initializing calendar service")
	calendarLogic := calendar.NewLogic(queries, notificationService, collaborationLogic, docsLogic)
	calendarServer := calendar.NewCalendarServiceServer(calendarLogic, tenantPool)
	mux.Handle(rpcv1connect.NewCalendarServiceHandler(calendarServer, interceptors))
	slog.InfoContext(ctx, "calendar service registered")

	// Register CalendarReminderWorkflow (polls pending reminders every minute).
	calendarReminderWorkflow := &calendar.CalendarReminderWorkflow{
		Queries:               queries,
		NotificationPublisher: notificationService,
		AdminPool:             adminPool,
	}
	flows.Register(flowsRegistry, calendarReminderWorkflow)
	// Registration makes a workflow resolvable; only ScheduleTx makes it run. This
	// bootstrap was missing, which is why calendar reminders never fired.
	if err := txn.WithTxn(ctx, adminPool, func(ctx context.Context, tx database.DBTX) error {
		return flows.ScheduleTx(ctx, flowsClient, tx, calendarReminderWorkflow,
			&calendar.CalendarReminderInput{},
			calendar.CalendarReminderScheduleID(), calendar.ReminderSchedule())
	}); err != nil {
		slog.ErrorContext(ctx, "failed to bootstrap calendar reminder poll schedule", "error", err)
		return err
	}
	slog.InfoContext(ctx, "calendar reminder workflow registered and scheduled", "cadence", "1m")

	// Register Compliance Service (Feature 036: App Store & Google Play compliance sweep)
	//
	// It is wired last because it composes four other domains: a report can target a
	// chat message, an uploaded file, a document comment or a call record, and it
	// reaches each through that domain's service rather than a cross-schema join
	// (Constitution Principle IV).
	slog.InfoContext(ctx, "initializing compliance service")
	complianceLogic := compliance.NewLogic(queries)
	complianceLogic.RegisterResolvers(chatLogic, fileLogic, docsLogic, voiceLogic)
	complianceLogic.Notifier = notificationService
	complianceLogic.Owners = iam.NewOwnerLookup(queries)

	accountDeleter := iam.NewAccountDeleter(queries, adminPool)
	complianceLogic.Eraser = accountDeleter

	complianceDeletionWorkflows := compliance.NewDeletionWorkflows(complianceLogic, adminPool)
	complianceLogic.FlowsClient = flowsClient
	complianceLogic.DeletionWorkflow = complianceDeletionWorkflows.AccountDeletion
	flows.Register(flowsRegistry, complianceDeletionWorkflows.AccountDeletion)

	// The block guard lives in compliance but is enforced at exactly two
	// chokepoints, in the domains that own them (research.md R8).
	chatLogic.SetContactGuard(complianceLogic)
	voiceLogic.ContactGuard = complianceLogic

	// Deletion acts on the global iam.user record, so its RPCs live on IAMService;
	// the resumable erase record and its background job live in compliance. These
	// two setters are the seam between them.
	iamConnect.SetAccountDeleter(accountDeleter)
	iamConnect.SetEraseEnqueuer(complianceLogic)
	iamConnect.SetRemovalRequestResolver(complianceLogic)

	complianceConnect := compliance.NewServiceConnect(complianceLogic, tenantPool)
	mux.Handle(rpcv1connect.NewComplianceServiceHandler(complianceConnect, interceptors))
	slog.InfoContext(ctx, "compliance service registered")

	listener, err := net.Listen("tcp", "0.0.0.0:"+port)
	if err != nil {
		slog.ErrorContext(ctx, "failed to bind server listener",
			"addr", "0.0.0.0:"+port,
			"error", err)
		return err
	}
	defer listener.Close()

	serverCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	if err := notificationService.Start(serverCtx); err != nil {
		slog.ErrorContext(ctx, "failed to start notification service", "error", err)
		return err
	}
	defer notificationService.Stop()

	// Presence pong batcher: coalesces the pongs arriving at this instance into one
	// multi-row UPDATE per organization per flush tick. Drained on shutdown so no
	// in-flight pong RPC is left waiting.
	notificationConnect.StartPongBatcher(serverCtx)
	defer notificationConnect.StopPongBatcher()

	// Ring timeout sweep: ends calls nobody answered. Runs on every instance; the
	// claim and the end are one UPDATE, so a call is ended exactly once no matter how
	// many instances are sweeping (Constitution XI).
	go voiceLogic.StartRingTimeoutWorker(serverCtx, adminPool)

	flowWorker := flows.Worker{
		Pool:         flowPool,
		Registry:     flowsRegistry,
		PollInterval: time.Second,
		DBConfig:     flowsDBConfig,
	}

	slog.InfoContext(ctx, "starting flow worker")
	go func() {
		if err := flowWorker.Run(serverCtx); err != nil {
			if isExpectedBackgroundShutdownError(serverCtx, err) {
				slog.InfoContext(serverCtx, "flow worker stopped during shutdown", "reason", err)
				return
			}
			slog.ErrorContext(serverCtx, "flow worker encountered an error", "error", err)
		}
	}()

	// Metrics live on their own port because Traefik routes the whole of
	// API_DOMAIN to the request port — anything on that mux is public. This one is
	// only reachable on the overlay network, which is where the collector scrapes
	// it from (tasks.backend, so every replica is scraped, not just the VIP).
	startMetricsServer(serverCtx, cfg.MetricsPort, map[string]database.Statter{
		"admin":  adminPool,
		"tenant": tenantPool,
		"flow":   flowPool,
	})

	p := new(http.Protocols)
	p.SetHTTP1(true)
	// Use h2c so we can serve HTTP/2 without TLS.
	p.SetUnencryptedHTTP2(true)
	s := http.Server{
		Handler:   withCORS(mux),
		Protocols: p,
		// A request that never finishes its headers must not hold a slot forever.
		// ReadTimeout and WriteTimeout stay unset on purpose: streaming RPCs and SSE
		// hold a response open for as long as the client is connected.
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	if err := s.Serve(listener); err != nil {
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		slog.ErrorContext(serverCtx, "server exited with error",
			"addr", listener.Addr().String(),
			"error", err)
		return err
	}

	return nil
}

// startMetricsServer serves the pool metrics until ctx ends. A failure here is
// logged and dropped: losing the scrape target is not a reason to refuse traffic.
func startMetricsServer(ctx context.Context, port string, pools map[string]database.Statter) {
	mux := http.NewServeMux()
	mux.Handle("GET /metrics", database.MetricsHandler(pools))

	s := &http.Server{
		Addr:              "0.0.0.0:" + port,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		<-ctx.Done()
		_ = s.Close()
	}()

	go func() {
		slog.InfoContext(ctx, "serving pool metrics", "addr", s.Addr, "path", "/metrics")
		if err := s.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.ErrorContext(ctx, "metrics server exited", "error", err)
		}
	}()
}

func withCORS(connectHandler http.Handler) http.Handler {
	c := cors.AllowAll()
	return c.Handler(connectHandler)
}

func isExpectedBackgroundShutdownError(ctx context.Context, err error) bool {
	if err == nil {
		return false
	}

	if ctx != nil && ctx.Err() != nil {
		return true
	}

	return errors.Is(err, context.Canceled) ||
		strings.Contains(err.Error(), "closed pool") ||
		strings.Contains(err.Error(), "context canceled") ||
		strings.Contains(err.Error(), "context cancelled")
}

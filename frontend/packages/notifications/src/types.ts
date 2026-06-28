/**
 * Frontend Notification Types
 * TypeScript interfaces for notification hub UI state management
 * 
 * These types are CLIENT-SIDE ONLY and represent frontend state.
 * Backend protobuf types are generated separately in frontend/packages/rpc
 */

// ============================================================================
// Core Notification Model
// ============================================================================

/**
 * Frontend representation of a notification
 * Mapped from backend NotificationSummary protobuf message
 */
export interface Notification {
	// Identifiers
	notificationId: string;              // UUID of notification
	notificationRecipientId: string;     // UUID for mark as read operation; empty for ephemeral SSE-only events

	// Content
	sourceDomain: SourceDomain;          // Business domain source
	notificationType: string;            // Dot-separated type (e.g., 'message.new')
	title: string;                       // Notification title
	message: string;                     // Notification message body
	actionData: ActionData | null;       // Action-specific metadata

	// Status (legacy)
	readStatus: boolean;                 // true if read, false if unread
	readAt: Date | null;                 // Timestamp when marked as read
	deliveryStatus: DeliveryStatus;      // Delivery state
	deliveredAt: Date | null;            // Timestamp when delivered via SSE

	// Acknowledgement lifecycle (spec 021)
	acknowledgementStatus: 'pending' | 'acknowledged';  // Unread = pending
	acknowledgedAt: Date | null;         // Timestamp when acknowledged
	acknowledgementAction: string;       // 'destination_open' or 'explicit_ack'
	policyKey: string;                   // Routing policy (e.g., 'chat_message')
	sourceCategory: string;              // 'activity', 'mention', 'system'
	navigationTarget: NavigationTarget | null; // Typed deep-link destination

	// Timestamps
	createdAt: Date;                     // When notification was created
}

/**
 * Typed deep-link destination for notification navigation
 */
export interface NavigationTarget {
	domain: string;       // Business domain (e.g., 'chat', 'projects', 'docs')
	resourceType: string; // Resource type within domain (e.g., 'channel', 'task')
	resourceId: string;   // Primary resource identifier
	secondaryId: string;  // Optional secondary resource (e.g., thread message ID)
	action: string;       // Optional navigation action hint
}

/**
 * Business domain that generated the notification
 */
export type SourceDomain =
	| 'chat'      // Chat/messaging
	| 'crm'       // Customer relationship management
	| 'projects'  // Project management
	| 'hr'        // Human resources
	| 'support'   // Customer support
	| 'finance'   // Finance/accounting
	| 'system';   // System-generated

/**
 * Notification delivery status
 */
export type DeliveryStatus =
	| 'pending'   // Not yet delivered
	| 'delivered' // Successfully delivered via SSE
	| 'failed';   // Delivery failed

/**
 * Action-specific data (flexible JSON structure)
 * Structure varies by notification type
 * 
 * Examples:
 * - Chat: { threadId: string, messageId: string }
 * - CRM: { dealId: string, contactId: string }
 * - Projects: { projectId: string, ticketId: string }
 */
export interface ActionData {
	[key: string]: unknown;
}

// ============================================================================
// SSE Connection State
// ============================================================================

/**
 * SSE connection state tracking
 * Managed by useSSEConnection hook
 */
export interface SSEConnectionState {
	// Connection status
	status: ConnectionStatus;            // Current connection state
	lastEventId: string | null;          // UUID of last received event (for replay)
	connectionId: string | null;         // Active SSE connection identifier

	// Connection metrics
	connectedAt: Date | null;            // When connection was established
	lastHeartbeat: Date | null;          // Last heartbeat event timestamp
	lastEventAt: Date | null;            // Last notification event timestamp
	eventCount: number;                  // Total events received this session

	// Reconnection state
	reconnectAttempt: number;            // Current reconnection attempt count
	nextReconnectDelay: number;          // Milliseconds until next reconnect

	// Proactive disconnect
	nextProactiveDisconnect: Date | null; // When 5-minute disconnect will occur
}

/**
 * SSE connection status
 */
export type ConnectionStatus =
	| 'disconnected'  // Initial state, not connected
	| 'connecting'    // Attempting to establish connection
	| 'connected'     // Connection established, receiving events
	| 'error';        // Connection failed

/**
 * SSE reconnection configuration
 */
export const SSE_CONFIG = {
	// Exponential backoff delays (milliseconds)
	RECONNECT_DELAYS: [1000, 2000, 4000, 8000, 30000] as const,

	// Proactive disconnect interval (5 minutes)
	PROACTIVE_DISCONNECT_INTERVAL: 5 * 60 * 1000,

	// LocalStorage key for last event ID
	LAST_EVENT_ID_KEY: 'notification_last_event_id',
	// LocalStorage key for presence connection ID coordination
	CONNECTION_ID_KEY: 'notification_connection_id',
} as const;

// ============================================================================
// Filter & Pagination State
// ============================================================================

/**
 * User-selected notification filters
 */
export interface NotificationFilters {
	// Read status filter
	showUnreadOnly: boolean;             // If true, filter to unread only

	// Source domain filter (empty = all domains)
	selectedSourceDomains: SourceDomain[];

	// Applied timestamp (for UI feedback)
	appliedAt: Date;
}

/**
 * Default filter state (show all notifications)
 */
export const DEFAULT_FILTERS: NotificationFilters = {
	showUnreadOnly: false,
	selectedSourceDomains: [],
	appliedAt: new Date(),
};

/**
 * Pagination state for notification list
 */
export interface PaginationState {
	// Pagination tokens
	currentPageToken: string;            // Token for current page
	nextPageToken: string | null;        // Token for next page (null if no more)

	// Page metadata
	itemsPerPage: number;                // Default 20
	currentPage: number;                 // 1-indexed page number
	hasNextPage: boolean;                // Derived from nextPageToken !== null

	// Loading state
	loadingState: LoadingState;          // Current loading status
	error: Error | null;                 // Error from last load attempt
}

/**
 * Loading state for async operations
 */
export type LoadingState =
	| 'idle'      // No operation in progress
	| 'loading'   // Loading in progress
	| 'error';    // Operation failed

/**
 * Default pagination state (first page)
 */
export const DEFAULT_PAGINATION: PaginationState = {
	currentPageToken: '',
	nextPageToken: null,
	itemsPerPage: 20,
	currentPage: 1,
	hasNextPage: false,
	loadingState: 'idle',
	error: null,
};

// ============================================================================
// Unread Count
// ============================================================================

/**
 * Unread notification counts (total and per-domain)
 */
export interface UnreadCount {
	// Total unread across all domains
	total: number;

	// Per-domain breakdown
	bySourceDomain: Record<SourceDomain, number>;

	// Metadata
	lastUpdated: Date;                   // When count was last fetched/updated
}

/**
 * Default unread count (all zeros)
 */
export const DEFAULT_UNREAD_COUNT: UnreadCount = {
	total: 0,
	bySourceDomain: {
		chat: 0,
		crm: 0,
		projects: 0,
		hr: 0,
		support: 0,
		finance: 0,
		system: 0,
	},
	lastUpdated: new Date(),
};

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
	notificationRecipientId: string;     // UUID for mark as read operation

	// Content
	sourceDomain: SourceDomain;          // Business domain source
	notificationType: string;            // Dot-separated type (e.g., 'message.new')
	title: string;                       // Notification title
	message: string;                     // Notification message body
	actionData: ActionData | null;       // Action-specific metadata

	// Status
	readStatus: boolean;                 // true if read, false if unread
	readAt: Date | null;                 // Timestamp when marked as read
	deliveryStatus: DeliveryStatus;      // Delivery state
	deliveredAt: Date | null;            // Timestamp when delivered via SSE

	// Timestamps
	createdAt: Date;                     // When notification was created
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
	itemsPerPage: number;                // Default 50
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
	itemsPerPage: 50,
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

// ============================================================================
// Sidebar Preview
// ============================================================================

/**
 * Notification preview data for right sidebar
 * Derived from main notification list (most recent unread)
 */
export interface SidebarPreviewData {
	// Recent unread notifications (max 5)
	recentNotifications: Notification[];

	// Badge count
	totalUnread: number;

	// Metadata
	lastUpdated: Date;
}

// ============================================================================
// Hook Return Types
// ============================================================================

/**
 * Return type for useSSEConnection hook
 */
export interface UseSSEConnectionReturn {
	// Connection state
	connectionState: SSEConnectionState;

	// Actions
	reconnect: () => void;               // Manual reconnection trigger
	disconnect: () => void;              // Manual disconnection
}

/**
 * Return type for useNotifications hook
 */
export interface UseNotificationsReturn {
	// State
	notifications: Notification[];
	unreadCount: UnreadCount;
	filters: NotificationFilters;
	pagination: PaginationState;

	// Actions
	markAsRead: (notificationRecipientId: string) => Promise<void>;
	markAllBeforeTimestampAsRead: (beforeTimestamp?: Date) => Promise<void>;
	deleteNotification: (notificationRecipientId: string) => Promise<void>;
	setFilters: (filters: NotificationFilters) => void;
	loadNextPage: () => Promise<void>;
	refreshUnreadCount: () => Promise<void>;

	// Real-time updates
	addNotification: (notification: Notification) => void;
}

// ============================================================================
// Component Props
// ============================================================================

/**
 * Props for NotificationList component
 */
export interface NotificationListProps {
	notifications: Notification[];
	loading: boolean;
	onMarkAsRead: (notificationRecipientId: string) => void;
	onDelete: (notificationRecipientId: string) => void;
	onLoadMore?: () => void;
	hasMore: boolean;
}

/**
 * Props for NotificationItem component
 */
export interface NotificationItemProps {
	notification: Notification;
	onMarkAsRead: (notificationRecipientId: string) => void;
	onDelete: (notificationRecipientId: string) => void;
	compact?: boolean;                   // Compact mode for sidebar
}

/**
 * Props for NotificationFilters component
 */
export interface NotificationFiltersProps {
	filters: NotificationFilters;
	unreadCount: UnreadCount;
	onFiltersChange: (filters: NotificationFilters) => void;
}

/**
 * Props for SSEConnectionStatus component
 */
export interface SSEConnectionStatusProps {
	connectionState: SSEConnectionState;
	onReconnect: () => void;
}

/**
 * Props for NotificationSidebar component
 */
export interface NotificationSidebarProps {
	preview: SidebarPreviewData;
	onNotificationClick?: (notificationId: string) => void;
	onViewAll: () => void;
}

// ============================================================================
// Utility Functions Type Signatures
// ============================================================================

/**
 * Map backend NotificationSummary protobuf to frontend Notification
 */
export type MapNotificationFromProto = (
	proto: any // NotificationSummary from protobuf (avoid import here)
) => Notification;

/**
 * Apply filters to notification list
 */
export type ApplyFilters = (
	notifications: Notification[],
	filters: NotificationFilters
) => Notification[];

/**
 * Get sidebar preview data from notification list
 */
export type GetSidebarPreview = (
	notifications: Notification[],
	unreadCount: number
) => SidebarPreviewData;

/**
 * Format relative timestamp (e.g., "2 hours ago")
 */
export type FormatRelativeTime = (date: Date) => string;

/**
 * Get source domain icon/emoji
 */
export type GetSourceDomainIcon = (sourceDomain: SourceDomain) => string;

/**
 * Get source domain display name
 */
export type GetSourceDomainLabel = (sourceDomain: SourceDomain) => string;

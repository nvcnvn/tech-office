/**
 * Search Types for Global Multilingual Fuzzy Search System
 * 
 * Custom TypeScript interfaces for search results and suggestions.
 * These types use JavaScript native types (Date, string) instead of protobuf types.
 * 
 * @see Constitution Principle VII - Frontend API Wrapper Pattern
 */

// ============================================================================
// Employee Search Types
// ============================================================================

export interface EmployeeSearchResult {
	id: string;
	email: string;
	givenName: string;
	familyName: string;
	isActive: boolean;
	relevanceScore: number; // 0-1 trigram similarity score
	updatedAt: Date;
}

export interface EmployeeSuggestion {
	id: string;
	email: string;
	givenName: string;
	familyName: string;
}

// ============================================================================
// Department Search Types
// ============================================================================

export interface DepartmentSearchResult {
	id: string;
	name: string;
	description: string;
	memberCount: number;
	parentDepartmentId?: string; // Undefined if root department
	relevanceScore: number;
	updatedAt: Date;
}

export interface DepartmentSuggestion {
	id: string;
	name: string;
	description: string;
}

// ============================================================================
// Channel Search Types
// ============================================================================

// Note: ChannelType is already defined in '../chat' with values:
// 'chat' | 'direct_message' | 'project_ticket_thread'
export type ChannelType = import('../chat').ChannelType;

export interface ChannelSearchResult {
	id: string;
	displayName: string;
	description: string;
	channelType: ChannelType;
	titleSlug: string;
	isPrivate: boolean;
	relevanceScore: number;
	updatedAt: Date;
}

export interface ChannelSuggestion {
	id: string;
	displayName: string;
	channelType: ChannelType;
	isPrivate: boolean;
}

// ============================================================================
// Message Search Types
// ============================================================================

export interface MessageSearchResult {
	id: string;
	messageText: string;
	authorEmployeeId: string;
	channelId: string;
	parentMessageId?: string; // Undefined if top-level message
	isEdited: boolean;
	relevanceScore: number;
	updatedAt: Date;
	// Contextual metadata for display
	channelName: string;
	channelIsPrivate: boolean;
}

// ============================================================================
// Search Category Type
// ============================================================================

// ============================================================================
// Federated Search Types (Feature 045)
//
// One request, eight sources, one ranked list. The fan-out, the access filtering, the
// ranking and the truncation all happen on the server, so web and mobile see the same
// results in the same order by construction. These are the native mirrors of
// rpc.v1.SearchHit / SearchTarget / SourceOutcome.
// ============================================================================

/**
 * The closed set of things a search can return. Adding a member is a change to the wire
 * contract, not an extension of it — both clients switch exhaustively on this.
 */
export type SearchKind =
	| 'person'
	| 'department'
	| 'channel'
	| 'message'
	| 'document'
	| 'file'
	| 'work_item'
	| 'event';

/**
 * What happened to one source. 'ok' with `hitCount: 0` is "no documents match";
 * 'unavailable' is "documents could not be searched". Keeping those apart is the whole
 * point of the outcome report. 'not_permitted' is neither: it is not broken, it is not
 * theirs.
 */
export type SourceStatus = 'ok' | 'unavailable' | 'not_permitted' | 'not_searched';

/**
 * The identifiers each kind needs to be opened, without a second lookup.
 *
 * Two of these are load-bearing: a document carries a **slug**, because both document
 * viewers route by slug and an id-only target pushes /docs/undefined; and a work item
 * carries its **project id** alongside its task id, because both task routes are
 * project-scoped.
 */
export interface SearchTarget {
	employeeId: string;
	departmentId: string;
	channelId: string;
	messageId: string;
	documentSlug: string;
	fileId: string;
	projectId: string;
	taskId: string;
	eventId: string;
}

/** One row in the ranked list. */
export interface SearchHit {
	kind: SearchKind;
	/** The thing's name — what someone typed to find it. */
	title: string;
	/** One line saying where it lives: an email, "in #general", a project name, a date. */
	contextLine: string;
	/** Matched-content excerpt where the source produces one; empty otherwise. */
	snippet: string;
	/** 0-based position within this hit's own source. Cross-source order is already applied. */
	rank: number;
	target: SearchTarget;
}

/** One per source, always eight entries, in the server's fixed source order. */
export interface SourceOutcome {
	kind: SearchKind;
	status: SourceStatus;
	/** How many of that source's hits are in the response, after capping. */
	hitCount: number;
	/** Short, non-sensitive reason when the status is not 'ok'. Safe to show. */
	detail: string;
}

/** One ranked list plus the per-source outcome report. */
export interface SearchResults {
	hits: SearchHit[];
	outcomes: SourceOutcome[];
}

/**
 * Union type for all searchable categories in the system.
 * Used for routing and UI categorization.
 */
export type SearchCategory = 'employees' | 'departments' | 'channels' | 'messages';

/**
 * Autocomplete suggestion discriminated union.
 */
export type AutocompleteSuggestion =
	| { category: 'employees'; suggestion: EmployeeSuggestion }
	| { category: 'departments'; suggestion: DepartmentSuggestion }
	| { category: 'channels'; suggestion: ChannelSuggestion };

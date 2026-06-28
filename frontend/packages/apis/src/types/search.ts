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
// 'chat' | 'direct_message' | 'project_ticket_thread' | 'crm_deal_notes' | 'support_ticket'
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

/**
 * Union type for all searchable categories in the system.
 * Used for routing and UI categorization.
 */
export type SearchCategory = 'employees' | 'departments' | 'channels' | 'messages';

/**
 * Search result discriminated union for federated search.
 */
export type SearchResult =
	| { category: 'employees'; result: EmployeeSearchResult }
	| { category: 'departments'; result: DepartmentSearchResult }
	| { category: 'channels'; result: ChannelSearchResult }
	| { category: 'messages'; result: MessageSearchResult };

/**
 * Autocomplete suggestion discriminated union.
 */
export type AutocompleteSuggestion =
	| { category: 'employees'; suggestion: EmployeeSuggestion }
	| { category: 'departments'; suggestion: DepartmentSuggestion }
	| { category: 'channels'; suggestion: ChannelSuggestion };

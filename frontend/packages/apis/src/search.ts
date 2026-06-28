/**
 * Search Aggregation Module
 * 
 * Provides federated search functionality by aggregating results from multiple domains.
 * Uses Promise.all for parallel execution of domain-specific searches.
 */

import { searchEmployees, searchDepartments } from './organization';
import { searchChannels, searchMessages } from './chat';
import type {
	EmployeeSearchResult,
	DepartmentSearchResult,
	ChannelSearchResult,
	MessageSearchResult,
} from './types/search';

/**
 * Aggregated search results from all domains
 */
export interface FederatedSearchResults {
	employees: EmployeeSearchResult[];
	departments: DepartmentSearchResult[];
	channels: ChannelSearchResult[];
	messages: MessageSearchResult[];
}

/**
 * Search across all domains in parallel
 * 
 * @param queryText - Search query
 * @param limit - Maximum results per category (default 10)
 * @returns Aggregated results from all domains
 * 
 * @example
 * ```ts
 * const results = await searchAll('project alpha');
 * console.log(results.channels.length); // 3 matching channels
 * console.log(results.messages.length); // 15 matching messages
 * ```
 */
export async function searchAll(
	queryText: string,
	limit: number = 10
): Promise<FederatedSearchResults> {
	// Execute all searches in parallel for performance
	const [employees, departments, channels, messages] = await Promise.all([
		searchEmployees(queryText, limit).catch(() => []),
		searchDepartments(queryText, limit).catch(() => []),
		searchChannels(queryText, limit).catch(() => []),
		searchMessages(queryText, limit).catch(() => []),
	]);

	return {
		employees,
		departments,
		channels,
		messages,
	};
}


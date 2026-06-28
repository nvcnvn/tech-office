/**
 * Organization API functions
 * ConnectRPC-based API calls for organization lookup and management
 */

import { organizationClient } from "./rpc";
import rpcCall from "./rpcWrapper";
import { Organization } from "./types";
import { APIError, OrganizationError, ValidationError, NetworkError } from "./errors";
import { organizations } from "rpc";

// Type aliases for RPC responses
type GetOrganizationBySubdomainResponse = organizations.GetOrganizationBySubdomainResponse;
type RegisterOrganizationWithAdminPasswordResponse = organizations.RegisterOrganizationWithAdminPasswordResponse;

/**
 * Organization status constants.
 * 
 * MUST align with:
 * - Database CHECK constraint: public.organization.status
 * - Backend Go constants: internal/organization/constants.go
 * 
 * When adding/removing values:
 * 1. Update database CHECK constraint in backend/database/scripts/schema.sql
 * 2. Update backend Go constants
 * 3. Update this TypeScript type
 * 4. Submit all changes in single PR with alignment verification
 */
export type OrganizationStatus = 'active' | 'suspended' | 'deleted';


/**
 * Get organization by subdomain
 * Used on login page to validate subdomain and get org details
 * 
 * @param subdomain - Organization subdomain (e.g., "acme")
 * @returns Organization details
 * @throws OrganizationError if organization not found (404) - converted from backend NotFound response
 * @throws ValidationError if subdomain format is invalid (400)
 * @throws NetworkError for connectivity issues (503/500)
 * 
 * @example
 * ```ts
 * try {
 *   const org = await getOrganizationBySubdomain('acme');
 *   console.log(org.companyName);
 * } catch (err) {
 *   if (err instanceof OrganizationError) {
 *     // Handle organization not found
 *   } else if (err instanceof ValidationError) {
 *     // Handle invalid subdomain
 *   }
 * }
 * ```
 */
export async function getOrganizationBySubdomain(subdomain: string): Promise<Organization> {
	try {
		return await rpcCall(async () => {
			const resp = await organizationClient.getOrganizationBySubdomain({ subdomain }) as GetOrganizationBySubdomainResponse;

			if (!resp.organization) {
				// This shouldn't happen if backend correctly returns NotFound error
				throw new APIError(
					'ORGANIZATION_NOT_FOUND',
					`Organization not found for subdomain: ${subdomain}`,
					'subdomain',
					404
				);
			}

			// Map RPC DTO -> frontend Organization type
			return {
				id: resp.organization.id,
				companyName: resp.organization.companyName,
				subdomain: resp.organization.subdomain,
				clientId: resp.organization.clientId,
				updatedAt: resp.organization.updatedAt
					? new Date(Number(resp.organization.updatedAt.seconds) * 1000).toISOString()
					: new Date().toISOString(),
			};
		});
	} catch (err) {
		// Convert generic NOT_FOUND error to domain-specific OrganizationError
		if (err instanceof APIError && err.code === 'NOT_FOUND') {
			throw new OrganizationError(
				'ORGANIZATION_NOT_FOUND',
				`Organization not found for subdomain: ${subdomain}`,
				'subdomain',
				404
			);
		}
		// Re-throw other errors (ValidationError, NetworkError, etc.)
		throw err;
	}
}

/**
 * Register a new organization with admin user password
 * Public endpoint for organization signup
 * 
 * @param data - Signup form data
 * @returns Created organization details
 * @throws OrganizationError if subdomain/email already registered (409)
 * @throws ValidationError if form data is invalid (400)
 * @throws NetworkError for connectivity issues (500)
 * 
 * @example
 * ```ts
 * try {
 *   const org = await registerOrganizationWithAdminPassword({
 *     companyName: 'Acme Corp',
 *     subdomain: 'acme',
 *     adminEmail: 'admin@acme.com',
 *     adminPassword: 'SecurePassword123456',
 *     adminGivenName: 'John',
 *     adminFamilyName: 'Doe'
 *   });
 *   console.log(`Organization ${org.id} created`);
 * } catch (err) {
 *   if (err instanceof OrganizationError) {
 *     // Handle duplicate subdomain/email
 *   }
 * }
 * ```
 */
export async function registerOrganizationWithAdminPassword(data: {
	companyName: string;
	subdomain: string;
	adminEmail: string;
	adminPassword: string;
	adminGivenName: string;
	adminFamilyName: string;
}): Promise<Organization> {
	return rpcCall(async () => {
		const resp = await organizationClient.registerOrganizationWithAdminPassword({
			companyName: data.companyName,
			subdomain: data.subdomain,
			adminEmail: data.adminEmail,
			adminPassword: data.adminPassword,
			adminGivenName: data.adminGivenName,
			adminFamilyName: data.adminFamilyName,
		}) as RegisterOrganizationWithAdminPasswordResponse;

		if (!resp.organization) {
			throw new OrganizationError(
				'REGISTRATION_FAILED',
				'Organization registration failed',
				'organization',
				500
			);
		}

		// Map RPC DTO -> frontend Organization type
		return {
			id: resp.organization.id,
			companyName: resp.organization.companyName,
			subdomain: resp.organization.subdomain,
			clientId: resp.organization.clientId,
			updatedAt: resp.organization.updatedAt
				? new Date(Number(resp.organization.updatedAt.seconds) * 1000).toISOString()
				: new Date().toISOString(),
		};
	});
}

/**
 * Check if subdomain is available for registration
 * Returns true if available (not found), false if taken
 * 
 * @param subdomain - Subdomain to check
 * @returns True if available, false if taken
 * @throws ValidationError if subdomain format is invalid
 * @throws NetworkError for connectivity issues
 * 
 * @example
 * ```ts
 * const isAvailable = await checkSubdomainAvailability('acme');
 * if (isAvailable) {
 *   console.log('Subdomain is available');
 * } else {
 *   console.log('Subdomain is already taken');
 * }
 * ```
 */
export async function checkSubdomainAvailability(subdomain: string): Promise<boolean> {
	try {
		await getOrganizationBySubdomain(subdomain);
		// If we get here, organization exists -> subdomain is taken
		return false;
	} catch (err) {
		if (err instanceof OrganizationError && err.code === 'ORGANIZATION_NOT_FOUND') {
			// Organization not found -> subdomain is available
			return true;
		}
		// Re-throw other errors (validation, network)
		throw err;
	}
}

// ============================================================================
// Search API Functions
// ============================================================================

import type {
	EmployeeSearchResult,
	EmployeeSuggestion,
	DepartmentSearchResult,
	DepartmentSuggestion,
} from "./types/search";
import { protoTimestampToDate } from "./proto-utils";

/**
 * Search employees by name or email using fuzzy matching
 * 
 * @param queryText - Search query (name or email)
 * @param limit - Maximum number of results (default 50, max 100)
 * @param cursor - Pagination cursor (UUID of last result from previous page)
 * @returns Array of employee search results with relevance scores
 * @throws ValidationError if queryText is empty or limit is invalid
 * @throws NetworkError for connectivity issues
 * 
 * @example
 * ```ts
 * const results = await searchEmployees('john smith', 20);
 * console.log(results[0].relevanceScore); // 0.95
 * ```
 */
export async function searchEmployees(
	queryText: string,
	limit: number = 50,
	cursor?: string
): Promise<EmployeeSearchResult[]> {
	return await rpcCall(async () => {
		const resp = await organizationClient.searchEmployees({
			queryText,
			limit,
			cursor: cursor || '',
		}) as organizations.SearchEmployeesResponse;

		return (resp.results || []).map(r => ({
			id: r.id,
			email: r.email,
			givenName: r.givenName,
			familyName: r.familyName,
			isActive: r.isActive,
			relevanceScore: r.relevanceScore,
			updatedAt: protoTimestampToDate(r.updatedAt) || new Date(),
		}));
	});
}

/**
 * Autocomplete employee names for quick selection (prefix-based)
 * 
 * @param prefix - Name prefix to match (case-insensitive)
 * @param limit - Maximum number of suggestions (default 10, max 20)
 * @returns Array of employee suggestions
 * @throws ValidationError if prefix is empty
 * 
 * @example
 * ```ts
 * const suggestions = await autocompleteEmployees('joh');
 * // Returns employees starting with "joh": John, Johanna, etc.
 * ```
 */
export async function autocompleteEmployees(
	prefix: string,
	limit: number = 10
): Promise<EmployeeSuggestion[]> {
	return await rpcCall(async () => {
		const resp = await organizationClient.autocompleteEmployees({
			prefix,
			limit,
		}) as organizations.AutocompleteEmployeesResponse;

		return (resp.suggestions || []).map(s => ({
			id: s.id,
			email: s.email,
			givenName: s.givenName,
			familyName: s.familyName,
		}));
	});
}

/**
 * Search departments by name or description using fuzzy matching
 * 
 * @param queryText - Search query (department name or description)
 * @param limit - Maximum number of results (default 50, max 100)
 * @param cursor - Pagination cursor (UUID of last result)
 * @returns Array of department search results with relevance scores
 * 
 * @example
 * ```ts
 * const results = await searchDepartments('engineering');
 * console.log(results[0].memberCount); // Number of employees in department
 * ```
 */
export async function searchDepartments(
	queryText: string,
	limit: number = 50,
	cursor?: string
): Promise<DepartmentSearchResult[]> {
	return await rpcCall(async () => {
		const resp = await organizationClient.searchDepartments({
			queryText,
			limit,
			cursor: cursor || '',
		}) as organizations.SearchDepartmentsResponse;

		return (resp.results || []).map(r => ({
			id: r.id,
			name: r.name,
			description: r.description,
			memberCount: r.memberCount,
			parentDepartmentId: r.parentDepartmentId || undefined,
			relevanceScore: r.relevanceScore,
			updatedAt: protoTimestampToDate(r.updatedAt) || new Date(),
		}));
	});
}

/**
 * Autocomplete department names for quick selection (prefix-based)
 * 
 * @param prefix - Department name prefix to match
 * @param limit - Maximum number of suggestions (default 10, max 20)
 * @returns Array of department suggestions
 * 
 * @example
 * ```ts
 * const suggestions = await autocompleteDepartments('eng');
 * // Returns: Engineering, Engineering Operations, etc.
 * ```
 */
export async function autocompleteDepartments(
	prefix: string,
	limit: number = 10
): Promise<DepartmentSuggestion[]> {
	return await rpcCall(async () => {
		const resp = await organizationClient.autocompleteDepartments({
			prefix,
			limit,
		}) as organizations.AutocompleteDepartmentsResponse;

		return (resp.suggestions || []).map(s => ({
			id: s.id,
			name: s.name,
			description: s.description,
		}));
	});
}


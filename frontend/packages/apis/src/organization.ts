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
 * Register a new organization together with its owner.
 * Public endpoint for workspace signup.
 *
 * The response carries no session token: the caller signs in immediately afterwards and
 * MUST distinguish "workspace created but sign-in failed" from "signup failed", because a
 * retry of signup would collide on the owner's own address.
 * 
 * @param data - Signup form data
 * @returns Created organization details
 * @throws OrganizationError if the address is already taken (409) — the error carries a
 *         google.rpc.BadRequest naming the `subdomain` field; read it with `fieldViolation`
 * @throws ValidationError if the address is malformed or form data is invalid (400)
 * @throws NetworkError for connectivity issues (500)
 * 
 * @example
 * ```ts
 * try {
 *   const org = await registerOrganization({
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
export async function registerOrganization(data: {
	companyName: string;
	subdomain: string;
	adminEmail: string;
	adminPassword: string;
	adminGivenName: string;
	adminFamilyName: string;
	/**
	 * The terms version the person acknowledged on the signup screen — pass
	 * `TERMS_VERSION` from `./legal`, and only when they actually ticked the box.
	 *
	 * Required rather than defaulted so a screen cannot silently accept on the
	 * person's behalf; the backend rejects a missing or stale value (FR-010).
	 */
	acceptedTermsVersion: string;
}): Promise<Organization> {
	return rpcCall(async () => {
		const resp = await organizationClient.registerOrganizationWithAdminPassword({
			companyName: data.companyName,
			subdomain: data.subdomain,
			adminEmail: data.adminEmail,
			adminPassword: data.adminPassword,
			adminGivenName: data.adminGivenName,
			adminFamilyName: data.adminFamilyName,
			acceptedTermsVersion: data.acceptedTermsVersion,
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
 * Workspace-address format rules.
 *
 * MUST align with backend Go: internal/organization/subdomain.go
 * (SubdomainMinLength, SubdomainMaxLength, reservedSubdomains, subdomainPattern).
 * The server is the authority; these exist so a form can validate without a round-trip.
 */
export const SUBDOMAIN_MIN_LENGTH = 3;
export const SUBDOMAIN_MAX_LENGTH = 63; // a DNS label cannot exceed 63 octets

const RESERVED_SUBDOMAINS = new Set([
	'www',
	'api',
	'app',
	'admin',
	'mail',
	'static',
	'assets',
]);

const SUBDOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/** Lower-case and trim a candidate address. Does not validate. */
export function normalizeSubdomain(subdomain: string): string {
	return subdomain.trim().toLowerCase();
}

/**
 * Whether a normalized address satisfies the format rules. Mirrors the server so a form
 * can give immediate feedback; the server still validates before insert.
 */
export function isValidSubdomain(subdomain: string): boolean {
	const s = normalizeSubdomain(subdomain);
	return (
		s.length >= SUBDOMAIN_MIN_LENGTH &&
		s.length <= SUBDOMAIN_MAX_LENGTH &&
		SUBDOMAIN_PATTERN.test(s) &&
		!s.includes('--') &&
		!RESERVED_SUBDOMAINS.has(s)
	);
}

/**
 * Derive a workspace address from a company name: "Anna's Café" -> "annas-cafe".
 *
 * Mirrors backend Derive in internal/organization/subdomain.go. Returns '' when the name
 * yields nothing usable, in which case the caller must ask for an address rather than
 * inventing one.
 */
export function deriveSubdomain(companyName: string): string {
	// Decompose, then drop combining marks, so "é" folds to "e" instead of vanishing.
	const folded = companyName.normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase();

	let out = '';
	let lastHyphen = false;
	for (const ch of folded) {
		if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) {
			out += ch;
			lastHyphen = false;
		} else if ("'\u2019`\u00b4".includes(ch)) {
			// Apostrophes join a word rather than separating one: "Anna's" is "annas".
			continue;
		} else if (!lastHyphen && out.length > 0) {
			// Collapse any run of non-alphanumerics into a single hyphen.
			out += '-';
			lastHyphen = true;
		}
	}

	let candidate = out.replace(/^-+|-+$/g, '');
	if (candidate.length > SUBDOMAIN_MAX_LENGTH) {
		candidate = candidate.slice(0, SUBDOMAIN_MAX_LENGTH).replace(/^-+|-+$/g, '');
	}

	return isValidSubdomain(candidate) ? candidate : '';
}

/**
 * Result of a workspace-address availability check.
 */
export interface SubdomainAvailability {
	available: boolean;
	/**
	 * The next free variant of the requested address, populated only when it is taken
	 * (e.g. "annas-cafe" taken -> "annas-cafe-2"). Empty when the address is free, or
	 * when no variant was found.
	 */
	suggested: string;
}

/**
 * Check whether a workspace address is free and well-formed.
 *
 * Unauthenticated: a signup form calls this before an account exists. A taken address is a
 * successful response with `available: false` plus a suggested alternative, not an error —
 * only a malformed address throws.
 *
 * @param subdomain - Candidate address, without the domain suffix. Case-insensitive.
 * @returns Availability, and an alternative to offer when the address is taken
 * @throws ValidationError if the address format is invalid (400)
 * @throws NetworkError for connectivity issues
 *
 * @example
 * ```ts
 * const result = await checkSubdomainAvailable('annas-cafe');
 * if (!result.available && result.suggested) {
 *   console.log(`Taken. Try ${result.suggested} instead.`);
 * }
 * ```
 */
export async function checkSubdomainAvailable(subdomain: string): Promise<SubdomainAvailability> {
	return rpcCall(async () => {
		const resp = await organizationClient.checkSubdomainAvailable({
			subdomain,
		}) as organizations.CheckSubdomainAvailableResponse;

		return {
			available: resp.available,
			suggested: resp.suggested ?? '',
		};
	});
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


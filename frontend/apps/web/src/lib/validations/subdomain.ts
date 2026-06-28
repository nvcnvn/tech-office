import { z } from 'zod';

/**
 * Subdomain validation schema
 * Enforces DNS-compliant subdomain rules with lowercase transformation
 */
export const subdomainSchema = z
	.string()
	.min(3, 'Subdomain must be at least 3 characters')
	.max(32, 'Subdomain must be 32 characters or less')
	.regex(
		/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/,
		'Subdomain: lowercase letters, numbers, hyphens only; must start/end with letter or number'
	)
	.transform((val) => val.toLowerCase());

/**
 * Remove invalid characters from subdomain string
 * @param input - Raw subdomain input
 * @returns Sanitized subdomain (lowercase, alphanumeric + hyphens only)
 */
export function sanitizeSubdomain(input: string): string {
	return input
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, '') // Remove invalid chars
		.replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
}

/**
 * Check if subdomain format is valid (without throwing)
 * @param subdomain - Subdomain to check
 * @returns True if format is valid
 */
export function isValidSubdomainFormat(subdomain: string): boolean {
	try {
		subdomainSchema.parse(subdomain);
		return true;
	} catch {
		return false;
	}
}

/**
 * Generate subdomain suggestions from company name
 * @param companyName - Company name to generate suggestions from
 * @returns Array of suggested subdomains
 */
export function generateSubdomainSuggestions(companyName: string): string[] {
	if (!companyName) return [];

	const base = sanitizeSubdomain(companyName);

	// If base is valid, return it as first suggestion
	const suggestions: string[] = [];

	if (base.length >= 3 && base.length <= 32 && isValidSubdomainFormat(base)) {
		suggestions.push(base);
	}

	// Add variations
	const truncated = base.slice(0, 28); // Leave room for suffixes
	if (truncated.length >= 3) {
		suggestions.push(`${truncated}-hq`);
		suggestions.push(`${truncated}-app`);
		suggestions.push(`${truncated}-co`);
	}

	// Remove duplicates and return
	return [...new Set(suggestions)];
}

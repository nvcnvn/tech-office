/**
 * Auth configuration utilities
 */

/**
 * Extract subdomain from hostname
 * Example: "acme.tech-office.com" -> "acme"
 * Returns null for localhost or base domain
 */
export function extractSubdomain(hostname: string): string | null {
	if (hostname === 'localhost' || hostname.startsWith('localhost:')) {
		return null;
	}

	const parts = hostname.split('.');
	if (parts.length > 2) {
		return parts[0];
	}

	return null;
}

/**
 * Extract organization identifier from URL
 * Priority: subdomain > query parameter
 */
export function extractOrganization(
	hostname: string,
	searchParams: URLSearchParams
): string | null {
	const subdomain = extractSubdomain(hostname);
	if (subdomain) {
		return subdomain;
	}

	const orgParam = searchParams.get('org');
	if (orgParam) {
		return orgParam;
	}

	return null;
}

/**
 * Auth configuration utilities
 */

/** An IPv4 literal, with or without a port: 127.0.0.1, 192.168.1.7:3000. */
const IPV4_LITERAL = /^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/;

/**
 * Extract subdomain from hostname
 * Example: "acme.tech-office.com" -> "acme"
 * Returns null for localhost, an IP address, or the base domain
 */
export function extractSubdomain(hostname: string): string | null {
	if (hostname === 'localhost' || hostname.startsWith('localhost:')) {
		return null;
	}

	// A dev server reached by IP has dots but no subdomain: splitting 127.0.0.1 on "."
	// resolved the tenant as "127", and because hostname wins over ?org= the field could
	// not then be corrected by hand.
	if (IPV4_LITERAL.test(hostname)) {
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

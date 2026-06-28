/**
 * Text Utility Functions
 * Functions for text manipulation and formatting
 */

/**
 * Strip HTML tags from a string
 * @param html - HTML string to strip tags from
 * @returns Plain text without HTML tags
 */
export function stripHtml(html: string): string {
	if (!html) return '';

	// Create a temporary div element to leverage browser's HTML parsing
	if (typeof document !== 'undefined') {
		const tmp = document.createElement('div');
		tmp.innerHTML = html;
		return tmp.textContent || tmp.innerText || '';
	}

	// Fallback for server-side: use regex (less reliable but works)
	return html.replace(/<[^>]*>/g, '');
}

/**
 * Truncate text to a maximum length, adding ellipsis if truncated
 * @param text - Text to truncate
 * @param maxLength - Maximum length (default: 100)
 * @param ellipsis - Ellipsis string to append (default: '...')
 * @returns Truncated text
 */
export function truncateText(text: string, maxLength = 100, ellipsis = '...'): string {
	if (!text || text.length <= maxLength) return text;
	return text.substring(0, maxLength - ellipsis.length) + ellipsis;
}

/**
 * Strip HTML tags and truncate in one operation
 * @param html - HTML string to process
 * @param maxLength - Maximum length after stripping HTML (default: 100)
 * @returns Plain text, truncated if necessary
 */
export function stripAndTruncate(html: string, maxLength = 100): string {
	const plainText = stripHtml(html);
	return truncateText(plainText, maxLength);
}


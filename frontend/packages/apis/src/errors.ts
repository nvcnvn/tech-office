/**
 * Error classes for API operations
 * Provides a hierarchy of errors for better error handling and type safety
 */

/**
 * Base API error class
 * All API-specific errors should extend this class
 */
export class APIError extends Error {
	constructor(
		public code: string,
		message: string,
		public field?: string,
		public statusCode?: number
	) {
		super(message);
		this.name = 'APIError';
		// Maintains proper stack trace for where our error was thrown (only available on V8)
		if (typeof (Error as any).captureStackTrace === 'function') {
			(Error as any).captureStackTrace(this, this.constructor);
		}
	}
}

/**
 * Authentication-related errors
 * Used for login failures, token issues, permission denied, etc.
 */
export class AuthError extends APIError {
	constructor(code: string, message: string, field?: string, statusCode?: number) {
		super(code, message, field, statusCode);
		this.name = 'AuthError';
	}
}

/**
 * Organization-related errors
 * Used for organization not found, subdomain conflicts, etc.
 */
export class OrganizationError extends APIError {
	constructor(code: string, message: string, field?: string, statusCode?: number) {
		super(code, message, field, statusCode);
		this.name = 'OrganizationError';
	}
}

/**
 * Validation errors
 * Used for invalid format, missing required fields, etc.
 */
export class ValidationError extends APIError {
	constructor(message: string, field?: string, statusCode?: number) {
		super('VALIDATION_ERROR', message, field, statusCode);
		this.name = 'ValidationError';
	}
}

/**
 * Network/connectivity errors
 * Used for connection failures, timeouts, server unavailable, etc.
 */
export class NetworkError extends APIError {
	constructor(message: string, statusCode?: number) {
		super('NETWORK_ERROR', message, undefined, statusCode);
		this.name = 'NetworkError';
	}
}

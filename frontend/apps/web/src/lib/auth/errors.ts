/**
 * Authentication error definitions
 */

export enum AuthErrorCode {
	ORGANIZATION_NOT_FOUND = 'organization_not_found',
	TOKEN_EXPIRED = 'token_expired',
	INVALID_CREDENTIALS = 'invalid_credentials',
	NETWORK_ERROR = 'network_error',
	SERVER_ERROR = 'server_error',
	UNKNOWN_ERROR = 'unknown_error',
}

export class AuthError extends Error {
	constructor(
		public code: AuthErrorCode,
		public userMessage: string,
		public originalError?: unknown
	) {
		super(userMessage);
		this.name = 'AuthError';
	}
}

export function isAuthError(error: unknown): error is AuthError {
	return error instanceof AuthError;
}

export function getErrorMessage(error: unknown): string {
	if (isAuthError(error)) {
		return error.userMessage;
	}
	if (error instanceof Error) {
		return error.message;
	}
	return 'An unexpected error occurred';
}

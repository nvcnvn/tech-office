import { ConnectError, Code } from "@connectrpc/connect";
import { notifyAuthFailure } from "./auth-events";
import { APIError, ValidationError, NetworkError } from "./errors";

/**
 * Generic RPC call wrapper to centralize ConnectRPC error handling.
 *
 * Usage:
 *   return rpcCall(() => organizationClient.getOrganizationBySubdomain({ subdomain }));
 *
 * Behavior:
 * - If the thrown error is already an APIError, rethrows as-is.
 * - Maps common ConnectRPC codes to ValidationError or NetworkError.
 */
export async function rpcCall<T>(fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch (err) {
		// Preserve and rethrow domain/API errors
		if (err instanceof APIError) {
			throw err;
		}

		const cErr = ConnectError.from(err);

		if (cErr.code === Code.Unauthenticated) {
			// The transport's own text ("[unauthenticated] authentication token required")
			// describes a missing header, not anything a person can act on, so it never
			// reaches the UI. Listeners decide whether this is worth showing — a request
			// that raced a sign-out is not a session ending.
			const message = "Your session is no longer valid. Please sign in again.";
			await notifyAuthFailure({
				reason: "unauthenticated",
				message,
			});
			throw new APIError("UNAUTHENTICATED", message, undefined, 401);
		}

		if (cErr.code === Code.PermissionDenied) {
			throw new APIError(
				"PERMISSION_DENIED",
				cErr.message || "You do not have permission to perform this action.",
				undefined,
				403,
			);
		}

		// Map invalid arguments to a ValidationError (generic)
		if (cErr.code === Code.InvalidArgument) {
			throw new ValidationError(cErr.message || "Invalid argument", undefined, 400);
		}

		// Map not found to a generic APIError - domain functions should catch and convert to domain-specific errors
		if (cErr.code === Code.NotFound) {
			throw new APIError("NOT_FOUND", cErr.message || "Resource not found", undefined, 404);
		}

		// Aborted means a client-specified test-and-set failed — a document save from a
		// stale base version, for instance. It is not a transport problem and it carries a
		// typed detail the caller has to read, so the ConnectError is rethrown intact.
		// Flattening it here would leave every caller with "that didn't save" and no way
		// to say who got there first (Feature 049).
		if (cErr.code === Code.Aborted) {
			throw cErr;
		}

		// Transport / server problems -> NetworkError
		switch (cErr.code) {
			case Code.Unavailable:
			case Code.DeadlineExceeded:
			case Code.Internal:
			case Code.Unknown:
				throw new NetworkError(cErr.message || "RPC network error", 503);
			// Note: Code.ResourceExhausted is intentionally NOT included here.
			// Callers of PIN-auth endpoints must handle ConnectError with code
			// ResourceExhausted directly to extract lockout details via
			// extractPinAuthErrorDetail().
			default:
				// Fallback to NetworkError for anything else we don't explicitly handle
				throw new NetworkError(cErr.message || "RPC failure", 500);
		}
	}
}

export default rpcCall;

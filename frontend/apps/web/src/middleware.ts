// T035: Protected Route Middleware
// DISABLED for static export - all auth checks happen client-side via useRequireAuth()

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Middleware disabled for static export (output: 'export')
 * 
 * With static export, there's no server-side middleware execution.
 * All authentication checks happen client-side using useRequireAuth() hook.
 * 
 * This file is kept for reference but won't execute in production.
 */
export function middleware(request: NextRequest) {
	void request;
	// This middleware won't run with output: 'export'
	// Client-side auth checks via useRequireAuth() handle all protection
	return NextResponse.next();
}

/**
 * Configure which routes the middleware should run on
 * Note: With output: 'export', this matcher is ignored
 */
export const config = {
	matcher: [],  // Disabled - no routes matched
};

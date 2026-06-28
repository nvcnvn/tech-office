/**
 * Type definitions for API requests and responses
 */

// ============================================================================
// Preference Types
// ============================================================================

/**
 * Theme mode for UI appearance
 * MUST align with backend constants in internal/preference/constants.go
 * and proto enum rpc.v1.ThemeMode
 */
export type ThemeMode = 'light' | 'dark';

/**
 * Source of theme preference selection
 * MUST align with backend constants in internal/preference/constants.go
 * and proto enum rpc.v1.PreferenceSource
 */
export type PreferenceSource = 'manual' | 'os_default';

/**
 * User preference response from backend
 */
export interface UserPreference {
	themeMode: ThemeMode;
	preferenceSource: PreferenceSource;
	exists: boolean;
}

// ============================================================================
// Organization Types
// ============================================================================

/**
 * Organization details returned from backend
 */
export interface Organization {
	id: string;
	companyName: string;
	subdomain: string;
	clientId: string;
	updatedAt: string;
}

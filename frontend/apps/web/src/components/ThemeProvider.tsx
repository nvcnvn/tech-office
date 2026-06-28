/**
 * Custom ThemeProvider component
 * Wraps Material-UI ThemeProvider with theme persistence and server sync
 * 
 * Features:
 * - localStorage caching for immediate theme application
 * - Server preference sync (authoritative source)
 * - OS preference detection for first-time users
 * - Smooth 700ms transitions between themes
 * - SSR-compatible initialization
 */

'use client';

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { ThemeProvider as MUIThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { getThemeByMode } from '../theme/tokens';
import {
	saveThemePreference,
	loadThemePreference,
	detectOSTheme,
	getUserPreference,
	updateUserPreference,
	ThemeMode,
} from 'apis';

// Theme context interface
interface ThemeContextValue {
	themeMode: ThemeMode;
	toggleTheme: () => Promise<void>;
	loading: boolean;
	initialized: boolean;
}

// Create context with undefined default
const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

/**
 * Hook to access theme context
 * Must be used within ThemeProvider
 */
export function useTheme(): ThemeContextValue {
	const context = useContext(ThemeContext);
	if (!context) {
		throw new Error('useTheme must be used within ThemeProvider');
	}
	return context;
}

interface ThemeProviderProps {
	children: ReactNode;
	employeeId: string; // Required for localStorage scoping and API calls
}

/**
 * Custom ThemeProvider component
 * 
 * Initialization flow:
 * 1. Load from localStorage (immediate, optimistic)
 * 2. Fetch from server (authoritative)
 * 3. If mismatch, server wins and updates localStorage
 * 4. If no server preference, detect OS preference and save as 'os_default'
 * 
 * @example
 * ```tsx
 * <ThemeProvider employeeId={currentUser.id}>
 *   <App />
 * </ThemeProvider>
 * ```
 */
export function ThemeProvider({ children, employeeId }: ThemeProviderProps) {
	const [themeMode, setThemeMode] = useState<ThemeMode>('light');
	const [loading, setLoading] = useState(false);
	const [initialized, setInitialized] = useState(false);

	// Initialize theme on mount
	useEffect(() => {
		async function initializeTheme() {
			try {
				// Step 1: Load from localStorage for immediate application (optimistic)
				const cachedTheme = loadThemePreference(employeeId);
				if (cachedTheme) {
					setThemeMode(cachedTheme);
				}

				// Step 2: Fetch from server (authoritative)
				const serverPref = await getUserPreference();

				if (serverPref.exists) {
					// Server has preference: use it
					if (serverPref.themeMode !== cachedTheme) {
						// Mismatch: server wins, update localStorage
						setThemeMode(serverPref.themeMode);
						saveThemePreference(employeeId, serverPref.themeMode);
					}
				} else {
					// No server preference: first-time user
					// Detect OS preference and save as 'os_default'
					const osTheme = detectOSTheme();
					setThemeMode(osTheme);
					saveThemePreference(employeeId, osTheme);

					// Save to server with 'os_default' source
					await updateUserPreference(osTheme, 'os_default');
				}

				setInitialized(true);
			} catch (error) {
				console.error('[ThemeProvider] Failed to initialize theme:', error);
				// Fallback to OS preference on error
				const osTheme = detectOSTheme();
				setThemeMode(osTheme);
				saveThemePreference(employeeId, osTheme);
				setInitialized(true);
			}
		}

		initializeTheme();
	}, [employeeId]);

	// Remove no-transition class after initialization to enable smooth transitions
	useEffect(() => {
		if (initialized && typeof document !== 'undefined') {
			// Small delay to ensure DOM is ready
			setTimeout(() => {
				document.documentElement.classList.remove('no-transition');
			}, 100);
		}
	}, [initialized]);

	/**
	 * Toggle theme between light and dark
	 * Updates localStorage, server preference (with 'manual' source), and state
	 */
	const toggleTheme = async () => {
		if (loading) return; // Prevent concurrent toggles

		setLoading(true);
		try {
			const newMode: ThemeMode = themeMode === 'light' ? 'dark' : 'light';

			// Optimistically update UI
			setThemeMode(newMode);
			saveThemePreference(employeeId, newMode);

			// Sync to server with 'manual' source
			await updateUserPreference(newMode, 'manual');
		} catch (error) {
			console.error('[ThemeProvider] Failed to toggle theme:', error);
			// Revert on error
			const oldMode = themeMode;
			setThemeMode(oldMode);
			saveThemePreference(employeeId, oldMode);
		} finally {
			setLoading(false);
		}
	};

	// Get Material-UI theme based on current mode
	const theme = getThemeByMode(themeMode);

	return (
		<ThemeContext.Provider
			value={{
				themeMode,
				toggleTheme,
				loading,
				initialized,
			}}
		>
			<MUIThemeProvider theme={theme}>
				<CssBaseline />
				{children}
			</MUIThemeProvider>
		</ThemeContext.Provider>
	);
}

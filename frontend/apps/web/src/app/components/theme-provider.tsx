/**
 * MUI Theme Provider for public pages (landing, auth, etc.)
 *
 * Uses the same professional theme as the authenticated workspace so that
 * colors, typography, borders, and component overrides stay consistent
 * across the entire application.
 */
'use client';

import React from 'react';
import { AppRouterCacheProvider } from '@mui/material-nextjs/v15-appRouter';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { lightTheme } from '@/theme/tokens';

export function MuiThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <AppRouterCacheProvider>
      <ThemeProvider theme={lightTheme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </AppRouterCacheProvider>
  );
}
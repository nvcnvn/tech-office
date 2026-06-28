'use client';

import { useState } from 'react';
import { Select, MenuItem, FormControl, Box, Typography, CircularProgress } from '@mui/material';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeColors } from '@/theme/useThemeColors';

/**
 * Organization switcher dropdown component
 * Allows users to switch between their organization memberships
 */
export function OrganizationSwitcher() {
  const { currentOrg, organizations, switchOrganization } = useAuth();
  const colors = useThemeColors();
  const [isLoading, setIsLoading] = useState(false);

  const handleChange = async (orgId: string) => {
    if (orgId === currentOrg?.organizationId) return;
    
    setIsLoading(true);
    try {
      await switchOrganization(orgId);
      // Reload page to refresh org-scoped data
      window.location.reload();
    } catch (error) {
      console.error('Failed to switch organization:', error);
      setIsLoading(false);
    }
  };

  if (organizations.length === 0) {
    return null;
  }

  if (organizations.length === 1) {
    return (
      <Box sx={{ px: 2, py: 1 }}>
        <Typography variant="body2" style={colors.text.secondary.style}>
          {currentOrg?.organizationName || 'No Organization'}
        </Typography>
      </Box>
    );
  }

  return (
    <FormControl size="small" sx={{ minWidth: 200 }}>
      <Select
        value={currentOrg?.organizationId || ''}
        onChange={(e) => handleChange(e.target.value)}
        disabled={isLoading}
        displayEmpty
        data-testid="org-switcher"
        style={{
          ...colors.bg.paper.style,
          ...colors.text.primary.style,
        }}
      >
        {organizations.map((org) => (
          <MenuItem
            key={org.organizationId}
            value={org.organizationId}
            data-testid={`org-item-${org.organizationSubdomain}`}
          >
            <Box>
              <Typography variant="body2">{org.organizationName}</Typography>
              <Typography variant="caption" style={colors.text.secondary.style}>
                {org.roleNames?.join(', ') || 'Member'}
              </Typography>
            </Box>
          </MenuItem>
        ))}
      </Select>
      {isLoading && (
        <Box sx={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)' }}>
          <CircularProgress size={20} />
        </Box>
      )}
    </FormControl>
  );
}

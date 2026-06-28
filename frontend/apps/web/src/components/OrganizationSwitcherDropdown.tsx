'use client';

import { useState } from 'react';
import { Menu, MenuItem, Typography, Box, CircularProgress } from '@mui/material';
import { KeyboardArrowDown } from '@mui/icons-material';
import { useAuth } from '@/lib/auth/hooks';
import { useThemeColors } from '@/theme/useThemeColors';
import type { UserProfile } from '@/lib/auth/types';

interface OrganizationSwitcherDropdownProps {
  user: UserProfile;
  organizationName: string;
}

export function OrganizationSwitcherDropdown({ user, organizationName }: OrganizationSwitcherDropdownProps) {
  const { switchOrganization } = useAuth();
  const colors = useThemeColors();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [switching, setSwitching] = useState(false);
  const open = Boolean(anchorEl);

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleSwitch = async (orgId: string) => {
    if (orgId === user.organizationId || switching) return;
    
    setSwitching(true);
    handleClose();
    try {
      await switchOrganization(orgId);
      // Reload page to refresh org-scoped data
      window.location.reload();
    } catch (error) {
      console.error('Failed to switch organization:', error);
      setSwitching(false);
    }
  };

  return (
    <>
      <button
        onClick={handleClick}
        className="flex items-center gap-1 hover:opacity-80 transition-opacity"
        data-testid="org-switcher-button"
        disabled={switching}
      >
        <span className="font-semibold text-sm" style={colors.text.primary.style}>
          {organizationName}
        </span>
        {switching ? (
          <CircularProgress size={16} />
        ) : (
          <KeyboardArrowDown fontSize="small" style={colors.text.secondary.style} />
        )}
      </button>

      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'left',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'left',
        }}
      >
        {user.organizations.map((org) => (
          <MenuItem
            key={org.id}
            onClick={() => handleSwitch(org.organizationId)}
            selected={org.organizationId === user.organizationId}
            data-testid={`org-item-${org.organizationSubdomain}`}
          >
            <Box>
              <Typography variant="body2">{org.organizationName}</Typography>
              <Typography variant="caption" sx={{ color: colors.text.secondary.style.color }}>
                {org.roleNames?.join(', ') || 'Member'}
              </Typography>
            </Box>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

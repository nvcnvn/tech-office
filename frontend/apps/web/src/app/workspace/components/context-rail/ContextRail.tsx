'use client';

import type { ReactNode } from 'react';
import { Badge, Box, Button, Typography } from '@mui/material';

import { ContextRailEmptyState } from './ContextRailEmptyState';

export interface ContextRailProps {
  collapsedLabel?: string;
  hasBadgeAlert?: boolean;
  isAutoCollapsed?: boolean;
  open?: boolean;
  title?: string;
  children?: ReactNode;
  onToggle?: () => void;
  toggleLabel?: string;
  testId?: string;
  toggleTestId?: string;
}

const railWidth = 320;
const collapsedRailWidth = 56;

export function ContextRail({
  collapsedLabel = 'Context rail',
  hasBadgeAlert = false,
  isAutoCollapsed = false,
  open = true,
  title = 'Context Rail',
  children,
  onToggle,
  toggleLabel,
  testId,
  toggleTestId,
}: ContextRailProps) {
  return (
    <Box
      data-testid={testId ?? 'context-rail'}
      data-auto-collapsed={isAutoCollapsed ? 'true' : 'false'}
      data-has-badge-alert={hasBadgeAlert ? 'true' : 'false'}
      data-open={open ? 'true' : 'false'}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        width: open ? railWidth : collapsedRailWidth,
        overflow: 'hidden',
        borderLeft: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
        transition: (theme) => theme.transitions.create('width', {
          duration: theme.transitions.duration.shorter,
        }),
      }}
    >
      <Box
        sx={{
          display: 'flex',
          flexDirection: open ? 'row' : 'column',
          alignItems: 'center',
          justifyContent: open ? 'space-between' : 'flex-start',
          gap: 1,
          px: open ? 2 : 1,
          py: 1.5,
          minHeight: 56,
          borderBottom: open ? 1 : 0,
          borderColor: 'divider',
        }}
      >
        {open ? (
          <Typography variant="subtitle2" fontWeight={700} color="text.primary">
            {title}
          </Typography>
        ) : (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              writingMode: 'vertical-rl',
              transform: 'rotate(180deg)',
              letterSpacing: 1,
              textTransform: 'uppercase',
            }}
          >
            {collapsedLabel}
          </Typography>
        )}
        <Badge
          color="error"
          overlap="circular"
          variant="dot"
          invisible={open || !hasBadgeAlert}
          anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        >
          <Button
            aria-label={toggleLabel ?? (open ? 'Collapse context rail' : 'Open context rail')}
            data-has-badge-alert={hasBadgeAlert ? 'true' : 'false'}
            data-testid={toggleTestId ?? (testId ? `${testId}-toggle` : undefined)}
            size="small"
            variant={open ? 'text' : 'contained'}
            onClick={onToggle}
            sx={{
              minWidth: open ? 0 : 40,
              width: open ? 'auto' : 40,
              whiteSpace: 'nowrap',
              px: open ? 1 : 0,
            }}
          >
            {toggleLabel ?? (open ? 'Collapse' : 'Open')}
          </Button>
        </Badge>
      </Box>

      {open ? (
        <Box sx={{ display: 'grid', gap: 2, p: 2, overflowY: 'auto' }}>
          {children ?? (
            <ContextRailEmptyState message="No context is available for this page yet." />
          )}
        </Box>
      ) : null}
    </Box>
  );
}

export default ContextRail;
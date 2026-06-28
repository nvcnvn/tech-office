'use client';

import { Box, Typography } from '@mui/material';

export interface ContextRailEmptyStateProps {
  title?: string;
  message: string;
  testId?: string;
}

export function ContextRailEmptyState({
  title,
  message,
  testId,
}: ContextRailEmptyStateProps) {
  return (
    <Box
      data-testid={testId ?? 'context-rail-empty-state'}
      sx={{
        border: '1px dashed',
        borderColor: 'divider',
        borderRadius: 2,
        px: 2,
        py: 2.5,
        textAlign: 'center',
        color: 'text.secondary',
      }}
    >
      {title ? (
        <Typography variant="body2" fontWeight={600} color="text.primary">
          {title}
        </Typography>
      ) : null}
      <Typography
        variant="body2"
        sx={{
          mt: title ? 0.75 : 0,
        }}
      >
        {message}
      </Typography>
    </Box>
  );
}

export default ContextRailEmptyState;
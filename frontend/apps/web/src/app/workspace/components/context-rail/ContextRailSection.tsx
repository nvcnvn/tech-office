'use client';

import type { ReactNode } from 'react';
import { Box, Divider, Typography } from '@mui/material';

export interface ContextRailSectionProps {
  description?: ReactNode;
  title: string;
  action?: ReactNode;
  children: ReactNode;
  testId?: string;
}

export function ContextRailSection({
  title,
  description,
  action,
  children,
  testId,
}: ContextRailSectionProps) {
  return (
    <Box
      data-testid={testId}
      sx={{
        display: 'grid',
        gap: 1.5,
        p: 1.5,
        border: 1,
        borderColor: 'divider',
        borderRadius: 2,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Box sx={{ display: 'grid', gap: 0.5 }}>
          <Typography variant="body2" fontWeight={700} color="text.primary">
            {title}
          </Typography>
          {description ? (
            <Typography variant="caption" color="text.secondary">
              {description}
            </Typography>
          ) : null}
        </Box>
        {action ? <Box sx={{ display: 'flex', alignItems: 'center' }}>{action}</Box> : null}
      </Box>
      <Divider />
      <Box sx={{ display: 'grid', gap: 1.5 }}>{children}</Box>
    </Box>
  );
}

export default ContextRailSection;
/**
 * Mention Preview Popup
 * Shows employee or department details when clicking on a @mention
 * 
 * Features:
 * - Employee mentions: avatar, name from label
 * - Department mentions: icon, name from label
 * - Styled popup using Popover
 * 
 * Note: Uses label from mention metadata (stored in message) to avoid extra API calls
 */

'use client';

import React from 'react';
import { Popover, Box, Avatar, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import GroupIcon from '@mui/icons-material/Group';

interface MentionPreviewProps {
	anchorEl: HTMLElement | null;
	anchorPosition?: { top: number; left: number } | null;
	mentionType: 'employee' | 'department';
	mentionLabel: string; // Display name from data-label attribute
	onClose: () => void;
}

export default function MentionPreview({ anchorEl, anchorPosition, mentionType, mentionLabel, onClose }: MentionPreviewProps) {
	const theme = useTheme();

	return (
		<Popover
			open={Boolean(anchorPosition || anchorEl)}
			anchorReference={anchorPosition ? 'anchorPosition' : 'anchorEl'}
			anchorPosition={anchorPosition ?? undefined}
			anchorEl={anchorPosition ? undefined : anchorEl}
			onClose={onClose}
			anchorOrigin={{
				vertical: 'bottom',
				horizontal: 'left',
			}}
			transformOrigin={{
				vertical: 'top',
				horizontal: 'left',
			}}
			slotProps={{
				paper: {
					elevation: 8,
					sx: {
						minWidth: 200,
						maxWidth: 300,
						p: 2,
						mt: 0.5, // Small margin below the mention
					},
				},
			}}
			disableScrollLock
			disableRestoreFocus
		>
			{mentionType === 'employee' ? (
				<Box>
					<Box display="flex" alignItems="center" gap={1.5}>
						<Avatar sx={{ width: 40, height: 40, bgcolor: theme.palette.primary.main }}>
							{mentionLabel.charAt(0).toUpperCase()}
						</Avatar>
						<Box>
							<Typography variant="subtitle2" fontWeight={600}>
								{mentionLabel}
							</Typography>
							<Typography variant="caption" color="text.secondary">
								Employee
							</Typography>
						</Box>
					</Box>
				</Box>
			) : (
				<Box>
					<Box display="flex" alignItems="center" gap={1.5}>
						<Avatar
							sx={{
								width: 40,
								height: 40,
								bgcolor: theme.palette.secondary.main,
							}}
						>
							<GroupIcon />
						</Avatar>
						<Box>
							<Typography variant="subtitle2" fontWeight={600}>
								{mentionLabel}
							</Typography>
							<Typography variant="caption" color="text.secondary">
								Department
							</Typography>
						</Box>
					</Box>
				</Box>
			)}
		</Popover>
	);
}

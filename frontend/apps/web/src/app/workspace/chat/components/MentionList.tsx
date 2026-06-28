/**
 * MentionList Component
 * Renders autocomplete dropdown for @mentions
 * 
 * Features:
 * - Lists channel members and departments
 * - Keyboard navigation (up/down arrows, enter to select)
 * - Mouse hover and click support
 * - Employee avatars and department icons
 */

'use client';

import React, { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { Avatar, Box, List, ListItemButton, ListItemAvatar, ListItemText, Paper } from '@mui/material';
import GroupIcon from '@mui/icons-material/Group';

export interface MentionItem {
	id: string;
	type: 'employee' | 'department';
	label: string;
	subtitle?: string; // Job title for employees, member count for departments
	avatarUrl?: string;
}

export interface MentionListProps {
	items: MentionItem[];
	command: (item: MentionItem) => void;
}

export interface MentionListRef {
	onKeyDown: (event: KeyboardEvent) => boolean;
}

const MentionList = forwardRef<MentionListRef, MentionListProps>((props, ref) => {
	const [selectedIndex, setSelectedIndex] = useState(0);

	useEffect(() => {
		// Reset selection when items change
		setSelectedIndex(0);
	}, [props.items]);

	const selectItem = (index: number) => {
		const item = props.items[index];
		if (item) {
			props.command(item);
		}
	};

	const upHandler = () => {
		setSelectedIndex((selectedIndex + props.items.length - 1) % props.items.length);
	};

	const downHandler = () => {
		setSelectedIndex((selectedIndex + 1) % props.items.length);
	};

	const enterHandler = () => {
		selectItem(selectedIndex);
	};

	useImperativeHandle(ref, () => ({
		onKeyDown: (event: KeyboardEvent) => {
			if (event.key === 'ArrowUp') {
				upHandler();
				return true;
			}

			if (event.key === 'ArrowDown') {
				downHandler();
				return true;
			}

			if (event.key === 'Enter' || event.key === 'Tab') {
				event.preventDefault(); // Prevent default Tab behavior
				enterHandler();
				return true;
			}

			return false;
		},
	}));

	if (props.items.length === 0) {
		return null;
	}

	return (
		<Paper
			elevation={0}
			sx={{
				maxHeight: '300px',
				overflowY: 'auto',
				width: '280px',
				borderRadius: 1,
			}}
		>
			<List sx={{ py: 0.5 }}>
				{props.items.map((item, index) => (
					<ListItemButton
						key={item.id}
						selected={index === selectedIndex}
						onClick={() => selectItem(index)}
						onMouseEnter={() => setSelectedIndex(index)}
						sx={{
							py: 1,
							px: 2,
						}}
					>
						<ListItemAvatar>
							{item.type === 'employee' ? (
								<Avatar
									src={item.avatarUrl}
									alt={item.label}
									sx={{ width: 32, height: 32 }}
								>
									{item.label.charAt(0).toUpperCase()}
								</Avatar>
							) : (
								<Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.main' }}>
									<GroupIcon fontSize="small" />
								</Avatar>
							)}
						</ListItemAvatar>
						<ListItemText
							primary={
								<Box component="span" sx={{ fontWeight: index === selectedIndex ? 600 : 400 }}>
									{item.label}
								</Box>
							}
							secondary={item.subtitle}
							primaryTypographyProps={{ variant: 'body2' }}
							secondaryTypographyProps={{ variant: 'caption' }}
						/>
					</ListItemButton>
				))}
			</List>
		</Paper>
	);
});

MentionList.displayName = 'MentionList';

export default MentionList;

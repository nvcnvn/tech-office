'use client';

import React from 'react';
import { Popover, Box } from '@mui/material';
import { DEFAULT_REACTION_EMOJIS } from '../utils/emoji';

interface ReactionPickerProps {
	anchorEl: HTMLElement | null;
	open: boolean;
	onClose: () => void;
	onSelect: (emoji: string) => void;
}

export default function ReactionPicker({
	anchorEl,
	open,
	onClose,
	onSelect,
}: ReactionPickerProps) {
	const handleEmojiClick = (emoji: string) => {
		onSelect(emoji);
		onClose();
	};

	return (
		<Popover
			open={open}
			anchorEl={anchorEl}
			onClose={onClose}
			anchorOrigin={{
				vertical: 'bottom',
				horizontal: 'left',
			}}
			transformOrigin={{
				vertical: 'top',
				horizontal: 'left',
			}}
		>
			<Box className="p-2 grid grid-cols-8 gap-1" sx={{ maxWidth: 320 }}>
				{DEFAULT_REACTION_EMOJIS.map((emoji) => (
					<button
						key={emoji}
						onClick={() => handleEmojiClick(emoji)}
						className="w-8 h-8 flex items-center justify-center text-xl hover:bg-gray-100 rounded transition-colors"
						title={emoji}
					>
						{emoji}
					</button>
				))}
			</Box>
		</Popover>
	);
}

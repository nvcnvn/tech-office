/**
 * RightPanel Component
 * Context panel for comments, version history, and citations
 */

'use client';

import React from 'react';
import { Box, Tabs, Tab, IconButton } from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';
import { useThemeColors } from '@/theme/useThemeColors';
import CommentsPanel from './CommentsPanel';
import VersionHistoryPanel from './VersionHistoryPanel';
import CitationsPanel from './CitationsPanel';

interface RightPanelProps {
	documentId: string;
	documentSlug: string;
	activeTab: 'comments' | 'history' | 'citations';
	onTabChange: (tab: 'comments' | 'history' | 'citations') => void;
	onClose: () => void;
	/** Callback when user clicks on a cited line range in Citations panel */
	onCitedLineClick?: (startLine: number, endLine: number) => void;
}

export default function RightPanel({
	documentId,
	documentSlug,
	activeTab,
	onTabChange,
	onClose,
	onCitedLineClick,
}: RightPanelProps) {
	const colors = useThemeColors();

	return (
		<Box
			sx={{
				display: 'flex',
				flexDirection: 'column',
				height: '100%',
				...colors.bg.paper.style,
			}}
		>
			{/* Header */}
			<Box
				sx={{
					display: 'flex',
					alignItems: 'center',
					borderBottom: 1,
					...colors.border.default.style,
				}}
			>
				<Tabs
					value={activeTab}
					onChange={(_, v) => onTabChange(v)}
					sx={{ flex: 1 }}
				>
					<Tab value="comments" label="Comments" data-testid="panel-comments-tab" />
					<Tab value="history" label="History" data-testid="panel-history-tab" />
					<Tab value="citations" label="Citations" data-testid="panel-citations-tab" />
				</Tabs>
				<IconButton onClick={onClose} size="small" sx={{ mr: 1 }}>
					<CloseIcon fontSize="small" />
				</IconButton>
			</Box>

			{/* Content */}
			<Box sx={{ flex: 1, overflow: 'auto' }}>
				{activeTab === 'comments' && (
					<CommentsPanel documentId={documentId} />
				)}
				{activeTab === 'history' && (
					<VersionHistoryPanel documentId={documentId} documentSlug={documentSlug} />
				)}
				{activeTab === 'citations' && (
					<CitationsPanel
						documentId={documentId}
						onLineClick={onCitedLineClick}
					/>
				)}
			</Box>
		</Box>
	);
}

/**
 * CitationsPanel Component
 * Lists all incoming citations (documents that embed sections from this document)
 * Helps document owners understand who is referencing their content
 */

'use client';

import React, { useState } from 'react';
import {
	Box,
	Typography,
	List,
	ListItem,
	ListItemButton,
	Chip,
	CircularProgress,
	Alert,
	Divider,
	Tooltip,
	IconButton,
	Collapse,
} from '@mui/material';
import {
	OpenInNew as OpenIcon,
	Warning as StaleIcon,
	ExpandMore as ExpandIcon,
	ExpandLess as CollapseIcon,
	FormatQuote as QuoteIcon,
} from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import { listIncomingCitations, type IncomingCitation, type CitedLineRange } from 'apis';
import { useThemeColors } from '@/theme/useThemeColors';
import Link from 'next/link';

interface CitationsPanelProps {
	documentId: string;
	/** Callback when user clicks on a cited line range to scroll to it */
	onLineClick?: (startLine: number, endLine: number) => void;
}

export default function CitationsPanel({ documentId, onLineClick }: CitationsPanelProps) {
	const colors = useThemeColors();
	const [expandedRanges, setExpandedRanges] = useState<Record<string, boolean>>({});

	// Fetch incoming citations
	const { data, isLoading, error } = useQuery({
		queryKey: ['docs', 'incomingCitations', documentId],
		queryFn: () => listIncomingCitations(documentId),
		staleTime: 60000, // 1 minute cache
	});

	const citations = data?.citations || [];
	const citedLineRanges = data?.citedLineRanges || [];
	const totalCount = data?.totalCount || 0;

	// Group citations by line range
	const citationsByRange = React.useMemo(() => {
		const grouped: Record<string, IncomingCitation[]> = {};
		for (const citation of citations) {
			const rangeKey = `${citation.targetLineStart}-${citation.targetLineEnd}`;
			if (!grouped[rangeKey]) {
				grouped[rangeKey] = [];
			}
			grouped[rangeKey].push(citation);
		}
		return grouped;
	}, [citations]);

	const toggleRange = (rangeKey: string) => {
		setExpandedRanges((prev) => ({
			...prev,
			[rangeKey]: !prev[rangeKey],
		}));
	};

	if (isLoading) {
		return (
			<Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
				<CircularProgress size={24} />
			</Box>
		);
	}

	if (error) {
		return (
			<Box sx={{ p: 2 }}>
				<Alert severity="error">Failed to load citations</Alert>
			</Box>
		);
	}

	if (totalCount === 0) {
		return (
			<Box sx={{ p: 3, textAlign: 'center' }}>
				<QuoteIcon sx={{ fontSize: 48, ...colors.text.disabled.style, mb: 1 }} />
				<Typography variant="body1" fontWeight={500} sx={{ mb: 0.5 }}>
					No citations yet
				</Typography>
				<Typography variant="body2" sx={colors.text.secondary.style}>
					When other documents embed sections from this document, they&apos;ll appear here.
				</Typography>
			</Box>
		);
	}

	// Check if any citations are stale
	const hasStale = citations.some((c) => c.isStale);

	return (
		<Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
			{/* Summary header */}
			<Box
				sx={{
					p: 2,
					borderBottom: 1,
					...colors.border.default.style,
				}}
			>
				<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
					<QuoteIcon fontSize="small" sx={colors.text.secondary.style} />
					<Typography variant="subtitle2">
						{totalCount} citation{totalCount !== 1 ? 's' : ''} from{' '}
						{citedLineRanges.length} section{citedLineRanges.length !== 1 ? 's' : ''}
					</Typography>
				</Box>
				{hasStale && (
					<Alert
						severity="info"
						icon={<StaleIcon fontSize="small" />}
						sx={{ mt: 1.5 }}
					>
						<Typography variant="body2">
							Some citations reference an older version. Your edits may affect documents
							embedding this content.
						</Typography>
					</Alert>
				)}
			</Box>

			{/* Cited line ranges list */}
			<Box sx={{ flex: 1, overflow: 'auto' }}>
				<List dense disablePadding>
					{citedLineRanges.map((range) => {
						const rangeKey = `${range.startLine}-${range.endLine}`;
						const rangeCitations = citationsByRange[rangeKey] || [];
						const isExpanded = expandedRanges[rangeKey] ?? false;
						const hasStaleInRange = rangeCitations.some((c) => c.isStale);

						return (
							<Box key={rangeKey}>
								<ListItem
									disablePadding
									sx={{
										borderBottom: 1,
										...colors.border.default.style,
									}}
								>
									<ListItemButton
										onClick={() => toggleRange(rangeKey)}
										sx={{ py: 1.5 }}
										data-testid={`citation-range-${rangeKey}`}
									>
										<Box
											sx={{
												display: 'flex',
												alignItems: 'center',
												width: '100%',
												gap: 1,
											}}
										>
											{/* Line range badge */}
											<Chip
												label={`L${range.startLine}${
													range.endLine > range.startLine
														? `-${range.endLine}`
														: ''
												}`}
												size="small"
												onClick={(e) => {
													e.stopPropagation();
													onLineClick?.(range.startLine, range.endLine);
												}}
												sx={{
													...colors.bg.active.style,
													cursor: onLineClick ? 'pointer' : 'default',
												}}
												data-testid={`line-range-chip-${rangeKey}`}
											/>

											{/* Citation count */}
											<Typography
												variant="body2"
												sx={{ flex: 1, ...colors.text.secondary.style }}
											>
												{range.citationCount} citation
												{range.citationCount !== 1 ? 's' : ''}
											</Typography>

											{/* Stale indicator */}
											{hasStaleInRange && (
												<Tooltip title="Some citations are from an older version">
													<StaleIcon
														fontSize="small"
														color="warning"
													/>
												</Tooltip>
											)}

											{/* Expand/collapse */}
											<IconButton size="small">
												{isExpanded ? (
													<CollapseIcon fontSize="small" />
												) : (
													<ExpandIcon fontSize="small" />
												)}
											</IconButton>
										</Box>
									</ListItemButton>
								</ListItem>

								{/* Expanded citation list */}
								<Collapse in={isExpanded}>
									<Box
										sx={{
											pl: 2,
											...colors.bg.elevated.style,
										}}
									>
										{rangeCitations.map((citation) => (
											<CitationItem
												key={citation.id}
												citation={citation}
											/>
										))}
									</Box>
								</Collapse>
							</Box>
						);
					})}
				</List>
			</Box>
		</Box>
	);
}

interface CitationItemProps {
	citation: IncomingCitation;
}

function CitationItem({ citation }: CitationItemProps) {
	const colors = useThemeColors();

	return (
		<Box
			sx={{
				py: 1.5,
				px: 2,
				borderBottom: 1,
				...colors.border.default.style,
				'&:last-child': { borderBottom: 0 },
			}}
			data-testid={`citation-item-${citation.id}`}
		>
			{/* Document title with link */}
			<Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5, mb: 0.5 }}>
				<Typography
					variant="body2"
					fontWeight={500}
					sx={{ flex: 1, wordBreak: 'break-word' }}
				>
					{citation.sourceDocumentTitle}
				</Typography>
				<Tooltip title="Open document">
					<IconButton
						size="small"
						component={Link}
						href={`/workspace/docs/${citation.sourceDocumentSlug}`}
						target="_blank"
						data-testid={`open-citation-${citation.id}`}
					>
						<OpenIcon fontSize="small" />
					</IconButton>
				</Tooltip>
			</Box>

			{/* Metadata row */}
			<Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
				<Typography variant="caption" sx={colors.text.secondary.style}>
					by {citation.sourceOwnerName}
				</Typography>
				<Typography variant="caption" sx={colors.text.secondary.style}>
					•
				</Typography>
				<Typography variant="caption" sx={colors.text.secondary.style}>
					{citation.sourceUpdatedAt.toLocaleDateString()}
				</Typography>

				{/* Stale badge */}
				{citation.isStale && (
					<Tooltip
						title={`Citing v${citation.citedAtVersion}, current is v${citation.currentVersion}`}
					>
						<Chip
							label="Outdated"
							size="small"
							color="warning"
							variant="outlined"
							icon={<StaleIcon fontSize="small" />}
						/>
					</Tooltip>
				)}
			</Box>

			{/* Source line info */}
			<Typography
				variant="caption"
				sx={{ display: 'block', mt: 0.5, ...colors.text.disabled.style }}
			>
				Embedded at lines {citation.sourceLineStart}
				{citation.sourceLineEnd > citation.sourceLineStart
					? `-${citation.sourceLineEnd}`
					: ''}
			</Typography>
		</Box>
	);
}

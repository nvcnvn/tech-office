/**
 * EmbeddedSection Component
 * Displays a cited section from another document with live content
 * 
 * Features:
 * - Shows live content from source document (line-based extraction)
 * - Displays source document status badges (active/outdated/archived)
 * - Shows version staleness indicator
 * - Links to source document with line highlighting
 * - Handles unavailable/inaccessible sources
 */

'use client';

import React, { useMemo } from 'react';
import { Box, Typography, CircularProgress, Alert, Chip, Link as MuiLink } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { getEmbeddedSection } from 'apis';
import { useThemeColors } from '@/theme/useThemeColors';
import { Info, WarningAmber, Link as LinkIcon, Update } from '@mui/icons-material';
import Link from 'next/link';
import { extractRenderedLineRangeFromTipTapJson } from './lineNumberModel';

interface EmbeddedSectionProps {
	embedId?: string;
	citationUrl?: string;
}

// Extract lines from plain text content
function extractLines(text: string, startLine: number, endLine: number): string {
	const lines = text.split('\n');
	if (startLine <= 0 || endLine < startLine || endLine > lines.length) return '';
	// Lines are 1-indexed
	const extracted = lines.slice(startLine - 1, endLine);
	return extracted.join('\n');
}

export default function EmbeddedSection({
	embedId,
	citationUrl,
}: EmbeddedSectionProps) {
	const colors = useThemeColors();

	// If only citationUrl is provided (no embedId), show pending/loading state
	const isPending = !embedId && !!citationUrl;

	// Fetch embedded section content (skip if pending)
	const { data: embedData, isLoading, error } = useQuery({
		queryKey: ['docs', 'embed', embedId],
		queryFn: () => getEmbeddedSection(embedId!),
		staleTime: 60000, // 1 minute
		enabled: !!embedId, // Only fetch if embedId exists
	});

	// Extract lines from content
	const extractedContent = useMemo(() => {
		if (!embedData || !embedData.targetAccessible) {
			return null;
		}

		const { embed, contentJson, contentText } = embedData;
		const renderedLineRange = extractRenderedLineRangeFromTipTapJson(
			contentJson,
			embed.targetLineStart,
			embed.targetLineEnd
		);

		if (renderedLineRange !== null) return renderedLineRange;

		return extractLines(contentText, embed.targetLineStart, embed.targetLineEnd) || null;
	}, [embedData]);

	// Check if embed is stale (version mismatch)
	const isStale = useMemo(() => {
		if (!embedData?.embed.targetVersionNumber || !embedData?.embed.targetLatestVersion) {
			return false; // Tracking latest version or no version info
		}
		return embedData.embed.targetVersionNumber < embedData.embed.targetLatestVersion;
	}, [embedData]);

	// Loading state
	if (isLoading || isPending) {
		// Parse URL to extract document identifier and line range for clickable link
		let linkUrl = citationUrl || '';
		if (citationUrl && !citationUrl.startsWith('http') && !citationUrl.startsWith('/')) {
			linkUrl = citationUrl; // Already a relative path
		}

		return (
			<Box
				sx={{
					border: '2px dashed',
					...colors.border.default,
					borderRadius: 1,
					p: 2,
					my: 0, // Remove vertical margin to prevent line misalignment
					mb: 1.8, // Match lineHeight of 1.8rem for consistent spacing
					display: 'flex',
					flexDirection: 'column',
					gap: 1.5,
					minHeight: 100,
				}}
			>
				<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
					<CircularProgress size={20} />
					<Typography variant="body2" sx={colors.text.secondary.style}>
						{isPending ? 'Embedding in progress...' : 'Loading embed...'}
					</Typography>
				</Box>
				{citationUrl && (
					<Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
						<Typography variant="caption" sx={colors.text.secondary.style}>
							Source:
						</Typography>
						<Link href={linkUrl} passHref legacyBehavior>
							<MuiLink
								sx={{
									display: 'flex',
									alignItems: 'center',
									gap: 0.5,
									...colors.text.primary.style,
									textDecoration: 'none',
									fontSize: '0.75rem',
									'&:hover': { textDecoration: 'underline' },
								}}
								target="_blank"
								rel="noopener noreferrer"
							>
								<LinkIcon fontSize="small" />
								{citationUrl}
							</MuiLink>
						</Link>
					</Box>
				)}
				{isPending && (
					<Typography variant="caption" sx={{ ...colors.text.secondary.style, fontStyle: 'italic' }}>
						Embed will be created when you save the document
					</Typography>
				)}
			</Box>
		);
	}

	// Error state (source unavailable or no access)
	if (error || !embedData) {
		return (
			<Alert severity="warning" sx={{ my: 0, mb: 1.8 }}>
				<Typography variant="body2">
					Unable to load embedded section. The source document may be deleted or you don&apos;t have access.
				</Typography>
			</Alert>
		);
	}

	const { embed, targetAccessible } = embedData;

	// Get status chip props
	const getStatusChipProps = (status: string) => {
		switch (status) {
			case 'active':
				return { color: 'success' as const, icon: <Info fontSize="small" /> };
			case 'outdated':
				return { color: 'warning' as const, icon: <WarningAmber fontSize="small" /> };
			case 'archived':
				return { color: 'default' as const, icon: <Info fontSize="small" /> };
			default:
				return { color: 'default' as const };
		}
	};

	const statusProps = getStatusChipProps(embed.targetStatus);

	// Build source URL with line fragment and version.
	// Docs routing uses query params (?doc=... or ?slug=...) instead of a [slug] path segment.
	const versionParam = embed.targetVersionNumber ? `&v=${embed.targetVersionNumber}` : '';
	const sourceUrl = `/workspace/docs?doc=${encodeURIComponent(embed.targetDocumentId)}${versionParam}#L${embed.targetLineStart}-L${embed.targetLineEnd}`;

	return (
		<Box
			sx={{
				border: '2px solid',
				...colors.border.default,
				borderRadius: 1,
				p: 2,
				my: 0, // Remove vertical margin to prevent line misalignment
				mb: 1.8, // Match lineHeight of 1.8rem for consistent spacing
				...colors.bg.paper,
				position: 'relative',
			}}
		>
			{/* Header with badges */}
			<Box
				sx={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'space-between',
					mb: 1.5,
					pb: 1,
					borderBottom: '1px solid',
					...colors.border.default,
					flexWrap: 'wrap',
					gap: 1,
				}}
			>
				<Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
					<Typography variant="caption" sx={colors.text.secondary.style}>
						Embedded from:
					</Typography>
					<Link href={sourceUrl} passHref legacyBehavior>
						<MuiLink
							sx={{
								display: 'flex',
								alignItems: 'center',
								gap: 0.5,
								...colors.text.primary.style,
								textDecoration: 'none',
								'&:hover': { textDecoration: 'underline' },
							}}
						>
							<LinkIcon fontSize="small" />
							<Typography variant="body2" component="span">
								{embed.targetDocumentTitle}
							</Typography>
						</MuiLink>
					</Link>
					<Typography variant="caption" sx={colors.text.secondary.style}>
						(Lines {embed.targetLineStart}-{embed.targetLineEnd})
					</Typography>
				</Box>

				<Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
					{/* Status badge */}
					<Chip
						label={embed.targetStatus}
						size="small"
						{...statusProps}
					/>

					{/* Version indicator */}
					{embed.targetVersionNumber && (
						<Chip
							label={`v${embed.targetVersionNumber}`}
							size="small"
							variant="outlined"
							sx={{ fontSize: '0.75rem' }}
						/>
					)}

					{/* Staleness warning with update prompt */}
					{isStale && embed.targetLatestVersion && (
						<Chip
							label={`Outdated (v${embed.targetLatestVersion} available)`}
							size="small"
							color="warning"
							icon={<Update fontSize="small" />}
							title={`This embed references v${embed.targetVersionNumber}, but v${embed.targetLatestVersion} is now available. Click "Update to latest" to refresh.`}
						/>
					)}
				</Box>
			</Box>

			{/* Embedded content */}
			{!targetAccessible ? (
				<Alert severity="info" sx={{ my: 0 }}>
					<Typography variant="body2">
						You don&apos;t have access to view this content.
					</Typography>
				</Alert>
			) : extractedContent ? (
				<>
					<Box
						sx={{
							...colors.text.primary.style,
							...colors.bg.default,
							p: 1.5,
							borderRadius: 1,
							fontFamily: 'monospace',
							fontSize: '0.875rem',
							whiteSpace: 'pre-wrap',
							overflowX: 'auto',
						}}
					>
						{extractedContent}
					</Box>
					
					{/* Update to latest button (future enhancement) */}
					{isStale && (
						<Box sx={{ mt: 1, display: 'flex', justifyContent: 'flex-end' }}>
							<Typography variant="caption" sx={{ ...colors.text.secondary.style, fontStyle: 'italic' }}>
								To update this embed to v{embed.targetLatestVersion}, edit the document and re-embed the section.
							</Typography>
						</Box>
					)}
				</>
			) : (
				<Alert severity="warning" sx={{ my: 0 }}>
					<Typography variant="body2">
						Unable to extract content from specified line range.
					</Typography>
				</Alert>
			)}
		</Box>
	);
}


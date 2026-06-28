/**
 * LineNumberSidebar Component
 * Displays line numbers for document content with click and drag selection
 * 
 * Features:
 * - Line numbers on left side of editor
 * - Click to select single line
 * - Drag to select line range
 * - Visual indicator of selected range
 * - Copy URL button for selected lines
 * - Generates URLs with #L10-L15 fragment
 * - Handles variable-height content (embeds, headers) via DOM measurement
 */

'use client';

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Box, IconButton, Tooltip, Snackbar, Alert, Typography } from '@mui/material';
import { ContentCopy } from '@mui/icons-material';
import { useTheme } from '@mui/material/styles';
import { useThemeColors } from '@/theme/useThemeColors';
import { buildMarkdownLineNumberModel } from './lineNumberModel';

export interface CitedLineRange {
	startLine: number;
	endLine: number;
	citationCount: number;
}

interface LineNumberSidebarProps {
	content: string; // Plain text content to calculate line numbers from
	documentSlug: string; // For generating URLs
	documentVersion?: number; // Current version number for version-pinned URLs
	mode?: 'markdown' | 'view'; // Display mode: markdown (simple) or view (DOM-measured)
	contentRef?: React.RefObject<HTMLElement | HTMLDivElement | null>; // Ref to content container for position measurement (view mode only)
	onLineRangeSelected?: (startLine: number, endLine: number) => void;
	citedLineRanges?: CitedLineRange[]; // Line ranges that are cited by other documents
	onCitedLineClick?: (lineRange: CitedLineRange) => void; // Called when user clicks a citation marker
}

export default function LineNumberSidebar({
	content,
	documentSlug,
	documentVersion,
	mode = 'view',
	contentRef,
	onLineRangeSelected,
	citedLineRanges = [],
	onCitedLineClick,
}: LineNumberSidebarProps) {
	const colors = useThemeColors();
	const theme = useTheme();
	const selectedTextColor = theme.palette.getContrastText(theme.palette.primary.main);
	const [selectedStart, setSelectedStart] = useState<number | null>(null);
	const [selectedEnd, setSelectedEnd] = useState<number | null>(null);
	const [isDragging, setIsDragging] = useState(false);
	const [snackbarOpen, setSnackbarOpen] = useState(false);
	const [linePositions, setLinePositions] = useState<number[]>([]);
	const [measuredContentHeightPx, setMeasuredContentHeightPx] = useState<number | null>(null);
	const sidebarRef = useRef<HTMLDivElement>(null);

	const lineNumberModel = useMemo(
		() => buildMarkdownLineNumberModel(content, mode === 'view'),
		[content, mode]
	);
	const lineCount = lineNumberModel.lineCount;

	const fallbackLineHeightPx = useMemo(() => {
		// We render line numbers at `fontSize: 1rem` and `lineHeight: 1.8`.
		// In MUI `sx`, numeric `top` is in px, so we must compute px spacing.
		const baseFontSizePx = typeof theme.typography.fontSize === 'number' ? theme.typography.fontSize : 16;
		return baseFontSizePx * 1.8;
	}, [theme.typography.fontSize]);

	// Helper to check if a line is cited and get citation count
	const getCitationForLine = useCallback((lineNum: number): CitedLineRange | null => {
		return citedLineRanges.find(
			range => lineNum >= range.startLine && lineNum <= range.endLine
		) || null;
	}, [citedLineRanges]);

	// Get heat map color based on citation count (warmer = more citations)
	const getHeatColor = useCallback((citationCount: number) => {
		if (citationCount === 0) return 'transparent';
		
		// Heat map scale: 1-2 citations (cool) → 3-5 citations (warm) → 6+ citations (hot)
		// Color progression: Light Blue → Yellow → Orange → Red
		const isDark = theme.palette.mode === 'dark';
		
		if (citationCount === 1) {
			return isDark ? 'rgba(147, 197, 253, 0.2)' : 'rgba(191, 219, 254, 0.3)'; // Light Blue
		} else if (citationCount === 2) {
			return isDark ? 'rgba(147, 197, 253, 0.4)' : 'rgba(147, 197, 253, 0.5)'; // Blue
		} else if (citationCount === 3) {
			return isDark ? 'rgba(253, 224, 71, 0.3)' : 'rgba(254, 240, 138, 0.5)'; // Yellow
		} else if (citationCount === 4) {
			return isDark ? 'rgba(251, 191, 36, 0.4)' : 'rgba(252, 211, 77, 0.6)'; // Amber
		} else if (citationCount === 5) {
			return isDark ? 'rgba(251, 146, 60, 0.4)' : 'rgba(251, 191, 36, 0.6)'; // Orange
		} else {
			return isDark ? 'rgba(239, 68, 68, 0.4)' : 'rgba(248, 113, 113, 0.6)'; // Red (hot)
		}
	}, [theme.palette.mode]);

	// Get heat intensity label for tooltip
	const getHeatLabel = useCallback((citationCount: number) => {
		if (citationCount <= 2) return 'Low citation density';
		if (citationCount <= 4) return 'Moderate citation density';
		return 'High citation density';
	}, []);

	type DomBlockKind = 'heading' | 'blockquote' | 'listItem' | 'codeBlock' | 'embed' | 'paragraph';
	type DomBlock = {
		kind: DomBlockKind;
		el: HTMLElement;
		top: number;
		lineHeightPx: number;
	};

	const getLineHeightPx = useCallback((el: Element) => {
		const cs = window.getComputedStyle(el);
		const fontSizePx = Number.parseFloat(cs.fontSize || '16') || 16;
		let lineHeightPx = Number.parseFloat(cs.lineHeight || '');
		if (!Number.isFinite(lineHeightPx) || lineHeightPx <= 0) {
			lineHeightPx = fontSizePx * 1.4;
		}
		return lineHeightPx;
	}, []);

	// Measure positions for each rendered/citable line.
	// Embeds count as one citation anchor even when their content occupies more vertical space.
	useEffect(() => {
		// Markdown mode: fixed spacing in px (MUI numeric values are px)
		if (mode === 'markdown') {
			const positions = Array.from({ length: lineCount }, (_, i) => i * fallbackLineHeightPx);
			setLinePositions(positions);
			return;
		}

		// View mode: measure actual DOM positions
		if (!contentRef?.current) {
			// Fallback to fixed spacing if no ref provided
			const positions = Array.from({ length: lineCount }, (_, i) => i * fallbackLineHeightPx);
			setLinePositions(positions);
			return;
		}

		const measurePositions = () => {
			const container = contentRef.current;
			if (!container || !sidebarRef.current) return;

			const sidebarTop = sidebarRef.current.getBoundingClientRect().top;
			const positions: number[] = new Array(lineCount);

			const proseMirror = (container.querySelector('.ProseMirror') as HTMLElement | null) ?? container;
			const children = Array.from(proseMirror.children) as HTMLElement[];
			const domBlocks: DomBlock[] = [];
			for (const child of children) {
				const tag = child.tagName.toLowerCase();
				if (tag === 'ul' || tag === 'ol') {
					const items = Array.from(child.querySelectorAll(':scope > li')) as HTMLElement[];
					for (const li of items) {
						const rect = li.getBoundingClientRect();
						domBlocks.push({
							kind: 'listItem',
							el: li,
							top: rect.top - sidebarTop,
							lineHeightPx: getLineHeightPx(li),
						});
					}
					continue;
				}

				let kind: DomBlockKind | null = null;
				if (tag === 'pre') kind = 'codeBlock';
				else if (tag === 'blockquote') kind = 'blockquote';
				else if (tag === 'p') kind = 'paragraph';
				else if (tag === 'h1' || tag === 'h2' || tag === 'h3') kind = 'heading';
				else if (child.matches('div[data-type="embed"]')) kind = 'embed';

				if (!kind) continue;
				const rect = child.getBoundingClientRect();
				const lh = getLineHeightPx(child);
				let top = rect.top - sidebarTop;
				if (kind === 'codeBlock') {
					// Align to the first rendered code line inside <pre> (padding matters).
					const cs = window.getComputedStyle(child);
					const paddingTop = Number.parseFloat(cs.paddingTop || '0') || 0;
					top = top + paddingTop;
				}
				domBlocks.push({
					kind,
					el: child,
					top,
					lineHeightPx: lh,
				});
			}

			const mdBlocks = lineNumberModel.blocks;
			if (mdBlocks.length === 0 || domBlocks.length === 0) {
				const fallbackPositions = Array.from({ length: lineCount }, (_, i) => i * fallbackLineHeightPx);
				setLinePositions(fallbackPositions);
				setMeasuredContentHeightPx(container.scrollHeight);
				return;
			}

			let domIndex = 0;
			for (const md of mdBlocks) {
				const start = md.lineStart;
				const endExclusive = md.lineStart + md.lineCount;
				const expectedDomKind: DomBlockKind = md.kind === 'codeBlock'
					? 'codeBlock'
					: md.kind === 'listItem'
						? 'listItem'
						: md.kind === 'embed'
							? 'embed'
							: md.kind === 'heading'
								? 'heading'
								: md.kind === 'blockquote'
									? 'blockquote'
									: 'paragraph';

				// Advance to the next matching DOM block.
				while (domIndex < domBlocks.length && domBlocks[domIndex]?.kind !== expectedDomKind) {
					domIndex += 1;
				}

				const dom = domBlocks[domIndex];
				if (!dom) {
					// Fallback: continue from previous position.
					const prev = start > 0 ? (positions[start - 1] ?? 0) : 0;
					for (let k = start; k < endExclusive; k += 1) {
						positions[k] = (k === start ? prev : (positions[k - 1] ?? prev)) + fallbackLineHeightPx;
					}
					continue;
				}

				if (md.lineCount === 1) {
					positions[start] = dom.top;
				} else {
					// Multi-line paragraph, quote, or code block: distribute by measured lineHeight.
					for (let k = 0; k < md.lineCount; k += 1) {
						positions[start + k] = dom.top + k * dom.lineHeightPx;
					}
				}

				domIndex += 1;
			}

			// Ensure strictly non-decreasing positions.
			for (let i = 0; i < positions.length; i += 1) {
				const prev = i > 0 ? (positions[i - 1] ?? 0) : -Infinity;
				const current = positions[i] ?? prev;
				if (i > 0 && current < prev) {
					positions[i] = prev;
				}
			}

			setLinePositions(positions);
			setMeasuredContentHeightPx(container.scrollHeight);
		};

		// Initial measurement
		measurePositions();

		// Re-measure on content changes
		const observer = new MutationObserver(measurePositions);
		if (contentRef.current) {
			observer.observe(contentRef.current, {
				childList: true,
				subtree: true,
				attributes: true,
			});
		}

		// Re-measure on window resize
		window.addEventListener('resize', measurePositions);

		return () => {
			observer.disconnect();
			window.removeEventListener('resize', measurePositions);
		};
	}, [contentRef, fallbackLineHeightPx, getLineHeightPx, lineCount, lineNumberModel.blocks, mode]);

	// Handle line click
	const handleLineClick = useCallback((lineNumber: number) => {
		if (isDragging) return;

		setSelectedStart(lineNumber);
		setSelectedEnd(lineNumber);
		onLineRangeSelected?.(lineNumber, lineNumber);
	}, [isDragging, onLineRangeSelected]);

	// Handle drag start
	const handleMouseDown = useCallback((lineNumber: number) => {
		setIsDragging(true);
		setSelectedStart(lineNumber);
		setSelectedEnd(lineNumber);
		onLineRangeSelected?.(lineNumber, lineNumber);
	}, [onLineRangeSelected]);

	// Handle drag over line
	const handleMouseEnter = useCallback((lineNumber: number) => {
		if (!isDragging || selectedStart === null) return;

		setSelectedEnd(lineNumber);
		const start = Math.min(selectedStart, lineNumber);
		const end = Math.max(selectedStart, lineNumber);
		onLineRangeSelected?.(start, end);
	}, [isDragging, selectedStart, onLineRangeSelected]);

	// Handle drag end
	const handleMouseUp = useCallback(() => {
		setIsDragging(false);
	}, []);

	// Generate URL with line fragment (including version for snapshot-based embeds)
	const generateLineUrl = useCallback(() => {
		if (selectedStart === null || selectedEnd === null) return '';

		const start = Math.min(selectedStart, selectedEnd);
		const end = Math.max(selectedStart, selectedEnd);

		// Include version parameter for version-pinned embeds (snapshot behavior)
		const versionParam = documentVersion ? `&v=${documentVersion}` : '';

		if (start === end) {
			return `${window.location.origin}/workspace/docs?slug=${documentSlug}${versionParam}#L${start}`;
		}
		return `${window.location.origin}/workspace/docs?slug=${documentSlug}${versionParam}#L${start}-L${end}`;
	}, [selectedStart, selectedEnd, documentSlug, documentVersion]);

	// Copy URL to clipboard
	const handleCopyUrl = useCallback(async () => {
		const url = generateLineUrl();
		if (!url) return;

		try {
			await navigator.clipboard.writeText(url);
			setSnackbarOpen(true);
		} catch (err) {
			console.error('Failed to copy URL:', err);
		}
	}, [generateLineUrl]);

	// Get line numbers array
	const lineNumbers = useMemo(() => {
		return Array.from({ length: lineCount }, (_, i) => i + 1);
	}, [lineCount]);

	// Check if line is selected
	const isLineSelected = useCallback((lineNumber: number) => {
		if (selectedStart === null || selectedEnd === null) return false;

		const start = Math.min(selectedStart, selectedEnd);
		const end = Math.max(selectedStart, selectedEnd);
		return lineNumber >= start && lineNumber <= end;
	}, [selectedStart, selectedEnd]);

	const hasSelection = selectedStart !== null && selectedEnd !== null;

	// Determine if we're using absolute positioning
	const hasAbsolutePositioning = mode === 'view' && linePositions.length === lineCount;

	const sidebarMinHeightPx = useMemo(() => {
		if (!hasAbsolutePositioning) return undefined;
		const lastTop = linePositions[linePositions.length - 1] ?? 0;
		const byLines = Math.max(lastTop + fallbackLineHeightPx, lineCount * fallbackLineHeightPx);
		if (measuredContentHeightPx && measuredContentHeightPx > 0) {
			return Math.max(byLines, measuredContentHeightPx);
		}
		return byLines;
	}, [fallbackLineHeightPx, hasAbsolutePositioning, lineCount, linePositions, measuredContentHeightPx]);

	return (
		<>
			<Box
				ref={sidebarRef}
				sx={{
					position: 'relative',
					display: 'flex',
					flexDirection: 'column',
					alignItems: 'flex-end',
					minWidth: 60,
					pr: 2,
					pt: 1,
					pb: 1,
					// If using absolute positioning, ensure container has height
					...(sidebarMinHeightPx ? { minHeight: sidebarMinHeightPx } : {}),
					...colors.bg.default.style,
					borderRight: '1px solid',
					...colors.border.default.style,
					userSelect: 'none',
					cursor: isDragging ? 'grabbing' : 'pointer',
				}}
				onMouseUp={handleMouseUp}
				onMouseLeave={handleMouseUp}
			>
				{/* Copy URL button (positioned near first selected line) */}
				{hasSelection && selectedStart !== null && linePositions[selectedStart - 1] !== undefined && (
					<Box
						sx={{
							position: 'absolute',
							top: linePositions[selectedStart - 1],
							right: 8,
							zIndex: 10,
						}}
					>
						<Tooltip title="Copy URL with line reference">
							<IconButton
								size="small"
								onClick={handleCopyUrl}
								data-testid="line-number-copy-url-btn"
								sx={{
									...colors.bg.paper.style,
									border: '1px solid',
									...colors.border.default.style,
									'&:hover': {
										...colors.bg.default.style,
									},
								}}
							>
								<ContentCopy fontSize="small" />
							</IconButton>
						</Tooltip>
					</Box>
				)}

				{/* Line numbers positioned based on actual content */}
				{lineNumbers.map((lineNumber, index) => {
					const position = linePositions[index];
					const useAbsolutePosition = mode === 'view' && position !== undefined;
					const citation = getCitationForLine(lineNumber);
					const citationCount = citation?.citationCount || 0;
					const heatColor = getHeatColor(citationCount);
					const heatLabel = getHeatLabel(citationCount);
					
					return (
						<Box
							key={lineNumber}
							data-testid={`line-number-${lineNumber}`}
							sx={{
								...(useAbsolutePosition
									? {
										position: 'absolute',
										top: position,
										left: 0,
										right: 16,
										width: 'auto',
									}
									: {
										// Markdown mode: flow layout with fixed spacing
										width: '100%',
									}),
								px: 1,
								py: 0,
								fontSize: '1rem',
								fontFamily: 'monospace',
								textAlign: 'right',
								lineHeight: 1.8,
								// Heat map visualization: background color based on citation count
								backgroundColor: heatColor,
								// Add subtle left border for cited lines
								...(citationCount > 0 && {
									borderLeft: '3px solid',
									borderColor: heatColor === 'transparent' ? 'transparent' : 
										(citationCount <= 2 ? '#3b82f6' : // Blue
										 citationCount <= 4 ? '#f59e0b' : // Amber
										 '#ef4444'), // Red
								}),
								...(isLineSelected(lineNumber)
									? {
										...colors.primary.main.style,
										color: selectedTextColor,
										fontWeight: 600,
									}
									: colors.text.secondary.style),
								'&:hover': {
									...colors.bg.active.style,
								},
								transition: 'all 0.1s ease',
								cursor: citation ? 'pointer' : 'default',
							}}
							onMouseDown={() => handleMouseDown(lineNumber)}
							onMouseEnter={() => handleMouseEnter(lineNumber)}
							onClick={() => {
								if (citation) {
									onCitedLineClick?.(citation);
								} else {
									handleLineClick(lineNumber);
								}
							}}
						>
							{citation && (
								<Tooltip
									title={
										<Box>
											<Typography variant="body2" fontWeight={600}>
												{heatLabel}
											</Typography>
											<Typography variant="caption">
												Cited by {citation.citationCount} document{citation.citationCount > 1 ? 's' : ''}
											</Typography>
											<Typography variant="caption" display="block" sx={{ mt: 0.5 }}>
												Click to view citations
											</Typography>
										</Box>
									}
									placement="left"
									arrow
								>
									<Box component="span" sx={{ display: 'inline' }}>
										{lineNumber}
									</Box>
								</Tooltip>
							)}
							{!citation && lineNumber}
						</Box>
					);
				})}
			</Box>

			{/* Snackbar for copy confirmation */}
			<Snackbar
				open={snackbarOpen}
				autoHideDuration={2000}
				onClose={() => setSnackbarOpen(false)}
				anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
			>
				<Alert
					onClose={() => setSnackbarOpen(false)}
					severity="success"
					sx={{ width: '100%' }}
				>
					URL copied to clipboard!
				</Alert>
			</Snackbar>
		</>
	);
}

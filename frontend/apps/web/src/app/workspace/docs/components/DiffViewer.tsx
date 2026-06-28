/**
 * DiffViewer Component
 * Side-by-side diff viewer for document versions (like Stack Overflow)
 * Shows old version | new version with red (deletions) and green (additions)
 */

'use client';

import React from 'react';
import { Box, Typography, Divider } from '@mui/material';
import { useThemeColors } from '@/theme/useThemeColors';
import type { DiffChange, DocumentVersion } from 'apis';

interface DiffViewerProps {
	changes: DiffChange[];
	fromVersion: DocumentVersion;
	toVersion: DocumentVersion;
}

export default function DiffViewer({ changes, fromVersion, toVersion }: DiffViewerProps) {
	const colors = useThemeColors();

	// Group changes into lines for side-by-side display
	const { leftLines, rightLines } = processChanges(changes);

	return (
		<Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
			{/* Header */}
			<Box
				sx={{
					display: 'grid',
					gridTemplateColumns: '1fr 1fr',
					gap: 2,
					pb: 2,
					borderBottom: 1,
					...colors.border.default.style,
				}}
			>
				<Box>
					<Typography variant="subtitle2" sx={colors.text.primary.style}>
						Version {fromVersion.versionNumber}
					</Typography>
					<Typography variant="caption" sx={colors.text.secondary.style}>
						{fromVersion.authorName} • {fromVersion.createdAt.toLocaleDateString()}
					</Typography>
				</Box>
				<Box>
					<Typography variant="subtitle2" sx={colors.text.primary.style}>
						Version {toVersion.versionNumber}
					</Typography>
					<Typography variant="caption" sx={colors.text.secondary.style}>
						{toVersion.authorName} • {toVersion.createdAt.toLocaleDateString()}
					</Typography>
				</Box>
			</Box>

			{/* Side-by-side diff */}
			<Box
				sx={{
					flex: 1,
					overflow: 'auto',
					display: 'grid',
					gridTemplateColumns: '1fr 1px 1fr',
					gap: 0,
					mt: 2,
				}}
			>
				{/* Left side (old version) */}
				<Box
					sx={{
						fontFamily: 'monospace',
						fontSize: '0.875rem',
						whiteSpace: 'pre-wrap',
						overflowY: 'auto',
						pr: 1,
					}}
				>
					{leftLines.map((line, idx) => (
						<DiffLineLeft key={idx} line={line} lineNumber={idx + 1} />
					))}
				</Box>

				{/* Center divider */}
				<Divider orientation="vertical" sx={{ height: '100%' }} />

				{/* Right side (new version) */}
				<Box
					sx={{
						fontFamily: 'monospace',
						fontSize: '0.875rem',
						whiteSpace: 'pre-wrap',
						overflowY: 'auto',
						pl: 1,
					}}
				>
					{rightLines.map((line, idx) => (
						<DiffLineRight key={idx} line={line} lineNumber={idx + 1} />
					))}
				</Box>
			</Box>
		</Box>
	);
}

// Types for diff lines
type LineType = 'unchanged' | 'removed' | 'added' | 'modified' | 'empty';

interface DiffLine {
	content: string;
	type: LineType;
}

// Process changes into side-by-side lines
function processChanges(changes: DiffChange[]): { leftLines: DiffLine[]; rightLines: DiffLine[] } {
	const leftLines: DiffLine[] = [];
	const rightLines: DiffLine[] = [];

	for (const change of changes) {
		const lines = change.content.split('\n');

		// Normalize changeType (backend may return 'remove'/'add' or 'removed'/'added')
		const normalizedType = change.changeType.toLowerCase();

		switch (normalizedType) {
			case 'unchanged':
				// Show on both sides
				lines.forEach((line) => {
					leftLines.push({ content: line, type: 'unchanged' });
					rightLines.push({ content: line, type: 'unchanged' });
				});
				break;

			case 'remove':
			case 'removed':
				// Show on left side only, empty on right
				lines.forEach((line) => {
					leftLines.push({ content: line, type: 'removed' });
					rightLines.push({ content: '', type: 'empty' });
				});
				break;

			case 'add':
			case 'added':
				// Show on right side only, empty on left
				lines.forEach((line) => {
					leftLines.push({ content: '', type: 'empty' });
					rightLines.push({ content: line, type: 'added' });
				});
				break;

			case 'modified':
				// Formatting change: show old content on left, new content on right
				const oldLines = (change.oldContent || change.content).split('\n');
				const newLines = (change.newContent || change.content).split('\n');
				const maxLines = Math.max(oldLines.length, newLines.length);

				for (let i = 0; i < maxLines; i++) {
					leftLines.push({
						content: oldLines[i] || '',
						type: 'modified',
					});
					rightLines.push({
						content: newLines[i] || '',
						type: 'modified',
					});
				}
				break;

			default:
				console.warn('Unknown changeType:', change.changeType);
				break;
		}
	}

	return { leftLines, rightLines };
}

// Left side diff line (old version)
function DiffLineLeft({ line, lineNumber }: { line: DiffLine; lineNumber: number }) {
	const colors = useThemeColors();

	const bgColor =
		line.type === 'removed'
			? 'rgba(248, 81, 73, 0.2)' // Red background for deletions
			: line.type === 'modified'
				? 'rgba(255, 152, 0, 0.15)' // Orange background for formatting changes
				: line.type === 'empty'
					? 'rgba(0, 0, 0, 0.03)' // Light gray for empty lines
					: 'transparent';

	const borderColor =
		line.type === 'removed' ? 'error.main' : line.type === 'modified' ? 'warning.main' : 'transparent';

	return (
		<Box
			sx={{
				display: 'flex',
				backgroundColor: bgColor,
				borderLeft: 3,
				borderColor: borderColor,
				minHeight: '1.5rem',
				px: 1,
				py: 0.25,
			}}
			data-testid={`diff-line-left-${lineNumber}`}
		>
			<Typography
				component="span"
				sx={{
					minWidth: 40,
					mr: 2,
					...colors.text.secondary.style,
					userSelect: 'none',
				}}
			>
				{line.type !== 'empty' ? lineNumber : ''}
			</Typography>
			<Typography
				component="span"
				sx={{
					flex: 1,
					...(line.type === 'removed' && { color: 'error.dark' }),
					...(line.type === 'modified' && { color: 'warning.dark' }),
				}}
			>
				{line.content || '\u00A0'}
			</Typography>
		</Box>
	);
}

// Right side diff line (new version)
function DiffLineRight({ line, lineNumber }: { line: DiffLine; lineNumber: number }) {
	const colors = useThemeColors();

	const bgColor =
		line.type === 'added'
			? 'rgba(46, 160, 67, 0.2)' // Green background for additions
			: line.type === 'modified'
				? 'rgba(255, 152, 0, 0.15)' // Orange background for formatting changes
				: line.type === 'empty'
					? 'rgba(0, 0, 0, 0.03)' // Light gray for empty lines
					: 'transparent';

	const borderColor =
		line.type === 'added' ? 'success.main' : line.type === 'modified' ? 'warning.main' : 'transparent';

	return (
		<Box
			sx={{
				display: 'flex',
				backgroundColor: bgColor,
				borderLeft: 3,
				borderColor: borderColor,
				minHeight: '1.5rem',
				px: 1,
				py: 0.25,
			}}
			data-testid={`diff-line-right-${lineNumber}`}
		>
			<Typography
				component="span"
				sx={{
					minWidth: 40,
					mr: 2,
					...colors.text.secondary.style,
					userSelect: 'none',
				}}
			>
				{line.type !== 'empty' ? lineNumber : ''}
			</Typography>
			<Typography
				component="span"
				sx={{
					flex: 1,
					...(line.type === 'added' && { color: 'success.dark' }),
					...(line.type === 'modified' && { color: 'warning.dark' }),
				}}
			>
				{line.content || '\u00A0'}
			</Typography>
		</Box>
	);
}

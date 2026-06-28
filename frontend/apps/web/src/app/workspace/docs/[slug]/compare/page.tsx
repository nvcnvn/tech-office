/**
 * Document Version Compare Page
 * Shows side-by-side comparison of document versions
 * 
 * URL params:
 * - version: View a single version (e.g., ?version=1)
 * - from & to: Compare two versions (e.g., ?from=2&to=3)
 */

'use client';

import React from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import {
	Box,
	Typography,
	CircularProgress,
	Alert,
	AppBar,
	Toolbar,
	IconButton,
	Chip,
} from '@mui/material';
import { ArrowBack as BackIcon } from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import {
	resolveSlug,
	getVersion,
	getVersionDiff,
} from 'apis';
import { useThemeColors } from '@/theme/useThemeColors';
import { useRequireAuth } from '@/lib/auth/hooks';
import DiffViewer from '../../components/DiffViewer';

export default function VersionComparePage() {
	const { isLoading: authLoading, user } = useRequireAuth();
	const colors = useThemeColors();
	const router = useRouter();
	const params = useParams();
	const searchParams = useSearchParams();

	const slug = params.slug as string;
	const versionParam = searchParams.get('version');
	const fromParam = searchParams.get('from');
	const toParam = searchParams.get('to');

	// Parse version numbers
	const singleVersion = versionParam ? parseInt(versionParam, 10) : null;
	const fromVersion = fromParam ? parseInt(fromParam, 10) : null;
	const toVersion = toParam ? parseInt(toParam, 10) : null;

	// Resolve slug to document ID
	const { data: resolvedData, isLoading: resolveLoading } = useQuery({
		queryKey: ['docs', 'resolve', slug],
		queryFn: () => resolveSlug(slug),
		enabled: !!slug,
		staleTime: 60000,
	});

	const documentId = resolvedData?.documentId;

	// Fetch single version
	const { data: versionData, isLoading: versionLoading } = useQuery({
		queryKey: ['docs', 'version', documentId, singleVersion],
		queryFn: () => getVersion({ documentId: documentId!, versionNumber: singleVersion! }),
		enabled: !!documentId && singleVersion !== null,
		staleTime: 60000,
	});

	// Fetch diff between versions
	const { data: diffData, isLoading: diffLoading } = useQuery({
		queryKey: ['docs', 'diff', documentId, fromVersion, toVersion],
		queryFn: () => getVersionDiff({ documentId: documentId!, fromVersion: fromVersion!, toVersion: toVersion! }),
		enabled: !!documentId && fromVersion !== null && toVersion !== null,
		staleTime: 60000,
	});

	const handleBack = () => {
		router.push(`/workspace/docs?slug=${slug}`);
	};

	// Debug logging
	React.useEffect(() => {
		if (diffData) {
			console.log('Diff data:', {
				changesCount: diffData.changes?.length,
				hasFromVersion: !!diffData.fromVersion,
				hasToVersion: !!diffData.toVersion,
				changes: diffData.changes,
			});
		}
	}, [diffData]);

	if (authLoading) {
		return (
			<Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
				<CircularProgress />
			</Box>
		);
	}

	if (!user) {
		return null;
	}

	const isLoading = resolveLoading || versionLoading || diffLoading;

	// Determine what we're comparing
	let comparisonTitle = '';
	if (singleVersion !== null) {
		comparisonTitle = `Version ${singleVersion}`;
	} else if (fromVersion !== null && toVersion !== null) {
		comparisonTitle = `v${fromVersion} to v${toVersion}`;
	}

	return (
		<Box
			sx={{
				display: 'flex',
				flexDirection: 'column',
				height: '100vh',
				...colors.bg.default.style,
			}}
		>
			{/* Header */}
			<AppBar
				position="static"
				elevation={0}
				sx={{
					...colors.bg.paper.style,
					borderBottom: 1,
					...colors.border.default.style,
				}}
			>
				<Toolbar>
					<IconButton
						edge="start"
						onClick={handleBack}
						data-testid="back-button"
					>
						<BackIcon />
					</IconButton>
					<Box sx={{ ml: 2, flex: 1 }}>
						<Typography variant="h6" sx={colors.text.primary.style}>
							{comparisonTitle}
						</Typography>
						{documentId && (
							<Typography variant="caption" sx={colors.text.secondary.style}>
								Document ID: {documentId}
							</Typography>
						)}
					</Box>
				</Toolbar>
			</AppBar>

			{/* Content */}
			<Box sx={{ flex: 1, overflow: 'auto', p: 3 }}>
				{isLoading ? (
					<Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
						<CircularProgress />
					</Box>
				) : singleVersion !== null && versionData?.version ? (
					/* Single version view */
					<Box>
						<Box sx={{ mb: 3 }}>
							<Chip
								label={`Version ${versionData.version.versionNumber}`}
								color="primary"
								sx={{ mb: 2 }}
							/>
							<Typography variant="body2" sx={colors.text.secondary.style}>
								By {versionData.version.authorName} • {versionData.version.createdAt.toLocaleString()}
							</Typography>
							{versionData.version.summary && (
								<Typography variant="body2" sx={{ mt: 1 }}>
									{versionData.version.summary}
								</Typography>
							)}
						</Box>
						<Box
							sx={{
								p: 3,
								...colors.bg.paper.style,
								borderRadius: 1,
								border: 1,
								...colors.border.default.style,
							}}
						>
							{/* Render as rich HTML if content exists */}
							{versionData.version.contentJson ? (
								<Box
									sx={{
										'& p': { mb: 2 },
										'& h1': { fontSize: '2rem', fontWeight: 600, mb: 2 },
										'& h2': { fontSize: '1.5rem', fontWeight: 600, mb: 2 },
										'& h3': { fontSize: '1.25rem', fontWeight: 600, mb: 1 },
										'& ul, & ol': { pl: 3, mb: 2 },
										'& li': { mb: 0.5 },
										'& code': {
											px: 1,
											py: 0.5,
											borderRadius: 1,
											...colors.bg.default.style,
											fontFamily: 'monospace',
											fontSize: '0.875em',
										},
										'& pre': {
											p: 2,
											borderRadius: 1,
											...colors.bg.default.style,
											overflow: 'auto',
											mb: 2,
										},
									}}
									dangerouslySetInnerHTML={{
										__html: renderContentJson(versionData.version.contentJson),
									}}
								/>
							) : (
								<Typography variant="body2" sx={colors.text.secondary.style}>
									No content available
								</Typography>
							)}
						</Box>
					</Box>
				) : diffData && diffData.fromVersion && diffData.toVersion ? (
					/* Diff view - show even if changes array is empty (means no changes between versions) */
					<Box>
						<Box sx={{ mb: 3, display: 'flex', gap: 2, alignItems: 'center' }}>
							<Chip
								label={`v${diffData.fromVersion.versionNumber}`}
								variant="outlined"
							/>
							<Typography sx={colors.text.secondary.style}>→</Typography>
							<Chip
								label={`v${diffData.toVersion.versionNumber}`}
								color="primary"
							/>
						</Box>
						{diffData.changes && diffData.changes.length > 0 ? (
							<DiffViewer
								changes={diffData.changes}
								fromVersion={diffData.fromVersion}
								toVersion={diffData.toVersion}
							/>
						) : (
							<Alert severity="info">
								No differences found between v{diffData.fromVersion.versionNumber} and v{diffData.toVersion.versionNumber}
							</Alert>
						)}
					</Box>
				) : (
					<Alert severity="info">
						{singleVersion !== null
							? 'Version not found'
							: 'Invalid comparison parameters - please provide version numbers'}
					</Alert>
				)}
			</Box>
		</Box>
	);
}

// Helper to render content JSON as HTML
function renderContentJson(jsonStr: string): string {
	try {
		const doc = JSON.parse(jsonStr);
		return renderNode(doc);
	} catch (e) {
		console.error('Failed to parse content JSON:', e);
		return '<p>Error rendering content</p>';
	}
}

function renderNode(node: unknown): string {
	if (!node || typeof node !== 'object') return '';
	const n = node as Record<string, unknown>;

	// Text node
	if (n.type === 'text' && typeof n.text === 'string') {
		let text = escapeHtml(n.text);

		// Apply marks (bold, italic, code, etc.)
		if (Array.isArray(n.marks)) {
			for (const mark of n.marks) {
				const m = mark as Record<string, unknown>;
				switch (m.type) {
					case 'bold':
						text = `<strong>${text}</strong>`;
						break;
					case 'italic':
						text = `<em>${text}</em>`;
						break;
					case 'code':
						text = `<code>${text}</code>`;
						break;
					case 'underline':
						text = `<u>${text}</u>`;
						break;
					case 'link':
						const href = (m.attrs as Record<string, unknown>)?.href;
						text = `<a href="${escapeHtml(String(href || '#'))}" target="_blank" rel="noopener noreferrer">${text}</a>`;
						break;
				}
			}
		}

		return text;
	}

	// Block nodes
	const content = Array.isArray(n.content)
		? n.content.map(renderNode).join('')
		: '';

	switch (n.type) {
		case 'doc':
			return content;
		case 'paragraph':
			return `<p>${content || '<br>'}</p>`;
		case 'heading':
			const level = (n.attrs as Record<string, unknown>)?.level || 1;
			return `<h${level}>${content}</h${level}>`;
		case 'bulletList':
			return `<ul>${content}</ul>`;
		case 'orderedList':
			return `<ol>${content}</ol>`;
		case 'listItem':
			return `<li>${content}</li>`;
		case 'codeBlock':
			const lang = (n.attrs as Record<string, unknown>)?.language || '';
			return `<pre><code${lang ? ` class="language-${escapeHtml(String(lang))}"` : ''}>${content}</code></pre>`;
		case 'blockquote':
			return `<blockquote>${content}</blockquote>`;
		case 'hardBreak':
			return '<br>';
		case 'horizontalRule':
			return '<hr>';
		default:
			return content;
	}
}

function escapeHtml(text: string): string {
	const div = document.createElement('div');
	div.textContent = text;
	return div.innerHTML;
}

/**
 * Documents Page
 * Notion/Confluence-style document management
 * 
 * Layout:
 * - Left (w-64): Document tree sidebar with hierarchy
 * - Center (flex-1): Document viewer/editor
 * - Right (w-72): Context panel (comments, history)
 * 
 * Features:
 * - Hierarchical document tree (max 10 levels)
 * - Full-text search with PGroonga
 * - Version history and diff
 * - Inline comments with threading
 * - Permanent URLs via slug
 */

'use client';

import React, { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Box, CircularProgress } from '@mui/material';
import { useRequireAuth } from '@/lib/auth/hooks';
import { useThemeColors } from '@/theme/useThemeColors';
import DocumentTree from './components/DocumentTree';
import DocumentView from './components/DocumentView';
import DocumentEmptyState from './components/DocumentEmptyState';
import RightPanel from './components/RightPanel';

export default function DocsPage() {
	const { isLoading, user } = useRequireAuth();

	if (isLoading) {
		return (
			<Box
				sx={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					minHeight: '100vh',
				}}
			>
				<CircularProgress />
			</Box>
		);
	}

	if (!user) {
		return null;
	}

	return (
		<Suspense
			fallback={
				<Box
					sx={{
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						minHeight: '100vh',
					}}
				>
					<CircularProgress />
				</Box>
			}
		>
			<DocsPageContent />
		</Suspense>
	);
}

function DocsPageContent() {
	const colors = useThemeColors();
	const searchParams = useSearchParams();

	// Get active document from URL
	const documentId = searchParams.get('doc');
	const documentSlug = searchParams.get('slug');
	const activeDocIdentifier = documentId || documentSlug;

	// Right panel state
	const [rightPanelTab, setRightPanelTab] = useState<'comments' | 'history' | 'citations' | null>(null);
	const [effectiveDocumentId, setEffectiveDocumentId] = useState<string | null>(documentId);
	const [effectiveDocumentSlug, setEffectiveDocumentSlug] = useState<string | null>(documentSlug);

	return (
		<Box
			sx={{
				display: 'flex',
				height: '100%',
				overflow: 'hidden',
				...colors.bg.default.style,
			}}
			data-testid="workspace-docs-page"
		>
			{/* Left sidebar - Document Tree */}
			<Box
				sx={{
					width: 256,
					minWidth: 256,
					borderRight: 1,
					...colors.border.default.style,
					display: 'flex',
					flexDirection: 'column',
					overflow: 'hidden',
				}}
			>
				<DocumentTree
					activeDocumentId={documentId || undefined}
				/>
			</Box>

			{/* Center - Document View */}
			<Box
				sx={{
					flex: 1,
					display: 'flex',
					flexDirection: 'column',
					overflow: 'hidden',
				}}
			>
				{activeDocIdentifier ? (
					<DocumentView
						documentId={documentId || undefined}
						documentSlug={documentSlug || undefined}
						onOpenComments={() => setRightPanelTab('comments')}
						onOpenHistory={() => setRightPanelTab('history')}
						onOpenCitations={() => setRightPanelTab('citations')}
						onDocumentResolved={setEffectiveDocumentId}
						onSlugResolved={setEffectiveDocumentSlug}
					/>
				) : (
					<DocumentEmptyState />
				)}
			</Box>

			{/* Right panel - Comments/History/Citations */}
			{rightPanelTab && effectiveDocumentId && effectiveDocumentSlug && (
				<Box
					sx={{
						width: 288,
						minWidth: 288,
						borderLeft: 1,
						...colors.border.default.style,
						display: 'flex',
						flexDirection: 'column',
						overflow: 'hidden',
					}}
				>
					<RightPanel
						documentId={effectiveDocumentId}
						documentSlug={effectiveDocumentSlug}
						activeTab={rightPanelTab}
						onTabChange={setRightPanelTab}
						onClose={() => setRightPanelTab(null)}
					/>
				</Box>
			)}
		</Box>
	);
}

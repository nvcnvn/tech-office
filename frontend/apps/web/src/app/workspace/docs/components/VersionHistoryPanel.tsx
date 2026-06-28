/**
 * VersionHistoryPanel Component
 * Shows document version history with diff capability
 */

'use client';

import React, { useState } from 'react';
import {
	Box,
	Typography,
	List,
	ListItemButton,
	ListItemText,
	CircularProgress,
	Chip,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { listVersions, type DocumentVersion } from 'apis';
import { useThemeColors } from '@/theme/useThemeColors';
import { useRouter } from 'next/navigation';

interface VersionHistoryPanelProps {
	documentId: string;
	documentSlug: string;
	currentVersionNumber?: number;
}

export default function VersionHistoryPanel({ documentId, documentSlug, currentVersionNumber }: VersionHistoryPanelProps) {
	const colors = useThemeColors();
	const router = useRouter();
	const [selectedVersion, setSelectedVersion] = useState<DocumentVersion | null>(null);

	// Fetch versions
	const { data: versionsData, isLoading } = useQuery({
		queryKey: ['docs', 'versions', documentId],
		queryFn: () => listVersions({ documentId, limit: 50 }),
		staleTime: 30000,
	});

	const versions = versionsData?.versions || [];
	// Determine current version from data if not provided
	const latestVersionNumber = currentVersionNumber || (versions.length > 0 ? versions[0].versionNumber : 0);

	const handleVersionClick = (version: DocumentVersion) => {
		// Don't navigate if clicking current version
		if (version.versionNumber === latestVersionNumber) {
			return;
		}

		setSelectedVersion(version);
		// Navigate to compare page when clicking a version
		if (version.versionNumber === 1) {
			// First version - show it standalone
			router.push(`/workspace/docs/${documentSlug}/compare?version=${version.versionNumber}`);
		} else {
			// Compare with next higher version
			const nextVersion = version.versionNumber + 1;
			router.push(`/workspace/docs/${documentSlug}/compare?from=${version.versionNumber}&to=${nextVersion}`);
		}
	};

	// Get link text for a version
	const getLinkText = (version: DocumentVersion): string => {
		if (version.versionNumber === latestVersionNumber) {
			return 'Current version';
		}
		if (version.versionNumber === 1) {
			return 'View v1';
		}
		const nextVersion = version.versionNumber + 1;
		return `Compare v${version.versionNumber} with v${nextVersion}`;
	};

	return (
		<Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
			{/* Version list */}
			<Box sx={{ flex: 1, overflow: 'auto' }}>
				{isLoading ? (
					<Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
						<CircularProgress size={24} />
					</Box>
				) : versions.length === 0 ? (
					<Box sx={{ py: 4, textAlign: 'center' }}>
						<Typography variant="body2" sx={colors.text.secondary.style}>
							No version history
						</Typography>
					</Box>
				) : (
					<List dense>
						{versions.map((version) => {
							const isCurrentVersion = version.versionNumber === latestVersionNumber;
							const linkText = getLinkText(version);

							return (
								<ListItemButton
									key={version.id}
									selected={selectedVersion?.id === version.id}
									onClick={() => handleVersionClick(version)}
									disabled={isCurrentVersion}
									data-testid={`version-item-${version.versionNumber}`}
									sx={{
										cursor: isCurrentVersion ? 'default' : 'pointer',
										'&.Mui-disabled': {
											opacity: 0.7,
										},
									}}
								>
									<ListItemText
										primary={
											<Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
												<Chip
													label={`v${version.versionNumber}`}
													size="small"
													color={isCurrentVersion ? 'primary' : 'default'}
													variant={isCurrentVersion ? 'filled' : 'outlined'}
												/>
												<Typography
													variant="caption"
													sx={{
														...(isCurrentVersion ? colors.text.secondary.style : colors.text.primary.style),
														fontWeight: isCurrentVersion ? 400 : 500,
													}}
												>
													{linkText}
												</Typography>
											</Box>
										}
										secondary={
											<Box>
												<Typography variant="caption" display="block">
													{version.authorName}
												</Typography>
												<Typography variant="caption" sx={colors.text.secondary.style}>
													{version.createdAt.toLocaleString()}
												</Typography>
												{version.summary && (
													<Typography variant="caption" display="block" sx={{ mt: 0.5 }}>
														{version.summary}
													</Typography>
												)}
											</Box>
										}
									/>
								</ListItemButton>
							);
						})}
					</List>
				)}
			</Box>
		</Box>
	);
}

'use client';

import React, { useEffect, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Link as MuiLink, Typography } from '@mui/material';
import { getDownloadUrl, type ReviewQueueEntry } from 'apis';
import { useThemeColors } from '@/theme/useThemeColors';

const FILE_BACKED_TYPES = new Set(['photo', 'voice_memo', 'pdf', 'file']);

/**
 * The evidence itself, rendered inline so the reviewer can judge without opening the task.
 *
 * File-backed types resolve their URL lazily through the existing files download path:
 * download URLs are short-lived, so minting 25 of them per page would hand the reviewer
 * links that expire before they scroll to the row.
 *
 * When the file cannot be resolved — a broken upload, a missing id — the row says so
 * explicitly and stays decidable. Dropping it would let a failed upload silently clear
 * the queue, which is the failure FR-009 exists to prevent.
 */
export default function ReviewQueueEvidence({ entry }: { entry: ReviewQueueEntry }) {
	const colors = useThemeColors();
	const [url, setUrl] = useState<string | undefined>();
	const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle');

	const isFileBacked = FILE_BACKED_TYPES.has(entry.evidenceType);

	useEffect(() => {
		if (!isFileBacked) return;
		if (!entry.fileId) {
			setState('unavailable');
			return;
		}

		let cancelled = false;
		setState('loading');
		getDownloadUrl(entry.fileId)
			.then((info) => {
				if (cancelled) return;
				if (!info.downloadUrl || info.isDeleted) {
					setState('unavailable');
					return;
				}
				setUrl(info.downloadUrl);
				setState('ready');
			})
			.catch(() => {
				if (!cancelled) setState('unavailable');
			});

		return () => {
			cancelled = true;
		};
	}, [entry.fileId, entry.evidenceType, isFileBacked]);

	if (entry.evidenceType === 'text_note') {
		return (
			<Typography
				variant="body2"
				sx={{ ...colors.text.primary.style, whiteSpace: 'pre-wrap' }}
				data-testid={`review-queue-evidence-text-${entry.evidenceSubmissionId}`}
			>
				{entry.textContent}
			</Typography>
		);
	}

	if (entry.evidenceType === 'link') {
		return (
			<MuiLink
				href={entry.linkUrl}
				target="_blank"
				rel="noopener noreferrer"
				variant="body2"
				data-testid={`review-queue-evidence-link-${entry.evidenceSubmissionId}`}
			>
				{entry.linkUrl}
			</MuiLink>
		);
	}

	if (entry.evidenceType === 'gps_checkin') {
		const gps = entry.gpsCoordinates;
		return (
			<Typography
				variant="body2"
				sx={colors.text.primary.style}
				data-testid={`review-queue-evidence-gps-${entry.evidenceSubmissionId}`}
			>
				{gps
					? `${gps.latitude.toFixed(5)}, ${gps.longitude.toFixed(5)} (±${Math.round(gps.accuracyMeters)} m)`
					: 'No coordinates recorded'}
			</Typography>
		);
	}

	if (state === 'loading') {
		return <CircularProgress size={20} data-testid={`review-queue-evidence-loading-${entry.evidenceSubmissionId}`} />;
	}

	if (state === 'unavailable') {
		return (
			<Alert
				severity="warning"
				sx={{ py: 0.25 }}
				data-testid={`review-queue-evidence-unavailable-${entry.evidenceSubmissionId}`}
			>
				Evidence unavailable — the uploaded file could not be opened. You can still decide on this basis.
			</Alert>
		);
	}

	if (entry.evidenceType === 'photo' && url) {
		return (
			<Box
				component="a"
				href={url}
				target="_blank"
				rel="noopener noreferrer"
				sx={{ display: 'inline-block', lineHeight: 0 }}
				data-testid={`review-queue-evidence-photo-${entry.evidenceSubmissionId}`}
			>
				{/* eslint-disable-next-line @next/next/no-img-element */}
				<img
					src={url}
					alt={`Evidence for ${entry.evidenceRequirementName}`}
					style={{ maxHeight: 160, maxWidth: '100%', borderRadius: 8, objectFit: 'cover' }}
				/>
			</Box>
		);
	}

	if (url) {
		return (
			<Button
				size="small"
				variant="outlined"
				href={url}
				target="_blank"
				rel="noopener noreferrer"
				data-testid={`review-queue-evidence-file-${entry.evidenceSubmissionId}`}
			>
				Open {entry.evidenceType === 'voice_memo' ? 'voice memo' : entry.evidenceType === 'pdf' ? 'PDF' : 'file'}
			</Button>
		);
	}

	return null;
}

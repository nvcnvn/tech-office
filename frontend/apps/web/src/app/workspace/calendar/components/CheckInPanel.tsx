/**
 * Check-In Panel
 * Mobile-first panel for compliance event check-in and evidence submission.
 * Feature: 026-calendar-system (T068)
 */

'use client';

import React, { useState, useCallback } from 'react';
import {
	Box,
	Typography,
	Button,
	List,
	ListItem,
	ListItemText,
	Chip,
	CircularProgress,
	Alert,
	Divider,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import HistoryIcon from '@mui/icons-material/History';
import { useMutation, useQuery } from '@tanstack/react-query';
import { checkInToEvent, submitCheckInEvidence, listAuditEntries, type CalendarAuditEntry } from 'apis';

// =============================================================================
// Types
// =============================================================================

interface CheckInPanelProps {
	eventId: string;
	requiresCheckIn: boolean;
	requiresEvidence: boolean;
}

// =============================================================================
// Component
// =============================================================================

export default function CheckInPanel({ eventId, requiresCheckIn, requiresEvidence }: CheckInPanelProps) {
	const [checkedIn, setCheckedIn] = useState(false);
	const [evidenceSubmitted, setEvidenceSubmitted] = useState(false);

	const checkInMutation = useMutation({
		mutationFn: () => checkInToEvent(eventId),
		onSuccess: () => setCheckedIn(true),
	});

	const evidenceMutation = useMutation({
		mutationFn: (fileIds: string[]) => submitCheckInEvidence(eventId, fileIds),
		onSuccess: () => setEvidenceSubmitted(true),
	});

	const { data: auditData } = useQuery({
		queryKey: ['calendar', 'audit', eventId],
		queryFn: () => listAuditEntries(eventId),
	});

	const handleFileSelect = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			// In a real implementation, files would be uploaded first via the files service.
			// For now, simulate with dummy file IDs.
			const files = e.target.files;
			if (files && files.length > 0) {
				const dummyIds = Array.from(files).map((_, i) => `file-${Date.now()}-${i}`);
				evidenceMutation.mutate(dummyIds);
			}
		},
		[evidenceMutation],
	);

	return (
		<Box data-testid="check-in-panel" sx={{ p: 2 }}>
			{/* Check-In Section */}
			{requiresCheckIn && (
				<Box sx={{ mb: 2 }}>
					<Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
						Event Check-In
					</Typography>
					{checkedIn ? (
						<Alert severity="success" icon={<CheckCircleIcon />}>
							Checked in successfully
							{checkInMutation.data?.isLate && (
								<Chip label="Late" color="warning" size="small" sx={{ ml: 1 }} />
							)}
						</Alert>
					) : (
						<Button
							variant="contained"
							size="large"
							fullWidth
							startIcon={<CheckCircleIcon />}
							onClick={() => checkInMutation.mutate()}
							disabled={checkInMutation.isPending}
							sx={{ py: 2, textTransform: 'none', fontSize: '1.1rem' }}
						>
							{checkInMutation.isPending ? 'Checking in…' : 'Check In Now'}
						</Button>
					)}
					{checkInMutation.isError && (
						<Alert severity="error" sx={{ mt: 1 }}>
							Failed to check in. Please try again.
						</Alert>
					)}
				</Box>
			)}

			{/* Evidence Section */}
			{requiresEvidence && (
				<Box sx={{ mb: 2 }}>
					<Divider sx={{ my: 1 }} />
					<Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
						Submit Evidence
					</Typography>
					{evidenceSubmitted ? (
						<Alert severity="success">Evidence submitted</Alert>
					) : (
						<Button
							variant="outlined"
							component="label"
							startIcon={<UploadFileIcon />}
							disabled={evidenceMutation.isPending}
							sx={{ textTransform: 'none' }}
						>
							{evidenceMutation.isPending ? 'Uploading…' : 'Attach Files'}
							<input hidden type="file" multiple onChange={handleFileSelect} />
						</Button>
					)}
				</Box>
			)}

			{/* Audit Trail */}
			{auditData && auditData.entries.length > 0 && (
				<Box>
					<Divider sx={{ my: 1 }} />
					<Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1, display: 'flex', alignItems: 'center', gap: 0.5 }}>
						<HistoryIcon fontSize="small" /> Audit Trail
					</Typography>
					<List dense disablePadding>
						{auditData.entries.map((entry) => (
							<ListItem key={entry.id} disableGutters>
								<ListItemText
									primary={entry.actionType}
									secondary={`${entry.actorName || entry.actorId.slice(0, 8)} · ${entry.occurredAt?.toLocaleString() ?? ''}`}
								/>
							</ListItem>
						))}
					</List>
				</Box>
			)}
		</Box>
	);
}

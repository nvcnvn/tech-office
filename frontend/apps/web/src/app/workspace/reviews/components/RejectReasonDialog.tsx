'use client';

import React, { useEffect, useState } from 'react';
import {
	Button,
	Dialog,
	DialogActions,
	DialogContent,
	DialogTitle,
	TextField,
	Typography,
} from '@mui/material';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import type { ReviewQueueEntry } from 'apis';
import { useThemeColors } from '@/theme/useThemeColors';
import ProcedureDialog from '@/app/workspace/components/ProcedureDialog';

export interface RejectReasonDialogProps {
	entry?: ReviewQueueEntry;
	submitting: boolean;
	onCancel: () => void;
	onConfirm: (reason: string) => void;
}

/**
 * A rejection without a reason leaves the submitter no way to fix the work, so confirm
 * stays disabled until the trimmed reason is non-empty. The server enforces the same rule;
 * this is the fast, local half of it.
 */
export default function RejectReasonDialog({
	entry,
	submitting,
	onCancel,
	onConfirm,
}: RejectReasonDialogProps) {
	const colors = useThemeColors();
	const [reason, setReason] = useState('');
	// Feature 043. The Procedure control on the queue row sits *behind* this modal, so once
	// the reviewer is writing a reason it is unreachable — which is exactly the moment they
	// most need the written standard. The control is therefore repeated here and stacks a
	// second dialog above this one. This dialog is never unmounted, so `reason` survives
	// reading the procedure (FR-014).
	const [procedureOpen, setProcedureOpen] = useState(false);

	useEffect(() => {
		if (entry) setReason('');
	}, [entry]);

	const trimmed = reason.trim();

	return (
		<Dialog open={!!entry} onClose={onCancel} fullWidth maxWidth="sm">
			<DialogTitle>Reject this evidence</DialogTitle>
			<DialogContent>
				<Typography variant="body2" sx={{ mb: 2, ...colors.text.secondary.style }}>
					{entry ? `${entry.taskIdentifier} · ${entry.evidenceRequirementName}` : ''}
				</Typography>
				<TextField
					autoFocus
					fullWidth
					multiline
					minRows={3}
					label="Reason"
					placeholder="What needs to change before this can be accepted?"
					value={reason}
					onChange={(e) => setReason(e.target.value)}
					slotProps={{ htmlInput: { 'data-testid': 'review-queue-reject-reason-input' } }}
				/>
			</DialogContent>
			<DialogActions>
				{entry?.procedureDocumentId && (
					<Button
						startIcon={<MenuBookIcon fontSize="small" />}
						onClick={() => setProcedureOpen(true)}
						sx={{ mr: 'auto' }}
						data-testid="review-queue-reject-procedure-btn"
					>
						Procedure
					</Button>
				)}
				<Button onClick={onCancel} disabled={submitting}>
					Cancel
				</Button>
				<Button
					variant="contained"
					color="error"
					disabled={trimmed.length === 0 || submitting}
					onClick={() => onConfirm(trimmed)}
					data-testid="review-queue-reject-confirm-btn"
				>
					{submitting ? 'Rejecting…' : 'Reject'}
				</Button>
			</DialogActions>

			{entry?.procedureDocumentId && (
				<ProcedureDialog
					open={procedureOpen}
					onClose={() => setProcedureOpen(false)}
					ritualDefinitionId={entry.ritualDefinitionId}
				/>
			)}
		</Dialog>
	);
}

'use client';

/**
 * Report a piece of content (Feature 036, FR-014, FR-015).
 *
 * Choosing a reason is required — a report with no reason tells a reviewer
 * nothing — and the confirmation is explicit, because a person who reports
 * something and sees nothing happen assumes it failed.
 *
 * The dialog sends only what was reported and why. Who authored it, and what it
 * said, are resolved server-side, so a client cannot pin a message on somebody
 * else.
 */

import { useState } from 'react';
import {
	Alert,
	Button,
	Dialog,
	DialogActions,
	DialogContent,
	DialogContentText,
	DialogTitle,
	FormControl,
	FormControlLabel,
	FormLabel,
	Radio,
	RadioGroup,
	Stack,
	TextField,
} from '@mui/material';
import {
	REPORT_REASON_LABELS,
	reportContent,
	type ReportReason,
	type ReportTargetKind,
} from 'apis';

export function ReportContentDialog({
	open,
	targetKind,
	targetId,
	subjectLabel,
	onClose,
}: {
	open: boolean;
	targetKind: ReportTargetKind;
	targetId: string;
	/** What is being reported, in the person's words: "this message", "this file". */
	subjectLabel: string;
	onClose: () => void;
}) {
	const [reason, setReason] = useState<ReportReason | ''>('');
	const [note, setNote] = useState('');
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState('');
	const [confirmed, setConfirmed] = useState(false);

	const reset = () => {
		setReason('');
		setNote('');
		setError('');
		setConfirmed(false);
		setSubmitting(false);
	};

	const close = () => {
		reset();
		onClose();
	};

	const submit = async () => {
		if (!reason) return;
		setSubmitting(true);
		setError('');
		try {
			await reportContent({ targetKind, targetId, reason, note: note.trim() || undefined });
			setConfirmed(true);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Could not send that report.');
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<Dialog open={open} onClose={close} maxWidth="xs" fullWidth data-testid="report-dialog">
			{confirmed ? (
				<>
					<DialogTitle>Thanks — that has been reported</DialogTitle>
					<DialogContent>
						<DialogContentText data-testid="report-dialog-confirmation">
							The people who run this workspace can see it now, along with a copy of the
							content as it is right now. You do not need to do anything else.
						</DialogContentText>
					</DialogContent>
					<DialogActions>
						<Button variant="contained" onClick={close} data-testid="report-dialog-done">
							Done
						</Button>
					</DialogActions>
				</>
			) : (
				<>
					<DialogTitle>Report {subjectLabel}</DialogTitle>
					<DialogContent>
						<Stack spacing={2} sx={{ mt: 1 }}>
							<DialogContentText>
								This goes to the people who run this workspace. The person who posted it
								is not told who reported it.
							</DialogContentText>

							<FormControl required>
								<FormLabel>What is wrong with it?</FormLabel>
								<RadioGroup
									value={reason}
									onChange={(e) => setReason(e.target.value as ReportReason)}
									data-testid="report-dialog-reasons"
								>
									{REPORT_REASON_LABELS.map((option) => (
										<FormControlLabel
											key={option.value}
											value={option.value}
											control={<Radio data-testid={`report-reason-${option.value}`} />}
											label={option.label}
										/>
									))}
								</RadioGroup>
							</FormControl>

							<TextField
								label="Anything to add? (optional)"
								multiline
								minRows={2}
								value={note}
								onChange={(e) => setNote(e.target.value)}
								disabled={submitting}
								data-testid="report-dialog-note"
							/>

							{error ? (
								<Alert severity="error" data-testid="report-dialog-error">
									{error}
								</Alert>
							) : null}
						</Stack>
					</DialogContent>
					<DialogActions>
						<Button onClick={close} disabled={submitting}>
							Cancel
						</Button>
						<Button
							variant="contained"
							color="error"
							onClick={submit}
							disabled={!reason || submitting}
							data-testid="report-dialog-submit"
						>
							{submitting ? 'Sending…' : 'Report'}
						</Button>
					</DialogActions>
				</>
			)}
		</Dialog>
	);
}

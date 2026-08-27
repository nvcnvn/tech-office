'use client';

/**
 * Content report queue (Feature 036, FR-017, FR-018).
 *
 * Web-only: reviewing reports is administrative, and Constitution XIII keeps
 * administrative surfaces off mobile. Access is enforced by the
 * `compliance.reviewReports` permission on the RPC, not by hiding the link — an
 * employee who types the URL is denied by the server.
 *
 * Each row renders the snapshot taken when the report was filed, which is what
 * makes a report reviewable after its author deletes the original.
 */

import { useCallback, useEffect, useState } from 'react';
import {
	Alert,
	Box,
	Button,
	Chip,
	CircularProgress,
	Container,
	Dialog,
	DialogActions,
	DialogContent,
	DialogTitle,
	Divider,
	Paper,
	Stack,
	Tab,
	Tabs,
	TextField,
	Typography,
} from '@mui/material';
import FlagIcon from '@mui/icons-material/Flag';
import { useRequireAuth } from '@/lib/auth/hooks';
import {
	REPORT_REASON_LABELS,
	listReports,
	reportReasonFromProto,
	reportStatusFromProto,
	reportTargetKindFromProto,
	resolveReport,
	type ContentReport,
	type ReportOutcome,
	type ReportStatus,
} from 'apis';

const TARGET_KIND_LABELS: Record<string, string> = {
	chat_message: 'Channel message',
	direct_message: 'Direct message',
	file: 'File',
	document_comment: 'Document comment',
	call_record: 'Voice call',
};

function reasonLabel(report: ContentReport): string {
	const reason = reportReasonFromProto(report.reason);
	return REPORT_REASON_LABELS.find((r) => r.value === reason)?.label ?? 'Unspecified';
}

export default function ReportQueuePage() {
	const { isLoading, user } = useRequireAuth();
	const [statusFilter, setStatusFilter] = useState<ReportStatus>('outstanding');
	const [reports, setReports] = useState<ContentReport[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [resolving, setResolving] = useState<ContentReport | null>(null);
	const [outcome, setOutcome] = useState<ReportOutcome>('actioned');
	const [outcomeNote, setOutcomeNote] = useState('');
	const [submitting, setSubmitting] = useState(false);

	const load = useCallback(async () => {
		setLoading(true);
		setError('');
		try {
			const resp = await listReports({ statusFilter, limit: 50 });
			setReports(resp.reports);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Could not load reports.');
		} finally {
			setLoading(false);
		}
	}, [statusFilter]);

	useEffect(() => {
		void load();
	}, [load]);

	const submitResolution = async () => {
		if (!resolving) return;
		setSubmitting(true);
		setError('');
		try {
			await resolveReport(resolving.id, outcome, outcomeNote.trim());
			setResolving(null);
			setOutcomeNote('');
			await load();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Could not record that outcome.');
		} finally {
			setSubmitting(false);
		}
	};

	if (isLoading) {
		return (
			<Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
				<CircularProgress />
			</Box>
		);
	}
	if (!user) return null;

	return (
		<Container maxWidth="md" sx={{ py: 4 }}>
			<Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
				<FlagIcon sx={{ fontSize: 32, color: 'primary.main' }} />
				<Box>
					<Typography variant="h4" component="h1">
						Reported content
					</Typography>
					<Typography variant="body2" color="text.secondary">
						What people in this workspace have flagged, and what was done about it.
					</Typography>
				</Box>
			</Box>

			<Tabs
				value={statusFilter}
				onChange={(_, value: ReportStatus) => setStatusFilter(value)}
				sx={{ mb: 2 }}
			>
				<Tab label="Outstanding" value="outstanding" data-testid="reports-tab-outstanding" />
				<Tab label="Actioned" value="actioned" data-testid="reports-tab-actioned" />
				<Tab label="Dismissed" value="dismissed" data-testid="reports-tab-dismissed" />
			</Tabs>

			{error ? (
				<Alert severity="error" sx={{ mb: 2 }} data-testid="reports-error">
					{error}
				</Alert>
			) : null}

			{loading ? (
				<Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
					<CircularProgress size={24} />
				</Box>
			) : reports.length === 0 ? (
				<Paper sx={{ p: 4, textAlign: 'center', border: 1, borderColor: 'divider' }}>
					<Typography variant="body1" color="text.secondary" data-testid="reports-empty">
						Nothing here.
					</Typography>
				</Paper>
			) : (
				<Stack spacing={2} data-testid="reports-list">
					{reports.map((report) => (
						<Paper
							key={report.id}
							sx={{ p: 3, border: 1, borderColor: 'divider' }}
							data-testid={`report-${report.id}`}
						>
							<Stack direction="row" spacing={1} sx={{ mb: 1 }} flexWrap="wrap" useFlexGap>
								<Chip size="small" color="error" label={reasonLabel(report)} />
								<Chip
									size="small"
									variant="outlined"
									label={
										TARGET_KIND_LABELS[reportTargetKindFromProto(report.targetKind) ?? ''] ??
										'Content'
									}
								/>
								<Chip
									size="small"
									variant="outlined"
									label={reportStatusFromProto(report.status) ?? 'unknown'}
								/>
							</Stack>

							<Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
								{report.reporterName} reported {report.reportedName}
								{report.createdAt
									? ` on ${new Date(Number(report.createdAt.seconds) * 1000).toLocaleString()}`
									: ''}
							</Typography>

							{/* The snapshot, not a live fetch: this is what keeps the report
							    reviewable after the original is deleted. */}
							<Paper
								variant="outlined"
								sx={{ p: 2, bgcolor: 'action.hover', whiteSpace: 'pre-wrap', mb: 1 }}
								data-testid={`report-snapshot-${report.id}`}
							>
								<Typography variant="body2">{report.contentSnapshot}</Typography>
							</Paper>

							{report.note ? (
								<Typography variant="body2" sx={{ mb: 1 }}>
									<strong>They added:</strong> {report.note}
								</Typography>
							) : null}

							{report.outcomeNote ? (
								<>
									<Divider sx={{ my: 1 }} />
									<Typography variant="body2" color="text.secondary">
										<strong>Outcome:</strong> {report.outcomeNote}
									</Typography>
								</>
							) : null}

							{reportStatusFromProto(report.status) === 'outstanding' ? (
								<Box sx={{ mt: 2 }}>
									<Button
										variant="contained"
										size="small"
										onClick={() => {
											setResolving(report);
											setOutcome('actioned');
											setOutcomeNote('');
										}}
										data-testid={`report-resolve-${report.id}`}
									>
										Record an outcome
									</Button>
								</Box>
							) : null}
						</Paper>
					))}
				</Stack>
			)}

			<Dialog open={resolving !== null} onClose={() => setResolving(null)} maxWidth="sm" fullWidth>
				<DialogTitle>Record an outcome</DialogTitle>
				<DialogContent>
					<Stack spacing={2} sx={{ mt: 1 }}>
						<Stack direction="row" spacing={1}>
							<Button
								variant={outcome === 'actioned' ? 'contained' : 'outlined'}
								onClick={() => setOutcome('actioned')}
								data-testid="resolve-outcome-actioned"
							>
								Acted on it
							</Button>
							<Button
								variant={outcome === 'dismissed' ? 'contained' : 'outlined'}
								onClick={() => setOutcome('dismissed')}
								data-testid="resolve-outcome-dismissed"
							>
								Dismissed it
							</Button>
						</Stack>
						{/* Required: a resolved report with no note tells the next reviewer
						    nothing about what already happened. */}
						<TextField
							label="What did you do?"
							multiline
							minRows={3}
							required
							value={outcomeNote}
							onChange={(e) => setOutcomeNote(e.target.value)}
							disabled={submitting}
							slotProps={{ htmlInput: { 'data-testid': 'resolve-outcome-note' } }}
						/>
					</Stack>
				</DialogContent>
				<DialogActions>
					<Button onClick={() => setResolving(null)} disabled={submitting}>
						Cancel
					</Button>
					<Button
						variant="contained"
						onClick={submitResolution}
						disabled={submitting || outcomeNote.trim().length === 0}
						data-testid="resolve-outcome-submit"
					>
						{submitting ? 'Saving…' : 'Save'}
					</Button>
				</DialogActions>
			</Dialog>
		</Container>
	);
}

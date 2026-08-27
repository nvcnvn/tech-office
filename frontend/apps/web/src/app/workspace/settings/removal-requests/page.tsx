'use client';

/**
 * Account removal request queue (Feature 036, FR-007d).
 *
 * Web-only: deciding whether to end somebody's membership is administrative, and
 * Constitution XIII keeps administrative surfaces off mobile. The
 * `compliance.manageRemovalRequests` permission on the RPC is what actually
 * enforces it.
 *
 * Granting is not a soft action — it ends the person's membership and, when it was
 * their last, destroys their global identity data — so the confirmation says so
 * plainly rather than asking "are you sure?".
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
	DialogContentText,
	DialogTitle,
	Paper,
	Stack,
	Tab,
	Tabs,
	Typography,
} from '@mui/material';
import PersonRemoveIcon from '@mui/icons-material/PersonRemove';
import { useRequireAuth } from '@/lib/auth/hooks';
import {
	decideRemovalRequest,
	listRemovalRequests,
	removalRequestStatusFromProto,
	type RemovalDecision,
	type RemovalRequest,
	type RemovalRequestStatus,
} from 'apis';

export default function RemovalRequestQueuePage() {
	const { isLoading, user } = useRequireAuth();
	const [statusFilter, setStatusFilter] = useState<RemovalRequestStatus>('outstanding');
	const [requests, setRequests] = useState<RemovalRequest[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [deciding, setDeciding] = useState<{ request: RemovalRequest; decision: RemovalDecision } | null>(
		null,
	);
	const [submitting, setSubmitting] = useState(false);

	const load = useCallback(async () => {
		setLoading(true);
		setError('');
		try {
			const resp = await listRemovalRequests({ statusFilter, limit: 50 });
			setRequests(resp.requests);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Could not load removal requests.');
		} finally {
			setLoading(false);
		}
	}, [statusFilter]);

	useEffect(() => {
		void load();
	}, [load]);

	const decide = async () => {
		if (!deciding) return;
		setSubmitting(true);
		setError('');
		try {
			await decideRemovalRequest(deciding.request.id, deciding.decision);
			setDeciding(null);
			await load();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Could not record that decision.');
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
				<PersonRemoveIcon sx={{ fontSize: 32, color: 'primary.main' }} />
				<Box>
					<Typography variant="h4" component="h1">
						Removal requests
					</Typography>
					<Typography variant="body2" color="text.secondary">
						People asking to be removed from this workspace.
					</Typography>
				</Box>
			</Box>

			<Tabs
				value={statusFilter}
				onChange={(_, value: RemovalRequestStatus) => setStatusFilter(value)}
				sx={{ mb: 2 }}
			>
				<Tab label="Outstanding" value="outstanding" data-testid="removals-tab-outstanding" />
				<Tab label="Granted" value="granted" data-testid="removals-tab-granted" />
				<Tab label="Declined" value="declined" data-testid="removals-tab-declined" />
			</Tabs>

			{error ? (
				<Alert severity="error" sx={{ mb: 2 }} data-testid="removals-error">
					{error}
				</Alert>
			) : null}

			{loading ? (
				<Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
					<CircularProgress size={24} />
				</Box>
			) : requests.length === 0 ? (
				<Paper sx={{ p: 4, textAlign: 'center', border: 1, borderColor: 'divider' }}>
					<Typography variant="body1" color="text.secondary" data-testid="removals-empty">
						Nothing here.
					</Typography>
				</Paper>
			) : (
				<Stack spacing={2} data-testid="removals-list">
					{requests.map((request) => {
						const status = removalRequestStatusFromProto(request.status);
						return (
							<Paper
								key={request.id}
								sx={{ p: 3, border: 1, borderColor: 'divider' }}
								data-testid={`removal-${request.id}`}
							>
								<Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
									<Typography variant="subtitle1">{request.employeeName}</Typography>
									<Chip size="small" variant="outlined" label={status ?? 'unknown'} />
								</Stack>

								<Typography variant="body2" color="text.secondary">
									{request.createdAt
										? `Asked on ${new Date(Number(request.createdAt.seconds) * 1000).toLocaleString()}`
										: 'Asked recently'}
								</Typography>

								{request.note ? (
									<Typography variant="body2" sx={{ mt: 1 }}>
										<strong>They said:</strong> {request.note}
									</Typography>
								) : null}

								{status === 'outstanding' ? (
									<Stack direction="row" spacing={1} sx={{ mt: 2 }}>
										<Button
											variant="contained"
											color="error"
											size="small"
											onClick={() => setDeciding({ request, decision: 'granted' })}
											data-testid={`removal-grant-${request.id}`}
										>
											Grant
										</Button>
										<Button
											variant="outlined"
											size="small"
											onClick={() => setDeciding({ request, decision: 'declined' })}
											data-testid={`removal-decline-${request.id}`}
										>
											Decline
										</Button>
									</Stack>
								) : null}
							</Paper>
						);
					})}
				</Stack>
			)}

			<Dialog open={deciding !== null} onClose={() => setDeciding(null)} maxWidth="xs" fullWidth>
				<DialogTitle>
					{deciding?.decision === 'granted' ? 'Remove this person?' : 'Decline this request?'}
				</DialogTitle>
				<DialogContent>
					<DialogContentText>
						{deciding?.decision === 'granted'
							? `${deciding.request.employeeName} loses access immediately. Their personal details are erased and their work stays with this workspace, attributed to nobody. This cannot be undone.`
							: `${deciding?.request.employeeName} keeps their access, and can ask again later.`}
					</DialogContentText>
				</DialogContent>
				<DialogActions>
					<Button onClick={() => setDeciding(null)} disabled={submitting}>
						Cancel
					</Button>
					<Button
						variant="contained"
						color={deciding?.decision === 'granted' ? 'error' : 'primary'}
						onClick={decide}
						disabled={submitting}
						data-testid="removal-decision-confirm"
					>
						{submitting
							? 'Saving…'
							: deciding?.decision === 'granted'
								? 'Remove them'
								: 'Decline'}
					</Button>
				</DialogActions>
			</Dialog>
		</Container>
	);
}

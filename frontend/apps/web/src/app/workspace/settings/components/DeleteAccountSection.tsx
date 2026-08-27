'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
	Alert,
	AlertTitle,
	Box,
	Button,
	Chip,
	CircularProgress,
	Dialog,
	DialogActions,
	DialogContent,
	DialogContentText,
	DialogTitle,
	Divider,
	List,
	ListItem,
	ListItemText,
	Paper,
	Stack,
	TextField,
	Typography,
} from '@mui/material';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import {
	deleteMyAccount,
	extractSoleOwnerBlocksDeletion,
	getAccountDeletionPreview,
	getAccountRemovalPath,
	requestAccountRemoval,
	type AccountDeletionPreview,
	type AccountRemovalPathSummary,
	type BlockingOrganizationSummary,
} from 'apis';

/**
 * Account deletion, and the removal-request path for admin-provisioned workers
 * (Feature 036, FR-001, FR-002, FR-005, FR-007b).
 *
 * Which of the two a person sees comes from the server, not from anything inferred
 * here, so this screen and the mobile one cannot disagree about somebody's path.
 * The erased/retained copy is likewise server-assembled.
 */
export function DeleteAccountSection() {
	const [path, setPath] = useState<AccountRemovalPathSummary | null>(null);
	const [preview, setPreview] = useState<AccountDeletionPreview | null>(null);
	const [loading, setLoading] = useState(true);
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [phrase, setPhrase] = useState('');
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState('');
	const [blocking, setBlocking] = useState<BlockingOrganizationSummary[]>([]);
	const [removalNote, setRemovalNote] = useState('');

	const load = async () => {
		setError('');
		try {
			const nextPath = await getAccountRemovalPath();
			setPath(nextPath);
			if (nextPath.path === 'self_delete') {
				setPreview(await getAccountDeletionPreview());
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Could not load your account details.');
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		void load();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const confirmationPhrase = preview?.confirmationPhrase ?? '';
	const phraseMatches =
		confirmationPhrase.length > 0 &&
		phrase.trim().toLowerCase() === confirmationPhrase.toLowerCase();

	const blockedOrgs: BlockingOrganizationSummary[] =
		blocking.length > 0
			? blocking
			: (preview?.organizations ?? [])
					.filter((org) => org.blocksDeletion)
					.map((org) => ({
						organizationId: org.organizationId,
						organizationName: org.organizationName,
						memberCount: org.memberCount,
					}));

	const handleDelete = async () => {
		setSubmitting(true);
		setError('');
		setBlocking([]);
		try {
			await deleteMyAccount(phrase.trim());
			// Sessions are already gone server-side; a full reload is what makes the
			// browser agree with that rather than rendering a stale signed-in shell.
			window.location.href = '/signin';
		} catch (err) {
			const blocked = extractSoleOwnerBlocksDeletion(err);
			if (blocked.length > 0) {
				setBlocking(blocked);
				setConfirmOpen(false);
			} else {
				setError(err instanceof Error ? err.message : 'Could not delete your account.');
			}
			setSubmitting(false);
		}
	};

	const handleRequestRemoval = async () => {
		setSubmitting(true);
		setError('');
		try {
			await requestAccountRemoval(removalNote.trim() || undefined);
			await load();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Could not send your request.');
		} finally {
			setSubmitting(false);
		}
	};

	if (loading) {
		return (
			<Paper sx={{ p: 3, mt: 3, border: 1, borderColor: 'divider' }}>
				<CircularProgress size={22} />
			</Paper>
		);
	}

	// --- Admin-provisioned worker: request removal instead of deleting ---
	if (path?.path === 'request_removal') {
		const latest = path.latestRequest;
		return (
			<Paper
				sx={{ p: 3, mt: 3, border: 1, borderColor: 'divider' }}
				data-testid="removal-request-section"
			>
				<Typography variant="h6" component="h2" gutterBottom>
					Remove my account
				</Typography>
				<Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
					{path.managingOrganizationName || 'Your workspace'} created this account, and the
					work in it is that business&apos;s record. So you ask its owners to remove it
					rather than deleting it yourself — and you can do that here.
				</Typography>

				<Divider sx={{ mb: 2 }} />

				{latest ? (
					<Alert
						severity={
							latest.status === 'granted'
								? 'success'
								: latest.status === 'declined'
									? 'warning'
									: 'info'
						}
						sx={{ mb: 2 }}
						data-testid="removal-request-status"
					>
						<AlertTitle>
							{latest.status === 'outstanding'
								? 'Your request is with the workspace owners'
								: latest.status === 'granted'
									? 'Your request was granted'
									: 'Your request was declined'}
						</AlertTitle>
						{latest.status === 'outstanding'
							? 'They have been notified. You keep your access until one of them decides.'
							: latest.status === 'granted'
								? 'You have been removed from this workspace.'
								: 'You can ask again if your situation changes.'}
					</Alert>
				) : null}

				{latest?.status !== 'outstanding' ? (
					<Stack spacing={2}>
						<TextField
							label="Why you would like to be removed (optional)"
							multiline
							minRows={2}
							value={removalNote}
							onChange={(e) => setRemovalNote(e.target.value)}
							disabled={submitting}
							// MUI puts data-testid on the wrapper, not the control, so a
							// test that fills it would be filling a <div>.
							slotProps={{ htmlInput: { 'data-testid': 'removal-request-note' } }}
						/>
						<Box>
							<Button
								variant="contained"
								onClick={handleRequestRemoval}
								disabled={submitting}
								data-testid="removal-request-submit"
							>
								{submitting ? 'Sending…' : 'Request removal'}
							</Button>
						</Box>
					</Stack>
				) : null}

				{error ? (
					<Alert severity="error" sx={{ mt: 2 }}>
						{error}
					</Alert>
				) : null}
			</Paper>
		);
	}

	// --- Self-registered person: full deletion ---
	return (
		<Paper
			sx={{ p: 3, mt: 3, border: 1, borderColor: 'error.light' }}
			data-testid="delete-account-section"
		>
			<Typography variant="h6" component="h2" gutterBottom>
				Delete my account
			</Typography>
			<Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
				This cannot be undone. You will be signed out on every device straight away.
			</Typography>

			{blockedOrgs.length > 0 ? (
				<Alert severity="warning" sx={{ mb: 2 }} data-testid="delete-account-blocked">
					<AlertTitle>
						You are the only owner of{' '}
						{blockedOrgs.length === 1 ? 'a workspace that still has' : 'workspaces that still have'}{' '}
						people in {blockedOrgs.length === 1 ? 'it' : 'them'}
					</AlertTitle>
					<Typography variant="body2" sx={{ mb: 1 }}>
						Deleting now would leave your team without anyone who can run the workspace.
						Make somebody else an owner, or close the workspace, then come back here.
					</Typography>
					<List dense disablePadding>
						{blockedOrgs.map((org) => (
							<ListItem key={org.organizationId} disableGutters sx={{ py: 0.25 }}>
								<ListItemText
									primary={org.organizationName}
									secondary={`${org.memberCount} other ${org.memberCount === 1 ? 'person' : 'people'}`}
								/>
								<Button
									component={Link}
									href="/workspace/organization"
									size="small"
									data-testid={`transfer-ownership-${org.organizationId}`}
								>
									Transfer or close
								</Button>
							</ListItem>
						))}
					</List>
				</Alert>
			) : null}

			<Divider sx={{ mb: 2 }} />

			<Typography variant="subtitle2" gutterBottom>
				What gets deleted
			</Typography>
			<List dense disablePadding sx={{ mb: 2 }} data-testid="delete-account-erased">
				{(preview?.erased ?? []).map((item) => (
					<ListItem key={item.label} disableGutters sx={{ py: 0.25 }}>
						<ListItemText primary={item.label} />
					</ListItem>
				))}
			</List>

			<Typography variant="subtitle2" gutterBottom>
				What stays, and why
			</Typography>
			<List dense disablePadding sx={{ mb: 2 }} data-testid="delete-account-retained">
				{(preview?.retained ?? []).map((item) => (
					<ListItem key={item.label} disableGutters sx={{ py: 0.25 }}>
						<ListItemText primary={item.label} secondary={item.reason} />
					</ListItem>
				))}
			</List>

			{(preview?.organizations ?? []).length > 0 ? (
				<Box sx={{ mb: 2 }}>
					<Typography variant="subtitle2" gutterBottom>
						Workspaces this affects
					</Typography>
					<Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
						{(preview?.organizations ?? []).map((org) => (
							<Chip key={org.organizationId} label={org.organizationName} size="small" />
						))}
					</Stack>
				</Box>
			) : null}

			{error ? (
				<Alert severity="error" sx={{ mb: 2 }} data-testid="delete-account-error">
					{error}
				</Alert>
			) : null}

			<Button
				variant="outlined"
				color="error"
				startIcon={<DeleteForeverIcon />}
				onClick={() => setConfirmOpen(true)}
				disabled={blockedOrgs.length > 0}
				data-testid="delete-account-open"
			>
				Delete my account
			</Button>

			<Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} maxWidth="xs" fullWidth>
				<DialogTitle>Delete your account?</DialogTitle>
				<DialogContent>
					<DialogContentText sx={{ mb: 2 }}>
						This is permanent. Type <strong>{confirmationPhrase}</strong> to confirm.
					</DialogContentText>
					<TextField
						autoFocus
						fullWidth
						value={phrase}
						onChange={(e) => setPhrase(e.target.value)}
						placeholder={confirmationPhrase}
						disabled={submitting}
						slotProps={{ htmlInput: { 'data-testid': 'delete-account-phrase' } }}
					/>
				</DialogContent>
				<DialogActions>
					<Button onClick={() => setConfirmOpen(false)} disabled={submitting}>
						Keep my account
					</Button>
					<Button
						color="error"
						variant="contained"
						onClick={handleDelete}
						disabled={!phraseMatches || submitting}
						data-testid="delete-account-confirm"
					>
						{submitting ? 'Deleting…' : 'Delete'}
					</Button>
				</DialogActions>
			</Dialog>
		</Paper>
	);
}

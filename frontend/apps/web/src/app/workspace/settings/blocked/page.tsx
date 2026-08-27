'use client';

/**
 * Blocked people (Feature 036, FR-024).
 *
 * Shows only the caller's own blocks. There is no equivalent view of who has
 * blocked *you*, and no API that could answer it — that absence is the
 * requirement, not an omission.
 */

import { useCallback, useEffect, useState } from 'react';
import {
	Alert,
	Box,
	Button,
	CircularProgress,
	Container,
	List,
	ListItem,
	ListItemText,
	Paper,
	Typography,
} from '@mui/material';
import BlockIcon from '@mui/icons-material/Block';
import { useRequireAuth } from '@/lib/auth/hooks';
import { listBlockedPeople, unblockPerson, type BlockedPerson } from 'apis';

export default function BlockedPeoplePage() {
	const { isLoading, user } = useRequireAuth();
	const [people, setPeople] = useState<BlockedPerson[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [busyId, setBusyId] = useState<string | null>(null);

	const load = useCallback(async () => {
		setError('');
		try {
			const resp = await listBlockedPeople();
			setPeople(resp.blocked);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Could not load your blocked list.');
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const unblock = async (employeeId: string) => {
		setBusyId(employeeId);
		setError('');
		try {
			await unblockPerson(employeeId);
			await load();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Could not unblock that person.');
		} finally {
			setBusyId(null);
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
		<Container maxWidth="sm" sx={{ py: 4 }}>
			<Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
				<BlockIcon sx={{ fontSize: 32, color: 'primary.main' }} />
				<Box>
					<Typography variant="h4" component="h1">
						Blocked people
					</Typography>
					<Typography variant="body2" color="text.secondary">
						They cannot start a direct conversation or call you. Nobody is told they
						were blocked.
					</Typography>
				</Box>
			</Box>

			<Alert severity="info" sx={{ mb: 3 }}>
				A blocked colleague stays in the same work channels as you, and you still see what
				they post there — so instructions meant for you cannot be hidden.
			</Alert>

			{error ? (
				<Alert severity="error" sx={{ mb: 2 }} data-testid="blocked-error">
					{error}
				</Alert>
			) : null}

			<Paper sx={{ border: 1, borderColor: 'divider' }}>
				{loading ? (
					<Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
						<CircularProgress size={24} />
					</Box>
				) : people.length === 0 ? (
					<Box sx={{ p: 4, textAlign: 'center' }}>
						<Typography variant="body2" color="text.secondary" data-testid="blocked-empty">
							You haven&apos;t blocked anyone.
						</Typography>
					</Box>
				) : (
					<List disablePadding data-testid="blocked-list">
						{people.map((person) => (
							<ListItem
								key={person.blockId}
								divider
								data-testid={`blocked-row-${person.employeeId}`}
								secondaryAction={
									<Button
										size="small"
										onClick={() => void unblock(person.employeeId)}
										disabled={busyId === person.employeeId}
										data-testid={`blocked-unblock-${person.employeeId}`}
									>
										{busyId === person.employeeId ? 'Unblocking…' : 'Unblock'}
									</Button>
								}
							>
								<ListItemText primary={person.displayName || person.employeeId} secondary={person.email} />
							</ListItem>
						))}
					</List>
				)}
			</Paper>
		</Container>
	);
}

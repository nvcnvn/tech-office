/**
 * UserProfile Component
 * Displays authenticated user information with avatar and details
 */

'use client';

import { Box, Avatar, Typography, Chip, Card, CardContent } from '@mui/material';
import type { UserProfile as UserProfileType } from '@/lib/auth/types';

export interface UserProfileProps {
	user: UserProfileType;
	variant?: 'card' | 'inline';
	showDetails?: boolean;
}

export function UserProfile({
	user,
	variant = 'card',
	showDetails = true
}: UserProfileProps) {
	if (variant === 'inline') {
		return (
			<Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
				<Avatar src={user.picture} alt={user.name} sx={{ width: 40, height: 40 }}>
					{user.name?.[0]?.toUpperCase() || 'U'}
				</Avatar>
				<Box>
					<Typography variant="body2" fontWeight={600}>{user.name}</Typography>
					<Typography variant="caption" color="text.secondary">{user.email}</Typography>
				</Box>
			</Box>
		);
	}

	return (
		<Card>
			<CardContent>
				<Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: showDetails ? 3 : 0 }}>
					<Avatar src={user.picture} alt={user.name} sx={{ width: 64, height: 64 }}>
						{user.name?.[0]?.toUpperCase() || 'U'}
					</Avatar>
					<Box>
						<Typography variant="h6">{user.name}</Typography>
						<Typography variant="body2" color="text.secondary">{user.email}</Typography>
					</Box>
				</Box>

				{showDetails && (
					<Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
						{user.organizationName && (
							<Box>
								<Typography variant="caption" color="text.secondary">Organization</Typography>
								<Typography variant="body2">{user.organizationName}</Typography>
							</Box>
						)}
						{user.roleNames && user.roleNames.length > 0 && (
							<Box>
								<Typography variant="caption" color="text.secondary">Role</Typography>
								<Chip label={user.roleNames.join(', ')} size="small" variant="outlined" sx={{ mt: 0.5 }} />
							</Box>
						)}
					</Box>
				)}
			</CardContent>
		</Card>
	);
}

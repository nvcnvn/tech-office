/**
 * UserMenu Component
 * Dropdown menu for user actions (profile, settings, logout)
 * 
 * Features:
 * - User avatar/initials display
 * - Dropdown menu with user actions
 * - Settings navigation
 * - Logout functionality
 * - Keyboard navigation support
 */

'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Menu, MenuItem, ListItemIcon, ListItemText, Divider, Avatar } from '@mui/material';
import { Settings, Logout, Person, Explore } from '@mui/icons-material';
import type { UserProfile } from '@/lib/auth/types';
import { useAuth } from '@/lib/auth/hooks';
import { useTourController } from '@/components/tour/TourProvider';

interface UserMenuProps {
	user: UserProfile;
}

/**
 * UserMenu component
 * Displays user avatar and dropdown menu with actions
 * 
 * @example
 * ```tsx
 * <UserMenu user={currentUser} />
 * ```
 */
export function UserMenu({ user }: UserMenuProps) {
	const router = useRouter();
	const { logout } = useAuth();
	const tour = useTourController();
	const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
	const open = Boolean(anchorEl);

	const handleClick = (event: React.MouseEvent<HTMLElement>) => {
		setAnchorEl(event.currentTarget);
	};

	const handleClose = () => {
		setAnchorEl(null);
	};

	const handleSettings = () => {
		handleClose();
		router.push('/workspace/settings');
	};

	const handleProfile = () => {
		handleClose();
		router.push('/workspace/profile');
	};

	// FR-017: available whether or not the tour was ever finished or dismissed. Restart
	// writes in_progress at stop 0, so a completed tour becomes offerable again — which is
	// the point: the person asked for it.
	const handleTakeTour = () => {
		handleClose();
		tour?.restart();
	};

	const handleLogout = async () => {
		handleClose();
		await logout();
		router.push('/signin');
	};

	// Get user initials for avatar fallback
	const getUserInitials = () => {
		if (!user.name) return 'U';
		const parts = user.name.split(' ');
		if (parts.length === 1) return parts[0][0]?.toUpperCase() || 'U';
		return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
	};

	return (
		<>
			<Avatar
				onClick={handleClick}
				src={user.picture}
				alt={user.name || 'User'}
				sx={{
					width: 32,
					height: 32,
					cursor: 'pointer',
					bgcolor: 'primary.main',
					fontSize: '0.875rem',
					fontWeight: 500,
					'&:hover': {
						opacity: 0.8,
					},
				}}
				data-testid="user-menu-avatar"
				aria-controls={open ? 'user-menu' : undefined}
				aria-haspopup="true"
				aria-expanded={open ? 'true' : undefined}
			>
				{!user.picture && getUserInitials()}
			</Avatar>

			<Menu
				id="user-menu"
				anchorEl={anchorEl}
				open={open}
				onClose={handleClose}
				MenuListProps={{
					'aria-labelledby': 'user-menu-avatar',
				}}
				anchorOrigin={{
					vertical: 'bottom',
					horizontal: 'right',
				}}
				transformOrigin={{
					vertical: 'top',
					horizontal: 'right',
				}}
			>
				{/* User Info Header */}
				<MenuItem disabled sx={{ opacity: 1 }}>
					<ListItemIcon>
						<Avatar
							src={user.picture}
							alt={user.name || 'User'}
							sx={{ width: 32, height: 32 }}
						>
							{getUserInitials()}
						</Avatar>
					</ListItemIcon>
					<ListItemText
						primary={user.name || 'User'}
						secondary={user.email}
						primaryTypographyProps={{ fontWeight: 600 }}
					/>
				</MenuItem>

				<Divider />

				{/* Take the tour — the on-demand entry point (FR-017) */}
				{tour?.tour && tour.tour.stops.length > 0 ? (
					<MenuItem onClick={handleTakeTour} data-testid="user-menu-take-the-tour">
						<ListItemIcon>
							<Explore fontSize="small" />
						</ListItemIcon>
						<ListItemText>Take the tour</ListItemText>
					</MenuItem>
				) : null}

				{/* Profile */}
				<MenuItem onClick={handleProfile} data-testid="user-menu-profile">
					<ListItemIcon>
						<Person fontSize="small" />
					</ListItemIcon>
					<ListItemText>Profile</ListItemText>
				</MenuItem>

				{/* Settings */}
				<MenuItem onClick={handleSettings} data-testid="user-menu-settings">
					<ListItemIcon>
						<Settings fontSize="small" />
					</ListItemIcon>
					<ListItemText>Settings</ListItemText>
				</MenuItem>

				<Divider />

				{/* Logout */}
				<MenuItem onClick={handleLogout} data-testid="user-menu-logout">
					<ListItemIcon>
						<Logout fontSize="small" />
					</ListItemIcon>
					<ListItemText>Logout</ListItemText>
				</MenuItem>
			</Menu>
		</>
	);
}

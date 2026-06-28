'use client';

/**
 * UserAvatar — avatar circle with an optional presence status dot.
 *
 * Renders an MUI Avatar with:
 * - Profile picture when `user.avatarUrl` is available.
 * - Two-letter initials (given + family) when no picture is set.
 * - A stable colour derived from the employee ID (so the same person always
 *   gets the same colour across sessions).
 * - An optional presence dot positioned at the bottom-right via MUI Badge.
 *
 * This component is intentionally presentational — it does NOT fetch any data.
 * Data fetching is handled by `useUserProfile` and `usePresenceStatus` above it
 * in the tree.
 */

import React from 'react';
import { Avatar, Badge, Tooltip } from '@mui/material';
import type { SxProps, Theme } from '@mui/material';
import type { UserInfo, UserAvatarSize } from './types';
import { AVATAR_SIZE_PX } from './types';
import type { PresenceStatus } from 'apis';

// ─── Colour palette ───────────────────────────────────────────────────────────

const AVATAR_PALETTE = [
	'#6366f1', // indigo
	'#8b5cf6', // violet
	'#ec4899', // pink
	'#ef4444', // red
	'#f59e0b', // amber
	'#10b981', // emerald
	'#06b6d4', // cyan
	'#3b82f6', // blue
	'#84cc16', // lime
	'#f97316', // orange
];

/**
 * Deterministically pick a colour from the palette based on the employee ID.
 * The same ID always produces the same colour — no random flashing on re-render.
 */
function pickAvatarColor(id: string): string {
	let hash = 5381;
	for (let i = 0; i < id.length; i++) {
		hash = ((hash << 5) + hash + id.charCodeAt(i)) & 0x7fffffff;
	}
	return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

// ─── Initials ────────────────────────────────────────────────────────────────

function deriveInitials(user: UserInfo | undefined, employeeId: string): string {
	if (user?.givenName && user.familyName) {
		return `${user.givenName[0]}${user.familyName[0]}`.toUpperCase();
	}
	if (user?.displayName) {
		const parts = user.displayName.trim().split(/\s+/);
		return parts.length >= 2
			? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
			: user.displayName.slice(0, 2).toUpperCase();
	}
	// Fallback: first two hex chars of the ID (always available)
	return employeeId.replace(/-/g, '').slice(0, 2).toUpperCase();
}

// ─── Presence dot color ───────────────────────────────────────────────────────

function presenceDotColor(status: PresenceStatus): string | null {
	switch (status) {
		case 'online':
			return '#10b981'; // green
		case 'idle':
			return '#f59e0b'; // amber
		case 'offline':
			return '#9ca3af'; // gray
		case 'online_hidden':
		case 'unspecified':
		default:
			return null; // no dot shown
	}
}

function presenceLabel(status: PresenceStatus): string {
	switch (status) {
		case 'online':
			return 'Online';
		case 'idle':
			return 'Idle';
		case 'offline':
			return 'Offline';
		default:
			return '';
	}
}

// ─── Dot size per avatar size ─────────────────────────────────────────────────

const DOT_SIZE_PX: Record<UserAvatarSize, number> = {
	xs: 7,
	sm: 9,
	md: 11,
	lg: 13,
};

// ─── Component ────────────────────────────────────────────────────────────────

export interface UserAvatarProps {
	/**
	 * The employee ID — always required.
	 * Used as cache key, colour seed and fallback initials source.
	 */
	employeeId: string;
	/** Resolved user data from the profile cache (may be undefined). */
	user: UserInfo | undefined;
	/** Avatar circle size. Defaults to 'md' (40 px). */
	size?: UserAvatarSize;
	/** Current presence status. Requires `showPresence` to be visible. */
	presenceStatus?: PresenceStatus;
	/** Show the presence dot. Defaults to false. */
	showPresence?: boolean;
	/** Extra sx styles applied to the Avatar itself. */
	sx?: SxProps<Theme>;
}

export function UserAvatar({
	employeeId,
	user,
	size = 'md',
	presenceStatus,
	showPresence = false,
	sx,
}: UserAvatarProps) {
	const sizePx = AVATAR_SIZE_PX[size];
	const dotSize = DOT_SIZE_PX[size];

	const fontSize =
		sizePx <= 24 ? '0.6rem' : sizePx <= 32 ? '0.72rem' : sizePx <= 40 ? '0.85rem' : '1rem';

	const bgColor = pickAvatarColor(user?.id ?? employeeId);
	const initials = deriveInitials(user, employeeId);

	const avatar = (
		<Avatar
			src={user?.avatarUrl}
			alt={user?.displayName ?? user?.givenName ?? ''}
			sx={{
				width: sizePx,
				height: sizePx,
				fontSize,
				bgcolor: bgColor,
				flexShrink: 0,
				...sx,
			}}
		>
			{initials}
		</Avatar>
	);

	if (!showPresence || !presenceStatus) return avatar;

	const dotColor = presenceDotColor(presenceStatus);

	// If no dot color (e.g., online_hidden / unspecified), skip the badge.
	if (!dotColor) return avatar;

	return (
		<Badge
			overlap="circular"
			anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
			badgeContent={
				<Tooltip title={presenceLabel(presenceStatus)} arrow placement="top">
					<span
						style={{
							display: 'block',
							width: dotSize,
							height: dotSize,
							borderRadius: '50%',
							backgroundColor: dotColor,
							border: '2px solid white',
							boxSizing: 'content-box',
						}}
					/>
				</Tooltip>
			}
		>
			{avatar}
		</Badge>
	);
}

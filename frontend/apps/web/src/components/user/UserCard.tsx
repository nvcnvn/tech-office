'use client';

/**
 * UserCard — reusable employee identity widget.
 *
 * ## Responsibilities
 * - Combines avatar, display name, secondary info (email / department), and an
 *   optional presence dot into a single cohesive unit.
 * - Reads display data from `useUserProfile` (React-Query backed, 10 s TTL).
 * - Accepts optional `userInfo` prop so callers who already have the data can
 *   skip a cache lookup and seed the cache at the same time.
 * - Fetches presence status lazily (only when `showPresence` is true) and
 *   reacts to real-time SSE push events.
 * - Degrades gracefully — renders colour-coded initials when no profile data is
 *   cached yet.
 *
 * ## Variant guide
 *
 * | Variant      | Content                                | Typical contexts                        |
 * |--------------|----------------------------------------|-----------------------------------------|
 * | avatar-only  | Avatar + presence dot                  | AvatarGroup in task assignee rows       |
 * | compact      | Avatar · single-line name              | Chat DM sidebar, task assignee pill     |
 * | standard     | Avatar · name + secondary text         | Search results, @mention autocomplete   |
 * | full         | Avatar · name + dept + email + badge   | Org member list, org structure tree     |
 *
 * ## Cache seeding example (org member list)
 * ```tsx
 * const populate = usePopulateUserCache();
 * useEffect(() => {
 *   populate(employees.map(e => ({ id: e.id, givenName: e.givenName, ... })));
 * }, [employees]);
 *
 * // Then in the render each row just needs the ID:
 * <UserCard employeeId={emp.id} variant="full" showPresence />
 * ```
 */

import React, { useEffect, useState } from 'react';
import { Box, Skeleton, Tooltip, Typography } from '@mui/material';
import type { SxProps, Theme } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { getEmployeePresence, type PresenceStatus } from 'apis';
import type { UserInfo, UserAvatarSize, UserCardVariant } from './types';
import { AVATAR_SIZE_PX } from './types';
import { useUserProfile } from './useUserProfile';
import { UserAvatar } from './UserAvatar';

// ─── Internal presence hook ───────────────────────────────────────────────────

/**
 * Fetches and subscribes to an employee's presence status.
 * Uses React Query for caching + deduplication across many card instances,
 * then patches the cache whenever an SSE push event arrives.
 */
function usePresenceStatus(employeeId: string, enabled: boolean): PresenceStatus {
	const queryClient = useQueryClient();
	const [status, setStatus] = useState<PresenceStatus>('unspecified');

	// Initial fetch
	useEffect(() => {
		if (!enabled) return;
		let alive = true;
		getEmployeePresence(employeeId)
			.then((p) => {
				if (alive && p) setStatus(p.status);
			})
			.catch(() => {
				/* silently ignore — show unspecified */
			});
		return () => {
			alive = false;
		};
	}, [employeeId, enabled]);

	// React to real-time SSE events broadcast by the notification stream
	useEffect(() => {
		if (!enabled) return;
		const handler = (event: CustomEvent) => {
			const { employeeId: updatedId, status: newStatus } = event.detail ?? {};
			if (updatedId === employeeId && newStatus) {
				setStatus(newStatus as PresenceStatus);
				// Also update the shared React Query cache so other components benefit
				queryClient.setQueryData(
					['employeePresence', employeeId],
					(prev: unknown) =>
						prev ? { ...(prev as object), status: newStatus } : prev,
				);
			}
		};
		window.addEventListener('presence-update', handler as EventListener);
		return () => window.removeEventListener('presence-update', handler as EventListener);
	}, [employeeId, enabled, queryClient]);

	return status;
}

// ─── Default avatar size per variant ─────────────────────────────────────────

const DEFAULT_SIZE: Record<UserCardVariant, UserAvatarSize> = {
	'avatar-only': 'md',
	compact: 'sm',
	standard: 'md',
	full: 'lg',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function displayName(user: UserInfo | undefined): string {
	if (!user) return '';
	if (user.displayName) return user.displayName;
	if (user.givenName || user.familyName)
		return `${user.givenName ?? ''} ${user.familyName ?? ''}`.trim();
	if (user.email) return user.email;
	return '';
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface UserCardProps {
	/**
	 * Employee UUID — required as the cache key and presence fetch target.
	 */
	employeeId: string;
	/**
	 * Pre-loaded display data.  When provided the component renders immediately
	 * and seeds the React Query cache so other `UserCard` instances for the same
	 * employee also resolve.
	 */
	userInfo?: Partial<Omit<UserInfo, 'id'>>;
	/**
	 * Visual layout.  Defaults to 'standard'.
	 */
	variant?: UserCardVariant;
	/**
	 * Show presence dot on the avatar.  Defaults to false.
	 * The component fetches presence lazily when this is true.
	 */
	showPresence?: boolean;
	/**
	 * Override the avatar size inferred from `variant`.
	 */
	avatarSize?: UserAvatarSize;
	/**
	 * Click handler for the whole card.  On non-null value the cursor becomes
	 * a pointer and the card gains a hover highlight.
	 */
	onClick?: React.MouseEventHandler<HTMLDivElement>;
	/**
	 * Extra sx styles applied to the root element.
	 */
	sx?: SxProps<Theme>;
	/**
	 * Forwarded to the root element for testing.
	 */
	'data-testid'?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function UserCard({
	employeeId,
	userInfo,
	variant = 'standard',
	showPresence = false,
	avatarSize,
	onClick,
	sx,
	'data-testid': testId,
}: UserCardProps) {
	// Resolve display data from cache, optionally seeding it with `userInfo`
	const user = useUserProfile(employeeId, userInfo);
	const presenceStatus = usePresenceStatus(employeeId, showPresence);

	const size = avatarSize ?? DEFAULT_SIZE[variant];
	const sizePx = AVATAR_SIZE_PX[size];
	const isClickable = !!onClick;

	// ── avatar-only ───────────────────────────────────────────────────────────
	if (variant === 'avatar-only') {
		return (
			<Tooltip title={displayName(user) || employeeId} arrow placement="top">
				<Box
					component="span"
					onClick={onClick}
					data-testid={testId}
					sx={{
						display: 'inline-flex',
						cursor: isClickable ? 'pointer' : 'default',
						...sx,
					}}
				>
					<UserAvatar
						employeeId={employeeId}
						user={user}
						size={size}
						presenceStatus={presenceStatus}
						showPresence={showPresence}
					/>
				</Box>
			</Tooltip>
		);
	}

	// ── compact ───────────────────────────────────────────────────────────────
	if (variant === 'compact') {
		const name = displayName(user);
		return (
			<Box
				onClick={onClick}
				data-testid={testId}
				sx={{
					display: 'inline-flex',
					alignItems: 'center',
					gap: 1,
					minWidth: 0,
					cursor: isClickable ? 'pointer' : 'inherit',
					borderRadius: 1,
					px: isClickable ? 0.5 : 0,
					py: isClickable ? 0.25 : 0,
					'&:hover': isClickable
						? { bgcolor: 'action.hover' }
						: undefined,
					...sx,
				}}
			>
				<UserAvatar
					employeeId={employeeId}
					user={user}
					size={size}
					presenceStatus={presenceStatus}
					showPresence={showPresence}
				/>
				{name ? (
					<Typography
						variant="body2"
						noWrap
						sx={{ fontWeight: 500, maxWidth: 160 }}
					>
						{name}
					</Typography>
				) : (
					<Skeleton variant="text" width={80} height={sizePx * 0.5} />
				)}
			</Box>
		);
	}

	// ── standard ──────────────────────────────────────────────────────────────
	if (variant === 'standard') {
		const name = displayName(user);
		const secondary =
			user?.email ??
			(user?.departmentName ? user.departmentName : undefined);

		return (
			<Box
				onClick={onClick}
				data-testid={testId}
				sx={{
					display: 'flex',
					alignItems: 'center',
					gap: 1.5,
					minWidth: 0,
					cursor: isClickable ? 'pointer' : 'inherit',
					borderRadius: 1,
					px: isClickable ? 0.75 : 0,
					py: isClickable ? 0.5 : 0,
					'&:hover': isClickable ? { bgcolor: 'action.hover' } : undefined,
					...sx,
				}}
			>
				<UserAvatar
					employeeId={employeeId}
					user={user}
					size={size}
					presenceStatus={presenceStatus}
					showPresence={showPresence}
				/>
				<Box sx={{ minWidth: 0, flex: 1 }}>
					{name ? (
						<Typography variant="body2" noWrap fontWeight={500}>
							{name}
						</Typography>
					) : (
						<Skeleton variant="text" width={120} height={18} />
					)}
					{secondary ? (
						<Typography
							variant="caption"
							noWrap
							color="text.secondary"
							display="block"
						>
							{secondary}
						</Typography>
					) : user === undefined ? (
						<Skeleton variant="text" width={80} height={14} />
					) : null}
				</Box>
			</Box>
		);
	}

	// ── full ──────────────────────────────────────────────────────────────────
	const name = displayName(user);
	const fullName =
		user?.givenName && user?.familyName
			? `${user.givenName} ${user.familyName}`
			: name;

	return (
		<Box
			onClick={onClick}
			data-testid={testId}
			sx={{
				display: 'flex',
				alignItems: 'center',
				gap: 2,
				minWidth: 0,
				cursor: isClickable ? 'pointer' : 'inherit',
				borderRadius: 1,
				px: isClickable ? 1 : 0,
				py: isClickable ? 0.75 : 0,
				'&:hover': isClickable ? { bgcolor: 'action.hover' } : undefined,
				...sx,
			}}
		>
			<UserAvatar
				employeeId={employeeId}
				user={user}
				size={size}
				presenceStatus={presenceStatus}
				showPresence={showPresence}
			/>
			<Box sx={{ minWidth: 0, flex: 1 }}>
				{fullName ? (
					<Typography variant="body1" noWrap fontWeight={600}>
						{fullName}
					</Typography>
				) : (
					<Skeleton variant="text" width={140} height={20} />
				)}

				{/* Department / team */}
				{user?.departmentName ? (
					<Typography
						variant="caption"
						noWrap
						color="text.secondary"
						display="block"
					>
						{user.departmentName}
					</Typography>
				) : user === undefined ? (
					<Skeleton variant="text" width={90} height={14} />
				) : null}

				{/* Email */}
				{user?.email ? (
					<Typography
						variant="caption"
						noWrap
						color="text.secondary"
						display="block"
					>
						{user.email}
					</Typography>
				) : user === undefined ? (
					<Skeleton variant="text" width={120} height={14} />
				) : null}

				{/* Inactive badge */}
				{user?.isActive === false && (
					<Typography
						variant="caption"
						sx={{
							display: 'inline-block',
							mt: 0.25,
							px: 0.75,
							py: 0.125,
							borderRadius: 0.5,
							bgcolor: 'action.disabledBackground',
							color: 'text.disabled',
							fontSize: '0.65rem',
							fontWeight: 600,
							textTransform: 'uppercase',
							letterSpacing: '0.05em',
						}}
					>
						Inactive
					</Typography>
				)}
			</Box>
		</Box>
	);
}

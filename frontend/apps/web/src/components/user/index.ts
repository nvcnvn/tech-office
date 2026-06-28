/**
 * User display component system — barrel export.
 *
 * ## Quick-start
 *
 * ```tsx
 * import { UserCard, usePopulateUserCache } from '@/components/user';
 *
 * // 1. Seed the cache when a page loads its employee list
 * const populate = usePopulateUserCache();
 * useEffect(() => {
 *   populate(employees.map(e => ({
 *     id: e.id,
 *     givenName: e.givenName,
 *     familyName: e.familyName,
 *     email: e.email,
 *     departmentName: e.departmentName,
 *   })));
 * }, [employees]);
 *
 * // 2. Render anywhere with just the ID
 * <UserCard employeeId={emp.id} variant="full" showPresence />
 *
 * // 3. For a task assignee pill (only ID is known)
 * <UserCard employeeId={task.assignees[0].employeeId} variant="compact" showPresence />
 *
 * // 4. Org structure tree — full layout, no presence
 * <UserCard employeeId={node.managerId} variant="full" />
 *
 * // 5. AvatarGroup inside a board card
 * <AvatarGroup max={3}>
 *   {assignees.map(a => (
 *     <UserAvatar key={a.employeeId} employeeId={a.employeeId} user={undefined} size="xs" />
 *   ))}
 * </AvatarGroup>
 * ```
 */

// ─── Types ────────────────────────────────────────────────────────────────────
export type { UserInfo, UserAvatarSize, UserCardVariant } from './types';
export { AVATAR_SIZE_PX } from './types';

// ─── Cache hook ───────────────────────────────────────────────────────────────
export { useUserProfile, usePopulateUserCache, usePreloadOrgUsers, userProfileQueryKey } from './useUserProfile';

// ─── Presentational building block ───────────────────────────────────────────
export { UserAvatar } from './UserAvatar';
export type { UserAvatarProps } from './UserAvatar';

// ─── Primary composite component ─────────────────────────────────────────────
export { UserCard } from './UserCard';
export type { UserCardProps } from './UserCard';

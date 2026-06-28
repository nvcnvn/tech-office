/**
 * UserInfo — shared data type for all user display components.
 *
 * All fields except `id` are optional so the component degrades gracefully
 * when only a partial payload is available (e.g., task assignee that only
 * carries an employeeId).
 */
export interface UserInfo {
	/** Employee UUID */
	id: string;
	/**
	 * Preferred display name (e.g., "John D." or a chosen username).
	 * Falls back to "givenName familyName" when rendering.
	 */
	displayName?: string;
	/** Given (first) name */
	givenName?: string;
	/** Family (last) name */
	familyName?: string;
	/** Primary email address */
	email?: string;
	/** Profile picture URL. Shows initials avatar when absent. */
	avatarUrl?: string;
	/** Whether the account is currently active */
	isActive?: boolean;
	/** Department / team name (e.g., "Engineering" or "Sales") */
	departmentName?: string;
}

// ─── Size / variant tokens ────────────────────────────────────────────────────

/**
 * Size tokens for the avatar circle.
 *
 * xs  24px  — avatar-group, inline chips
 * sm  32px  — compact row (chat sidebar, task pill)
 * md  40px  — standard row (search results, mentions)
 * lg  56px  — full card (org tree, member list)
 */
export type UserAvatarSize = 'xs' | 'sm' | 'md' | 'lg';

/** Pixel dimensions for each size token. */
export const AVATAR_SIZE_PX: Record<UserAvatarSize, number> = {
	xs: 24,
	sm: 32,
	md: 40,
	lg: 56,
};

/**
 * Layout variants for `UserCard`.
 *
 * | Variant     | Shows                                         | Typical use-case                         |
 * |-------------|-----------------------------------------------|------------------------------------------|
 * | avatar-only | Avatar + presence dot only                    | AvatarGroup in task assignees            |
 * | compact     | Avatar · Display name (single line)           | Chat sidebar DMs, task assignee chip     |
 * | standard    | Avatar · Full name + email/secondary          | Search results, @mention list            |
 * | full        | Avatar · Full name + department + email badge | Org member list, org structure tree      |
 */
export type UserCardVariant = 'avatar-only' | 'compact' | 'standard' | 'full';

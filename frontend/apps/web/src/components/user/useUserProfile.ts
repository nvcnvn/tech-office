/**
 * useUserProfile — React Query backed cache for user display data.
 *
 * ## Design
 * Data is fetched on-demand via `GetEmployeeCards` RPC when the cache is cold.
 * Callers that already hold employee lists can seed the cache eagerly with
 * `usePopulateUserCache()` to avoid per-component fetches.
 *
 * ## Cache lifetime
 * Each entry is kept "fresh" for 10 s (STALE_TIME).  The query client's GC
 * window is 60 s, so entries survive short navigations without re-fetching.
 *
 * ## Reactive updates
 * `queryClient.setQueryData()` notifies every component that subscribes to the
 * same key.  So bulk-seeding from a list will immediately update all mounted
 * UserCard instances.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { getEmployeeCards, listEmployees } from 'apis';
import type { UserInfo } from './types';

const STALE_TIME = 10_000; // 10 seconds
const GC_TIME = 60_000; // 60 seconds

export function userProfileQueryKey(id: string) {
	return ['userProfile', id] as const;
}

/**
 * Read a user's display data from the React Query cache.
 *
 * Returns `undefined` while the cache has no entry for `employeeId`.
 * Components should render an initials/skeleton fallback in that case.
 *
 * @param employeeId  UUID of the employee whose data is needed.
 * @param seedData    Optional partial data to prime the cache on first mount.
 *                    Useful when the parent passes props it already has
 *                    (e.g., `givenName`/`familyName` from a list response).
 */
export function useUserProfile(
	employeeId: string,
	seedData?: Partial<Omit<UserInfo, 'id'>>,
): UserInfo | undefined {
	const queryClient = useQueryClient();

	// Seed the cache on first render if seedData was supplied and the cache
	// entry doesn't exist yet.  We must not overwrite fresher data.
	useEffect(() => {
		if (!seedData || Object.keys(seedData).length === 0) return;
		queryClient.setQueryData<UserInfo>(
			userProfileQueryKey(employeeId),
			(prev) => prev ?? { id: employeeId, ...seedData },
		);
	}, [employeeId, seedData, queryClient]);

	const { data } = useQuery<UserInfo | undefined>({
		queryKey: userProfileQueryKey(employeeId),
		// Auto-fetch via GetEmployeeCards when cache is empty or stale.
		queryFn: async () => {
			const cards = await getEmployeeCards([employeeId]);
			const card = cards.find(c => c.id === employeeId);
			if (!card) return undefined;
			return {
				id: card.id,
				givenName: card.givenName,
				familyName: card.familyName,
				email: card.email,
				isActive: card.isActive,
				departmentName: card.departmentName,
			} satisfies UserInfo;
		},
		enabled: !!employeeId,
		staleTime: STALE_TIME,
		gcTime: GC_TIME,
	});

	return data;
}

/**
 * Returns a stable function that writes one or more UserInfo records into the
 * React Query cache.  Call this from list or detail pages that already hold
 * employee data so that every `UserCard` rendered later will resolve instantly.
 *
 * @example
 * ```tsx
 * const populateCache = usePopulateUserCache();
 *
 * // After fetching department members:
 * useEffect(() => {
 *   if (members) populateCache(members.map(m => ({
 *     id: m.employeeId,
 *     givenName: m.employeeFirstName,
 *     familyName: m.employeeLastName,
 *     email: m.employeeEmail,
 *   })));
 * }, [members]);
 * ```
 */
export function usePopulateUserCache(): (users: UserInfo | UserInfo[]) => void {
	const queryClient = useQueryClient();
	return useCallback(
		(users: UserInfo | UserInfo[]) => {
			const list = Array.isArray(users) ? users : [users];
			list.forEach((user) => {
				queryClient.setQueryData<UserInfo>(
					userProfileQueryKey(user.id),
					// Prefer incoming data — it may be fresher than what's cached.
					(prev) => (prev ? { ...prev, ...user } : user),
				);
			});
		},
		[queryClient],
	);
}

/**
 * Fetches all employees for the given organization and seeds the UserCard cache.
 * Call this on any page that renders UserCard instances but doesn't have a list
 * response to seed from (e.g. the task detail page, which only knows employee IDs).
 *
 * The underlying React Query entry is shared across all callers for the same
 * `organizationId`, so navigating between pages will not trigger redundant fetches.
 *
 * @param organizationId  The org UUID from `useRequireAuth().user.organizationId`.
 *                        Pass `undefined` while auth is still loading.
 */
export function usePreloadOrgUsers(organizationId: string | undefined) {
	const populateCache = usePopulateUserCache();

	useQuery({
		queryKey: ['orgUsersPreload', organizationId],
		queryFn: async () => {
			if (!organizationId) return [];
			const resp = await listEmployees(organizationId, { pageNumber: 1, pageSize: 500 });
			populateCache(
				resp.employees.map((e) => ({
					id: e.id,
					givenName: e.givenName,
					familyName: e.familyName,
					email: e.email,
					isActive: e.isActive,
				})),
			);
			return resp.employees;
		},
		enabled: !!organizationId,
		staleTime: STALE_TIME,
		gcTime: GC_TIME,
	});
}

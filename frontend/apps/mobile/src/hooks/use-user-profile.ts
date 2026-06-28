/**
 * useUserProfile — React Query backed cache for user display data.
 *
 * Fetches employee display data via GetEmployeeCards RPC when cache is cold.
 * Callers that already hold employee data can seed the cache with
 * usePopulateUserCache() to avoid per-component fetches.
 */

import { useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getEmployeeCards } from "apis";

export interface UserInfo {
  id: string;
  displayName?: string;
  givenName?: string;
  familyName?: string;
  email?: string;
  avatarUrl?: string;
  isActive?: boolean;
  departmentName?: string;
}

const STALE_TIME = 10_000;
const GC_TIME = 60_000;

export function userProfileQueryKey(id: string) {
  return ["userProfile", id] as const;
}

export function useUserProfile(
  employeeId: string | undefined | null,
  seedData?: Partial<Omit<UserInfo, "id">>,
): UserInfo | undefined {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!employeeId || !seedData || Object.keys(seedData).length === 0) return;
    queryClient.setQueryData<UserInfo>(
      userProfileQueryKey(employeeId),
      (prev) => prev ?? { id: employeeId, ...seedData },
    );
  }, [employeeId, seedData, queryClient]);

  const { data } = useQuery<UserInfo | undefined>({
    queryKey: userProfileQueryKey(employeeId ?? ""),
    queryFn: async () => {
      const cards = await getEmployeeCards([employeeId!]);
      const card = cards.find((c) => c.id === employeeId);
      if (!card) return undefined;
      return {
        id: card.id,
        givenName: card.givenName,
        familyName: card.familyName,
        email: card.email,
        isActive: card.isActive,
        departmentName: card.departmentName,
      };
    },
    enabled: !!employeeId,
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
  });

  return data;
}

export function usePopulateUserCache() {
  const queryClient = useQueryClient();

  return useCallback(
    (users: UserInfo[]) => {
      for (const user of users) {
        queryClient.setQueryData<UserInfo>(
          userProfileQueryKey(user.id),
          (prev) => prev ?? user,
        );
      }
    },
    [queryClient],
  );
}

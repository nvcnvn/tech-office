/**
 * Directory hooks shared by the People list and the department member list.
 *
 * The two screens differ only in which department they ask for, so the paging, the cache
 * seeding and the self-routing live here rather than being written twice and drifting.
 */

import { useCallback } from "react";
import { useRouter } from "expo-router";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { listDirectory, type DirectoryEntry } from "apis";
import { usePopulateUserCache } from "@/hooks/use-user-profile";
import { withNavigationContext } from "@/lib/mobile-navigation";

export function useDirectoryList(departmentId?: string, query = "") {
  return useInfiniteQuery({
    queryKey: ["directory", departmentId ?? null, query],
    queryFn: ({ pageParam }) =>
      listDirectory({ departmentId, query, cursor: pageParam || undefined }),
    initialPageParam: "",
    // An empty cursor means the last page, which is what stops the list asking again.
    getNextPageParam: (lastPage) => lastPage.nextCursor || undefined,
  });
}

/**
 * Opens a person, seeding the caches their entry and every avatar in the app read from,
 * so the entry screen paints before its own fetch resolves.
 */
export function useOpenPerson() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const populateUserCache = usePopulateUserCache();

  return useCallback(
    (entry: DirectoryEntry, backLabel: string, parentHref: string) => {
      queryClient.setQueryData(["directory-entry", entry.employeeId], entry);
      populateUserCache([
        {
          id: entry.employeeId,
          givenName: entry.givenName,
          familyName: entry.familyName,
          email: entry.email,
          departmentName: entry.departmentName,
          isActive: true,
        },
      ]);

      // The caller's own row leads to the profile they can actually edit, not to a
      // read-only copy of themselves offering to ring their own phone.
      if (entry.isSelf) {
        router.push("/(app)/(more)/profile");
        return;
      }

      router.push(
        withNavigationContext(`/(app)/(more)/people/${entry.employeeId}`, {
          parentHref,
          fallbackHref: "/(app)/(more)",
          ownerTab: "more",
          backLabel,
        }) as never,
      );
    },
    [populateUserCache, queryClient, router],
  );
}

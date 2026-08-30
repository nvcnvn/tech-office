/**
 * useCurrentMembership — the organization membership for the signed-in session.
 *
 * Three screens were each re-running `getProfile()` and picking the matching
 * organization by hand. This is that pick, once, sharing one query cache entry.
 */

import { useQuery } from "@tanstack/react-query";
import { getProfile, type OrganizationMembership } from "apis";
import { useAuth } from "@/hooks/use-auth";

export function useCurrentMembership(): {
  membership: OrganizationMembership | undefined;
  isLoading: boolean;
} {
  const auth = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["profile"],
    queryFn: () => getProfile(),
    enabled: auth.isAuthenticated,
    staleTime: 5 * 60 * 1000,
  });

  const membership =
    data?.organizations.find((org) => org.organizationId === auth.organizationId) ??
    data?.organizations[0];

  return { membership, isLoading };
}

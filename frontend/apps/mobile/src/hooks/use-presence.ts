import { useQuery } from "@tanstack/react-query";
import { getEmployeePresence, type PresenceStatus } from "apis";

export function usePresence(
  employeeId: string | undefined
): PresenceStatus | null {
  const { data } = useQuery({
    queryKey: ["presence", employeeId],
    queryFn: () => getEmployeePresence(employeeId!),
    enabled: !!employeeId,
    staleTime: 60_000,
    select: (presence) => presence?.status ?? null,
  });
  return data ?? null;
}

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { listProjects } from "apis";
import { useAuth } from "@/hooks/use-auth";

function getRouteParamValue(value?: string | string[]): string | undefined {
  if (Array.isArray(value)) {
    return typeof value[0] === "string" && value[0] ? value[0] : undefined;
  }

  return typeof value === "string" && value ? value : undefined;
}

function isUUID(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function useResolvedProjectId(projectIdParam?: string | string[]) {
  const auth = useAuth();
  const projectId = useMemo(() => getRouteParamValue(projectIdParam), [projectIdParam]);
  const shouldResolveProjectId = !!projectId && !isUUID(projectId);

  const projectOptionsQuery = useQuery({
    queryKey: ["projects", "route-resolution"],
    queryFn: async () => {
      const result = await listProjects();
      return result.projects ?? [];
    },
    enabled: auth.isAuthenticated && shouldResolveProjectId,
    staleTime: 300_000,
  });

  const resolvedProjectId = useMemo(() => {
    if (!projectId) {
      return undefined;
    }

    if (!shouldResolveProjectId) {
      return projectId;
    }

    if (!projectOptionsQuery.isFetched) {
      return undefined;
    }

    const normalizedProjectId = projectId.trim().toLowerCase();
    return projectOptionsQuery.data?.find((project) => {
      const projectKey = project.key?.trim().toLowerCase();
      return project.id === projectId || projectKey === normalizedProjectId;
    })?.id ?? projectId;
  }, [projectId, projectOptionsQuery.data, projectOptionsQuery.isFetched, shouldResolveProjectId]);

  return {
    projectId,
    resolvedProjectId,
    isResolvingProjectId: shouldResolveProjectId && !projectOptionsQuery.isFetched,
  };
}
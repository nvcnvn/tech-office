import type { QueryClient } from "@tanstack/react-query";

export async function invalidateTaskQueries(
  queryClient: QueryClient,
  {
    projectId,
    taskId,
  }: {
    projectId?: string;
    taskId?: string;
  },
) {
  const invalidations: Array<Promise<unknown>> = [
    queryClient.invalidateQueries({ queryKey: ["projects"] }),
    queryClient.invalidateQueries({ queryKey: ["tasks-project-overview"] }),
    queryClient.invalidateQueries({ queryKey: ["tasks-focus"] }),
  ];

  if (projectId) {
    invalidations.push(queryClient.invalidateQueries({ queryKey: ["tasks", projectId] }));
  } else {
    invalidations.push(queryClient.invalidateQueries({ queryKey: ["tasks"] }));
  }

  if (taskId) {
    invalidations.push(queryClient.invalidateQueries({ queryKey: ["task", taskId] }));
  }

  await Promise.allSettled(invalidations);
}
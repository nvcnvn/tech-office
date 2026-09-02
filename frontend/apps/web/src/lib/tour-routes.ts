/**
 * TourTarget → web route (Feature 039)
 *
 * The tour is server-driven: the backend decides which stops a person sees and what each
 * one points at, as a `TourTarget` enum value. Routes are the one genuinely
 * platform-specific part, so each client owns its own map.
 *
 * **Drift guard (Constitution VIII).** `TOUR_ROUTES` is a `Record<TourTarget, ...>`, so a
 * new target added to the proto — and thence to the `TourTarget` union in
 * `packages/apis/src/tour.ts` — fails this file's type check until it has a route here.
 * Adding a target without routing it is a build failure, not a silent dead button. There
 * is no runtime test to keep in sync because there is nothing a runtime test would catch
 * that `tsc` does not.
 */

import type { TourTarget } from "apis";

/**
 * Where a stop's action lands.
 *
 * `null` means "render no action button" — the server sends `none` for a stop whose
 * capability the asking platform does not have.
 *
 * FR-013a: the project and docs routes land with the create action already open rather
 * than on a list that is empty in exactly the workspace the tour is written for. That is
 * what the `create=1` parameter is for; the pages read it and open their create dialog.
 */
const TOUR_ROUTES: Record<TourTarget, string | null> = {
  none: null,
  people: "/workspace/organization?tab=employees",
  projects: "/workspace/projects?create=1",
  // Overridden by resolveTourRoute when the workspace already has a project: rituals live
  // inside one, so with no project there is nowhere else honest to send someone.
  rituals: "/workspace/projects?create=1",
  chat: "/workspace/chat",
  calendar: "/workspace/calendar",
  docs: "/workspace/docs?create=1",
  today: "/workspace/tasks",
  alerts: "/workspace/notifications",
  search: "/workspace/search",
};

/** Context the ritual route needs, because it is the one route that depends on state. */
export interface TourRouteContext {
  /**
   * A project to open the rituals surface inside, when the workspace has one. Undefined
   * in a brand-new workspace, which is the case the administrator tour is written for.
   */
  firstProjectId?: string;
}

/**
 * Resolve a stop's target to a path, or null when the stop carries no action.
 *
 * Only `rituals` consults the context. A ritual is defined inside a project, so with no
 * project yet the honest destination is project creation — pointing at a rituals screen
 * that cannot exist is the empty-screen failure the spec's edge cases forbid (FR-013a).
 */
export function resolveTourRoute(
  target: TourTarget,
  context: TourRouteContext = {},
): string | null {
  if (target === "rituals" && context.firstProjectId) {
    // Straight to where ritual definitions are managed, not to the project's board:
    // FR-013a wants the route to land where the thing is created. `/workspace/tasks/:id`
    // is the project's canonical path — `/workspace/projects/:id` bounces to it.
    return `/workspace/tasks/${context.firstProjectId}?view=settings&tab=rituals`;
  }
  return TOUR_ROUTES[target];
}

/**
 * True when the ritual stop is falling back to project creation, so the tour card can say
 * why the button does not go where its label suggests (FR-013a).
 */
export function ritualRouteFallsBackToProject(
  target: TourTarget,
  context: TourRouteContext = {},
): boolean {
  return target === "rituals" && !context.firstProjectId;
}

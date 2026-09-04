/**
 * TourTarget → Expo route (Feature 039)
 *
 * The tour is server-driven: the backend decides which stops a person sees and what each
 * one points at, as a `TourTarget` enum value. Routes are the one genuinely
 * platform-specific part, so each client owns its own map.
 *
 * **Drift guard (Constitution VIII).** `TOUR_ROUTES` is a `Record<TourTarget, ...>`, so a
 * new target added to the proto — and thence to the `TourTarget` union in
 * `packages/apis/src/tour.ts` — fails this file's type check until it has a route here.
 * Adding a target without routing it is a build failure, not a silent dead button.
 */

import type { TourTarget } from "apis";

/**
 * Where a stop's action lands.
 *
 * `null` means "render no action button". Only `people` is null here, and that is not an
 * oversight: the server forces `none` for the one remaining web-only stop before a mobile
 * client ever sees it, so `people` cannot arrive on this platform. It is listed explicitly
 * rather than left to a fallback, so the day the mobile app grows that screen the change
 * is one line and the compiler has already pointed at the file.
 */
const TOUR_ROUTES: Record<TourTarget, string | null> = {
  none: null,
  // Adding staff, importing a team and setting roles are done on the web app.
  people: null,
  projects: "/(app)/(tasks)/create-project",
  // Overridden by resolveTourRoute when the workspace already has a project: rituals live
  // inside one, so with no project there is nowhere else honest to send someone.
  rituals: "/(app)/(tasks)/create-project",
  chat: "/(app)/(chat)",
  calendar: "/(app)/(calendar)",
  docs: "/(app)/(more)/docs",
  today: "/(app)/(today)",
  alerts: "/(app)/(notifications)",
  search: "/(app)/(more)/search",
};

/** Context the ritual route needs, because it is the one route that depends on state. */
export interface TourRouteContext {
  /**
   * A project to define the ritual inside, when the workspace has one. Undefined in a
   * brand-new workspace, which is the case the administrator tour is written for.
   */
  firstProjectId?: string;
}

/**
 * Resolve a stop's target to a route, or null when the stop carries no action.
 *
 * Only `rituals` consults the context. A ritual is defined inside a project, so with no
 * project yet the honest destination is project creation — pointing at a ritual screen
 * that cannot exist is the empty-screen failure the tour's own spec forbids.
 */
export function resolveTourRoute(
  target: TourTarget,
  context: TourRouteContext = {},
): string | null {
  if (target === "rituals" && context.firstProjectId) {
    return `/(app)/(tasks)/${context.firstProjectId}/create-ritual`;
  }
  return TOUR_ROUTES[target];
}

/**
 * True when the ritual stop is falling back to project creation, so the tour card can say
 * why the button does not go where its label suggests (FR-021).
 */
export function ritualRouteFallsBackToProject(
  target: TourTarget,
  context: TourRouteContext = {},
): boolean {
  return target === "rituals" && !context.firstProjectId;
}

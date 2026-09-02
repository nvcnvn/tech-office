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
 * `null` means "render no action button". Three targets are null here and that is not an
 * oversight: the server already forces `none` for the web-only stops before a mobile
 * client ever sees them, so `people`, `projects` and `rituals` cannot arrive on this
 * platform. They are listed explicitly rather than left to a fallback, so the day the
 * mobile app grows those screens the change is one line each and the compiler has already
 * pointed at the file.
 */
const TOUR_ROUTES: Record<TourTarget, string | null> = {
  none: null,
  // Adding staff, importing a team and setting roles are done on the web app.
  people: null,
  // Mobile can list projects and rituals but cannot create either, so the administrator
  // tour's project and ritual stops are web-only and arrive as `none`.
  projects: null,
  rituals: null,
  chat: "/(app)/(chat)",
  calendar: "/(app)/(calendar)",
  docs: "/(app)/(more)/docs",
  today: "/(app)/(today)",
  alerts: "/(app)/(notifications)",
  search: "/(app)/(more)/search",
};

/**
 * Context a route may depend on. Mobile has no state-dependent route today — the one
 * conditional route on web is the ritual stop, which never reaches a phone — but the
 * signature matches the web map so the two stay comparable.
 */
export interface TourRouteContext {
  firstProjectId?: string;
}

/** Resolve a stop's target to a route, or null when the stop carries no action. */
export function resolveTourRoute(
  target: TourTarget,
  _context: TourRouteContext = {},
): string | null {
  return TOUR_ROUTES[target];
}

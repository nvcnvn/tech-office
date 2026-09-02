/**
 * Feature tour state for the web workspace (Feature 039)
 *
 * The tour itself is server-driven — which tour, which stops, in what order, and whether
 * it should be offered all come from `getTour`. This hook owns only the three things the
 * server deliberately does not know (see contracts/tour-service.md, "What the clients
 * own"):
 *
 *   1. **When** to show the offer — after auth, never while a deep-link redirect is
 *      pending, and never before the workspace has painted (FR-008, FR-013).
 *   2. **Reopening after an action** — acting on a stop closes the tour and navigates;
 *      coming back to the workspace home reopens it at the same stop, unprompted and
 *      without a second progress write (FR-012).
 *   3. **Route resolution** — via `resolveTourRoute` (FR-013a).
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { getTour, listProjects, updateTourProgress, type FeatureTour } from "apis";
import { resolveTourRoute, ritualRouteFallsBackToProject } from "@/lib/tour-routes";

/**
 * The surfaces the tour is offered from. `/workspace` redirects to the calendar, so this
 * is where a person lands on arrival and where they return to after acting on a stop.
 *
 * The tour appears here and nowhere else. Offering it on every workspace route would put
 * a modal over whatever the person actually came to do — a task they followed a link to,
 * the settings page they opened to delete their account — which is the interruption
 * FR-013 exists to prevent. An explicit "Take the tour" is exempt: that is a request, not
 * an interruption.
 */
const WORKSPACE_HOME_PATHS = ["/workspace", "/workspace/calendar"];

/**
 * What the tour is currently doing.
 *
 * `offer` is the "would you like a quick tour?" prompt, shown only to someone who has
 * never engaged. `running` is the card sequence itself — someone resuming goes straight
 * there, because they already said yes once.
 */
export type TourPhase = "hidden" | "offer" | "running";

export interface UseFeatureTourResult {
  tour: FeatureTour | null;
  phase: TourPhase;
  /** Index into `tour.stops`. Always in range while `phase` is "running". */
  stopIndex: number;
  /** Accept the offer and start at the first stop. */
  start: () => void;
  next: () => void;
  previous: () => void;
  /** Decline the offer, or leave mid-tour. Both are terminal for the automatic offer. */
  dismiss: () => void;
  /** Act on the current stop: close the tour and go to the surface it points at. */
  act: () => void;
  /** The label for the current stop's action, or null when it carries none. */
  actionLabel: string | null;
  /**
   * True when the ritual stop is falling back to project creation because the workspace
   * has no project yet, so the card can say why (FR-013a).
   */
  actionFallsBackToProjectCreation: boolean;
  /** Restart from the first stop, however the tour ended. Used by "Take the tour". */
  restart: () => void;
}

export function useFeatureTour(): UseFeatureTourResult {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [tour, setTour] = useState<FeatureTour | null>(null);
  const [phase, setPhase] = useState<TourPhase>("hidden");
  const [stopIndex, setStopIndex] = useState(0);
  const [firstProjectId, setFirstProjectId] = useState<string | undefined>();
  /**
   * Set when the person acts on a stop. It is what separates "closed because they left"
   * — which should reopen on return — from "closed because they dismissed it", which
   * should not.
   */
  const [resumeOnReturn, setResumeOnReturn] = useState(false);
  /**
   * Set when the person asked for the tour themselves. It lifts the home-surface gate:
   * someone who clicks "Take the tour" from the settings page means it.
   */
  const [requested, setRequested] = useState(false);

  // The app is configured with trailing slashes, so usePathname returns
  // "/workspace/calendar/". Compared without it, since the slash is routing config rather
  // than anything about where the person is.
  const atWorkspaceHome = WORKSPACE_HOME_PATHS.includes(
    pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname,
  );

  // A deep link is being followed: the person asked for something specific and the tour
  // must not interrupt it (FR-013).
  const followingDeepLink = Boolean(
    searchParams.get("notification") ||
      searchParams.get("channel") ||
      searchParams.get("message"),
  );

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [loaded, projects] = await Promise.all([
          getTour("web"),
          // Only the ritual stop needs this, and only to decide between a project and
          // project creation. A failure here is not a reason to withhold the tour.
          listProjects({ limit: 1 }).catch(() => null),
        ]);
        if (cancelled) return;
        setTour(loaded);
        setFirstProjectId(projects?.projects?.[0]?.id);
        setStopIndex(Math.min(loaded.currentStop, Math.max(loaded.stops.length - 1, 0)));
        if (loaded.shouldOffer && loaded.stops.length > 0) {
          // Someone mid-tour already accepted once; re-asking would be a second prompt
          // for a question they answered.
          setPhase(loaded.status === "in_progress" ? "running" : "offer");
        }

      } catch {
        // Orientation is not worth an error state. A person who cannot reach the tour
        // service still gets their workspace.
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Reopening after an action (FR-012). No progress write: the stored current_stop
  // already says where to resume, and writing again would only churn updated_at.
  useEffect(() => {
    if (!resumeOnReturn || !atWorkspaceHome || followingDeepLink) return;
    setResumeOnReturn(false);
    setPhase("running");
  }, [atWorkspaceHome, followingDeepLink, resumeOnReturn]);

  const stops = tour?.stops ?? [];
  const currentStop = stops[stopIndex];

  const routeContext = useMemo(() => ({ firstProjectId }), [firstProjectId]);

  const writeProgress = useCallback(
    (status: "in_progress" | "completed" | "dismissed", index: number) => {
      // Fire and forget: the person is looking at the next card already, and a failed
      // write costs them one repeated stop next time, not an error dialog.
      void updateTourProgress(status, index).catch(() => undefined);
    },
    [],
  );

  const start = useCallback(() => {
    setStopIndex(0);
    setPhase("running");
    writeProgress("in_progress", 0);
  }, [writeProgress]);

  const next = useCallback(() => {
    const last = stops.length - 1;
    if (stopIndex >= last) {
      setPhase("hidden");
      writeProgress("completed", stops.length);
      return;
    }
    const index = stopIndex + 1;
    setStopIndex(index);
    writeProgress("in_progress", index);
  }, [stopIndex, stops.length, writeProgress]);

  const previous = useCallback(() => {
    if (stopIndex === 0) return;
    const index = stopIndex - 1;
    setStopIndex(index);
    writeProgress("in_progress", index);
  }, [stopIndex, writeProgress]);

  const dismiss = useCallback(() => {
    setPhase("hidden");
    setResumeOnReturn(false);
    writeProgress("dismissed", stopIndex);
  }, [stopIndex, writeProgress]);

  const act = useCallback(() => {
    if (!currentStop) return;
    const route = resolveTourRoute(currentStop.target, routeContext);
    if (!route) return;
    // The stop is finished once it has been acted on, so the person comes back to the
    // next one rather than the one they just did.
    const index = Math.min(stopIndex + 1, stops.length - 1);
    setStopIndex(index);
    writeProgress("in_progress", index);
    setPhase("hidden");
    setResumeOnReturn(true);
    router.push(route);
  }, [currentStop, routeContext, router, stopIndex, stops.length, writeProgress]);

  const restart = useCallback(() => {
    setStopIndex(0);
    setResumeOnReturn(false);
    setRequested(true);
    setPhase("running");
    writeProgress("in_progress", 0);
  }, [writeProgress]);

  const actionLabel = currentStop?.actionLabel || null;
  const actionFallsBackToProjectCreation = currentStop
    ? ritualRouteFallsBackToProject(currentStop.target, routeContext)
    : false;

  // Held back rather than discarded, so the tour appears once the person is somewhere it
  // belongs: on the workspace home, with no deep link in flight. A tour the person asked
  // for themselves is not held back at all.
  const suppressed = followingDeepLink || (!atWorkspaceHome && !requested);

  return {
    tour,
    phase: suppressed ? "hidden" : phase,
    stopIndex,
    start,
    next,
    previous,
    dismiss,
    act,
    actionLabel,
    actionFallsBackToProjectCreation,
    restart,
  };
}

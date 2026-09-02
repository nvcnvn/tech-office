/**
 * Feature tour state for the mobile app (Feature 039)
 *
 * The tour is server-driven — which tour, which stops, in what order, and whether it
 * should be offered all come from `getTour`, already adapted for `"mobile"`. This hook
 * owns only what the server deliberately does not know (contracts/tour-service.md, "What
 * the clients own"):
 *
 *   1. **When** to show the offer — after `TermsGate` and the onboarding redirect, never
 *      while a deep link is being followed (FR-008, FR-013).
 *   2. **Reopening after an action** — acting on a stop closes the tour and navigates;
 *      returning to the tab the tour was offered from reopens it at the same stop,
 *      unprompted and without a second progress write (FR-012).
 *   3. **Route resolution** — via `resolveTourRoute`.
 *
 * The presentation this feeds is purpose-built for the phone and shares no code with the
 * web tour (FR-025, Constitution XIII).
 */

import React from "react";
import { useRouter, useSegments } from "expo-router";
import { getTour, updateTourProgress, type FeatureTour } from "apis";
import { getOnboardingStep } from "@/lib/onboarding-progress";
import { resolveTourRoute } from "@/lib/tour-routes";

/**
 * What the tour is currently doing.
 *
 * `offer` is the "would you like a quick tour?" prompt, shown only to someone who has
 * never engaged. `running` is the card sheet itself — someone resuming goes straight
 * there, because they already said yes once.
 */
export type TourPhase = "hidden" | "offer" | "running";

export interface UseFeatureTourResult {
  tour: FeatureTour | null;
  phase: TourPhase;
  /** Index into `tour.stops`. Always in range while `phase` is "running". */
  stopIndex: number;
  start: () => void;
  next: () => void;
  previous: () => void;
  /** Decline the offer, or leave mid-tour. Both are terminal for the automatic offer. */
  dismiss: () => void;
  /** Act on the current stop: close the sheet and go to the surface it points at. */
  act: () => void;
  /** The label for the current stop's action, or null when it carries none. */
  actionLabel: string | null;
  /** Restart from the first stop, however the tour ended. Used by "Take the tour". */
  restart: () => void;
}

export function useFeatureTour(): UseFeatureTourResult {
  const router = useRouter();
  /*
   * Segments, not usePathname. Expo Router strips group segments from the pathname, so
   * every tab root reads as "/" — Chat, Today, My Work and More are indistinguishable by
   * pathname, which makes "the screen the tour was offered on" unanswerable. useSegments
   * keeps the groups, so ["(app)","(today)"] and ["(app)","(more)"] are different keys.
   */
  const segments = useSegments();
  const routeKey = segments.join("/");

  const [tour, setTour] = React.useState<FeatureTour | null>(null);
  const [phase, setPhase] = React.useState<TourPhase>("hidden");
  const [stopIndex, setStopIndex] = React.useState(0);
  /**
   * The screen the tour was showing on when the person acted. Recorded rather than
   * hard-coded, because "the tab the tour was offered from" is wherever they happened to
   * be — and it is a route key rather than a pathname for the reason above.
   */
  const [returnRoute, setReturnRoute] = React.useState<string | null>(null);
  /**
   * The screen the tour belongs on. Set to wherever the person was when the tour became
   * available, and reset by an explicit restart to wherever they asked for it from.
   *
   * The sheet is hidden while they are anywhere else, which is what keeps it from covering
   * a screen someone deep-linked into from a notification (FR-013). It is a comparison
   * against where it was offered rather than a hard-coded list of tab roots, because that
   * is the rule FR-012 states anyway.
   */
  const [homeRoute, setHomeRoute] = React.useState<string | null>(null);

  // Read, never depended on, so navigating does not re-run the load effect.
  const routeKeyRef = React.useRef(routeKey);
  routeKeyRef.current = routeKey;

  React.useEffect(() => {
    let cancelled = false;

    const load = async () => {
      // Onboarding is a mandatory gate: an owner who has not set their PIN, or a worker
      // part-way through first-run setup, is being sent somewhere else entirely.
      if (getOnboardingStep() !== null) return;

      try {
        const loaded = await getTour("mobile");
        if (cancelled) return;
        setTour(loaded);
        setStopIndex(Math.min(loaded.currentStop, Math.max(loaded.stops.length - 1, 0)));
        setHomeRoute(routeKeyRef.current);
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
  React.useEffect(() => {
    if (!returnRoute || routeKey !== returnRoute) return;
    setReturnRoute(null);
    setPhase("running");
  }, [returnRoute, routeKey]);

  const stops = tour?.stops ?? [];
  const currentStop = stops[stopIndex];

  const writeProgress = React.useCallback(
    (status: "in_progress" | "completed" | "dismissed", index: number) => {
      // Fire and forget: the person is looking at the next card already, and a failed
      // write costs them one repeated stop next time, not an error alert.
      void updateTourProgress(status, index).catch(() => undefined);
    },
    [],
  );

  const start = React.useCallback(() => {
    setStopIndex(0);
    setPhase("running");
    writeProgress("in_progress", 0);
  }, [writeProgress]);

  const next = React.useCallback(() => {
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

  const previous = React.useCallback(() => {
    if (stopIndex === 0) return;
    const index = stopIndex - 1;
    setStopIndex(index);
    writeProgress("in_progress", index);
  }, [stopIndex, writeProgress]);

  const dismiss = React.useCallback(() => {
    setPhase("hidden");
    setReturnRoute(null);
    writeProgress("dismissed", stopIndex);
  }, [stopIndex, writeProgress]);

  const act = React.useCallback(() => {
    if (!currentStop) return;
    const route = resolveTourRoute(currentStop.target);
    if (!route) return;
    // The stop is finished once it has been acted on, so the person comes back to the
    // next one rather than the one they just did.
    const index = Math.min(stopIndex + 1, stops.length - 1);
    setStopIndex(index);
    writeProgress("in_progress", index);
    setPhase("hidden");
    setReturnRoute(routeKeyRef.current);
    router.push(route as never);
  }, [currentStop, router, stopIndex, stops.length, writeProgress]);

  const restart = React.useCallback(() => {
    setStopIndex(0);
    setReturnRoute(null);
    // Asking for the tour from the More tab means showing it there, not back on whatever
    // screen it would otherwise have belonged to.
    setHomeRoute(routeKeyRef.current);
    setPhase("running");
    writeProgress("in_progress", 0);
  }, [writeProgress]);

  // Held back rather than discarded, so the sheet comes back when the person returns to
  // the screen it was offered on instead of following them around the app.
  const away = homeRoute !== null && routeKey !== homeRoute;

  return {
    tour,
    phase: away ? "hidden" : phase,
    stopIndex,
    start,
    next,
    previous,
    dismiss,
    act,
    actionLabel: currentStop?.actionLabel || null,
    restart,
  };
}

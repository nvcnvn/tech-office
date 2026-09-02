/**
 * One tour controller for the whole app (Feature 039)
 *
 * The tour renders from the tab layout, but it is also started from the More tab's
 * "Take the tour" row (FR-017). Both need the *same* instance — two `useFeatureTour()`
 * calls would be two independent tours, each fetching and each writing progress — so the
 * state is created once here and read from context.
 */

import React from "react";
import { useFeatureTour, type UseFeatureTourResult } from "@/hooks/use-feature-tour";
import { FeatureTour } from "@/components/feature-tour";

const TourContext = React.createContext<UseFeatureTourResult | null>(null);

/**
 * The app's tour controller.
 *
 * Returns null outside the provider rather than throwing: the More tab is the only
 * consumer, and a missing tour is a reason to hide one row, not to break the screen.
 */
export function useTourController(): UseFeatureTourResult | null {
  return React.useContext(TourContext);
}

export function TourProvider({ children }: { children: React.ReactNode }) {
  const controller = useFeatureTour();

  return (
    <TourContext.Provider value={controller}>
      {children}
      {/*
        Rendered after the children so the tabs paint first and the sheet arrives over an
        app the person can already see (FR-013). It is a Modal, so its position in the
        tree does not affect where it appears.
      */}
      <FeatureTour controller={controller} />
    </TourContext.Provider>
  );
}

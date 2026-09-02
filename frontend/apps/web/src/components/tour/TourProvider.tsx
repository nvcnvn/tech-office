/**
 * One tour controller for the whole workspace (Feature 039)
 *
 * The tour is rendered next to the workspace shell, but it is also started from the user
 * menu ("Take the tour", FR-017), which lives several levels down the header. Both need
 * the *same* instance — two `useFeatureTour()` calls would be two independent tours, each
 * fetching and each writing progress — so the state is created once here and read from
 * context.
 */

"use client";

import React, { createContext, useContext } from "react";
import { useFeatureTour, type UseFeatureTourResult } from "./useFeatureTour";
import { FeatureTour } from "./FeatureTour";

const TourContext = createContext<UseFeatureTourResult | null>(null);

/**
 * The workspace's tour controller.
 *
 * Returns null outside the provider rather than throwing: the user menu is the only
 * consumer, and a missing tour is a reason to hide one menu row, not to break the header.
 */
export function useTourController(): UseFeatureTourResult | null {
  return useContext(TourContext);
}

export function TourProvider({ children }: { children: React.ReactNode }) {
  const controller = useFeatureTour();

  return (
    <TourContext.Provider value={controller}>
      {children}
      {/*
        Rendered after the children so the workspace paints first and the tour arrives on
        top of a workspace the person can already see (FR-013). It is a dialog, so its
        position in the tree does not affect where it appears.
      */}
      <FeatureTour controller={controller} />
    </TourContext.Provider>
  );
}

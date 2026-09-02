/**
 * Feature tour — web presentation (Feature 039)
 *
 * A dialog-based card sequence. Deliberately NOT an anchored, spotlit walkthrough: FR-018
 * forbids highlighting or pointing at live elements, because a tour that anchors to the
 * DOM breaks every time the UI moves, and the stops here describe capabilities rather than
 * controls.
 *
 * Accessibility is a requirement, not a polish item (FR-019, SC-006): the whole sequence
 * is keyboard-operable, Escape always leaves, focus is never trapped without an exit, and
 * the stop position is announced rather than only drawn.
 *
 * All copy comes from the server. This file decides layout and nothing else.
 */

"use client";

import React from "react";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from "@mui/material";
import { useFeatureTour, type UseFeatureTourResult } from "./useFeatureTour";

export type { UseFeatureTourResult };

export interface FeatureTourProps {
  /**
   * Tour state. Passed in when something outside the tour needs to drive it — the
   * "Take the tour" entry point calls `restart` on the same instance. Omitted, the
   * component owns its own state.
   */
  controller?: UseFeatureTourResult;
}

export function FeatureTour({ controller }: FeatureTourProps) {
  const own = useFeatureTour();
  const tourState = controller ?? own;
  const {
    tour,
    phase,
    stopIndex,
    start,
    next,
    previous,
    dismiss,
    act,
    actionLabel,
    actionFallsBackToProjectCreation,
  } = tourState;

  if (phase === "hidden" || !tour || tour.stops.length === 0) {
    return null;
  }

  if (phase === "offer") {
    return (
      <Dialog
        open
        onClose={dismiss}
        maxWidth="xs"
        fullWidth
        aria-labelledby="feature-tour-offer-title"
        data-testid="feature-tour-offer"
      >
        <DialogTitle id="feature-tour-offer-title">
          A quick look around?
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            {tour.stops.length} short cards on what this workspace does. You can leave at
            any point and pick it up later.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={dismiss} data-testid="feature-tour-offer-decline">
            No thanks
          </Button>
          <Button
            variant="contained"
            onClick={start}
            data-testid="feature-tour-offer-accept"
          >
            Show me around
          </Button>
        </DialogActions>
      </Dialog>
    );
  }

  const stop = tour.stops[stopIndex];
  if (!stop) return null;

  const position = `Stop ${stopIndex + 1} of ${tour.stops.length}`;
  const isLast = stopIndex === tour.stops.length - 1;

  return (
    <Dialog
      open
      // Escape and the backdrop both leave, and leaving mid-tour is a dismissal — the
      // person is telling us they are done, not asking to be asked again tomorrow.
      onClose={dismiss}
      maxWidth="xs"
      fullWidth
      aria-labelledby="feature-tour-title"
      aria-describedby="feature-tour-body"
      data-testid="feature-tour"
      data-tour-stop={stop.key}
    >
      <DialogTitle id="feature-tour-title" data-testid="feature-tour-title">
        {stop.title}
      </DialogTitle>
      <DialogContent>
        {/*
          Announced, not just drawn: a screen-reader user needs to know where they are in
          the sequence as much as a sighted one does. aria-live because the dialog stays
          mounted while the content changes underneath it.
        */}
        <Typography
          variant="caption"
          color="text.secondary"
          component="p"
          aria-live="polite"
          data-testid="feature-tour-position"
        >
          {position}
        </Typography>
        <Typography
          id="feature-tour-body"
          variant="body2"
          sx={{ mt: 1 }}
          data-testid="feature-tour-body"
        >
          {stop.body}
        </Typography>
        {actionFallsBackToProjectCreation ? (
          <Typography
            variant="caption"
            color="text.secondary"
            component="p"
            sx={{ mt: 2 }}
            data-testid="feature-tour-ritual-fallback-note"
          >
            Rituals live inside a project, and this workspace does not have one yet — so
            this takes you to project creation first.
          </Typography>
        ) : null}
      </DialogContent>
      <DialogActions sx={{ justifyContent: "space-between", px: 3, pb: 2 }}>
        <Button
          size="small"
          onClick={dismiss}
          data-testid="feature-tour-dismiss"
        >
          Close
        </Button>
        <Box sx={{ display: "flex", gap: 1 }}>
          <Button
            size="small"
            onClick={previous}
            disabled={stopIndex === 0}
            data-testid="feature-tour-previous"
          >
            Back
          </Button>
          {actionLabel ? (
            <Button
              size="small"
              variant="outlined"
              onClick={act}
              data-testid="feature-tour-action"
            >
              {actionLabel}
            </Button>
          ) : null}
          <Button
            size="small"
            variant="contained"
            onClick={next}
            data-testid="feature-tour-next"
          >
            {isLast ? "Done" : "Next"}
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
}

export default FeatureTour;

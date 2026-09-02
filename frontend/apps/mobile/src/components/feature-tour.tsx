/**
 * Feature tour — mobile presentation (Feature 039)
 *
 * A bottom card sheet, built for a phone held in one hand: one card at a time, large tap
 * targets, and everything readable at 360 dp portrait without clipping (SC-008,
 * Constitution XIII). It shares no code with the web tour component and is not a
 * rendering of it (FR-025) — the web version is a centred desktop dialog with a row of
 * small buttons, which is the wrong shape for a thumb.
 *
 * All copy comes from the server, already adapted for mobile: a stop whose capability the
 * phone does not have arrives with its "do this on the web" note and no action label, so
 * there is nothing here that decides what a person can and cannot do.
 */

import React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  border,
  lightPalette,
  mobileTypography,
  opacity,
  radius,
  spacing,
  touch,
} from "@tech-office/theme-tokens";
import { useFeatureTour, type UseFeatureTourResult } from "@/hooks/use-feature-tour";

export interface FeatureTourProps {
  /**
   * Tour state. Passed in when something outside the tour drives it — the "Take the tour"
   * row in More calls `restart` on the same instance. Omitted, the component owns its own.
   */
  controller?: UseFeatureTourResult;
}

export function FeatureTour({ controller }: FeatureTourProps) {
  const own = useFeatureTour();
  const insets = useSafeAreaInsets();
  const { tour, phase, stopIndex, start, next, previous, dismiss, act, actionLabel } =
    controller ?? own;

  if (phase === "hidden" || !tour || tour.stops.length === 0) {
    return null;
  }

  const sheetPadding = { paddingBottom: spacing[2] + insets.bottom };

  if (phase === "offer") {
    return (
      <Modal
        visible
        transparent
        animationType="slide"
        // Android back button leaves, the same as the Close control. Nothing here is
        // worth trapping someone in.
        onRequestClose={dismiss}
      >
        {/*
          The scrim carries a testID shared by both sheets, so anything that just needs to
          know "the tour is on screen" — the Maestro sign-in bootstrap, which has to close
          whichever of the two it finds — can wait on one element instead of racing two.
        */}
        <View style={styles.scrim} testID="feature-tour-sheet">
          <View style={[styles.sheet, sheetPadding]} testID="feature-tour-offer">
            <Text style={styles.title} accessibilityRole="header">
              A quick look around?
            </Text>
            <Text style={styles.body}>
              {tour.stops.length} short cards on what this app does. You can leave at any
              point and pick it up later.
            </Text>
            <Pressable
              testID="feature-tour-offer-accept"
              accessibilityRole="button"
              accessibilityLabel="Show me around"
              onPress={start}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.primaryButtonLabel}>Show me around</Text>
            </Pressable>
            <Pressable
              testID="feature-tour-offer-decline"
              accessibilityRole="button"
              accessibilityLabel="No thanks"
              onPress={dismiss}
              style={({ pressed }) => [styles.textButton, pressed && styles.pressed]}
            >
              <Text style={styles.textButtonLabel}>No thanks</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    );
  }

  const stop = tour.stops[stopIndex];
  if (!stop) return null;

  const position = `Stop ${stopIndex + 1} of ${tour.stops.length}`;
  const isLast = stopIndex === tour.stops.length - 1;
  const isFirst = stopIndex === 0;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={dismiss}>
      <View style={styles.scrim} testID="feature-tour-sheet">
        <View style={[styles.sheet, sheetPadding]} testID="feature-tour">
          {/*
            Announced, not just drawn. The whole card is one accessibility element so a
            screen-reader user hears where they are, what the stop is called and what it
            says in one pass, instead of swiping through three separate labels.
          */}
          <View
            accessible
            accessibilityLabel={`${position}. ${stop.title}. ${stop.body}`}
          >
            <Text style={styles.position} testID="feature-tour-position">
              {position}
            </Text>
            <Text
              style={styles.title}
              accessibilityRole="header"
              testID="feature-tour-title"
            >
              {stop.title}
            </Text>
            {/* Scrolls rather than clips: the longest body is 56 words, which does not
                fit a 360 dp screen at an accessibility text size. */}
            <ScrollView style={styles.bodyScroll} showsVerticalScrollIndicator={false}>
              <Text style={styles.body} testID="feature-tour-body">
                {stop.body}
              </Text>
            </ScrollView>
          </View>

          {actionLabel ? (
            <Pressable
              testID="feature-tour-action"
              accessibilityRole="button"
              accessibilityLabel={actionLabel}
              onPress={act}
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
            >
              <Text style={styles.secondaryButtonLabel}>{actionLabel}</Text>
            </Pressable>
          ) : null}

          <Pressable
            testID="feature-tour-next"
            accessibilityRole="button"
            accessibilityLabel={isLast ? "Done" : "Next"}
            onPress={next}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
          >
            <Text style={styles.primaryButtonLabel}>{isLast ? "Done" : "Next"}</Text>
          </Pressable>

          <View style={styles.footerRow}>
            <Pressable
              testID="feature-tour-previous"
              accessibilityRole="button"
              accessibilityLabel="Back"
              accessibilityState={{ disabled: isFirst }}
              disabled={isFirst}
              onPress={previous}
              style={({ pressed }) => [
                styles.textButton,
                isFirst && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.textButtonLabel}>Back</Text>
            </Pressable>
            {/* A dismiss control on every card, per FR-009: leaving is always one tap. */}
            <Pressable
              testID="feature-tour-dismiss"
              accessibilityRole="button"
              accessibilityLabel="Close the tour"
              onPress={dismiss}
              style={({ pressed }) => [styles.textButton, pressed && styles.pressed]}
            >
              <Text style={styles.textButtonLabel}>Close</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: `rgba(0, 0, 0, ${opacity.scrim})`,
  },
  sheet: {
    backgroundColor: lightPalette.background.paper,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing[2.5],
    paddingTop: spacing[3],
    gap: spacing[1.5],
  },
  position: {
    ...mobileTypography.caption,
    color: lightPalette.text.secondary,
    marginBottom: spacing[0.5],
  },
  title: {
    ...mobileTypography.sectionHeader,
    color: lightPalette.text.primary,
  },
  bodyScroll: {
    // Roughly half a small phone's height: enough for the longest body, capped so the
    // buttons are never pushed off the bottom of a 360 dp screen.
    maxHeight: 260,
    marginTop: spacing[1],
  },
  body: {
    ...mobileTypography.listSecondary,
    color: lightPalette.text.secondary,
  },
  primaryButton: {
    minHeight: touch.large,
    borderRadius: radius.md,
    backgroundColor: lightPalette.primary.main,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing[2],
  },
  primaryButtonLabel: {
    ...mobileTypography.button,
    color: lightPalette.primary.contrastText,
    textAlign: "center",
  },
  secondaryButton: {
    minHeight: touch.comfortable,
    borderRadius: radius.md,
    borderWidth: border.thin,
    borderColor: lightPalette.primary.main,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing[2],
  },
  secondaryButtonLabel: {
    ...mobileTypography.button,
    color: lightPalette.primary.main,
    textAlign: "center",
  },
  footerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  textButton: {
    minHeight: touch.minTarget,
    justifyContent: "center",
    paddingHorizontal: spacing[1],
  },
  textButtonLabel: {
    ...mobileTypography.buttonSm,
    color: lightPalette.text.secondary,
  },
  disabled: {
    opacity: opacity.disabled,
  },
  pressed: {
    opacity: opacity.pressed,
  },
});

export default FeatureTour;

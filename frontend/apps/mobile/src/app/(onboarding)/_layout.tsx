/**
 * First-run onboarding stack.
 *
 * The steps here are not dismissible: an owner who backs out of the PIN step lands in a
 * workspace they cannot sign back into the way their staff do. The layout also redirects
 * into the step that was not finished, so an owner who was interrupted after their
 * workspace was created resumes there instead of at signup — where retrying would collide
 * on the address they just claimed.
 */

import React from "react";
import { Redirect, Stack, usePathname } from "expo-router";
import { getOnboardingStep } from "@/lib/onboarding-progress";

/**
 * Where each unfinished step lives. `done` is absent by construction: getOnboardingStep
 * never reports it, because finishing clears the stored progress.
 */
const STEP_ROUTE = {
  pin: { href: "/(onboarding)/set-pin", segment: "set-pin" },
  teammate: { href: "/(onboarding)/add-teammate", segment: "add-teammate" },
} as const;

export default function OnboardingLayout() {
  const pathname = usePathname();
  const step = getOnboardingStep();

  // No onboarding in progress: nothing in this group should be reachable.
  if (step === null || step === "done") {
    return <Redirect href="/(app)/(chat)" />;
  }

  const target = STEP_ROUTE[step];
  if (!pathname.endsWith(target.segment)) {
    return <Redirect href={target.href} />;
  }

  return (
    <Stack
      screenOptions={{
        headerBackVisible: false,
        headerBackButtonDisplayMode: "minimal",
        headerShadowVisible: false,
        gestureEnabled: false,
      }}
    />
  );
}

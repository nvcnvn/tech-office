/**
 * Where an owner has reached in first-run onboarding.
 *
 * Persisted so an interrupted owner resumes at the step they had not finished, rather than
 * at signup — where retrying would collide on the workspace address they just claimed.
 */

import { MMKV } from "react-native-mmkv";

const onboardingStorage = new MMKV({ id: "tech-office" });

const STEP_KEY = "onboarding.step";
const SUBDOMAIN_KEY = "onboarding.subdomain";

/** `pin` and `teammate` are steps still to do; `done` means onboarding is finished. */
export type OnboardingStep = "pin" | "teammate" | "done";

const STEPS: readonly OnboardingStep[] = ["pin", "teammate", "done"];

function isOnboardingStep(value: string | undefined): value is OnboardingStep {
  return value !== undefined && (STEPS as readonly string[]).includes(value);
}

/**
 * The step the owner still has to complete, or null when there is no onboarding in
 * progress. An unrecognised stored value is treated as no progress rather than trusted.
 */
export function getOnboardingStep(): OnboardingStep | null {
  const stored = onboardingStorage.getString(STEP_KEY);
  return isOnboardingStep(stored) ? stored : null;
}

/** The workspace address created during this onboarding, or "" when there is none. */
export function getOnboardingSubdomain(): string {
  return onboardingStorage.getString(SUBDOMAIN_KEY) ?? "";
}

/**
 * Record that a workspace was created and onboarding has begun. Called immediately after
 * registration succeeds, before the PIN step is shown.
 */
export function beginOnboarding(subdomain: string): void {
  onboardingStorage.set(SUBDOMAIN_KEY, subdomain.trim().toLowerCase());
  onboardingStorage.set(STEP_KEY, "pin");
}

/** Advance to a later step, or to `done`, which clears the stored progress. */
export function setOnboardingStep(step: OnboardingStep): void {
  if (step === "done") {
    clearOnboarding();
    return;
  }
  onboardingStorage.set(STEP_KEY, step);
}

/** Forget onboarding progress. Called on completion and on sign-out. */
export function clearOnboarding(): void {
  onboardingStorage.delete(STEP_KEY);
  onboardingStorage.delete(SUBDOMAIN_KEY);
}

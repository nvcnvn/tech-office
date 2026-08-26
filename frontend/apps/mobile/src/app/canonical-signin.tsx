/**
 * Canonical sign-in entry point. Re-exports the PIN-first sign-in screen so a canonical
 * link and the app's own sign-in route land on the same surface.
 */

import SignInScreen from "./(auth)/index";

export default function CanonicalSignInScreen() {
  return <SignInScreen />;
}

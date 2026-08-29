import { Platform } from "react-native";
import { lightPalette } from "@tech-office/theme-tokens";

/**
 * Header options shared by every tab-root Stack.
 *
 * `headerTransparent` + `headerBlurEffect` is an iOS design: content scrolls
 * under a blurred bar and `contentInsetAdjustmentBehavior="automatic"` pays
 * back the inset. That ScrollView prop is iOS-only, so on Android a transparent
 * header leaves screen content pinned at y=0 — under both the header and the
 * status bar. Keeping the header opaque there lets the native toolbar apply the
 * status bar inset itself.
 */
export const tabRootStackScreenOptions = {
  headerTransparent: Platform.OS === "ios",
  headerShadowVisible: false,
  headerBlurEffect: "regular",
  // Not PlatformColor("label"): that resolves to white when the OS is in dark
  // mode, and every screen here is hardcoded to lightPalette, so the native
  // title turned white-on-light and vanished on a dark-mode iPhone.
  headerTitleStyle: { color: lightPalette.text.primary, fontWeight: "600" },
  headerBackButtonDisplayMode: "minimal",
} as const;

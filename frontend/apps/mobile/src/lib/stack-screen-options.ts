import { Platform } from "react-native";
import { labelColor } from "@/lib/platform-colors";

/**
 * Header options shared by every tab-root Stack.
 *
 * `headerTransparent` + `headerBlurEffect` + `headerLargeTitle` is an iOS
 * design: content scrolls under a blurred bar and `contentInsetAdjustment-
 * Behavior="automatic"` pays back the inset. That ScrollView prop is iOS-only,
 * so on Android a transparent header leaves screen content pinned at y=0 —
 * under both the header and the status bar. Keeping the header opaque there
 * lets the native toolbar apply the status bar inset itself.
 */
export const tabRootStackScreenOptions = {
  headerLargeTitle: false,
  headerTransparent: Platform.OS === "ios",
  headerShadowVisible: false,
  headerLargeTitleShadowVisible: false,
  headerBlurEffect: "regular",
  headerTitleStyle: { color: labelColor, fontWeight: "600" },
  headerBackButtonDisplayMode: "minimal",
} as const;

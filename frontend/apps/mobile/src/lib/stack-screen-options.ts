import { Platform } from "react-native";
import type { MobilePalette } from "@tech-office/theme-tokens";

/**
 * Header options shared by every tab-root Stack.
 *
 * `headerTransparent` + `headerBlurEffect` is an iOS design: content scrolls
 * under a blurred bar and `contentInsetAdjustmentBehavior="automatic"` pays
 * back the inset. That ScrollView prop is iOS-only, so on Android a transparent
 * header leaves screen content pinned at y=0 — under both the header and the
 * status bar. Keeping the header opaque there lets the native toolbar apply the
 * status bar inset itself, which is why `headerStyle.backgroundColor` matters on
 * Android and is ignored on iOS.
 *
 * A plain function of the palette rather than a hook, because `screenOptions` is
 * read where a hook cannot run — see contracts/theme-runtime.md §6.
 */
export function tabRootStackScreenOptions(t: MobilePalette) {
  return {
    headerTransparent: Platform.OS === "ios",
    headerShadowVisible: false,
    // The iOS blur material has to change with the theme: the light "regular"
    // material over a dark screen reads as a white smear behind the title.
    headerBlurEffect: t.mode === "dark" ? "systemChromeMaterialDark" : "regular",
    headerStyle: { backgroundColor: t.background.paper },
    // Not PlatformColor("label"): it resolves from the *phone's* dark-mode
    // setting, which this app deliberately no longer follows once somebody has
    // chosen a theme, so the native title turned white-on-light and vanished.
    headerTitleStyle: { color: t.text.primary, fontWeight: "600" },
    headerTintColor: t.text.primary,
    headerBackButtonDisplayMode: "minimal",
    // The one that removes the white flash between screen pushes (FR-006):
    // without it `react-native-screens` paints the navigator's own default
    // background, which is white in both themes.
    contentStyle: { backgroundColor: t.background.default },
  } as const;
}

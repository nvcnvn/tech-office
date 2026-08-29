import { Platform, PlatformColor } from "react-native";

/**
 * iOS semantic label color. Android has no matching resource, so we fall back to
 * `undefined` and let react-navigation use its theme's text color.
 */
export const labelColor = (
  Platform.OS === "ios" ? PlatformColor("label") : undefined
) as unknown as string | undefined;

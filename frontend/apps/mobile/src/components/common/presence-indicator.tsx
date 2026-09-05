/**
 * PresenceIndicator — shows a colored dot indicating online/offline/away status
 */

import React from "react";
import { View } from "react-native";
import { useTheme } from "@/lib/theme";

type PresenceStatus = "online" | "away" | "busy" | "offline";

interface PresenceIndicatorProps {
  status: PresenceStatus;
  size?: number;
  /** Position relative to parent (absolute bottom-right by default) */
  absolute?: boolean;
}

export function PresenceIndicator({
  status,
  size = 10,
  absolute = true,
}: PresenceIndicatorProps) {
  const { palette } = useTheme();

  return (
    <View
      // The status is in the testID because a colored dot has no other readable
      // surface: it is how the Maestro presence flow can tell online from offline.
      testID={`presence-indicator-${status}`}
      accessibilityLabel={`Presence: ${status}`}
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: palette.presence[status] ?? palette.presence.offline,
          borderWidth: 1.5,
          borderColor: palette.presence.ring,
        },
        absolute && {
          position: "absolute",
          bottom: 0,
          right: 0,
        },
      ]}
    />
  );
}

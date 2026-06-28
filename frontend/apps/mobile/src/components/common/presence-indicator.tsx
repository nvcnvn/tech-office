/**
 * PresenceIndicator — shows a colored dot indicating online/offline/away status
 */

import React from "react";
import { View } from "react-native";

type PresenceStatus = "online" | "away" | "busy" | "offline";

const statusColors: Record<PresenceStatus, string> = {
  online: "#16a34a",
  away: "#d97706",
  busy: "#dc2626",
  offline: "#94a3b8",
};

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
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: statusColors[status] ?? statusColors.offline,
          borderWidth: 1.5,
          borderColor: "#fff",
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

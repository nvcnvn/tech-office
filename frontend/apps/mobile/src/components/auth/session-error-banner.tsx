import React from "react";
import { Pressable, Text, View } from "react-native";
import { statusColors } from "@tech-office/theme-tokens";
import { useTheme } from "@/lib/theme";

interface SessionErrorBannerProps {
  message: string;
  onDismiss?: () => void;
}

export function SessionErrorBanner({
  message,
  onDismiss,
}: SessionErrorBannerProps) {
  const { palette } = useTheme();
  const error = statusColors.error[palette.mode];

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: error.border,
        backgroundColor: error.bg,
        borderRadius: 12,
        borderCurve: "continuous",
        padding: 14,
        gap: 8,
      }}
    >
      <Text style={{ fontSize: 13, fontWeight: "700", color: error.text }}>
        Session ended
      </Text>
      <Text style={{ fontSize: 14, lineHeight: 20, color: error.text }}>
        {message}
      </Text>
      {onDismiss ? (
        <Pressable onPress={onDismiss} style={{ alignSelf: "flex-start" }}>
          <Text style={{ fontSize: 13, fontWeight: "600", color: error.text }}>
            Dismiss
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
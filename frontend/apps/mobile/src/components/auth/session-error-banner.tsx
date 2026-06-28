import React from "react";
import { Pressable, Text, View } from "react-native";

interface SessionErrorBannerProps {
  message: string;
  onDismiss?: () => void;
}

export function SessionErrorBanner({
  message,
  onDismiss,
}: SessionErrorBannerProps) {
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: "#fecaca",
        backgroundColor: "#fef2f2",
        borderRadius: 12,
        borderCurve: "continuous",
        padding: 14,
        gap: 8,
      }}
    >
      <Text style={{ fontSize: 13, fontWeight: "700", color: "#991b1b" }}>
        Session ended
      </Text>
      <Text style={{ fontSize: 14, lineHeight: 20, color: "#7f1d1d" }}>
        {message}
      </Text>
      {onDismiss ? (
        <Pressable onPress={onDismiss} style={{ alignSelf: "flex-start" }}>
          <Text style={{ fontSize: 13, fontWeight: "600", color: "#991b1b" }}>
            Dismiss
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
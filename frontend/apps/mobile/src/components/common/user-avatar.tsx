/**
 * UserAvatar — displays a user's avatar with initials fallback
 */

import React from "react";
import { View, Text } from "react-native";
import { Image } from "expo-image";

interface UserAvatarProps {
  name?: string;
  avatarUrl?: string | null;
  size?: number;
  color?: string;
}

export function UserAvatar({
  name = "?",
  avatarUrl,
  size = 40,
  color = "#334155",
}: UserAvatarProps) {
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  if (avatarUrl) {
    return (
      <Image
        source={{ uri: avatarUrl }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        contentFit="cover"
      />
    );
  }

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <Text
        style={{
          color: "#fff",
          fontSize: size * 0.38,
          fontWeight: "700",
        }}
      >
        {initials}
      </Text>
    </View>
  );
}

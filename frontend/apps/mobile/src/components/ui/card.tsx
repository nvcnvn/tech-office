/**
 * Card — elevated surface container
 */

import React from "react";
import {
  Pressable,
  StyleSheet,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import {
  border,
  lightPalette,
  mobileLayout,
  radius,
} from "@tech-office/theme-tokens";

interface CardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: PressableProps["onPress"];
  padding?: number;
}

export function Card({
  children,
  style,
  onPress,
  padding = mobileLayout.cardPadding,
}: CardProps) {
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.card,
          { padding, opacity: pressed ? 0.88 : 1 },
          style,
        ]}
      >
        {children}
      </Pressable>
    );
  }

  return (
    <View style={[styles.card, { padding }, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: lightPalette.background.paper,
    borderRadius: radius.md,
    // @ts-ignore
    borderCurve: "continuous",
    borderWidth: border.thin,
    borderColor: lightPalette.divider,
    boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
  },
});

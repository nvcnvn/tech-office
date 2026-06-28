import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, usePathname } from "expo-router";

export default function SharedProbeItemRoute() {
  const pathname = usePathname();
  const { id } = useLocalSearchParams<{ id?: string }>();

  return (
    <View style={styles.screen}>
      <Text testID="shared-probe-item-route-mounted" style={styles.title}>
        Shared probe item route
      </Text>
      <Text testID="shared-probe-item-route-id" style={styles.value}>
        {id ?? ""}
      </Text>
      <Text style={styles.value}>{pathname}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#f8fafc",
    padding: 24,
  },
  title: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "700",
    color: "#111827",
  },
  value: {
    fontSize: 14,
    lineHeight: 20,
    color: "#374151",
    textAlign: "center",
  },
});
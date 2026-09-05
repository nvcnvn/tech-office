import React from "react";
import { Text, View } from "react-native";
import { useLocalSearchParams, usePathname } from "expo-router";
import { makeStyles } from "@/lib/theme";

export default function SharedProbeRoute() {
  const styles = useStyles();

  const pathname = usePathname();
  const { id } = useLocalSearchParams<{ id?: string }>();

  return (
    <View style={styles.screen}>
      <Text testID="shared-probe-route-mounted" style={styles.title}>
        Shared probe route
      </Text>
      <Text testID="shared-probe-route-id" style={styles.value}>
        {id ?? ""}
      </Text>
      <Text style={styles.value}>{pathname}</Text>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  screen: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
    backgroundColor: t.background.default,
    padding: 24,
  },
  title: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "700",
    color: t.text.primary,
  },
  value: {
    fontSize: 14,
    lineHeight: 20,
    color: t.text.secondary,
    textAlign: "center",
  },
}));
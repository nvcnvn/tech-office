/**
 * Blocked people — the list of everyone this person has blocked, and the way back
 * (Feature 036, FR-024).
 *
 * There is no equivalent screen showing who has blocked *you*, and no API that
 * could answer it. That absence is the requirement, not an omission.
 */

import React from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack } from "expo-router";
import { listBlockedPeople, type BlockedPerson } from "apis";

import { BlockConfirm } from "@/components/compliance/block-confirm";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SFIcon } from "@/components/ui/sf-icon";
import {
  lightPalette,
  mobileLayout,
  mobileTypography,
  opacity,
  radius,
  spacing,
} from "@tech-office/theme-tokens";

export default function BlockedPeopleScreen() {
  const [people, setPeople] = React.useState<BlockedPerson[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [unblocking, setUnblocking] = React.useState<BlockedPerson | null>(null);

  const load = React.useCallback(async () => {
    setError("");
    try {
      const resp = await listBlockedPeople();
      setPeople(resp.blocked);
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : "We couldn't load your blocked list.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
    >
      <Stack.Screen options={{ title: "Blocked people" }} />

      <Card style={styles.introCard}>
        <Text style={styles.introTitle}>What blocking does</Text>
        <Text style={styles.introBody}>
          A blocked person can't start a direct conversation or call you, and their
          direct messages are hidden from your view. They stay in the same work
          channels as you, and you still see what they post there.
        </Text>
        <Text style={styles.introQuiet}>Nobody is told that you blocked them.</Text>
      </Card>

      {error ? (
        <Card style={styles.errorCard}>
          <Text selectable style={styles.errorText} testID="blocked-error">
            {error}
          </Text>
        </Card>
      ) : null}

      {loading && people.length === 0 ? (
        <ActivityIndicator style={styles.loading} color={lightPalette.text.secondary} />
      ) : people.length === 0 ? (
        <EmptyState
          sfSymbol="hand.raised"
          title="You haven't blocked anyone"
          subtitle="If somebody's direct messages or calls are a problem, you can block them from their profile."
        />
      ) : (
        <Card padding={0} style={styles.listCard}>
          {people.map((person) => (
            <View key={person.blockId} style={styles.row} testID={`blocked-row-${person.employeeId}`}>
              <View style={styles.avatar}>
                <SFIcon name="person.fill" size={16} color={lightPalette.text.secondary} />
              </View>
              <View style={styles.rowCopy}>
                <Text selectable style={styles.rowTitle}>
                  {person.displayName || person.employeeId}
                </Text>
                {person.email ? (
                  <Text selectable style={styles.rowSubtitle}>
                    {person.email}
                  </Text>
                ) : null}
              </View>
              <Pressable
                onPress={() => setUnblocking(person)}
                style={({ pressed }) => [styles.unblockButton, pressed && styles.pressed]}
                testID={`blocked-unblock-${person.employeeId}`}
              >
                <Text style={styles.unblockText}>Unblock</Text>
              </Pressable>
            </View>
          ))}
        </Card>
      )}

      <BlockConfirm
        visible={unblocking !== null}
        mode="unblock"
        employeeId={unblocking?.employeeId ?? ""}
        displayName={unblocking?.displayName || "this person"}
        onClose={() => setUnblocking(null)}
        onDone={() => void load()}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: lightPalette.background.default,
  },
  content: {
    padding: mobileLayout.screenPadding,
    gap: mobileLayout.cardGap,
    paddingBottom: spacing[6],
  },
  introCard: {
    gap: spacing[1],
  },
  introTitle: {
    ...mobileTypography.sectionHeader,
    color: lightPalette.text.primary,
  },
  introBody: {
    ...mobileTypography.listSecondary,
    color: lightPalette.text.secondary,
  },
  introQuiet: {
    ...mobileTypography.caption,
    color: lightPalette.text.secondary,
  },
  errorCard: {
    backgroundColor: "#fceceb",
  },
  errorText: {
    ...mobileTypography.listSecondary,
    color: lightPalette.error.main,
  },
  loading: {
    marginTop: spacing[4],
  },
  listCard: {
    overflow: "hidden",
  },
  row: {
    minHeight: mobileLayout.compactRowHeight,
    flexDirection: "row",
    alignItems: "center",
    gap: mobileLayout.iconTextGap,
    paddingHorizontal: mobileLayout.cardPadding,
    paddingVertical: 14,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: radius.base,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: lightPalette.background.default,
  },
  rowCopy: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    ...mobileTypography.listPrimary,
    color: lightPalette.text.primary,
  },
  rowSubtitle: {
    ...mobileTypography.listSecondary,
    color: lightPalette.text.secondary,
  },
  unblockButton: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing[1],
  },
  unblockText: {
    ...mobileTypography.listPrimary,
    color: lightPalette.primary.main,
    fontWeight: "600",
  },
  pressed: {
    opacity: opacity.pressed,
  },
});

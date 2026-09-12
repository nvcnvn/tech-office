/**
 * A colleague — name, where they work, and the two ways to reach them.
 *
 * The call row is the point of the whole feature: an owner reads a worker's number off
 * their phone and hands it to the dialer. Two rules hold it up.
 *
 * First, `Linking.openURL` with no `canOpenURL` probe. On Android 11+ `canOpenURL`
 * returns false for `tel:` unless the app declares a <queries> entry, so a probe would
 * make the row silently do nothing on a real phone while working perfectly in the
 * simulator. Failure is caught and named instead of predicted.
 *
 * Second, when no number is recorded this screen renders *nothing* — no greyed button, no
 * "Not provided". A placeholder that invites a tap is the failure FR-012 names.
 */

import React from "react";
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createOrGetDirectMessage,
  directoryDisplayName,
  getDirectoryEntry,
  listBlockedPeople,
} from "apis";
import { BlockConfirm } from "@/components/compliance/block-confirm";
import { PresenceIndicator } from "@/components/common/presence-indicator";
import { UserAvatar } from "@/components/common/user-avatar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SFIcon } from "@/components/ui/sf-icon";
import { SkeletonList } from "@/components/ui/skeleton";
import { withNavigationContext } from "@/lib/mobile-navigation";
import {
  mobileLayout,
  mobileTypography,
  opacity,
  radius,
  spacing,
} from "@tech-office/theme-tokens";
import { makeStyles, useTheme } from "@/lib/theme";

/**
 * A dialer accepts `+` and digits. Everything else in a recorded number is formatting
 * for humans, and it stays on screen unchanged — only the URI is sanitised.
 */
function telURI(phoneNumber: string): string {
  return `tel:${phoneNumber.replace(/[^+\d]/g, "")}`;
}

function mapPresence(status: string): "online" | "away" | "offline" {
  if (status === "online") return "online";
  if (status === "idle") return "away";
  return "offline";
}

function presenceLabel(status: string): string {
  if (status === "online") return "Online";
  if (status === "idle") return "Idle";
  return "Offline";
}

function ContactRow({
  testID,
  sfIcon,
  label,
  value,
  onPress,
}: {
  testID: string;
  sfIcon: string;
  label: string;
  value: string;
  onPress?: () => void;
}) {
  const { palette } = useTheme();
  const styles = useStyles();

  const content = (
    <>
      <View style={styles.contactIcon}>
        <SFIcon name={sfIcon} size={18} color={palette.primary.main} />
      </View>
      <View style={styles.contactCopy}>
        <Text style={styles.contactLabel}>{label}</Text>
        <Text selectable style={styles.contactValue}>
          {value}
        </Text>
      </View>
      {onPress ? (
        <SFIcon name="chevron.right" size={14} color={palette.text.disabled} />
      ) : null}
    </>
  );

  if (!onPress) {
    return (
      <View testID={testID} style={styles.contactRow}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      style={({ pressed }) => [styles.contactRow, pressed && styles.rowPressed]}
    >
      {content}
    </Pressable>
  );
}

export default function PersonEntryScreen() {
  const { palette } = useTheme();
  const styles = useStyles();

  const { employeeId } = useLocalSearchParams<{ employeeId: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [openingConversation, setOpeningConversation] = React.useState(false);
  // One piece of state, not a pair of booleans: which of the two confirmations is
  // open is a single choice, and two flags can disagree.
  const [confirming, setConfirming] = React.useState<"block" | "unblock" | null>(null);

  const {
    data: entry,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["directory-entry", String(employeeId)],
    queryFn: () => getDirectoryEntry(String(employeeId)),
    enabled: Boolean(employeeId),
  });

  // ListBlockedPeople is the only call that answers "is this person blocked", by
  // design. Sharing the channel screen's query key means one invalidation after a
  // block settles every mounted screen, and the control flips here without a refetch.
  const { data: blockedData, isSuccess: blockListLoaded } = useQuery({
    queryKey: ["compliance", "blocked-people"],
    queryFn: () => listBlockedPeople(),
    staleTime: 60_000,
  });

  const callPerson = React.useCallback(async (phoneNumber: string) => {
    try {
      await Linking.openURL(telURI(phoneNumber));
    } catch {
      // The number stays on screen: it is still readable and still dialable by hand.
      Alert.alert(
        "Couldn't start the call",
        "This device could not open its dialer. The number is still shown above.",
      );
    }
  }, []);

  const messagePerson = React.useCallback(
    async (personId: string) => {
      if (openingConversation) return;
      setOpeningConversation(true);
      try {
        const result = await createOrGetDirectMessage(personId);
        // One action, no intermediate step: the conversation is created if it does not
        // exist and opened in the same tap.
        router.push(
          withNavigationContext(`/(app)/(chat)/${result.channel.id}`, {
            fallbackHref: "/(app)/(more)",
            ownerTab: "more",
            backLabel: "Person",
          }) as never,
        );
      } catch (err) {
        // Stay here with the person still on screen. Dropping somebody onto an empty
        // conversation screen is the failure FR-014 names.
        Alert.alert(
          "Couldn't open the conversation",
          err instanceof Error && err.message
            ? err.message
            : "Check your connection and try again.",
        );
      } finally {
        setOpeningConversation(false);
      }
    },
    [openingConversation, router],
  );

  const openDepartment = React.useCallback(
    (departmentId: string, departmentName: string) => {
      router.push(
        withNavigationContext(`/(app)/(more)/people/department/${departmentId}`, {
          fallbackHref: "/(app)/(more)/people",
          ownerTab: "more",
          backLabel: departmentName,
        }) as never,
      );
    },
    [router],
  );

  if (isLoading) {
    return <SkeletonList count={4} variant="double" />;
  }

  if (isError) {
    return (
      <EmptyState
        sfSymbol="exclamationmark.triangle"
        title="We couldn't load this person"
        subtitle={
          error instanceof Error && error.message
            ? error.message
            : "Check your connection and try again."
        }
        action={{ label: "Try again", onPress: () => void refetch() }}
      />
    );
  }

  if (!entry) {
    return (
      <EmptyState
        sfSymbol="person.slash"
        title="This person is no longer in your workspace"
        subtitle="They may have left, or their account may have been removed."
      />
    );
  }

  const name = directoryDisplayName(entry);
  const role = entry.roleNames[0];

  // `undefined` until the block list has resolved: a control that reads "Block" and
  // flips to "Unblock" a beat later is worse than one that arrives a beat late.
  const contactControl: "none" | "block" | "unblock" | undefined = !blockListLoaded
    ? undefined
    : entry.isSelf
      ? "none"
      : (blockedData?.blocked ?? []).some((person) => person.employeeId === entry.employeeId)
        ? "unblock"
        : "block";

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={styles.screen}
      contentContainerStyle={styles.content}
    >
      <View style={styles.header}>
        <View style={styles.avatarWrap}>
          <UserAvatar name={name || entry.employeeId} size={72} />
          <PresenceIndicator status={mapPresence(entry.presenceStatus)} size={16} />
        </View>
        <Text selectable style={styles.name}>
          {name}
        </Text>
        {entry.departmentId && entry.departmentName ? (
          <Pressable
            testID="person-department-row"
            onPress={() => openDepartment(entry.departmentId!, entry.departmentName!)}
            accessibilityRole="button"
            accessibilityLabel={`${entry.departmentName}, see who works here`}
            style={({ pressed }) => [styles.departmentPill, pressed && styles.rowPressed]}
          >
            <Text style={styles.departmentText}>{entry.departmentName}</Text>
            <SFIcon name="chevron.right" size={12} color={palette.primary.main} />
          </Pressable>
        ) : null}
        {role ? <Text style={styles.subtitle}>{role}</Text> : null}
        <Text style={styles.presence}>{presenceLabel(entry.presenceStatus)}</Text>
      </View>

      {/* Your own entry offers neither Message nor Call — you do not message yourself,
          and the profile screen is the one that can actually change anything. */}
      {entry.isSelf ? (
        <Button
          testID="person-open-profile"
          label="Open your profile"
          variant="secondary"
          onPress={() => router.push("/(app)/(more)/profile")}
        />
      ) : (
        <Button
          testID="person-message-button"
          label="Message"
          loading={openingConversation}
          onPress={() => void messagePerson(entry.employeeId)}
        />
      )}

      {contactControl === "block" ? (
        <Button
          testID="person-block-button"
          label="Block"
          variant="destructive"
          onPress={() => setConfirming("block")}
        />
      ) : contactControl === "unblock" ? (
        <Button
          testID="person-unblock-button"
          label="Unblock"
          variant="secondary"
          onPress={() => setConfirming("unblock")}
        />
      ) : null}

      {/* Absent fields render nothing at all — see the note at the top of this file. */}
      {entry.email || (entry.phoneNumber && !entry.isSelf) ? (
        <View style={styles.card}>
          {entry.email ? (
            <ContactRow
              testID="person-email-row"
              sfIcon="envelope"
              label="Email"
              value={entry.email}
            />
          ) : null}
          {entry.email && entry.phoneNumber && !entry.isSelf ? (
            <View style={styles.separator} />
          ) : null}
          {entry.phoneNumber && !entry.isSelf ? (
            <ContactRow
              testID="person-phone-row"
              sfIcon="phone"
              label="Phone"
              value={entry.phoneNumber}
              onPress={() => void callPerson(entry.phoneNumber!)}
            />
          ) : null}
        </View>
      ) : null}

      {/* Invalidating the shared key is what flips the control in place — no local
          state, no navigation away (FR-008). */}
      <BlockConfirm
        visible={confirming !== null}
        mode={confirming ?? "block"}
        employeeId={entry.employeeId}
        displayName={name || "this person"}
        onClose={() => setConfirming(null)}
        onDone={() => {
          void queryClient.invalidateQueries({
            queryKey: ["compliance", "blocked-people"],
          });
        }}
      />
    </ScrollView>
  );
}

const useStyles = makeStyles((t) => ({
  screen: {
    flex: 1,
    backgroundColor: t.background.default,
  },
  content: {
    padding: mobileLayout.screenPadding,
    gap: mobileLayout.cardGap,
    paddingBottom: spacing[6],
  },
  header: {
    alignItems: "center",
    gap: spacing[0.5],
    paddingVertical: spacing[2],
  },
  avatarWrap: {
    width: 72,
    height: 72,
    marginBottom: spacing[1],
  },
  name: {
    fontSize: mobileTypography.screenTitle.fontSize as number,
    fontWeight: "700",
    color: t.text.primary,
    textAlign: "center",
  },
  subtitle: {
    fontSize: mobileTypography.listSecondary.fontSize as number,
    color: t.text.secondary,
    textAlign: "center",
  },
  presence: {
    fontSize: mobileTypography.caption.fontSize as number,
    color: t.text.disabled,
  },
  departmentPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[0.5],
    paddingHorizontal: spacing[1.5],
    // A department is a door, so its target clears 44 pt like every other one.
    minHeight: 44,
  },
  departmentText: {
    fontSize: mobileTypography.listSecondary.fontSize as number,
    color: t.primary.main,
    fontWeight: "500",
  },
  card: {
    backgroundColor: t.background.paper,
    borderRadius: radius.md,
    borderCurve: "continuous",
    overflow: "hidden",
  },
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: mobileLayout.iconTextGap,
    paddingHorizontal: mobileLayout.cardPadding,
    paddingVertical: spacing[1.5],
    // Comfortably past 44 pt, including on a 360 dp Android phone.
    minHeight: mobileLayout.compactRowHeight,
  },
  rowPressed: {
    opacity: opacity.pressed,
  },
  contactIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderCurve: "continuous",
    backgroundColor: t.primary.main + "12",
    alignItems: "center",
    justifyContent: "center",
  },
  contactCopy: {
    flex: 1,
    gap: 2,
  },
  contactLabel: {
    fontSize: mobileTypography.caption.fontSize as number,
    color: t.text.secondary,
  },
  contactValue: {
    fontSize: mobileTypography.listPrimary.fontSize as number,
    color: t.text.primary,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: t.divider,
    marginLeft: mobileLayout.cardPadding,
  },
}));

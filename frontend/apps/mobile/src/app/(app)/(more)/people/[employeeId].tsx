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
import { useQuery } from "@tanstack/react-query";
import {
  createOrGetDirectMessage,
  directoryDisplayName,
  getDirectoryEntry,
} from "apis";
import { PresenceIndicator } from "@/components/common/presence-indicator";
import { UserAvatar } from "@/components/common/user-avatar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SFIcon } from "@/components/ui/sf-icon";
import { SkeletonList } from "@/components/ui/skeleton";
import { withNavigationContext } from "@/lib/mobile-navigation";
import {
  lightPalette,
  mobileLayout,
  mobileTypography,
  opacity,
  radius,
  spacing,
} from "@tech-office/theme-tokens";

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
  const content = (
    <>
      <View style={styles.contactIcon}>
        <SFIcon name={sfIcon} size={18} color={lightPalette.primary.main} />
      </View>
      <View style={styles.contactCopy}>
        <Text style={styles.contactLabel}>{label}</Text>
        <Text selectable style={styles.contactValue}>
          {value}
        </Text>
      </View>
      {onPress ? (
        <SFIcon name="chevron.right" size={14} color={lightPalette.text.disabled} />
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
  const { employeeId } = useLocalSearchParams<{ employeeId: string }>();
  const router = useRouter();
  const [openingConversation, setOpeningConversation] = React.useState(false);

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
            <SFIcon name="chevron.right" size={12} color={lightPalette.primary.main} />
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
    color: lightPalette.text.primary,
    textAlign: "center",
  },
  subtitle: {
    fontSize: mobileTypography.listSecondary.fontSize as number,
    color: lightPalette.text.secondary,
    textAlign: "center",
  },
  presence: {
    fontSize: mobileTypography.caption.fontSize as number,
    color: lightPalette.text.disabled,
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
    color: lightPalette.primary.main,
    fontWeight: "500",
  },
  card: {
    backgroundColor: lightPalette.background.paper,
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
    backgroundColor: lightPalette.primary.main + "12",
    alignItems: "center",
    justifyContent: "center",
  },
  contactCopy: {
    flex: 1,
    gap: 2,
  },
  contactLabel: {
    fontSize: mobileTypography.caption.fontSize as number,
    color: lightPalette.text.secondary,
  },
  contactValue: {
    fontSize: mobileTypography.listPrimary.fontSize as number,
    color: lightPalette.text.primary,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: lightPalette.divider,
    marginLeft: mobileLayout.cardPadding,
  },
});

/**
 * DirectoryRow — one colleague, as the People screens list them.
 *
 * Deliberately not a UserCard: UserCard resolves each person through useUserProfile
 * (one GetEmployeeCards request per id when the cache is cold) and its presence dot
 * through usePresence (a second request per row). A directory payload already carries
 * every field this row renders, so a 50-row page costs zero extra requests. Do not add
 * a hook here that fetches — that is the regression this component exists to prevent.
 *
 * The name never truncates. The department and the role share the second line and give
 * way first: on a 360 dp phone there is not room for all three, and the name is the
 * thing you came to read.
 */

import React from "react";
import { Pressable, Text, View } from "react-native";
import { directoryDisplayName, type DirectoryEntry } from "apis";
import { UserAvatar } from "@/components/common/user-avatar";
import { PresenceIndicator } from "@/components/common/presence-indicator";
import {
  mobileLayout,
  mobileTypography,
  opacity,
  spacing,
} from "@tech-office/theme-tokens";
import { makeStyles } from "@/lib/theme";

const AVATAR_SIZE = 40;

function mapPresence(status: string): "online" | "away" | "offline" {
  if (status === "online") return "online";
  if (status === "idle") return "away";
  return "offline";
}

/** Department first, then role: where somebody works locates them faster than what they are. */
function secondaryLine(entry: DirectoryEntry): string {
  return [entry.departmentName, entry.roleNames[0]].filter(Boolean).join(" · ");
}

interface DirectoryRowProps {
  entry: DirectoryEntry;
  onPress: () => void;
}

export function DirectoryRow({ entry, onPress }: DirectoryRowProps) {
  const styles = useStyles();

  const name = directoryDisplayName(entry);
  const secondary = secondaryLine(entry);

  return (
    <Pressable
      testID={`person-row-${entry.employeeId}`}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={secondary ? `${name}, ${secondary}` : name}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={styles.avatarWrap}>
        <UserAvatar name={name || entry.employeeId} size={AVATAR_SIZE} />
        <PresenceIndicator status={mapPresence(entry.presenceStatus)} />
      </View>
      <View style={styles.copy}>
        <Text style={styles.name}>{name}</Text>
        {secondary ? (
          <Text numberOfLines={1} style={styles.secondary}>
            {secondary}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: mobileLayout.iconTextGap,
    paddingHorizontal: mobileLayout.cardPadding,
    paddingVertical: spacing[1.5],
    // The whole row is the target, and it clears 44 pt on the narrowest phone.
    minHeight: mobileLayout.compactRowHeight,
    backgroundColor: t.background.paper,
  },
  rowPressed: {
    opacity: opacity.pressed,
  },
  avatarWrap: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
  },
  copy: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: mobileTypography.listPrimary.fontSize as number,
    fontWeight: mobileTypography.listPrimary.fontWeight as "500",
    color: t.text.primary,
  },
  secondary: {
    fontSize: mobileTypography.listSecondary.fontSize as number,
    lineHeight: mobileTypography.listSecondary.lineHeight as number,
    color: t.text.secondary,
  },
}));

/**
 * UserCard — reusable employee identity widget for mobile.
 *
 * Variants:
 * - compact:  Avatar + single-line name (chat rows, assignee pills)
 * - standard: Avatar + name + secondary text (search results, mentions)
 * - full:     Avatar + name + dept + email (profile card, org list)
 *
 * Fetches display data from useUserProfile (React Query backed).
 * Shows presence dot when showPresence is true.
 */

import React from "react";
import { View, Text, ActivityIndicator } from "react-native";
import { useUserProfile, type UserInfo } from "@/hooks/use-user-profile";
import { usePresence } from "@/hooks/use-presence";
import { UserAvatar } from "@/components/common/user-avatar";
import { PresenceIndicator } from "@/components/common/presence-indicator";
import {
  lightPalette,
  mobileTypography,
} from "@tech-office/theme-tokens";

type UserCardVariant = "compact" | "standard" | "full";

const AVATAR_SIZES: Record<UserCardVariant, number> = {
  compact: 32,
  standard: 40,
  full: 56,
};

function resolveDisplayName(user: UserInfo | undefined): string {
  if (!user) return "";
  if (user.displayName) return user.displayName;
  if (user.givenName || user.familyName)
    return `${user.givenName ?? ""} ${user.familyName ?? ""}`.trim();
  if (user.email) return user.email;
  return "";
}

function mapPresence(
  status: string | null,
): "online" | "away" | "offline" | null {
  if (status === "online") return "online";
  if (status === "idle") return "away";
  if (
    status === "offline" ||
    status === "online_hidden" ||
    status === "unspecified"
  )
    return "offline";
  return null;
}

interface UserCardProps {
  employeeId: string;
  userInfo?: Partial<Omit<UserInfo, "id">>;
  variant?: UserCardVariant;
  showPresence?: boolean;
  avatarSize?: number;
  avatarColor?: string;
  testID?: string;
}

export function UserCard({
  employeeId,
  userInfo,
  variant = "standard",
  showPresence = false,
  avatarSize,
  avatarColor = "#0f172a",
  testID,
}: UserCardProps) {
  const user = useUserProfile(employeeId, userInfo);
  const presenceStatus = usePresence(showPresence ? employeeId : undefined);
  const indicatorStatus = mapPresence(presenceStatus);

  const size = avatarSize ?? AVATAR_SIZES[variant];
  const name = resolveDisplayName(user);

  // ── compact ──────────────────────────────────────────────────────
  if (variant === "compact") {
    return (
      <View
        testID={testID}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
        }}
      >
        <View style={{ width: size, height: size }}>
          <UserAvatar
            name={name || employeeId}
            avatarUrl={user?.avatarUrl}
            size={size}
            color={avatarColor}
          />
          {showPresence && indicatorStatus ? (
            <PresenceIndicator status={indicatorStatus} size={8} />
          ) : null}
        </View>
        {name ? (
          <Text
            numberOfLines={1}
            style={{
              flex: 1,
              fontSize: 15,
              fontWeight: "500",
              color: lightPalette.text.primary,
            }}
          >
            {name}
          </Text>
        ) : (
          <View
            style={{
              width: 80,
              height: 14,
              borderRadius: 4,
              backgroundColor: lightPalette.divider,
            }}
          />
        )}
      </View>
    );
  }

  // ── standard ─────────────────────────────────────────────────────
  if (variant === "standard") {
    const secondary =
      user?.email ?? user?.departmentName ?? undefined;

    return (
      <View
        testID={testID}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
        }}
      >
        <View style={{ width: size, height: size }}>
          <UserAvatar
            name={name || employeeId}
            avatarUrl={user?.avatarUrl}
            size={size}
            color={avatarColor}
          />
          {showPresence && indicatorStatus ? (
            <PresenceIndicator status={indicatorStatus} />
          ) : null}
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          {name ? (
            <Text
              numberOfLines={1}
              style={{
                fontSize: 16,
                fontWeight: "600",
                color: lightPalette.text.primary,
              }}
            >
              {name}
            </Text>
          ) : (
            <View
              style={{
                width: 120,
                height: 16,
                borderRadius: 4,
                backgroundColor: lightPalette.divider,
              }}
            />
          )}
          {secondary ? (
            <Text
              numberOfLines={1}
              style={{
                fontSize: 13,
                color: lightPalette.text.secondary,
              }}
            >
              {secondary}
            </Text>
          ) : user === undefined ? (
            <View
              style={{
                width: 80,
                height: 12,
                borderRadius: 4,
                backgroundColor: lightPalette.divider,
              }}
            />
          ) : null}
        </View>
      </View>
    );
  }

  // ── full ─────────────────────────────────────────────────────────
  const fullName =
    user?.givenName && user?.familyName
      ? `${user.givenName} ${user.familyName}`
      : name;

  return (
    <View
      testID={testID}
      style={{
        alignItems: "center",
        gap: 12,
      }}
    >
      <View style={{ width: size, height: size }}>
        <UserAvatar
          name={fullName || employeeId}
          avatarUrl={user?.avatarUrl}
          size={size}
          color={avatarColor}
        />
        {showPresence && indicatorStatus ? (
          <PresenceIndicator status={indicatorStatus} size={12} />
        ) : null}
      </View>

      <View style={{ alignItems: "center", gap: 4 }}>
        {fullName ? (
          <Text
            numberOfLines={1}
            style={{
              fontSize: 20,
              fontWeight: "700",
              color: lightPalette.text.primary,
            }}
          >
            {fullName}
          </Text>
        ) : (
          <View
            style={{
              width: 140,
              height: 20,
              borderRadius: 4,
              backgroundColor: lightPalette.divider,
            }}
          />
        )}

        {user?.departmentName ? (
          <Text
            numberOfLines={1}
            style={{
              fontSize: 14,
              color: lightPalette.text.secondary,
            }}
          >
            {user.departmentName}
          </Text>
        ) : null}

        {user?.email ? (
          <Text
            selectable
            numberOfLines={1}
            style={{
              fontSize: 14,
              color: lightPalette.text.secondary,
            }}
          >
            {user.email}
          </Text>
        ) : null}

        {user?.isActive === false ? (
          <View
            style={{
              paddingHorizontal: 8,
              paddingVertical: 2,
              borderRadius: 4,
              backgroundColor: lightPalette.text.disabled + "20",
            }}
          >
            <Text
              style={{
                fontSize: 11,
                fontWeight: "600",
                color: lightPalette.text.disabled,
                textTransform: "uppercase",
                letterSpacing: 0.5,
              }}
            >
              Inactive
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

/**
 * Profile screen
 */

import React from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";
import { AuthContext } from "@/hooks/use-auth";
import { UserCard } from "@/components/common/user-card";
import { useUserProfile } from "@/hooks/use-user-profile";
import { SFIcon } from "@/components/ui/sf-icon";
import {
  border,
  lightPalette,
  mobileLayout,
  mobileTypography,
  radius,
  spacing,
} from "@tech-office/theme-tokens";

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={profileStyles.infoRow}>
      <Text style={profileStyles.infoLabel}>{label}</Text>
      <Text selectable style={profileStyles.infoValue}>{value}</Text>
    </View>
  );
}

export default function ProfileScreen() {
  const auth = React.use(AuthContext);
  const employeeId = auth?.employeeId ?? "";
  const user = useUserProfile(employeeId);

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={profileStyles.container}
      contentContainerStyle={profileStyles.scrollContent}
    >
      {/* User identity card */}
      <View style={profileStyles.identityCard}>
        <UserCard
          employeeId={employeeId}
          variant="full"
          showPresence
          avatarSize={72}
          testID="profile-user-card"
        />
      </View>

      {/* Details section */}
      <View style={profileStyles.detailsCard}>
        {user?.departmentName ? (
          <InfoRow label="Department" value={user.departmentName} />
        ) : null}
        {user?.email ? (
          <InfoRow label="Email" value={user.email} />
        ) : null}
        <InfoRow label="Employee ID" value={auth?.employeeId ?? "—"} />
        <InfoRow label="Organization" value={auth?.organizationId ?? "—"} />
      </View>
    </ScrollView>
  );
}

const profileStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: lightPalette.background.default,
  },
  scrollContent: {
    padding: mobileLayout.screenPadding,
    gap: mobileLayout.cardGap,
  },
  identityCard: {
    backgroundColor: lightPalette.background.paper,
    borderRadius: radius.lg,
    borderCurve: "continuous",
    borderWidth: border.thin,
    borderColor: lightPalette.divider,
    padding: 20,
    alignItems: "center",
  },
  detailsCard: {
    backgroundColor: lightPalette.background.paper,
    borderRadius: radius.md,
    borderCurve: "continuous",
    borderWidth: border.thin,
    borderColor: lightPalette.divider,
    padding: mobileLayout.cardPadding,
    gap: 16,
  },
  infoRow: {
    gap: 2,
  },
  infoLabel: {
    fontSize: mobileTypography.caption.fontSize as number,
    fontWeight: "600" as const,
    color: lightPalette.text.secondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  infoValue: {
    fontSize: mobileTypography.listPrimary.fontSize as number,
    color: lightPalette.text.primary,
  },
});

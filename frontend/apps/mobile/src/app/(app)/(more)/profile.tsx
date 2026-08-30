/**
 * Profile — the screen behind "Edit Profile" on the More tab.
 *
 * It used to be read-only despite that label, and it filled its detail rows with
 * the employee and organization UUIDs. Neither is something a person can act on,
 * so the screen now does the one thing its entry point promises: it lets you
 * change your display name, and it names your organization and role in words.
 */

import React from "react";
import {
  ActivityIndicator,
  Keyboard,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { updateProfile } from "apis";
import { AuthContext } from "@/hooks/use-auth";
import { useCurrentMembership } from "@/hooks/use-current-membership";
import { useUserProfile, userProfileQueryKey } from "@/hooks/use-user-profile";
import { UserCard } from "@/components/common/user-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  border,
  lightPalette,
  mobileLayout,
  mobileTypography,
  radius,
  spacing,
} from "@tech-office/theme-tokens";

const MAX_DISPLAY_NAME = 64;

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text selectable style={styles.infoValue}>
        {value}
      </Text>
    </View>
  );
}

export default function ProfileScreen() {
  const auth = React.use(AuthContext);
  const queryClient = useQueryClient();
  const employeeId = auth?.employeeId ?? "";
  const user = useUserProfile(employeeId);
  const { membership, isLoading: membershipLoading } = useCurrentMembership();

  const serverName =
    user?.displayName ||
    [user?.givenName, user?.familyName].filter(Boolean).join(" ");

  const [name, setName] = React.useState(serverName);
  const [touched, setTouched] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");
  const [saved, setSaved] = React.useState(false);

  // Seed the field once the profile arrives, but never overwrite what the person
  // has already typed into it.
  React.useEffect(() => {
    if (!touched) setName(serverName);
  }, [serverName, touched]);

  const trimmed = name.trim();
  const isDirty = trimmed !== serverName.trim();
  const canSave = isDirty && trimmed.length > 0 && !saving;

  const save = async () => {
    if (!canSave) return;
    Keyboard.dismiss();
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      await updateProfile(trimmed);
      // The name is rendered from the employee-card cache everywhere else in the
      // app, so the save has to land there too or the change looks lost.
      queryClient.setQueryData(userProfileQueryKey(employeeId), (prev: unknown) =>
        prev ? { ...(prev as object), displayName: trimmed } : prev,
      );
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
      setTouched(false);
      setSaved(true);
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : "We couldn't save your name. Try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
    >
      <View style={styles.identityCard}>
        <UserCard
          employeeId={employeeId}
          variant="full"
          showPresence
          avatarSize={72}
          testID="profile-user-card"
        />
      </View>

      <Card style={styles.editCard}>
        <Text style={styles.infoLabel}>Display name</Text>
        <TextInput
          testID="profile-display-name-input"
          value={name}
          onChangeText={(next) => {
            setTouched(true);
            setSaved(false);
            setName(next);
          }}
          maxLength={MAX_DISPLAY_NAME}
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={() => void save()}
          placeholder="How your name appears to colleagues"
          placeholderTextColor={lightPalette.text.disabled}
          style={styles.input}
        />
        <Text style={styles.hint}>
          This is the name on your messages, tasks and calendar events.
        </Text>

        {error ? (
          <Text selectable style={styles.error} testID="profile-error">
            {error}
          </Text>
        ) : null}
        {saved && !isDirty ? (
          <Text style={styles.saved} testID="profile-saved">
            Saved.
          </Text>
        ) : null}

        <Button
          testID="profile-save-button"
          label="Save"
          loading={saving}
          disabled={!canSave}
          onPress={() => void save()}
        />
      </Card>

      <Card style={styles.detailsCard}>
        {user?.email ? <InfoRow label="Email" value={user.email} /> : null}
        {user?.departmentName ? (
          <InfoRow label="Department" value={user.departmentName} />
        ) : null}
        {membershipLoading && !membership ? (
          <ActivityIndicator color={lightPalette.text.secondary} />
        ) : (
          <>
            <InfoRow
              label="Organization"
              value={membership?.organizationName ?? "—"}
            />
            {membership?.roleNames.length ? (
              <InfoRow label="Role" value={membership.roleNames.join(", ")} />
            ) : null}
          </>
        )}
      </Card>

      <Text style={styles.caption}>
        Your email, department and role are managed by the people who run this
        workspace. Ask them if any of it is wrong.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: lightPalette.background.default,
  },
  scrollContent: {
    padding: mobileLayout.screenPadding,
    gap: mobileLayout.cardGap,
    paddingBottom: spacing[6],
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
  editCard: {
    gap: spacing[1.5],
  },
  detailsCard: {
    gap: 16,
  },
  input: {
    minHeight: 48,
    borderWidth: border.thin,
    borderColor: lightPalette.divider,
    borderRadius: radius.md,
    borderCurve: "continuous",
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    backgroundColor: lightPalette.background.default,
    color: lightPalette.text.primary,
    fontSize: mobileTypography.listPrimary.fontSize as number,
  },
  hint: {
    fontSize: mobileTypography.caption.fontSize as number,
    lineHeight: mobileTypography.caption.lineHeight as number,
    color: lightPalette.text.secondary,
  },
  error: {
    fontSize: mobileTypography.listSecondary.fontSize as number,
    color: lightPalette.error.main,
  },
  saved: {
    fontSize: mobileTypography.listSecondary.fontSize as number,
    color: lightPalette.success.main,
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
  caption: {
    paddingHorizontal: 4,
    fontSize: mobileTypography.caption.fontSize as number,
    lineHeight: mobileTypography.caption.lineHeight as number,
    color: lightPalette.text.secondary,
  },
});

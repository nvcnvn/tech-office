/**
 * Settings screen — appearance, notification preferences, and account actions.
 *
 * Appearance is a device choice; notification preferences follow the person's account,
 * so they read the same on every handset they sign in to.
 */

import React from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  Switch,
  Text,
  View,
} from "react-native";
import Constants from "expo-constants";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { openBrowserAsync } from "expo-web-browser";
import {
  ABUSE_CONTACT_EMAIL,
  PRIVACY_POLICY_PATH,
  SOURCE_DOMAINS,
  TERMS_PATH,
  getAccountRemovalPath,
  type AccountRemovalPath,
  type SourceDomain,
} from "apis";
import { Linking } from "react-native";
import { Card } from "@/components/ui/card";
import { SFIcon } from "@/components/ui/sf-icon";
import { AuthContext } from "@/hooks/use-auth";
import { useCurrentMembership } from "@/hooks/use-current-membership";
import { useNotificationPreferences } from "@/hooks/use-notification-preferences";
import { useUserProfile } from "@/hooks/use-user-profile";
import { buildWebUrl } from "@/lib/constants";
import {
  mobileLayout,
  mobileTypography,
  opacity,
  profileIcons,
  radius,
  spacing,
  statusColors,
} from "@tech-office/theme-tokens";
import { makeStyles, useTheme } from "@/lib/theme";

/**
 * How each source domain is named and pictured in the mute list.
 *
 * The workspace's own words, not the wire values: somebody looking for calendar
 * noise should not have to know that tasks are spelled `projects`. This map is UI
 * copy and lives beside the screen; the domain list itself is a cross-stack
 * constant and lives in `apis`.
 */
const MUTE_ROWS: Record<SourceDomain, { label: string; icon: string }> = {
  chat: { label: "Chat", icon: "bubble.left.and.bubble.right.fill" },
  projects: { label: "Tasks and projects", icon: "checklist" },
  calendar: { label: "Calendar", icon: "calendar" },
  docs: { label: "Documents", icon: "doc.text.fill" },
  system: { label: "System", icon: "gearshape.fill" },
};

/**
 * The version a support conversation can act on. Read from the app manifest
 * rather than retyped in this file, where the old hardcoded "v0.1.0" would have
 * gone on claiming 0.1.0 for every release after it.
 */
function appVersionLabel(): string {
  const version = Constants.expoConfig?.version ?? "unknown";
  const runtime = Constants.expoConfig?.runtimeVersion;
  return typeof runtime === "string" ? `${version} (${runtime})` : version;
}

function SettingSectionLabel({ label }: { label: string }) {
  const styles = useStyles();

  return <Text style={styles.sectionLabel}>{label}</Text>;
}

function SettingRow({
  icon,
  title,
  subtitle,
  trailing,
  onPress,
  destructive = false,
  testID,
  accessibilityValue,
}: {
  icon: string;
  title: string;
  subtitle?: string;
  trailing?: React.ReactNode;
  onPress?: () => void;
  destructive?: boolean;
  testID?: string;
  /** Lets a row report its state to a blackbox driver, which cannot sample a colour. */
  accessibilityValue?: { text: string };
}) {
  const { palette } = useTheme();
  const styles = useStyles();

  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      testID={testID}
      accessibilityValue={accessibilityValue}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.row, pressed && onPress ? styles.rowPressed : null]}
    >
      <View style={[styles.iconWrap, destructive ? styles.iconWrapDanger : null]}>
        <SFIcon
          name={icon}
          size={18}
          color={destructive ? palette.error.main : palette.text.secondary}
        />
      </View>

      <View style={styles.rowCopy}>
        <Text selectable style={[styles.rowTitle, destructive ? styles.rowTitleDanger : null]}>
          {title}
        </Text>
        {subtitle ? (
          <Text selectable style={styles.rowSubtitle}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      {trailing ? (
        <View style={styles.rowTrailing}>{trailing}</View>
      ) : onPress ? (
        <SFIcon name="chevron.right" size={14} color={palette.text.disabled} />
      ) : null}
    </Pressable>
  );
}

export default function SettingsScreen() {
  const { palette, mode, setMode, settling } = useTheme();
  const styles = useStyles();

  const auth = React.use(AuthContext);
  const router = useRouter();
  const { membership } = useCurrentMembership();
  const user = useUserProfile(auth?.employeeId);
  const displayName =
    user?.displayName ||
    [user?.givenName, user?.familyName].filter(Boolean).join(" ");
  const {
    preferences,
    loading: preferencesLoading,
    saving: preferencesSaving,
    isMuted,
    setInAppAlerts,
    setDomainMuted,
  } = useNotificationPreferences();
  // While the record is loading every switch shows its default and is disabled:
  // nobody should act on, or believe, a value the server has not confirmed. While
  // a write is in flight the whole section is disabled so a second tap cannot
  // race the first — the switch that was touched has already moved.
  const notificationControlsDisabled = preferencesLoading || preferencesSaving;
  // Which of the two account-ending paths this person gets. Asked of the server
  // rather than inferred, so mobile and web cannot disagree about it (FR-007b).
  const [removalPath, setRemovalPath] = React.useState<AccountRemovalPath | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const path = await getAccountRemovalPath();
        if (!cancelled) setRemovalPath(path.path);
      } catch {
        // The row is hidden rather than guessed if this fails: offering the wrong
        // path is worse than offering none until the next visit.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const runSelectionHaptic = () => {
    if (process.env.EXPO_OS === "ios") {
      void Haptics.selectionAsync();
    }
  };

  const [themeSaving, setThemeSaving] = React.useState(false);

  /**
   * The app repaints on the press, before the write settles — the theme provider
   * updates optimistically and rolls back if the write fails. So the only thing
   * left to do here is say so when it does: an app showing one theme while the
   * server stores the other is worse than a change that was refused out loud.
   */
  const handleThemeToggle = (wantsDark: boolean) => {
    if (themeSaving) return;
    setThemeSaving(true);
    runSelectionHaptic();
    void setMode(wantsDark ? "dark" : "light")
      .catch(() => {
        Alert.alert(
          "Couldn't change the theme",
          "We couldn't save that just now, so it has been put back. Check your connection and try again.",
        );
      })
      .finally(() => setThemeSaving(false));
  };

  const handleInAppAlertsToggle = (value: boolean) => {
    if (notificationControlsDisabled) return;
    runSelectionHaptic();
    void setInAppAlerts(value);
  };

  const handleMuteToggle = (domain: SourceDomain, muted: boolean) => {
    if (notificationControlsDisabled) return;
    runSelectionHaptic();
    void setDomainMuted(domain, muted);
  };

  const handleSignOut = () => {
    Alert.alert("Sign Out", "You will need to sign in again on this device.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: () => auth?.signOut(),
      },
    ]);
  };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={styles.screen}
      contentContainerStyle={styles.content}
    >
      <Card style={styles.summaryCard}>
        <View style={styles.summaryHeader}>
          <View style={styles.summaryIconWrap}>
            <SFIcon name="gearshape.fill" size={18} color={palette.primary.main} />
          </View>
          <View style={styles.summaryCopy}>
            <Text selectable style={styles.summaryTitle}>Preferences</Text>
            <Text selectable style={styles.summarySubtitle}>
              Keep the app readable, predictable, and easy to use. Notification settings
              follow your account; appearance stays on this device.
            </Text>
          </View>
        </View>

        <View style={styles.identityBlock}>
          <Text style={styles.identityLabel}>Signed in as</Text>
          <Text selectable style={styles.identityValue}>
            {displayName || "Unknown user"}
          </Text>
          <Text selectable style={styles.identityMeta}>
            {membership?.organizationName ?? "No organization selected"}
          </Text>
        </View>
      </Card>

      <View style={styles.section}>
        <SettingSectionLabel label="Appearance" />
        <Card padding={0} style={styles.groupCard}>
          <SettingRow
            testID="theme-toggle-row"
            accessibilityValue={{ text: mode }}
            icon="moon.fill"
            title="Dark Mode"
            subtitle="Until you choose, the app follows this phone. Once you choose, it stays where you put it."
            trailing={
              <Switch
                testID="theme-toggle-switch"
                value={mode === "dark"}
                onValueChange={handleThemeToggle}
                disabled={themeSaving || settling}
                trackColor={{ false: palette.divider, true: palette.primary.light }}
                thumbColor={mode === "dark" ? palette.primary.main : palette.background.paper}
              />
            }
            onPress={() => handleThemeToggle(mode !== "dark")}
          />
        </Card>
      </View>

      <View style={styles.section}>
        <SettingSectionLabel label="Notifications" />
        <Card padding={0} style={styles.groupCard}>
          <SettingRow
            testID="setting-in-app-alerts"
            accessibilityValue={{ text: preferences.inAppAlertsEnabled ? "on" : "off" }}
            icon="bell.fill"
            title="In-App Alerts"
            subtitle="Show banners while you're using the app. Your alerts list, unread badges and phone notifications are not affected."
            trailing={
              <Switch
                testID="setting-in-app-alerts-switch"
                value={preferences.inAppAlertsEnabled}
                onValueChange={handleInAppAlertsToggle}
                disabled={notificationControlsDisabled}
                trackColor={{ false: palette.divider, true: palette.primary.light }}
                thumbColor={
                  preferences.inAppAlertsEnabled ? palette.primary.main : palette.background.paper
                }
              />
            }
            onPress={() => handleInAppAlertsToggle(!preferences.inAppAlertsEnabled)}
          />
        </Card>

        <Text selectable style={styles.muteIntro} testID="setting-mute-intro">
          Muting an area stops the phone notification for it. The alert still arrives in your list.
          Mentions and incoming calls always come through.
        </Text>
        <Card padding={0} style={styles.groupCard}>
          {SOURCE_DOMAINS.map((domain) => {
            const { label, icon } = MUTE_ROWS[domain];
            const muted = isMuted(domain);
            return (
              <SettingRow
                key={domain}
                testID={`setting-mute-${domain}`}
                accessibilityValue={{ text: muted ? "muted" : "not muted" }}
                icon={icon}
                title={label}
                trailing={
                  <Switch
                    testID={`setting-mute-${domain}-switch`}
                    value={muted}
                    onValueChange={(next) => handleMuteToggle(domain, next)}
                    disabled={notificationControlsDisabled}
                    trackColor={{ false: palette.divider, true: palette.primary.light }}
                    thumbColor={muted ? palette.primary.main : palette.background.paper}
                  />
                }
                onPress={() => handleMuteToggle(domain, !muted)}
              />
            );
          })}
        </Card>
      </View>

      <View style={styles.section}>
        <SettingSectionLabel label="Safety" />
        <Card padding={0} style={styles.groupCard}>
          <SettingRow
            testID="setting-blocked-people"
            icon="hand.raised.fill"
            title="Blocked people"
            subtitle="See who you've blocked from messaging or calling you."
            onPress={() => router.push("/(app)/(more)/blocked")}
          />
          <SettingRow
            testID="setting-report-abuse"
            icon="envelope.fill"
            title="Report abuse"
            subtitle="Reporting inside the app is faster — this is for when you can't."
            onPress={() => void Linking.openURL(`mailto:${ABUSE_CONTACT_EMAIL}`)}
          />
        </Card>
      </View>

      <View style={styles.section}>
        <SettingSectionLabel label="Legal" />
        <Card padding={0} style={styles.groupCard}>
          <SettingRow
            testID="setting-privacy-policy"
            icon="lock.shield.fill"
            title="Privacy policy"
            subtitle="What we collect, why, and how to have it deleted."
            onPress={() => void openBrowserAsync(buildWebUrl(PRIVACY_POLICY_PATH))}
          />
          <SettingRow
            testID="setting-terms"
            icon="doc.text.fill"
            title="Terms of service"
            subtitle="The rules for using Tech Office, and what isn't allowed in it."
            onPress={() => void openBrowserAsync(buildWebUrl(TERMS_PATH))}
          />
        </Card>
      </View>

      <View style={styles.section}>
        <SettingSectionLabel label="Account" />
        <Card padding={0} style={styles.groupCard}>
          {removalPath === "self_delete" ? (
            <SettingRow
              testID="setting-delete-account"
              icon="trash.fill"
              title="Delete my account"
              subtitle="Permanently erase your account. This can't be undone."
              destructive
              onPress={() => router.push("/(app)/(more)/delete-account")}
            />
          ) : null}
          {removalPath === "request_removal" ? (
            <SettingRow
              testID="setting-request-removal"
              icon="person.crop.circle.badge.minus"
              title="Remove my account"
              subtitle="Ask the people who run this workspace to remove your account."
              onPress={() => router.push("/(app)/(more)/request-removal")}
            />
          ) : null}
          <SettingRow
            testID="setting-sign-out"
            icon={profileIcons.signOut.name}
            title="Sign Out"
            subtitle="Remove your session from this device."
            destructive
            onPress={handleSignOut}
          />
        </Card>
      </View>

      <Card style={styles.infoCard}>
        <View style={styles.infoRow}>
          <SFIcon name="info.circle" size={16} color={palette.text.secondary} />
          <Text selectable style={styles.infoText} testID="settings-app-version">
            Tech Office {appVersionLabel()}
          </Text>
        </View>
        <Text selectable style={styles.infoCaption}>
          Your notification preferences follow your account, so they are the same on
          every device you sign in to. Tell support this version number if something
          here misbehaves.
        </Text>
      </Card>
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
  summaryCard: {
    gap: spacing[2],
  },
  summaryHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: mobileLayout.iconTextGap,
  },
  summaryIconWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: statusColors.info[t.mode].bg,
  },
  summaryCopy: {
    flex: 1,
    gap: 2,
  },
  summaryTitle: {
    fontSize: mobileTypography.sectionHeader.fontSize,
    lineHeight: mobileTypography.sectionHeader.lineHeight,
    fontWeight: mobileTypography.sectionHeader.fontWeight,
    color: t.text.primary,
  },
  summarySubtitle: {
    fontSize: mobileTypography.listSecondary.fontSize,
    lineHeight: mobileTypography.listSecondary.lineHeight,
    color: t.text.secondary,
  },
  identityBlock: {
    gap: 2,
  },
  identityLabel: {
    fontSize: mobileTypography.caption.fontSize,
    lineHeight: mobileTypography.caption.lineHeight,
    color: t.text.secondary,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  identityValue: {
    fontSize: mobileTypography.listPrimary.fontSize,
    lineHeight: mobileTypography.listPrimary.lineHeight,
    fontWeight: mobileTypography.listPrimary.fontWeight,
    color: t.text.primary,
  },
  identityMeta: {
    fontSize: mobileTypography.listSecondary.fontSize,
    lineHeight: mobileTypography.listSecondary.lineHeight,
    color: t.text.secondary,
  },
  section: {
    gap: spacing[1],
  },
  sectionLabel: {
    paddingLeft: 4,
    fontSize: mobileTypography.caption.fontSize,
    lineHeight: mobileTypography.caption.lineHeight,
    fontWeight: mobileTypography.buttonSm.fontWeight,
    color: t.text.secondary,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  groupCard: {
    overflow: "hidden",
  },
  muteIntro: {
    paddingHorizontal: 4,
    paddingTop: spacing[1],
    fontSize: mobileTypography.listSecondary.fontSize,
    lineHeight: mobileTypography.listSecondary.lineHeight,
    color: t.text.secondary,
  },
  row: {
    minHeight: mobileLayout.compactRowHeight,
    flexDirection: "row",
    alignItems: "center",
    gap: mobileLayout.iconTextGap,
    paddingHorizontal: mobileLayout.cardPadding,
    paddingVertical: 14,
  },
  rowPressed: {
    opacity: opacity.pressed,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: radius.base,
    backgroundColor: t.background.default,
    alignItems: "center",
    justifyContent: "center",
  },
  iconWrapDanger: {
    backgroundColor: statusColors.error[t.mode].bg,
  },
  rowCopy: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontSize: mobileTypography.listPrimary.fontSize,
    lineHeight: mobileTypography.listPrimary.lineHeight,
    fontWeight: mobileTypography.listPrimary.fontWeight,
    color: t.text.primary,
  },
  rowTitleDanger: {
    color: t.error.main,
  },
  rowSubtitle: {
    fontSize: mobileTypography.listSecondary.fontSize,
    lineHeight: mobileTypography.listSecondary.lineHeight,
    color: t.text.secondary,
  },
  rowTrailing: {
    marginLeft: spacing[1],
  },
  infoCard: {
    gap: spacing[0.5],
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
  },
  infoText: {
    fontSize: mobileTypography.listSecondary.fontSize,
    lineHeight: mobileTypography.listSecondary.lineHeight,
    color: t.text.primary,
  },
  infoCaption: {
    fontSize: mobileTypography.caption.fontSize,
    lineHeight: mobileTypography.caption.lineHeight,
    color: t.text.secondary,
  },
}));

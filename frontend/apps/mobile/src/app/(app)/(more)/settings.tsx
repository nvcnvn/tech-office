/**
 * Settings screen — device-level preferences and account actions
 */

import React from "react";
import {
  Alert,
  Appearance,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { MMKV } from "react-native-mmkv";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SFIcon } from "@/components/ui/sf-icon";
import { AuthContext } from "@/hooks/use-auth";
import {
  lightPalette,
  mobileLayout,
  mobileTypography,
  opacity,
  profileIcons,
  radius,
  spacing,
} from "@tech-office/theme-tokens";

const settingsStorage = new MMKV({ id: "app-settings" });
const THEME_KEY = "color_scheme";
const NOTIFICATIONS_KEY = "notifications_enabled";

function getInitialDarkMode(): boolean {
  const stored = settingsStorage.getString(THEME_KEY);
  if (stored === "dark") return true;
  if (stored === "light") return false;
  return Appearance.getColorScheme() === "dark";
}

function getInitialNotificationsEnabled(): boolean {
  return settingsStorage.getBoolean(NOTIFICATIONS_KEY) ?? true;
}

function SettingSectionLabel({ label }: { label: string }) {
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
}: {
  icon: string;
  title: string;
  subtitle?: string;
  trailing?: React.ReactNode;
  onPress?: () => void;
  destructive?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      testID={testID}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.row, pressed && onPress ? styles.rowPressed : null]}
    >
      <View style={[styles.iconWrap, destructive ? styles.iconWrapDanger : null]}>
        <SFIcon
          name={icon}
          size={18}
          color={destructive ? lightPalette.error.main : lightPalette.text.secondary}
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

      {trailing ? <View style={styles.rowTrailing}>{trailing}</View> : null}
    </Pressable>
  );
}

export default function SettingsScreen() {
  const auth = React.use(AuthContext);
  const [darkMode, setDarkMode] = React.useState(getInitialDarkMode);
  const [notificationsEnabled, setNotificationsEnabled] = React.useState(
    getInitialNotificationsEnabled,
  );

  const runSelectionHaptic = () => {
    if (process.env.EXPO_OS === "ios") {
      void Haptics.selectionAsync();
    }
  };

  const handleThemeToggle = (value: boolean) => {
    setDarkMode(value);
    const scheme = value ? "dark" : "light";
    settingsStorage.set(THEME_KEY, scheme);
    Appearance.setColorScheme(scheme);
    runSelectionHaptic();
  };

  const handleNotificationsToggle = (value: boolean) => {
    setNotificationsEnabled(value);
    settingsStorage.set(NOTIFICATIONS_KEY, value);
    runSelectionHaptic();
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
            <SFIcon name="gearshape.fill" size={18} color={lightPalette.primary.main} />
          </View>
          <View style={styles.summaryCopy}>
            <Text selectable style={styles.summaryTitle}>Device Preferences</Text>
            <Text selectable style={styles.summarySubtitle}>
              Keep the app readable, predictable, and easy to use on this device.
            </Text>
          </View>
        </View>

        <View style={styles.identityBlock}>
          <Text style={styles.identityLabel}>Signed in as</Text>
          <Text selectable style={styles.identityValue}>
            {auth?.employeeId ?? "Unknown user"}
          </Text>
          <Text selectable style={styles.identityMeta}>
            {auth?.organizationId ?? "No organization selected"}
          </Text>
        </View>
      </Card>

      <View style={styles.section}>
        <SettingSectionLabel label="Appearance" />
        <Card padding={0} style={styles.groupCard}>
          <SettingRow
            testID="setting-dark-mode"
            icon="moon.fill"
            title="Dark Mode"
            subtitle="Use the darker color scheme across the app."
            trailing={
              <Switch
                value={darkMode}
                onValueChange={handleThemeToggle}
                trackColor={{ false: "#d5dbe3", true: lightPalette.primary.light }}
                thumbColor={darkMode ? lightPalette.primary.main : "#ffffff"}
              />
            }
            onPress={() => handleThemeToggle(!darkMode)}
          />
        </Card>
      </View>

      <View style={styles.section}>
        <SettingSectionLabel label="Notifications" />
        <Card padding={0} style={styles.groupCard}>
          <SettingRow
            icon="bell.fill"
            title="In-App Alerts"
            subtitle="Show live notification banners while you are using the app."
            trailing={
              <Switch
                value={notificationsEnabled}
                onValueChange={handleNotificationsToggle}
                trackColor={{ false: "#d5dbe3", true: lightPalette.primary.light }}
                thumbColor={notificationsEnabled ? lightPalette.primary.main : "#ffffff"}
              />
            }
            onPress={() => handleNotificationsToggle(!notificationsEnabled)}
          />
        </Card>
      </View>

      <View style={styles.section}>
        <SettingSectionLabel label="Account" />
        <Card padding={0} style={styles.groupCard}>
          <SettingRow
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
          <SFIcon name="info.circle" size={16} color={lightPalette.text.secondary} />
          <Text selectable style={styles.infoText}>Tech Office v0.1.0</Text>
        </View>
        <Text selectable style={styles.infoCaption}>
          Theme and alert preferences are stored on this device.
        </Text>
      </Card>

      <View style={styles.footerAction}>
        <Button label="Sign Out" variant="destructive" onPress={handleSignOut} />
      </View>
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
    backgroundColor: "#eef5fc",
  },
  summaryCopy: {
    flex: 1,
    gap: 2,
  },
  summaryTitle: {
    fontSize: mobileTypography.sectionHeader.fontSize,
    lineHeight: mobileTypography.sectionHeader.lineHeight,
    fontWeight: mobileTypography.sectionHeader.fontWeight,
    color: lightPalette.text.primary,
  },
  summarySubtitle: {
    fontSize: mobileTypography.listSecondary.fontSize,
    lineHeight: mobileTypography.listSecondary.lineHeight,
    color: lightPalette.text.secondary,
  },
  identityBlock: {
    gap: 2,
  },
  identityLabel: {
    fontSize: mobileTypography.caption.fontSize,
    lineHeight: mobileTypography.caption.lineHeight,
    color: lightPalette.text.secondary,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  identityValue: {
    fontSize: mobileTypography.listPrimary.fontSize,
    lineHeight: mobileTypography.listPrimary.lineHeight,
    fontWeight: mobileTypography.listPrimary.fontWeight,
    color: lightPalette.text.primary,
  },
  identityMeta: {
    fontSize: mobileTypography.listSecondary.fontSize,
    lineHeight: mobileTypography.listSecondary.lineHeight,
    color: lightPalette.text.secondary,
  },
  section: {
    gap: spacing[1],
  },
  sectionLabel: {
    paddingLeft: 4,
    fontSize: mobileTypography.caption.fontSize,
    lineHeight: mobileTypography.caption.lineHeight,
    fontWeight: mobileTypography.buttonSm.fontWeight,
    color: lightPalette.text.secondary,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  groupCard: {
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
  rowPressed: {
    opacity: opacity.pressed,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: radius.base,
    backgroundColor: lightPalette.background.default,
    alignItems: "center",
    justifyContent: "center",
  },
  iconWrapDanger: {
    backgroundColor: "#fceceb",
  },
  rowCopy: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontSize: mobileTypography.listPrimary.fontSize,
    lineHeight: mobileTypography.listPrimary.lineHeight,
    fontWeight: mobileTypography.listPrimary.fontWeight,
    color: lightPalette.text.primary,
  },
  rowTitleDanger: {
    color: lightPalette.error.main,
  },
  rowSubtitle: {
    fontSize: mobileTypography.listSecondary.fontSize,
    lineHeight: mobileTypography.listSecondary.lineHeight,
    color: lightPalette.text.secondary,
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
    color: lightPalette.text.primary,
  },
  infoCaption: {
    fontSize: mobileTypography.caption.fontSize,
    lineHeight: mobileTypography.caption.lineHeight,
    color: lightPalette.text.secondary,
  },
  footerAction: {
    paddingTop: spacing[1],
  },
});

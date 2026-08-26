/**
 * More tab — profile card + grouped menu rows
 *
 * Per mobile-ui-design.md (§4.5):
 * - User card at top with presence + "Edit Profile" link
 * - Grouped menu sections: Features / Settings / Account
 * - Large rows with SF Symbol icon + text label + chevron
 * - Sign Out isolated at bottom (red, confirm dialog)
 * - No grid layout — vertical list is more scannable
 */

import React from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Alert,
  StyleSheet,
} from "react-native";
import { openBrowserAsync } from "expo-web-browser";
import { useRouter } from "expo-router";
import { SFIcon } from "@/components/ui/sf-icon";
import { AuthContext } from "@/hooks/use-auth";
import { UserCard } from "@/components/common/user-card";
import { buildWebUrl } from "@/lib/constants";
import {
  border,
  lightPalette,
  mobileLayout,
  mobileTypography,
  opacity,
  radius,
  spacing,
  moreMenuIcons,
  profileIcons,
} from "@tech-office/theme-tokens";

// ── Menu definitions ────────────────────────────────────────────────────────

interface MenuItem {
  /** In-app route, or an https URL opened in the system browser. */
  href: string;
  sfIcon: string;
  label: string;
  testID: string;
}

// Search is deliberately absent: it is a top-level verb, reachable from the
// SearchPill at the top of Chat, Today, My Work and Schedule. Listing it here
// as well made it look like a setting.
const featureItems: MenuItem[] = [
  { href: "/(app)/(more)/docs", sfIcon: moreMenuIcons.documents.name, label: moreMenuIcons.documents.label, testID: moreMenuIcons.documents.testID },
  { href: "/(app)/(more)/files", sfIcon: moreMenuIcons.files.name, label: moreMenuIcons.files.label, testID: moreMenuIcons.files.testID },
];

const settingsItems: MenuItem[] = [
  { href: "/(app)/(more)/settings", sfIcon: moreMenuIcons.settings.name, label: moreMenuIcons.settings.label, testID: moreMenuIcons.settings.testID },
  // Help pointed at Settings, so the one row a confused user taps went nowhere
  // useful. It now opens the guide site the web app already serves at /docs.
  { href: buildWebUrl("/docs"), sfIcon: moreMenuIcons.help.name, label: moreMenuIcons.help.label, testID: moreMenuIcons.help.testID },
];

const devItems: MenuItem[] = __DEV__
  ? [
      {
        href: "/(app)/(more)/navigation-debug",
        sfIcon: "arrow.trianglehead.branch",
        label: "Navigation Debug",
        testID: "menu-navigation-debug",
      },
    ]
  : [];

// ── Menu Row ────────────────────────────────────────────────────────────────

function MenuRow({ item, onPress }: { item: MenuItem; onPress: () => void }) {
  return (
    <Pressable
      testID={item.testID}
      onPress={onPress}
      style={({ pressed }) => [
        styles.menuRow,
        pressed && styles.menuRowPressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={item.label}
    >
      <View style={styles.menuIconWrap}>
        <SFIcon name={item.sfIcon} size={20} color={lightPalette.primary.main} />
      </View>
      <Text style={styles.menuLabel}>{item.label}</Text>
    </Pressable>
  );
}

// ── Main Screen ─────────────────────────────────────────────────────────────

export default function MoreScreen() {
  const auth = React.use(AuthContext);
  const router = useRouter();

  const employeeId = auth?.employeeId ?? "";

  const openMenuItem = React.useCallback(
    (item: MenuItem) => {
      if (item.href.startsWith("http")) {
        void openBrowserAsync(item.href);
        return;
      }

      router.push(item.href);
    },
    [router],
  );

  const handleSignOut = () => {
    Alert.alert(
      "Sign Out",
      "Are you sure you want to sign out?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Sign Out",
          style: "destructive",
          onPress: () => auth?.signOut(),
        },
      ],
    );
  };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={styles.scrollView}
      contentContainerStyle={styles.scrollContent}
    >
      {/* User card */}
      <View style={styles.profileCard}>
        <View style={{ flex: 1 }}>
          <UserCard
            employeeId={employeeId}
            variant="standard"
            showPresence
            testID="more-user-card"
          />
        </View>
        <Pressable
          testID="edit-profile-button"
          onPress={() => router.push("/(app)/(more)/profile")}
          style={styles.editProfileBtn}
          accessibilityRole="button"
          accessibilityLabel={profileIcons.editProfile.label}
        >
          <Text style={styles.editProfileText}>{profileIcons.editProfile.label} →</Text>
        </Pressable>
      </View>

      {/* Features section */}
      <View style={styles.section}>
        {featureItems.map((item, idx) => (
          <React.Fragment key={item.testID}>
            <MenuRow item={item} onPress={() => openMenuItem(item)} />
            {idx < featureItems.length - 1 && <View style={styles.separator} />}
          </React.Fragment>
        ))}
      </View>

      {/* Settings section */}
      <View style={styles.section}>
        {settingsItems.map((item, idx) => (
          <React.Fragment key={item.testID}>
            <MenuRow item={item} onPress={() => openMenuItem(item)} />
            {idx < settingsItems.length - 1 && <View style={styles.separator} />}
          </React.Fragment>
        ))}
      </View>

      {devItems.length > 0 ? (
        <View style={styles.section}>
          {devItems.map((item, idx) => (
            <React.Fragment key={item.testID}>
              <MenuRow item={item} onPress={() => openMenuItem(item)} />
              {idx < devItems.length - 1 && <View style={styles.separator} />}
            </React.Fragment>
          ))}
        </View>
      ) : null}

      {/* Sign Out */}
      <View style={styles.section}>
        <Pressable
          testID="menu-signout"
          onPress={handleSignOut}
          style={({ pressed }) => [
            styles.menuRow,
            pressed && styles.signOutPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Sign Out"
        >
          <View style={[styles.menuIconWrap, { backgroundColor: lightPalette.error.main + "12" }]}>
            <SFIcon name={profileIcons.signOut.name} size={20} color={lightPalette.error.main} />
          </View>
          <Text style={styles.signOutLabel}>Sign Out</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
    backgroundColor: lightPalette.background.default,
  },
  scrollContent: {
    padding: mobileLayout.screenPadding,
    gap: mobileLayout.cardGap,
  },
  profileCard: {
    backgroundColor: lightPalette.background.paper,
    borderRadius: radius.lg,
    borderCurve: "continuous",
    padding: mobileLayout.cardPadding,
    flexDirection: "row",
    alignItems: "center",
    gap: mobileLayout.iconTextGap,
  },
  editProfileBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  editProfileText: {
    fontSize: mobileTypography.buttonSm.fontSize as number,
    color: lightPalette.primary.main,
    fontWeight: "500" as const,
  },
  section: {
    backgroundColor: lightPalette.background.paper,
    borderRadius: radius.md,
    borderCurve: "continuous",
    overflow: "hidden",
    borderWidth: border.thin,
    borderColor: lightPalette.divider,
  },
  menuRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingHorizontal: mobileLayout.cardPadding,
    paddingVertical: 14,
    minHeight: mobileLayout.compactRowHeight,
    gap: mobileLayout.iconTextGap,
  },
  menuRowPressed: {
    opacity: opacity.pressed,
  },
  menuIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderCurve: "continuous" as const,
    backgroundColor: lightPalette.primary.main + "12",
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  menuLabel: {
    flex: 1,
    fontSize: mobileTypography.listPrimary.fontSize as number,
    fontWeight: mobileTypography.listPrimary.fontWeight as "500",
    color: lightPalette.text.primary,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: lightPalette.divider,
    marginLeft: 32 + mobileLayout.iconTextGap + mobileLayout.cardPadding,
  },
  signOutLabel: {
    flex: 1,
    fontSize: mobileTypography.listPrimary.fontSize as number,
    fontWeight: mobileTypography.listPrimary.fontWeight as "500",
    color: lightPalette.error.main,
  },
  signOutPressed: {
    backgroundColor: lightPalette.error.light + "15",
  },
});

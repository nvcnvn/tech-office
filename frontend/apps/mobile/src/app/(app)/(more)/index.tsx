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
import { useTourController } from "@/providers/tour-provider";
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
  /**
   * In-app route, or an https URL opened in the system browser. Empty when the row does
   * something in place rather than navigating — the "Take the tour" row, which reopens
   * the tour over whatever screen the person is on.
   */
  href: string;
  sfIcon: string;
  label: string;
  /** One line under the label saying what the row is for. */
  hint?: string;
  testID: string;
  /** Runs instead of navigating. When set, `href` is ignored. */
  action?: () => void;
}

function isExternal(item: MenuItem): boolean {
  return item.href.startsWith("http");
}

// Search is deliberately absent: it is a top-level verb, reachable from the
// SearchPill at the top of Chat, Today, My Work and Schedule. Listing it here
// as well made it look like a setting.
const featureItems: MenuItem[] = [
  {
    href: "/(app)/(more)/docs",
    sfIcon: moreMenuIcons.documents.name,
    label: moreMenuIcons.documents.label,
    hint: "Written notes and references your team keeps",
    testID: moreMenuIcons.documents.testID,
  },
  {
    href: "/(app)/(more)/files",
    sfIcon: moreMenuIcons.files.name,
    label: moreMenuIcons.files.label,
    hint: "Everything shared in chats, tasks and docs",
    testID: moreMenuIcons.files.testID,
  },
];

const settingsItems: MenuItem[] = [
  {
    href: "/(app)/(more)/settings",
    sfIcon: moreMenuIcons.settings.name,
    label: moreMenuIcons.settings.label,
    hint: "Alerts, privacy, blocked people and your account",
    testID: moreMenuIcons.settings.testID,
  },
  // Help pointed at Settings, so the one row a confused user taps went nowhere
  // useful. It now opens the guide site the web app already serves at /docs.
  {
    href: buildWebUrl("/docs"),
    sfIcon: moreMenuIcons.help.name,
    label: moreMenuIcons.help.label,
    hint: "Guides for getting things done in Tech Office",
    testID: moreMenuIcons.help.testID,
  },
];

const devItems: MenuItem[] = __DEV__
  ? [
      {
        href: "/(app)/(more)/navigation-debug",
        sfIcon: "arrow.trianglehead.branch",
        label: "Navigation Debug",
        hint: "Maestro shared-route harness — development builds only",
        testID: "menu-navigation-debug",
      },
    ]
  : [];

// ── Menu Row ────────────────────────────────────────────────────────────────

function MenuRow({ item, onPress }: { item: MenuItem; onPress: () => void }) {
  const external = isExternal(item);

  return (
    <Pressable
      testID={item.testID}
      onPress={onPress}
      style={({ pressed }) => [
        styles.menuRow,
        pressed && styles.menuRowPressed,
      ]}
      accessibilityRole={external ? "link" : "button"}
      accessibilityLabel={
        external ? `${item.label}, opens in your browser` : item.label
      }
      accessibilityHint={item.hint}
    >
      <View style={styles.menuIconWrap}>
        <SFIcon name={item.sfIcon} size={20} color={lightPalette.primary.main} />
      </View>
      <View style={styles.menuCopy}>
        <Text style={styles.menuLabel}>{item.label}</Text>
        {item.hint ? <Text style={styles.menuHint}>{item.hint}</Text> : null}
      </View>
      <SFIcon
        name={external ? "arrow.up.right.square" : "chevron.right"}
        size={14}
        color={lightPalette.text.disabled}
      />
    </Pressable>
  );
}

function MenuSection({
  items,
  label,
  openMenuItem,
}: {
  items: MenuItem[];
  label?: string;
  openMenuItem: (item: MenuItem) => void;
}) {
  if (items.length === 0) return null;

  return (
    <View style={styles.sectionBlock}>
      {label ? <Text style={styles.sectionLabel}>{label}</Text> : null}
      <View style={styles.section}>
        {items.map((item, idx) => (
          <React.Fragment key={item.testID}>
            <MenuRow item={item} onPress={() => openMenuItem(item)} />
            {idx < items.length - 1 && <View style={styles.separator} />}
          </React.Fragment>
        ))}
      </View>
    </View>
  );
}

// ── Main Screen ─────────────────────────────────────────────────────────────

export default function MoreScreen() {
  const auth = React.use(AuthContext);
  const router = useRouter();

  const employeeId = auth?.employeeId ?? "";
  const tour = useTourController();

  /*
   * "Take the tour" sits next to Help because they answer the same question. It is a row
   * rather than a link: restarting reopens the tour over the screen the person is on, and
   * it is offered whether or not they finished or dismissed it before (FR-017). Hidden
   * only when there is no tour to run — a person whose permissions filter every stop away.
   */
  const appItems: MenuItem[] = React.useMemo(() => {
    if (!tour?.tour || tour.tour.stops.length === 0) {
      return settingsItems;
    }
    const takeTheTour: MenuItem = {
      href: "",
      sfIcon: "map",
      label: "Take the tour",
      hint: "A quick walk through what this app does",
      testID: "menu-take-the-tour",
      action: () => tour.restart(),
    };
    // Before Help, so the shorter in-app answer comes before the one that leaves the app.
    return [settingsItems[0], takeTheTour, ...settingsItems.slice(1)];
  }, [tour]);

  const openMenuItem = React.useCallback(
    (item: MenuItem) => {
      if (item.action) {
        item.action();
        return;
      }

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
      {/* The whole card opens the profile. It used to be only the "Edit Profile"
          text, a target well under 44pt on a row that already looks tappable. */}
      <Pressable
        testID="edit-profile-button"
        onPress={() => router.push("/(app)/(more)/profile")}
        accessibilityRole="button"
        accessibilityLabel={profileIcons.editProfile.label}
        style={({ pressed }) => [styles.profileCard, pressed && styles.menuRowPressed]}
      >
        <View style={{ flex: 1 }}>
          <UserCard
            employeeId={employeeId}
            variant="standard"
            showPresence
            testID="more-user-card"
          />
        </View>
        <Text style={styles.editProfileText}>{profileIcons.editProfile.label}</Text>
        <SFIcon name="chevron.right" size={14} color={lightPalette.text.disabled} />
      </Pressable>

      <MenuSection
        label="Workspace"
        items={featureItems}
        openMenuItem={openMenuItem}
      />

      <MenuSection
        label="App"
        items={appItems}
        openMenuItem={openMenuItem}
      />

      {/* Labelled, so an internal harness sitting in the menu of a development
          build reads as deliberate rather than as an unfinished feature. */}
      <MenuSection
        label="Developer"
        items={devItems}
        openMenuItem={openMenuItem}
      />

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
    paddingBottom: spacing[6],
  },
  profileCard: {
    backgroundColor: lightPalette.background.paper,
    borderRadius: radius.lg,
    borderCurve: "continuous",
    borderWidth: border.thin,
    borderColor: lightPalette.divider,
    padding: mobileLayout.cardPadding,
    minHeight: mobileLayout.compactRowHeight,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
  },
  editProfileText: {
    fontSize: mobileTypography.buttonSm.fontSize as number,
    color: lightPalette.primary.main,
    fontWeight: "500" as const,
  },
  sectionBlock: {
    gap: spacing[1],
  },
  sectionLabel: {
    paddingLeft: 4,
    fontSize: mobileTypography.caption.fontSize as number,
    fontWeight: "600" as const,
    color: lightPalette.text.secondary,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  menuCopy: {
    flex: 1,
    gap: 2,
  },
  menuHint: {
    fontSize: mobileTypography.listSecondary.fontSize as number,
    lineHeight: mobileTypography.listSecondary.lineHeight as number,
    color: lightPalette.text.secondary,
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

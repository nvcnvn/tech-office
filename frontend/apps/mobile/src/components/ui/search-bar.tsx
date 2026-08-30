/**
 * Search surface primitives — the one look every search modal uses.
 *
 * Chat used to hand-roll its own bordered TextInput and white list rows, so
 * the box people learn first (global search) and the box they hit from
 * "Start Chat" looked and behaved like two different products. Both screens
 * now render these.
 */

import React from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { SFIcon } from "@/components/ui/sf-icon";
import {
  border,
  lightPalette,
  mobileLayout,
  mobileTypography,
  opacity,
  radius,
  spacing,
} from "@tech-office/theme-tokens";

interface SearchBarProps {
  value: string;
  onChangeText: (next: string) => void;
  placeholder: string;
  /** Rendered as a "Cancel" text button — not an icon, per mobile-ui-design §3. */
  onCancel: () => void;
  inputTestID?: string;
  cancelTestID?: string;
  autoFocus?: boolean;
  returnKeyType?: TextInputProps["returnKeyType"];
}

export function SearchBar({
  value,
  onChangeText,
  placeholder,
  onCancel,
  inputTestID,
  cancelTestID,
  autoFocus = true,
  returnKeyType = "search",
}: SearchBarProps) {
  return (
    <View style={styles.searchBar}>
      <View style={styles.inputRow}>
        <SFIcon
          name="magnifyingglass"
          size={18}
          color={lightPalette.text.secondary}
        />
        <TextInput
          testID={inputTestID}
          style={styles.input}
          placeholder={placeholder}
          placeholderTextColor={lightPalette.text.secondary}
          value={value}
          onChangeText={onChangeText}
          autoFocus={autoFocus}
          returnKeyType={returnKeyType}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          clearButtonMode="while-editing"
        />
      </View>
      <Pressable
        testID={cancelTestID}
        onPress={onCancel}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Cancel search"
        style={styles.cancelBtn}
      >
        <Text style={styles.cancelText}>Cancel</Text>
      </Pressable>
    </View>
  );
}

export function SearchSectionHeader({ title }: { title: string }) {
  return (
    <View style={styles.listHeader}>
      <Text style={styles.listHeaderText}>{title}</Text>
    </View>
  );
}

/** Grouped card with hairline separators, like the rest of the app's lists. */
export function SearchResultsCard({ children }: { children: React.ReactNode }) {
  const rows = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={styles.resultsCard}>
      {rows.map((row, index) => (
        <React.Fragment key={index}>
          {index > 0 && <View style={styles.cardSeparator} />}
          {row}
        </React.Fragment>
      ))}
    </View>
  );
}

interface SearchResultRowProps {
  /** Avatar or icon circle — 36dp. */
  leading: React.ReactNode;
  title: string;
  subtitle?: string;
  badge?: { label: string; tint: string };
  trailing?: React.ReactNode;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}

export function SearchResultRow({
  leading,
  title,
  subtitle,
  badge,
  trailing,
  onPress,
  disabled,
  testID,
}: SearchResultRowProps) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      {leading}
      <View style={styles.rowContent}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {badge ? (
        <View style={[styles.badge, { backgroundColor: `${badge.tint}15` }]}>
          <Text style={[styles.badgeText, { color: badge.tint }]}>
            {badge.label}
          </Text>
        </View>
      ) : null}
      {trailing}
    </Pressable>
  );
}

/** 36dp tinted circle for non-person rows (channels, tasks, events). */
export function SearchIconCircle({
  sfSymbol,
  tint,
}: {
  sfSymbol: string;
  tint: string;
}) {
  return (
    <View style={[styles.iconCircle, { backgroundColor: `${tint}15` }]}>
      <SFIcon name={sfSymbol} size={20} color={tint} />
    </View>
  );
}

export const searchLayout = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: lightPalette.background.default,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: mobileLayout.cardPadding * 2,
    gap: spacing[1.5],
  },
  emptyText: {
    fontSize: mobileTypography.listPrimary.fontSize as number,
    color: lightPalette.text.secondary,
    textAlign: "center",
  },
});

const styles = StyleSheet.create({
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: mobileLayout.screenPadding,
    paddingVertical: 8,
    gap: mobileLayout.iconTextGap,
    borderBottomWidth: border.hairline,
    borderBottomColor: lightPalette.divider,
    backgroundColor: lightPalette.background.paper,
  },
  inputRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: lightPalette.background.default,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    gap: 8,
    height: 40,
  },
  input: {
    flex: 1,
    fontSize: mobileTypography.listPrimary.fontSize as number,
    color: lightPalette.text.primary,
    padding: 0,
  },
  cancelBtn: {
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  cancelText: {
    fontSize: mobileTypography.listPrimary.fontSize as number,
    color: lightPalette.primary.main,
    fontWeight: "500" as const,
  },
  listHeader: {
    paddingHorizontal: mobileLayout.screenPadding,
    paddingTop: spacing[1.5],
    paddingBottom: mobileLayout.itemGap,
  },
  listHeaderText: {
    fontSize: mobileTypography.caption.fontSize as number,
    fontWeight: "600" as const,
    color: lightPalette.text.secondary,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  resultsCard: {
    marginHorizontal: mobileLayout.screenPadding,
    borderRadius: radius.md,
    borderCurve: "continuous",
    overflow: "hidden",
    backgroundColor: lightPalette.background.paper,
    borderWidth: border.thin,
    borderColor: lightPalette.divider,
  },
  cardSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: lightPalette.divider,
    marginHorizontal: mobileLayout.cardPadding,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: mobileLayout.cardPadding,
    paddingVertical: 12,
    minHeight: mobileLayout.compactRowHeight,
    gap: mobileLayout.iconTextGap,
    backgroundColor: lightPalette.background.paper,
  },
  rowPressed: {
    opacity: opacity.pressed,
  },
  rowContent: {
    flex: 1,
    gap: 1,
  },
  rowTitle: {
    fontSize: mobileTypography.listPrimary.fontSize as number,
    fontWeight: mobileTypography.listPrimary.fontWeight as "500",
    color: lightPalette.text.primary,
  },
  rowSubtitle: {
    fontSize: mobileTypography.listSecondary.fontSize as number,
    color: lightPalette.text.secondary,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  badgeText: {
    fontSize: mobileTypography.caption.fontSize as number,
    fontWeight: "600" as const,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
});

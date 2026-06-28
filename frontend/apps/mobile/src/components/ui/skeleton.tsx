/**
 * Skeleton — T11.2
 *
 * Animated shimmer placeholder for list content while data loads.
 *
 * Usage:
 *   // Single box
 *   <Skeleton width={200} height={16} />
 *
 *   // Pre-built list placeholder
 *   <SkeletonList count={8} />
 *
 *   // Channel list row
 *   <SkeletonChannelRow />
 */

import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, View, ViewStyle } from "react-native";

interface SkeletonProps {
  width?: number | `${number}%`;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
}

export function Skeleton({
  width = "100%",
  height = 16,
  borderRadius = 6,
  style,
}: SkeletonProps) {
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, {
          toValue: 1,
          duration: 650,
          useNativeDriver: true,
        }),
        Animated.timing(shimmer, {
          toValue: 0,
          duration: 650,
          useNativeDriver: true,
        }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [shimmer]);

  const opacity = shimmer.interpolate({
    inputRange: [0, 1],
    outputRange: [0.22, 0.92],
  });

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius,
          backgroundColor: "#e2e8f0",
          opacity,
        },
        style,
      ]}
    />
  );
}

// ---------------------------------------------------------------------------
// Pre-built row shapes
// ---------------------------------------------------------------------------

/** Two-line list row with a left avatar */
export function SkeletonListRow() {
  return (
    <View style={styles.rowContainer}>
      <Skeleton width={44} height={44} borderRadius={22} />
      <View style={styles.rowLines}>
        <Skeleton width="60%" height={14} />
        <Skeleton width="85%" height={12} style={{ marginTop: 6 }} />
      </View>
    </View>
  );
}

/** Single-line list row (e.g. project name) */
export function SkeletonSingleRow() {
  return (
    <View style={styles.singleRowContainer}>
      <Skeleton width="70%" height={16} />
      <Skeleton width={32} height={16} borderRadius={8} />
    </View>
  );
}

/** Repeated list of skeleton rows */
export function SkeletonList({
  count = 8,
  variant = "double",
}: {
  count?: number;
  variant?: "single" | "double";
}) {
  return (
    <View style={styles.listContainer}>
      {Array.from({ length: count }).map((_, i) =>
        variant === "single" ? (
          <SkeletonSingleRow key={i} />
        ) : (
          <SkeletonListRow key={i} />
        )
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  rowContainer: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e2e8f0",
  },
  rowLines: { flex: 1 },
  singleRowContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e2e8f0",
  },
  listContainer: { flex: 1 },
});

// ---------------------------------------------------------------------------
// Domain-specific skeleton shapes
// ---------------------------------------------------------------------------

/** Project row skeleton — 72dp row: icon box + name line + subtitle line + chevron */
export function SkeletonProjectRow() {
  return (
    <View style={projectSkelStyles.row}>
      <Skeleton width={46} height={46} borderRadius={12} />
      <View style={{ flex: 1, gap: 6 }}>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <Skeleton width="55%" height={14} />
          <Skeleton width={28} height={12} borderRadius={4} />
        </View>
        <Skeleton width="70%" height={12} />
      </View>
      <Skeleton width={10} height={14} borderRadius={3} />
    </View>
  );
}

export function SkeletonProjectList({
  count = 6,
  showSearchPlaceholder = true,
}: {
  count?: number;
  showSearchPlaceholder?: boolean;
}) {
  return (
    <View style={styles.listContainer}>
      {showSearchPlaceholder ? (
        <View style={{ paddingHorizontal: 16, paddingVertical: 10 }}>
          <Skeleton width="100%" height={44} borderRadius={22} />
        </View>
      ) : null}
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonProjectRow key={i} />
      ))}
    </View>
  );
}

const projectSkelStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 72,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e2e8f0",
  },
});

export function SkeletonChatRow() {
  return (
    <View style={chatSkelStyles.row}>
      <Skeleton width={46} height={46} borderRadius={23} />
      <View style={chatSkelStyles.rowContent}>
        <View style={chatSkelStyles.rowTopLine}>
          <Skeleton width="48%" height={14} />
          <Skeleton width={44} height={12} borderRadius={5} />
        </View>
        <Skeleton width="78%" height={12} />
      </View>
      <Skeleton width={8} height={8} borderRadius={4} style={{ marginTop: 8 }} />
    </View>
  );
}

export function SkeletonChatList({ count = 8, sectionCount = 2 }: { count?: number; sectionCount?: number }) {
  const safeSectionCount = Math.max(1, sectionCount);
  const rowsPerSection = Math.max(1, Math.ceil(count / safeSectionCount));
  let renderedRows = 0;

  return (
    <View style={styles.listContainer}>
      {Array.from({ length: safeSectionCount }).map((_, sectionIndex) => {
        const rowsInSection = Math.min(rowsPerSection, count - renderedRows);
        if (rowsInSection <= 0) {
          return null;
        }

        renderedRows += rowsInSection;

        return (
          <View key={sectionIndex}>
            <View style={chatSkelStyles.sectionHeader}>
              <Skeleton width={sectionIndex === 0 ? 112 : 68} height={12} borderRadius={5} />
            </View>
            {Array.from({ length: rowsInSection }).map((__, rowIndex) => (
              <SkeletonChatRow key={`${sectionIndex}-${rowIndex}`} />
            ))}
          </View>
        );
      })}
    </View>
  );
}

const chatSkelStyles = StyleSheet.create({
  sectionHeader: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    backgroundColor: "#f2f2f7",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 72,
    gap: 12,
    backgroundColor: "#fff",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e2e8f0",
  },
  rowContent: {
    flex: 1,
    gap: 8,
  },
  rowTopLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
});

export function SkeletonTaskList({ count = 8, sectionCount = 3 }: { count?: number; sectionCount?: number }) {
  const safeSectionCount = Math.max(1, sectionCount);
  const rowsPerSection = Math.max(1, Math.ceil(count / safeSectionCount));
  let renderedRows = 0;

  return (
    <View style={styles.listContainer}>
      {Array.from({ length: safeSectionCount }).map((_, sectionIndex) => {
        const rowsInSection = Math.min(rowsPerSection, count - renderedRows);
        if (rowsInSection <= 0) {
          return null;
        }

        renderedRows += rowsInSection;

        return (
          <View key={sectionIndex}>
            <View style={taskSkelStyles.sectionHeader}>
              <Skeleton width={10} height={10} borderRadius={5} />
              <Skeleton width={sectionIndex === 0 ? 88 : 72} height={12} borderRadius={5} />
              <Skeleton width={18} height={12} borderRadius={5} style={{ marginLeft: "auto" }} />
            </View>
            {Array.from({ length: rowsInSection }).map((__, rowIndex) => (
              <View key={`${sectionIndex}-${rowIndex}`} style={taskSkelStyles.rowWrap}>
                <View style={taskSkelStyles.row}>
                  <View style={taskSkelStyles.rowContent}>
                    <Skeleton width="72%" height={15} />
                    <View style={taskSkelStyles.metaRow}>
                      <Skeleton width={54} height={12} borderRadius={5} />
                      <Skeleton width={76} height={12} borderRadius={5} />
                      <Skeleton width={50} height={12} borderRadius={5} />
                    </View>
                  </View>
                  <Skeleton width={10} height={14} borderRadius={4} />
                </View>
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}

const taskSkelStyles = StyleSheet.create({
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 8,
    gap: 8,
    backgroundColor: "#f2f2f7",
  },
  rowWrap: {
    marginHorizontal: 16,
    marginBottom: 1,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 72,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
    backgroundColor: "#fff",
  },
  rowContent: {
    flex: 1,
    gap: 8,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
});

/** Calendar skeleton — month grid area + 3 event card placeholders */
export function SkeletonCalendar() {
  return (
    <View style={styles.listContainer}>
      {/* Month header */}
      <View style={calSkelStyles.header}>
        <Skeleton width={14} height={14} borderRadius={3} />
        <Skeleton width={140} height={16} />
        <Skeleton width={14} height={14} borderRadius={3} />
      </View>
      {/* Weekday labels */}
      <View style={calSkelStyles.weekRow}>
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} width={20} height={12} borderRadius={3} />
        ))}
      </View>
      {/* Day grid — 5 rows of 7 */}
      {Array.from({ length: 5 }).map((_, row) => (
        <View key={row} style={calSkelStyles.dayRow}>
          {Array.from({ length: 7 }).map((_, col) => (
            <Skeleton key={col} width={28} height={28} borderRadius={14} />
          ))}
        </View>
      ))}
      {/* Day header */}
      <View style={{ paddingHorizontal: 16, paddingVertical: 10 }}>
        <Skeleton width={120} height={14} />
      </View>
      {/* Event cards */}
      {Array.from({ length: 3 }).map((_, i) => (
        <SkeletonEventCard key={i} />
      ))}
    </View>
  );
}

/** Just the event card list — for use below month grid during refresh */
export function SkeletonEventList({ count = 3 }: { count?: number }) {
  return (
    <View style={{ flex: 1, paddingVertical: 4 }}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonEventCard key={i} />
      ))}
    </View>
  );
}

export function SkeletonEventCard() {
  return (
    <View style={calSkelStyles.card}>
      <View style={calSkelStyles.colorBar} />
      <View style={calSkelStyles.cardContent}>
        <Skeleton width={60} height={12} />
        <Skeleton width="75%" height={14} />
        <View style={{ flexDirection: "row", gap: 12 }}>
          <Skeleton width={90} height={12} />
          <Skeleton width={50} height={12} />
        </View>
      </View>
    </View>
  );
}

const calSkelStyles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingVertical: 14,
    backgroundColor: "#fff",
  },
  weekRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingHorizontal: 16,
    paddingBottom: 8,
    backgroundColor: "#fff",
  },
  dayRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingHorizontal: 16,
    paddingVertical: 6,
    backgroundColor: "#fff",
  },
  card: {
    flexDirection: "row",
    marginHorizontal: 16,
    marginVertical: 4,
    backgroundColor: "#fff",
    borderRadius: 12,
    overflow: "hidden",
    minHeight: 72,
  },
  colorBar: {
    width: 4,
    backgroundColor: "#c0c0c0",
    opacity: 0.4,
  },
  cardContent: {
    flex: 1,
    padding: 12,
    paddingLeft: 16,
    gap: 6,
  },
});

/** Notification row skeleton — icon circle + title + message + time */
export function SkeletonNotifRow() {
  return (
    <View style={notifSkelStyles.row}>
      <Skeleton width={40} height={40} borderRadius={20} />
      <View style={{ flex: 1, gap: 4 }}>
        <Skeleton width="50%" height={14} />
        <Skeleton width="90%" height={12} />
        <Skeleton width={60} height={10} style={{ marginTop: 2 }} />
      </View>
    </View>
  );
}

function SkeletonNotifSectionHeader({ width = 56 }: { width?: number }) {
  return (
    <View style={notifSkelStyles.sectionHeader}>
      <Skeleton width={width} height={11} borderRadius={5} />
    </View>
  );
}

export function SkeletonNotifList({
  count = 8,
  sectionCount = 2,
  showControlsPlaceholder = true,
}: {
  count?: number;
  sectionCount?: number;
  showControlsPlaceholder?: boolean;
}) {
  const safeSectionCount = Math.max(1, sectionCount);
  const rowsPerSection = Math.max(1, Math.ceil(count / safeSectionCount));
  let renderedRows = 0;

  return (
    <View style={styles.listContainer}>
      {showControlsPlaceholder ? (
        <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
          <Skeleton width="100%" height={36} borderRadius={10} />
        </View>
      ) : null}
      {Array.from({ length: safeSectionCount }).map((_, sectionIndex) => {
        const rowsInSection = Math.min(rowsPerSection, count - renderedRows);
        if (rowsInSection <= 0) {
          return null;
        }

        renderedRows += rowsInSection;
        const headerWidth = sectionIndex % 2 === 0 ? 56 : 72;

        return (
          <View key={sectionIndex}>
            <SkeletonNotifSectionHeader width={headerWidth} />
            {Array.from({ length: rowsInSection }).map((__, rowIndex) => (
              <SkeletonNotifRow key={`${sectionIndex}-${rowIndex}`} />
            ))}
          </View>
        );
      })}
    </View>
  );
}

const notifSkelStyles = StyleSheet.create({
  sectionHeader: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
    backgroundColor: "#f2f2f7",
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 72,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e2e8f0",
  },
});

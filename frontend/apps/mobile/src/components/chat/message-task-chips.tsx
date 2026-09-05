/**
 * MessageTaskChips — what a chat message became.
 *
 * Feature: 038-chat-task-quick-action
 *
 * Shown on a message that has been turned into one or more tasks. Links to tasks in
 * projects the reader cannot access never reach the client at all, so a message with no
 * chips is indistinguishable from one that was never converted — which is the point.
 *
 * Capped, because a message converted many times should not push the conversation off
 * the screen; the overflow count keeps the fact visible without the list.
 */

import React from "react";
import { Pressable, Text, View } from "react-native";

import type { MessageTaskLink, StateCategory } from "apis";
import { statusColors, type MobilePalette } from "@tech-office/theme-tokens";

import { useTheme } from "@/lib/theme";

/** How many chips one message shows before the rest collapse into a count. */
export const MAX_VISIBLE_TASK_CHIPS = 3;

function chipColors(
  t: MobilePalette,
  category: StateCategory,
): { background: string; border: string; text: string } {
  switch (category) {
    case "done":
    case "verified":
      return { background: statusColors.success[t.mode].bg, border: statusColors.success[t.mode].border, text: statusColors.success[t.mode].text };
    case "in_progress":
    case "submitted":
      return { background: statusColors.info[t.mode].bg, border: statusColors.info[t.mode].border, text: statusColors.info[t.mode].text };
    case "overdue":
    case "missed":
      return { background: statusColors.warning[t.mode].bg, border: statusColors.warning[t.mode].border, text: statusColors.warning[t.mode].text };
    default:
      return { background: t.background.default, border: t.divider, text: t.text.secondary };
  }
}

interface MessageTaskChipsProps {
  links: MessageTaskLink[];
  onOpen: (link: MessageTaskLink) => void;
}

export function MessageTaskChips({ links, onOpen }: MessageTaskChipsProps) {
  const { palette } = useTheme();

  if (links.length === 0) {
    return null;
  }

  const visible = links.slice(0, MAX_VISIBLE_TASK_CHIPS);
  const hidden = links.length - visible.length;

  return (
    <View
      testID="message-task-chips"
      style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 }}
    >
      {visible.map((link) => {
        const colors = chipColors(palette, link.stateCategory);
        return (
          <Pressable
            key={link.taskId}
            testID={`message-task-chip-${link.taskId}`}
            accessibilityRole="button"
            accessibilityLabel={`Open task ${link.identifier}, ${link.stateName}`}
            onPress={() => onOpen(link)}
            style={({ pressed }) => ({
              paddingHorizontal: 8,
              paddingVertical: 4,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: pressed ? colors.border : colors.background,
            })}
          >
            <Text style={{ fontSize: 12, fontWeight: "600", color: colors.text }}>
              {link.identifier} · {link.stateName}
            </Text>
          </Pressable>
        );
      })}
      {hidden > 0 ? (
        <View
          testID="message-task-chip-overflow"
          style={{
            paddingHorizontal: 8,
            paddingVertical: 4,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: palette.divider,
            backgroundColor: palette.background.default,
          }}
        >
          <Text style={{ fontSize: 12, fontWeight: "600", color: palette.text.secondary }}>+{hidden} more</Text>
        </View>
      ) : null}
    </View>
  );
}

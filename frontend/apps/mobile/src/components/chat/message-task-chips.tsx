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

/** How many chips one message shows before the rest collapse into a count. */
export const MAX_VISIBLE_TASK_CHIPS = 3;

function chipColors(category: StateCategory): { background: string; border: string; text: string } {
  switch (category) {
    case "done":
    case "verified":
      return { background: "#ecfdf5", border: "#a7f3d0", text: "#047857" };
    case "in_progress":
    case "submitted":
      return { background: "#eff6ff", border: "#bfdbfe", text: "#1d4ed8" };
    case "overdue":
    case "missed":
      return { background: "#fffbeb", border: "#fde68a", text: "#b45309" };
    default:
      return { background: "#f8fafc", border: "#e2e8f0", text: "#475569" };
  }
}

interface MessageTaskChipsProps {
  links: MessageTaskLink[];
  onOpen: (link: MessageTaskLink) => void;
}

export function MessageTaskChips({ links, onOpen }: MessageTaskChipsProps) {
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
        const colors = chipColors(link.stateCategory);
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
            borderColor: "#e2e8f0",
            backgroundColor: "#f8fafc",
          }}
        >
          <Text style={{ fontSize: 12, fontWeight: "600", color: "#475569" }}>+{hidden} more</Text>
        </View>
      ) : null}
    </View>
  );
}

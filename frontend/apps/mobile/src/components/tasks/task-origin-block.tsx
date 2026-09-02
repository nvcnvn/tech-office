/**
 * TaskOriginBlock — where a task came from, when it was created from a chat message.
 *
 * Feature: 038-chat-task-quick-action
 *
 * Fetched separately from the task itself, so the ordinary task read stays a
 * single-domain query and this costs nothing for the tasks that have no origin. A
 * soft-deleted source message does not remove the block: the task still names the
 * conversation it came from, and only the excerpt is replaced (FR-023).
 */

import React, { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import RenderHtml from "react-native-render-html";

import { getTaskOrigin, type TaskOrigin } from "apis";
import { lightPalette } from "@tech-office/theme-tokens";

interface TaskOriginBlockProps {
  taskId: string;
  /** Present only on tasks created from a message; absent means nothing to show. */
  sourceMessageId?: string;
  contentWidth: number;
}

export function TaskOriginBlock({ taskId, sourceMessageId, contentWidth }: TaskOriginBlockProps) {
  const router = useRouter();
  const [origin, setOrigin] = useState<TaskOrigin | null>(null);

  useEffect(() => {
    if (!sourceMessageId) {
      setOrigin(null);
      return;
    }
    let cancelled = false;
    getTaskOrigin(taskId)
      .then((resp) => {
        if (!cancelled) setOrigin(resp.hasOrigin ? resp : null);
      })
      .catch(() => {
        // An origin we cannot resolve is simply not shown; the task itself is fine.
        if (!cancelled) setOrigin(null);
      });
    return () => {
      cancelled = true;
    };
  }, [taskId, sourceMessageId]);

  if (!origin) {
    return null;
  }

  return (
    <View
      testID="task-origin-block"
      style={{
        marginHorizontal: 16,
        marginBottom: 12,
        padding: 14,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: "#e2e8f0",
        backgroundColor: "#f8fafc",
      }}
    >
      <Text
        style={{
          fontSize: 11,
          fontWeight: "700",
          letterSpacing: 0.8,
          textTransform: "uppercase",
          color: lightPalette.text.secondary,
        }}
      >
        From a conversation
      </Text>

      <Text
        testID="task-origin-channel"
        style={{ marginTop: 4, fontSize: 14, fontWeight: "600", color: lightPalette.text.primary }}
      >
        {origin.channelDisplayName || "a conversation"}
        {origin.authorDisplayName ? ` · ${origin.authorDisplayName}` : ""}
      </Text>

      {origin.sourceMessageAvailable ? (
        <View
          testID="task-origin-excerpt"
          style={{ marginTop: 8, paddingLeft: 10, borderLeftWidth: 3, borderLeftColor: "#e2e8f0" }}
        >
          <RenderHtml
            contentWidth={Math.max(contentWidth - 80, 120)}
            source={{ html: origin.excerptHtml }}
            baseStyle={{ fontSize: 13, color: lightPalette.text.secondary, lineHeight: 19 }}
          />
        </View>
      ) : (
        <Text
          testID="task-origin-message-unavailable"
          style={{ marginTop: 8, fontSize: 13, fontStyle: "italic", color: lightPalette.text.secondary }}
        >
          The original message has been deleted.
        </Text>
      )}

      <Pressable
        testID="task-origin-link"
        accessibilityRole="button"
        accessibilityLabel="Open the conversation"
        // The canonical anchored route, so this lands on the exact message rather than
        // the bottom of the conversation.
        onPress={() =>
          router.push(
            `/(app)/(chat)/${origin.sourceChannelId}?anchorType=message&anchorId=${origin.sourceMessageId}` as never,
          )
        }
        style={({ pressed }) => ({ marginTop: 12, opacity: pressed ? 0.6 : 1 })}
      >
        <Text style={{ fontSize: 14, fontWeight: "600", color: lightPalette.primary.main }}>
          Open the conversation
        </Text>
      </Pressable>
    </View>
  );
}

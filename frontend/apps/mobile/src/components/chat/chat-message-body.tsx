import React, { useMemo } from "react";
import { Linking, Pressable, Text, View, type StyleProp, type TextStyle } from "react-native";
import { usePathname, useRouter } from "expo-router";
import RenderHtml from "react-native-render-html";

import {
  removeCanonicalResourceLinksFromContent,
  selectCanonicalPreviewCards,
  splitTextByCanonicalResourceLinks,
  type CanonicalLinkPreview,
} from "@tech-office/links";

import { SYSTEM_EVENT_TASK_CREATED_FROM_MESSAGE, type MessageTaskLink } from "apis";

import { getCanonicalInAppRoute } from "@/lib/canonical-links";
import {
  getTabLabel,
  getTabRootHref,
  inferOwnerTabFromHref,
  withNavigationContext,
} from "@/lib/mobile-navigation";
import { VoiceMessagePlayer } from "./voice-message-player";
import { VoiceCallRecord, voiceCallEventFromText } from "./voice-call-record";

const defaultHtmlBaseStyle = {
  fontSize: 16,
  color: "#111",
  lineHeight: 22,
} as const;

const defaultHtmlTagsStyles = {
  p: { marginTop: 0, marginBottom: 4 },
  a: { color: "#2563eb" },
  strong: { fontWeight: "700" as const },
  em: { fontStyle: "italic" as const },
} as const;

interface ChatMessageBodyProps {
  messageText: string;
  fileIds?: string[];
  messageKind?: string;
  systemEventType?: string;
  metadataJson?: string;
  channelId?: string;
  messageTimestamp?: Date | null;
  contentWidth: number;
  textStyle?: StyleProp<TextStyle>;
  /**
   * Previews for the whole rendered page, keyed by canonical URL. Supplied by the screen:
   * a message never looks one up itself, so a slow lookup for one link cannot hold up
   * another message (FR-020, FR-022).
   */
  linkPreviews?: Map<string, CanonicalLinkPreview>;
  /** Tasks this message already shows as chips; a card for one of them is suppressed. */
  taskLinks?: MessageTaskLink[];
}

interface VoiceTimelineMetadata {
  callId?: string;
  // Set only on a task_created_from_message announcement (Feature 038).
  taskId?: string;
  identifier?: string;
  title?: string;
  voiceMessageId?: string;
  durationMs?: number | string;
  mimeType?: string;
  waveformPeaks?: number[];
  sizeBytes?: number | string;
  outcome?: string;
  status?: string;
  state?: string;
  startedAt?: string;
  endedAt?: string;
  participantCount?: number | string;
  recordingStatus?: string;
  transcriptStatus?: string;
}

function parseTimelineMetadata(metadataJson?: string): VoiceTimelineMetadata | null {
  if (!metadataJson) {
    return null;
  }
  try {
    const parsed = JSON.parse(metadataJson) as VoiceTimelineMetadata;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function metadataWaveformPeaks(metadata: VoiceTimelineMetadata | null): number[] | null {
  const peaks = metadata?.waveformPeaks;
  if (!Array.isArray(peaks)) {
    return null;
  }
  return peaks.filter((peak) => Number.isFinite(peak));
}

export function ChatMessageBody({
  messageText,
  fileIds = [],
  messageKind,
  systemEventType,
  metadataJson,
  channelId,
  messageTimestamp,
  contentWidth,
  textStyle,
  linkPreviews,
  taskLinks,
}: ChatMessageBodyProps) {
  const router = useRouter();
  const pathname = usePathname();
  const hasHtml = /<[a-z][\s\S]*>/i.test(messageText);
  const previewCards = useMemo(
    () =>
      selectCanonicalPreviewCards(messageText, linkPreviews, {
        suppressedTaskIds: (taskLinks ?? []).map((link) => link.taskId),
      }),
    [linkPreviews, messageText, taskLinks],
  );
  const cardedUrls = useMemo(() => previewCards.map((card) => card.url), [previewCards]);
  const displayMessageText = useMemo(
    () => removeCanonicalResourceLinksFromContent(messageText, cardedUrls),
    [cardedUrls, messageText],
  );
  const timelineMetadata = useMemo(() => parseTimelineMetadata(metadataJson), [metadataJson]);
  const textSegments = useMemo(() => splitTextByCanonicalResourceLinks(displayMessageText), [displayMessageText]);
  const hasDisplayMessageText = displayMessageText.trim().length > 0;
  const voiceCallEvent = voiceCallEventFromText(displayMessageText);
  const isVoiceMessage = (messageKind === "voice" || displayMessageText.trim() === "Voice message") && fileIds.length > 0;

  async function openCanonicalLink(rawUrl: string) {
    const route = await getCanonicalInAppRoute(rawUrl, { preferRecoverableFallback: true });
    if (route) {
      const ownerTab = inferOwnerTabFromHref(pathname) ?? inferOwnerTabFromHref(route);
      router.push(
        withNavigationContext(route, {
          ownerTab,
          fallbackHref: ownerTab ? getTabRootHref(ownerTab) : undefined,
          backLabel: ownerTab ? getTabLabel(ownerTab) : undefined,
        }) as never,
      );
      return;
    }
    await Linking.openURL(rawUrl);
  }

  function renderPreviewCards() {
    if (previewCards.length === 0) {
      return null;
    }
    return previewCards.map((card, index) => (
      <Pressable
        key={card.url}
        testID={`canonical-link-preview-card-${index}`}
        onPress={() => void openCanonicalLink(card.display.href)}
        style={({ pressed }) => ({
          marginTop: index > 0 || hasDisplayMessageText ? 10 : 0,
          paddingHorizontal: 14,
          paddingVertical: 12,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: pressed ? "#1d4ed8" : "#bfdbfe",
          backgroundColor: pressed ? "#dbeafe" : "#eff6ff",
        })}
      >
        <Text style={{ fontSize: 11, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase", color: "#1d4ed8" }}>
          {card.display.badge}
        </Text>
        {/* Resource-supplied text, rendered as text. numberOfLines keeps a long title
            from pushing the card wide at 360 dp. */}
        <Text numberOfLines={2} style={{ marginTop: 4, fontSize: 15, fontWeight: "700", color: "#0f172a" }}>
          {card.display.title}
        </Text>
        {card.display.lines.map((line, lineIndex) => (
          <Text key={lineIndex} numberOfLines={1} style={{ marginTop: 2, fontSize: 13, color: "#475569" }}>
            {line}
          </Text>
        ))}
      </Pressable>
    ));
  }

  // Feature 038: a conversion's announcement names the task it created rather than
  // repeating the plain sentence stored on the row. It is not a link: the announcement's
  // metadata carries no project id, and every mobile task route is project-scoped. The
  // chip on the source message does have one, and that is what navigates.
  if (
    messageKind === "system" &&
    systemEventType === SYSTEM_EVENT_TASK_CREATED_FROM_MESSAGE &&
    timelineMetadata?.taskId &&
    timelineMetadata?.identifier
  ) {
    return (
      <View
        testID="task-created-from-message-announcement"
        style={{
          paddingHorizontal: 12,
          paddingVertical: 10,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: "#e2e8f0",
          backgroundColor: "#f8fafc",
          maxWidth: Math.min(contentWidth, 320),
        }}
      >
        <Text style={{ fontSize: 11, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase", color: "#64748b" }}>
          Created task
        </Text>
        <Text style={{ marginTop: 2, fontSize: 15, fontWeight: "700", color: "#0f172a" }}>
          {timelineMetadata.identifier}
        </Text>
        {timelineMetadata.title ? (
          <Text style={{ marginTop: 2, fontSize: 13, color: "#475569" }} numberOfLines={2}>
            {timelineMetadata.title}
          </Text>
        ) : null}
      </View>
    );
  }

  if (voiceCallEvent) {
    return (
      <VoiceCallRecord
        label={voiceCallEvent.label}
        callId={timelineMetadata?.callId}
        channelId={channelId}
        messageTimestamp={messageTimestamp}
        outcomeHint={voiceCallEvent.outcomeHint}
        maxWidth={Math.min(contentWidth, 320)}
      />
    );
  }

  if (isVoiceMessage) {
    return (
      <VoiceMessagePlayer
        fileId={fileIds[0]}
        durationMs={timelineMetadata?.durationMs}
        waveformPeaks={metadataWaveformPeaks(timelineMetadata)}
        maxWidth={Math.min(contentWidth, 320)}
      />
    );
  }

  if (hasHtml) {
    return (
      <View>
        {hasDisplayMessageText ? (
          <RenderHtml
            contentWidth={contentWidth}
            source={{ html: displayMessageText }}
            baseStyle={defaultHtmlBaseStyle}
            tagsStyles={defaultHtmlTagsStyles}
            defaultTextProps={{ selectable: true }}
          />
        ) : null}
        {renderPreviewCards()}
      </View>
    );
  }

  return (
    <View>
      {hasDisplayMessageText ? (
        <Text selectable style={textStyle ?? defaultHtmlBaseStyle}>
          {textSegments.map((segment, index) =>
            segment.kind === "link" ? (
              <Text
                key={`canonical-link-${index}`}
                style={{ color: "#2563eb", textDecorationLine: "underline" }}
                onPress={() => void openCanonicalLink(segment.value)}
              >
                {segment.value}
              </Text>
            ) : (
              <React.Fragment key={`text-${index}`}>{segment.value}</React.Fragment>
            )
          )}
        </Text>
      ) : null}
      {renderPreviewCards()}
    </View>
  );
}
import React, { useEffect, useMemo, useState } from "react";
import { Linking, Pressable, Text, View, type StyleProp, type TextStyle } from "react-native";
import { usePathname, useRouter } from "expo-router";
import RenderHtml from "react-native-render-html";

import {
  extractFirstCanonicalResourceLink,
  getCanonicalLinkPreviewDisplay,
  removeCanonicalResourceLinksFromContent,
  splitTextByCanonicalResourceLinks,
  type CanonicalLinkPreview,
} from "@tech-office/links";

import { fetchCanonicalPreview, getCanonicalInAppRoute } from "@/lib/canonical-links";
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
}

interface VoiceTimelineMetadata {
  callId?: string;
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
  metadataJson,
  channelId,
  messageTimestamp,
  contentWidth,
  textStyle,
}: ChatMessageBodyProps) {
  const router = useRouter();
  const pathname = usePathname();
  const hasHtml = /<[a-z][\s\S]*>/i.test(messageText);
  const canonicalLink = useMemo(() => extractFirstCanonicalResourceLink(messageText), [messageText]);
  const [preview, setPreview] = useState<CanonicalLinkPreview | null>(null);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const previewDisplay = useMemo(
    () => getCanonicalLinkPreviewDisplay(preview, previewLoaded ? canonicalLink : null),
    [canonicalLink, preview, previewLoaded],
  );
  const displayMessageText = useMemo(
    () => previewDisplay ? removeCanonicalResourceLinksFromContent(messageText) : messageText,
    [messageText, previewDisplay],
  );
  const timelineMetadata = useMemo(() => parseTimelineMetadata(metadataJson), [metadataJson]);
  const textSegments = useMemo(() => splitTextByCanonicalResourceLinks(displayMessageText), [displayMessageText]);
  const hasDisplayMessageText = displayMessageText.trim().length > 0;
  const voiceCallEvent = voiceCallEventFromText(displayMessageText);
  const isVoiceMessage = (messageKind === "voice" || displayMessageText.trim() === "Voice message") && fileIds.length > 0;

  useEffect(() => {
    if (!canonicalLink) {
      setPreview(null);
      setPreviewLoaded(false);
      return;
    }
    let cancelled = false;
    const previewURL = canonicalLink;
    setPreviewLoaded(false);

    async function loadPreview() {
      const payload = await fetchCanonicalPreview(previewURL);
      if (!cancelled) {
        setPreview(payload?.preview ?? null);
        setPreviewLoaded(true);
      }
    }

    void loadPreview();
    return () => {
      cancelled = true;
    };
  }, [canonicalLink]);

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

  function renderPreviewCard() {
    if (!previewDisplay) {
      return null;
    }
    return (
      <Pressable
        testID="canonical-link-preview-card"
        onPress={() => void openCanonicalLink(previewDisplay.href)}
        style={({ pressed }) => ({
          marginTop: hasDisplayMessageText ? 10 : 0,
          paddingHorizontal: 14,
          paddingVertical: 12,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: pressed ? "#1d4ed8" : "#bfdbfe",
          backgroundColor: pressed ? "#dbeafe" : "#eff6ff",
        })}
      >
        <Text style={{ fontSize: 11, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase", color: "#1d4ed8" }}>
          {previewDisplay.badge}
        </Text>
        <Text style={{ marginTop: 4, fontSize: 15, fontWeight: "700", color: "#0f172a" }}>
          {previewDisplay.title}
        </Text>
        {previewDisplay.subtitle ? (
          <Text style={{ marginTop: 2, fontSize: 13, color: "#475569" }}>
            {previewDisplay.subtitle}
          </Text>
        ) : null}
      </Pressable>
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
        {renderPreviewCard()}
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
      {renderPreviewCard()}
    </View>
  );
}
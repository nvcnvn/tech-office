/**
 * Authenticated App Layout — Tab Bar
 *
 * Professional workspace tab navigation with 5 tabs:
 * Chat, Tasks, Calendar, Notifications, More
 *
 * High-contrast light theme with subtle borders and restrained styling.
 */

import { Redirect, Tabs, useRouter } from "expo-router";
import React from "react";
import { ActivityIndicator, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getUnreadCount } from "apis";
import {
  joinVoiceCall,
  leaveVoiceCall,
  respondToVoiceCallInvite,
  voiceCallErrorMessage,
  type VoiceJoinCredentials,
} from "apis";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AuthContext } from "@/hooks/use-auth";
import { LiveNotificationBanner } from "@/components/ui/live-notification-banner";
import { ActiveVoiceCallBar } from "@/components/voice/active-voice-call-bar";
import { IncomingVoiceCallPrompt } from "@/components/voice/incoming-voice-call-prompt";
import { OfflineBanner } from "@/components/ui/offline-banner";
import { useAppStatePresence } from "@/hooks/use-app-state-presence";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { useNotificationStream } from "@/providers/notification-stream-provider";
import { useStreamRecoveryRefresh } from "@/hooks/use-stream-recovery-refresh";
import { notificationStreamBehavior } from "@/lib/notification-stream-behavior";
import { NOTIFICATIONS_HOME_HREF } from "@/lib/linking";
import {
  getTabLabel,
  getTabRootHref,
  inferOwnerTabFromHref,
  withNavigationContext,
} from "@/lib/mobile-navigation";
import {
  voiceClient,
  type VoiceClientSnapshot,
} from "@/lib/voice/voice-client";
import Ionicons from "@expo/vector-icons/Ionicons";
import {
  lightPalette,
  mobileLayout,
  touch,
  tabIcons,
  mobileTypography,
} from "@tech-office/theme-tokens";

/** Map tab keys to Ionicons names (outline / filled) */
const TAB_IONICONS = {
  chat: { outline: "chatbubble-outline", filled: "chatbubble" },
  tasks: { outline: "checkbox-outline", filled: "checkbox" },
  calendar: { outline: "calendar-outline", filled: "calendar" },
  alerts: { outline: "notifications-outline", filled: "notifications" },
  more: { outline: "ellipsis-horizontal", filled: "ellipsis-horizontal" },
} as const;

function protoToDate(ts: { seconds?: number | bigint | string } | null | undefined): Date | null {
  if (!ts) return null;
  const secs = Number(ts.seconds ?? 0);
  return secs > 0 ? new Date(secs * 1000) : null;
}

function toVoiceJoinCredentials(
  credentials: VoiceJoinCredentials | undefined | null,
  activeCallId?: string,
  activeChannelId?: string,
) {
  if (!credentials?.livekitToken || !credentials.roomName) return null;
  return {
    livekitUrl: credentials.livekitUrl,
    livekitToken: credentials.livekitToken,
    roomName: credentials.roomName,
    activeCallId,
    activeChannelId,
    expiresAt: credentials.expiresAt
      ? protoToDate(credentials.expiresAt)?.toISOString()
      : undefined,
  };
}

function TabIcon({
  tab,
  focused,
  color,
}: {
  tab: keyof typeof TAB_IONICONS;
  focused: boolean;
  color: string;
}) {
  const icon = TAB_IONICONS[tab];
  return (
    <Ionicons
      name={focused ? icon.filled : icon.outline}
      size={24}
      color={color}
    />
  );
}

export default function AppLayout() {
  const auth = React.use(AuthContext);
  const router = useRouter();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const {
    liveNotification,
    dismissLiveNotification,
    incomingVoiceCall,
    clearIncomingVoiceCall,
  } = useNotificationStream();
  const [voicePromptAction, setVoicePromptAction] = React.useState<"accept" | "decline" | null>(null);
  const [voicePromptError, setVoicePromptError] = React.useState<string | null>(null);
  const [activeVoiceLeaving, setActiveVoiceLeaving] = React.useState(false);
  const [voiceSnapshot, setVoiceSnapshot] = React.useState<VoiceClientSnapshot>(() =>
    voiceClient.getSnapshot(),
  );

  React.useEffect(() => voiceClient.subscribe(setVoiceSnapshot), []);

  React.useEffect(() => {
    if (!__DEV__) {
      return;
    }

    if (!liveNotification) {
      console.log("[notification-stream-ui] banner cleared");
      return;
    }

    console.log(
      `[notification-stream-ui] banner visible ${JSON.stringify({
        id: liveNotification.id,
        title: liveNotification.title,
        body: liveNotification.body,
        count: liveNotification.count,
        targetHref: liveNotification.targetHref,
      })}`,
    );
  }, [liveNotification]);

  useAppStatePresence();
  usePushNotifications();

  React.useEffect(() => {
    if (incomingVoiceCall) {
      setVoicePromptError(null);
      setVoicePromptAction(null);
    }
  }, [incomingVoiceCall?.id]);

  const navigateToVoiceCallChannel = React.useCallback((channelId: string) => {
    const targetHref = `/(app)/(chat)/${channelId}`;
    router.push(
      withNavigationContext(targetHref, {
        ownerTab: "chat",
        fallbackHref: getTabRootHref("chat"),
        backLabel: getTabLabel("chat"),
      }) as never,
    );
  }, [router]);

  const handleAcceptIncomingCall = React.useCallback(async () => {
    if (!incomingVoiceCall || voicePromptAction) return;
    setVoicePromptAction("accept");
    setVoicePromptError(null);
    try {
      let credentials = null;
      if (incomingVoiceCall.invitationId) {
        const response = await respondToVoiceCallInvite({
          invitationId: incomingVoiceCall.invitationId,
          response: "accept",
        });
        credentials = toVoiceJoinCredentials(
          response.joinCredentials,
          incomingVoiceCall.callId,
          incomingVoiceCall.channelId,
        );
      } else {
        const response = await joinVoiceCall(incomingVoiceCall.callId);
        credentials = toVoiceJoinCredentials(
          response.joinCredentials,
          incomingVoiceCall.callId,
          incomingVoiceCall.channelId,
        );
      }

      if (credentials) {
        await voiceClient.disconnect();
        await voiceClient.connect(credentials);
      }

      clearIncomingVoiceCall(incomingVoiceCall.callId);
      navigateToVoiceCallChannel(incomingVoiceCall.channelId);
    } catch (error) {
      setVoicePromptError(voiceCallErrorMessage(error, "Unable to answer voice call."));
    } finally {
      setVoicePromptAction(null);
    }
  }, [clearIncomingVoiceCall, incomingVoiceCall, navigateToVoiceCallChannel, voicePromptAction]);

  const handleDeclineIncomingCall = React.useCallback(async () => {
    if (!incomingVoiceCall || voicePromptAction) return;
    setVoicePromptAction("decline");
    setVoicePromptError(null);
    try {
      if (incomingVoiceCall.invitationId) {
        await respondToVoiceCallInvite({
          invitationId: incomingVoiceCall.invitationId,
          response: "decline",
        });
      }
      clearIncomingVoiceCall(incomingVoiceCall.callId);
    } catch (error) {
      setVoicePromptError(voiceCallErrorMessage(error, "Unable to decline voice call."));
    } finally {
      setVoicePromptAction(null);
    }
  }, [clearIncomingVoiceCall, incomingVoiceCall, voicePromptAction]);

  const handleReturnToActiveVoiceCall = React.useCallback(() => {
    if (!voiceSnapshot.activeChannelId) {
      return;
    }
    navigateToVoiceCallChannel(voiceSnapshot.activeChannelId);
  }, [navigateToVoiceCallChannel, voiceSnapshot.activeChannelId]);

  const handleLeaveActiveVoiceCall = React.useCallback(async () => {
    if (!voiceSnapshot.activeCallId || activeVoiceLeaving) {
      return;
    }
    const callId = voiceSnapshot.activeCallId;
    const channelId = voiceSnapshot.activeChannelId;
    setActiveVoiceLeaving(true);
    try {
      await voiceClient.disconnect();
      await leaveVoiceCall(callId).catch(() => undefined);
      queryClient.invalidateQueries({ queryKey: ["recentChannels"] });
      queryClient.invalidateQueries({ queryKey: ["channels"] });
      if (channelId) {
        queryClient.invalidateQueries({ queryKey: ["messages", channelId] });
      }
    } finally {
      setActiveVoiceLeaving(false);
    }
  }, [activeVoiceLeaving, queryClient, voiceSnapshot.activeCallId, voiceSnapshot.activeChannelId]);

  const { data: unreadData, refetch: refetchUnreadCount } = useQuery({
    queryKey: ["unread-count"],
    queryFn: () => getUnreadCount(),
    enabled: !!auth?.isAuthenticated,
  });

  useStreamRecoveryRefresh(refetchUnreadCount, {
    intervalMs: notificationStreamBehavior.fallbackPollMs.unreadCount,
    enabled: !!auth?.isAuthenticated,
    requireFocus: false,
  });

  if (auth?.isLoading) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: lightPalette.background.default,
        }}
      >
        <ActivityIndicator size="large" color={lightPalette.primary.main} />
      </View>
    );
  }

  // Guard: redirect to auth if not authenticated
  if (!auth?.isAuthenticated) {
    return <Redirect href="/(auth)" />;
  }

  const unreadCount = (unreadData as any)?.unreadCount ?? 0;
  const showActiveVoiceCallBar = Boolean(
    voiceSnapshot.activeCallId &&
      voiceSnapshot.activeChannelId &&
      voiceSnapshot.connectionState !== "idle" &&
      voiceSnapshot.connectionState !== "disconnected" &&
      voiceSnapshot.connectionState !== "disconnecting",
  );

  return (
    <View style={{ flex: 1 }}>
      <OfflineBanner />
      {incomingVoiceCall ? (
        <IncomingVoiceCallPrompt
          title={incomingVoiceCall.title}
          body={incomingVoiceCall.body}
          alreadyInAnotherCall={incomingVoiceCall.alreadyInAnotherCall}
          loadingAction={voicePromptAction}
          error={voicePromptError}
          onAccept={() => void handleAcceptIncomingCall()}
          onDecline={() => void handleDeclineIncomingCall()}
        />
      ) : liveNotification ? (
        <LiveNotificationBanner
          title={liveNotification.title}
          body={liveNotification.body}
          count={liveNotification.count}
          senderNames={liveNotification.senderNames}
          kind={liveNotification.kind}
          onDismiss={dismissLiveNotification}
          onPress={() => {
            dismissLiveNotification();
            if (liveNotification.targetHref && liveNotification.targetHref !== NOTIFICATIONS_HOME_HREF) {
              const ownerTab = inferOwnerTabFromHref(liveNotification.targetHref);
              router.push(
                withNavigationContext(liveNotification.targetHref, {
                  ownerTab,
                  fallbackHref: ownerTab ? getTabRootHref(ownerTab) : NOTIFICATIONS_HOME_HREF,
                  backLabel: ownerTab ? getTabLabel(ownerTab) : "Alerts",
                }) as never,
              );
            }
          }}
        />
      ) : null}
      {!incomingVoiceCall && !liveNotification && showActiveVoiceCallBar ? (
        <ActiveVoiceCallBar
          connectionState={voiceSnapshot.connectionState}
          isMuted={voiceSnapshot.isMuted}
          leaving={activeVoiceLeaving}
          onReturn={handleReturnToActiveVoiceCall}
          onLeave={() => void handleLeaveActiveVoiceCall()}
        />
      ) : null}
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: lightPalette.primary.main,
          tabBarInactiveTintColor: lightPalette.text.disabled,
          tabBarStyle: {
            height: mobileLayout.tabBarHeight + insets.bottom,
            backgroundColor: lightPalette.background.paper,
            borderTopWidth: 0.5,
            borderTopColor: lightPalette.divider,
          },
          tabBarItemStyle: {
            minHeight: touch.comfortable,
            paddingTop: 6,
          },
          tabBarLabelStyle: {
            fontSize: 11,
            fontWeight: "500" as const,
            letterSpacing: 0.1,
          },
          tabBarShowLabel: true,
        }}
      >
        <Tabs.Screen
          name="(chat)"
          options={{
            title: tabIcons.chat.label,
            headerShown: false,
            popToTopOnBlur: true,
            tabBarButtonTestID: tabIcons.chat.testID,
            tabBarIcon: ({ color, focused }) => (
              <TabIcon tab="chat" focused={focused} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="(tasks)"
          options={{
            title: tabIcons.tasks.label,
            headerShown: false,
            popToTopOnBlur: true,
            tabBarButtonTestID: tabIcons.tasks.testID,
            tabBarIcon: ({ color, focused }) => (
              <TabIcon tab="tasks" focused={focused} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="(calendar)"
          options={{
            title: tabIcons.calendar.label,
            headerShown: false,
            popToTopOnBlur: true,
            tabBarButtonTestID: tabIcons.calendar.testID,
            tabBarIcon: ({ color, focused }) => (
              <TabIcon tab="calendar" focused={focused} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="(notifications)"
          options={{
            title: tabIcons.alerts.label,
            headerShown: false,
            popToTopOnBlur: true,
            tabBarButtonTestID: tabIcons.alerts.testID,
            tabBarBadge:
              unreadCount > 0
                ? unreadCount > 99
                  ? "99+"
                  : String(unreadCount)
                : undefined,
            tabBarIcon: ({ color, focused }) => (
              <TabIcon tab="alerts" focused={focused} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="(more)"
          options={{
            href: "/(app)/(more)",
            title: tabIcons.more.label,
            headerShown: false,
            popToTopOnBlur: true,
            tabBarButtonTestID: tabIcons.more.testID,
            tabBarIcon: ({ color, focused }) => (
              <TabIcon tab="more" focused={focused} color={color} />
            ),
          }}
        />
      </Tabs>
    </View>
  );
}

/**
 * Authenticated App Layout — Tab Bar
 *
 * Four tabs: Chat, Today, My Work, More.
 *
 * Schedule and Alerts are still full route groups — they are simply not tab
 * slots. Alerts was a second inbox pointing at the other tabs' content, so it
 * now lives behind the bell in the Chat header; Schedule is reached from the
 * Today header, because Today already answers "what is on today" and a
 * separate agenda tab duplicated that answer.
 *
 * High-contrast light theme with subtle borders and restrained styling.
 */

import { Redirect, Tabs, useRouter } from "expo-router";
import React from "react";
import { ActivityIndicator, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import {
  joinVoiceCall,
  leaveVoiceCall,
  respondToVoiceCallInvite,
  voiceCallErrorMessage,
} from "apis";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AuthContext } from "@/hooks/use-auth";
import { LiveNotificationBanner } from "@/components/ui/live-notification-banner";
import { ActiveVoiceCallBar } from "@/components/voice/active-voice-call-bar";
import { IncomingVoiceCallPrompt } from "@/components/voice/incoming-voice-call-prompt";
import { OfflineBanner } from "@/components/ui/offline-banner";
import { TermsGate } from "@/components/compliance/terms-gate";
import { useAppStatePresence } from "@/hooks/use-app-state-presence";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { useNotificationStream } from "@/providers/notification-stream-provider";
import { NOTIFICATIONS_HOME_HREF } from "@/lib/linking";
import {
  getTabLabel,
  getTabRootHref,
  inferOwnerTabFromHref,
  withNavigationContext,
} from "@/lib/mobile-navigation";
import {
  voiceClient,
  toVoiceJoinCredentials,
  type VoiceClientSnapshot,
} from "@/lib/voice/voice-client";
import { startNativeCallIntegration } from "@/lib/voice/native-call";
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
  today: { outline: "sunny-outline", filled: "sunny" },
  tasks: { outline: "checkbox-outline", filled: "checkbox" },
  more: { outline: "ellipsis-horizontal", filled: "ellipsis-horizontal" },
} as const;

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

  // The OS-drawn call screen only works if something is listening for the wake. Started
  // here rather than at module load because a call cannot be joined without a workspace
  // session, and this is the first place one is guaranteed to exist.
  React.useEffect(() => {
    if (!auth?.isAuthenticated) return;
    return startNativeCallIntegration({
      getSession: () => ({ isAuthenticated: true }),
      // A call answered from the lock screen leaves the app on whatever screen it was
      // last on. Opening the conversation behind the system call UI is what makes the
      // in-app call bar, the participants and the transcript reachable once the user
      // unlocks.
      onAnswered: (_serverCallId, channelId) => {
        if (channelId) navigateToVoiceCallChannel(channelId);
      },
    });
  }, [auth?.isAuthenticated, navigateToVoiceCallChannel]);

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

  const showActiveVoiceCallBar = Boolean(
    voiceSnapshot.activeCallId &&
      voiceSnapshot.activeChannelId &&
      voiceSnapshot.connectionState !== "idle" &&
      voiceSnapshot.connectionState !== "disconnected" &&
      voiceSnapshot.connectionState !== "disconnecting",
  );

  return (
    <TermsGate>
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
          remoteParticipantCount={voiceSnapshot.remoteParticipantCount}
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
          name="(today)"
          options={{
            title: tabIcons.today.label,
            headerShown: false,
            popToTopOnBlur: true,
            tabBarButtonTestID: tabIcons.today.testID,
            tabBarIcon: ({ color, focused }) => (
              <TabIcon tab="today" focused={focused} color={color} />
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
        {/*
          Reachable, but not tab slots: Schedule opens from the Today header,
          Alerts from the bell in the Chat header. Both keep their route group
          so deep links, push notifications and canonical links still resolve.
        */}
        <Tabs.Screen name="(calendar)" options={{ href: null, headerShown: false }} />
        <Tabs.Screen name="(notifications)" options={{ href: null, headerShown: false }} />
      </Tabs>
    </View>
    </TermsGate>
  );
}

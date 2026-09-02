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

import { Redirect, Tabs, usePathname, useRouter } from "expo-router";
import React from "react";
import { ActivityIndicator, AppState, View } from "react-native";
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
import { TourProvider } from "@/providers/tour-provider";
import { useAppStatePresence } from "@/hooks/use-app-state-presence";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { useNotificationStream } from "@/providers/notification-stream-provider";
import { useInAppAlertsEnabled } from "@/lib/app-settings";
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
import {
  connectCallWithNativePresentation,
  useNativeCallPresentation,
} from "@/lib/voice/native-call";
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

// Chat is the tab people come back to all day; Today goes stale by lunchtime.
// Without this, React Navigation falls back to file-system order.
export const unstable_settings = {
  initialRouteName: "(chat)",
};

export default function AppLayout() {
  const auth = React.use(AuthContext);
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const {
    liveNotification,
    dismissLiveNotification,
    incomingVoiceCall,
    clearIncomingVoiceCall,
  } = useNotificationStream();
  const inAppAlertsEnabled = useInAppAlertsEnabled();
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

  // Read, never depended on, so navigating does not rebuild the callbacks below.
  const pathnameRef = React.useRef(pathname);
  pathnameRef.current = pathname;

  const navigateToVoiceCallChannel = React.useCallback((channelId: string) => {
    // Placing or answering a call from its own conversation already leaves the user on
    // the destination. Pushing it again stacks a second copy of the screen over the
    // identical one, which reads as a flicker. Suffix match, as in the call bar below.
    if (pathnameRef.current.endsWith(`/${channelId}`)) return;
    const targetHref = `/(app)/(chat)/${channelId}`;
    router.push(
      withNavigationContext(targetHref, {
        ownerTab: "chat",
        fallbackHref: getTabRootHref("chat"),
        backLabel: getTabLabel("chat"),
      }) as never,
    );
  }, [router]);

  // The one owner of "the OS is showing a call, put the user on it".
  //
  // On Android the system call banner carries no route: tapping its body, or answering
  // from the lock screen, brings the app up on whatever screen it was last showing — the
  // More tab, if that is where the user left it. iOS keeps the user on CallKit and never
  // exercises this. Routing from here rather than from the native answer callback is
  // what makes it work at all, because that callback fires while the app is still
  // starting up and this layout — the router the push needs — does not exist yet.
  //
  // Only while the app is actually in front: a call ignored in the background must not
  // silently relocate the app to the caller's conversation. Once per call, so returning
  // to the app mid-call does not drag the user off the screen they chose.
  const presentedNativeCall = useNativeCallPresentation();
  const routedNativeCallRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    const channelId = presentedNativeCall?.channelId;
    const serverCallId = presentedNativeCall?.serverCallId;
    if (!channelId || !serverCallId) return;

    const routeToCall = () => {
      if (AppState.currentState !== "active") return;
      if (routedNativeCallRef.current === serverCallId) return;
      // Counts as routed even when the user is already there, so walking away from a
      // call placed here is not undone by the next render.
      routedNativeCallRef.current = serverCallId;
      navigateToVoiceCallChannel(channelId);
    };

    routeToCall();
    const subscription = AppState.addEventListener("change", routeToCall);
    return () => subscription.remove();
  }, [navigateToVoiceCallChannel, presentedNativeCall]);

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
        await connectCallWithNativePresentation(credentials, {
          id: incomingVoiceCall.channelId,
          displayName: incomingVoiceCall.title,
        });
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

  // This bar exists to say "you left the call's conversation, tap to go back".
  // On the call's own channel there is nothing to return to: the channel already
  // carries its own call banner, and stacking the two under the OS call chip is
  // three rows of the same call. Suffix match so it holds whether or not the
  // router strips the (app)/(chat) group segments from the pathname.
  const onActiveVoiceCallChannel = Boolean(
    voiceSnapshot.activeChannelId &&
      pathname.endsWith(`/${voiceSnapshot.activeChannelId}`),
  );
  const showActiveVoiceCallBar = Boolean(
    voiceSnapshot.activeCallId &&
      voiceSnapshot.activeChannelId &&
      !onActiveVoiceCallChannel &&
      voiceSnapshot.connectionState !== "idle" &&
      voiceSnapshot.connectionState !== "disconnected" &&
      voiceSnapshot.connectionState !== "disconnecting",
  );

  return (
    <TermsGate>
    {/*
      The feature tour (Feature 039). Inside TermsGate and below the authentication guard
      above, so it can only appear once both mandatory gates are behind the person; the
      hook additionally holds it back while first-run onboarding is unfinished (FR-008).
    */}
    <TourProvider>
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
      ) : liveNotification && inAppAlertsEnabled ? (
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
          onToggleMute={() => void voiceClient.setMuted(!voiceSnapshot.isMuted)}
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
    </TourProvider>
    </TermsGate>
  );
}

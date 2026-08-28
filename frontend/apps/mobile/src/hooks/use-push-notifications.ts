/**
 * usePushNotifications — register native push tokens with the backend.
 *
 * Requests notification permissions, obtains a provider-native device token,
 * and registers it with the backend. Foreground presentation is still handled
 * by expo-notifications.
 */

import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { useRouter } from "expo-router";
import { getMessaging, getToken } from "@react-native-firebase/messaging";
import { registerPushToken } from "apis";
import { useAuth } from "@/hooks/use-auth";
import {
  NOTIFICATIONS_HOME_HREF,
  resolveNotificationPayloadHref,
} from "@/lib/linking";
import {
  getTabLabel,
  getTabRootHref,
  inferOwnerTabFromHref,
  withNavigationContext,
} from "@/lib/mobile-navigation";
import { ensureVoiceCallNotificationChannel } from "@/lib/voice/voice-notifications";
import { getVoIPPushToken, registerVoIPPush } from "expo-callkit-telecom";

interface NativePushRegistration {
  token: string;
  metadata: Record<string, string>;
}

/**
 * How long to wait for the VoIP push token after asking for it.
 *
 * PushKit hands the token to the app asynchronously, and on a cold start the request
 * usually lands before the token exists. Registering without it would leave the device
 * on the fallback ring until the next launch, so a short poll is worth it — and a
 * failure only costs the native tier for this session, never the call itself.
 */
const VOIP_TOKEN_WAIT_MS = 5_000;
const VOIP_TOKEN_POLL_MS = 250;

/**
 * Waits for the platform's VoIP push token.
 *
 * On iOS this is the PushKit token the backend addresses over its direct APNs
 * connection — Firebase cannot carry a VoIP push, which is the whole reason iOS needs a
 * second token at all. On Android the module reports the FCM token, which the device is
 * already registering separately, so there is nothing extra to store.
 */
async function waitForVoIPToken(): Promise<string | null> {
  registerVoIPPush();
  const deadline = Date.now() + VOIP_TOKEN_WAIT_MS;
  while (Date.now() < deadline) {
    const voip = getVoIPPushToken();
    if (voip?.type === "APNS_VOIP" && voip.token) {
      return voip.token;
    }
    if (voip?.type === "FCM") {
      // Android's call transport is the FCM token already registered below.
      return null;
    }
    await new Promise((resolve) => setTimeout(resolve, VOIP_TOKEN_POLL_MS));
  }
  return null;
}

const PUSH_INSTALLATION_ID_KEY = "push.installation-id";

function normalizeDeviceTokenData(data: unknown): string | null {
  if (typeof data === "string") {
    const trimmed = data.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (
    data &&
    typeof data === "object" &&
    "token" in data &&
    typeof (data as { token?: unknown }).token === "string"
  ) {
    const token = (data as { token: string }).token.trim();
    return token.length > 0 ? token : null;
  }

  return null;
}

async function getNativePushRegistration(): Promise<NativePushRegistration | null> {
  if (Platform.OS === "android") {
    const deviceToken = await Notifications.getDevicePushTokenAsync();
    const token = normalizeDeviceTokenData(deviceToken.data);
    if (!token) return null;

    return {
      token,
      metadata: {
        platform: "android",
        tokenType: "native",
        deliveryProvider: "fcm",
        registrationLibrary: "expo-notifications",
      },
    };
  }

  if (Platform.OS === "ios") {
    const messaging = getMessaging();
    await messaging.registerDeviceForRemoteMessages();
    const token = normalizeDeviceTokenData(await getToken(messaging));
    if (!token) return null;

    return {
      token,
      metadata: {
        platform: "ios",
        tokenType: "native",
        deliveryProvider: "fcm",
        registrationLibrary: "@react-native-firebase/messaging",
      },
    };
  }

  return null;
}

async function getStablePushDeviceIdentifier(): Promise<string> {
  const existingId = await SecureStore.getItemAsync(PUSH_INSTALLATION_ID_KEY);
  if (existingId && existingId.trim().length > 0) {
    return `${Platform.OS}-${existingId.trim()}`;
  }

  const installationId = Crypto.randomUUID();
  await SecureStore.setItemAsync(PUSH_INSTALLATION_ID_KEY, installationId);
  return `${Platform.OS}-${installationId}`;
}

function stringFromNotificationData(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function notificationDataToStringMap(
  data: Record<string, unknown> | undefined,
): Record<string, string> {
  if (!data) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(data)
      .map(([key, value]) => [key, stringFromNotificationData(value)] as const)
      .filter((entry): entry is readonly [string, string] => Boolean(entry[1])),
  );
}

function isSoundOnlyNotificationData(data: Record<string, unknown> | undefined): boolean {
  const value = data?.soundOnly;
  return value === true || value === "true" || value === 1 || value === "1";
}

function resolveNotificationResponseHref(
  response: Notifications.NotificationResponse,
): string | null {
  const data = notificationDataToStringMap(
    response.notification.request.content.data,
  );

  const sourceDomain = data.sourceDomain ?? data.source_domain;
  const notificationType = data.notificationType ?? data.notification_type;
  const channelId = data.channelId ?? data.channel_id;

  if (notificationType === "voice_call_incoming" && channelId) {
    return `/(app)/(chat)/${channelId}`;
  }

  if (data.href) {
    return data.href;
  }

  if (!sourceDomain && !notificationType && !channelId) {
    return null;
  }

  return resolveNotificationPayloadHref({
    sourceDomain,
    notificationType,
    actionData: data,
    navigationTarget: {
      domain: data.navigationDomain ?? data.domain,
      resourceType: data.navigationResourceType ?? data.resourceType,
      resourceId: data.navigationResourceId ?? data.resourceId,
      secondaryId: data.navigationSecondaryId ?? data.secondaryId,
      action: data.navigationAction ?? data.action,
      deepLink: data.deepLink,
    },
  });
}

// Show notifications as alerts even when the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const soundOnly = isSoundOnlyNotificationData(
      notification.request.content.data as Record<string, unknown> | undefined,
    );

    return {
      shouldShowAlert: !soundOnly,
      shouldPlaySound: true,
      shouldSetBadge: !soundOnly,
      shouldShowBanner: !soundOnly,
      shouldShowList: !soundOnly,
    };
  },
});

/**
 * Registers for push notifications and sends the token to the backend.
 * Call once in the authenticated root layout.
 */
export function usePushNotifications() {
  const auth = useAuth();
  const router = useRouter();
  const registeredEmployeeIdRef = useRef<string | null>(null);
  const handledResponseRef = useRef<string | null>(null);

  useEffect(() => {
    function handleNotificationResponse(
      response: Notifications.NotificationResponse | null,
    ) {
      if (!response) {
        return;
      }

      const responseId = response.notification.request.identifier;
      if (handledResponseRef.current === responseId) {
        return;
      }

      const href = resolveNotificationResponseHref(response);
      if (!href) {
        return;
      }

      handledResponseRef.current = responseId;
      const ownerTab = inferOwnerTabFromHref(href);
      const contextualHref = withNavigationContext(href, {
        ownerTab,
        fallbackHref: ownerTab ? getTabRootHref(ownerTab) : NOTIFICATIONS_HOME_HREF,
        backLabel: ownerTab ? getTabLabel(ownerTab) : "Alerts",
      });
      router.push(contextualHref as never);
      Notifications.clearLastNotificationResponse?.();
    }

    Notifications.getLastNotificationResponseAsync()
      .then(handleNotificationResponse)
      .catch(() => {});

    const subscription = Notifications.addNotificationResponseReceivedListener(
      handleNotificationResponse,
    );

    return () => subscription.remove();
  }, [router]);

  useEffect(() => {
    if (!auth.isAuthenticated || !auth.employeeId) {
      registeredEmployeeIdRef.current = null;
      return;
    }

    if (registeredEmployeeIdRef.current === auth.employeeId) {
      return;
    }

    async function register() {
      try {
        if (Platform.OS === "android") {
          await Notifications.setNotificationChannelAsync("default", {
            name: "default",
            importance: Notifications.AndroidImportance.MAX,
            sound: "default",
            enableVibrate: true,
            vibrationPattern: [0, 250, 200, 250],
          });
          await ensureVoiceCallNotificationChannel();
        }

        // Request permission
        const { status: existingStatus } =
          await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;

        if (existingStatus !== "granted") {
          const { status } = await Notifications.requestPermissionsAsync({
            ios: {
              allowAlert: true,
              allowBadge: true,
              allowSound: true,
            },
          });
          finalStatus = status;
        }

        if (finalStatus !== "granted") {
          // User denied — nothing more we can do
          return;
        }

        const registration = await getNativePushRegistration();
        if (!registration?.token) {
          console.warn("[push] native push token unavailable; skipping registration");
          return;
        }

        const pushToken = registration.token;
        const deviceId = await getStablePushDeviceIdentifier();

        // The VoIP token is fetched before either registration so both rows agree about
        // whether this device can run the native call tier. A device that claims the
        // native tier but has no VoIP token would be routed to a transport that cannot
        // reach it — a phone that silently never rings.
        const voipToken = Platform.OS === "ios" ? await waitForVoIPToken() : null;
        const nativeCallCapable = Platform.OS === "android" || Boolean(voipToken);

        await registerPushToken({
          fcmToken: pushToken,
          deviceIdentifier: deviceId,
          permissionState: "granted",
          endpoint: "",
          keysJson: "",
          userAgent: `TechOffice-Mobile/${Platform.OS}`,
          tokenMetadata: registration.metadata,
          tokenType: "fcm",
          nativeCallCapable,
        });

        // A second row under the same device identifier, not a second device: the
        // backend fans calls out per device and needs both of this one's tokens to know
        // it has a choice of transport.
        if (voipToken) {
          await registerPushToken({
            fcmToken: voipToken,
            deviceIdentifier: deviceId,
            permissionState: "granted",
            endpoint: "",
            keysJson: "",
            userAgent: `TechOffice-Mobile/${Platform.OS}`,
            tokenMetadata: {
              platform: "ios",
              deliveryProvider: "apns",
              registrationLibrary: "expo-callkit-telecom",
            },
            tokenType: "apns_voip",
            nativeCallCapable: true,
          });
        }

        registeredEmployeeIdRef.current = auth.employeeId;
      } catch (err) {
        // Silently fail — push is a best-effort feature.
        // Token registration will be retried on next app restart.
        console.warn("[push] registration failed:", err);
      }
    }

    register();
  }, [auth.employeeId, auth.isAuthenticated]);
}

/**
 * Workspace Layout
 * Tab-based workspace layout for all business domains
 *
 * Design Philosophy:
 * - Single main focus area with tab switching between domains
 * - Persistent right sidebar for contextual information
 * - Quick tab shortcuts (Cmd+1, Cmd+2, etc.)
 * - Optimized for wide screens with limited vertical space (13-inch laptops)
 * - Minimal chrome: 56px header + isolated scroll containers
 * - Better for deep focus on one domain at a time
 */

"use client";

import React, { useState, useEffect, Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRequireAuth } from "@/lib/auth/hooks";
import type { UserProfile } from "@/lib/auth/types";
import { CircularProgress, Box } from "@mui/material";
import TabLink from "@/components/TabLink";
import {
  handleChatNotificationAction,
  isChatPayload,
} from "./chat/utils/notificationActions";
import type { Notification } from "@tech-office/notifications";
import { resolveWorkspaceNotificationHref } from "./notifications/utils/notificationNavigation";
import dynamic from "next/dynamic";
import GlobalSearchBar from "./components/GlobalSearchBar";
import { usePresenceTracking } from "@/hooks/usePresenceTracking";
import { useServiceWorker } from "@/hooks/useServiceWorker";
import { usePushPermission } from "@/hooks/usePushPermission";
import {
  useNotificationPopup,
  type NotificationPopup as NotificationPopupType,
} from "@/hooks/useNotificationPopup";
import NotificationPopup from "@/components/NotificationPopup";
import { NotificationPermissionBanner } from "@/components/NotificationPermissionBanner";
import { NotificationStreamProvider } from "./providers/NotificationStreamProvider";
import { ContextRail } from "./components/context-rail/ContextRail";
import { GlobalContextBlocks } from "./components/context-rail/GlobalContextBlocks";
import { useContextRail } from "./providers/useContextRail";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UserMenu } from "@/components/UserMenu";
import { ThemeProvider } from "@/components/ThemeProvider";
import { useThemeColors } from "@/theme/useThemeColors";
import { OrganizationSwitcherDropdown } from "@/components/OrganizationSwitcherDropdown";
import { GlobalIncomingVoiceCall } from "./voice/GlobalIncomingVoiceCall";
import { versionedPublicAssetPath } from "@/lib/publicAsset";

// Dynamically import ChannelSidebar to avoid loading it on non-chat pages
const ChannelSidebar = dynamic(
  () => import("./chat/components/ChannelSidebar"),
  { ssr: false },
);

const FIREBASE_CONFIG_URL = versionedPublicAssetPath("/firebase-config.json");

type DomainTab =
  | "organization"
  | "employees"
  | "notifications"
  | "tasks"
  | "chat"
  | "files"
  | "docs"
  | "calendar"
  | "crm"
  | "finance"
  | "hr";

interface TabConfig {
  id: DomainTab;
  label: string;
  emoji: string;
  path: string;
  shortcut: string;
  enabled: boolean; // For gradual rollout of features
  permission?: string; // If set, tab is only shown when user has this permission
}

// Tabs ordered by workday priority:
// 1-4: Daily essentials (everyone) — Calendar → Notifications → Chat → Tasks
// 5-6: Reference (everyone) — Docs → Files
// 7: Management (operator/owner only) — Organization
const tabs: TabConfig[] = [
  {
    id: "calendar",
    label: "Calendar",
    emoji: "📅",
    path: "/workspace/calendar",
    shortcut: "⌘1",
    enabled: true,
  },
  {
    id: "notifications",
    label: "Notifications",
    emoji: "🔔",
    path: "/workspace/notifications",
    shortcut: "⌘2",
    enabled: true,
  },
  {
    id: "chat",
    label: "Chat",
    emoji: "💬",
    path: "/workspace/chat",
    shortcut: "⌘3",
    enabled: true,
  },
  {
    id: "tasks",
    label: "Tasks",
    emoji: "📋",
    path: "/workspace/tasks",
    shortcut: "⌘4",
    enabled: true,
  },
  {
    id: "docs",
    label: "Docs",
    emoji: "📄",
    path: "/workspace/docs",
    shortcut: "⌘5",
    enabled: true,
  },
  {
    id: "files",
    label: "Files",
    emoji: "📁",
    path: "/workspace/files",
    shortcut: "⌘6",
    enabled: true,
  },
  {
    id: "organization",
    label: "Organization",
    emoji: "🏢",
    path: "/workspace/organization",
    shortcut: "⌘7",
    enabled: true,
    permission: "iam.inviteUser",
  },
  {
    id: "crm",
    label: "CRM",
    emoji: "🤝",
    path: "/workspace/crm",
    shortcut: "⌘8",
    enabled: false,
  },
  {
    id: "finance",
    label: "Finance",
    emoji: "💰",
    path: "/workspace/finance",
    shortcut: "⌘9",
    enabled: false,
  },
  {
    id: "hr",
    label: "HR",
    emoji: "👤",
    path: "/workspace/hr",
    shortcut: "⌘-",
    enabled: false,
  },
];

export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isLoading, user } = useRequireAuth();

  // Show loading state while checking authentication
  if (isLoading) {
    return (
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  // If not authenticated, useRequireAuth will handle redirect
  if (!user) {
    return null;
  }

  return (
    <Suspense
      fallback={
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "100vh",
          }}
        >
          <CircularProgress />
        </Box>
      }
    >
      <WorkspaceLayoutContent user={user}>{children}</WorkspaceLayoutContent>
    </Suspense>
  );
}

function WorkspaceLayoutContent({
  children,
  user,
}: {
  children: React.ReactNode;
  user: UserProfile;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const organizationId = user.organizationId || "";

  // Extract active channel ID from URL for presence tracking
  const activeChannelId = pathname.startsWith("/workspace/chat")
    ? searchParams.get("channel") || undefined
    : undefined;

  // T045: Presence tracking with active channel context
  usePresenceTracking({
    activeChannelId,
    enabled: true,
  });

  // T041: Service worker registration for FCM
  const { registration, isReady: swReady } = useServiceWorker({
    autoRegister: true,
  });

  // State for FCM token
  const [fcmToken, setFcmToken] = useState<string | undefined>(undefined);

  // T040: Push notification permission (after service worker is ready)
  const {
    isGranted: pushGranted,
    isRequesting: isRequestingPushPermission,
    needsSoundActivation,
    requestPermission: requestPushPermission,
  } = usePushPermission({
    autoRequest: false, // Will show friendly banner instead
    fcmToken, // Pass FCM token for registration
  });

  // Obtain FCM token when service worker is ready and permission granted
  useEffect(() => {
    if (!swReady || !registration || pushGranted === false) return;

    const getFcmToken = async () => {
      try {
        // Dynamically import Firebase messaging
        const { getMessaging, getToken } = await import("firebase/messaging");
        const { initializeApp, getApps } = await import("firebase/app");

        // Load Firebase config
        const response = await fetch(FIREBASE_CONFIG_URL);
        const firebaseConfig = await response.json();

        // Initialize Firebase app if not already initialized
        const app =
          getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
        const messaging = getMessaging(app);

        // Get FCM token (vapidKey from Firebase Console)
        const token = await getToken(messaging, {
          serviceWorkerRegistration: registration,
          vapidKey: firebaseConfig.vapidKey, // Add this to firebase-config.json
        });

        if (token) {
          console.log(
            "[WorkspaceLayout] FCM token obtained:",
            token.substring(0, 20) + "...",
          );
          setFcmToken(token);
        } else {
          console.warn(
            "[WorkspaceLayout] No FCM token available. Check permission and VAPID key.",
          );
        }
      } catch (err) {
        console.error("[WorkspaceLayout] Failed to get FCM token:", err);
      }
    };

    getFcmToken();
  }, [swReady, registration, pushGranted]);

  // T047: FCM foreground message handling
  useEffect(() => {
    if (!swReady || !registration) return;

    // Handle foreground FCM messages (when app is open)
    const handleForegroundMessage = async () => {
      try {
        // Dynamically import Firebase messaging (client-side only)
        const { getMessaging, onMessage } = await import("firebase/messaging");
        const { initializeApp, getApps } = await import("firebase/app");

        // Load Firebase config
        const response = await fetch(FIREBASE_CONFIG_URL);
        const firebaseConfig = await response.json();

        // Initialize Firebase app if not already initialized
        const app =
          getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
        const messaging = getMessaging(app);

        // Listen for foreground messages
        onMessage(messaging, (payload) => {
          console.log(
            "[WorkspaceLayout] Foreground FCM message received:",
            payload,
          );

          // Display in-app notification via NotificationPopup
          // The notification will be shown by the NotificationStreamProvider
          // No need to manually trigger popup here - SSE handles it

          // Parse notification data
          const data = payload.data;
          if (data) {
            // Handle deep link params if notification clicked while app open
            // Example: { channelId: '...', messageId: '...', notificationId: '...' }
            console.log("[WorkspaceLayout] FCM data:", data);
          }
        });

        console.log(
          "[WorkspaceLayout] FCM foreground message listener registered",
        );
      } catch (err) {
        console.error(
          "[WorkspaceLayout] Failed to setup FCM foreground listener:",
          err,
        );
      }
    };

    handleForegroundMessage();
  }, [swReady, registration]);

  // Periodic notification status check - auto-recover when user enables permissions
  useEffect(() => {
    // Check notification status every 60 seconds
    const checkStatus = async () => {
      try {
        const { checkNotificationStatus } = await import("apis");
        const status = await checkNotificationStatus();

        // If status changed to granted and FCM not set up yet, trigger FCM token fetch
        if (status === "granted" && !fcmToken && swReady && registration) {
          console.log(
            "[WorkspaceLayout] Notification permission granted, fetching FCM token...",
          );
          // The FCM token useEffect will handle this automatically
        }
      } catch (err) {
        console.error(
          "[WorkspaceLayout] Failed to check notification status:",
          err,
        );
      }
    };

    // Initial check after 5 seconds
    const initialTimer = setTimeout(checkStatus, 5000);

    // Periodic check every 60 seconds
    const intervalId = setInterval(checkStatus, 60000);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(intervalId);
    };
  }, [fcmToken, swReady, registration]);

  // T047: Handle deep link params on mount (from push notification click)
  useEffect(() => {
    // Check URL params for deep link navigation
    const notificationId = searchParams.get("notification");
    const channelId = searchParams.get("channel");
    const messageId = searchParams.get("message");

    if (notificationId) {
      console.log("[WorkspaceLayout] Deep link from notification:", {
        notificationId,
        channelId,
        messageId,
      });

      // Navigate to appropriate page based on params
      if (channelId) {
        router.push(
          `/workspace/chat?channel=${channelId}${messageId ? `&message=${messageId}` : ""}`,
        );
      }

      // TODO: Mark notification as read via API
    }
  }, [searchParams, router]);

  // T051: Notification popup with routing logic
  const { handleNotificationClick } = useNotificationPopup({
    duration: 5000,
    autoMarkAsRead: true,
    onClick: (notification) => {
      // Navigate based on notification type/domain
      if (notification.channelId) {
        router.push(
          `/workspace/chat?channel=${notification.channelId}${notification.messageId ? `&message=${notification.messageId}` : ""}`,
        );
      }
    },
  });

  // Handle notification clicks for deep linking (T039)
  useEffect(() => {
    // Listen for custom notification click events from notification UI
    const handleNotificationClick = (event: CustomEvent<Notification>) => {
      const notification = event.detail;

      // Route by source domain
      if (
        notification.sourceDomain === "chat" &&
        isChatPayload(notification.payload?.chat)
      ) {
        handleChatNotificationAction(
          router,
          notification.notificationId,
          notification.notificationRecipientId,
          notification.payload?.chat ?? null,
        );
        return;
      }

      const href = resolveWorkspaceNotificationHref(notification);
      if (href) {
        router.push(href);
      }
    };

    window.addEventListener(
      "notification-click",
      handleNotificationClick as EventListener,
    );

    return () => {
      window.removeEventListener(
        "notification-click",
        handleNotificationClick as EventListener,
      );
    };
  }, [router]);

  // Extract organization info
  const organizationName = user.organizationName || "Tech Office";

  return (
    <ThemeProvider employeeId={user.sub}>
      <NotificationStreamProvider organizationId={organizationId}>
        <GlobalIncomingVoiceCall />
        <WorkspaceUI
          pathname={pathname}
          searchParams={searchParams}
          organizationName={organizationName}
          user={user}
          handleNotificationClick={handleNotificationClick}
          isRequestingPushPermission={isRequestingPushPermission}
          needsSoundActivation={needsSoundActivation}
          requestPushPermission={requestPushPermission}
        >
          {children}
        </WorkspaceUI>
      </NotificationStreamProvider>
    </ThemeProvider>
  );
}

// Inner component that uses theme colors (must be inside ThemeProvider)
function WorkspaceUI({
  children,
  pathname,
  searchParams,
  organizationName,
  user,
  handleNotificationClick,
  isRequestingPushPermission,
  needsSoundActivation,
  requestPushPermission,
}: {
  children: React.ReactNode;
  pathname: string;
  searchParams: ReturnType<typeof useSearchParams>;
  organizationName: string;
  user: UserProfile;
  handleNotificationClick: (notification: NotificationPopupType) => void;
  isRequestingPushPermission: boolean;
  needsSoundActivation: boolean;
  requestPushPermission: () => Promise<void>;
}) {
  const colors = useThemeColors();
  const {
    hasBadgeAlert,
    isAutoCollapsed,
    isOpen,
    pageRegistration,
    toggleRail,
  } = useContextRail();
  const shouldRenderGlobalBlocks = pageRegistration?.showGlobalBlocks !== false;

  // Check if we're on the chat page
  const isChatPage = pathname.startsWith("/workspace/chat");

  return (
    <div
      className="h-screen w-full flex flex-col"
      style={colors.bg.default.style}
    >
      {/* Top Navigation - Fixed 56px height for vertical space optimization */}
      <header
        className="h-14 border-b flex items-center px-4 shrink-0"
        style={{ ...colors.bg.paper.style, ...colors.border.default.style }}
      >
        <div className="flex items-center gap-2">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: colors.text.primary.style.color }}
          >
            <span className="text-white font-bold text-sm">TO</span>
          </div>
          {user.organizations.length > 1 ? (
            <OrganizationSwitcherDropdown
              user={user}
              organizationName={organizationName}
            />
          ) : (
            <span
              className="font-semibold text-sm"
              style={colors.text.primary.style}
            >
              {organizationName}
            </span>
          )}
        </div>

        {/* Tab Navigation - Compact spacing */}
        <nav className="ml-8 flex items-center gap-1">
          {tabs
            .filter(
              (tab) =>
                tab.enabled &&
                (!tab.permission ||
                  user.permissionIds.includes(tab.permission)),
            )
            .map((tab) => (
              <TabLink
                key={tab.id}
                id={tab.id}
                label={tab.label}
                emoji={tab.emoji}
                href={tab.path}
                shortcut={tab.shortcut}
                disabled={!tab.enabled}
                className="px-3 py-1.5 rounded-lg text-sm"
                activeClassName={`${colors.primary.light.className} ${colors.primary.text.className}`}
                inactiveClassName={`${colors.text.secondary.className} ${colors.bg.hover}`}
              />
            ))}
        </nav>

        {/* Global Search Bar */}
        <GlobalSearchBar />

        <div className="ml-auto flex items-center gap-2">
          <button
            className={`p-1.5 ${colors.bg.hover} rounded-lg`}
            style={colors.text.secondary.style}
          >
            <span>🔔</span>
          </button>
          {/* Theme Toggle */}
          <ThemeToggle />
          {/* User Menu */}
          <UserMenu user={user} />
        </div>
      </header>

      {/* Main Content Area - Isolated scroll containers */}
      <div className="flex-1 flex min-h-0">
        {/* Chat-specific: Channel Sidebar */}
        {isChatPage && (
          <ChannelSidebar activeChannelId={searchParams.get("channel")} />
        )}

        {/* Main Content - Scrollable and reflowed beside the right rail */}
        <main
          className="flex-1 min-w-0 overflow-y-auto"
          data-testid="workspace-main-content"
        >
          {children}
        </main>

        <ContextRail
          hasBadgeAlert={hasBadgeAlert}
          isAutoCollapsed={isAutoCollapsed}
          onToggle={toggleRail}
          open={isOpen}
          testId="workspace-context-rail"
          toggleTestId="workspace-context-rail-toggle"
          title="Workspace Context"
        >
          {shouldRenderGlobalBlocks ? (
            <GlobalContextBlocks user={user} />
          ) : null}
          {pageRegistration
            ? pageRegistration.blocks.map((block) => (
                <Box key={block.id}>{block.node}</Box>
              ))
            : null}
        </ContextRail>
      </div>

      {/* T051: Notification Popup (global) */}
      <NotificationPopup duration={5000} onClick={handleNotificationClick} />

      {/* T040: Notification Permission Banner (self-managed state) */}
      <NotificationPermissionBanner
        isRequesting={isRequestingPushPermission}
        needsSoundActivation={needsSoundActivation}
        onEnable={requestPushPermission}
      />
    </div>
  );
}

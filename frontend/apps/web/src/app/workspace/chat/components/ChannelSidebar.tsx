/**
 * Channel Sidebar Component
 * Left sidebar displaying channels organized by categories
 *
 * Features:
 * - Category-based organization (Channels, Direct Messages, Archived)
 * - Pinned channels at top of each category
 * - Auto-add channels to categories on view
 * - Real-time unread counts
 * - Collapsible category sections
 * - Quick channel search/filter
 */

"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  List,
  ListItemButton,
  ListItemText,
  Badge,
  Divider,
  IconButton,
  Typography,
  Box,
  Collapse,
  Menu,
  MenuItem,
} from "@mui/material";
import {
  ChevronRight as ChevronRightIcon,
  ExpandMore as ExpandMoreIcon,
  Person as PersonIcon,
  OpenInNew as OpenInNewIcon,
  Call as CallIcon,
} from "@mui/icons-material";
import {
  listRecentChannels,
  getUserChatConfig,
  addChannelToCategory,
  updateSidebarCategoryCollapsed,
  createOrGetDirectMessage,
  type ChannelWithDetails,
} from "apis";
import { type Notification } from "@tech-office/notifications";
import CreateChannelDialog from "./CreateChannelDialog";
import StartDMDialog from "./StartDMDialog";
import UnifiedChannelSearch from "./UnifiedChannelSearch";
import { useNotificationStream } from "../../providers/NotificationStreamProvider";
import { useThemeColors } from "@/theme/useThemeColors";
import { UserCard, usePopulateUserCache } from "@/components/user";
import {
  VOICE_CALL_EVENT_NAME,
  type VoiceCallStreamEvent,
} from "../../voice/voiceCallEvents";

interface ChannelSidebarProps {
  activeChannelId: string | null;
}

export default function ChannelSidebar({
  activeChannelId,
}: ChannelSidebarProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const colors = useThemeColors();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [startDMDialogOpen, setStartDMDialogOpen] = useState(false);
  const [actionsMenuAnchor, setActionsMenuAnchor] =
    useState<null | HTMLElement>(null);

  // Track channels with unread messages (client-side)
  const [unreadChannels, setUnreadChannels] = useState<Set<string>>(new Set());
  const [activeVoiceChannels, setActiveVoiceChannels] = useState<Set<string>>(
    new Set(),
  );

  // SSE connection for real-time updates
  const { subscribe } = useNotificationStream();

  useEffect(() => {
    const handleVoiceEvent = (event: Event) => {
      const detail = (event as CustomEvent<VoiceCallStreamEvent>).detail;
      if (!detail?.channelId) {
        return;
      }
      setActiveVoiceChannels((prev) => {
        const next = new Set(prev);
        if (
          detail.notificationType === "voice_call_ended" ||
          detail.state === "VOICE_CALL_STATE_ENDED"
        ) {
          next.delete(detail.channelId);
        } else {
          next.add(detail.channelId);
        }
        return next;
      });
    };

    window.addEventListener(VOICE_CALL_EVENT_NAME, handleVoiceEvent);
    return () => {
      window.removeEventListener(VOICE_CALL_EVENT_NAME, handleVoiceEvent);
    };
  }, []);

  // Fetch user chat config (categories, pinned, collapsed state)
  const { data: config } = useQuery({
    queryKey: ["userChatConfig"],
    queryFn: getUserChatConfig,
  });

  // Check if user has any channels in categories
  const hasCategories =
    config && Object.keys(config.channelCategories).length > 0;

  // Fetch visible channels with details
  // Now listRecentChannels uses channel_membership, so it works for all users
  // (not dependent on channel_categories anymore)
  const { data: categorizedChannelsData } = useQuery({
    queryKey: ["recentChannels"],
    queryFn: listRecentChannels,
  });

  // Always use listRecentChannels - it now works for all users (membership-based)
  const channels = categorizedChannelsData || [];
  const isLoading = false;

  // Local collapsed state (synced with backend)
  const [collapsedState, setCollapsedState] = useState({
    channels: false,
    directMessages: false,
    taskDiscussions: false,
    archived: false,
  });

  // Sync collapsed state from config
  useEffect(() => {
    if (config) {
      setCollapsedState({
        channels: config.sidebarCategoryCollapsed.channels,
        directMessages: config.sidebarCategoryCollapsed.directMessages,
        taskDiscussions:
          config.sidebarCategoryCollapsed.taskDiscussions || false,
        archived: config.sidebarCategoryCollapsed.archived || false,
      });
    }
  }, [config]);

  // Listen for new message notifications and mark channels as unread
  useEffect(() => {
    const handleNotification = (notification: Notification) => {
      // Check if it's a chat message notification
      if (
        notification.sourceDomain === "chat" &&
        notification.notificationType === "message"
      ) {
        const actionData = notification.actionData;
        const channelId = actionData?.channelId as string | undefined;

        if (channelId && channelId !== activeChannelId) {
          // Mark channel as unread
          setUnreadChannels((prev) => new Set(prev).add(channelId));

          // Invalidate recent channels to fetch the new DM if it's not in the list
          queryClient.invalidateQueries({ queryKey: ["recentChannels"] });
        }
      }
    };

    const unsubscribe = subscribe(handleNotification);
    return unsubscribe;
  }, [subscribe, activeChannelId, queryClient]);

  // Clear unread status when viewing a channel
  useEffect(() => {
    if (activeChannelId) {
      setUnreadChannels((prev) => {
        const next = new Set(prev);
        next.delete(activeChannelId);
        return next;
      });
    }
  }, [activeChannelId]);

  // Mutation to update collapsed state
  const updateCollapsedMutation = useMutation({
    mutationFn: updateSidebarCategoryCollapsed,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["userChatConfig"] });
    },
  });

  // Mutation to add channel to category
  const addToCategoryMutation = useMutation({
    mutationFn: ({
      channelId,
      category,
    }: {
      channelId: string;
      category: string;
    }) => addChannelToCategory(channelId, category),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recentChannels"] });
      queryClient.invalidateQueries({ queryKey: ["userChatConfig"] });
    },
  });

  // Organize channels by category
  const categorizedChannels = {
    channels: channels.filter((ch: ChannelWithDetails) => {
      const category = config?.channelCategories[ch.channel.id] || "";
      if (!hasCategories) {
        return ch.channel.channelType === "chat" && !ch.channel.isArchived;
      }
      return category === "channels" && ch.channel.channelType === "chat";
    }),
    directMessages: channels.filter((ch: ChannelWithDetails) => {
      const category = config?.channelCategories[ch.channel.id] || "";
      if (!hasCategories) {
        return (
          ch.channel.channelType === "direct_message" && !ch.channel.isArchived
        );
      }
      return (
        category === "direct_messages" ||
        ch.channel.channelType === "direct_message"
      );
    }),
    taskDiscussions: channels.filter((ch: ChannelWithDetails) => {
      return (
        ch.channel.channelType === "project_ticket_thread" &&
        !ch.channel.isArchived
      );
    }),
    archived: channels.filter((ch: ChannelWithDetails) => {
      const category = config?.channelCategories[ch.channel.id] || "";
      if (!hasCategories) {
        return ch.channel.isArchived;
      }
      return category === "archived" || ch.channel.isArchived;
    }),
  };

  // Get pinned channel IDs
  const pinnedIds = new Set(config?.pinnedChannelIds || []);

  // Sort channels: pinned first, then by updated_at
  const sortChannels = (channelList: ChannelWithDetails[]) => {
    return channelList.sort((a, b) => {
      const aPinned = pinnedIds.has(a.channel.id);
      const bPinned = pinnedIds.has(b.channel.id);

      if (aPinned && !bPinned) return -1;
      if (!aPinned && bPinned) return 1;

      return b.channel.updatedAt.getTime() - a.channel.updatedAt.getTime();
    });
  };

  // Handle creating DM from search (employee selected)
  const handleCreateDMFromSearch = async (employeeId: string) => {
    try {
      const result = await createOrGetDirectMessage(employeeId);
      // Navigate to DM channel
      router.push(`/workspace/chat?channel=${result.channel.id}`);
      // Auto-add to category if needed
      if (!config?.channelCategories[result.channel.id]) {
        addToCategoryMutation.mutate({
          channelId: result.channel.id,
          category: "direct_messages",
        });
      }
    } catch (error) {
      console.error("Failed to create/get DM:", error);
    }
  };

  const handleChannelSelect = (channelId: string, channelType?: string) => {
    router.push(`/workspace/chat?channel=${channelId}`);

    // Optimization: Auto-add to category immediately on click (before page navigation)
    // Note: ChatPage also has a useEffect that adds channels when viewed via URL
    // This provides instant feedback without waiting for page load
    if (!config?.channelCategories[channelId] && channelType) {
      const category =
        channelType === "direct_message" ? "direct_messages" : "channels";
      addToCategoryMutation.mutate({ channelId, category });
    }
  };

  // Wrapper for list items that have channelType
  const handleChannelSelectFromList = (
    channelId: string,
    channelType: string,
  ) => {
    handleChannelSelect(channelId, channelType);
  };

  const handleCreateChannelSuccess = (channelId: string) => {
    // Navigate to the newly created channel (will auto-add to category)
    router.push(`/workspace/chat?channel=${channelId}`);
  };

  const toggleCategory = (
    category: "channels" | "directMessages" | "taskDiscussions" | "archived",
  ) => {
    const newState = {
      ...collapsedState,
      [category]: !collapsedState[category],
    };
    setCollapsedState(newState);

    // Persist to backend
    updateCollapsedMutation.mutate(newState);
  };

  // Render channel list item
  const renderChannelItem = (channelWithDetails: ChannelWithDetails) => {
    const { channel, dmParticipants } = channelWithDetails;
    const isActive = activeChannelId === channel.id;
    const isPinned = pinnedIds.has(channel.id);
    const hasUnread = unreadChannels.has(channel.id);
    const hasActiveVoiceCall = activeVoiceChannels.has(channel.id);

    // For DMs: build seed data from dmParticipants so the cache is always populated
    const dmParticipant =
      channel.channelType === "direct_message" && dmParticipants?.[0]
        ? dmParticipants[0]
        : null;

    // Non-DM display name
    const channelDisplayName = channel.displayName;

    return (
      <ListItemButton
        key={channel.id}
        selected={isActive}
        onClick={() =>
          handleChannelSelectFromList(channel.id, channel.channelType)
        }
        className="px-3 py-2"
      >
        {dmParticipant ? (
          <UserCard
            employeeId={dmParticipant.id}
            userInfo={{
              givenName: dmParticipant.givenName,
              familyName: dmParticipant.familyName,
              email: dmParticipant.email,
            }}
            variant="compact"
            avatarSize="sm"
            showPresence
            sx={{
              flex: 1,
              minWidth: 0,
              "& .MuiTypography-root": {
                fontWeight: hasUnread ? 700 : isActive ? 600 : 400,
              },
            }}
          />
        ) : (
          <>
            <span className="text-base mr-2">
              {isPinned ? "📌" : channel.isPrivate ? "🔒" : "#"}
            </span>
            <ListItemText
              primary={channelDisplayName}
              primaryTypographyProps={{
                variant: "body2",
                className: hasUnread
                  ? "font-bold"
                  : isActive
                    ? "font-semibold"
                    : "font-normal",
              }}
            />
          </>
        )}
        {hasUnread && (
          <Badge
            variant="dot"
            color="primary"
            sx={{
              "& .MuiBadge-badge": {
                right: 8,
                top: 10,
              },
            }}
          />
        )}
        {hasActiveVoiceCall && (
          <CallIcon
            data-testid="channel-active-voice-call"
            sx={{ ml: 1, fontSize: 16, color: "primary.main" }}
          />
        )}
      </ListItemButton>
    );
  };

  // Render task channel list item (with link to task)
  const renderTaskChannelItem = (channelWithDetails: ChannelWithDetails) => {
    const { channel, linkedResource } = channelWithDetails;
    const isActive = activeChannelId === channel.id;
    const hasUnread = unreadChannels.has(channel.id);
    const hasActiveVoiceCall = activeVoiceChannels.has(channel.id);

    // Use linked resource title or fall back to channel display name
    const displayName = linkedResource?.displayIdentifier
      ? `${linkedResource.displayIdentifier}`
      : channel.displayName.replace(/^Task:\s*/i, "");

    const taskUrl = linkedResource
      ? `/workspace/tasks/${linkedResource.parentId}/tasks/${linkedResource.resourceId}`
      : null;

    return (
      <ListItemButton
        key={channel.id}
        selected={isActive}
        onClick={() =>
          handleChannelSelectFromList(channel.id, channel.channelType)
        }
        className="px-3 py-1.5"
      >
        <span className="text-sm mr-1.5">📋</span>
        <ListItemText
          primary={displayName}
          secondary={linkedResource?.displayTitle}
          primaryTypographyProps={{
            variant: "body2",
            className: hasUnread
              ? "font-bold"
              : isActive
                ? "font-semibold"
                : "font-normal",
            noWrap: true,
            sx: { fontSize: "0.8rem" },
          }}
          secondaryTypographyProps={{
            variant: "caption",
            noWrap: true,
            sx: { fontSize: "0.7rem" },
          }}
        />
        {taskUrl && (
          <IconButton
            size="small"
            title="View task"
            onClick={(e) => {
              e.stopPropagation();
              router.push(taskUrl);
            }}
            sx={{ ml: 0.5, p: 0.25 }}
          >
            <OpenInNewIcon sx={{ fontSize: 14, color: "text.secondary" }} />
          </IconButton>
        )}
        {hasUnread && (
          <Badge
            variant="dot"
            color="primary"
            sx={{
              "& .MuiBadge-badge": {
                right: 8,
                top: 10,
              },
            }}
          />
        )}
        {hasActiveVoiceCall && (
          <CallIcon
            data-testid="channel-active-voice-call"
            sx={{ ml: 1, fontSize: 16, color: "primary.main" }}
          />
        )}
      </ListItemButton>
    );
  };

  // Render category section
  const renderCategory = (
    title: string,
    categoryKey: "channels" | "directMessages" | "taskDiscussions" | "archived",
    channelList: ChannelWithDetails[],
    icon: string,
  ) => {
    const sorted = sortChannels(channelList);
    const isCollapsed = collapsedState[categoryKey];

    return (
      <div key={categoryKey}>
        <ListItemButton
          onClick={() => toggleCategory(categoryKey)}
          className={`px-3 py-1 ${colors.bg.hover}`}
        >
          <Box className="flex items-center gap-1 w-full">
            {isCollapsed ? (
              <ChevronRightIcon
                sx={{ fontSize: 16, color: "text.secondary" }}
              />
            ) : (
              <ExpandMoreIcon sx={{ fontSize: 16, color: "text.secondary" }} />
            )}
            <Box className="flex items-center gap-1 flex-1">
              {categoryKey === "directMessages" ? (
                <PersonIcon sx={{ fontSize: 14, color: "text.secondary" }} />
              ) : (
                icon && <span className="text-xs">{icon}</span>
              )}
              <Typography
                variant="caption"
                className="font-semibold uppercase text-xs"
                sx={{ opacity: 0.7 }}
              >
                {title}
              </Typography>
            </Box>
            {isCollapsed && (
              <Typography variant="caption" color="text.secondary">
                {sorted.length}
              </Typography>
            )}
          </Box>
        </ListItemButton>
        <Collapse in={!isCollapsed} timeout="auto">
          <List dense disablePadding>
            {sorted.length === 0 ? (
              <Box className="px-3 py-2">
                <Typography variant="caption" color="text.secondary">
                  No {title.toLowerCase()} yet
                </Typography>
              </Box>
            ) : (
              sorted.map(
                categoryKey === "taskDiscussions"
                  ? renderTaskChannelItem
                  : renderChannelItem,
              )
            )}
          </List>
        </Collapse>
      </div>
    );
  };

  return (
    <div
      className={`w-56 lg:w-64 ${colors.bg.paper.className} ${colors.border.default.className} border-r flex flex-col h-full`}
    >
      {/* Header */}
      <div
        className={`h-12 px-3 ${colors.border.default.className} border-b flex items-center justify-between shrink-0`}
      >
        <Typography variant="subtitle2" className="font-semibold">
          Messages
        </Typography>
        <IconButton
          size="small"
          title="Actions"
          onClick={(e) => setActionsMenuAnchor(e.currentTarget)}
        >
          <span className="text-lg">⋮</span>
        </IconButton>

        {/* Actions Menu */}
        <Menu
          anchorEl={actionsMenuAnchor}
          open={Boolean(actionsMenuAnchor)}
          onClose={() => setActionsMenuAnchor(null)}
        >
          <MenuItem
            onClick={() => {
              setStartDMDialogOpen(true);
              setActionsMenuAnchor(null);
            }}
          >
            <PersonIcon sx={{ fontSize: 18, mr: 1 }} />
            Start direct message
          </MenuItem>
          <MenuItem
            onClick={() => {
              setCreateDialogOpen(true);
              setActionsMenuAnchor(null);
            }}
          >
            <span className="text-lg mr-2">➕</span>
            Create channel
          </MenuItem>
        </Menu>
      </div>

      {/* Unified Search */}
      <div className="p-3 shrink-0">
        <UnifiedChannelSearch
          localChannels={channels}
          onChannelSelect={handleChannelSelect}
          onCreateDM={handleCreateDMFromSearch}
          placeholder="Search channels or start DM..."
        />
      </div>

      {/* Category-based Channel List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <Box className="flex items-center justify-center p-4">
            <Typography variant="body2" color="text.secondary">
              Loading channels...
            </Typography>
          </Box>
        ) : (
          <List dense disablePadding>
            {renderCategory(
              "Channels",
              "channels",
              categorizedChannels.channels,
              "#",
            )}
            {renderCategory(
              "Direct Messages",
              "directMessages",
              categorizedChannels.directMessages,
              "",
            )}
            {categorizedChannels.taskDiscussions.length > 0 &&
              renderCategory(
                "Task Discussions",
                "taskDiscussions",
                categorizedChannels.taskDiscussions,
                "📋",
              )}
            {categorizedChannels.archived.length > 0 &&
              renderCategory(
                "Archived",
                "archived",
                categorizedChannels.archived,
                "📦",
              )}
          </List>
        )}
      </div>

      <Divider />

      {/* Footer */}
      <div className="p-3 shrink-0">
        <button
          className={`w-full text-sm ${colors.text.secondary.className} text-left`}
        >
          Browse all channels
        </button>
      </div>

      {/* Create Channel Dialog */}
      <CreateChannelDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        onSuccess={handleCreateChannelSuccess}
      />

      {/* Start DM Dialog */}
      <StartDMDialog
        open={startDMDialogOpen}
        onClose={() => setStartDMDialogOpen(false)}
      />
    </div>
  );
}

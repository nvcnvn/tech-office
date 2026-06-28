import { isToday, isThisWeek } from "date-fns";
import type { ChannelWithDetails } from "apis";

export interface SidebarSection {
  title: "Needs Attention" | "Recent" | "Earlier";
  data: ChannelWithDetails[];
}

/**
 * Groups channels into priority-based sections:
 *
 *  1. **Needs Attention** — channels with unread messages.
 *     Within this group task channels (`project_ticket_thread`) sort first,
 *     then everything else by recency — a gentle nudge toward task focus
 *     without hiding other conversations.
 *
 *  2. **Recent** — read channels with activity today or this week.
 *
 *  3. **Earlier** — read channels older than this week.
 *
 * @param channels  Pre-sorted by `updatedAt DESC` from the API.
 * @param unreadIds Set of channel IDs that have unread messages.
 */
export function groupChannels(
  channels: ChannelWithDetails[],
  unreadIds: Set<string>,
): SidebarSection[] {
  const needsAttention: ChannelWithDetails[] = [];
  const recent: ChannelWithDetails[] = [];
  const earlier: ChannelWithDetails[] = [];

  for (const ch of channels) {
    if (unreadIds.has(ch.channel.id)) {
      needsAttention.push(ch);
      continue;
    }

    const lastActivity = ch.channel.updatedAt
      ? new Date(ch.channel.updatedAt)
      : null;

    if (
      lastActivity &&
      (isToday(lastActivity) ||
        isThisWeek(lastActivity, { weekStartsOn: 1 }))
    ) {
      recent.push(ch);
    } else {
      earlier.push(ch);
    }
  }

  // Within "Needs Attention": task channels first, then by recency (already
  // pre-sorted by updatedAt from the API, so a stable partition suffices).
  needsAttention.sort((a, b) => {
    const aIsTask = a.channel.channelType === "project_ticket_thread" ? 0 : 1;
    const bIsTask = b.channel.channelType === "project_ticket_thread" ? 0 : 1;
    return aIsTask - bIsTask;
  });

  const sections: SidebarSection[] = [];
  if (needsAttention.length > 0)
    sections.push({ title: "Needs Attention", data: needsAttention });
  if (recent.length > 0) sections.push({ title: "Recent", data: recent });
  if (earlier.length > 0) sections.push({ title: "Earlier", data: earlier });
  return sections;
}

/**
 * @deprecated Use `groupChannels` which uses priority-based grouping.
 */
export function groupChannelsByTime(
  channels: ChannelWithDetails[]
): SidebarSection[] {
  return groupChannels(channels, new Set());
}

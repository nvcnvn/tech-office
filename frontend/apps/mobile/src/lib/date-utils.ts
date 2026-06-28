/**
 * Date formatting helpers for chat messages
 */
import { isSameDay as dateFnsIsSameDay, formatDistanceToNow, format, isToday, isYesterday } from "date-fns";

export { isSameDay } from "date-fns";

/**
 * Formats a message timestamp for display in the chat.
 * - Within the last hour: "2m ago", "45m ago"
 * - Today: "10:30 AM"
 * - Within the last week: "Mon 10:30 AM"
 * - Older: "Jan 3, 10:30 AM"
 */
export function formatMessageTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;

  if (isToday(date)) {
    return format(date, "h:mm a");
  }

  if (isYesterday(date)) {
    return `Yesterday ${format(date, "h:mm a")}`;
  }

  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays < 7) {
    return format(date, "EEE h:mm a");
  }

  return format(date, "MMM d, h:mm a");
}

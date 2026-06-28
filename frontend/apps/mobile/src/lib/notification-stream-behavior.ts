/**
 * Mobile notification stream lifecycle.
 *
 * Desired behavior:
 * - Keep one authenticated SSE session alive while the app is active.
 * - Rotate that session on a fixed cadence so each reconnect starts fresh.
 * - When a session is intentionally rotated or unexpectedly lost, active
 *   screens perform one reconciliation fetch to cover the blind spot.
 * - If the stream reconnects within the grace window, stop there.
 * - If the app is still active and the stream is not healthy after the grace
 *   window, switch focused surfaces to interval polling until SSE recovers.
 */
export const notificationStreamBehavior = {
  // Keep the session stable on mobile. Aggressive forced reconnects create
  // avoidable active_connection churn and make iOS ghost rows more likely.
  sessionMaxAgeMs: 15 * 60_000,
  reconnectGraceMs: 5_000,
  fallbackPollMs: {
    unreadCount: 30_000,
    chat: 30_000,
    alerts: 30_000,
    tasks: 120_000,
    calendar: 120_000,
  },
} as const;

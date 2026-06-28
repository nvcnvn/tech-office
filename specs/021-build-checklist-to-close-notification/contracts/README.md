# Contracts Overview

This feature updates the notification contract at three boundaries:

1. **Backend publication contract**
   - Each published notification must carry an evaluated `policy_key`, a normalized navigation target, and optional shared-context audience metadata.

2. **Employee-facing notification contract**
   - Notification summaries must expose acknowledgement state separately from delivery state.
   - Unread counts must derive from acknowledgement state.
   - Frontend surfaces must use the same navigation target payload for popup and notification center actions.

3. **Realtime and fallback contract**
   - Live-only signals must be delivered without creating notification-center items.
   - Persistent notifications must record fallback skip/retry/failure outcomes in a single authoritative lifecycle.

See [notification-lifecycle.md](notification-lifecycle.md) for the planned field-level contract changes.

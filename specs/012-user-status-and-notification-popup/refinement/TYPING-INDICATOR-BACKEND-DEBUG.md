# Typing Indicator Backend Debugging Guide

## Issue
Typing indicators not appearing in UI - no SSE events received by frontend.

## Root Cause Investigation

### Backend Flow for Typing Events

1. **StartTyping RPC called** → `backend/internal/chat/logic.go:StartTyping()`
2. **Publishes notification** with:
   - `ActiveChannelId`: The channel where typing is happening
   - `Priority`: `PrioritySilent` (ephemeral event)
   - `NotificationType`: `"typing"`
   - `ActionData`: `{channelId, action: "start", employeeId, parentMessageId?}`

3. **PublishNotification** checks if ephemeral → `backend/internal/notification/publisher.go`
   ```go
   isEphemeralChannelEvent := req.ActiveChannelId != "" && req.Priority == int32(PrioritySilent)
   ```

4. **Calls `publishToInstancesByChannel`** (skips database persistence)
   - Queries: `GetActiveConnectionsByChannelID` 
   - Filters: `active_channel_id = $channelId AND connection_status = 'active'`

5. **PostgreSQL NOTIFY** sent to matching instances
6. **SSE stream** delivers to frontend

### Critical Query

**SQL**: `backend/database/scripts/notification.query.sql`
```sql
-- name: GetActiveConnectionsByChannelID :many
SELECT instance_id, array_agg(employee_id)::uuid[] AS employee_ids
FROM notification.active_connection
WHERE active_channel_id = $1  -- ← Must match!
  AND organization_id = $2
  AND connection_status = 'active'
GROUP BY instance_id;
```

## Debugging Steps

### 1. Check Backend Logs

Look for these log messages (in order):

```
✅ "StartTyping: publishing typing-start notification"
   - channel_id: <uuid>
   - parent_message_id: <uuid or empty>

✅ "ephemeral channel event - skipping DB persistence"
   - channelID: <uuid>
   - notificationType: "typing"
   - actionData: {channelId, action: "start", employeeId}

✅ "calling publishToInstancesByChannel for ephemeral event"
   - channelID: <uuid>
   - organizationID: <uuid>

⚠️ "query returned connections for channel"
   - connectionCount: <number> ← MUST BE > 0 for delivery!
   - connections: <array>

✅ "successfully published ephemeral event to channel"
```

**If `connectionCount: 0`** → No active connections viewing the channel!

### 2. Check Active Connections in Database

```sql
-- Check if user has active connection
SELECT * FROM notification.active_connection
WHERE employee_id = '<your-employee-id>'
  AND organization_id = '<your-org-id>'
  AND connection_status = 'active';

-- Check active_channel_id value
SELECT 
  employee_id,
  active_channel_id,
  connection_status,
  last_heartbeat
FROM notification.active_connection
WHERE organization_id = '<your-org-id>'
  AND connection_status = 'active';
```

**Expected**:
- `active_channel_id`: Should match the channel UUID from URL (`?channel=<uuid>`)
- `connection_status`: Must be `'active'`
- `last_heartbeat`: Should be recent (< 30 seconds old)

### 3. Check Frontend Presence Updates

**Browser Console**:
```
[PresenceTracking] Sending presence update: {
  status: "online",
  activeChannelId: "01234567-..." // ← Must be set when in channel!
}
```

**Network Tab**:
- Look for `ReportPresence` RPC calls
- Check request payload includes `activeChannelId`

### 4. Test Presence Flow

1. Open channel in browser (e.g., `/workspace/chat?channel=01234567-...`)
2. Check backend logs for presence update:
   ```
   "updating active connection"
   - employee_id: <uuid>
   - active_channel_id: <uuid> ← Should match channel!
   ```

3. Query database to confirm:
   ```sql
   SELECT active_channel_id::text, connection_status
   FROM notification.active_connection
   WHERE employee_id = '<your-id>';
   ```

## Common Issues

### Issue 1: `active_channel_id` Not Set

**Symptom**: Database shows `active_channel_id: NULL`

**Cause**: Frontend not sending `activeChannelId` in presence updates

**Fix**: Check `usePresenceTracking` hook is passing `activeChannelId` from URL

### Issue 2: Presence Update Delay

**Symptom**: Typing right after navigating to channel doesn't work

**Cause**: Presence heartbeat hasn't sent `active_channel_id` yet

**Fix**: Presence updates happen every 10 seconds. Wait a few seconds after navigation.

### Issue 3: Multiple Instances (Different Backend)

**Symptom**: Works sometimes, not others

**Cause**: Load balancer routing to different backend instances

**Check**: PostgreSQL NOTIFY is cross-instance. Verify `instance_id` in logs.

### Issue 4: Connection Marked as Stale

**Symptom**: User appears online but gets no ephemeral events

**Cause**: Heartbeat timeout, connection marked stale

**Fix**: Check `last_heartbeat` timestamp. Should be < 30 seconds old.

## Quick Test Script

```bash
# 1. Get your employee ID
export EMPLOYEE_ID="<your-employee-id-from-token>"
export ORG_ID="<your-org-id>"
export CHANNEL_ID="<channel-id-from-url>"

# 2. Check active connection
docker compose exec postgres psql -U postgres -d tech_office_db -c \
  "SELECT employee_id::text, active_channel_id::text, connection_status, last_heartbeat 
   FROM notification.active_connection 
   WHERE employee_id = '$EMPLOYEE_ID' 
   AND organization_id = '$ORG_ID';"

# 3. Check if active_channel_id matches
docker compose exec postgres psql -U postgres -d tech_office_db -c \
  "SELECT COUNT(*) as match_count 
   FROM notification.active_connection 
   WHERE active_channel_id = '$CHANNEL_ID' 
   AND organization_id = '$ORG_ID' 
   AND connection_status = 'active';"
```

**Expected Output**:
```
employee_id | active_channel_id | connection_status | last_heartbeat
------------+-------------------+-------------------+------------------------
<uuid>      | <channel-uuid>    | active            | 2025-11-07 12:34:56+00

match_count
------------
1
```

## Resolution Steps

If `connectionCount: 0` in logs:

1. ✅ Verify frontend sends `activeChannelId` in presence
2. ✅ Check database `active_channel_id` is set correctly
3. ✅ Ensure connection status is `'active'`, not `'stale'`
4. ✅ Confirm heartbeat is recent
5. ✅ Wait ~10 seconds for next heartbeat after navigating

## Files with Enhanced Logging

- ✅ `backend/internal/notification/publisher.go` - Added detailed logging for ephemeral events and connection queries
- ✅ `backend/internal/chat/logic.go` - Logs StartTyping/StopTyping calls
- ✅ `frontend/apps/web/src/app/workspace/chat/hooks/useChatSSE.ts` - Logs SSE event reception
- ✅ `frontend/apps/web/src/app/workspace/chat/page.tsx` - Logs typing state updates

## Next Steps After Logs Review

Based on what you see in the logs, the solution will be one of:

1. **Frontend Issue**: Presence not sending `activeChannelId` → Fix `usePresenceTracking`
2. **Timing Issue**: Typing before presence update completes → Add presence ready check
3. **Backend Query**: Wrong channel ID in query → Verify UUID parsing
4. **Database State**: Stale connections → Adjust heartbeat timeout

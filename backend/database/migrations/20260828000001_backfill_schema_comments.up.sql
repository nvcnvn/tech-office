-- Migration: backfill table and column comments that existed only in the hand-written
-- schema.sql snapshot and were never applied to the database by a migration.
-- Direction: UP
--
-- schema.sql is now generated from these migrations (scripts/regen-schema.sh), so a comment
-- that lives only in that file would simply be lost. These are the 18 that were missing, plus
-- chat.message, whose table comment went stale when the voice columns were added.

COMMENT ON COLUMN chat.message.message_kind IS
'Timeline message kind: text, voice, system. MUST align with backend constants in internal/chat/constants.go and frontend TypeScript types in packages/apis/src/chat.ts';

COMMENT ON COLUMN chat.message.metadata IS
'Structured timeline metadata for voice messages, call records, and other system-rendered events.';

COMMENT ON COLUMN chat.message.system_event_type IS
'System event discriminator for system messages. Voice values MUST align with backend constants and frontend TypeScript types.';

COMMENT ON COLUMN iam.user.is_org_managed IS
'TRUE for workers created by org admins (PIN-based, no email required). FALSE for self-registered users (email-based).';

COMMENT ON COLUMN notification.active_listener.consumer_last_active_at IS
'Last time the consumer goroutine successfully processed a NOTIFY event. A large gap between this and last_heartbeat indicates the consumer is stuck or dead.';

COMMENT ON COLUMN notification.active_listener.consumer_status IS
'Status of the consumeNotifications goroutine: starting, running (processing NOTIFYs), reconnecting (re-establishing connection), stopped (exited). If this is stopped while listener_status=active, the listener heartbeat is alive but notification delivery is broken.';

COMMENT ON COLUMN notification.active_listener.last_error IS
'Most recent error encountered by the consumer goroutine or reconnect logic. Truncated to 500 chars.';

COMMENT ON COLUMN notification.active_listener.last_error_at IS
'When last_error occurred.';

COMMENT ON COLUMN notification.active_listener.reconnect_count IS
'Number of times the LISTEN connection was re-established after an unexpected disconnection. Non-zero indicates instability.';

COMMENT ON TABLE calendar.audit_entry IS
'Append-only compliance audit trail. NEVER delete or update rows — insert only.';

COMMENT ON TABLE calendar.event IS
'Calendar events — one-time or recurring series head. Times stored UTC.';

COMMENT ON TABLE calendar.event_reminder IS
'Staging table for CalendarReminderWorkflow. Workflow polls pending rows where fire_at <= now().';

COMMENT ON TABLE iam.user IS
'Global user accounts. NOT organization-scoped - users can belong to multiple organizations with different roles. Status MUST align with backend constants in internal/iam/constants.go and proto enum rpc.v1.UserStatus.';

COMMENT ON TABLE voice.call_artifact IS
'Recording and transcript artifact lifecycle records for voice calls.';

COMMENT ON TABLE voice.call_invitation IS
'Voice call invitation records. Invitations do not grant chat room access by themselves.';

COMMENT ON TABLE voice.call_participant IS
'Employee-level voice call participation records and LiveKit identity mapping.';

COMMENT ON TABLE voice.call_session IS
'Voice call lifecycle records attached to chat channels. LiveKit tokens are generated on demand and never stored.';

COMMENT ON TABLE voice.voice_message IS
'Voice-message upload state and playback metadata linked to chat timeline messages.';

COMMENT ON TABLE chat.message IS
'Messages and replies within channels. Supports 1-level threading (replies to messages only, no replies to replies), editing, soft deletion, rich text HTML formatting (server-side sanitized), voice messages, system call events, and multilingual full-text search via PGroonga (no language detection required).';

-- Voice Communication sqlc Queries
-- Schema: voice
-- Generated Go package: database

-- name: CreateVoiceCallSession :one
INSERT INTO voice.call_session (
    organization_id, channel_id, initiator_employee_id, livekit_room_name,
    state, recording_policy, recording_status, transcript_status, ring_deadline_at
) VALUES (
    @organization_id, @channel_id, @initiator_employee_id, @livekit_room_name,
    @state, @recording_policy, @recording_status, @transcript_status,
    sqlc.narg('ring_deadline_at')::timestamptz
)
RETURNING *;

-- name: GetVoiceCallSession :one
SELECT * FROM voice.call_session
WHERE organization_id = @organization_id AND id = @call_session_id;

-- name: GetVoiceCallSessionByLiveKitRoom :one
SELECT * FROM voice.call_session
WHERE organization_id = @organization_id AND livekit_room_name = @livekit_room_name;

-- name: GetActiveVoiceCallForChannel :one
SELECT * FROM voice.call_session
WHERE organization_id = @organization_id
  AND channel_id = @channel_id
  AND state IN ('ringing', 'active', 'ending')
ORDER BY started_at DESC, id DESC
LIMIT 1;

-- name: ListVoiceCallSessionsForChannel :many
SELECT * FROM voice.call_session
WHERE organization_id = @organization_id
  AND channel_id = @channel_id
  AND (sqlc.narg('cursor_started_at')::timestamptz IS NULL OR started_at < sqlc.narg('cursor_started_at')::timestamptz)
ORDER BY started_at DESC, id DESC
LIMIT @page_limit;

-- name: ListCompletedVoiceCallSessionsForChannel :many
SELECT * FROM voice.call_session
WHERE organization_id = @organization_id
  AND channel_id = @channel_id
  AND state = 'ended'
  AND (sqlc.narg('cursor_started_at')::timestamptz IS NULL OR started_at < sqlc.narg('cursor_started_at')::timestamptz)
ORDER BY started_at DESC, id DESC
LIMIT @page_limit;

-- name: UpdateVoiceCallSessionState :one
UPDATE voice.call_session
SET state = @state,
    outcome = COALESCE(sqlc.narg('outcome')::text, outcome),
    answered_at = COALESCE(sqlc.narg('answered_at')::timestamptz, answered_at),
    ended_at = COALESCE(sqlc.narg('ended_at')::timestamptz, ended_at),
    ended_by_employee_id = COALESCE(sqlc.narg('ended_by_employee_id')::uuid, ended_by_employee_id),
    ended_reason = COALESCE(sqlc.narg('ended_reason')::text, ended_reason),
    updated_at = @updated_at
WHERE organization_id = @organization_id AND id = @call_session_id
RETURNING *;

-- name: UpdateVoiceCallArtifactRollupStatus :one
UPDATE voice.call_session
SET recording_status = CASE WHEN @artifact_type = 'recording' THEN @status ELSE recording_status END,
    transcript_status = CASE WHEN @artifact_type = 'transcript' THEN @status ELSE transcript_status END,
    updated_at = @updated_at
WHERE organization_id = @organization_id AND id = @call_session_id
RETURNING *;

-- name: MarkVoiceCallAnswered :one
-- ring_deadline_at is NULL in every state but 'ringing', so answering clears it and
-- the ring timeout sweep stops considering the call.
UPDATE voice.call_session
SET state = CASE WHEN state = 'ringing' THEN 'active' ELSE state END,
    outcome = COALESCE(outcome, 'answered'),
    answered_at = COALESCE(answered_at, @answered_at),
    ring_deadline_at = NULL,
    updated_at = @answered_at
WHERE organization_id = @organization_id AND id = @call_session_id
RETURNING *;

-- name: EndVoiceCallSession :one
UPDATE voice.call_session
SET state = 'ended',
    outcome = @outcome,
    ended_at = @ended_at,
    ended_by_employee_id = sqlc.narg('ended_by_employee_id')::uuid,
    ended_reason = sqlc.narg('ended_reason')::text,
    ring_deadline_at = NULL,
    updated_at = @ended_at
WHERE organization_id = @organization_id AND id = @call_session_id
RETURNING *;

-- lint:cross-tenant ring-timeout sweep — the organization list is the result, so it cannot be the input
-- name: ListOrganizationsWithExpiredRingingCalls :many
SELECT DISTINCT organization_id
FROM voice.call_session
WHERE state = 'ringing'
  AND ring_deadline_at IS NOT NULL
  AND ring_deadline_at <= @now_at;

-- name: ClaimExpiredRingingCalls :many
-- The ring timeout sweep, as one atomic claim-and-end.
--
-- Ending the call inside the claiming UPDATE is what makes the sweep safe to run on
-- every instance (Constitution XI): the row lock serialises the two writers, and the
-- second one's WHERE no longer matches because the state is already 'ended'. Only the
-- instance whose UPDATE matched receives the row, so the terminal wake and the
-- voice_call_missed chat message are published exactly once.
UPDATE voice.call_session AS target
SET state = 'ended',
    outcome = 'missed',
    ended_at = @now_at,
    ended_reason = 'ring_timeout',
    ring_deadline_at = NULL,
    updated_at = @now_at
WHERE target.organization_id = @organization_id
  AND target.id IN (
      SELECT expired.id
      FROM voice.call_session AS expired
      WHERE expired.organization_id = @organization_id
        AND expired.state = 'ringing'
        AND expired.ring_deadline_at IS NOT NULL
        AND expired.ring_deadline_at <= @now_at
      ORDER BY expired.ring_deadline_at ASC, expired.id ASC
      LIMIT @batch_limit
      FOR UPDATE SKIP LOCKED
  )
RETURNING target.*;

-- name: UpsertVoiceCallParticipant :one
INSERT INTO voice.call_participant (
    organization_id, call_session_id, employee_id, invited_by_employee_id,
    role, state, livekit_identity, joined_at, last_seen_at, updated_at
) VALUES (
    @organization_id, @call_session_id, @employee_id, sqlc.narg('invited_by_employee_id')::uuid,
    @role, @state, @livekit_identity, sqlc.narg('joined_at')::timestamptz,
    sqlc.narg('last_seen_at')::timestamptz, @updated_at
)
ON CONFLICT (organization_id, call_session_id, employee_id)
DO UPDATE SET
    invited_by_employee_id = COALESCE(EXCLUDED.invited_by_employee_id, voice.call_participant.invited_by_employee_id),
    role = EXCLUDED.role,
    state = EXCLUDED.state,
    livekit_identity = EXCLUDED.livekit_identity,
    joined_at = COALESCE(EXCLUDED.joined_at, voice.call_participant.joined_at),
    last_seen_at = COALESCE(EXCLUDED.last_seen_at, voice.call_participant.last_seen_at),
    updated_at = EXCLUDED.updated_at
RETURNING *;

-- name: GetVoiceCallParticipant :one
SELECT * FROM voice.call_participant
WHERE organization_id = @organization_id
  AND call_session_id = @call_session_id
  AND employee_id = @employee_id;

-- name: GetVoiceCallParticipantByIdentity :one
SELECT * FROM voice.call_participant
WHERE organization_id = @organization_id AND livekit_identity = @livekit_identity;

-- name: ListVoiceCallParticipants :many
SELECT * FROM voice.call_participant
WHERE organization_id = @organization_id AND call_session_id = @call_session_id
ORDER BY created_at ASC, id ASC;

-- name: UpdateVoiceCallParticipantState :one
UPDATE voice.call_participant
SET state = @state,
    joined_at = COALESCE(sqlc.narg('joined_at')::timestamptz, joined_at),
    left_at = COALESCE(sqlc.narg('left_at')::timestamptz, left_at),
    last_seen_at = COALESCE(sqlc.narg('last_seen_at')::timestamptz, last_seen_at),
    disconnect_reason = COALESCE(sqlc.narg('disconnect_reason')::text, disconnect_reason),
    updated_at = @updated_at
WHERE organization_id = @organization_id AND id = @participant_id
RETURNING *;

-- name: CountActiveVoiceCallParticipants :one
SELECT count(*)::int AS active_count
FROM voice.call_participant
WHERE organization_id = @organization_id
  AND call_session_id = @call_session_id
  AND state IN ('joining', 'joined', 'disconnected');

-- name: CountOtherActiveVoiceCallsForEmployee :one
SELECT count(*)::int AS active_count
FROM voice.call_participant p
JOIN voice.call_session s
  ON s.organization_id = p.organization_id
 AND s.id = p.call_session_id
WHERE p.organization_id = @organization_id
  AND p.employee_id = @employee_id
  AND p.call_session_id <> @call_session_id
  AND p.state IN ('joining', 'joined', 'disconnected')
  AND s.state IN ('ringing', 'active', 'ending');

-- name: CreateVoiceCallInvitation :one
INSERT INTO voice.call_invitation (
    organization_id, call_session_id, inviter_employee_id, invitee_employee_id,
    notification_id, expires_at
) VALUES (
    @organization_id, @call_session_id, @inviter_employee_id, @invitee_employee_id,
    sqlc.narg('notification_id')::uuid, @expires_at
)
RETURNING *;

-- name: GetVoiceCallInvitation :one
SELECT * FROM voice.call_invitation
WHERE organization_id = @organization_id AND id = @invitation_id;

-- name: ListPendingVoiceCallInvitationsForEmployee :many
SELECT * FROM voice.call_invitation
WHERE organization_id = @organization_id
  AND invitee_employee_id = @invitee_employee_id
  AND status = 'pending'
  AND expires_at > @now_at
ORDER BY created_at DESC, id DESC;

-- name: UpdateVoiceCallInvitationStatus :one
UPDATE voice.call_invitation
SET status = @status, responded_at = @responded_at
WHERE organization_id = @organization_id AND id = @invitation_id
RETURNING *;

-- name: UpsertVoiceCallArtifact :one
INSERT INTO voice.call_artifact (
    organization_id, call_session_id, artifact_type, status, file_id, mime_type,
    duration_ms, storage_bytes, provider, provider_job_id, error_code,
    error_message, updated_at
) VALUES (
    @organization_id, @call_session_id, @artifact_type, @status, sqlc.narg('file_id')::uuid,
    sqlc.narg('mime_type')::text, sqlc.narg('duration_ms')::bigint,
    sqlc.narg('storage_bytes')::bigint, sqlc.narg('provider')::text,
    sqlc.narg('provider_job_id')::text, sqlc.narg('error_code')::text,
    sqlc.narg('error_message')::text, @updated_at
)
ON CONFLICT (organization_id, call_session_id, artifact_type)
DO UPDATE SET
    status = EXCLUDED.status,
    file_id = COALESCE(EXCLUDED.file_id, voice.call_artifact.file_id),
    mime_type = COALESCE(EXCLUDED.mime_type, voice.call_artifact.mime_type),
    duration_ms = COALESCE(EXCLUDED.duration_ms, voice.call_artifact.duration_ms),
    storage_bytes = COALESCE(EXCLUDED.storage_bytes, voice.call_artifact.storage_bytes),
    provider = COALESCE(EXCLUDED.provider, voice.call_artifact.provider),
    provider_job_id = COALESCE(EXCLUDED.provider_job_id, voice.call_artifact.provider_job_id),
    error_code = COALESCE(EXCLUDED.error_code, voice.call_artifact.error_code),
    error_message = COALESCE(EXCLUDED.error_message, voice.call_artifact.error_message),
    updated_at = EXCLUDED.updated_at
RETURNING *;

-- name: ListVoiceCallArtifacts :many
SELECT * FROM voice.call_artifact
WHERE organization_id = @organization_id AND call_session_id = @call_session_id
ORDER BY artifact_type ASC;

-- name: UpdateVoiceCallArtifactStatus :one
UPDATE voice.call_artifact
SET status = @status,
    file_id = COALESCE(sqlc.narg('file_id')::uuid, file_id),
    mime_type = COALESCE(sqlc.narg('mime_type')::text, mime_type),
    duration_ms = COALESCE(sqlc.narg('duration_ms')::bigint, duration_ms),
    storage_bytes = COALESCE(sqlc.narg('storage_bytes')::bigint, storage_bytes),
    error_code = COALESCE(sqlc.narg('error_code')::text, error_code),
    error_message = COALESCE(sqlc.narg('error_message')::text, error_message),
    updated_at = @updated_at
WHERE organization_id = @organization_id AND id = @artifact_id
RETURNING *;

-- name: CreateVoiceMessageUpload :one
INSERT INTO voice.voice_message (
    organization_id, channel_id, sender_employee_id, client_deduplication_key,
    status, file_id, mime_type, codec, size_bytes
) VALUES (
    @organization_id, @channel_id, @sender_employee_id, @client_deduplication_key,
    @status, @file_id, @mime_type, sqlc.narg('codec')::text, @size_bytes
)
RETURNING *;

-- name: GetVoiceMessage :one
SELECT * FROM voice.voice_message
WHERE organization_id = @organization_id AND id = @voice_message_id;

-- name: GetVoiceMessageByDedupKey :one
SELECT * FROM voice.voice_message
WHERE organization_id = @organization_id
  AND channel_id = @channel_id
  AND sender_employee_id = @sender_employee_id
  AND client_deduplication_key = @client_deduplication_key;

-- name: AttachVoiceMessageFile :one
UPDATE voice.voice_message
SET status = 'uploading', file_id = @file_id, updated_at = @updated_at
WHERE organization_id = @organization_id AND id = @voice_message_id
RETURNING *;

-- name: ConfirmVoiceMessage :one
UPDATE voice.voice_message
SET status = 'posted',
    message_id = @message_id,
    file_id = @file_id,
    duration_ms = @duration_ms,
    waveform_peaks = sqlc.narg('waveform_peaks')::jsonb,
    posted_at = @posted_at,
    updated_at = @posted_at
WHERE organization_id = @organization_id AND id = @voice_message_id
RETURNING *;

-- name: CancelVoiceMessageUpload :one
UPDATE voice.voice_message
SET status = 'cancelled', updated_at = @updated_at
WHERE organization_id = @organization_id
  AND id = @voice_message_id
  AND status <> 'posted'
RETURNING *;

-- name: ListVoiceMessagesForChannel :many
SELECT * FROM voice.voice_message
WHERE organization_id = @organization_id
  AND channel_id = @channel_id
  AND status = 'posted'
  AND (sqlc.narg('cursor_created_at')::timestamptz IS NULL OR created_at < sqlc.narg('cursor_created_at')::timestamptz)
ORDER BY created_at DESC, id DESC
LIMIT @page_limit;
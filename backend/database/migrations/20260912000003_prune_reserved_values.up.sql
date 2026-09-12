-- Feature 062: prune reserved-but-unused values.
--
-- Five permitted-value sets carry values nothing in the system ever produces, and
-- thirteen named schemas hold no objects at all. Each removed value named a feature
-- that was never built, so there is no data to migrate -- with one exception:
-- notification.personal_preference.muted_domains holds *preferences*, which real
-- people may have set against a category the system never published into. Those
-- entries are subtracted rather than rejected.
--
-- Order matters and is deliberate:
--   1. Audit      -- abort if any row holds a value about to be disallowed.
--   2. Repair     -- subtract removed categories from saved mute preferences.
--   3. Constrain  -- drop and re-add the five CHECKs (re-validates every row).
--   4. Comment    -- the schema comment is a documented layer (Constitution VIII).
--   5. Drop       -- the thirteen empty schemas, RESTRICT.
--
-- PostgreSQL runs DDL transactionally, so the whole file is one atomic unit.

-- ---------------------------------------------------------------------------
-- 1. Audit
-- ---------------------------------------------------------------------------
-- A stray row here would mean the premise of this change is wrong, so the migration
-- aborts and asks for a human rather than deleting a record it did not expect to find.

DO $$
DECLARE offending bigint;
BEGIN
    SELECT count(*) INTO offending
    FROM chat.channel
    WHERE channel_type IN ('crm_deal_notes', 'support_ticket');

    IF offending > 0 THEN
        RAISE EXCEPTION
            'chat.channel holds % row(s) with channel_type in (crm_deal_notes, support_ticket); nothing creates these kinds, so review and clear them before re-running',
            offending;
    END IF;
END $$;

DO $$
DECLARE offending bigint;
BEGIN
    SELECT count(*) INTO offending
    FROM files.file_access_rule
    WHERE context_type IN ('support_ticket', 'crm_deal');

    IF offending > 0 THEN
        RAISE EXCEPTION
            'files.file_access_rule holds % row(s) with context_type in (support_ticket, crm_deal); nothing creates these contexts, so review and clear them before re-running',
            offending;
    END IF;
END $$;

DO $$
DECLARE offending bigint;
BEGIN
    SELECT count(*) INTO offending
    FROM iam.credential
    WHERE credential_type = 'biometric';

    IF offending > 0 THEN
        RAISE EXCEPTION
            'iam.credential holds % row(s) with credential_type = biometric; no sign-in path issues these, so review and clear them before re-running',
            offending;
    END IF;
END $$;

DO $$
DECLARE offending bigint;
BEGIN
    SELECT count(*) INTO offending
    FROM notification.notification
    WHERE source_domain IN ('crm', 'hr', 'support', 'finance');

    IF offending > 0 THEN
        RAISE EXCEPTION
            'notification.notification holds % row(s) with source_domain in (crm, hr, support, finance); no publisher emits these, so review and clear them before re-running',
            offending;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Repair -- notification.personal_preference.muted_domains
-- ---------------------------------------------------------------------------
-- The one place real data may legitimately hold a removed value, because it records a
-- person's preference rather than something the system produced. Surviving entries keep
-- their order (unnest preserves it), and the && predicate leaves untouched rows alone.
-- MUST run before the CHECK below is tightened.

UPDATE notification.personal_preference
SET    muted_domains = ARRAY(
           SELECT d FROM unnest(muted_domains) AS d
           WHERE  d <> ALL (ARRAY['crm', 'hr', 'support', 'finance'])
       )
WHERE  muted_domains && ARRAY['crm', 'hr', 'support', 'finance'];

-- ---------------------------------------------------------------------------
-- 3. Tighten CHECK constraints
-- ---------------------------------------------------------------------------
-- ADD CONSTRAINT re-validates against every existing row, so this is a second and
-- independent proof that steps 1 and 2 did their job.

ALTER TABLE chat.channel
    DROP CONSTRAINT valid_channel_type;

ALTER TABLE chat.channel
    ADD CONSTRAINT valid_channel_type
    CHECK (channel_type IN ('chat', 'direct_message', 'project_ticket_thread'));

ALTER TABLE files.file_access_rule
    DROP CONSTRAINT file_access_rule_context_type_check;

ALTER TABLE files.file_access_rule
    ADD CONSTRAINT file_access_rule_context_type_check
    CHECK (context_type IN ('chat_channel', 'project', 'department_docs', 'calendar_event'));

ALTER TABLE iam.credential
    DROP CONSTRAINT credential_credential_type_check;

ALTER TABLE iam.credential
    ADD CONSTRAINT credential_credential_type_check
    CHECK (credential_type = 'pin');

ALTER TABLE notification.notification
    DROP CONSTRAINT notification_source_domain_valid;

ALTER TABLE notification.notification
    ADD CONSTRAINT notification_source_domain_valid
    CHECK (source_domain IN ('chat', 'projects', 'docs', 'system', 'calendar'));

ALTER TABLE notification.personal_preference
    DROP CONSTRAINT muted_domains_valid;

ALTER TABLE notification.personal_preference
    ADD CONSTRAINT muted_domains_valid
    CHECK (muted_domains <@ ARRAY['chat', 'projects', 'docs', 'system', 'calendar']);

-- ---------------------------------------------------------------------------
-- 4. Correct column and table comments
-- ---------------------------------------------------------------------------

COMMENT ON COLUMN chat.channel.channel_type IS
'Channel type: chat, direct_message, project_ticket_thread. MUST align with backend
constants in internal/chat/constants.go, proto enum rpc.v1.ChannelType, and frontend
TypeScript types in packages/apis/src/chat.ts';

-- "Upload context type" was wrong as well as stale: this is the access-rule context set,
-- which is not the upload-context set in ValidUploadContexts(). Conflating the two is the
-- confusion this feature removes.
COMMENT ON COLUMN files.file_access_rule.context_type IS
'Access-rule context type: chat_channel, project, department_docs, calendar_event. MUST
align with backend constants in internal/files/constants.go and the proto enum
rpc.v1.FileContextType, which packages/apis/src/files-security.ts re-exports rather than
restating. Set by domain service (e.g., ChatService for chat_channel), NOT
client-controlled.';

COMMENT ON TABLE iam.credential IS
'Org-scoped credentials for PIN authentication. Supports temporary (admin-generated) and
active (user-set) states. One active credential per type per identity. Temporary PINs
default to 3-day expiry (configurable via column default). credential_type and state MUST
align with backend constants.';

COMMENT ON COLUMN iam.credential.credential_hash IS
'Bcrypt hash of the credential value (PIN digits). Never stored in plaintext after initial
generation.';

COMMENT ON COLUMN notification.notification.source_domain IS
'Backend service that published notification: chat, projects, docs, calendar, system. MUST
align with backend constants in internal/notification/constants.go and frontend TypeScript
types in packages/apis/src/notification.ts';

COMMENT ON COLUMN notification.personal_preference.muted_domains IS
'Domains for which the employee will not receive push notifications. SSE delivery, the
notification row and the unread count are unaffected, and priority-0 notifications
(mentions, incoming calls) are never suppressed. MUST hold the same five values as
notification.AllSourceDomains in Go, the notification.notification source_domain CHECK,
and SOURCE_DOMAINS in frontend/packages/apis.';

-- ---------------------------------------------------------------------------
-- 5. Drop the thirteen empty schemas
-- ---------------------------------------------------------------------------
-- RESTRICT is both the action and the emptiness proof, in one statement: the drop fails
-- if the schema contains anything. CASCADE is forbidden here -- it would destroy data if
-- a measurement were wrong, which is the one failure this change must not have.
--
-- `compliance` is deliberately NOT in this list. It holds four objects.

DROP SCHEMA assets        RESTRICT;
DROP SCHEMA communication RESTRICT;
DROP SCHEMA crm           RESTRICT;
DROP SCHEMA finance       RESTRICT;
DROP SCHEMA hiring        RESTRICT;
DROP SCHEMA integrations  RESTRICT;
DROP SCHEMA inventory     RESTRICT;
DROP SCHEMA learning      RESTRICT;
DROP SCHEMA payroll       RESTRICT;
DROP SCHEMA procurement   RESTRICT;
DROP SCHEMA retention     RESTRICT;
DROP SCHEMA support       RESTRICT;
DROP SCHEMA timekeeping   RESTRICT;

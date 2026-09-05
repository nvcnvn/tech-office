-- Feature 051: Notification Preference Completeness.
--
-- Two changes to notification.personal_preference, the record that has enforced
-- domain muting and do-not-disturb since the initial schema but has never had a
-- write path of any kind:
--
--   1. in_app_alerts_enabled — the mobile in-app banner switch moves off the
--      handset's local store and onto the person's account. Stored and returned
--      by the server, never read by the delivery pipeline: it gates one
--      client-drawn banner and nothing else.
--   2. muted_domains_valid gains 'calendar' — drift D28. calendar has been a
--      valid notification.source_domain since 20260320000002, but the mute list
--      was never widened to match, so calendar was the one domain nobody could
--      silence.
--
-- Widening a contained-by (<@) CHECK only admits values that were previously
-- refused, so every existing row stays valid and no data migration is needed.

ALTER TABLE notification.personal_preference
    ADD COLUMN IF NOT EXISTS in_app_alerts_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN notification.personal_preference.in_app_alerts_enabled IS
    'Draw the in-app banner while the app is in the foreground. Stored and returned by '
    'the server but never consulted by the delivery pipeline: the notification is still '
    'recorded, listed, counted as unread and pushed when this is false.';

ALTER TABLE notification.personal_preference
    DROP CONSTRAINT IF EXISTS muted_domains_valid;

ALTER TABLE notification.personal_preference
    ADD CONSTRAINT muted_domains_valid CHECK (muted_domains <@ ARRAY[
        'chat', 'projects', 'docs', 'crm', 'hr', 'support', 'finance', 'system', 'calendar'
    ]);

COMMENT ON COLUMN notification.personal_preference.muted_domains IS
    'Domains for which the employee will not receive push notifications. SSE delivery, '
    'the notification row and the unread count are unaffected, and priority-0 '
    'notifications (mentions, incoming calls) are never suppressed. MUST hold the same '
    'nine values as notification.AllSourceDomains in Go, the notification.notification '
    'source_domain CHECK, and SOURCE_DOMAINS in frontend/packages/apis.';

# Contract: Database Constraint Changes

**Feature**: 062-prune-reserved-values

`backend/database/scripts/schema.sql` is a **generated** snapshot and must never be
hand-edited. Every change below is expressed as a migration in
`backend/database/migrations/`; the snapshot is regenerated afterwards by
`backend/scripts/regen-schema.sh`, and `backend/database/models.go` by sqlc.

## CHECK constraints

| Table | Constraint | Before | After |
|---|---|---|---|
| `chat.channel` | `valid_channel_type` | `chat, direct_message, project_ticket_thread, crm_deal_notes, support_ticket` | `chat, direct_message, project_ticket_thread` |
| `files.file_access_rule` | `file_access_rule_context_type_check` | `chat_channel, project, department_docs, calendar_event, support_ticket, crm_deal` | `chat_channel, project, department_docs, calendar_event` |
| `iam.credential` | `credential_credential_type_check` | `pin, biometric` | `pin` |
| `notification.notification` | `notification_source_domain_valid` | `chat, crm, projects, hr, support, finance, docs, system, calendar` | `chat, projects, docs, system, calendar` |
| `notification.personal_preference` | `muted_domains_valid` | subset of the nine | subset of the five |

Each is dropped and re-added; PostgreSQL validates the new constraint against existing rows
on `ADD CONSTRAINT`, so a stray row fails the migration rather than leaving an unenforced
constraint.

## Column comments

Constitution VIII treats the schema comment as a documented layer, so each is corrected in
the same migration:

| Column | Correction |
|---|---|
| `chat.channel.channel_type` | value list drops the two removed kinds |
| `files.file_access_rule.context_type` | value list drops the two removed contexts **and** the opening phrase is changed from "Upload context type" to "Access-rule context type" — it is not the upload-context set, and calling it one is exactly the confusion this feature removes |
| `iam.credential` (table) | "PIN and biometric authentication" → "PIN authentication" |
| `iam.credential.credential_hash` | "(PIN digits, biometric key)" → "(PIN digits)" |
| `notification.notification.source_domain` | value list reduced to five |
| `notification.personal_preference.muted_domains` | "MUST hold the same nine values" → "the same five values" |

## Data repair — `muted_domains`

Run **before** the CHECK is tightened, in the same transaction:

```sql
UPDATE notification.personal_preference
SET    muted_domains = ARRAY(
           SELECT d FROM unnest(muted_domains) AS d
           WHERE  d <> ALL (ARRAY['crm','hr','support','finance'])
       )
WHERE  muted_domains && ARRAY['crm','hr','support','finance'];
```

Array order among surviving entries is preserved by `unnest`, and the `&&` predicate means
untouched rows are not rewritten. This is FR-010: preferences keep loading, surviving mutes
stay in force, removed entries drop away silently.

## Schemas dropped

```sql
DROP SCHEMA assets       RESTRICT;
DROP SCHEMA communication RESTRICT;
DROP SCHEMA crm          RESTRICT;
DROP SCHEMA finance      RESTRICT;
DROP SCHEMA hiring       RESTRICT;
DROP SCHEMA integrations RESTRICT;
DROP SCHEMA inventory    RESTRICT;
DROP SCHEMA learning     RESTRICT;
DROP SCHEMA payroll      RESTRICT;
DROP SCHEMA procurement  RESTRICT;
DROP SCHEMA retention    RESTRICT;
DROP SCHEMA support      RESTRICT;
DROP SCHEMA timekeeping  RESTRICT;
```

`RESTRICT` is the emptiness proof FR-009 requires, in one statement: the drop fails if the
schema contains anything. `CASCADE` is forbidden here — it would destroy data if a
measurement were wrong, which is the one failure this change must not have.

`compliance` is **not** in the list. It holds four objects.

## Standing invariant added

A new integration assertion, so SC-004 survives the change that produced it:

```sql
SELECT n.nspname
FROM   pg_namespace n
WHERE  n.nspname NOT LIKE 'pg\_%'
  AND  n.nspname NOT IN ('information_schema', 'public')
  AND  NOT EXISTS (
         SELECT 1 FROM pg_class c
         WHERE c.relnamespace = n.oid
       );
-- must return zero rows
```

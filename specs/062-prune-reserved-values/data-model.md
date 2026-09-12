# Phase 1 Data Model: Prune Reserved-But-Unused Values

**Feature**: 062-prune-reserved-values | **Date**: 2026-09-12

No entity is created, and no entity's shape changes. What changes is the **set of values**
five existing attributes may hold, plus one boolean field that is deleted and thirteen
empty namespaces that are dropped. Each section below gives the set before and after, every
layer that declares it, and the validation rule that must hold after the change.

## 1. Channel kind — `chat.channel.channel_type`

| Before (5) | After (3) |
|---|---|
| `chat` | `chat` |
| `direct_message` | `direct_message` |
| `project_ticket_thread` | `project_ticket_thread` |
| ~~`crm_deal_notes`~~ | — |
| ~~`support_ticket`~~ | — |

**Declared in**: `chat.channel` CHECK `valid_channel_type` and the column comment;
`ChannelType*` constants and `IsValidChannelType` in `backend/internal/chat/constants.go`;
`ChannelType` enum in `backend/rpc/v1/chat.proto`; the `ChannelType` union and
`convertChannelType` in `frontend/packages/apis/src/chat.ts`.

**Validation rule**: `IsValidChannelType` returns true for exactly the three surviving
values, and the proto enum has exactly `UNSPECIFIED`, `CHAT`, `DIRECT_MESSAGE`,
`PROJECT_TICKET_THREAD` with tag numbers 0–3 unchanged.

**Pre-condition (FR-009)**: `SELECT count(*) FROM chat.channel WHERE channel_type IN
('crm_deal_notes','support_ticket')` is 0. Expected 0; the migration aborts if not.

## 2. File-attachment context — `files.file_access_rule.context_type`

| Before (6) | After (4) |
|---|---|
| `chat_channel` | `chat_channel` |
| `project` | `project` |
| `department_docs` | `department_docs` |
| `calendar_event` | `calendar_event` |
| ~~`support_ticket`~~ | — |
| ~~`crm_deal`~~ | — |

**Declared in**: `files.file_access_rule` CHECK `file_access_rule_context_type_check` and
the column comment; `ContextType*` in `backend/internal/files/constants.go`;
`FileContextType` enum in `backend/rpc/v1/files.proto`; the mapping switches in
`backend/internal/files/service.go`.

**Not in scope — a different set.** `ValidUploadContexts()` in the same Go file is
`chat | avatar | docs | project | calendar` and is untouched, including its own
unreachable `calendar` value, which has a separate cause.

**Pre-condition**: `SELECT count(*) FROM files.file_access_rule WHERE context_type IN
('support_ticket','crm_deal')` is 0.

## 3. Sign-in credential kind — `iam.credential.credential_type`

| Before (2) | After (1) |
|---|---|
| `pin` | `pin` |
| ~~`biometric`~~ | — |

**Declared in**: `iam.credential` CHECK `credential_credential_type_check`, the table
comment and the `credential_hash` column comment; `CredentialTypePIN` /
`CredentialTypeBiometric` in `backend/internal/iam/constants.go`. There is no proto enum
and no TypeScript union for this — it never reached a client surface, which is part of why
it went unnoticed.

**The column survives.** `idx_credential_identity_type_active` is a partial unique index
over `(organization_id, identity_id, credential_type)` that expresses "one active or
temporary credential per kind per identity". Removing the column would rewrite that index
and change live behaviour, which FR-011 forbids.

**Pre-condition**: `SELECT count(*) FROM iam.credential WHERE credential_type =
'biometric'` is 0. If non-zero the disposition per the spec's assumption is deletion — but
the migration raises instead of deleting silently, so a real row gets a human's attention.

## 4. Notification source domain

Two columns share this set and must move together.

| Before (9) | After (5) |
|---|---|
| `chat` | `chat` |
| `projects` | `projects` |
| `calendar` | `calendar` |
| `docs` | `docs` |
| `system` | `system` |
| ~~`crm`~~ | — |
| ~~`hr`~~ | — |
| ~~`support`~~ | — |
| ~~`finance`~~ | — |

**Declared in five places, all of which must agree** (the Go file's own comment names four
of them; the mobile label map is the fifth and is compile-checked):

1. `notification.notification.source_domain` CHECK `notification_source_domain_valid`
2. `notification.personal_preference.muted_domains` CHECK `muted_domains_valid`
3. `allSourceDomains` in `backend/internal/notification/constants.go`
4. `SourceDomain` / `SOURCE_DOMAINS` in `frontend/packages/apis/src/notification.ts`
5. `MUTE_ROWS: Record<SourceDomain, …>` in
   `frontend/apps/mobile/src/app/(app)/(more)/settings.tsx`

**`SOURCE_DOMAINS` order after the change**: `chat`, `projects`, `calendar`, `docs`,
`system`. The existing ordering comment explains it is for a reader rather than
alphabetical — chat first as noisiest, calendar early as most often silenced, system last.
Removing the four leaves that reasoning intact.

**State transition — saved mute lists (FR-010)**. `muted_domains` is a `text[]` with a
subset CHECK. A person's stored array may name a removed domain, and the array must not be
discarded:

```
before:  {chat, crm, calendar}      after:  {chat, calendar}
before:  {crm, hr}                  after:  {}
before:  {chat, docs}               after:  {chat, docs}   (untouched)
```

The repair runs **before** the CHECK is tightened, in the same transaction. Preferences
keep loading; surviving mutes stay in force; removed entries drop away silently, which is
the spec's stated edge-case behaviour.

**Pre-condition**: `SELECT count(*) FROM notification.notification WHERE source_domain IN
('crm','hr','support','finance')` is 0. Unlike `muted_domains`, notification rows are
*not* repaired — a notification in a removed domain would mean something published into it,
contradicting the premise, so it must stop the migration for a human to look at.

## 5. Storage area — Postgres schema

| Before (24) | After (11) |
|---|---|
| `calendar`, `chat`, `collaboration`, `compliance`, `docs`, `files`, `flows`, `iam`, `notification`, `organization`, `voice` | all retained |
| `assets`, `communication`, `crm`, `finance`, `hiring`, `integrations`, `inventory`, `learning`, `payroll`, `procurement`, `retention`, `support`, `timekeeping` | dropped |

**Validation rule (the new standing invariant)**: every schema outside
`pg_catalog`, `pg_toast`, `information_schema` and `public` contains at least one table.
Asserted by a new integration test so the property survives the change that introduced it.

**Note**: `compliance` holds 4 objects and is **retained**, despite
`docs/domain/platform.md` currently listing it as unused. That document is wrong and is
corrected by this change.

## 6. Navigation entry — web workspace nav

| Before (11) | After (8) |
|---|---|
| Today `⌘1`, Notifications `⌘2`, Chat `⌘3`, Tasks `⌘4`, Docs `⌘5`, Files `⌘6`, Organization `⌘7`, Reviews `⌘8` | unchanged, still `⌘1`–`⌘8` |
| ~~CRM `⌘9`~~, ~~Finance `⌘-`~~, ~~HR `⌘=`~~ | — |

**Declared in**: the nav array in `frontend/apps/web/src/app/workspace/layout.tsx`.

**Validation rule**: every entry in the array has `enabled: true` and a `path` that
resolves to a real route; the `shortcut` values form the contiguous run `⌘1`–`⌘8`.

**Fields**: `id`, `label`, `emoji`, `path`, `shortcut`, `enabled`, optional `permission`.
`enabled` is retained although now constant — see plan design decision 5. `permission`
continues to gate `organization` (`iam.inviteUser`) and `reviews`
(`collab.reviewEvidence`), which is live behaviour and unchanged.

## 7. Shared link — `NormalizeResult` / `CanonicalLinkTarget`

**Grammar before (2)**:
- canonical — `/o/{tenantKey}/r/{resourceType}/{resourceId}` with allowed query keys
- legacy — hostname-derived tenant plus `/workspace/projects/{p}/tasks/{id}`,
  `/workspace/tasks/{id}`, `/chat/{id}`, `/docs/{id}`, `/calendar/{id}`

**Grammar after (1)**: canonical only. Anything else returns the existing
unsupported-path error, which the RPC layer already turns into the standard
unresolvable-link response.

**Field removed**: `LegacyNormalized bool` — from `NormalizeResult` (`normalize.go`), from
the JSON-serialised link target (`types.go:134`,
`json:"legacyNormalized,omitempty"`), from its assignment in `service.go:161`, and from
`legacyNormalized?: boolean` in `frontend/packages/links/src/index.ts:42`.

**Unchanged**: `CanonicalLinkTarget` keeps every field it has — `TenantKey`,
`ResourceType`, `ResourceID`, `FocusIntent`, `EntryContext`, `RequirementID`, `AnchorType`,
`AnchorID`, `CanonicalVersion` — and `NormalizeResult` keeps `Target`,
`IgnoredQueryKeys` and `FallbackURL`. `CanonicalVersion` is **not** bumped: the canonical
grammar itself did not change, only the acceptance of a second grammar alongside it.

## Cross-cutting invariant

After this change, for every set above: **each permitted value has at least one producer in
the workspace.** That is SC-001, and it is what makes SC-008 true — a contributor reads one
declaration and knows the value is live, with no reachability check.

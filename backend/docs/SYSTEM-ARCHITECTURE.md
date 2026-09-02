# Tech Office — System Architecture & Domain Dependency Analysis

**Version**: 1.2.0 | **Date**: 2026-05-10

This document describes the domain-driven design (DDD) architecture of the Tech Office multi-tenant SaaS platform, including dependency flow analysis across database schema references and Go code imports. The architecture enforces **inward-pointing, unidirectional dependencies** — no circular references exist between domains.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Domain Layering & Dependency Rules](#2-domain-layering--dependency-rules)
3. [Domain Dependency Graph (Code-Level)](#3-domain-dependency-graph-code-level)
4. [Database Schema Dependency Graph (Data-Level)](#4-database-schema-dependency-graph-data-level)
5. [Clean Architecture Layers](#5-clean-architecture-layers)
6. [Domain Catalog](#6-domain-catalog)
7. [Cross-Domain Integration Patterns](#7-cross-domain-integration-patterns)
8. [Server Initialization Order](#8-server-initialization-order)
9. [Appendix: Full FK Reference Map](#appendix-full-fk-reference-map)

---

## 1. Architecture Overview

Tech Office is organized as a **modular monolith** following DDD principles with schema-per-domain PostgreSQL on a single node. Each business domain owns its schema, tables, and query files. Cross-domain communication happens through well-defined Go interfaces — never through direct DB joins across schemas.

```
┌───────────────────────────────────────────────────────────────────┐
│                        API / RPC Gateway                          │
│  (Connect-RPC handlers, Auth Interceptor, Permission Lookup)      │
├───────────────────────────────────────────────────────────────────┤
│                     Connect Layer (per domain)                    │
│  Pool management, proto↔DB conversion, transaction orchestration  │
├───────────────────────────────────────────────────────────────────┤
│                      Logic Layer (per domain)                     │
│  Business rules, pool-agnostic, injected via interfaces           │
├───────────────────────────────────────────────────────────────────┤
│                     Database Layer (sqlc)                          │
│  Type-safe queries, models, schema-per-domain                     │
├───────────────────────────────────────────────────────────────────┤
│         PostgreSQL (single node, organization_id tenancy)         │
│  Schemas: public | iam | organization | chat | notification |     │
│           files | docs | voice | collaboration | calendar         │
└───────────────────────────────────────────────────────────────────┘
```

---

## 2. Domain Layering & Dependency Rules

Domains are organized into **four tiers**. Dependencies MUST only point **downward** (from higher tiers toward lower tiers). No lateral or upward dependencies are permitted.

### Tier Model

| Tier | Role | Domains | May Depend On |
|------|------|---------|---------------|
| **T0 — Foundation** | Identity & tenant boundary | `public`, `iam`, `organization`, `department` | Nothing (except `public` for org FK) |
| **T1 — Support Kernel** | Infrastructure services consumed by business domains | `notification`, `files`, `preference`, `tour` | T0 only |
| **T2 — Core Domain** | Primary business capabilities | `chat`, `docs` | T0, T1 |
| **T3 — Orchestrator** | High-level features composing multiple core domains | `collaboration`, `voice` | T0, T1, T2 |
| **T4 — Aggregation** | Cross-domain composition with overlay readers | `calendar` | T0, T1, T3 |

### Dependency Direction Rule

```
T4 (Calendar)       ──depends on──▶ T3 (Collaboration) via CollaborationOverlayReader
                     ──depends on──▶ T2 (Docs) via DocsOverlayReader
                     ──depends on──▶ T1 (Notification)
T3 (Collaboration) ──depends on──▶ T2 (Chat, Docs)
T3 (Voice)         ──depends on──▶ T2 (Chat) via channel authorization and call announcements
                    ──depends on──▶ T1 (Notification, Files) for SSE fanout and media artifacts
T2 (Chat, Docs)    ──depends on──▶ T1 (Notification, Files)
T1 (Notification)   ──depends on──▶ T0 (Organization, IAM)
                       ▲ INWARD ONLY — no upward or circular arrows
```

---

## 3. Domain Dependency Graph (Code-Level)

This diagram shows runtime Go code dependencies — constructor injection and method calls between `internal/` packages.

```mermaid
graph TD
    subgraph "T0 — Foundation"
        PUBLIC["public<br/><i>org registry, permissions,<br/>default roles</i>"]
        IAM["iam<br/><i>users, auth, sessions,<br/>SSO, RBAC</i>"]
        ORG["organization<br/><i>employees, departments</i>"]
        DEPT["department<br/><i>hierarchy, members</i>"]
    end

    subgraph "T1 — Support Kernel"
        NOTIF["notification<br/><i>publish, route, SSE,<br/>presence, push</i>"]
        FILES["files<br/><i>upload, access,<br/>PDF, search</i>"]
        PREF["preference<br/><i>theme, user settings</i>"]
        TOUR["tour<br/><i>orientation tours,<br/>progress</i>"]
    end

    subgraph "T2 — Core Domain"
        CHAT["chat<br/><i>channels, messages,<br/>reactions, DM</i>"]
        DOCS["docs<br/><i>documents, versions,<br/>comments, embeds</i>"]
    end

    subgraph "T3 — Orchestrator"
        COLLAB["collaboration<br/><i>projects, tasks,<br/>workflow, analytics</i>"]
        VOICE["voice<br/><i>calls, LiveKit tokens,<br/>recordings, voice messages</i>"]
    end

    subgraph "T4 — Aggregation"
        CAL["calendar<br/><i>events, recurrence,<br/>resources, overlays,<br/>booking, reminders</i>"]
    end

    %% T4 → T3 dependencies (overlay readers)
    CAL -->|"CollaborationOverlayReader<br/>GetTasksDueInRange()<br/>GetRitualInstancesInRange()"| COLLAB
    CAL -->|"DocsOverlayReader<br/>GetDocDeadlinesInRange()"| DOCS
    CAL -->|"PublishNotification()"| NOTIF

    %% T3 → T2 dependencies
    COLLAB -->|"CreateChannel()<br/>GetMessage()<br/>AnnounceTaskCreatedFromMessage()"| CHAT
    COLLAB -->|"CreateDocument()"| DOCS

    %% T3 → T1 dependencies
    COLLAB -->|"PublishNotification()"| NOTIF
    COLLAB -->|"FileLogic (uploads)"| FILES
    VOICE -->|"AuthorizeVoiceChannel()<br/>call announcements"| CHAT
    VOICE -->|"PublishNotification()<br/>live + incoming call"| NOTIF
    VOICE -->|"FileLogic<br/>voice messages + artifacts"| FILES

    %% T2 → T1 dependencies
    CHAT -->|"PublishNotification()"| NOTIF
    CHAT -->|"FileLogic (uploads)"| FILES
    DOCS -->|"PublishNotification()"| NOTIF

    %% Post-init injection (dashed = injected after construction)
    ORG -.->|"SetCollaborationLogic()<br/><i>post-init injection</i>"| COLLAB

    %% Foundation references (simplified)
    IAM --> PUBLIC
    ORG --> PUBLIC
    DEPT --> PUBLIC

    classDef foundation fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef kernel fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
    classDef core fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef orchestrator fill:#fce4ec,stroke:#c62828,stroke-width:2px
    classDef aggregation fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px

    class PUBLIC,IAM,ORG,DEPT foundation
    class NOTIF,FILES,PREF kernel
    class CHAT,DOCS core
    class COLLAB,VOICE orchestrator
    class CAL aggregation
```

### Key Observations

1. **Notification is a Support Kernel** — it has zero imports of any other domain package. Chat, Docs, Collaboration, and Calendar all call into it via the `NotificationPublisher` interface.
2. **Files is a Support Kernel** — it has zero domain imports. Chat and Collaboration consume it for file uploads via `FileLogic` interface.
3. **Collaboration is the top-level orchestrator** — it depends on Chat (`CreateChannel` for task discussion threads), Docs (`CreateDocument` for task descriptions), Notification, and Files.
4. **Calendar is the first T4 Aggregation domain** — it depends on Collaboration and Docs via thin read-only overlay reader interfaces (`CollaborationOverlayReader`, `DocsOverlayReader`) to render cross-domain items (task due dates, ritual instances, doc deadlines) on the calendar. It also depends on Notification for invite/cancel/change/reminder publishing.
5. **Voice is a T3 Orchestrator domain** — it composes Chat authorization/announcements, Files-backed voice messages and call artifacts, Notification SSE/push fanout, and the external LiveKit media plane without adding reverse imports.
6. **Organization → Collaboration** is a controlled post-init injection (`SetCollaborationLogic()`) used solely for creating a default project during org signup. This is **not** a constructor dependency and uses interface indirection to avoid an import cycle.

---

## 4. Database Schema Dependency Graph (Data-Level)

This diagram shows foreign key references between PostgreSQL schemas. Arrows point from the referencing table to the referenced table.

```mermaid
graph TD
    subgraph "T0 — Foundation Schemas"
        S_PUBLIC["<b>public</b><br/>organization<br/>permission<br/>default_role"]
        S_IAM["<b>iam</b><br/>identity, user, role<br/>session, sso_identity<br/>invitation"]
        S_ORG["<b>organization</b><br/>employee<br/>department<br/>department_member"]
    end

    subgraph "T1 — Support Kernel Schemas"
        S_NOTIF["<b>notification</b><br/>notification<br/>notification_recipient<br/>resource_subscription<br/>active_connection<br/>ephemeral_signal<br/>push_token"]
        S_FILES["<b>files</b><br/>file_metadata<br/>file_access_rule<br/>file_quota<br/>file_pdf_conversion"]
    end

    subgraph "T2 — Core Domain Schemas"
        S_CHAT["<b>chat</b><br/>channel<br/>message<br/>channel_membership<br/>reaction<br/>user_chat_config"]
        S_DOCS["<b>docs</b><br/>document<br/>document_version<br/>comment<br/>document_access<br/>section_embed"]
    end

    subgraph "T3 — Orchestrator Schemas"
        S_COLLAB["<b>collaboration</b><br/>project<br/>task<br/>task_assignee<br/>project_state<br/>custom_field<br/>workflow_rule"]
        S_VOICE["<b>voice</b><br/>call_session<br/>call_participant<br/>call_invitation<br/>call_artifact<br/>voice_message"]
    end

    subgraph "T4 — Aggregation Schemas"
        S_CAL["<b>calendar</b><br/>event<br/>attendee<br/>recurrence_exception<br/>resource<br/>resource_booking<br/>working_hours<br/>delegation<br/>check_in<br/>audit_entry<br/>booking_link<br/>event_reminder"]
    end

    %% T4 → T0 FK references
    S_CAL -->|"*.organization_id<br/>*.employee_id"| S_ORG
    S_CAL -->|"*.organization_id"| S_PUBLIC

    %% T3 → T2 FK references
    S_COLLAB -->|"task.channel_id"| S_CHAT
    S_COLLAB -->|"task.description_document_id"| S_DOCS
    S_VOICE -->|"call_session.channel_id<br/>voice_message.channel_id<br/>voice_message.message_id"| S_CHAT
    S_VOICE -->|"call_artifact.file_id<br/>voice_message.file_id"| S_FILES

    %% T3 → T0 FK references
    S_COLLAB -->|"*.organization_id<br/>*.employee_id"| S_ORG
    S_COLLAB -->|"*.organization_id"| S_PUBLIC
    S_VOICE -->|"*.organization_id<br/>*.employee_id"| S_ORG
    S_VOICE -->|"*.organization_id"| S_PUBLIC

    %% T2 → T0 FK references
    S_CHAT -->|"*.organization_id<br/>*.employee_id"| S_ORG
    S_CHAT -->|"*.organization_id"| S_PUBLIC
    S_DOCS -->|"*.organization_id<br/>*.employee_id"| S_ORG
    S_DOCS -->|"*.organization_id"| S_PUBLIC

    %% T1 → T0 FK references
    S_NOTIF -->|"*.organization_id<br/>*.employee_id"| S_ORG
    S_NOTIF -->|"*.organization_id"| S_PUBLIC
    S_FILES -->|"*.organization_id<br/>*.employee_id"| S_ORG
    S_FILES -->|"*.organization_id"| S_PUBLIC

    %% T1 → T2 data-level reference (notification tracks active channel)
    S_NOTIF -.->|"active_connection.active_channel_id<br/>ephemeral_signal.channel_id<br/><i>(data tracking only)</i>"| S_CHAT

    %% T0 internal references
    S_IAM -->|"*.organization_id"| S_PUBLIC
    S_IAM -->|"employee_role.employee_id<br/>user_preference.employee_id"| S_ORG
    S_ORG -->|"*.organization_id"| S_PUBLIC

    %% File references (soft, no FK)
    S_CHAT -.->|"message.file_ids<br/><i>(UUID array, no FK)</i>"| S_FILES
    S_COLLAB -.->|"task.file_ids<br/><i>(UUID array, no FK)</i>"| S_FILES

    classDef foundation fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef kernel fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
    classDef core fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef orchestrator fill:#fce4ec,stroke:#c62828,stroke-width:2px
    classDef aggregation fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px

    class S_PUBLIC,S_IAM,S_ORG foundation
    class S_NOTIF,S_FILES kernel
    class S_CHAT,S_DOCS core
    class S_COLLAB,S_VOICE orchestrator
    class S_CAL aggregation
```

### Data-Level Dependency Notes

| Relationship | Type | Rationale |
|---|---|---|
| `notification.active_connection → chat.channel` | FK (data-tracking) | Tracks which channel the SSE connection is currently viewing for ephemeral signal routing. **Not** a code-level dependency — notification never imports chat. |
| `notification.ephemeral_signal → chat.channel` | FK (data-tracking) | Routes typing/reaction signals to active channel viewers. Same pattern — data-level only. |
| `voice.call_session / voice.voice_message → chat.channel` | FK | Voice calls and voice messages are chat-room capabilities; Chat still owns room membership and timeline rendering. |
| `voice.call_artifact / voice.voice_message → files.file_metadata` | FK | Recordings, transcripts, and uploaded voice messages are stored through the Files support kernel. |
| `chat.message.file_ids → files.file_metadata` | Soft ref (UUID array) | No FK constraint. App-level integrity. Enables file attachments in messages. |
| `collaboration.task.file_ids → files.file_metadata` | Soft ref (UUID array) | No FK constraint. App-level integrity. Enables file attachments on tasks. |

The `notification → chat` data-level FK does **not** violate the tier model because:
- At the **code level**, notification has zero imports of chat.
- The FK exists for referential integrity of connection tracking metadata.
- Notification treats `active_channel_id` as an opaque UUID — it has no knowledge of chat domain logic.

---

## 5. Clean Architecture Layers

Each domain follows a consistent 3-layer internal architecture. Dependencies flow inward only.

```mermaid
graph LR
    subgraph "Per-Domain Structure"
        direction LR
        CONNECT["<b>Connect Layer</b><br/>(RPC handlers)<br/>Pool ownership<br/>Proto ↔ DB conversion<br/>Auth context extraction"]
        LOGIC["<b>Logic Layer</b><br/>(Business rules)<br/>Pool-agnostic (tx DBTX)<br/>Interface-injected deps<br/>Domain operations"]
        DB["<b>Database Layer</b><br/>(sqlc queries)<br/>Type-safe SQL<br/>Schema-scoped<br/>Generated models"]
    end

    CONNECT --> LOGIC
    LOGIC --> DB

    style CONNECT fill:#fff3e0,stroke:#e65100,stroke-width:2px
    style LOGIC fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
    style DB fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
```

### Layer Responsibilities

| Layer | Location | Owns | Depends On |
|---|---|---|---|
| **Connect** | `internal/<domain>/connect.go` | `AdminPool`, `TenantPool`, transaction management | Logic layer, proto types |
| **Logic** | `internal/<domain>/logic.go` | Business rules, domain validation | Database queries (`database.DBTX`), injected interfaces |
| **Database** | `database/<domain>.query.sql.go` | Generated query functions, models | PostgreSQL via sqlc |

### Pool Strategy

| Pool | Scope | Used By |
|---|---|---|
| **AdminPool** | Global operations without tenant context | IAM (global user lookup), Notification (publishing), Organization (signup) |
| **TenantPool** | Tenant-isolated queries (enforces `organization_id`) | All user-facing domain operations |
| **FlowPool** | Async workflow job execution | File validation, post-processing workflows |

---

## 6. Domain Catalog

### T0 — Foundation

#### `public` (System Registry)
- **Schema**: `public`
- **Tables**: `organization`, `permission`, `default_role`, `default_role_permission`
- **Role**: Master tenant registry, canonical permission list, template roles
- **Referenced by**: Every other schema (via `organization_id` FK)
- **Tenancy strategy**: `organization` is the tenant root that every tenant table keys off; `permission` and `default_role` are global tables with no `organization_id`

#### `iam` (Identity & Access Management)
- **Schema**: `iam`
- **Tables**: `identity`, `user`, `role`, `role_permission`, `employee_role`, `sso_identity`, `password_credential`, `session`, `invitation`, `password_reset_token`, `user_preference`, `tour_progress`, `credential`, `account_lockout`
- **Role**: Authentication (JWT, SSO, password, PIN), authorization (RBAC), session management, org-managed worker account lifecycle
- **Depends on**: `public.organization` (FK), `organization.employee` (FK for role assignments)
- **Special**: `iam.user` is **global** (not organization-scoped) — users can belong to multiple orgs
- **Permission**: `iam.manageOrgAccounts` — gates admin operations for org-managed worker accounts (create, batch import, unlock, deactivate, credential reset)

#### `organization` (Tenant Core)
- **Schema**: `organization`
- **Tables**: `employee`, `department`, `department_member`
- **Role**: Employee registry, department hierarchy, membership
- **Depends on**: `public.organization` (FK)
- **Referenced by**: All higher-tier schemas reference `organization.employee`

#### `department`
- **Internal package**: `internal/department`
- **Role**: Department CRUD, hierarchy traversal, member management
- **Shares schema**: `organization` (operates on `department` + `department_member` tables)

### T1 — Support Kernel

#### `notification` (Event Hub)
- **Schema**: `notification`
- **Tables**: `notification`, `notification_recipient`, `resource_subscription`, `resource_subscription_reason`, `resource_surface`, `active_connection` (UNLOGGED), `ephemeral_signal`, `push_token`, `presence_visibility`, `personal_preference`, `delivery_attempt`, `notification_delivery_log`
- **Role**: Publish/subscribe notification delivery, SSE streaming, presence tracking, push notifications (FCM), ephemeral signal routing (typing/reactions)
- **Code dependencies**: None (zero imports of other domain packages)
- **Consumed by**: Chat, Docs, Collaboration via `NotificationPublisher` interface
- **Data-level**: FKs to `chat.channel` for connection tracking (opaque UUID, no logic coupling)

#### `files` (Storage System)
- **Schema**: `files`
- **Tables**: `file_metadata`, `file_access_rule`, `file_quota`, `file_deletion_log`, `file_pdf_conversion`, `file_content_index`
- **Role**: Object storage (R2/S3), file validation (ClamAV), PDF conversion (Gotenberg), content indexing, access rules
- **Code dependencies**: None (zero imports of other domain packages)
- **Consumed by**: Chat, Collaboration via `FileLogic` interface
- **Workflow**: File validation and post-processing run as async `flows` jobs

#### `preference` (User Settings)
- **Schema**: Operates on `iam.user_preference`
- **Role**: Theme mode, user settings
- **Code dependencies**: None

### T2 — Core Domain

#### `chat` (Messaging)
- **Schema**: `chat`
- **Tables**: `channel`, `message`, `channel_membership`, `reaction`, `typing_indicator`, `user_chat_config`
- **Role**: Channels (public/private), messages with threading, reactions, typing indicators, DMs, rich text (sanitized HTML), file attachments, multilingual search (PGroonga)
- **Code dependencies**: `notification` (PublishNotification), `files` (FileLogic)
- **Referenced by**: `collaboration.task.channel_id` (task discussion threads), `notification.active_connection.active_channel_id`

#### `docs` (Document Management)
- **Schema**: `docs`
- **Tables**: `document`, `document_version`, `document_slug_history`, `document_access`, `section_embed`, `comment`, `comment_reply`, `document_editor`, `document_reaction`
- **Role**: Hierarchical documents, version history with diffs, access control, collaborative editing, comments, section embeds, reactions
- **Code dependencies**: `notification` (PublishNotification)
- **Referenced by**: `collaboration.task.description_document_id` (task descriptions)

### T3 — Orchestrator

#### `voice` (Voice Communication)
- **Schema**: `voice`
- **Tables**: `call_session`, `call_participant`, `call_invitation`, `call_artifact`, `voice_message`
- **Role**: Live voice call lifecycle, LiveKit room/token orchestration, high-priority incoming call notifications, post-call records, recordings/transcripts, and voice message upload confirmation
- **Code dependencies**: `chat` (`AuthorizeVoiceChannel`, call system messages, voice timeline messages), `notification` (live SSE and incoming call notifications), `files` (voice message files and call artifacts), external LiveKit server SDK
- **Why orchestrator**: Voice coordinates real-time media state across Chat, Files, Notification, and LiveKit while keeping persistent business truth in Postgres.

#### `collaboration` (Task Management)
- **Schema**: `collaboration`
- **Tables**: `project`, `project_state`, `task_level`, `task`, `task_assignee`, `custom_field_definition`, `custom_field_value`, `workflow_rule`, `workflow_rule_execution`, `project_membership`, `saved_view`, `task_watcher`, `channel_task_destination`
- **Role**: Projects with configurable workflows, tasks with hierarchy (max 5 levels), custom fields, automation rules, analytics, saved views, membership & roles
- **Code dependencies**: `chat` (CreateChannel, GetMessage, AnnounceTaskCreatedFromMessage), `docs` (CreateDocument), `notification` (PublishNotification), `files` (FileLogic)
- **Workflows**: `RitualGenerationWorkflow` (`ritual_generation_sweep`) — one platform-wide job on a fixed 1-minute cadence. It discovers every organization holding at least one unarchived ritual definition and calls `GenerateRitualInstances` once per organization. There is **no** per-ritual-definition schedule: a definition's dates are derived entirely from its stored `recurrence_rule`, `timezone`, `last_generated_date`, and `generation_window_days`, so creating, updating, archiving, unarchiving, or rescheduling a ritual performs zero scheduling operations. Archiving is what stops generation; the discovery query simply stops selecting the definition. A newly created definition is generated inside the creation transaction so its instances exist immediately rather than after the next sweep. A failure on one organization is logged with that organization's ID and the sweep continues; an unparseable recurrence rule skips its own definition only.
- **Why orchestrator**: A task owns a chat channel (discussion thread) and a document (description) — both provisioned lazily on first open, as the task's reporter, by `EnsureTaskResources` rather than at creation — and publishes notifications for assignments/updates. Collaboration also owns turning a chat message into a task: it writes the task's origin columns and asks chat to leave a non-notifying threaded announcement on the source message. The dependency runs collaboration → chat only; `internal/chat` knows nothing about tasks.

### T4 — Aggregation

#### `calendar` (Calendar System)
- **Schema**: `calendar`
- **Tables**: `event`, `attendee`, `recurrence_exception`, `resource`, `resource_acl`, `resource_booking`, `working_hours`, `delegation`, `check_in`, `audit_entry`, `booking_link`, `event_reminder`
- **Role**: Personal and team calendars, RFC 5545 recurring events with exceptions, meeting room/equipment booking with conflict prevention, scheduling assistant (free/busy + slot suggestion), booking links, delegation (act on behalf), compliance check-in with evidence and audit trail, cross-domain overlays (tasks, rituals, doc deadlines)
- **Code dependencies**: `notification` (PublishNotification for invite/cancel/change/reminder), `collaboration` (via `CollaborationOverlayReader` for task due dates and ritual instances), `docs` (via `DocsOverlayReader` for document deadlines)
- **Workflows**: `CalendarReminderWorkflow` (`calendar_reminder_poll`) — polls pending reminders every minute and publishes notifications. Presence at event boundaries is **not** a server-side job: since the presence ping-pong protocol, `presence_status` is written only by client pongs.
- **Why T4 Aggregation**: Calendar reads from T3 (Collaboration) and T2 (Docs) domains through thin read-only overlay interfaces. It is the first domain to compose data from the orchestrator tier, establishing T4 as the aggregation layer. Dependencies are strictly one-directional — neither Collaboration nor Docs import Calendar.

#### `compliance` (Compliance & Safety)
- **Schema**: `compliance`
- **Tables**: `content_report`, `block`, `removal_request`, `account_deletion`
- **Role**: Content reporting across every reportable domain, one-directional blocking of direct contact, account removal requests for admin-provisioned workers, and the resumable account-erase state machine. Terms acceptance and the two deletion RPCs live on `iam` instead, because they act on the global `iam.user` record.
- **Code dependencies**: `chat` (`GetMessage` for message snapshots, `DirectMessageCounterpart`), `files` (`GetFileMetadata`), `docs` (`GetCommentAuthorAndText`), `voice` (`GetCallRecord`), `notification` (owner notification on a removal request), `iam` (the erase steps, through an `AccountEraser` interface)
- **Workflows**: `compliance-account-deletion/v1` — one run per organization the deleted person belongs to, advancing a `compliance.account_deletion` row through `anonymising → purging → done`. Every step is idempotent, so a partial failure is recovered by re-running rather than by a second code path. Runs on `AdminPool`: the terminal step deletes the global `iam.user` row and there is no request context to derive a tenant from.
- **Why T4 Aggregation**: A report can target a chat message, an uploaded file, a document comment or a call record. Compliance composes four T2/T3 domains through read-only resolver interfaces and joins none of their schemas. Dependencies are strictly one-directional — chat and voice consume the block guard through their own locally declared `ContactGuard` interfaces, so neither imports compliance.

---

## 7. Cross-Domain Integration Patterns

### Pattern 1: Interface Injection (Primary)

Domains depend on **interfaces**, not concrete types. This prevents import cycles and enables testing.

```go
// Defined in collaboration package — thin interface
type ChatLogic interface {
    CreateChannel(ctx context.Context, tx database.DBTX,
        orgID, creatorID dbuuid.UUID,
        req *rpcv1.CreateChannelRequest) (*rpcv1.Channel, error)

    // Resolves the channel name shown in a task's origin block, and the caller's
    // channel membership — including whether they administer the channel, which gates
    // changing that channel's remembered task destination.
    GetChannel(ctx context.Context, tx database.DBTX,
        orgID, employeeID, channelID dbuuid.UUID) (*rpcv1.Channel, *rpcv1.LinkedResource, error)

    // Resolves the author and excerpt shown in a task's origin block.
    GetMessage(ctx context.Context, tx database.DBTX,
        orgID, employeeID, messageID dbuuid.UUID) (*rpcv1.Message, error)

    // Posts the threaded system reply recording that a message became a task.
    // Runs on the caller's transaction and notifies nobody.
    AnnounceTaskCreatedFromMessage(ctx context.Context, tx database.DBTX,
        orgID, actorID, channelID, sourceMessageID, taskID dbuuid.UUID,
        identifier, title string) (dbuuid.UUID, error)
}

// Defined in collaboration package — thin interface
type DocsLogic interface {
    CreateDocument(ctx context.Context, tx database.DBTX,
        orgID, employeeID dbuuid.UUID,
        req *rpcv1.CreateDocumentRequest) (*rpcv1.Document, error)
}

// Shared across chat, docs, collaboration — defined per consumer
type NotificationPublisher interface {
    PublishNotification(ctx context.Context, tx database.DBTX,
        req *rpcv1.PublishNotificationRequest) (*rpcv1.PublishNotificationResponse, error)
}
```

**Key principle**: Each consumer defines only the interface methods it needs (Interface Segregation). Collaboration needs 1 method from Chat (40+ total) and 1 from Docs (30+ total).

### Pattern 2: Post-Init Injection (Cycle Breaking)

Organization needs Collaboration to create a default project during signup, but Collaboration depends on Organization (employee references). This is resolved via post-initialization setter injection:

```go
// Phase 3: Initialize organization (no collab dependency in constructor)
orgLogic := organization.NewOrganizationLogic(queries, cfg.WebappURL)

// Phase 9: Initialize collaboration (depends on chat, docs, notification)
collaborationLogic := collaboration.NewLogic(queries, chatLogic, docsLogic, notificationService)

// Phase 10: Inject after both are constructed — breaks cycle
orgLogic.SetCollaborationLogic(collaborationLogic)
```

This maintains the rule that **constructor dependencies flow downward only**. The setter injection is a controlled, documented exception for a specific use case.

The same pattern carries the block guard and the account-erase seam. Compliance is
constructed last, because it composes chat, files, docs, voice, notification and iam; the
domains that *consume* it are already built by then, so they receive it through setters:

```go
// Phase N: compliance, after every domain it reads from
complianceLogic := compliance.NewLogic(queries)
complianceLogic.RegisterResolvers(chatLogic, fileLogic, docsLogic, voiceLogic)

// The block guard, enforced at exactly two chokepoints
chatLogic.SetContactGuard(complianceLogic)
voiceLogic.ContactGuard = complianceLogic

// Deletion RPCs live on IAMService; the resumable record and its job live in compliance
iamConnect.SetAccountDeleter(accountDeleter)
iamConnect.SetEraseEnqueuer(complianceLogic)
iamConnect.SetRemovalRequestResolver(complianceLogic)
```

`chat`, `voice` and `iam` each declare the narrow interface they need locally
(`ContactGuard`, `EraseEnqueuer`, `RemovalRequestResolver`), satisfied structurally. None
of them imports `internal/compliance`.

### Pattern 3: Event-Driven Decoupling (Notification Hub)

Rather than domains calling each other for side effects, they publish notifications through the hub:

```
Chat sends message → PublishNotification(type=message) → Notification routes to recipients
Collab assigns task → PublishNotification(type=task_assigned) → Notification routes to assignee
Docs gets comment  → PublishNotification(type=doc_commented) → Notification routes to followers
```

The notification domain handles routing, delivery, presence awareness, push fallback, and ephemeral signals — none of which the publishing domain needs to understand.

### Pattern 4: Soft References (UUID Arrays)

File attachments in chat messages and collaboration tasks use UUID arrays (`file_ids UUID[]`) instead of foreign keys. This keeps the file domain fully decoupled at the schema level while the application layer handles integrity.

---

## 8. Server Initialization Order

The server boots services in strict dependency order, ensuring no service is used before its dependencies are ready.

```mermaid
graph TD
    subgraph "Phase 1: Infrastructure"
        POOLS["Database Pools<br/>(Admin, Tenant, Flow)"]
        AUTH["Auth Infrastructure<br/>(JWT Signer/Verifier,<br/>JWKS, Interceptor,<br/>PermissionLookup)"]
    end

    subgraph "Phase 2: T0 Foundation"
        ORG_INIT["OrganizationLogic"]
        IAM_INIT["IAMLogic + IAMServiceConnect"]
        DEPT_INIT["DepartmentService"]
    end

    subgraph "Phase 3: T1 Support Kernel"
        NOTIF_INIT["NotificationLogic<br/>+ VisibilityLogic<br/>+ PresenceLogic<br/>+ PushLogic<br/>+ RoutingLogic<br/>+ NotificationService"]
        FILES_INIT["FileLogic + AccessLogic<br/>+ PDFLogic + IndexLogic<br/>+ Validation Workflows<br/>+ PostProcessing Workflows"]
        PREF_INIT["PreferenceLogic"]
    end

    subgraph "Phase 4: T2 Core Domain"
        CHAT_INIT["ChatLogic<br/>+ ChatServiceConnect"]
        DOCS_INIT["DocumentLogic<br/>+ 8 ServiceConnect handlers"]
    end

    subgraph "Phase 5: T3 Orchestrator"
        VOICE_INIT["VoiceLogic + LiveKitClient<br/>+ VoiceServiceConnect<br/>+ LiveKitWebhookHandler"]
        COLLAB_INIT["CollaborationLogic<br/>+ CollaborationServiceConnect"]
    end

    subgraph "Phase 6: Post-Init & Start"
        INJECT["orgLogic.SetCollaborationLogic()"]
        START["NotificationService.Start()<br/>Flow Worker.Start()"]
    end

    POOLS --> AUTH
    AUTH --> ORG_INIT
    AUTH --> IAM_INIT
    AUTH --> DEPT_INIT

    ORG_INIT --> NOTIF_INIT
    IAM_INIT --> NOTIF_INIT
    POOLS --> NOTIF_INIT
    POOLS --> FILES_INIT
    POOLS --> PREF_INIT

    NOTIF_INIT --> CHAT_INIT
    FILES_INIT --> CHAT_INIT
    NOTIF_INIT --> DOCS_INIT
    CHAT_INIT --> VOICE_INIT
    FILES_INIT --> VOICE_INIT
    NOTIF_INIT --> VOICE_INIT

    CHAT_INIT --> COLLAB_INIT
    DOCS_INIT --> COLLAB_INIT
    NOTIF_INIT --> COLLAB_INIT
    FILES_INIT --> COLLAB_INIT

    COLLAB_INIT --> INJECT
    INJECT --> START

    classDef infra fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px
    classDef foundation fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef kernel fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
    classDef core fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef orchestrator fill:#fce4ec,stroke:#c62828,stroke-width:2px
    classDef postinit fill:#fafafa,stroke:#616161,stroke-width:1px,stroke-dasharray: 5 5

    class POOLS,AUTH infra
    class ORG_INIT,IAM_INIT,DEPT_INIT foundation
    class NOTIF_INIT,FILES_INIT,PREF_INIT kernel
    class CHAT_INIT,DOCS_INIT core
    class COLLAB_INIT,VOICE_INIT orchestrator
    class INJECT,START postinit
```

---

## Appendix: Full FK Reference Map

### Cross-Schema Foreign Keys (Explicit)

| Source Table.Column | → Target Table.Column | Tier Direction |
|---|---|---|
| `iam.identity.organization_id` | → `public.organization.id` | T0 → T0 |
| `iam.role.organization_id` | → `public.organization.id` | T0 → T0 |
| `iam.employee_role.(org, employee_id)` | → `organization.employee.(org, id)` | T0 → T0 |
| `iam.user_preference.(org, employee_id)` | → `organization.employee.(org, id)` | T0 → T0 |
| `iam.credential.(org, identity_id)` | → `iam.identity.(org, id)` | T0 → T0 |
| `iam.account_lockout.(org, identity_id)` | → `iam.identity.(org, id)` | T0 → T0 |
| `organization.employee.organization_id` | → `public.organization.id` | T0 → T0 |
| `organization.department.organization_id` | → `public.organization.id` | T0 → T0 |
| `organization.department_member.(org, employee_id)` | → `organization.employee.(org, id)` | T0 → T0 |
| `notification.notification.organization_id` | → `public.organization.id` | T1 → T0 ✅ |
| `notification.notification_recipient.(org, employee_id)` | → `organization.employee.(org, id)` | T1 → T0 ✅ |
| `notification.resource_subscription.(org, employee_id)` | → `organization.employee.(org, id)` | T1 → T0 ✅ |
| `notification.active_connection.(org, employee_id)` | → `organization.employee.(org, id)` | T1 → T0 ✅ |
| `notification.active_connection.(org, active_channel_id)` | → `chat.channel.(org, id)` | T1 → T2 ⚠️ data-only |
| `notification.ephemeral_signal.(org, channel_id)` | → `chat.channel.(org, id)` | T1 → T2 ⚠️ data-only |
| `files.file_metadata.(org, uploaded_by_employee_id)` | → `organization.employee.(org, id)` | T1 → T0 ✅ |
| `chat.channel.(org, created_by_employee_id)` | → `organization.employee.(org, id)` | T2 → T0 ✅ |
| `chat.message.(org, author_employee_id)` | → `organization.employee.(org, id)` | T2 → T0 ✅ |
| `chat.channel_membership.(org, employee_id)` | → `organization.employee.(org, id)` | T2 → T0 ✅ |
| `voice.call_session.(org, channel_id)` | → `chat.channel.(org, id)` | T3 → T2 ✅ |
| `voice.call_session.(org, initiator_employee_id)` | → `organization.employee.(org, id)` | T3 → T0 ✅ |
| `voice.call_session.(org, ended_by_employee_id)` | → `organization.employee.(org, id)` | T3 → T0 ✅ |
| `voice.call_participant.(org, call_session_id)` | → `voice.call_session.(org, id)` | T3 → T3 ✅ |
| `voice.call_participant.(org, employee_id)` | → `organization.employee.(org, id)` | T3 → T0 ✅ |
| `voice.call_invitation.(org, call_session_id)` | → `voice.call_session.(org, id)` | T3 → T3 ✅ |
| `voice.call_invitation.(org, inviter_employee_id)` | → `organization.employee.(org, id)` | T3 → T0 ✅ |
| `voice.call_invitation.(org, invitee_employee_id)` | → `organization.employee.(org, id)` | T3 → T0 ✅ |
| `voice.call_artifact.(org, call_session_id)` | → `voice.call_session.(org, id)` | T3 → T3 ✅ |
| `voice.call_artifact.(org, file_id)` | → `files.file_metadata.(org, id)` | T3 → T1 ✅ |
| `voice.voice_message.(org, channel_id)` | → `chat.channel.(org, id)` | T3 → T2 ✅ |
| `voice.voice_message.(org, sender_employee_id)` | → `organization.employee.(org, id)` | T3 → T0 ✅ |
| `voice.voice_message.(org, file_id)` | → `files.file_metadata.(org, id)` | T3 → T1 ✅ |
| `voice.voice_message.(org, message_id)` | → `chat.message.(org, id)` | T3 → T2 ✅ |
| `docs.document.(org, owner_employee_id)` | → `organization.employee.(org, id)` | T2 → T0 ✅ |
| `docs.document_version.(org, author_employee_id)` | → `organization.employee.(org, id)` | T2 → T0 ✅ |
| `docs.comment.(org, author_employee_id)` | → `organization.employee.(org, id)` | T2 → T0 ✅ |
| `collaboration.project.(org, owner_employee_id)` | → `organization.employee.(org, id)` | T3 → T0 ✅ |
| `collaboration.task.(org, reporter_employee_id)` | → `organization.employee.(org, id)` | T3 → T0 ✅ |
| `collaboration.task.(org, channel_id)` | → `chat.channel.(org, id)` | T3 → T2 ✅ |
| `collaboration.task.(org, source_channel_id)` | → `chat.channel.(org, id)` | T3 → T2 ✅ |
| `collaboration.task.(org, source_message_id)` | → `chat.message.(org, id)` | T3 → T2 ✅ |
| `collaboration.channel_task_destination.(org, channel_id)` | → `chat.channel.(org, id)` | T3 → T2 ✅ |
| `collaboration.channel_task_destination.(org, project_id)` | → `collaboration.project.(org, id)` | T3 → T3 ✅ |
| `collaboration.task.(org, description_document_id)` | → `docs.document.(org, id)` | T3 → T2 ✅ |
| `collaboration.task_assignee.(org, employee_id)` | → `organization.employee.(org, id)` | T3 → T0 ✅ |
| `calendar.event.(org, organizer_id)` | → `organization.employee.(org, id)` | T4 → T0 ✅ |
| `calendar.attendee.(org, employee_id)` | → `organization.employee.(org, id)` | T4 → T0 ✅ |
| `calendar.delegation.(org, owner_id)` | → `organization.employee.(org, id)` | T4 → T0 ✅ |
| `calendar.delegation.(org, delegate_id)` | → `organization.employee.(org, id)` | T4 → T0 ✅ |
| `calendar.check_in.(org, employee_id)` | → `organization.employee.(org, id)` | T4 → T0 ✅ |
| `calendar.audit_entry.(org, actor_id)` | → `organization.employee.(org, id)` | T4 → T0 ✅ |

### Soft References (UUID arrays, no FK constraint)

| Source Table.Column | → Logical Target | Tier Direction |
|---|---|---|
| `chat.message.file_ids` | → `files.file_metadata.id` | T2 → T1 ✅ |
| `collaboration.task.file_ids` | → `files.file_metadata.id` | T3 → T1 ✅ |
| `calendar.check_in.evidence_file_ids` | → `files.file_metadata.id` | T4 → T1 ✅ |

### ⚠️ Data-Level Exception: `notification → chat`

The two FKs from notification to chat (`active_connection.active_channel_id`, `ephemeral_signal.channel_id`) are the **only** upward data-level references in the system. They are justified because:

1. **Purpose**: Notification must know which channel a connection is viewing to route ephemeral signals (typing indicators, reactions) to the correct viewers.
2. **Code isolation**: The notification Go package has **zero imports** of the chat package. The `active_channel_id` is treated as an opaque identifier.
3. **Set by callers**: The channel ID is set by the chat domain when it calls `UpdatePresenceWithChannel()` — notification merely stores and queries it.
4. **Alternative considered**: Removing the FK and using a plain UUID was considered, but the FK provides cascade deletion (when a channel is deleted, connections tracking it are cleaned up) which prevents orphaned data.

This is a pragmatic data-integrity trade-off that does not compromise the code-level dependency direction.

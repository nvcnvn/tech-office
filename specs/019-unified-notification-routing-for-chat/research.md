# Research: Unified Notification Routing

## Decision 1: Preference Enforcement Location

**Decision**: Centralized preference filtering helper in `notification/publisher.go`, called by each domain before publishing.

**Rationale**: Each domain resolves "who is subscribed" from its own table (channel_membership, task_watcher, document_follower), then passes the candidate list through a shared `FilterByPreference()` helper that applies per-subscription preference + global personal preference rules. This matches how chat already works (SQL-level preference filter) but extracts the pattern into a reusable function.

**Alternatives Considered**:
- **SQL-level filtering per domain** (chat's current approach): Works for chat but doesn't compose well when multiple preference sources exist (subscription preference + global preference + DND). Would duplicate complex logic across domain-specific SQL queries.
- **Publisher-level filtering after resolveRecipients**: Too late — resolveRecipients currently receives a flat list of employee IDs with no preference metadata. Would require changing the signature everywhere.
- **Middleware/interceptor approach**: Over-engineered for 3 domains. Would add abstraction without benefit.

**Existing Pattern**: `chat/logic.go` → `ListChannelMembersForNotification` does SQL-level preference filtering. This works well and we keep it for chat. For tasks and docs, we add similar SQL-level + helper filtering.

## Decision 2: Auto-Follow/Auto-Watch Triggers

**Decision**: Auto-follow/auto-watch is domain-logic-level, not database triggers (Constitution forbids triggers on Citus-sharded tables).

**Implementation**:
- **Tasks**: `createTaskWatcher()` already exists with UPSERT. Add calls in:
  - `assignTask()` → auto-watch with reason `assigned` (already happens)
  - Task comment creation → auto-watch with reason `commented`
  - Mention parsing in comment → auto-watch with reason `mentioned`
- **Documents**: Add calls in:
  - `CreateDocument()` → auto-follow creator
  - Document comment/mention → auto-follow commenter
  - Explicit mention in doc comment → auto-follow mentioned user

**Rationale**: Database-level triggers violate Constitution Principle IV (Citus sharding constraints explicitly prohibit triggers). Application-level auto-follow is explicit, testable, and already the pattern used for task watchers.

## Decision 3: Notification Type Enrichment

**Decision**: Add specific notification types while keeping backward compatibility.

**New Types**:
| Domain | Type | Use Case |
|--------|------|----------|
| collaboration | `task_assigned` | Task assigned to user |
| collaboration | `task_status_changed` | Status/priority changed |
| collaboration | `task_commented` | Comment added |
| collaboration | `task_mentioned` | Mentioned in task comment |
| docs | `doc_updated` | Document version saved |
| docs | `doc_commented` | Comment on document |
| docs | `doc_mentioned` | Mentioned in doc comment |

**Current Types Preserved**: `message`, `mention`, `reply`, `typing`, `reaction` (chat domain — unchanged)

**Rationale**: Enriched types enable frontend to render specific notification UIs and support "mentions only" preference filtering (preference checks against notification type, not just existence of @mention).

## Decision 4: Docs Service Notification Publisher Injection

**Decision**: Add `NotificationPublisher` parameter to `docs.NewDocumentLogic()` constructor, matching how chat and collaboration services already receive it.

**Change in server.go**:
```go
// Current:
docsLogic := docs.NewDocumentLogic(queries)

// After:
docsLogic := docs.NewDocumentLogic(queries, notificationLogic)
```

**Rationale**: Direct injection via constructor is the established pattern in this codebase. No new interfaces needed — docs logic will use the same `NotificationPublisher` interface that chat and collaboration use.

**Risk**: docs.NewDocumentLogic is referenced in multiple places. Must update all call sites and the interface definition.

## Decision 5: Global Personal Preference Table

**Decision**: New `notification.personal_preference` table with per-domain mute controls and DND schedule.

**Schema** (see data-model.md for full DDL):
- One row per employee per organization
- `dnd_enabled` boolean + `dnd_start`/`dnd_end` time fields
- `muted_domains` text array for domain-level mute (e.g., `['projects', 'docs']`)
- No complex JSON — simple columns for direct SQL filtering

**Alternatives Considered**:
- **JSONB preferences column on organization.employee**: Mixes concerns, makes SQL filtering harder, violates schema-per-domain principle
- **Separate table per preference type**: Over-normalized for ~5 preference fields
- **Column per domain**: Not extensible if domains are added

**Rationale**: Dedicated table in notification schema keeps notification concerns together. Simple column types allow direct SQL WHERE clauses without JSONB operators.

## Decision 6: document_follower Preference Column

**Decision**: Add `notification_preference` column to `docs.document_follower` table, matching `chat.channel_membership` and `collaboration.project_membership` patterns.

**Values**: `'all'` | `'mentions'` | `'muted'` (same as chat.channel_membership — consistent across domains)

**Default**: `'all'` — following a document means you want all notifications by default.

**Rationale**: Consistent with existing preference patterns. Enables SQL-level filtering similar to chat's `ListChannelMembersForNotification`.

## Decision 7: Priority System Usage

**Decision**: Keep existing priority system unchanged. Map new notification types to priorities:

| Notification Type | Priority | Rationale |
|---|---|---|
| `task_assigned` | 0 (always) | Direct assignment is critical |
| `task_status_changed` | 1 (default) | Respect online status |
| `task_commented` | 1 (default) | Standard notification |
| `task_mentioned` | 0 (always) | Direct mention is critical |
| `doc_updated` | 2 (online-only) | Low urgency, informational |
| `doc_commented` | 1 (default) | Standard notification |
| `doc_mentioned` | 0 (always) | Direct mention is critical |

**Rationale**: Mentions are always priority 0 (always deliver) because someone explicitly called out the user. Document updates are priority 2 because they're passive information that can wait until next online session.

## Decision 8: Deduplication Strategy

**Decision**: Use existing `notification.notification_batch` with `batch_key` for dedup. A user who is both a watcher AND mentioned gets ONE notification with the higher-priority type (`mentioned` > `commented` > `status_changed`).

**Implementation**: Build batch_key as `{source_domain}:{entity_id}:{event_id}` (e.g., `projects:task-uuid:comment-uuid`). When batch_key collision occurs, keep the notification with higher priority (lower number).

**Rationale**: Batch mechanism already exists and handles this pattern. No new infrastructure needed.

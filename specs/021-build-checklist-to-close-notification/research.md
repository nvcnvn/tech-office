# Research: Notification Delivery Consistency and Coverage

## Decision 1: Delivery Policy Lives in a Versioned Backend Policy Registry

**Decision**: Define notification behavior through explicit backend policy constants keyed by notification type, and persist the evaluated policy key on each notification record.

**Why**:
- The spec requires a business delivery policy per notification type, not ad hoc priority checks.
- Current behavior is spread across publisher priority values, domain publishers, and frontend assumptions.
- Persisting the evaluated policy key makes later audit and support diagnosis possible.

**Policy dimensions**:
- `delivery_class`: `persistent` or `live_only`
- `fallback_mode`: `none`, `offline_only`, `always_attempt`
- `ack_action`: `destination_open`, `explicit_ack`, `none`
- `recipient_scope`: `explicit`, `contextual`, `resolved`

**Alternatives considered**:
- Store policy rules in a database table: rejected for the first slice because it adds runtime indirection without product-facing editing needs.
- Keep raw integer priorities as the only policy signal: rejected because it cannot express acknowledgement semantics or persistent/live-only distinction clearly.

## Decision 2: Acknowledgement Must Be Separate from Delivery and Display

**Decision**: Introduce acknowledgement fields separate from `delivery_status` and stop using popup display or generic row clicks as implicit read signals.

**Why**:
- The clarified spec explicitly says popup display alone must not acknowledge a notification.
- Current frontend behavior marks notifications as read on card click, which conflates navigation intent with acknowledgement.
- Support and analytics need to distinguish `delivered`, `seen in UI`, and `acknowledged by intended action`.

**Consequence**:
- Backend schema adds acknowledgement state and action metadata.
- Proto and frontend models expose acknowledgement separately.
- Unread counts are computed from acknowledgement state, not delivery state.

## Decision 3: Recipient Eligibility Is Domain-Owned, Notification Publishing Is Shared

**Decision**: Docs and collaboration services remain responsible for computing eligible recipients; notification infrastructure remains responsible for deduplication, policy application, delivery tracking, and fallback.

**Why**:
- Recipient rules are domain business logic: docs know authors/commenters/followers/mentions, tasks know assignees/reporters/watchers/commenters/mentions.
- Centralizing recipient eligibility in notification service would force cross-domain data access and violate established service boundaries.
- The codebase already follows this pattern for chat and watcher/follower lookups.

**Consequence**:
- Add recipient-resolution helpers in `backend/internal/docs` and `backend/internal/collaboration`.
- Notification publisher accepts resolved recipients plus context metadata, then handles dedupe and lifecycle recording.

## Decision 4: Shared-Context Live Routing Should Generalize Active Channel State

**Decision**: Generalize current channel-only live routing to a shared active-context model stored in PostgreSQL UNLOGGED tables.

**Why**:
- The spec requires live delivery when the audience is defined by shared activity context, even without a recipient list.
- Current `active_channel_id` only solves chat channel targeting.
- A generalized active context model supports chat, documents, and tasks without relying on in-process memory alone.

**Alternatives considered**:
- Reuse `active_channel_id` for non-chat contexts: rejected because it encodes one domain-specific field into a cross-domain requirement.
- Keep explicit recipient lists only: rejected because it does not satisfy contextual live delivery.

## Decision 5: Offline Fallback Needs Auditable Attempt and Outcome Records

**Decision**: Add explicit fallback state and delivery-attempt records so every skipped, retried, and failed offline path has a durable reason.

**Why**:
- The spec calls for one authoritative fallback lifecycle with no overlapping or duplicate attempts.
- Current code can identify offline recipients and push after publish, but skip and retry reasons are not fully auditable.
- Delivery debugging requires per-recipient outcome history, not only the latest status.

**Consequence**:
- `notification.notification_recipient` gains canonical fallback summary fields.
- `notification.delivery_attempt` stores individual attempts and reasons.
- Push fallback remains after commit, but updates the authoritative attempt log.

## Decision 6: Frontend Parity Requires a Shared Navigation Target Contract

**Decision**: Add a typed navigation target contract that both popup UI and notification center use to open the same destination.

**Why**:
- The feature requires supported domains and destination handling to match across backend and frontend.
- Current action data is flexible but loosely typed, and destination behavior differs by surface.
- A shared target model makes acknowledgement-on-open deterministic.

**Target model fields**:
- `domain`: `chat`, `docs`, `projects`
- `resource_type`: `channel`, `message`, `document`, `task`, `comment`, `thread`
- `resource_id`
- `secondary_id` for thread/comment/parent message linkage
- `action`

## Decision 7: Integration Tests Must Validate Cross-Surface Consistency, Not Just RPC Results

**Decision**: Use backend integration tests to validate publication, listing, unread counts, SSE delivery, fallback state, and navigation metadata together.

**Why**:
- Constitution requires integration-first verification.
- The repo already has a `testWorld` with notification, SSE, docs, task, and presence helpers.
- This feature’s main risk is inconsistent behavior across surfaces, not isolated function correctness.

**Test areas**:
- Persistent vs live-only delivery
- Document and task recipient expansion
- Acknowledgement-only-on-destination-open
- Fallback skip/retry/failure audit reasons
- Source-domain parity in unread breakdowns and list filters

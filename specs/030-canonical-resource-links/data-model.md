# Data Model: Canonical Cross-Platform Resource Links

## Overview

This feature does not require a new persisted primary business table in v1. Its main data model is a backend-owned canonical target and resolution contract derived from existing resource records across collaboration, chat, docs, and calendar domains.

## Entities

### CanonicalLinkTarget

- **Purpose**: Platform-neutral meaning of a shareable product link.
- **Fields**:
  - `resourceType`: enum; one of `task_instance`, `chat_channel`, `chat_thread`, `chat_message_anchor`, `project_destination`, `workspace_destination`, `document_page`, `calendar_event`, `booking_item`
  - `resourceId`: stable identifier of the resource; UUID or other stable business identifier already owned by the domain
  - `tenantKey`: stable tenant or workspace hint used in the canonical path for tenant-scoped resources so the resolver can route shard-safe lookups without exposing raw `organization_id`
  - `focusIntent`: optional stable emphasis value such as `review_pending`
  - `entryContext`: optional stable share-context hint
  - `requirementId`: optional child context for task-linked requirements
  - `anchorType`: optional enum such as `message`, `thread`, `requirement`, `section`
  - `anchorId`: optional stable child identifier
  - `canonicalVersion`: version tag for the canonical contract shape
- **Validation rules**:
  - `resourceType` and `resourceId` are required
  - `tenantKey` is required for tenant-scoped resources and must use the stable canonical tenant key or alias accepted by the backend
  - Only whitelisted stable context fields are allowed
  - Temporary UI state is forbidden
  - Query parameters outside the canonical allowlist are ignored or rejected during normalization

### CanonicalLink

- **Purpose**: Stable HTTPS representation of a `CanonicalLinkTarget`.
- **Fields**:
  - `host`: single global canonical host
  - `path`: canonical namespace plus stable tenant key and typed resource locator, for example `/o/<tenant-key>/r/<resource-type>/<resource-id>`
  - `query`: stable optional context fields only
  - `rawUrl`: original incoming URL for normalization/audit during request handling
- **Relationships**:
  - Encodes exactly one `CanonicalLinkTarget`
  - May normalize from one `LegacyLinkFormat`

### LegacyLinkFormat

- **Purpose**: Older shareable product URL shape that still needs normalization support.
- **Fields**:
  - `sourcePattern`: recognizable legacy path/query shape
  - `targetBuilder`: normalization rule that maps old shape to `CanonicalLinkTarget`
  - `supportLevel`: enum `full`, `fallback_only`, `deprecated`
- **Validation rules**:
  - Normalization must preserve the target resource whenever possible
  - Normalization from tenant subdomain routes must map to the canonical host plus canonical tenant path when supported
  - Unsupported legacy shapes must still yield a recoverable web fallback

### LinkResolutionResult

- **Purpose**: Backend response describing what opening the link should do.
- **Fields**:
  - `normalizedTarget`: resolved `CanonicalLinkTarget`
  - `resolutionStatus`: enum `ok`, `auth_required`, `access_denied`, `not_found`, `fallback`
  - `webRoute`: target web-local route for the resolved resource
  - `mobileRoute`: target mobile-local route for the resolved resource
  - `requiresAuthentication`: boolean
  - `preview`: optional `LinkPreviewMetadata`
  - `appliedContext`: list of context elements that can be honored
  - `ignoredContext`: list of context elements that were safely ignored
  - `fallbackUrl`: recoverable browser destination when direct resolution is unavailable
- **State transitions**:
  - `parsed` -> `tenant-resolved` -> `normalized` -> `authorized` -> `translated`
  - Any failure enters one of `auth_required`, `access_denied`, `not_found`, or `fallback`

### LinkPreviewMetadata

- **Purpose**: Lightweight metadata for internal-link preview cards.
- **Fields**:
  - `title`: display title
  - `subtitle`: secondary text or status summary
  - `resourceType`: mirrored display type
  - `badge`: optional state badge such as task status or booking state
  - `href`: canonical link
  - `thumbnail`: optional visual token if applicable
- **Validation rules**:
  - Must be safe to render without blocking composition or send flows
  - Failure to fetch metadata must not affect raw link clickability

### ClientRouteTranslation

- **Purpose**: Platform-specific translation of a normalized target into a local route.
- **Fields**:
  - `platform`: enum `web`, `mobile`
  - `localRoute`: route string in platform-native format
  - `contextSupport`: supported subset of optional context fields
- **Relationships**:
  - One `CanonicalLinkTarget` may produce multiple `ClientRouteTranslation` values

## Relationships

- A `CanonicalLink` encodes one `CanonicalLinkTarget`.
- A `LegacyLinkFormat` may normalize into one `CanonicalLinkTarget`.
- A `LinkResolutionResult` wraps one normalized target and one or more `ClientRouteTranslation` outputs.
- A `LinkPreviewMetadata` record is derived from a resolved target and existing resource data.

## Notes For Persistence

- v1 should prefer derived resolution from existing resource systems over introducing a dedicated canonical-link table.
- Resolver queries should prefer shard-safe lookup by canonical tenant hint plus resource identifier for tenant-scoped resources.
- If a later phase adds persisted aliases, analytics, or per-link sharing records, those tables must follow constitution multi-tenancy rules with `organization_id` and composite keys.
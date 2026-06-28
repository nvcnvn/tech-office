# Feature Specification: Canonical Cross-Platform Resource Links

**Feature Branch**: `[030-ritual-ux-redesign]`  
**Created**: 2026-04-22  
**Status**: Draft  
**Input**: User description: "Below is a cleaner requirement set for the cross-platform link experience, written so product, backend, web, and mobile can implement the same behavior."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Share And Open One Stable Resource Link (Priority: P1)

As a user, I can copy one product-owned HTTPS link for a resource and open that same link from web browsers, the mobile app, or third-party tools without needing to understand platform-specific routes.

**Why this priority**: This is the core product behavior. If a copied link does not reliably open the intended resource on any device, the feature does not deliver its primary value.

**Independent Test**: Can be fully tested by copying a canonical resource link for a supported resource, opening it from desktop and mobile entry points, and confirming that each client lands on the correct destination for that resource.

**Acceptance Scenarios**:

1. **Given** a user copies a task link on web, **When** they paste it into an external document and open it on a mobile device with the app installed and link verification available, **Then** the app opens the correct task instance.
2. **Given** a user copies a task link on mobile, **When** they open the same link on desktop, **Then** the browser opens the correct web destination for that task.
3. **Given** a user opens a supported canonical link on a mobile device without the app installed or without verified-link support, **When** the operating system cannot open the app directly, **Then** the user still reaches a valid web destination for the same resource.

---

### User Story 2 - Reach The Intended Destination After Resolution Checks (Priority: P1)

As a recipient of a shared resource link, I am guided to the intended destination even when authentication, access, or resource availability checks apply, and I always see a clear outcome instead of a blank or broken screen.

**Why this priority**: Shared links are only useful if they remain recoverable under normal real-world conditions such as sign-in, permission failures, and deleted content.

**Independent Test**: Can be fully tested by opening the same canonical link while signed out, without access permission, and after resource deletion, and verifying that each case produces the correct destination or explicit failure state.

**Acceptance Scenarios**:

1. **Given** a signed-out user opens a valid canonical resource link, **When** they complete authentication, **Then** they are returned to the intended resource destination.
2. **Given** a user opens a canonical resource link for a resource they cannot access, **When** resolution completes, **Then** the product shows a clear access-denied state.
3. **Given** a user opens a canonical resource link for a deleted or missing resource, **When** resolution completes, **Then** the product shows a clear not-found state.

---

### User Story 3 - Recognize And Reuse Internal Links In Product Content (Priority: P2)

As a user composing or reading content inside the product, I can paste an internal canonical link and have it remain clickable, with a preview shown when metadata is available, and with in-app navigation staying inside the app when possible.

**Why this priority**: This improves day-to-day collaboration and reuse of shared links inside chat, comments, and rich text, but it depends on the core link contract already working.

**Independent Test**: Can be fully tested by pasting canonical links into supported product inputs, confirming preview behavior, and tapping the resulting link from inside and outside the mobile app.

**Acceptance Scenarios**:

1. **Given** a user pastes a canonical internal resource link into a supported product input, **When** metadata is available, **Then** the product shows a preview card with basic resource metadata.
2. **Given** a user pastes a canonical internal resource link into a supported product input, **When** preview metadata cannot be retrieved, **Then** the raw link remains visible and clickable.
3. **Given** a user taps an internal canonical link preview inside the mobile app, **When** the destination resource is available, **Then** the app navigates internally without unnecessary browser handoff.

### Edge Cases

- A canonical link includes supported focus context that the client only partially understands; the client must still open the correct resource and apply only the context it can safely honor.
- A canonical link contains an anchored child identifier for content that no longer exists while the parent resource still exists; the client must open the parent resource and show a clear fallback state for the missing child target.
- A canonical link is opened from an external tool that strips some formatting but preserves the URL; the raw HTTPS link must still resolve correctly.
- A legacy shared link uses an older route format such as a tenant subdomain route; the product must normalize it to the current canonical target when supported, or degrade to a recoverable web fallback.
- Tenant context cannot be inferred from authenticated context alone; the system must still resolve the link from stable identifiers or explicit link data such as the canonical tenant key carried in the URL.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST generate one canonical HTTPS link for each supported shareable resource.
- **FR-002**: The system MUST define a single canonical target model that represents the meaning of a resource link independently of any client-specific route.
- **FR-003**: The canonical share-link format for v1 MUST support task instances, chat channels, chat threads or anchored messages, project or workspace destinations, document pages, and calendar events or booking items.
- **FR-004**: The system MUST use canonical HTTPS links as the primary share format and MUST NOT expose custom URL schemes as the primary share format.
- **FR-005**: The same canonical link MUST remain usable in web browsers, mobile apps, and third-party tools such as documents, chat tools, email, and notes.
- **FR-006**: The canonical link contract MUST be owned by the backend, including how canonical links are generated and how older link formats are normalized.
- **FR-007**: The canonical link host strategy MUST use the main single global product host for all canonical links rather than a dedicated link-only subdomain.
- **FR-008**: Web and mobile clients MUST translate the same canonical target into their own local destinations without changing the meaning of the link.
- **FR-009**: Canonical links MUST support stable link context for the resource identifier, a stable tenant key or workspace hint in the path when needed for shard-safe resolution, optional focus intent, and optional anchored child identifiers.
- **FR-010**: For task-instance links, the canonical target MUST uniquely identify the task instance and MAY include supported task context such as focus intent, requirement identifier, and entry context.
- **FR-011**: When supported context in a canonical link cannot be applied exactly, the client MUST still open the correct parent resource instead of failing resolution.
- **FR-012**: Canonical links MUST NOT depend on temporary user-interface state such as modal visibility, current scroll position, or ephemeral filters unless that behavior is explicitly defined as shareable.
- **FR-013**: When a mobile device supports verified app-link handling and the app is installed, opening a canonical link on mobile MUST open the app directly.
- **FR-014**: When app opening is unavailable, unsupported, or unclaimed, the same canonical link MUST open a valid web destination for the same target on the main global product host.
- **FR-015**: When a user selects Copy link on web or mobile, the copied value MUST be the canonical HTTPS link.
- **FR-016**: When a canonical internal link is pasted into supported product inputs, the system MUST recognize it as an internal resource link.
- **FR-017**: Internal resource links pasted into supported product inputs MUST remain clickable even if metadata lookup or preview rendering fails.
- **FR-018**: Internal resource links pasted into supported product inputs MUST show a preview card with basic resource metadata when metadata is available.
- **FR-019**: When a user taps an internal resource link from inside the mobile app, the mobile client MUST navigate internally when the target can be resolved without unnecessary browser handoff.
- **FR-020**: If a user is not authenticated when opening a canonical link, the system MUST redirect the user to sign-in and then continue to the intended destination after authentication.
- **FR-021**: If a user lacks permission to access the resource represented by a canonical link, the system MUST show a clear access-denied state.
- **FR-022**: If a canonical link resolves to a resource that no longer exists, the system MUST show a clear not-found state.
- **FR-023**: Any resolution failure MUST produce a clear recoverable outcome and MUST NOT produce a blank or broken screen.
- **FR-024**: Previously shared product links SHOULD continue to work when reasonably possible through normalization into the current canonical target model.
- **FR-025**: If a legacy link cannot be fully normalized, the system MUST degrade to a recoverable web fallback instead of failing silently.
- **FR-026**: Shared-link behavior MUST remain stable across tenant-specific routing variations such as tenant subdomains or tenant-local frontend routes.
- **FR-027**: If tenant context is required to resolve a canonical target, the system MUST derive it from stable identifiers or explicit canonical link data, and authenticated context alone MUST NOT be treated as the sole source of truth.
- **FR-028**: Mobile and web clients MAY implement lightweight fallback parsing for legacy URLs, but they MUST NOT become the source of truth for link meaning.
- **FR-029**: Canonical links MUST remain stable over time even if web routes, mobile routes, or client navigation structures change.
- **FR-030**: Link parsing and resolution MUST complete quickly enough that link opening feels immediate to end users.
- **FR-031**: Link handling results for the same canonical target and user state MUST be deterministic across clients.
- **FR-032**: Canonical links for tenant-scoped resources MUST include a stable tenant key in the canonical path so the backend can resolve the correct tenant shard before resource lookup.
- **FR-033**: The backend MUST validate that the canonical tenant key and resource identifier refer to the same tenant-owned resource and MUST return an explicit recoverable outcome when they do not.

### Key Entities *(include if feature involves data)*

- **Canonical Link Target**: The platform-neutral representation of a shared resource destination, including resource type, resource identifier, stable tenant key or workspace hint when required, optional focus intent, and optional anchored child identifiers.
- **Shareable Resource**: A first-class business object that can be addressed by a canonical link, such as a task instance, chat destination, project or workspace destination, document page, or calendar item.
- **Link Context**: Stable optional navigation context attached to a canonical target, such as focus intent, requirement identifier, entry context, or anchored child identifier.
- **Legacy Link Format**: A previously shared product URL shape that may need normalization into the current canonical target model.
- **Link Resolution Outcome**: The final user-visible result of opening a canonical link, such as direct destination, sign-in continuation, access denied, not found, or recoverable fallback.

### Assumptions

- The first release includes all listed initial resource types: task instances, chat channels, chat threads or anchored messages, project or workspace destinations, document pages, and calendar events or booking items.
- Query parameters that are considered stable for v1 are limited to parameters that express durable navigation context, not temporary interface state; tenant identity for tenant-scoped resources belongs in the canonical path, not in an arbitrary query parameter.
- The tenant key should use a stable canonical tenant identifier; if the current login subdomain is reused for that purpose, it must be treated as a stable canonical alias rather than an incidental frontend route detail.
- Older link formats should be normalized during an active migration window, and unsupported legacy shapes should still degrade to a recoverable web fallback.
- Preview rendering must never block sending, viewing, or opening links.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In acceptance testing, 100% of supported canonical links open the correct resource destination on both web and mobile for supported user states.
- **SC-002**: At least 95% of successful canonical link opens reach a visible destination or explicit recovery state within 2 seconds under normal network conditions.
- **SC-003**: In cross-platform acceptance testing, users complete the copy-and-open flow for supported resource links on a different device without needing route-specific instructions in at least 90% of test attempts.
- **SC-004**: For task links that include supported focus context, at least 95% of test cases apply the intended emphasis when the destination client supports that context, while 100% still open the correct task instance.
- **SC-005**: When internal preview metadata is unavailable, 100% of tested pasted canonical links remain visible and clickable.
- **SC-006**: In sign-out scenarios, 100% of tested users who successfully authenticate from a canonical link are returned to the intended destination after sign-in.
- **SC-007**: In authorization and missing-resource scenarios, 100% of tested link opens show an explicit access-denied, not-found, or recoverable fallback outcome instead of a blank or broken screen.

## Iterations

### Iteration 2026-04-25: Connect RPC link-resolution contract

**Change**: Replace REST-style canonical link resolution and preview wording with the repo-standard Connect RPC / gRPC contract.
**Scope**: Feature-wide
**Artifacts updated**: plan.md, tasks.md, research.md, quickstart.md, contracts/canonical-link-contract.md
**Tasks added**: —
**Tasks removed**: —
**Tasks marked complete**: —
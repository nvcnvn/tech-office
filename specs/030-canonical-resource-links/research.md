# Research: Canonical Cross-Platform Resource Links

## Decision: Use the main single global HTTPS product host with a dedicated canonical path namespace

- **Rationale**: The spec now locks the main global product host rather than a separate link-only subdomain. A dedicated namespace on that host keeps the share format stable and avoids tenant-specific route drift while preserving simpler operations on a host the product already owns. It also reduces risk on Android 14 and lower, where App Link verification is still effectively host-scoped and path refinement from newer Dynamic App Links rules is not universally available.
- **Alternatives considered**:
  - Tenant-specific canonical hosts: rejected because it weakens consistency and multiplies association-file operations.
  - Mixed canonical hosts per tenant or platform: rejected because it makes the canonical contract less stable and harder to explain.
  - Dedicated `links.<host>` subdomain: rejected for v1 because the main product host already owns landing, docs, and app routing, and a reserved canonical namespace on that host gives enough isolation without extra operational surface.

## Decision: Carry tenant hint in the canonical path for tenant-scoped resources

- **Rationale**: The backend runs on Citus-backed tenant tables that commonly require `(organization_id, id)` access patterns. A stable tenant hint in the canonical path gives the resolver enough information to route to the correct tenant shard before resource lookup without exposing raw `organization_id` values in user-facing contracts.
- **Alternatives considered**:
  - Derive tenant only from authenticated context: rejected because the spec requires links to resolve correctly even when the active tenant differs from the current session.
  - Put `tenantKey` only in query parameters: rejected because the canonical path should carry the core shard-routing identity for tenant-scoped resources and remain readable and deterministic.

## Decision: Keep canonical link meaning in a backend-owned target and resolution service

- **Rationale**: The feature spec requires backend ownership for generation and normalization. Centralizing parsing, legacy normalization, auth continuation metadata, and access results in the backend prevents web and mobile from drifting into separate interpretations.
- **Alternatives considered**:
  - Client-owned parsing only: rejected because it duplicates logic and undermines the ownership requirement.
  - Opaque one-time redirect tokens: rejected because the spec requires stable links over time, not per-share ephemeral URLs.

## Decision: Use Connect RPC / gRPC for canonical link resolution and preview transport

- **Rationale**: The repository already standardizes backend API contracts on Connect RPC, and the plan lists Connect RPC as a primary dependency. Exposing canonical link generation, resolution, and preview through Connect RPC methods keeps web and mobile clients aligned with the existing transport stack, avoids parallel REST-specific contract maintenance, and preserves a single typed schema for route translation outcomes.
- **Alternatives considered**:
  - Separate HTTP REST endpoints for link resolution and preview: rejected because they introduce an inconsistent transport surface for a backend-owned contract that already lives inside the Connect RPC boundary.
  - Client-side parsing with no backend RPC for resolution: rejected because it weakens backend ownership and increases drift risk across clients.

## Decision: Use typed canonical targets with stable identifiers, a stable tenant path segment, and whitelisted query context

- **Rationale**: Supported resources already have stable business identifiers, but tenant-scoped lookup also needs a stable tenant hint. A typed target model with a path-carried tenant key plus whitelisted stable parameters such as `focusIntent`, `requirementId`, `entryContext`, or anchored child identifiers supports deterministic translation and preview generation without encoding temporary UI state.
- **Alternatives considered**:
  - Free-form query passthrough: rejected because it invites client drift and accidental dependence on ephemeral UI state.
  - Purely opaque IDs with mandatory resolver fetch before any local understanding: rejected because lightweight client fallbacks and preview recognition benefit from explicit target shape.

## Decision: Use Expo Router as the mobile routing surface, with `+native-intent.tsx` for legacy and irregular inbound URLs

- **Rationale**: Current Expo guidance recommends Expo Router because deep linking is automatically enabled for routes, while `+native-intent.tsx` gives a safe native-only interception point for stale or third-party URL rewriting. This fits the repo’s existing Expo Router app structure.
- **Alternatives considered**:
  - Custom React Navigation linking config as the primary path: rejected because Expo Router already owns navigation.
  - Rely only on custom URL schemes: rejected because the spec forbids custom schemes as the primary share format.

## Decision: Host both `apple-app-site-association` and `assetlinks.json` on the canonical web host and treat deployment correctness as part of the feature

- **Rationale**: Apple and Android both still require a public HTTPS two-way association between app and website. Expo’s latest docs also place these files in the web app’s public `.well-known` directory for modern frameworks. This makes the web app the natural place to host canonical verification artifacts.
- **Alternatives considered**:
  - Host association files outside the product web app: rejected because it adds operational split ownership to a product contract.
  - Defer association files until after backend work: rejected because verified-link behavior is part of core acceptance criteria.

## Decision: Do not rely on Android 15 Dynamic App Links for core correctness

- **Rationale**: Android 15 adds dynamic path refinement through `assetlinks.json`, but Android 14 and lower still ignore those rules and can match based on broader static manifest scope. The feature must behave deterministically across clients, so the baseline contract cannot depend on Android-15-only behavior.
- **Alternatives considered**:
  - Use Android 15 dynamic rules as the only path filter: rejected because lower Android versions would behave differently.
  - Avoid App Links entirely and use browser fallback only: rejected because app-open behavior is a core requirement when verification is available.

## Decision: Validate all incoming URLs and fail to explicit destination states instead of silent rejection

- **Rationale**: Apple explicitly documents universal links as an attack surface and recommends validating parameters and covering malformed URLs in tests. The spec also requires access-denied, not-found, and recoverable fallback states instead of blank screens.
- **Alternatives considered**:
  - Trust query parameters and route directly: rejected for security and correctness reasons.
  - Drop malformed links without a user-visible outcome: rejected because the spec requires clear failure states.

## Decision: Preview metadata is non-blocking and degrades to raw clickable links

- **Rationale**: The spec requires preview cards in v1 when metadata is available, but link usability must survive preview failures. A separate preview RPC read or resolver expansion keeps paste/send flows responsive.
- **Alternatives considered**:
  - Make preview fetch mandatory before rendering: rejected because it violates graceful failure.
  - Skip previews entirely in v1: rejected because product decisions locked previews into v1.

## Decision: Rollout and test strategy must account for iOS AASA caching and Android verification delay

- **Rationale**: Apple’s associated-domain updates are cached and not refreshed frequently, and Expo notes that Android verification can take 20 seconds or more. The plan therefore needs explicit verification and debugging steps rather than assuming immediate behavior after deployment changes.
- **Alternatives considered**:
  - Treat association-file updates as instantly testable in production builds: rejected because the official docs contradict that assumption.
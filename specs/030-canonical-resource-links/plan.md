# Implementation Plan: Canonical Cross-Platform Resource Links

**Branch**: `[030-ritual-ux-redesign]` | **Date**: 2026-04-22 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/030-canonical-resource-links/spec.md`

## Summary

Implement a backend-owned canonical HTTPS link contract for shareable product resources, using the main single global product host plus a reserved canonical path namespace with tenant hint segments, deterministic resolution, legacy-link normalization, Connect RPC / gRPC-based resolution and preview contracts, and client-specific route translation for Next.js web and Expo Router mobile. The plan keeps canonical link meaning in the backend, uses web-hosted association files for iOS Universal Links and Android App Links, and adds client routing layers that preserve graceful fallback when verification, authentication, permission, or exact focus application cannot be completed.

## Technical Context

**Language/Version**: Go 1.25.0 backend; TypeScript 5.9.x frontend; React 19; Next.js 15.5.2 web; Expo SDK 55 / Expo Router 55 / React Native 0.83.4 mobile  
**Primary Dependencies**: Connect RPC, sqlc, PostgreSQL/Citus, Next.js, Expo Router, expo-linking, Playwright, Maestro  
**Storage**: PostgreSQL for authoritative business resources; static HTTPS-hosted `.well-known` files for Apple and Android domain association; no new persistence required for canonical-link generation in v1 unless stable tenant-key aliases, legacy aliases, or analytics later require it  
**Testing**: Go backend integration tests in `backend/integration/`; Playwright E2E in `frontend/apps/web/e2e/`; Maestro mobile flows in `frontend/apps/mobile/.maestro/`; mobile TypeScript preflight via `pnpm --dir frontend exec tsc -p apps/mobile/tsconfig.json --noEmit`  
**Target Platform**: Linux backend service, Next.js web app, iOS and Android mobile apps using Expo development and production builds  
**Project Type**: Multi-project SaaS platform with Go backend, Next.js web frontend, and Expo mobile client  
**Performance Goals**: Link open feels immediate; link resolution reaches a visible destination or explicit recovery state within 2 seconds for normal conditions; preview lookup is non-blocking  
**Constraints**: Main single global product host; canonical HTTPS links are primary share format; canonical path must include a stable tenant hint for tenant-scoped resources; custom scheme stays secondary; clients must honor backend link meaning; auth continuation and access-denied/not-found states must be explicit; Android 14 and lower ignore Android 15 dynamic path rules; iOS Universal Link association updates are cached and slow to refresh  
**Scale/Scope**: v1 covers task instances, chat channels, chat threads or anchored messages, project or workspace destinations, document pages, and calendar events or booking items across backend, web, and mobile

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principle I: Data Governance & Multi-Tenancy with Citus Sharding**: PASS. The planned contract keeps tenant resolution in backend logic, does not expose `organization_id` as the source of truth in user-facing link contracts, carries a stable tenant hint for shard-safe lookup of tenant-scoped resources, and does not require a new tenant table in v1. If persistence is introduced later for aliases or analytics, it must follow composite-key and `organization_id` rules.
- **Principle II: Scenario-First Integration & E2E Testing**: PASS. This plan includes explicit backend integration scenarios, web E2E scenarios, and a mobile Maestro happy-path requirement in the behavioral contract.
- **Backend-Owned Contract Rule from Spec**: PASS. Resolution, generation, and legacy normalization remain backend-owned; web and mobile only translate resolved targets into local routes.
- **Gate Result Before Phase 0**: PASS.
- **Gate Result After Phase 1 Design**: PASS. Research, data model, quickstart, and contracts preserve backend ownership, deterministic resolution, and required scenario coverage.

## Project Structure

### Documentation (this feature)

```text
specs/030-canonical-resource-links/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── canonical-link-contract.md
│   └── behavioral-contract.md
└── tasks.md
```

### Source Code (repository root)

```text
backend/
├── cmd/
├── database/
│   └── scripts/
├── internal/
├── integration/
└── rpc/

frontend/
├── apps/
│   ├── mobile/
│   │   ├── app.json
│   │   └── src/app/
│   └── web/
│       ├── e2e/
│       ├── public/
│       └── src/
└── packages/
```

**Structure Decision**: Use the existing Go backend as the canonical link authority, the existing Next.js web app on the main global product host as both the canonical route surface and `.well-known` file host, and the existing Expo Router mobile app as the verified-link client. No new top-level project is needed.

## Phase 0 Research Summary

- Official Expo guidance recommends universal/app links based on product-owned HTTPS domains and Expo Router for inbound routing; custom schemes remain secondary.
- Apple still requires two-way association using `apple-app-site-association` plus associated-domain entitlements, and warns to validate all URL parameters because universal links are an attack surface.
- Apple now serves associated-domain verification through its CDN for public domains, and devices refresh association data infrequently, so rollout and debugging need cache-aware steps.
- Android recommends App Links for web-domain links, requires `android:autoVerify="true"`, and now supports Dynamic App Links on Android 15+, but Android 14 and lower still evaluate only static manifest scope for verification and path handling.
- Expo Router supports native inbound URL rewriting through `src/app/+native-intent.tsx`, but equivalent web canonicalization must happen in server redirects, middleware, or app-root route logic.

## Phase 1 Design Summary

- Introduce a backend canonical target model and Connect RPC-backed resolution service that parses canonical links, normalizes legacy links, checks auth and access, and returns platform-neutral target data plus optional preview metadata.
- Reserve a dedicated canonical path namespace on the main global host, with a stable tenant hint segment ahead of the resource namespace, so Android host-wide verification does not accidentally capture unrelated product URLs on Android 14 and lower while still enabling shard-safe backend lookup.
- Host `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json` from the canonical web host with no redirects and deployment validation.
- Web translates resolved canonical targets to Next.js local routes through middleware or a dedicated resolver route.
- Mobile translates resolved canonical targets to Expo Router local routes, adds verified-link config in `app.json`, and handles legacy/native oddities with `+native-intent.tsx`.
- Preview rendering uses a non-blocking preview RPC or resolver expansion and never blocks message send/view flows.

## Implementation Phases

### Phase 2 Execution Outline

1. Add backend canonical target types, parser, generator, and legacy normalizer.
2. Add backend Connect RPC resolver and preview methods with auth/access/not-found outcomes.
3. Add web canonical host handling on the main product host, `.well-known` assets, and route translation.
4. Add Expo verified-link configuration and native URL rewrite/translation.
5. Add copy-link entry points and internal-link preview rendering hooks.
6. Add backend integration, web E2E, and Maestro scenarios before implementation is considered complete.

## Complexity Tracking

No constitution violations currently require justification.

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

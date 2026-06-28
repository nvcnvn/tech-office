# Behavioral Contract: Integration, E2E, And Mobile Flows

## Purpose

These scenarios are the reviewed behavioral contract for the feature. They are derived from the approved user stories and requirements and must be represented as backend integration scenarios, web E2E scenarios, and a mobile Maestro happy path before the feature is considered complete.

## Backend Integration Scenarios

### TestCanonicalLinks

- `// FR-001 FR-002 FR-003 FR-006 FR-008 FR-009`
- `when a canonical link is generated for each supported resource type`
  - `it returns a single HTTPS link on the canonical host`
  - `it encodes only stable identity and supported context`
  - `it preserves the same canonical target meaning for web and mobile`

- `// FR-010 FR-011`
- `when a task link includes supported focus context`
  - `it resolves to the correct task instance`
  - `it returns the supported context as applied when the client can honor it`
  - `it keeps the task destination even when some context is ignored`

- `// FR-020 FR-021 FR-022 FR-023`
- `when a canonical link is opened under auth and access edge cases`
  - `it returns auth required for signed-out users`
  - `it returns access denied for unauthorized users`
  - `it returns not found for deleted resources`
  - `it never returns a blank or ambiguous outcome`

- `// FR-024 FR-025 FR-028`
- `when a legacy product link is normalized`
  - `it resolves to the current canonical target when the mapping is supported`
  - `it degrades to a recoverable fallback when full normalization is unavailable`

- `// FR-016 FR-017 FR-018`
- `when preview metadata is requested for an internal canonical link`
  - `it returns preview metadata when the target is available`
  - `it allows raw-link rendering when metadata lookup fails`

## Web E2E Scenarios

### Canonical Resource Links

- `when a user opens a copied task link on desktop`
  - `the browser lands on the correct web task destination`

- `when a signed-out user opens a canonical link in the browser`
  - `the app redirects to sign in and returns to the intended resource after authentication`

- `when a user lacks permission for the target resource`
  - `the app shows a clear access denied state`

- `when a canonical link points to a missing resource`
  - `the app shows a clear not found state`

- `when a canonical link is pasted into a supported rich input`
  - `a preview card appears when metadata is available`
  - `the raw link remains clickable when metadata lookup fails`

## Mobile Maestro Happy Path

- `when a user opens a canonical task link on a verified device`
  - `the app opens directly to the correct task screen`
  - `the expected task emphasis is visible when focus intent is supported`

- `when a user taps an internal canonical-link preview inside the app`
  - `navigation stays inside the app without browser handoff`

## Traceability Notes

- User Story 1 is covered by canonical generation and cross-platform destination scenarios.
- User Story 2 is covered by auth-required, access-denied, and not-found scenarios.
- User Story 3 is covered by preview, raw-link fallback, and in-app navigation scenarios.
- No user-visible behavior from the spec is intentionally excluded from test scope.
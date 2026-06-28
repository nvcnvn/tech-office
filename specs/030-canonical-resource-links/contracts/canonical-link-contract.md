# Contract: Canonical Link Generation, Resolution, And Preview

## Purpose

Define the backend-owned contract for canonical HTTPS links so web and mobile consume the same target meaning while keeping client-local routes independent.

## Transport Contract

Canonical link generation, resolution, and preview are exposed through backend Connect RPC methods and remain compatible with the repo's gRPC transport model.

- `GenerateCanonicalLink`: returns the canonical HTTPS URL plus the normalized target.
- `ResolveCanonicalLink`: accepts a canonical or legacy URL plus client context and returns the normalized target, translated routes, resolution status, and fallback data.
- `GetCanonicalLinkPreview`: returns best-effort preview metadata for internal canonical links.

## Canonical URL Shape

Canonical URLs use the main single global product host and a dedicated canonical namespace with a stable tenant-key segment for tenant-scoped resources.

```text
https://<global-host>/o/<tenant-key>/r/<resource-type>/<resource-id>?focusIntent=<value>&entryContext=<value>&requirementId=<value>&anchorType=<value>&anchorId=<value>
```

## Allowed Stable Parameters

- `focusIntent`
- `entryContext`
- `requirementId`
- `anchorType`
- `anchorId`

The tenant key is carried in the canonical path for tenant-scoped resources rather than as a free-form query parameter.

Any parameter outside the allowlist is ignored or rejected during normalization and must never change the canonical meaning of the resource.

## Generation Contract

### RPC Method

`GenerateCanonicalLink`

### Input

```json
{
  "tenantKey": "acme",
  "resourceType": "task_instance",
  "resourceId": "<uuid>",
  "focusIntent": "review_pending",
  "entryContext": "share_sheet",
  "requirementId": "<uuid>",
  "anchorType": null,
  "anchorId": null
}
```

### Output

```json
{
  "canonicalUrl": "https://<global-host>/o/acme/r/task/<uuid>?focusIntent=review_pending&entryContext=share_sheet&requirementId=<uuid>",
  "normalizedTarget": {
    "tenantKey": "acme",
    "resourceType": "task_instance",
    "resourceId": "<uuid>",
    "focusIntent": "review_pending",
    "entryContext": "share_sheet",
    "requirementId": "<uuid>"
  }
}
```

## Resolution Contract

### RPC Method

`ResolveCanonicalLink`

### Input

```json
{
  "url": "https://<global-host>/o/acme/r/task/<uuid>?focusIntent=review_pending",
  "platform": "mobile",
  "isAuthenticated": true
}
```

### Output

```json
{
  "status": "ok",
  "normalizedTarget": {
    "tenantKey": "acme",
    "resourceType": "task_instance",
    "resourceId": "<uuid>",
    "focusIntent": "review_pending"
  },
  "webRoute": "/app/projects/<projectId>/tasks/<taskId>?focusIntent=review_pending",
  "mobileRoute": "/(app)/(tasks)/<projectId>/<taskId>?focusIntent=review_pending",
  "appliedContext": ["focusIntent"],
  "ignoredContext": [],
  "preview": {
    "title": "Quarterly review ritual",
    "subtitle": "Task in Review",
    "resourceType": "task_instance",
    "href": "https://<global-host>/o/acme/r/task/<uuid>?focusIntent=review_pending"
  },
  "fallbackUrl": "https://<global-host>/o/acme/r/task/<uuid>?focusIntent=review_pending"
}
```

## Resolution Outcomes

- `ok`: target resolved and platform routes are available.
- `auth_required`: sign-in is required before continuing.
- `access_denied`: user is authenticated but not authorized.
- `not_found`: target resource or required parent context does not exist.
- `fallback`: canonical link cannot be fully translated but a recoverable browser path exists.

## Client Responsibilities

### Backend

- Owns canonical URL generation.
- Owns parsing and normalization of legacy routes.
- Resolves the canonical tenant key to tenant identity for shard-safe resource lookup and validates that the keyed tenant and resource match.
- Owns resolution outcomes and preview metadata.

### Web

- Accepts canonical URLs at the main global host.
- Uses server redirect, middleware, or resolver page logic to translate normalized targets into Next.js local routes.
- Keeps fallback browser behavior available when app-link behavior is unavailable.

### Mobile

- Configures verified HTTPS handling through Expo app config.
- Uses Expo Router for final navigation.
- May perform lightweight native rewrite for malformed or legacy inbound URLs, but defers link meaning to backend resolution.

## Legacy Normalization Rules

- Legacy routes normalize to the same `normalizedTarget` shape as canonical URLs.
- If exact context cannot be preserved, normalization still opens the correct parent resource.
- Unsupported legacy shapes return `fallback` with a recoverable browser destination.

## Preview Contract

- **RPC Method**: `GetCanonicalLinkPreview`
- Preview metadata lookup must be best-effort.
- Preview failures must not prevent raw link rendering, message sending, or navigation.
# Contract: a disabled identity provider

Applies in **every** profile, development included (FR-023). A provider is disabled when its
audience list resolves to no usable entries.

## Affected RPCs

| RPC | Where | Behaviour when the provider is disabled |
|---|---|---|
| `IAMService.ExchangeToken` | `internal/iam/connect_auth.go` | Refused before the token is parsed. No `iam.user` created, no `iam.sso_identity` linked, no session issued (US2 AS1) |
| `IAMService.LinkSSOIdentity` | same file | Refused. No identity linked (US2 AS4) |
| `IAMService.AcceptInvitation` with `sso_provider` / `sso_id_token` | same file | Refused. The invitation is untouched and remains pending |

`SignIn` (workspace password) and the PIN sign-in RPCs are not affected in any way (FR-028,
US2 AS3).

## Error contract

**Code**: `FAILED_PRECONDITION`

Deliberately different from the `UNAUTHENTICATED` that `ErrInvalidSSOToken` maps to, so a
client can tell "this deployment does not offer that provider" from "your token was rejected"
without matching on message text (FR-024).

**Message**: `this sign-in method is not enabled for this workspace`

Written for the person reading it rather than the operator — it does not name an environment
variable, because the person holding the phone cannot set one. The diagnostic that does name
the setting is the startup log line, which the operator sees.

**Detail**: one `google.rpc.PreconditionFailure`

```
PreconditionFailure {
  violations: [{
    type:        "SSO_PROVIDER_NOT_ENABLED"
    subject:     "google" | "apple"
    description: "this deployment has no accepted audiences configured for this provider"
  }]
}
```

`type` is declared once in `backend/internal/iam/constants.go` beside `SSOProviderGoogle` and
`SSOProviderApple`, and mirrored in `frontend/packages/apis/src/iam.ts` (Principle VIII).
`subject` uses the same lowercase provider identifiers those constants already hold.

## Client side

No new extractor is needed. `frontend/packages/apis/src/errorDetails.ts` already exports
`extractPreconditionViolations(error): {type, subject, description}[]`, used by the
collaboration domain. The `iam` API wrapper reads it and maps
`type === "SSO_PROVIDER_NOT_ENABLED"` to the sign-in copy.

Both clients already hide a provider whose client ID is absent — the web sign-in page gates its
buttons on `NEXT_PUBLIC_GOOGLE_CLIENT_ID` / `NEXT_PUBLIC_APPLE_CLIENT_ID`, and mobile's
`resolveSSOAvailability` does the same from the build's client IDs. So on a coherently
configured deployment this error is unreachable from the UI; it is the guard for the case where
the client is configured and the server is not. It is still surfaced with real copy rather than
a raw error, in keeping with feature 058.

## Round-trip verification

Principle X requires an integration test proving the detail survives backend → frontend. The
scenario `the refusal carries the provider name in its error detail` in
`backend/integration/production_safety_test.go` asserts the code, the type and the subject on
the wire; the web E2E sign-in spec asserts the rendered copy.

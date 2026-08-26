# Error detail contracts (Principle X)

Structured details are added only where a bare Connect code cannot guide the client. Two
cases qualify in this feature; everything else stays a code plus message.

## 1. PIN lockout → `google.rpc.RetryInfo`

**Emitted by**: `IAMService.LoginWithPIN` when `checkLockout` rejects.
**Code**: `CodeResourceExhausted`.

```go
retryInfo := &errdetails.RetryInfo{
    RetryDelay: durationpb.New(time.Until(lockout.LockedUntil.Time)),
}
if detail, err := connect.NewErrorDetail(retryInfo); err == nil {
    connectErr.AddDetail(detail)
}
```

**Client** extracts with `ConnectError.findDetails(RetryInfoSchema)` and renders a live
countdown: *"Too many tries. Wait 4:32, then try again."* Today the remaining time is not
transmitted at all, so the client cannot say more than "try later".

**Full lock (tier 4)** carries no `RetryDelay` — there is no delay that resolves it. The
client falls back to *"Your account is locked. Ask your manager to unlock it."*, and for an
identity that also has an email, adds *"…or sign in with your email and password."*

**Fallback**: if the detail is missing or malformed, show the generic message. Absence of a
detail must never block the error from being shown.

## 2. Subdomain conflict → `google.rpc.BadRequest`

**Emitted by**: `OrganizationService.RegisterOrganizationWithAdminPassword`.
**Code**: `CodeAlreadyExists` for a taken address, `CodeInvalidArgument` for a malformed one.

```go
br := &errdetails.BadRequest{
    FieldViolations: []*errdetails.BadRequest_FieldViolation{{
        Field:       "subdomain",
        Description: "already in use",
    }},
}
```

**Client** maps the violation to the workspace-address field rather than to the form as a
whole, and offers the suggested alternative from `CheckSubdomainAvailable`.

**Why it qualifies**: the signup form has six fields; a bare `AlreadyExists` on the whole
request gives the user no way to know which one to change.

## Round-trip tests (mandatory per Principle X.4)

- `LoginWithPIN` at lockout tiers 1–3 returns a `RetryInfo` whose delay is within one second
  of the remaining lockout, and the wrapper in `packages/apis/src/errors.ts` extracts it.
- Tier 4 returns no `RetryInfo`.
- Registering a taken subdomain returns a `BadRequest` naming the `subdomain` field.

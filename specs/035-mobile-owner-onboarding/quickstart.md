# Quickstart: validating feature 035

How to prove this feature works end to end. Details of *what* changes live in
[data-model.md](data-model.md) and [contracts/](contracts/); this file is the run guide.

## Prerequisites

- Backend on `:8080`, Metro on `:8082` (`make dev` at repo root).
- iOS Simulator or Android emulator with the dev client installed.
- Maestro on PATH.
- A clean database, or at least a subdomain not already taken by a previous run.

## Backend validation

```bash
# Regenerate after the query and proto changes
make sqlc
make proto

# The load-bearing change: an email-registered owner can sign in with a PIN
go test ./integration -run TestMobileOwnerOnboarding -v

# Regression on the paths this feature alters
go test ./integration -run 'TestIAMAuthMethods|TestOrgManagedAccounts' -v
```

**Expected**: `TestMobileOwnerOnboarding` covers the three user stories as backend scenarios —
register an organization, `SetPIN` as the owner, `LoginWithPIN` using the owner's **email**,
create an org account, and `LoginWithPIN` using that worker's **login identifier**. If the
email case fails, stop: research D1 is wrong and the design needs revisiting before any mobile
work proceeds.

Also expected to pass:
- A voluntary `SetPIN` without `current_pin` is now rejected; first-time set is not.
- A taken subdomain returns `AlreadyExists` with a `BadRequest` detail, not a raw pg error.
- Lockout tiers 1–3 carry `RetryInfo`; tier 4 does not.
- `CreateOrgAccount` rejects a `login_identifier` containing `@`.

## Mobile validation

```bash
# User story 1 — returning worker, six digits and nothing else
make test-mobile-one F=auth/signin-known-device

# User stories 2 and 3 — owner creates a workspace, sets a PIN, adds a teammate
make test-mobile-one F=onboarding/owner-signup

# Full suite must be green before merge (Constitution XIII)
make test-mobile
```

The owner-signup flow generates a unique company name per run so repeated local runs do not
collide on the derived address.

## Manual checks the automation cannot make

Maestro asserts that elements exist; it cannot judge whether a screen is usable. Walk these
on a mid-range device in portrait before calling the feature done:

1. **Fresh install → workspace in under three minutes**, without reading any documentation
   (SC-002). Time it.
2. **Returning sign-in is six taps, no text entry** (SC-001). The keypad must already be up
   when the screen appears — if you have to tap a box first, that is a defect.
3. **Wrong PIN keeps the keypad.** The boxes clear in place, the message appears inline, and
   the retry costs one gesture. No modal.
4. **Kill the app between signup and the PIN step**, reopen, and confirm it resumes at the PIN
   step — not at signup, where retrying would collide on the owner's own subdomain.
5. **The teammate share sheet** opens with the message pre-filled and readable, and the code
   is legible enough to read aloud over a phone.
6. **Read every string on all five screens** and confirm none contains "subdomain",
   "organization context", "SSO", "account ID" or "identifier" (SC-004).

## Definition of done

- [ ] Backend integration scenarios for US1–US3 pass
- [ ] `make test-mobile` green, including the two new flows
- [ ] Every interactive element has a `testID` (Constitution XIII)
- [ ] No protobuf types imported outside `packages/apis` (Constitution VII)
- [ ] No hardcoded colours; theme tokens only (Constitution VII)
- [ ] `docs/domain/auth-identity.md` updated — authentication methods, client surfaces, and
      drift entry D4 (Constitution XII)
- [ ] The six manual checks above walked on a real device
- [ ] **Principle XIII gate resolved** — the constitution is amended to permit first-run
      onboarding on mobile, or this feature is not merged. See plan.md Complexity Tracking.

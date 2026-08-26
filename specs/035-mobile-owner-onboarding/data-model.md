# Phase 1 Data Model

**No new tables and no migrations.** This feature reuses the existing identity model; the
only persistent-schema-adjacent change is a query predicate. Client-side state is new.

## Existing entities touched

### `iam.identity` (org-distributed)

| Column | Relevance |
|---|---|
| `id` | Equals `iam.user.id` and `organization.employee.id` for the same person. This invariant is what lets an email-registered owner hold a PIN — see research D1. |
| `organization_id` | Distribution key; stays in every predicate. |
| `email` | Populated for owners and invited users. **Newly used as a PIN-login lookup key.** |
| `login_identifier` | Populated for org-managed workers. NULL for owners. Unique per org via partial index. |

**Changed access path** — `GetIdentityByOrgAndLoginIdentifier`:

```sql
WHERE i.organization_id = @organization_id::uuid
  AND (i.login_identifier = @identifier::text
       OR lower(i.email) = lower(@identifier::text))
ORDER BY (i.login_identifier = @identifier::text) DESC
LIMIT 1
```

Precedence is explicit: an exact `login_identifier` match wins over an email match. The two
columns are each unique per organization but their union is not, so the ordering is what makes
the result deterministic rather than arbitrary.

**New validation rule**: `login_identifier` MUST NOT contain `@`. Enforced at
`CreateOrgAccount`, this removes the only way the union can collide.

### `iam.credential` (org-distributed)

Unchanged in shape. Newly written for owner identities, which previously never had a PIN row.

| Field | Rule |
|---|---|
| `credential_type` | `pin` |
| `state` | `active` when the owner sets their own PIN; `temporary` when an admin creates a worker |
| `expires_at` | `now() + 3 days` for temporary; NULL for active |

**State transitions** (existing, now exercised by a new actor):

```
(none) ──SetPIN, owner──────────────► active
(none) ──CreateOrgAccount──► temporary ──SetPIN w/ pin_change_token──► active
active ──SetPIN w/ current_pin──────► active (rotated; old revoked)
active ──ResetOrgAccountCredential──► revoked, new temporary issued
```

The third transition is the one that currently proceeds **without** verifying `current_pin`.
See research D7.

### `public.organization`

Unchanged in shape. `subdomain` gains server-side format validation and an availability check;
today it has neither.

**Format rules** (new, previously unenforced):

| Rule | Value |
|---|---|
| Charset | `a-z`, `0-9`, `-` |
| Boundaries | must start and end alphanumeric |
| Length | 3–63 characters |
| Repeats | no consecutive hyphens |
| Reserved | `www`, `api`, `app`, `admin`, `mail`, `static`, `assets` |

**Derivation** from company name: lowercase → transliterate accents → non-alphanumerics to
hyphen → collapse repeats → trim hyphens → truncate to 63 → on collision append `-2`, `-3`, …

`Anna's Café` → `annas-cafe`. `Anna's Café` again → `annas-cafe-2`.

## New client-side state (MMKV, id `tech-office`)

### Remembered sign-in

| Key | Status | Purpose |
|---|---|---|
| `auth.last_subdomain` | exists | Workspace for the known-device screen |
| `auth.last_login_identifier` | exists | Identifier submitted with the PIN |
| `auth.last_email` | exists | Email sign-in prefill |
| `auth.last_display_name` | **new** | Shown on the known-device screen so the user recognises rather than recalls |

Written together after a successful PIN login; cleared together by "Not you?" and by logout.
Partial state is treated as absent — the fresh-device flow renders unless subdomain,
identifier and display name are all present.

`auth.last_display_name` is a convenience cache, not an authority. It is never sent to the
server and never used to identify anyone; the identifier is what authenticates.

### Onboarding progress

| Key | Values |
|---|---|
| `onboarding.step` | `pin` \| `teammate` \| `done` |
| `onboarding.subdomain` | the workspace just created |

Written after registration succeeds, advanced after each step, cleared on `done`. This is what
makes an interrupted owner resume at the PIN step instead of at signup — where retrying would
collide on their own subdomain.

## Validation rules by origin

| Rule | Enforced | Source |
|---|---|---|
| PIN is exactly 6 digits | backend `ValidatePINFormat` + client input mask | existing |
| PIN ≠ DOB (`YYMMDD`/`DDMMYY`/`MMDDYY`) or last 6 phone digits | backend `ComparePINWithPersonalData` | existing |
| PIN confirmation matches | client only | new |
| Temporary PIN expires in 3 days | backend | existing |
| Lockout 3/4/5/6+ → 1/5/15 min/full | backend `checkLockout` | existing |
| Password 8–72 chars | backend bcrypt + client pre-validation | existing, newly surfaced pre-submit |
| Subdomain format | backend | **new** |
| Subdomain available | backend `CheckSubdomainAvailable` | **new** |
| `login_identifier` excludes `@` | backend `CreateOrgAccount` | **new** |
| `current_pin` on voluntary change | backend `SetPIN` | **new** |

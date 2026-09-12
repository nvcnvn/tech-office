# Contract: `seed-demo-org` command surface

**Branch**: `055-seed-demo-workspace`

The only interface this feature exposes is a developer CLI command and the document a human
copies into App Store Connect and Play Console. No RPC is added, removed or changed, so
there is no `.proto` diff and no client regeneration.

---

## Invocation

```bash
cd backend && go run ./cmd seed-demo-org [flags]
```

## Flags

| Flag | Default | Status | Meaning |
|---|---|---|---|
| `--subdomain` | `demo` | unchanged | workspace address of the demo organization |
| `--owner-password` | `ReviewDemo1!` | unchanged | password for the **primary** self-registered owner |
| `--spare-password` | value of `--owner-password` | **NEW** | password for the spare owner the reviewer deletes |
| `--worker-pin` | `473829` | unchanged | permanent PIN for the demo worker |

`--spare-password` defaulting to `--owner-password` keeps the reviewer notes to one password
unless somebody deliberately wants two.

## Exit codes

| Code | When |
|---|---|
| `0` | the workspace exists and holds every row in [data-model.md](../data-model.md) |
| non-zero | any step failed; the message names the step |

## Errors the command must produce rather than swallow

| Condition | Message shape | Requirement |
|---|---|---|
| a demo project has no workflow state in a required category | `demo project OPS has no ritual state in category "overdue"; reseed the project` | FR-018 |
| the organization has no role with `source_default_role_id = 'owner'` | `find demo owner role: …` | FR-001 |
| the spare owner cannot be created | `create spare demo owner: …` | FR-001 |

The existing tolerated failure — the calendar entry, which prints `note: skipped demo
calendar entry (…)` and continues — stays tolerated. Nothing added by this feature is
tolerated: a half-shaped workspace reaching a reviewer is the failure this feature exists to
prevent.

---

## stdout contract (FR-021)

Three credential blocks, in this order, after the existing workspace header:

```
  PRIMARY credential — give this to a reviewer first.
  …
    Email    : owner@demo.demo.invalid
    Password : ReviewDemo1!

  SPARE credential — this is the one to delete.
  Deleting it demonstrates in-app account deletion end to end and leaves the
  workspace and the primary credential usable.
    Email    : spare@demo.demo.invalid
    Password : ReviewDemo1!

  SECOND credential — an admin-provisioned worker, to show the other path.
  …
    Workspace : demo
    Login ID  : demo-worker
    PIN       : 473829
```

Asserted properties:

- `PRIMARY credential` appears before `SPARE credential`, which appears before
  `SECOND credential`.
- Exactly one block contains the phrase `the one to delete`.
- Every credential the workspace holds is printed. A credential that exists but is not
  printed is the failure mode this contract exists to prevent.

---

## Idempotency contract

Running the command twice against the same `--subdomain`, with no other change, leaves:

| Count | Value |
|---|---|
| `public.organization` with that subdomain | 1 |
| active `organization.employee` | 3 |
| employees holding the `owner` role | 2 |
| `chat.message` in `site-updates` | 6 |
| `collaboration.project` | 2 (`GEN`, `OPS`) |
| `collaboration.task` `task_kind='standard'`, `is_deleted=false` | 6 |
| `collaboration.task` `task_kind='ritual_instance'`, `is_deleted=false` | 2 |
| `collaboration.ritual_definition` | 1 |

The second run prints `Reusing existing demo workspace`.

After the spare owner has been deleted, a further run restores all of the above, with the
anonymised tombstone employee additionally present and `is_active = FALSE` (FR-006).

---

## Reviewer-notes contract

`docs/compliance/reviewer-notes.md` after this feature:

- lists **three** credentials in one table each, primary first (FR-008);
- names **exactly one** of them as the account to delete, and says so in both the credential
  section and `### Account deletion` (FR-002, FR-008);
- leaves `### Permissions` and `### Not requested` untouched, so
  `make check-store-manifest` continues to exit `0` (research R12);
- still opens with the regeneration command and the idempotency sentence.

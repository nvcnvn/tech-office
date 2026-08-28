---
description: "Update docs/domain/ living snapshots to match implemented behaviour"
---

# Update Domain Snapshots

Bring `docs/domain/` back in line with what the code now does. Runs as an `after_implement`
hook, so by the time it executes the implementation is complete and the integration suite
has passed — the snapshot records **verified** behaviour, never intent.

Governed by Constitution principle XII (Living Documentation & Architecture Documentation
Maintenance).

## Scope check — skip fast when nothing applies

Determine what the change actually touched:

```sh
git diff --name-only HEAD
```

If the change touched **none** of the following, report "no snapshot update required" and stop:

- `backend/rpc/**` — an RPC surface changed
- `backend/database/scripts/schema.sql` or `backend/database/migrations/**` — a constraint, table, or column changed
- `backend/internal/**` — behaviour, a background job cadence, or a cross-domain call changed
- `frontend/apps/**` or `frontend/packages/**` — a client surface or shared contract changed

A pure refactor with no observable behaviour change does not need a snapshot update. Say so
rather than editing the documents to prove you ran.

## Map changed files to documents

| Changed area | Document |
|---|---|
| `internal/iam`, `rpc/v1/iam.proto` | `docs/domain/auth-identity.md` |
| `internal/organization`, `internal/department` | `docs/domain/organization-people.md` |
| `internal/chat`, `rpc/v1/chat*.proto` | `docs/domain/chat.md` |
| `internal/voice` | `docs/domain/voice.md` |
| `internal/notification` | `docs/domain/notifications-presence.md` |
| `internal/collaboration` | `docs/domain/rituals-tasks.md` |
| `internal/docs` | `docs/domain/docs-knowledge.md` |
| `internal/files` | `docs/domain/files.md` |
| `internal/calendar` | `docs/domain/calendar.md` |
| `internal/linking`, `internal/preference`, `frontend/apps/**` | `docs/domain/workspace-navigation.md` |
| `cmd/`, `internal/interceptor`, `database/`, migrations | `docs/domain/platform.md` |

A change often touches more than one. Update every document it touches, not just the
primary one — a new notification type changes both the publishing domain's document and
`notifications-presence.md`.

## Rules

1. **Read the document first**, then the diff. You are editing a description of the present
   tense, not appending a changelog entry.
2. **Delete superseded behaviour.** Do not write "previously X, now Y", do not leave the old
   paragraph with a strikethrough, and do not add a "Changes in NNN" section. If the old
   behaviour is gone, the sentence describing it goes with it.
3. **No feature numbers as the subject.** Write what the system does; a spec number may
   appear as a parenthetical provenance note at most.
4. **Refresh the `Status date:` line** of every document you edit.
5. **Reconcile the drift register** in `docs/domain/README.md`:
   - delete the row for any inconsistency this change fixed
   - add a row for any inconsistency you found and did **not** fix, with severity, location
     and a one-line summary
6. **Verify against the code, not the spec.** If the spec and the implementation disagree,
   the implementation is what gets documented, and the disagreement becomes a drift row.
7. Keep the existing structure and tone of each document. Do not restructure a document as
   a side effect of a small behaviour change.
8. If the change added a whole new domain, create a new `docs/domain/<domain>.md`, add it to
   the index table in `docs/domain/README.md`, **and** add it to the document table in
   Constitution principle XII.

## Also check `backend/docs/`

Principle XII covers both document sets and they are not interchangeable. If the change
altered the tier model, a cross-domain dependency, server initialization order, an FK
relationship, or the notification delivery pipeline, update the relevant
`backend/docs/*.md` too.

## Report

State plainly:

- which documents were updated, and what changed in each
- which drift rows were removed and which were added
- anything you could not verify, so the next reader knows what is uncertain

Do not report "documentation updated" without naming the files.

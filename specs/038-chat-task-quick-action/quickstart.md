# Quickstart: Create a Task from a Chat Message

How to bring the change up locally and prove it works. Schema details are in
[data-model.md](./data-model.md), the RPC surface in
[contracts/collaboration-proto.md](./contracts/collaboration-proto.md), and the scenarios
these commands run in [contracts/test-scenarios.md](./contracts/test-scenarios.md).

## Prerequisites

- Go 1.27, Node with pnpm, Docker (for PostgreSQL), `buf` for proto generation
- Maestro plus a running simulator or device, only for the mobile flow

## 1. Infrastructure and schema

```bash
make infra-up                                    # PostgreSQL + supporting services
cd backend && DATABASE_URL=... ./scripts/migrate.sh
./scripts/regen-schema.sh                        # regenerates database/scripts/schema.sql
```

`schema.sql` is a generated snapshot. Never hand-edit it — the next regeneration silently
discards the edit.

Then, from the repo root:

```bash
make lint-tenancy
```

This must pass before anything else is worth running. It parses the regenerated snapshot and
every `*.query.sql` with the real PostgreSQL parser and fails on a unique key that does not
lead with `organization_id`, a single-column foreign key into a tenant table, or a join
missing `organization_id`. Both new foreign keys on `collaboration.task` and the
`(organization_id, channel_id)` primary key on `channel_task_destination` are exactly what it
checks.

## 2. Generate code

```bash
cd backend && buf generate                       # proto → Go + TypeScript
sqlc generate                                    # queries → typed Go
```

`CreateTaskRequest.level_id` becoming optional changes its generated Go type from `string` to
`*string`. Every existing caller needs the one-line adjustment; that compile break is the
intended signal, not a problem to work around.

## 3. Run the backend and clients

```bash
cd backend && go run ./cmd                       # backend
cd frontend && pnpm --filter web dev             # web
cd frontend && pnpm --filter mobile start        # mobile (Expo)
```

## 4. Validate

### Backend behavioural contract

```bash
make test-backend-one T=TestChatTaskCapture
```

Reading the verbose output is the point — the `t.Run` names are the behavioural contract, so
`go test -v` should read like the scenario list. Then run the suites that D5 and D6 touch:

```bash
make test-backend-one T=TestTaskLifecycle
make test-backend-one T='TestCollaborationTask|TestRitualInstance'
make test-backend-one T=TestCollaborationConstants
make test-backend                                # full suite before calling it done
```

`TestChatTaskCapture` passing on its own is not sufficient. D6 changes when *every* task gets
its chat channel and description document, so the lifecycle and ritual-instance suites are
the regression net for the rest of the system.

### Web

```bash
make test-frontend-one F=chat-task-capture
make test-frontend-one F=task-lifecycle          # D6 regression
```

### Mobile

```bash
make test-mobile-one F=chat-task-capture
```

## 5. Manual walkthrough

Worth doing once by hand — the UX decisions in this feature are about how few taps it takes,
which no assertion measures.

1. Open a channel with at least two messages, one of them mentioning a colleague.
2. Hover a message (web) or long-press it (mobile) and choose **Create task**.
   The title should already hold the message text; the project picker should be **expanded**,
   because this channel has no remembered destination yet.
3. Pick a project and confirm. Check three things at once: the task chip appears on the
   message, a reply appears in that message's thread naming the task, and the mentioned
   colleague — if you left them as assignee — got an assignment notification while the message
   author got nothing.
4. Convert a second message in the same channel. The project should now be pre-filled and
   collapsed to one line. **This should be two interactions total** — that is SC-002, and it
   is the whole argument for the per-channel memory.
5. Open the task. Its origin block should name the channel and author and show the excerpt;
   the origin link should return you to the conversation with the source message highlighted.
6. Open the task's comment thread. It is created at this moment, not at conversion (D6) — a
   task nobody opens has no channel.
7. Archive the destination project and open the sheet again in that channel: the picker should
   be expanded again with a one-line explanation, not an error on confirm.
8. Sign in as someone without access to that project and look at the same message: **no chip**.

## Common problems

| Symptom | Cause |
|---|---|
| Server panics on task creation | `CreateTask` still parses `level_id` with `dbuuid.MustParse`, which panics on an empty string. The default path in D5 must run before the parse. |
| Task detail shows no comment thread | Expected before first open — D6 made provisioning lazy. If it never appears, `EnsureTaskResources` still has its `TaskKindRitualInstance` gate. |
| Announcement notifies the channel | `AnnounceTaskCreatedFromMessage` is calling `broadcastNewMessage` or reusing `SendMessage`. It must write the row directly, as `createVoiceSystemMessage` does. |
| `make lint-tenancy` fails on the new table | A foreign key was written as single-column `REFERENCES … (id)` instead of the composite `(organization_id, id)`. |
| Chip missing for a project member | `ListTasksBySourceMessages` filters by project access; confirm the viewer's project membership before suspecting the query. |
| Chip visible to a non-member | The chip is being rendered from the announcement's chat metadata instead of the collaboration RPC. Chat metadata is readable by every channel member — see D3. |

## Definition of done

- `make lint-tenancy` passes
- `make test-backend` passes in full, not just the new test
- `make test-frontend` passes
- `make test-mobile-one F=chat-task-capture` passes
- `docs/domain/rituals-tasks.md` and `docs/domain/chat.md` updated in this change set — the
  eager-to-lazy resource change also corrects what `rituals-tasks.md` currently implies about
  where task channels come from (Constitution XII, enforced by the `speckit.docs.snapshot`
  hook after implement)

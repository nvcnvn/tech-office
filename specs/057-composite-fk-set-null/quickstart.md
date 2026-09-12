# Quickstart: validating the composite-foreign-key fix

**Feature**: `057-composite-fk-set-null`

Five checks, in the order they will fail if something is wrong. Details of what each
constraint becomes are in [`data-model.md`](./data-model.md); what the database promises is
in [`contracts/referential-actions.md`](./contracts/referential-actions.md).

## Prerequisites

```bash
cd backend && cp .env.example .env             # if not already present
cd backend && docker compose up -d postgres    # postgres:18 on :15432
export DATABASE_URL='postgres://postgres:tech_office_password@localhost:15432/tech_office_db?sslmode=disable'
```

---

## 1. Apply the migration and regenerate the snapshot

```bash
cd backend && ./scripts/migrate.sh && ./scripts/regen-schema.sh
git diff --stat backend/database/scripts/schema.sql
```

**Expect**: the migration applies cleanly, and the regenerated snapshot shows exactly five
constraint lines changed and one `CHECK` line removed. `schema.sql` is generated — if the
diff is empty, `regen-schema.sh` did not run; never edit it by hand.

Confirm the column list survived the dump, which is what the linter will read:

```bash
grep -E 'fk_task_source_(message|channel)|fk_channel_membership_last_viewed|fk_voice_message_message' \
  backend/database/scripts/schema.sql
```

**Expect**: `ON DELETE SET NULL (source_message_id)`, `ON DELETE SET NULL
(source_channel_id)`, `ON DELETE SET NULL (last_viewed_message_id)`, `ON DELETE CASCADE`.
No bare `ON DELETE SET NULL` anywhere in the file.

## 2. The linter enforces the rule and passes on the fixed schema

```bash
make lint-tenancy
```

**Expect**: `OK — tenancy discipline holds`, and the unit tests green. The table-driven
cases in `backend/tools/tenancylint/main_test.go` cover Story 3's five scenarios —
bare composite `SET NULL` rejected, column-list form accepted, a column list naming
`organization_id` rejected, a single-column `SET NULL` on a global table accepted, and the
real `schema.sql` clean.

To see the rule bite, temporarily drop the `(source_message_id)` from the snapshot and
re-run — it must fail and name `fk_task_source_message`. Restore with
`git checkout backend/database/scripts/schema.sql`.

## 3. A message a task was made from can be hard-deleted (Story 1)

```bash
make test-backend-one T=TestChatTaskCapture
```

**Expect**: green, including the new cases in
`backend/integration/chat_task_capture_test.go`:

- create a task from a message, hard-delete the message, the delete returns no error;
- the task still exists with its original `organization_id`, `identifier`, `title`,
  `project_id` and state, and `source_message_id` is now `NULL`;
- `GetTaskOrigin` returns `has_origin: false`, and the task's proto carries **neither**
  origin field;
- two tasks from the same message both survive;
- deleting the channel succeeds and leaves both tasks intact with both origin columns
  `NULL`;
- a member's `last_viewed_message_id` pointing at the message, and a posted voice message
  attached to it, neither block the delete;
- a task that never had an origin is untouched throughout.

The channel-delete case is the one that catches a re-introduced CHECK: the channel half is
nulled before the message cascade, so any constraint relating the two columns fails there
and only there.

## 4. The demo seed re-runs against a used workspace (Story 2)

```bash
cd backend && go run ./cmd/seed-demo-org --subdomain demo    # first run
```

Then exercise it the way a reviewer does — sign in as the demo worker, open the demo
channel (sets a last-viewed pointer), convert the rude message to a task via the chat quick
action, and record a voice message in the channel. Then:

```bash
cd backend && go run ./cmd/seed-demo-org --subdomain demo    # second run
```

**Expect**: exit 0. The demo channel holds exactly the six fixture messages, once. The task
the reviewer created survives without an origin. This is the promise
`docs/compliance/reviewer-notes.md` already makes to Apple and Google, and it is false
before this feature.

## 5. Nothing shows a dangling origin (SC-005)

```bash
make test-frontend-one F=chat-task-capture
```

**Expect**: green. Both clients gate the origin block on `sourceMessageId` alone
(`frontend/apps/web/.../tasks/[taskId]/page.tsx`,
`frontend/apps/mobile/.../task/[taskId].tsx`), so no frontend change ships with this
feature — the E2E run is confirming that remains true, not testing new UI.

---

## Full gate before opening the PR

```bash
make lint-tenancy && make test-backend && make test-frontend
```

Plus the documentation half of the Definition of Done: `docs/domain/rituals-tasks.md` must
describe what a **hard** delete now does to a task's origin — today it only documents the
soft-delete case — and the `docs/domain/README.md` drift register must be reconciled.

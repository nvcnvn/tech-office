# Quickstart: Store Compliance Sweep

How to run and validate this feature once implemented. Details of tables live in
[data-model.md](data-model.md) and of RPCs in [contracts/](contracts/); this file is the run
guide.

## Prerequisites

```bash
# Backend: DATABASE_URL pointing at a Citus-enabled Postgres
cd backend && ./scripts/migrate.sh          # applies 20260827000001_store_compliance.up.sql
make dev                                     # or the usual backend run target
```

```bash
# Frontend
pnpm install
pnpm --filter web dev                        # web on :3000
pnpm --filter mobile start                   # Expo dev server
```

## Seed the demo workspace

The same command produces the reviewer's workspace and a usable local fixture. It is idempotent
— re-running it refreshes content without creating a second organization.

```bash
cd backend && go run ./cmd seed-demo-org --subdomain demo
```

Prints two credential sets: a self-registered owner (the reviewer's **primary** credential,
because it is the only one whose settings screen shows the full deletion path) and a PIN worker
with a **permanent** PIN. A temporary PIN would expire in three days and be dead before a
reviewer reached it — see [research.md](research.md#r12).

## Validate each slice

### Account deletion

```bash
go test ./integration/ -run TestAccountDeletion -v
go test ./integration/ -run TestRemovalRequest -v
```

Manually: sign in as the demo owner on web, open settings, delete the account. Expect the
confirmation to name what is erased and retained, then an immediate signed-out state. Sign in
as a second owner of the same workspace afterwards and confirm the deleted person's messages
are still readable but no longer carry their name.

To see the sole-owner refusal, create a workspace with one owner and one employee, then attempt
deletion as the owner — the error should list that workspace by name, not just refuse.

### Legal surface

```bash
curl -sf http://localhost:3000/privacy/ >/dev/null && echo "privacy OK"
curl -sf http://localhost:3000/terms/ >/dev/null && echo "terms OK"
pnpm --filter web exec playwright test legal-surface
```

Both must return 200 while signed out. Then attempt signup without ticking acceptance and
confirm it is refused.

### Reporting and blocking

```bash
go test ./integration/ -run TestContentReporting -v
go test ./integration/ -run TestBlocking -v
pnpm --filter web exec playwright test compliance-report compliance-block
```

Manually, with two accounts in the demo workspace: report a message as one, then confirm as an
owner that it appears in the review queue with its content snapshot. Delete the original message
and confirm the report is still reviewable — that is the FR-018 behaviour that a foreign key
alone would not give you.

For blocking, confirm the asymmetry deliberately: direct conversations and calls are refused,
but the blocked person's messages in a shared channel remain visible. That is the agreed scope,
not a gap.

### Permission manifest

```bash
cd frontend/apps/mobile
npx expo prebuild --clean --platform all
node scripts/check-store-manifest.js
```

The script fails the build on any unexpected permission, any background-location key, a missing
Android notification permission, or a permission string that still reads like a framework
default. Run it after any dependency change — transitive libraries are how
`SYSTEM_ALERT_WINDOW` arrived in the first place.

To confirm the Android notification fix is real rather than declarative, install a release build
on a device running Android 13 or later, grant the notification permission when prompted, and
send a message from another account. Push does not arrive today; it must after this change.

### Full suites before calling it done

Constitution Principle II: the entire suite passes, not only the new tests.

```bash
cd backend && go test ./integration/...
pnpm --filter web exec playwright test
make test-mobile
```

## Submission checklist

Everything above is code. These are the human steps that make it a submission.

1. `docs/compliance/data-collection-inventory.md` reviewed and current.
2. Both stores' privacy forms completed from that inventory, agreeing with the published policy.
3. `docs/compliance/permission-justifications.md` pasted into the submission forms where each
   store asks.
4. `docs/compliance/reviewer-notes.md` copied into App Review notes and Play's testing
   instructions, including:
   - the self-registered owner credential first, and why it is first;
   - the PIN worker credential second, with the workspace address, and why its deletion path
     differs;
   - a sentence stating that blocking is scoped to direct contact because this is a closed
     workplace tool — otherwise a reviewer testing a block inside a shared channel will read the
     visible messages as a missing feature.
5. Age-rating questionnaire answered honestly about person-to-person messaging.
6. `docs/domain/compliance-safety.md` written and the `docs/domain/README.md` index updated, per
   Constitution XII and the mandatory `speckit.docs.snapshot` hook.

# Quickstart: Validating the Reserved-Value Prune

**Feature**: 062-prune-reserved-values

Runnable checks that prove the feature works end to end. Each maps to a user story and a
success criterion. Details of *what* changed are in [data-model.md](data-model.md) and
[contracts/](contracts/); this file is how you run it.

## Prerequisites

Use the repository's supported tooling — Makefile targets and `backend/docker-compose.yml`
— rather than improvising a local setup.

```bash
cd /Volumes/T5/Codes/tech-office
make infra-up                     # Postgres and supporting services for the backend suite
make check-postgres               # confirm it is reachable
cd frontend && pnpm install && pnpm --filter "./packages/*" run build
```

The `packages/*` build is not optional: every workspace package points `types` at a
gitignored `dst/`, so a typecheck on a clean tree fails with dozens of
`Cannot find module` errors without it (drift D34).

## Setup — apply the migration and regenerate

```bash
cd backend
./scripts/migrate.sh up              # applies 20260912000003_prune_reserved_values
./scripts/regen-schema.sh            # regenerates database/scripts/schema.sql
sqlc generate                        # regenerates database/models.go
buf generate                         # regenerates rpc/v1/*.pb.go and frontend/packages/rpc
```

**Expected**: the migration completes silently. Any `RAISE EXCEPTION` names a table, a
value and a row count — that means a stored record holds a value this change removes, and
it must be dealt with by hand before re-running. See
[contracts/migration.md](contracts/migration.md#audit-dispositions).

## Scenario 1 — the storage layout has no empty areas (US3, SC-004)

```bash
psql "$DATABASE_URL" -c "
SELECT n.nspname
FROM   pg_namespace n
WHERE  n.nspname NOT LIKE 'pg\_%'
  AND  n.nspname NOT IN ('information_schema','public')
  AND  NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = n.oid);"
```

**Expected**: zero rows. A count of remaining schemas returns **11**, down from 24.

```bash
psql "$DATABASE_URL" -c "
SELECT count(*) FROM pg_namespace
WHERE nspname NOT LIKE 'pg\_%' AND nspname NOT IN ('information_schema','public');"
```

The same property is asserted by the new integration test so it does not decay:

```bash
make test-backend  # includes the no-empty-schema assertion
```

## Scenario 2 — every permitted value has a producer (US3, SC-001)

```bash
psql "$DATABASE_URL" -c "
SELECT conname, pg_get_constraintdef(oid)
FROM   pg_constraint
WHERE  conname IN ('valid_channel_type',
                   'file_access_rule_context_type_check',
                   'credential_credential_type_check',
                   'notification_source_domain_valid',
                   'muted_domains_valid');"
```

**Expected**, per [data-model.md](data-model.md): channel type 3 values, file context 4,
credential type 1, source domain 5, muted domains a subset of the same 5. Cross-check each
against its Go constant and TypeScript union — they are listed per set in
[contracts/typescript-types.md](contracts/typescript-types.md). No value should appear in
one layer and not another; that is FR-008.

## Scenario 3 — notification categories (US1, SC-002, FR-013)

The cross-layer alignment scenario that FR-013 requires must stay green over five values:

```bash
cd backend
go test ./integration -run 'TestNotificationPersonalPreference' -v
```

**Expected**: `every source domain the system publishes from can be muted` passes,
iterating five domains instead of nine. This test is the guard that stops
`allSourceDomains` and the `muted_domains` CHECK drifting apart — the exact failure that
produced drift D28.

Then the mobile screen. There is **no web mute list** — `SOURCE_DOMAINS` has only one app
consumer — so US1's web leg is satisfied vacuously; see
[research.md](research.md#14-notification-source-domains--crm-hr-support-finance).

```bash
cd frontend && pnpm run typecheck:mobile
```

**Expected**: zero diagnostics. `MUTE_ROWS` is `Record<SourceDomain, …>`, so a leftover
`crm`/`hr`/`support`/`finance` key fails here rather than on a device.

Then open the app and check by hand (mobile is the owner's day-to-day surface, and the
habitual test device is an iPhone SE — verify on a narrow Android viewport too):

```bash
cd frontend && pnpm --filter mobile run ios      # or: pnpm --filter mobile run android
```

Both resolve the LAN IP through `scripts/with-lan-ip.sh`, so the same command works for
either platform.

Navigate to **More → Settings → notification mutes**. **Expected**: exactly five rows —
Chat, Tasks and projects, Calendar, Documents, System. Toggle one and confirm a
notification the workspace genuinely sends in that category is suppressed.

**Preservation check (FR-010)**: before migrating, set a mute on a removed category for a
test person; after migrating, reopen preferences. **Expected**: the screen loads without
error and any surviving mute is still on.

## Scenario 4 — workspace navigation (US2, SC-003)

```bash
cd frontend && pnpm --filter web run dev
```

Sign in, open `/workspace`. **Expected**: eight entries, all of them openable, shortcuts
`⌘1`–`⌘8` with no gap and no dead key. No greyed-out CRM, Finance or HR.

Automated:

```bash
make test-frontend  # includes the assertion that every nav entry is enabled and reachable
```

If the run is on a cold `.next` cache, expect unrelated flakes from drift D54 — a warm
cache is the reliable configuration, and `NEXT_DIST_DIR=.next-e2e` keeps the E2E server
from fighting a running dev server over compiled routes.

## Scenario 5 — shared links (US4, SC-005)

```bash
cd backend
go test ./integration -run 'TestCanonicalLinks' -v
```

**Expected**: canonical links for task, document, channel and calendar event resolve
exactly as before; a legacy-shaped URL is now **rejected**. The former
`when a legacy product link is normalized` subtest is gone — per FR-012 a check that
outlives its subject is a false gate — and is replaced by a rejection assertion, which is a
real requirement rather than a tautology.

By hand, on both clients: share a link from each of the four item types and open it.
**Expected**: each resolves. Then paste a legacy shape such as
`https://acme.example.com/chat/{channelId}`. **Expected**: the standard
"link not recognised" outcome — not a crash, not a blank screen, and not a silent
resolution.

Inspect a resolved payload. **Expected**: no `legacyNormalized` key. The concept is gone,
not defaulted to false.

## Full gate (SC-006)

```bash
make test-backend
make test-frontend
cd frontend && pnpm run typecheck:mobile
```

**Expected**: all green, with no reduction in the number of checks covering surviving
behaviour. Exactly one test is deleted — the legacy-link subtest — and it is replaced by a
rejection assertion in the same file, so the count does not fall.

Two known conditions are *not* caused by this change and should not be read as regressions:
`make test-backend` is load-dependent under `-parallel 8` (D52), and the web suite's
cold-cache compile race (D54). Both predate this feature and neither touches a surface it
modifies.

## Documentation check (SC-007, FR-014)

```bash
cd /Volumes/T5/Codes/tech-office
grep -rniE 'crm_deal_notes|support_ticket|crm_deal|biometric|legacyNormalized|normalizeLegacyRoute' docs/domain/
```

**Expected**: no hit describes current behaviour. The three open questions this work answers
are removed rather than annotated — `chat.md` (reserved channel types), `platform.md`
(reserved schemas), `workspace-navigation.md` (legacy route normalisation) — and
`platform.md`'s incorrect claim that `compliance` is unused is corrected, because it holds
four objects.

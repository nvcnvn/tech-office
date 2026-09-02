# Quickstart: Feature Tour

How to run this feature and prove it works. Commands are run from the repository root unless
stated otherwise.

## Prerequisites

- PostgreSQL 18 running, `DATABASE_URL` exported (`backend/docker-compose.yml` brings it up)
- Backend and both frontend apps installed per the repository's normal setup

## Applying the schema change

```bash
cd backend
./scripts/migrate.sh                 # applies 20260902000001_feature_tour.up.sql
./scripts/migrate.sh status          # confirm the version advanced
./scripts/regen-schema.sh            # regenerate database/scripts/schema.sql — never hand-edit it
sqlc generate                        # after tour.query.sql exists
```

Then, from the repository root:

```bash
make lint-tenancy                    # must be green — the new table is a tenant table
```

## Regenerating the proto

`backend/rpc/v1/tour.proto` is new, so both the Go stubs and the TypeScript client need
regenerating through the repository's normal buf/protoc pipeline before either side compiles.

## Running it

```bash
make dev                             # or the individual backend / web / mobile targets
```

Then:

1. **Administrator tour on web.** Register a new organization at `/signup`, sign in, and land
   in `/workspace`. The tour is offered. Walk it: six cards, each with an action that
   navigates to a real surface, a visible position indicator, and a dismiss control on every
   card.
2. **Worker tour on mobile.** Create an org-managed account for the same workspace, sign in
   on the device with the account ID and PIN. Four cards, plainer language, no administrative
   stops.
3. **Administrator tour on mobile.** Sign in as the owner on the device. The tour is offered,
   and the "Get your team in" stop says the work is done on the web and shows no action
   button — the FR-023 behaviour that is easiest to get wrong.
4. **Cross-platform memory.** Complete the tour on web, then open the mobile app as the same
   person. It is not offered again.
5. **Replay.** On web, User menu → Take the tour. On mobile, More → App → Take the tour.

## Validating

```bash
make test-backend-one T=TestFeatureTour        # the behavioural contract
make test-backend                              # full suite must stay green
```

Web E2E, from `frontend/apps/web` — note the working invocation, not the broken Makefile
target recorded as D36 in the drift register:

```bash
npx playwright test --config=e2e/playwright.config.ts feature-tour
```

Mobile, with a device or emulator attached:

```bash
cd frontend/apps/mobile
maestro test .maestro/feature-tour/owner-tour.yaml
maestro test .maestro/feature-tour/worker-tour.yaml
```

**Definition of Done** is all three suites green — not just the new tests — plus
`make lint-tenancy`, plus the documentation update below.

## Checking the data directly

```sql
-- what one person has seen
SELECT tour_id, status, current_stop, content_version, updated_at
FROM iam.tour_progress
WHERE organization_id = $1 AND employee_id = $2;

-- SC-002 / SC-004: completion rate per tour
SELECT tour_id, status, count(*)
FROM iam.tour_progress
GROUP BY tour_id, status;
```

An absent row means not-started, by design — reading the tour never writes one.

## Accessibility check (FR-019, SC-006)

Not optional and not covered by walking the UI with a mouse:

- Tab through every stop on web with no pointer. Every control must be reachable, the stop
  position must be announced, and Escape must leave the tour.
- Run the mobile tour with VoiceOver (iOS) or TalkBack (Android) enabled and confirm each
  card is announced with its position.

## Documentation to update before this is done

Constitution XII, and the repository's standing rule that `docs/domain/` is the record of
behaviour:

- `docs/domain/workspace-navigation.md` — a "Feature tour" section covering both tours, the
  server-driven selection, and the web-only stop adaptation
- `docs/domain/README.md` — index row, and a drift-register entry if anything shipped
  differently from this plan

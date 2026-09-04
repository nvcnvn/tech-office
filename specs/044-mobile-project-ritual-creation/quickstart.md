# Quickstart: Validating Create Projects And Rituals On Mobile

How to prove this feature works end to end. Everything below is runnable; nothing here is
implementation. Contracts live in [contracts/](./contracts/), field rules in
[data-model.md](./data-model.md).

---

## Prerequisites

```bash
# Database, then the backend, via the repository's supported tooling
make infra-up
make voice-dev-backend        # backend on :8080; `make check-backend` confirms it

# Metro for the mobile dev client
cd frontend/apps/mobile && pnpm start   # :18082, LAN IP resolved by scripts/with-lan-ip.sh

# A simulator or device with the dev client installed
```

You need **two accounts** in the same workspace:

| Account | Holds | Proves |
|---|---|---|
| Owner / operator | `collab.createProject`, `collab.manageRitualDefinition`, `iam.inviteUser`; `owner` of the seeded project | The happy paths and the administrator tour |
| Plain member | Neither create permission; `member` on the project | US1 scenario 4, US2 scenario 5, US4 scenario 3 — the affordances are absent, not disabled |

`iam.inviteUser` is what selects the administrator tour, so the owner account must hold it
for the tour scenarios.

---

## 1. The headline scenario — a daily ritual from the shop floor (SC-001)

This is the whole feature. Time it: opening the app to seeing tomorrow's run should be under
two minutes.

1. Sign in on the phone as the owner.
2. **Tasks** tab → **Projects** → open the seeded project.
3. Tap **`project-create-ritual-button`**.
4. Name it `Opening checklist`.
5. **Every day**.
6. Confirm the timezone line reads your device's zone, not `UTC` (unless you are in it).
7. In *What it has to prove*: name the first requirement `Fridge thermometer`, tap the
   **Photo** chip, leave Required on.
8. Tap **`create-ritual-submit`**.

**Expect**: you land on the ritual template screen. Back out to the project — the upcoming
runs are listed with no refresh and no wait (FR-014; the first instances commit inside the
create transaction). Open tomorrow's run as an assigned worker and the photo requirement is
there to submit against.

---

## 2. Every recurrence writes the right rule (US1 scenarios 2–3)

Repeat the flow three times and check the generated runs, not just the saved form:

| Recurrence | Set | Expect |
|---|---|---|
| Every week | Monday and Friday | Runs on Mondays and Fridays only |
| Every month | Day 15 | One run on the 15th of each month |
| Every day | — | One run per day |

Cross-check against the web: open the same definition in
`workspace/projects/{id}/rituals/{definitionId}` and confirm the schedule reads identically.
That is SC-003 — same inputs, same runs, either platform.

---

## 3. Nothing is lost on a refusal (SC-006)

Three failures, one property: everything typed stays on screen and the retry is in place.

```bash
# Duplicate key — needs a project that already uses it
# Create a project keyed STORE on the web first, then try STORE on the phone.
```

| Do this | Expect |
|---|---|
| Enter a key already used in the workspace and submit | `project-key-error` says the identifier is taken; **every field keeps its value** |
| Enter `9store` (leading digit) and submit | Refused before any request; the key rule is stated in plain words |
| Pick *Every week*, select no day, submit | Refused in place: "Pick at least one day of the week." |
| Pick *Every month*, select no day, submit | Refused in place: "Pick a day of the month." |
| Turn airplane mode on mid-save | Told the save did not happen; draft intact; retrying once connectivity returns creates exactly one ritual |

The last row is the important one: retry after an ambiguous failure must not produce a
duplicate. There is no optimistic write and no persisted draft, so it cannot.

---

## 4. No dead affordances (SC-005, FR-004, FR-015)

Sign in as the **plain member**:

| Screen | Expect |
|---|---|
| Tasks → Projects | No `projects-create-button` — absent, not greyed |
| A project they are a member of | No `project-create-ritual-button` |
| A ritual template | No `ritual-archive-button` |

Then, as the owner, check the stricter bar bites: on a project where the owner account is a
plain `member` rather than `owner`/`admin`, the add-a-ritual action is absent even though the
workspace permission is held. That is the resource-level rule `ritual_logic.go` enforces,
mirrored client-side.

---

## 5. Undo a mistake (US4)

1. Create a ritual, then open it from the project.
2. Tap **`ritual-archive-button`** → confirm.
3. **Expect**: no further runs are generated; the screen shows
   `ritual-archived-badge` and offers **Restore**.
4. Tap **Restore** → the definition is active again.
5. Confirm no other edit is offered — no rename, no schedule change, no requirement editing
   (FR-018).

---

## 6. The tour stops point somewhere (US3, SC-004)

As the owner on the phone, **More** → **`menu-take-the-tour`**:

| Stop | Expect |
|---|---|
| 1 — people | Still the "done on the web" note, **no** `feature-tour-action` (FR-020) |
| 2 — project | Full web body copy **and** an action button; tapping lands on `create-project` |
| 3 — ritual | Full web body copy and an action; tapping lands on the first project's `create-ritual` |
| 4–6 | Unchanged |

Then the fallback (US3 scenario 4): in a workspace with **no** project — archive the last one
— the ritual stop's action lands on project creation and the card shows
`feature-tour-ritual-fallback-note`.

---

## 7. Automated suites

```bash
# Mobile blackbox — the FR-025 bar
make test-mobile                                   # full suite, zero failures
make test-mobile-one F=projects/create-project
make test-mobile-one F=rituals/create-ritual
make test-mobile-one F=rituals/archive-ritual
make test-mobile-one F=feature-tour/owner-tour     # updated: two stops gained an action

# Backend integration
make test-backend                                  # includes the new atomic-create case
make test-backend-one T=TestRitualDefinition

# Cross-stack type check — the Principle VIII drift guard
cd frontend && pnpm typecheck:mobile && pnpm --filter web exec tsc --noEmit
```

The `tsc` run is not a formality here. `TOUR_ROUTES` is a `Record<TourTarget, …>`, so the
route map cannot drift from the proto without failing the build, and the shared
`projectKeySchema` means the web page and the mobile form cannot disagree about what they
will submit.

---

## 8. The 360dp check (SC-007, FR-024)

Run **on Android as well as iOS** — the habitual test device is an iPhone SE, which hides
narrow-Android regressions.

```bash
# Android emulator at 360dp
adb shell wm size 360x800
adb shell wm density 160
```

Walk both create screens and confirm: nothing clipped, nothing overlapping, every control
reachable, tap targets at least 44dp. The three to look at hardest are the seven-segment
weekday row, the 31-chip day-of-month grid, and the seven proof-type chips.

Reset with `adb shell wm size reset && adb shell wm density reset`.

---

## 9. Definition of Done — the documentation gate (FR-023, SC-008)

The feature is not done until no document still claims mobile cannot do this:

```bash
# Should return nothing that asserts the absence
rg -n "no create surface|creates neither|has no create surface" docs/ specs/
```

Specifically confirm:

- `docs/domain/README.md` — **D38 closed**
- `docs/domain/workspace-navigation.md` — one web-only stop, not three
- `docs/domain/rituals-tasks.md` — mobile creates and archives definitions; pools, procedure
  attachment and auto-approval still recorded as web-only
- `specs/039-feature-tour/contracts/tour-content.md` — stops 2 and 3 rewritten per
  [tour-content-delta.md](./contracts/tour-content-delta.md)
- `specs/mobile-ui-design.md` §9 — framing corrected
- `.specify/memory/constitution.md` — **Principle XIII amended** (FR-027), version bumped,
  sync impact report updated. Without this the repository contradicts itself, and it is the
  one gate that must land before or with the code rather than after.

# Contract: Tour content delta

The tour's copy is its whole user-visible surface, so the wording change is stated here in
full rather than described. This is the delta to
`specs/039-feature-tour/contracts/tour-content.md`, which must be edited to match in the same
change set (FR-023).

**`content_version`**: `"2026-09-02.1"` → `"2026-09-04.1"`. The body two of six administrator
stops show on a phone changes, and `content_version` records which wording a person actually
saw.

---

## Stop 2 — `project`

### Before

```
- Target: TOUR_TARGET_PROJECTS · Action: Create a project
- Required permission: collab.createProject
- FR-013a: the route must land with project creation visible …
- **Web-only.** Mobile note: "Projects are set up on the web app — open TechOffice on a
  computer to create your first one. You will see the work here on your phone once it
  exists." Target becomes TOUR_TARGET_NONE; no action button. (FR-023)
```

### After

```
- Target: TOUR_TARGET_PROJECTS · Action: Create a project
- Required permission: collab.createProject
- FR-013a: the route must land with project creation visible — not on a project list that
  is empty in exactly the workspace this stop is written for. Web: /workspace/projects?create=1.
  Mobile: /(app)/(tasks)/create-project.
- **Available on both platforms** (feature 044). The mobile note is deleted with the flag.
```

**Body copy: unchanged.** A mobile administrator now sees the same 39 words a web
administrator sees, which is what FR-019 asks for.

---

## Stop 3 — `ritual`

### Before

```
- Target: TOUR_TARGET_RITUALS · Action: Define a ritual
- Required permission: collab.manageRitualDefinition
- FR-013a: rituals live inside a project … routes to project creation and says so …
- **Web-only.** Mobile note: "Rituals are defined on the web app. Once one is set up, the
  runs land on your phone and you can approve the evidence from here." Target becomes
  TOUR_TARGET_NONE; no action button. (FR-023)
```

### After

```
- Target: TOUR_TARGET_RITUALS · Action: Define a ritual
- Required permission: collab.manageRitualDefinition
- FR-013a: rituals live inside a project, and a brand-new workspace has none. When there is
  no project yet, this stop routes to project creation and says so, on both platforms.
  Web: /workspace/tasks/{firstProjectId}?view=settings&tab=rituals, falling back to
  /workspace/projects?create=1.
  Mobile: /(app)/(tasks)/{firstProjectId}/create-ritual, falling back to
  /(app)/(tasks)/create-project.
- **Available on both platforms** (feature 044). The mobile note is deleted with the flag.
```

**Body copy: unchanged.** It is the 56-word body, the one with no room left under FR-005's
60-word cap. It is not edited here, so the length table in `tour-content.md` does not need
re-measuring.

---

## Stop 1 — `people`

**Unchanged**, and deliberately so (FR-020, US3 scenario 6). Keeps `WebOnly: true` and keeps
its note verbatim:

> "Adding staff, importing a team and setting roles are done on the web app — open TechOffice
> on a computer when you have a moment."

---

## The review-notes section of `tour-content.md`

The paragraph beginning "**Three stops are web-only: `people`, `project` and `ritual`**" is
replaced. It currently reads as a record of a decision that has now been reversed, and the
Definition of Done requires behaviour that no longer exists be deleted rather than annotated:

> **One stop is web-only: `people`.** Adding staff, importing a team and setting roles have
> no mobile surface and are not planned to gain one. `project` and `ritual` were web-only
> between features 039 and 044 because the mobile app had no create surface for either;
> feature 044 built both, and clearing the flag was the one-field change this note predicted.

The paragraph beginning "**Three administrator stops describe things a new workspace does not
have**" stays: it is still true, and its observation that the ritual stop's route is the one
conditional destination in the tour is now true on two platforms rather than one.

---

## Corresponding code and test changes

| File | Change |
|---|---|
| `backend/internal/tour/content.go` | `WebOnly: false` and `MobileNote` deleted on `project` and `ritual`; `ContentVersion` bumped |
| `backend/internal/tour/logic.go` | **None.** The substitution rule is correct; only its inputs change |
| `backend/integration/feature_tour_test.go` | `webOnly` narrows from `{people, project, ritual}` to `{people}`. The "each web-only stop carries no target and no action label" sub-test then covers one stop, and a new sub-test asserts `project` and `ritual` arrive on mobile with their web body, their action label and their target intact |
| `frontend/apps/mobile/src/lib/tour-routes.ts` | Both targets routed; `ritualRouteFallsBackToProject` added |
| `frontend/apps/mobile/src/hooks/use-feature-tour.ts` | Route context threaded; `actionFallsBackToProjectCreation` exposed |
| `frontend/apps/mobile/src/components/feature-tour.tsx` | Fallback note rendered |
| `frontend/apps/mobile/.maestro/feature-tour/owner-tour.yaml` | `assertNotVisible: feature-tour-action` narrows to stop 1; stops 2 and 3 assert the action **is** visible |
| `docs/domain/workspace-navigation.md` | "Three administrator stops are web-only" → one |

---

## What does not change

FR-022, stated as a checklist for whoever reviews this:

- `iam.tour_progress` — no schema change, no new row semantics. "Not started" is still the
  absence of a row.
- The offer rules — `should_offer` is still true only for not-started and in-progress, still
  independent of platform.
- Stop filtering by permission — a stop whose permission the caller lacks is still omitted
  entirely and the survivors still renumber from zero.
- `current_stop` clamping on read without write-back.
- The reopen-after-acting behaviour. `act()` still advances to the next stop and still
  reopens on return to the surface the tour was offered from. See research.md §7 for why
  US3 scenario 5 is read as consistent with this rather than as a change to it.
- The worker tour, in full.

# Phase 0 Research: Create Projects And Rituals On Mobile

Every unknown the Technical Context could have carried is resolved here against the code as
it stands on `main`. Where the spec left a choice open, the decision is recorded with an
`[ASSUMPTION: …]` marker so a reviewer can overturn it without re-deriving the context.

---

## 1. Does the wire already carry everything the two forms collect?

**Decision**: Yes for the request messages; no for one client wrapper. The wrapper changes.

**Rationale**:

`CreateProjectRequest` (`backend/rpc/v1/collaboration.proto:791`) carries `name`, `key`,
`description`, `visibility`, `collaboration_mode` and an optional `default_states`. The
mobile form collects the first five and omits `default_states`, which is precisely how the
web dialog behaves — the server then picks the mode-appropriate default state set in
`project_logic.go`. FR-003's "indistinguishable from one created on the web" therefore
falls out of sending the same five fields and omitting the sixth.

`CreateRitualDefinitionRequest` (`:1939`) carries
`repeated CreateEvidenceRequirementInput evidence_requirements = 8`, and
`ritual_logic.go:110` creates those rows inside the same `txn.WithTxn` as the definition.
So the atomicity FR-013 demands is already a property of the endpoint.

The gap is `CreateRitualDefinitionParams` in
`frontend/packages/apis/src/collaboration-ritual.ts:539`, which exposes `projectId`, `name`,
`description`, `recurrenceRule`, `completionWindowHours`, `timezone`, `defaultAssigneeIds`,
`defaultDepartmentPools` and `procedureDocumentId` — but **not** `evidenceRequirements`. The
web editor works around this by calling `createRitualDefinition` and then looping
`createEvidenceRequirement` per draft, swallowing each failure with a comment reading
"non-fatal: definition saved, evidence can be added later"
(`workspace/projects/[id]/rituals/[definitionId]/page.tsx:1529`). That is the exact
non-atomic behaviour FR-013 forbids on mobile.

**Alternatives considered**:

- *Copy the web's loop on mobile.* Rejected: it makes a ritual with a silently-missing
  evidence requirement a normal outcome, and a ritual with no evidence requirement is "a
  task with a schedule, not a ritual" by the spec's own edge case.
- *Add a new atomic RPC.* Rejected: FR-026, and unnecessary — the atomic path exists.
- *Have mobile call the generated stub directly with the inline field.* Rejected:
  Constitution VII forbids a UI file importing from `rpc`.

**[ASSUMPTION: the web editor is left on its non-atomic loop in this change set.** Moving it
onto the widened wrapper is a real improvement and a small diff, but it is a behaviour change
to a surface this feature does not otherwise touch, it would need its own regression pass on
the edit path (which must keep using `createEvidenceRequirement` because editing is not
creation), and FR-018's scope line is about mobile. Recorded as a follow-up rather than
smuggled in. The widened wrapper is additive, so nothing about the web path breaks.]

---

## 2. What permission and role actually gate each surface?

**Decision**: `collab.createProject` for the project form; `collab.manageRitualDefinition`
**plus** project-role owner-or-admin for the ritual form. Both mirrored client-side.

**Rationale**:

The proto declares `required_permissions: ["collab.createProject"]` on `CreateProject` and
`["collab.manageRitualDefinition"]` on `CreateRitualDefinition`
(`collaboration.proto:23`, `:395`), enforced by the interceptor before any handler runs.
`ritual_logic.go:35` then applies a second, stricter, resource-level bar:

```go
role, err := l.GetProjectMemberRole(ctx, tx, orgID, projectID, employeeID)
if err != nil || (role != ProjectMemberRoleAdmin && role != ProjectMemberRoleOwner) {
    return nil, ErrAccessDenied
}
```

`CreateProject` has no equivalent resource check — there is no resource yet — so the
workspace permission is the whole rule there.

The client reads the workspace permission through `getEmployeePermissions(employeeId)`, the
pattern already established in
`apps/mobile/src/app/(app)/(tasks)/[projectId]/task/[taskId].tsx:1214` with
`queryKey: ["employee-permissions", auth.employeeId]` and a five-minute `staleTime`. It reads
the project role from `getProject(projectId).currentUserRole`
(`packages/apis/src/collaboration.ts:886`), which the mobile project **settings** screen
already fetches; the project **index** screen does not yet, and will need to.

This is what SC-005 and FR-004/FR-015 ask for: the affordance is present exactly when the
action would succeed. It is a mirror, never a substitute — the server checks remain the
enforcement.

**Alternatives considered**:

- *Show the action and let the server refuse.* Rejected by the spec's own edge case: "an
  action offered and then refused is worse than one never offered."
- *Gate the ritual action on the workspace permission alone.* Rejected: it is the looser
  bar, so a plain project member holding `collab.manageRitualDefinition` in some other
  project would see a button that always fails — the exact failure US1 scenario 4 names.
- *Add a `can_create` boolean to `GetProject`.* Rejected: `current_user_role` already
  answers the question, and a new field is a new server capability (FR-026).

---

## 3. What does the product store in a ritual's `timezone`, and what should the phone send?

**Decision**: send the IANA zone name from
`Intl.DateTimeFormat().resolvedOptions().timeZone`, falling back to `"UTC"` if it throws or
returns empty. Show it to the person as a plain read-only line, per FR-010.

**Rationale**:

`loadTimezone` in `backend/internal/collaboration/scheduler_logic.go:403` tries
`time.LoadLocation(tz)` **first** and only then parses a `UTC±N` offset string, falling back
to `time.UTC`. So the stored form is "whatever `time.LoadLocation` accepts, or a whole-hour
UTC offset" — IANA names are already first-class, and the web's fixed `TIMEZONE_OPTIONS`
list of 25 offsets (`page.tsx:106`) is a UI convenience, not the storage contract.

Sending the IANA name is strictly more correct than mapping to the nearest offset: an offset
zone does not observe daylight saving, so a store in `Europe/London` created on a phone in
July would fire its 06:00 opening checklist at 05:00 local from November onward. The spec's
timezone edge case — "a ritual created on a phone must run on the local day the person means"
— is satisfied by the IANA name and quietly broken by the offset.

Hermes on React Native 0.83 (Expo SDK 55) ships full `Intl` including
`resolvedOptions().timeZone` on both platforms, so no dependency is needed. `expo-localization`
would also work and is not installed; adding it for one string fails the ladder.

**Alternatives considered**:

- *Mirror the web's offset mapping.* Rejected for the DST reason above, and because it maps
  every phone in a half-hour zone (India, parts of Australia) to the wrong offset or silently
  to `UTC`.
- *Offer a timezone picker on mobile.* Rejected: FR-010 asks only that the phone's zone be
  the default and be visible. A 400-entry picker on a 360dp screen is the web editor's
  problem, imported.
- *Add `expo-localization`.* Rejected: a new native dependency for a value the runtime
  already exposes.

**[ASSUMPTION: the mobile ritual form shows the timezone but does not let the person change
it.** FR-010 requires the default and the visibility, not the control; the web editor keeps
the full picker; and a person who is in the wrong place when they define the ritual is better
served by seeing "Asia/Ho_Chi_Minh" and going to the web than by scrolling a picker on a
phone. This is the narrow reading and it is the one the spec's Out of Scope list supports.]

---

## 4. Where does the project-key rule live, and how does a duplicate surface?

**Decision**: the format rule moves to `@tech-office/validations` as `projectKeySchema` +
`deriveProjectKey(name)`; a duplicate becomes a `key` field violation from the server.

**Rationale**:

The rule is a database CHECK constraint —
`CONSTRAINT valid_project_key CHECK (key ~ '^[A-Z][A-Z0-9_]{0,9}$')`, `schema.sql:909` — and
the web page reproduces it inline twice: as a derivation
(`.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 10)`) and as a test
(`/^[A-Z][A-Z0-9_]{0,9}$/`). FR-002 requires mobile to use "the same rule the web form uses".
Copying the regex into a third place is the drift Principle VIII exists to prevent, so it
moves once into the shared package — which already holds exactly this kind of rule for
`subdomain`, `email` and `password` — and both clients import it.

Note the derivation is deliberately lossier than the format rule: it strips `_`, which the
format permits, so a hand-typed `STORE_OPS` is valid but is never suggested. That asymmetry
is preserved rather than "fixed", because changing it would change what the web suggests for
existing users' project names.

Duplicates are a different matter. `unique_project_key UNIQUE (organization_id, key)` fires
inside `l.Queries.CreateProject`, and `project_logic.go:47` wraps it as
`fmt.Errorf("failed to create project: %w", err)`. `handleError` (`connect.go:131`) has no
case for it, so it falls through to an opaque error. US2 scenario 3 requires "you are told
the identifier is taken" and Principle X requires that as structured detail. The fix follows
the precedent two cases above it in the same switch: classify the `pgx` unique violation into
`ErrProjectKeyTaken`, and return
`fieldViolation(connect.CodeInvalidArgument, err, "key", …)` — the same helper already used
for `procedure_document_id` and `title`. The client reads it with `fieldViolation(error, "key")`
from `packages/apis/src/errorDetails.ts:89`.

**Alternatives considered**:

- *Match on the Postgres error string in the client.* Rejected: Principle X exists to stop
  precisely this, and the message is not part of any contract.
- *Check availability before saving.* Rejected: a TOCTOU race that still needs the server
  refusal handled, plus a round trip on the happy path.
- *Leave the opaque error and show "Could not create project".* Rejected: US2 scenario 3 and
  SC-006 both require the person keep what they typed and be told what to change.

**[ASSUMPTION: the same field-violation treatment is added for an invalid key format even
though both clients validate before submitting.** A client-side check is a convenience, not
a guarantee — the CHECK constraint is the authority, and a request that reaches it should get
the same field-named answer rather than an Internal. It is one extra case in the same switch.]

---

## 5. What does the mobile ritual form actually collect, and what does it default?

**Decision**: name, optional plain-text description, recurrence (daily interval / weekly
weekday set / monthly day-of-month), one-or-more evidence requirements, optional assignees.
`completionWindowHours` defaults to 24; `approvalMode` to `manual`; `deadlineOffsetHours` to
0; `defaultDepartmentPools` to empty; `procedureDocumentId` omitted.

**Rationale**:

FR-007 and FR-009 fix the collected set and forbid asking for the completion window, the
generation window and the approval mode. The defaults above are what the product already
applies when those are unspecified: `completion_window_hours` is a plain `int32` on the
request with no server default, and the web editor's own initial state is `useState(24)`
(`page.tsx:1319`) — so 24 is *the* product default and the client is where it lives.
`generation_window_days` is set to `30` server-side in `ritual_logic.go:62` and is not on the
request at all, so mobile cannot get it wrong. `ApprovalMode` unspecified maps to manual
review, which is the conservative direction: a ritual whose evidence is auto-approved without
anyone asking for it would be a silent safety regression.

The evidence-requirement editor collects the three things `CreateEvidenceRequirementInput`
needs from a person — `name`, `evidence_types` (one or more, from the seven the product
supports), and `is_required` — and sends the rest at its default. Seven proof types is at the
edge of what fits on a 360dp screen as a wrapped chip row, which is what the existing ritual
**detail** screen already renders (`rituals/[definitionId].tsx`, `typeChip`), so the create
form reuses that visual vocabulary rather than a dropdown.

**Alternatives considered**:

- *Offer the completion window as an advanced disclosure.* Rejected by FR-009, which is
  explicit, and because 24 hours is right for the shift-shaped rituals this feature is for.
- *Default `approvalMode` to auto-approve for photo requirements.* Rejected: it silently
  weakens the product's central promise ("has to leave proof") and nobody asked for it.

---

## 6. How do assignees get picked on a phone?

**Decision**: pick from the project's members, via `listProjectMembers(projectId)` resolved to
names with `getEmployeeCards(employeeIds)`.

**Rationale**:

FR-011 says "one or more people from the workspace". Two candidate sources exist. The
workspace-wide one, `autocompleteEmployees`, is what the web editor uses — but it is gated on
`org.searchEmployees` (`organization.proto:57`), a permission distinct from the two this
feature already requires, so a manager holding `collab.manageRitualDefinition` but not
`org.searchEmployees` would meet an empty picker with no explanation. The project-scoped one,
`listProjectMembers`, is gated on `collab.viewProject` (`collaboration.proto:321`) — which
anyone reaching this form necessarily holds, since they are an owner or admin of the project.

Project members is also the honest set: a ritual instance assigned to someone who cannot see
the project is an instance they cannot open. `getEmployeeCards` is the existing way to turn
employee IDs into names and is what the web editor itself uses to re-hydrate saved assignees
(`page.tsx:1413`).

No mobile employee picker exists today — `grep` finds no `listEmployees` or
`getEmployeeCards` call anywhere in `apps/mobile` — so this component is genuinely new rather
than a missed reuse.

**Alternatives considered**:

- *`autocompleteEmployees`, matching web.* Rejected for the permission gap above; it can be
  added later behind a permission check if picking a non-member is ever wanted.
- *`listEmployees` from IAM.* Rejected: gated on `iam.listEmployees`, an administrative
  permission, and returns a paginated administrative record (hire date, home address) that has
  no business on this screen.

**[ASSUMPTION: "from the workspace" in FR-011 is read as "from the project", because every
assignable person for a ritual in that project is a member of it, and because the alternative
requires a permission the feature does not otherwise need.** Choosing nobody remains allowed
and behaves exactly as an unassigned ritual does today, as FR-011 requires.]

---

## 7. What exactly changes in the tour?

**Decision**: clear `WebOnly` on the `project` and `ritual` stops in
`backend/internal/tour/content.go`; route both targets in
`apps/mobile/src/lib/tour-routes.ts`; give the mobile hook the `firstProjectId` context and a
`actionFallsBackToProjectCreation` flag; render the fallback note. Nothing else moves.

**Rationale**:

`logic.go:109` substitutes `MobileNote` for `Body` and forces the target to
`TOUR_TARGET_NONE` **only** when `stop.WebOnly && platform == MOBILE`. Clearing the flag on
two stops is therefore the entire server-side change, and the `MobileNote` strings on those
two stops become dead and are deleted with them — leaving them would be a stale note nobody
renders. The `people` stop keeps its flag and its note, satisfying FR-020 and US3 scenario 6.

The mobile route map is currently `projects: null, rituals: null` with a comment saying the
day those screens exist "the change is one line each". That prediction holds. The rituals
route is the one that consults state, exactly as on web: with a project it goes to that
project's ritual creation, without one it goes to project creation and the card says why —
FR-021 and US3 scenario 4, mirroring `ritualRouteFallsBackToProject` in the web map.

`act()` in `use-feature-tour.ts:170` calls `resolveTourRoute(currentStop.target)` with no
context and must now pass one. The first project comes from `listProjects()`, already fetched
under `queryKey: ["projects"]` on the tasks tab.

**[ASSUMPTION: US3 scenario 5 — "the tour reopens at the stop they acted on" — is satisfied
by the existing behaviour, which reopens at the *next* stop, and no code changes for it.**
FR-022 is explicit that "the reopen-after-acting behaviour MUST be unchanged", and
`act()` deliberately advances with the comment "the stop is finished once it has been acted
on, so the person comes back to the next one rather than the one they just did". Where a
scenario sentence and a functional requirement disagree, the requirement governs; the
scenario reads as loose phrasing for "the tour comes back where it left off" rather than a
deliberate reversal of a shipped decision. Flagged here because it is the one place a reviewer
might reasonably read the spec the other way.]

---

## 8. What has to change in the tests that currently assert the old behaviour?

**Decision**: `backend/integration/feature_tour_test.go` narrows its `webOnly` set from
`{people, project, ritual}` to `{people}`; `.maestro/feature-tour/owner-tour.yaml` stops
asserting `assertNotVisible: feature-tour-action` on stops 2 and 3.

**Rationale**: `feature_tour_test.go:113` hard-codes
`webOnly := map[string]bool{"people": true, "project": true, "ritual": true}` and asserts each
such stop's body contains "web app" and that it carries no target and no action label. Two
thirds of that becomes false by design. The Maestro flow asserts the same thing on the device
at stops 1–3 and must move its `assertNotVisible` to stop 1 only.

These are not incidental test churn — they are the tests that would otherwise be the last
thing in the repository still claiming the old contract, and updating them is how the change
proves itself.

---

## 9. Which documents assert the absent capability today?

**Decision**: five, all listed in FR-023, all verified as currently making the claim:

| File | The claim |
|---|---|
| `docs/domain/README.md:74` | Drift **D38** — "The mobile app can list projects and rituals but creates neither — no `createProject` or `createRitualDefinition` call exists anywhere in `apps/mobile`". Closed by this feature. |
| `docs/domain/workspace-navigation.md:196` | "Three administrator stops are web-only: `people`, `project` and `ritual` — the mobile app can list projects and rituals but has no create surface for either." Becomes one stop. |
| `docs/domain/rituals-tasks.md:743, :774` | "Mobile has no ritual pool configuration at all" (still true, keep) and "Mobile reads the procedure and never configures it" (still true, keep) — but the definition section needs the new mobile create and archive surfaces added. |
| `specs/039-feature-tour/contracts/tour-content.md` | Stops 2 and 3 carry a **Web-only** block and a mobile note; the review-notes section says "Three stops are web-only". Both change. |
| `specs/mobile-ui-design.md` §9 | The "Screens NOT Built for Mobile (Web-Only)" table. Project and ritual creation were never rows in it, so the correction is to the surrounding framing rather than a row deletion — checked, and §9's rationale sentence cites Principle XIII, which is itself being amended. |

`backend/docs/` was checked for the same claim and carries none: it documents the ritual
generation and notification architecture, neither of which changes.

---

## 10. Presentation, sizing and the 360dp bar

**Decision**: both surfaces are Expo Router modal screens registered in the existing
`(tasks)/_layout.tsx` stack, styled with `@tech-office/theme-tokens`, built as single-column
scrolling forms.

**Rationale**: the modal-screen convention is what `(chat)/new-channel.tsx`,
`(calendar)/create.tsx` and `[projectId]/create.tsx` already use, so this is a convention
match rather than a decision — as the spec's own assumption notes. The token-based styling
(`lightPalette`, `mobileLayout`, `mobileTypography`, `radius`, `shadows`, `spacing`) is the
modern pattern on the ritual detail screen; the two older create screens predate it and are
not the model to copy.

The two controls that can fail at 360dp are the weekday row (seven choices) and the
day-of-month choice (thirty-one). The weekday row is seven ~44dp segments, which needs
360 − 2×16 padding = 328dp, i.e. 46dp each — it fits, but only just, so it uses two-letter
labels (Mo Tu We Th Fr Sa Su) rather than three, and is verified rather than assumed. The
day-of-month choice is a wrapped grid of numbered chips, not a 31-row picker wheel, because a
wheel is an iOS-flavoured control that renders very differently on Android and this
repository has already been bitten by iOS-only prop assumptions on narrow Android screens.

**Alternatives considered**:

- *A bottom sheet instead of a modal screen.* Rejected: the ritual form is long enough to
  need the full height and a keyboard, which is what a screen gives and a sheet fights.
- *Reuse the web's `Dialog`-based layout.* Forbidden by Principle XIII: mobile layouts must
  not be responsive copies of the web.

---

## 11. Are the two backend paths this feature leans on actually tested today?

**Decision**: one is thin; add one integration test. The other is well covered.

**Rationale**: `grep` for `EvidenceRequirements:` across `backend/integration/` returns two
occurrences, so the inline atomic path FR-013 depends on is barely exercised — and it is the
path the whole "the definition and its requirements land together or not at all" guarantee
rests on. One test in `collaboration_ritual_test.go` asserting that a create carrying two
requirements returns both and persists both, and that a create whose requirements are invalid
leaves no definition behind, is the smallest thing that fails if that guarantee breaks.

FR-014's "upcoming runs visible immediately" needs no new test: feature 034 already commits
the first instances inside the same transaction
(`ritual_connect.go:88`, `GenerateRitualInstances` inside the `WithTxn`) and
`collaboration_schedule_generation_test.go` covers it.

# Contract: Shared package and backend deltas

Everything this feature changes outside `apps/mobile`. Three files carry real signature
changes; the rest is error mapping and content. Each entry states what exists today, what it
becomes, and which principle or requirement forces it.

---

## 1. `frontend/packages/apis/src/collaboration-ritual.ts`

**Forced by**: FR-013 (atomic creation), FR-026 ("if a shared client wrapper cannot express
what the existing request already accepts, the wrapper is what changes"), Constitution VII.

### Today

```ts
export interface CreateRitualDefinitionParams {
	projectId: string;
	name: string;
	description?: string;
	recurrenceRule: RecurrenceRule;
	completionWindowHours: number;
	timezone: string;
	defaultAssigneeIds?: string[];
	defaultDepartmentPools?: RitualDepartmentPoolInput[];
	procedureDocumentId?: string;
}
```

`createRitualDefinition` maps each of these onto `collaborationClient.createRitualDefinition`
and never sets `evidenceRequirements`, although the request message has carried
`repeated CreateEvidenceRequirementInput evidence_requirements = 8` since feature 022 and
`ritual_logic.go` creates those rows inside the definition's own transaction.

### Becomes

```ts
/**
 * One evidence requirement to create together with the definition.
 *
 * Sent inline rather than through `createEvidenceRequirement` afterwards, so the definition
 * and its requirements commit in one transaction: a ritual with no evidence requirement is a
 * task with a schedule, not a ritual, so a partial create is never an acceptable outcome.
 */
export interface CreateRitualDefinitionEvidenceRequirementInput {
	name: string;
	description?: string;
	evidenceTypes: EvidenceType[];
	isRequired: boolean;
	/** Defaults to 'manual'. Auto-approval is configured on the web. */
	approvalMode?: ApprovalMode;
	autoApproveConfig?: AutoApproveConfig;
	/** Defaults to 0. */
	deadlineOffsetHours?: number;
}

export interface CreateRitualDefinitionParams {
	// …unchanged fields…
	/** Created atomically with the definition. Omit or pass [] to create none. */
	evidenceRequirements?: CreateRitualDefinitionEvidenceRequirementInput[];
}
```

and the body gains, alongside the existing `defaultDepartmentPools` mapping:

```ts
evidenceRequirements: (params.evidenceRequirements ?? []).map((r) => ({
	name: r.name,
	description: r.description ?? '',
	evidenceTypes: r.evidenceTypes.map(stringToProtoEvidenceType),
	isRequired: r.isRequired,
	approvalMode: stringToProtoApprovalMode(r.approvalMode ?? 'manual'),
	autoApproveConfig: r.autoApproveConfig
		? autoApproveConfigToProto(r.autoApproveConfig)
		: undefined,
	deadlineOffsetHours: r.deadlineOffsetHours ?? 0,
})),
```

`stringToProtoEvidenceType`, `stringToProtoApprovalMode` and the auto-approve mapper already
exist in this file for `createEvidenceRequirement`; none is new.

### Compatibility

Additive and optional. Every existing caller — including the web editor's
create-then-loop — compiles and behaves identically. The web editor is deliberately **not**
migrated onto the inline field in this change set; see research.md §1.

---

## 2. `frontend/packages/validations/src/project-key.ts` — NEW

**Forced by**: FR-002 ("the same rule the web form uses"), Constitution VIII (cross-stack
constant synchronization).

The rule is a database CHECK constraint —
`CONSTRAINT valid_project_key CHECK (key ~ '^[A-Z][A-Z0-9_]{0,9}$')` in
`collaboration.project` — reproduced inline in the web projects page today. Mobile needs the
identical rule, and a regex living in three places is the drift Principle VIII exists to
prevent.

```ts
/**
 * The project key rule, mirroring the `valid_project_key` CHECK constraint on
 * `collaboration.project`. The database is the authority; this is the client's copy of it,
 * kept in one place so web and mobile cannot disagree about what they will submit.
 */
export const PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9_]{0,9}$/;

export const PROJECT_KEY_RULE_TEXT =
	'1–10 characters, starting with a letter, then letters, numbers or underscores.';

export const projectKeySchema = z.string().regex(PROJECT_KEY_PATTERN, PROJECT_KEY_RULE_TEXT);

/**
 * Suggest a key from a project name.
 *
 * Deliberately lossier than the format rule: it strips underscores, which the rule permits.
 * A hand-typed STORE_OPS is valid but is never suggested. Preserved from the web form as-is
 * so both clients suggest the same key for the same name.
 */
export function deriveProjectKey(name: string): string {
	return name.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 10);
}
```

Re-exported from `packages/validations/src/index.ts` alongside the existing `subdomain`,
`email` and `password` rules.

**Consumer change**: `apps/web/src/app/workspace/projects/page.tsx` drops its two inline
copies (the `useEffect` derivation and the `/^[A-Z][A-Z0-9_]{0,9}$/` test) and imports these.
Its error string becomes `PROJECT_KEY_RULE_TEXT`, so web and mobile say the same thing.

---

## 3. `backend/internal/collaboration` — project key error mapping

**Forced by**: US2 scenario 3, FR-016, Constitution X (structured error details).

A duplicate key currently violates `unique_project_key UNIQUE (organization_id, key)` inside
`l.Queries.CreateProject`, is wrapped as `fmt.Errorf("failed to create project: %w", err)`,
and reaches `handleError` with no matching case — so the client gets an opaque error with no
field, which neither US2 scenario 3 nor SC-006 can be built on.

### `errors.go`

```go
// ErrProjectKeyTaken is a unique_project_key violation: another project in this
// organization already uses the key. The key is permanent, so this is a refusal the person
// has to resolve before saving, not something to auto-correct on their behalf.
var ErrProjectKeyTaken = errors.New("a project with this key already exists")

// ErrProjectKeyInvalid is a valid_project_key CHECK violation. Both clients validate first,
// so reaching this means a caller bypassed them — it still gets a field-named answer rather
// than an Internal.
var ErrProjectKeyInvalid = errors.New(
	"project key must be 1-10 characters, starting with a letter, then letters, numbers or underscores")
```

### `project_logic.go`

Classify the `pgx` error on the create call rather than wrapping it blind:

```go
project, err := l.Queries.CreateProject(ctx, tx, &database.CreateProjectParams{…})
if err != nil {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.ConstraintName {
		case "unique_project_key":
			return nil, nil, nil, ErrProjectKeyTaken
		case "valid_project_key":
			return nil, nil, nil, ErrProjectKeyInvalid
		}
	}
	// …existing log + wrap…
}
```

### `connect.go`

Two cases in the existing switch, using the `fieldViolation` helper already used two cases
above for `procedure_document_id` and `title`:

```go
case errors.Is(err, ErrProjectKeyTaken), errors.Is(err, ErrProjectKeyInvalid):
	// Named field, so both create forms can mark the key input rather than showing a
	// whole-request error the person has to guess the cause of (Principle X).
	return fieldViolation(connect.CodeInvalidArgument, err, "key", err.Error())
```

**This is error mapping on an existing endpoint, not a new capability**: no new RPC, no new
request or response field, no new permission. FR-026 holds.

### Client side

Both create forms read it with the existing helper:

```ts
import { fieldViolation } from 'apis';
const keyError = fieldViolation(error, 'key');
```

`fieldViolation(error, field)` is already exported from
`packages/apis/src/errorDetails.ts` and returns the description or `undefined`.

---

## 4. `backend/internal/tour/content.go` — two stops

**Forced by**: FR-019, FR-021, FR-023.

| Stop | Change |
|---|---|
| `people` | **None.** Keeps `WebOnly: true` and its `MobileNote` (FR-020). |
| `project` | `WebOnly: true` → `false`; `MobileNote` field deleted. |
| `ritual` | `WebOnly: true` → `false`; `MobileNote` field deleted. |

`ContentVersion` is bumped from `"2026-09-02.1"`, because the body an administrator sees on a
phone changes for two of six stops. Nothing reads `content_version` today, but it records
which wording a person actually saw and a stale value makes that record a lie.

The notes are **deleted**, not left in place: `logic.go` reads `MobileNote` only when
`WebOnly` is set, so a retained note is unreachable text asserting something false — precisely
the kind of thing the Definition of Done requires be removed rather than orphaned.

`logic.go` itself is unchanged. The substitution rule is right; only its inputs move.

---

## 5. `frontend/apps/mobile/src/lib/tour-routes.ts`

**Forced by**: FR-019, FR-021, US3 scenarios 2–4.

The map's own comment predicted this change: "the day the mobile app grows those screens the
change is one line each and the compiler has already pointed at the file."

```ts
const TOUR_ROUTES: Record<TourTarget, string | null> = {
  none: null,
  // Adding staff, importing a team and setting roles are done on the web app.
  people: null,
  projects: "/(app)/(tasks)/create-project",
  // Overridden by resolveTourRoute when the workspace already has a project: rituals live
  // inside one, so with no project there is nowhere else honest to send someone.
  rituals: "/(app)/(tasks)/create-project",
  // …unchanged…
};

export function resolveTourRoute(
  target: TourTarget,
  context: TourRouteContext = {},
): string | null {
  if (target === "rituals" && context.firstProjectId) {
    return `/(app)/(tasks)/${context.firstProjectId}/create-ritual`;
  }
  return TOUR_ROUTES[target];
}

/**
 * True when the ritual stop is falling back to project creation, so the tour card can say
 * why the button does not go where its label suggests (FR-021).
 */
export function ritualRouteFallsBackToProject(
  target: TourTarget,
  context: TourRouteContext = {},
): boolean {
  return target === "rituals" && !context.firstProjectId;
}
```

`TourRouteContext` already declares `firstProjectId` and already has a comment saying it
exists so the two maps stay comparable. It now carries a value.

**Behavioural parity with web**: `apps/web/src/lib/tour-routes.ts` resolves the same two
targets with the same fallback and exports the same predicate. The two maps stay structurally
identical; only the route strings differ, which is the one genuinely platform-specific part.

---

## 6. `frontend/apps/mobile/src/hooks/use-feature-tour.ts`

**Forced by**: FR-021, US3 scenario 4.

- Fetch the first project (`listProjects()`, `queryKey: ["projects"]` — already the key the
  tasks tab uses, so this shares its cache) and build
  `routeContext = { firstProjectId: projects?.[0]?.id }`.
- `act()` passes it: `resolveTourRoute(currentStop.target, routeContext)`.
- The result adds `actionFallsBackToProjectCreation: boolean`, computed with
  `ritualRouteFallsBackToProject(currentStop.target, routeContext)`, mirroring
  `apps/web/src/components/tour/useFeatureTour.ts`.

**Unchanged**, per FR-022: `start`, `next`, `previous`, `dismiss`, `restart`, every
`writeProgress` call, the offer rules, the `homeRoute`/`away` suppression, and `act()`'s
existing advance-to-the-next-stop behaviour.

---

## 7. `frontend/apps/mobile/src/components/feature-tour.tsx`

One conditional line under the body, matching the web card's copy verbatim so the two
platforms explain the fallback the same way:

```tsx
{actionFallsBackToProjectCreation ? (
  <Text style={styles.fallbackNote} testID="feature-tour-ritual-fallback-note">
    Rituals live inside a project, and this workspace does not have one yet — so this takes
    you to project creation first.
  </Text>
) : null}
```

The `testID` matches the web `data-testid` of the same name.

---

## 8. `frontend/apps/mobile/src/lib/device-timezone.ts` — NEW

**Forced by**: FR-010.

```ts
/**
 * The device's IANA timezone, for a ritual created on this phone.
 *
 * IANA rather than a UTC offset: `loadTimezone` in the scheduler tries `time.LoadLocation`
 * before parsing an offset string, and an offset zone does not observe daylight saving — a
 * 06:00 opening checklist defined in July in Europe/London would fire at 05:00 local from
 * November. Hermes on RN 0.83 ships Intl with timeZone on both platforms, so this needs no
 * dependency.
 */
export function getDeviceTimezone(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
	} catch {
		return 'UTC';
	}
}
```

Covered by a `node --experimental-strip-types` self-check in the style of the existing
`src/lib/doc-rows.check.ts` and `channel-voice-call-state.check.ts`, wired into
`package.json` scripts as `check:device-timezone`.

# Research: Ritual UX Redesign

## Decision 1: Default landing must follow collaboration mode

- **Decision**: Project entry without an explicit view will open `Board` for standard projects, `Today` for ritual projects, and `Overview` for mixed projects.
- **Rationale**: The redesign proposal identifies the first impression as the primary failure. The repo already stores and branches on `collaborationMode`, so routing can align with the chosen work model instead of teaching the wrong mental model.
- **Alternatives considered**:
  - Keep board-first entry for every mode: rejected because it directly conflicts with ritual-first and mixed-mode goals.
  - Route all modes to a generic `Tasks` list: rejected because standard project users still need planning-oriented entry and mixed mode needs a cross-stream summary first.

## Decision 2: Keep `Tasks` as the primary day-to-day language

- **Decision**: User-facing day-to-day navigation stays task-first, while the project container remains a secondary organizing concept.
- **Rationale**: The proposal argues that `Tasks` is the most universal term across low-tech and professional users. This fits both the web workspace and mobile Tasks tab already present in the repo.
- **Alternatives considered**:
  - Rebrand the main module around `Projects`: rejected because it forces workers to understand an organizing container before acting.
  - Rebrand around `Rituals`: rejected because it is too broad for mixed contexts and does not cover standard task work well.

## Decision 2A: Task-first language also owns the primary web route

- **Decision**: The main web workspace route will use `/workspace/tasks`, and user-facing project or task links exposed through daily work will migrate under that route family.
- **Rationale**: The redesign proposal does not only rename labels; it explicitly recommends `/tasks` as the main day-to-day work entry. Keeping `/workspace/projects` as the primary route would preserve the older container-first mental model in copied URLs, bookmarks, notifications, and browser navigation.
- **Alternatives considered**:
  - Keep `/workspace/projects` as the primary route and only change labels: rejected because route naming would still teach `Projects` as the first-class user concept.
  - Rename only the top-level listing and keep all nested project links under `/workspace/projects`: rejected because deep links would continue exposing the legacy module name during everyday task execution.

## Decision 3: Mixed mode needs structural separation, not badges alone

- **Decision**: Mixed projects will add an `Overview` surface and explicit `Planned Work` and `Routine Operations` destinations, with `Today` split into separate labeled sections.
- **Rationale**: The existing code already branches on `collaborationMode`, but current mixed-mode rendering still risks flattening standard tasks and ritual instances into one model. Structural separation makes each workstream legible from the entry point onward.
- **Alternatives considered**:
  - Keep one shared list with task-kind badges: rejected because users still need to decode each row.
  - Hide one workstream behind filters only: rejected because the redesign calls for both work types to stay visible.

## Decision 4: Ritual navigation should be operations-first, not board-first

- **Decision**: Ritual mode will prioritize `Today`, `Tasks`, `Health`, `Review`, `Calendar`, and `Worklist`, while any board-like ritual visualization remains secondary.
- **Rationale**: Ritual work is evaluated by due state, proof completeness, and review status, not by generic kanban progression. The current repo already has Today, review backlog, analytics/compliance, and task detail surfaces that can support this model with less change than inventing a new board metaphor.
- **Alternatives considered**:
  - Keep the generic board as the default ritual view: rejected because it reinforces the wrong success criteria.
  - Remove board-style ritual visualization entirely up front: rejected because a secondary board may still be useful later, but it should not drive the primary IA.

## Decision 5: Live instances remain the action surface; templates remain management surfaces

- **Decision**: Every workflow that implies action on a ritual run will resolve to the ritual instance task, while ritual definition routes remain template-management destinations.
- **Rationale**: The current data model and UI already separate ritual definitions from instance submissions. The redesign needs to amplify that split in navigation and surface ownership, not collapse it.
- **Alternatives considered**:
  - Route some alerts or lists to ritual definitions: rejected because workers would land in the wrong context for proof and review.
  - Put template-editing affordances directly into worker-first surfaces: rejected because it blurs management and execution.

## Decision 6: Role-appropriate entry points should diverge by purpose

- **Decision**: Employee-facing ritual entry emphasizes `Today` and live task detail; owner/reviewer entry emphasizes `Health`, `Review`, and template settings; dual-role users see both sections but with clear boundaries.
- **Rationale**: The redesign proposal makes role separation explicit. Existing web task detail and review surfaces can support this by changing entry, grouping, and prominence rather than inventing separate backends per role.
- **Alternatives considered**:
  - Keep one default entry for all roles: rejected because workers and owners optimize for different questions.
  - Fork the entire IA by role: rejected because collaboration mode still needs a shared project structure and dual-role users need both perspectives.

## Decision 7: Reuse existing collaboration views and wrappers before adding new APIs

- **Decision**: Start by refactoring existing surfaces such as `TodayView`, `ListiView`, `BoardView`, `AnalyticsView`, `RitualReviewBacklog`, and mobile Tasks focus mode, and only add additive collaboration read APIs if current projections cannot support the redesign cleanly.
- **Rationale**: The repo already contains the core ritual building blocks. Reusing them lowers risk, respects the frontend wrapper constitution, and reduces unnecessary schema or proto churn.
- **Alternatives considered**:
  - Build new surfaces from scratch with new APIs immediately: rejected because it duplicates existing logic and increases integration risk.
  - Compose all overview data client-side with ad hoc joins: rejected because typed wrappers and stable backend projections are preferred for cross-client behavior.

## Decision 8: Notification deep links and focus intents remain part of the redesign contract

- **Decision**: Existing ritual focus intents such as `view_instance`, `submit_requirement`, and `review_pending` remain the mechanism for routing users into the correct part of a ritual instance.
- **Rationale**: Both web and mobile already support these intents. Preserving them reduces migration risk and keeps alerts aligned with the task-first redesign.
- **Alternatives considered**:
  - Replace focus intents with generic project-level navigation only: rejected because notifications must land on actionable context.
  - Introduce many new route-only state flags immediately: rejected because the existing intent model is sufficient unless implementation exposes a real gap.

## Decision 9: The redesign should be validated as behavior, not only layout

- **Decision**: Planning must lead to backend integration scenarios, web E2E coverage, and mobile worker-path validation that prove users land on the right surfaces and can distinguish workstreams correctly.
- **Rationale**: This repo’s constitution treats scenario contracts as mandatory planning artifacts. The redesign is successful only if navigation and role/surface ownership are observable in tests and manual flows.
- **Alternatives considered**:
  - Rely only on visual QA: rejected because routing, role visibility, and mixed-mode separation are behavioral contracts.
  - Test only the web client: rejected because mobile is part of the redesign scope.
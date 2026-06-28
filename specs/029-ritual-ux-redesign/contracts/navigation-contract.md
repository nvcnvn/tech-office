# Navigation Contract: Ritual UX Redesign

## Routing Principle

Project entry and in-project navigation must teach the collaboration mode that the user selected. The system must not default ritual or mixed work into a generic board-first mental model when no explicit view has been chosen.

## Route Ownership Contract

- `/workspace/tasks` is the primary web workspace route for day-to-day task work.
- `/workspace/tasks/[projectId]` owns project entry and mode-aware surface selection.
- `/workspace/tasks/[projectId]/tasks/[taskId]` owns live task and ritual instance detail.
- `/workspace/tasks/[projectId]/rituals/[definitionId]` remains the deliberate ritual template-management path.
- Legacy `/workspace/projects` routes must redirect to the equivalent `/workspace/tasks` destination while preserving query parameters, selected views, and focus intents.

## Default Landing Contract

| Collaboration Mode | Default Surface | Purpose |
|--------------------|-----------------|---------|
| `standard` | `Board` | Standard-task planning and project progress |
| `ritual` | `Today` | Urgency-first ritual execution and proof follow-up |
| `mixed` | `Overview` | Cross-stream orientation before drilling into either work model |

### Override Rule

- If the URL or a stored user action specifies a view, that explicit selection wins.
- The mode-aware default only applies when the user enters the project without a selected view.

## Top-Level Surface Contract

### Standard Mode

- `Tasks`
- `Board`
- `List`
- `Gantt`
- `Calendar`
- `Analytics`
- `Settings`

### Ritual Mode

- `Today`
- `Tasks`
- `Health`
- `Review`
- `Calendar`
- `Worklist`
- `Settings`

### Mixed Mode

- `Overview`
- `Today`
- `Tasks`
- `Planned Work`
- `Routine Operations`
- `Review`
- `Health`
- `Settings`

## Entry Surface Mapping

| Entry Surface | Actor | Destination | Focus Behavior |
|---------------|-------|-------------|----------------|
| Project open without explicit view | Any project member | `/workspace/tasks/[projectId]` mode-specific default surface | Uses collaboration mode entry policy |
| Mixed overview attention card | Worker or reviewer | Correct downstream workstream surface | Focuses the related section or item |
| Today ritual row | Worker | `/workspace/tasks/[projectId]/tasks/[taskId]` ritual instance task detail | Emphasizes next missing or rejected requirement |
| Today standard task row | Worker | `/workspace/tasks/[projectId]/tasks/[taskId]` standard task detail or planning surface | Standard task context only |
| Ritual review backlog row | Reviewer | `/workspace/tasks/[projectId]/tasks/[taskId]` ritual instance task detail or review-focused context | Highlights pending submission(s) |
| Health metric card | Owner or reviewer | `/workspace/tasks/[projectId]` health or worklist context | Filters to the relevant exception set |
| Ritual settings or definition list | Owner or manager | `/workspace/tasks/[projectId]/rituals/[definitionId]` ritual definition editor | Focuses template management |
| Notification for pending review | Reviewer | `/workspace/tasks/[projectId]/tasks/[taskId]` ritual instance task detail | Focuses review state |
| Notification for rejected proof | Worker | `/workspace/tasks/[projectId]/tasks/[taskId]` ritual instance task detail | Focuses the rejected requirement and feedback |

## Mixed-Mode Separation Rules

- `Overview` must summarize both standard and ritual workstreams without blending them into one list.
- `Today` in mixed mode must contain separate labeled sections for standard tasks and ritual runs.
- `Planned Work` must contain standard-task planning views only.
- `Routine Operations` must contain ritual-specific browsing, calendar, and definition shortcuts only.

## Focus Intent Contract

Navigation may carry focus hints, but they must not change the destination entity.

### Valid focus intents

- `view_instance`
- `submit_requirement`
- `review_pending`

### Valid focus scopes

- Entire ritual instance
- Specific evidence requirement within a ritual instance
- Review-oriented section of a ritual instance

## Forbidden Routing Outcomes

- Ritual work alerts must not route workers to a ritual definition editor.
- Mixed-mode entry must not flatten planned work and routine operations into one undifferentiated primary view.
- Ritual mode must not default to the generic kanban board when no explicit view has been selected.
- Legacy `/workspace/projects` links must not strand users on a stale route family or drop the query state needed to preserve view selection and focus intent.
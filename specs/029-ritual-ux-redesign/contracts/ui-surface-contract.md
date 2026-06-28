# UI Surface Contract: Ritual UX Redesign

## Surface Ownership Rules

| Surface | Primary Actor | Purpose | Allowed Actions | Forbidden Actions |
|---------|---------------|---------|-----------------|------------------|
| Mixed overview | Worker, reviewer, owner | Orient the user across both workstreams | Inspect attention summaries, open the correct workstream, review high-level risk | Complete the full ritual proof flow inline, edit ritual templates |
| Ritual today surface | Assigned worker | Identify urgent ritual work and next proof action | Open live ritual runs, scan urgency groups, see resubmission or pending-review awareness | Edit reusable ritual settings |
| Ritual worklist | Worker, reviewer, owner | Browse ritual runs in a list-oriented operational surface | Sort, filter, open instances, inspect proof/review status | Act as the primary generic planning board |
| Review surface | Reviewer, owner | Triage pending ritual submissions | Open pending items, approve, reject, navigate into instance review context | Host worker submission as the primary flow |
| Health surface | Reviewer, owner | Inspect operational compliance and trends | Review metrics, identify overdue or missed work, drill into exceptions | Replace live work execution or template editing |
| Planned work surface | Any project member | Manage standard tasks | Open board/list/gantt views, inspect standard-task progress | Mix ritual-run items into the same primary list |
| Routine operations surface | Worker, reviewer, owner | Access ritual-specific operational views | Open worklist, calendar, and ritual definition shortcuts | Replace planned-work views for one-off tasks |
| Ritual instance detail | Assigned worker, reviewer, dual-role user | Complete or review one live ritual run | Submit, resubmit, review, inspect outcomes, read template guidance | Behave like a template editor |
| Ritual template editor | Owner or manager | Manage reusable ritual rules | Edit recurrence, requirements, defaults, guidance | Submit live proof for a specific run |
| Mobile Tasks focus view | Assigned worker | Surface the next task to do now | Open task detail, follow action-oriented prompts, return to checklist | Send workers into template management or backlog-heavy admin flows |

## Role Visibility Matrix

| User Capability | Today / Worklist | Review | Health | Template Editor | Instance Submit Controls | Instance Review Controls |
|-----------------|------------------|--------|--------|-----------------|--------------------------|--------------------------|
| Assigned worker only | Visible | Hidden | Limited or hidden | Hidden or read-only if directly accessible | Visible | Hidden |
| Reviewer only | Visible when relevant | Visible | Visible | Read-only if accessible | Hidden unless also assigned | Visible |
| Template manager only | Visible when relevant | Hidden unless also reviewer | Visible if owner/admin | Visible | Hidden unless also assigned | Hidden unless also reviewer |
| Assigned worker + reviewer | Visible | Visible | Visible when role permits | Read-only or editable per permissions | Visible | Visible |

## Ritual Instance Layout Contract

The ritual instance should appear in this order for worker-first comprehension:

1. `What to do`
2. `Proof checklist`
3. `Reviewer decisions`
4. `Template guidance`
5. `Discussion and attachments`

### Layout rules

- Proof submission actions appear only on the live instance.
- Template guidance is secondary context for workers and must not dominate the page.
- Review intent should highlight the affected requirement or review panel when the user arrives from alerts or backlog actions.
- Skipped or detached runs must show their exceptional context within the instance.

## Mixed-Mode Presentation Rules

- Mixed mode must use explicit sectioning, labels, and empty states for each workstream.
- Standard tasks and ritual runs must not rely on subtle badges alone for differentiation.
- `Tasks` can remain a broad daily-work term, but mixed-mode sub-surfaces must still use clear secondary labels such as `Planned Work` and `Routine Operations`.

## Mobile Contract

- Mobile worker flows remain task-first and capture-oriented.
- Common requirement actions should be framed as direct actions, such as `Take photo`, `Check in now`, `Add note`, or `Fix proof`.
- Mobile review supports specific alert-driven or task-level action, but backlog-heavy review management remains web-first.
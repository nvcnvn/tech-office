# Navigation Contract: Ritual Submission Flow

## Routing Principle

Every user entry that implies work on a live ritual run must resolve to a ritual instance task. Ritual definitions are management destinations only.

## Entry Surface Mapping

| Entry Surface | Actor | Destination | Focus Behavior |
|---------------|-------|-------------|----------------|
| Project list ritual row | Worker | Ritual instance task detail | Default to checklist summary |
| Today view ritual item | Worker | Ritual instance task detail | Emphasize next incomplete requirement |
| Pending review notification | Reviewer | Ritual instance task detail or reviewer backlog surface | Highlight pending submission(s) |
| Rejected evidence notification | Worker | Ritual instance task detail | Highlight rejected requirement and reviewer comment |
| Ritual settings / definitions list | Owner or manager | Ritual definition editor | Focus template settings |

## Navigation Context Contract

Navigation may carry focus hints, but those hints must not change the destination entity.

### Valid focus intents

- `view_instance`
- `submit_requirement`
- `review_pending`

### Valid focus scopes

- Entire ritual instance
- Specific evidence requirement within the ritual instance
- Reviewer-oriented section of the ritual instance or backlog

## Notification Routing Rules

- Submission-related notifications must not route to a ritual definition editor.
- Review-related notifications must land in a context where the reviewer can immediately inspect the pending submission.
- Rejection-related notifications must land in a context where the worker can immediately understand what needs to be resubmitted.

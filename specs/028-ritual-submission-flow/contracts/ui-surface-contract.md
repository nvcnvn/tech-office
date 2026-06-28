# UI Surface Contract: Ritual Submission Flow

## Surface Ownership Rules

| Surface | Primary Actor | Purpose | Allowed Actions | Forbidden Actions |
|---------|---------------|---------|-----------------|------------------|
| Ritual definition editor | Project owner or manager | Manage template instructions, recurrence, and evidence requirements | Edit definition, edit requirements, review template metadata | Submit live evidence for a specific run, alter historical submissions |
| Ritual instance task detail (web) | Assigned worker, reviewer, dual-role user | Complete or review one specific ritual run | Submit, resubmit, review, inspect prior outcomes, open discussion | Edit template rules from the live evidence section |
| Ritual instance task detail (mobile) | Assigned worker, reviewer, dual-role user | Complete or urgently review one specific ritual run | Open requirement flow, submit/resubmit, inspect reviewer feedback, optionally perform task-level review | Manage backlog review across many tasks, edit ritual template rules |
| Reviewer backlog surface (web-first) | Reviewer, owner | Identify pending ritual submissions across instances | Open pending items, triage urgency, jump into task review | Submit worker proof, manage template settings |
| Today/list/board/notification summary surfaces | Worker or reviewer | Discover the next ritual action | Open the correct ritual instance or review target | Host the complete submit/review workflow inline |

## Role Visibility Matrix

| User Capability | Definition Editor | Instance Submit Controls | Instance Review Controls | Reviewer Backlog |
|-----------------|------------------|--------------------------|--------------------------|------------------|
| Assigned worker only | Read-only if accessible | Visible | Hidden | Hidden |
| Reviewer only | Read-only if accessible | Hidden unless also assigned | Visible | Visible |
| Template manager only | Visible | Hidden unless also assigned | Hidden unless also reviewer | Hidden unless also reviewer |
| Assigned worker + reviewer | Read-only or visible per template permissions | Visible | Visible | Visible |

## Platform Contract

### Web

- Ritual instructions and ritual evidence must coexist on the ritual instance page but remain visually distinct.
- Worker submission should remain close to the checklist item being fulfilled.
- Review actions should be available in context on the instance and from a reviewer backlog surface.

### Mobile

- Task detail is the hub for understanding ritual status.
- Requirement fulfillment opens a focused capture/submission screen when the action demands camera, GPS, or concentrated input.
- Mobile review supports urgent task-level action but does not need to be the primary backlog triage surface.

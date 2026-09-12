# Specification Quality Checklist: Composite Foreign Keys Stop Nulling the Tenant Column

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-12
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- **"No implementation details" is applied in the spirit of the rule, not the letter.**
  This is a database-integrity defect: the constraint names, the column names and the
  `ON DELETE SET NULL` semantics *are* the subject matter, and a spec that refused to name
  them would be unreviewable. The line held is that the spec states **what must be true
  after a delete** (FR-001 to FR-006) and leaves **how** to the plan — notably FR-002,
  which deliberately does not say whether the consistency CHECK is relaxed, replaced or
  turned into a trigger, and FR-005, which deliberately does not say what happens to the
  `RESTRICT` dependents.
- **Non-technical-stakeholder readability** is satisfied through the "Why this exists"
  section and the user stories, which are written in terms of what a person experiences —
  a delete that fails, a seed that will not re-run, a published promise that is not true.
- **Three assumptions the plan may overturn**, flagged here so a reviewer sees them without
  reading to the end of the spec: that a task outlives its origin message; that keeping a
  residual `source_channel_id` is acceptable because every reader already treats a half
  origin as no origin; and that the `ON DELETE RESTRICT` on the last-viewed pointer was
  incidental rather than intended.
- **Scope was widened beyond the reported one-line fix**, on evidence: the column-list fix
  alone leaves the consistency CHECK failing the same delete, and leaves the demo seed
  still blocked by a different constraint. Both are argued in "Two things the one-line fix
  does not cover". A reviewer who disagrees should cut User Story 2 or 3 rather than
  silently descope FR-002.
- Items marked complete require no spec updates before `/speckit-plan`.

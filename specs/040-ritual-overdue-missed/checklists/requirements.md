# Specification Quality Checklist: Overdue and Missed Rituals Become Real States with Alerts

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-03
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

- **Unattended run.** Every point that would have been a `[NEEDS CLARIFICATION]` marker was
  resolved with the default a senior engineer following this repository's conventions would
  pick, and recorded in the Assumptions section as `[ASSUMPTION: …]`. The four that most
  deserve a second look before planning are: the grace period being derived from
  `completion_window_hours` rather than a new configurable field; the reconciliation pass
  being a separate 5-minute job rather than a phase of the existing 1-minute generation
  sweep; the 7-day backfill horizon; and the owner/admin escalation fallback when a missed
  instance has no reviewer.
- **Domain vocabulary is used deliberately.** State category names (`todo`, `overdue`,
  `missed`, `verified`, `skipped`, `submitted`), assignment roles (`assignee`, `reviewer`,
  `approver`) and two field names (`completion_window_hours`, `completion_deadline`) appear
  in the spec. These are the product's own terms as recorded in
  `docs/domain/rituals-tasks.md`, not implementation choices, and the assumptions are not
  checkable without them. No language, framework, table layout, RPC name or code structure
  is specified.
- **FR-006 changes existing behaviour** on the evidence-driven path as well as the new sweep:
  a passed deadline now outranks partial progress. This is called out because it is the one
  requirement here that alters a rule already shipped, and it is what makes a half-finished
  checklist visible rather than hiding behind "in progress".
- Clears drift **D29**; SC-007 makes removing it from the drift register and the rituals
  domain document part of the acceptance criteria.

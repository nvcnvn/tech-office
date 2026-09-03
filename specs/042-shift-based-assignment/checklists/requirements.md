# Specification Quality Checklist: Ritual Assignment Follows the Shift

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

## Validation notes

Three items were failing on the first pass and were fixed before this checklist was
finalised:

1. **"Not testable" — the no-rota case.** The first draft said the instance is "left
   unassigned" without saying what happens next, which is untestable and would have left the
   implementer to invent a fallback. Resolved by splitting late binding into its own
   user story (Story 2) and requirements FR-008 through FR-016, each with a stated outcome.

2. **"Technology-agnostic success criteria."** SC-006 originally named the sweep interval and
   the query. Rewritten as an organization-scale statement (200 definitions, 30-day window)
   with no mechanism named. The one remaining structural constraint, FR-022, is deliberately
   phrased as a boundary the design must respect rather than as a design.

3. **"Scope clearly bounded."** The draft did not say whether the feature also assigns
   reviewers, splits an instance across a shift pair, or manages shifts. An Out of Scope
   section was added, including the `calendar.working_hours` substitute, which is the most
   likely wrong turn during planning.

Every judgement call the feature description left open was resolved in the Assumptions
section with an `[ASSUMPTION: ...]` marker stating what was chosen and why, rather than
deferred as a clarification question. The two decisions most worth a second look before
planning:

- **No fallback strategy when nobody is rostered.** The spec chooses wait-then-escalate.
  A reviewer who wants a fallback should say so explicitly, because the whole feature turns
  on this choice.
- **Least-assigned as the multi-candidate tie-break.** The alternative is a round-robin
  waterline over a daily-changing candidate set.

## Notes

- Items marked incomplete require spec updates before `/speckit-clarify` or `/speckit-plan`

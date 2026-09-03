# Specification Quality Checklist: Evidence Review Queue

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

**Validation run 1 (2026-09-03)** — all items pass. Two judgement calls recorded so a reviewer
can disagree with them explicitly:

1. **Existing domain vocabulary is used, not new implementation detail.** The spec names the
   `collab.reviewEvidence` permission, the `viewer` project role, the ritual state categories
   (`overdue`, `missed`, `verified`) and the `evidence_approved` / `evidence_rejected`
   notification types. These are the current system's stated behaviour recorded in
   `docs/domain/rituals-tasks.md`, not technology choices this feature is making. Naming them
   is what makes FR-011 and FR-016 testable — "reuse the existing decision path" is not a
   verifiable requirement without saying which path. No language, framework, RPC signature,
   table name or column type appears in the spec.
2. **One number is device-specific by intent.** FR-022 cites 360–430 dp portrait width. That is
   the mobile design constraint the project already binds all mobile work to, and dropping it
   would make the requirement untestable ("legible on a phone" is not a criterion).

**Unresolved ambiguities were defaulted rather than escalated**, as this was an unattended run.
Every default is recorded as an `[ASSUMPTION: ...]` entry in the spec's Assumptions section with
its reasoning. The three most consequential, and the ones most worth a human's disagreement:

- **Scoping approve/reject to the reviewer's projects is folded into this feature** rather than
  filed as a separate security fix. The current actions check only the org-wide permission. The
  queue makes that gap trivially discoverable, so shipping the queue without the fix would be a
  knowing regression. If the reviewer would rather ship the queue first, User Story 4 is the
  slice to defer, and the deferral should be recorded in the drift register.
- **The queue lists submissions, not tasks.** Grouping to the task would force an all-or-nothing
  decision the evidence model does not support.
- **Bulk approval is out of scope.** A bulk action that skims past individual evidence undermines
  the reason evidence is required at all.

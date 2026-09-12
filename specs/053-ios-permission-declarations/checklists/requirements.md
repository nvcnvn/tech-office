# Specification Quality Checklist: Declare only the permissions the app actually uses

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

One finding from validation, and its resolution:

- **A success criterion counted prompts wrongly.** SC-001 originally claimed
  four permission prompts on Android. The two location grades are declared
  separately but surface as a single prompt, so the number is three. Corrected;
  the criterion now states the prompts by name rather than by count alone, so
  the same slip cannot recur silently.

Two notes on how the spec reads:

- **Implementation detail was kept out deliberately.** The requirements
  describe capabilities in plain language — "background-location permission",
  "biometric-authentication permission", "local-network access" — rather than
  raw platform keys or library names, so a non-technical reader can evaluate
  them. The raw keys appear only in the verbatim user input quoted at the top.
- **Four assumptions were load-bearing enough to verify rather than assume.**
  Each was checked against the code before being recorded: that no biometric
  sign-in exists, that the Android biometric permissions arrive transitively,
  that the development-only opt-in already behaves correctly, and that the
  gate's existing string heuristic rejects the specific placeholder at issue.
  All four held. They are recorded as assumptions because they constrain the
  solution, not because they are unverified.

No [NEEDS CLARIFICATION] markers were needed. Every open question in the input
had a defensible default under the project's existing conventions, and each is
recorded in the Assumptions section for review.

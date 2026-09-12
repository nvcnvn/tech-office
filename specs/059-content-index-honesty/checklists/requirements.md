# Specification Quality Checklist: File content search that actually searches content

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

Three items needed a second pass before they passed.

**Implementation detail.** The first draft named a programming language and a
serialisation format when listing the places the dropped extraction method appears. Both
were replaced with role descriptions ("a backend constant", "a wire-contract enum value"),
which say the same thing to a reader who does not know the stack. The spec deliberately
still refers to a database constraint, a background job and a status endpoint: these are
the things being changed, and naming the *kind* of thing without naming the *technology*
is what keeps the requirements testable. No vendor, library, language or product name
appears anywhere in the document.

**Whether the finish-or-cut decision belongs in a spec.** The description offers two
mutually exclusive features and asks for one. Leaving that open would have made every
requirement conditional, so the decision is made up front, in its own section, with the
reasoning visible and recorded as the first assumption. A reviewer who disagrees can
reject one section rather than re-reading four hundred lines.

**Testability of the honesty requirements.** FR-021 and SC-008 assert something about the
test suite rather than about the product, which is unusual. They are kept because the
existing content-indexing tests pass today against a stub that extracts nothing — they
search for a token that also appears in the filename they uploaded under, so the filename
match satisfies them. Without an explicit requirement that the tests fail when extraction
is removed, this feature could be declared done by a suite that proves nothing, which is
precisely the failure the feature exists to correct. SC-008 states how to verify it: delete
the implementation, watch the tests go red, put it back.

Nine assumptions are recorded inline with `[ASSUMPTION: ...]` markers, covering the
finish-versus-cut decision, the route used for office documents, the extraction-method
label, the text cap, the time limit, backfill, the breaking contract change, snippets, and
type detection ordering. Each states what was assumed and why, for review at planning.

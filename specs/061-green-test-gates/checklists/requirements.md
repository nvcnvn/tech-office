# Specification Quality Checklist: Green and Enforced Test Gates

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

**On "no implementation details".** This feature's users are the engineers working in this
repository and its subject matter *is* the repository's own tooling, so named commands
(`make test-frontend`, `make test-mobile`, `pnpm run typecheck:mobile`), named spec files
and named drift rows are the vocabulary of the problem, not leaked implementation. They
are what makes the requirements testable. What the spec deliberately does not decide is
*how* each fix is made: the shape of the seeding command, which side of the timezone
disagreement moves, and how the concurrency-dependent spec is isolated are all left to
planning.

**Verified rather than assumed.** The measurements in the spec's "What was verified"
table were taken against commit `c2747b3`: `pnpm run typecheck:mobile` exits 0,
`.github/workflows/` holds only `publish-images.yml`, the D40 row is absent from the
register while three documents still reference it, `registerOwner()` in
`user-guide-screenshots.spec.ts` omits `acceptedTermsVersion`, and `TERMS_VERSION` matches
`CurrentTermsVersion` at `2026-08-27`. FR-001 and FR-002 exist because two of the register's
claims did not survive that check.

**Resolved without asking**, per the unattended run. Each is recorded as an
`[ASSUMPTION: ...]` in the spec's Assumptions section: which specs "the four" names and
why D45 and D42 were pulled in with them; that the three mobile type errors are already
fixed so FR-027 verifies rather than repairs; that CI scope is the mobile check alone and
not the heavier suites; that D40's row was deleted by accident; that the fixture is seeded
by a backend command in the `seed-demo-org` style; and that the fixture covers the standing
suite rather than all 42 flow files.

**Deliberately left open**, and stated as such in FR-031 rather than silently dropped:
D37, D18, D47, D51 and D67. Each is a real problem with these suites that this feature does
not solve.

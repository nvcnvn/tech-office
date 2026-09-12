# Contract: `docs/compliance/age-rating-answers.md`

**Feature**: 054 | Covers FR-006 – FR-015 | Contract for US2.

The document's consumer is a person with a store console open. Its contract is therefore
structural, not executable: what sections exist, what each must contain, and what must be
true of every answer. SC-003 is met when someone who has never seen the codebase completes
the social-media capability section of either form from this document alone.

---

## Required structure

```
# Age rating answers

<purpose: the single source both stores' age-rating questionnaires are filled in from>
<last checked against the live forms: YYYY-MM-DD>          ← FR-014
<Definition of Done — standing obligation>                 ← FR-014

## The workspace boundary                                  ← FR-009
## Safeguards                                              ← FR-010
## App Store Connect                                       ← FR-013
### <the mandatory capability group, as the console names it>
   <table of Age-rating answer rows>                       ← FR-007, FR-008
### Resulting rating                                       ← FR-012
## Play Console (IARC)                                     ← FR-013
### <the mandatory capability group, as the console names it>
   <table of Age-rating answer rows>
### Resulting rating                                       ← FR-012
## Capabilities the app does not have                      ← recorded-absence section
```

## Section requirements

### The workspace boundary (FR-009)

States, as fact and before any answer is read, that a TechOffice workspace is closed:
membership arises only from an invitation or from an administrator creating the account,
and no surface anywhere reaches a person in another workspace. This is the sentence that
makes the document's several honest `Yes` answers mean something other than "social
network", so it comes before them rather than as a footnote to them.

Cites: `AcceptInvitation` and admin member management; the tenancy rule that every table
carries `organization_id` and every query pins it, machine-checked by `make lint-tenancy`.

### Safeguards (FR-010)

Lists the after-the-fact safeguards that accompany unmoderated content, all five:

1. In-app reporting, from a message's own menu.
2. The owner-side report queue, with its snapshot of the content as it stood at report
   time, so a report survives deletion of its subject. Web-only, behind
   `compliance.reviewReports`.
3. Blocking, scoped to direct contact — direct conversations and calls — and deliberately
   not hiding a colleague's messages in a shared work channel. The scope is stated with its
   reason, because a reviewer comparing this to a consumer app will otherwise read it as a
   gap.
4. Published terms prohibiting objectionable content, with acceptance recorded per account.
5. The monitored abuse address, `ABUSE_CONTACT_EMAIL` in
   `frontend/packages/apis/src/legal.ts`.

### The per-store answer tables (FR-007, FR-008, FR-013)

One table per store, columns: **Question | Answer | Evidence | Qualifier**
(data-model §1). The two tables are independent — a question one console asks and the other
does not appears only in the console that asks it, and neither table refers the reader to
the other for an answer.

The mandatory social-media capability group must cover at least, per FR-007:

- a feed of user-posted content
- person-to-person messaging
- person-to-person calling
- discovery of other users, and contact with them
- public profiles
- follower or friend relationships
- contact with people outside the workspace
- pre-publication moderation

plus the two the spec calls out separately:

- location sharing with other users (FR-011) — answered from what the app does with a
  task-evidence coordinate and with a calendar check-in coordinate, naming who can see
  each. Research R-4 has the verified facts and the drift finding that goes with them.
- whichever of in-app browsing, purchases, advertising, gambling or mature content the live
  form asks about — answered from the dependency tree, and in the browsing case with the
  qualifier that links posted by colleagues open in the system browser rather than inside
  the app.

**Every row's Evidence cell** names a screen path, a reproducible behaviour, or a file or
symbol in the code. A cell that restates the answer is an uncited answer and fails SC-004.

### Resulting rating (FR-012)

Per store: the rating the questionnaire produces from the answers above, with the answers
that drive it named. Until the first submission confirms it against the live form, the
recorded rating carries an explicit `provisional — not yet confirmed against the live form`
marker and the date of the expectation (research R-7 assumption). The rating is recorded as
an **outcome**; nothing in the document works backwards from a target.

### Capabilities the app does not have

The document's recorded-absence section, declared to the gate
([prose-gate.md](prose-gate.md)). Any capability the answers must deny by name — biometric
sign-in, background location, an embedded browser — is named here with its reason, rather
than inside an answer cell where the gate would read it as a live claim.

---

## Cross-document requirement (FR-015)

`docs/compliance/data-collection-inventory.md`'s `### Age rating` section is **removed**
and replaced by a one-line pointer to this document. After this feature, searching the
repository for an age-rating answer returns exactly one file (SC-006). The inventory keeps
its privacy-form sections, which are a different form with a different audience.

## Standing obligation (FR-014)

Stated in the document, in the same shape as the inventory's existing Definition of Done
block: **a change that adds, removes, or reshapes a communication or content-sharing
capability updates this file in the same change set.** Plus the date the answers were last
checked against the live questionnaires, so a stale answer set is visible rather than
silently assumed current.

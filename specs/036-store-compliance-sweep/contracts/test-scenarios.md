# Behavioural Contract: Store Compliance Sweep

**Constitution Principle II gate.** These scenarios are the agreed description of what the
feature does. They must be approved before `/speckit-tasks` runs and before any code is
written. Scenario names are written so a non-technical reader can check them against the spec;
`go test -v` output reads as a behaviour specification.

Coverage: all 6 user stories, 40 of 44 functional requirements. The 4 exclusions are listed at
the end with justification, as Principle II requires.

---

## Backend integration — `backend/integration/iam_account_deletion_test.go`

```
TestAccountDeletion
  when a self-registered person deletes their account
    it signs them out on every device immediately              FR-003
    their credentials no longer authenticate                   FR-004
    their personal profile is no longer retrievable            FR-004
    their organization memberships end                          FR-007e
    the organizations they belonged to still exist              FR-007
  when a deleted person authored content in another's workspace
    their messages remain readable to that workspace            FR-006
    their messages no longer identify them                      FR-006
    their tasks and documents remain attributed to nobody       FR-006
  when the sole owner of a populated workspace tries to delete
    it refuses                                                  FR-005
    the refusal names every blocking workspace                  FR-005
    the refusal carries the structured sole-owner detail        FR-005
  when the sole owner of an empty workspace deletes
    it succeeds                                                 FR-005
  when a person previews deletion before confirming
    it states which data is erased                              FR-002
    it states which data is retained and why                    FR-002
  when an admin-provisioned worker opens their deletion path
    it reports the request-removal path, not self-delete        FR-001a, FR-007b
    it names their managing organization                        FR-007b
  when an admin-provisioned worker calls delete directly
    it refuses                                                  FR-007a
  when a person who self-registered was later provisioned elsewhere
    they keep the full self-deletion path                       FR-007f
  when deletion fails partway through
    the deletion record shows the last completed state          (edge case, R3)
    re-running the worker completes it                          (edge case, R3)
```

## Backend integration — `backend/integration/iam_removal_request_test.go`

```
TestRemovalRequest
  when a provisioned worker requests removal
    the request is recorded as outstanding                      FR-007c
    the workspace owners are notified                           FR-007c
    the worker can see their own request is outstanding         FR-007d
  when the same worker requests removal again
    it returns the existing request rather than a duplicate     FR-007c
  when an owner grants a removal request
    the worker's membership ends                                FR-007e
    their employee record is de-identified but retained         FR-006, FR-007a
  when that was the worker's last membership
    their global identity data is deleted                       FR-007e
  when an owner declines a removal request
    the membership is unchanged                                 FR-007d
    the worker can see the decision                             FR-007d
  when an owner offboards a worker with a request outstanding
    the outstanding request does not linger                     (edge case)
  when a non-owner tries to list removal requests
    it returns permission denied                                FR-007d
```

## Backend integration — `backend/integration/iam_terms_test.go`

```
TestTermsAcceptance
  when a person signs up without accepting the terms
    it is rejected                                              FR-010
  when a person signs up accepting the terms
    the accepted version and time are recorded                  FR-011
  when a person accepts a version that is not current
    it is rejected                                              FR-011
  when an admin-provisioned worker first signs in
    terms status reports they have not accepted                 FR-012
    after accepting, the version and time are recorded          FR-012
  when the current terms version is bumped
    a previously accepting person reports as not current        FR-011
```

## Backend integration — `backend/integration/compliance_report_test.go`

```
TestContentReporting
  when a person reports a chat message
    the report is recorded as outstanding                       FR-014, FR-016
    it records who reported, who authored, and when             FR-016
    it stores the content as it stood at report time            FR-016
    the reporter receives confirmation                          FR-015
  when a person reports without giving a reason
    it is rejected                                              FR-015
  when a person reports a direct message, file, document comment, or call
    each is recorded with the correct target kind               FR-014
  when the reported message is later deleted by its author
    the report is still reviewable with its snapshot            FR-018
  when a person reports the same item twice
    the second report is rejected                               (edge case)
  when an owner lists outstanding reports
    every filed report appears                                  FR-017
    reports are ordered newest first and page by cursor         FR-017
  when an owner resolves a report
    the outcome and reviewer are recorded                       FR-017
    it no longer appears as outstanding                         FR-018
  when an owner resolves without an outcome note
    it is rejected                                              FR-017
  when an owner resolves an already-resolved report
    it is rejected                                              FR-017
  when an employee tries to list reports
    it returns permission denied                                FR-017
  when a person reports a workspace owner
    the report is still recorded and visible to other owners    (edge case)
```

## Backend integration — `backend/integration/compliance_block_test.go`

```
TestBlocking
  when a person blocks someone
    the block is recorded                                       FR-019
    the blocked person is not notified                          FR-022
    no RPC reveals to the blocked person that they are blocked  FR-022
  when a blocked person starts a direct conversation
    it is refused                                               FR-020
  when a blocked person places a call
    it is refused                                               FR-020
  when a blocked person posts in a shared channel
    their message is still visible to the blocker               FR-021a
  when a block is in effect
    prior direct conversation history is hidden from the blocker FR-021
    the blocker can reveal an individual hidden item            FR-021
    both people remain members of every shared channel          FR-023
    the blocker's own content is unchanged for everyone else    FR-023
  when a person tries to block themselves
    it is rejected                                              FR-019
  when a person blocks someone already blocked
    it does not create a duplicate                              FR-019
  when a person unblocks someone
    direct conversations and calls work again                   FR-019
    hidden history becomes visible again                        FR-019
  when a person lists who they have blocked
    every current block appears                                 FR-024
  when a blocked person and blocker are added to a new group conversation
    neither is removed and the conversation works               (edge case)
```

---

## Web E2E — `frontend/apps/web/e2e/`

Names mirror the backend scenarios so both suites tell the same story. Arrange via API, act via
UI, assert via UI.

```
account-deletion.spec.ts
  when a person deletes their account
    the settings page offers account deletion                   FR-001
    the confirmation states what is erased and retained         FR-002
    after confirming, they are returned signed out              FR-003
  when a sole owner of a populated workspace tries to delete
    the page lists the blocking workspaces                      FR-005
  when a provisioned worker opens account settings
    they see the request-removal path and their org's name      FR-007b
    they can submit a removal request                           FR-007c

legal-surface.spec.ts
  when a visitor opens the privacy policy without signing in
    the page renders                                            FR-008
  when a visitor opens the terms without signing in
    the page renders                                            FR-008
    the terms prohibit abusive content and state consequences   FR-009
    an abuse contact address is shown                           FR-013
  when a person signs up
    they cannot proceed without acknowledging the terms         FR-010
    the terms and privacy policy are linked from that screen    FR-010
  when a person is signed in
    settings links to the privacy policy, terms, and abuse contact  FR-013

compliance-report.spec.ts
  when a person reports a message
    the message menu offers reporting                           FR-014
    submitting requires choosing a reason                       FR-015
    a confirmation is shown                                     FR-015
  when an owner opens the report queue
    outstanding reports are listed with their content           FR-017
    resolving one records the outcome                           FR-017
    a resolved report leaves the outstanding list               FR-018
  when an employee opens the report queue URL directly
    access is denied                                            FR-017

compliance-block.spec.ts
  when a person blocks someone
    blocking takes at most three interactions from their content  SC-004
    the blocked person's direct history is hidden               FR-021
    their shared-channel messages remain visible                FR-021a
    the blocked list shows them                                 FR-024
    unblocking restores everything                              FR-019
```

## Mobile — `frontend/apps/mobile/.maestro/compliance/`

Happy paths only, per Constitution XIII.

```
report-message.yaml     long-press a message, report it, see confirmation      FR-014, FR-015
block-person.yaml       block from a profile, confirm they leave the DM list   FR-019, FR-024
delete-account.yaml     settings, delete account, confirmation, signed out     FR-001, FR-002
removal-request.yaml    provisioned worker sees their path and requests removal FR-007b, FR-007c
legal-links.yaml        settings opens privacy, terms, abuse contact           FR-013
```

## Build-time check — `frontend/apps/mobile/scripts/check-store-manifest.js`

Not a test suite; a CI assertion that fails the build. Covers what a runtime test cannot,
because these are properties of the generated native manifests.

```
  every declared iOS permission is in the expected set          FR-026
  every declared Android permission is in the expected set      FR-026
  no background-location key is declared                        FR-027
  the Android notification permission is declared               FR-028
  no local-network or Bonjour key is declared                   FR-029
  no permission string contains a development-only phrase       FR-029
  every permission string is longer than the framework default
    and names a feature                                         FR-025
  the encryption-compliance key is present                      (R11)
```

---

## Requirements excluded from automated coverage

Principle II requires exclusions to be justified rather than silent.

| FR | Why excluded | How it is verified instead |
|---|---|---|
| **FR-030** | A written justification per permission is a document, not behaviour. | `docs/compliance/permission-justifications.md` exists and lists every permission the manifest check allows; a mismatch fails the same CI check. |
| **FR-034** | The data-collection inventory is a document. | `docs/compliance/data-collection-inventory.md`, reviewed as part of the change set. |
| **FR-035** | Both stores' privacy forms live in App Store Connect and Play Console, outside this repository. | Manual step in the submission runbook, cross-checked against FR-034's inventory. |
| **FR-036** | "Update the inventory when new collection ships" is a process obligation on future changes. | Added to the Definition of Done in `docs/compliance/data-collection-inventory.md`. |

FR-031, FR-032 and FR-033 (demo workspace and reviewer notes) are partially covered: the seed
command's idempotency and the demo PIN's non-expiry are asserted in
`backend/integration/demo_seed_test.go`, while the quality of the written notes is a human
review step.

---

**Approval**: this contract is unapproved until the owner says so. `/speckit-tasks` must not run
before then.

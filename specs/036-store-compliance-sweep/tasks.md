---

description: "Task list for App Store & Google Play Compliance Sweep"
---

# Tasks: App Store & Google Play Compliance Sweep

**Input**: Design documents from `/specs/036-store-compliance-sweep/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/)

**Tests**: REQUIRED, not optional. Constitution Principle II is non-negotiable: scenario stubs
are written before implementation, and a feature is done only when the entire backend
integration suite, the entire E2E suite and the entire Maestro suite pass. The approved
behavioural contract is [contracts/test-scenarios.md](contracts/test-scenarios.md).

**Organization**: Grouped by user story so each ships independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1–US6, mapping to the user stories in [spec.md](spec.md)

## Path Conventions

Backend Go at `backend/`, Next.js web at `frontend/apps/web/`, Expo mobile at
`frontend/apps/mobile/`, shared API wrappers at `frontend/packages/apis/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Schema, generated code and contracts that later phases build on.

- [ ] T001 Write migration `backend/k8s/base/database/migrations/20260827000001_store_compliance.up.sql` creating `compliance.content_report`, `compliance.block`, `compliance.removal_request`, `compliance.account_deletion` per [data-model.md](data-model.md), with `PRIMARY KEY (organization_id, id)`, composite FKs to `organization.employee(organization_id, id)`, no triggers and no `ON DELETE SET NULL`
- [ ] T002 Add the same four tables to `backend/database/scripts/schema.sql` so schema and migration stay aligned, plus `SELECT create_distributed_table(...)` colocated with `public.organization` for each
- [ ] T003 Add `terms_version_accepted TEXT` and `terms_accepted_at TIMESTAMPTZ` to `iam.user` in both `backend/database/scripts/schema.sql` and the T001 migration
- [ ] T004 Add `COMMENT ON COLUMN iam.identity.id` in the T001 migration recording that it is the same UUID as `iam.user.id` and `organization.employee.id` (research.md R2 — currently undocumented and load-bearing)
- [ ] T005 Seed the four new permission rows `compliance.reportContent`, `compliance.blockPerson`, `compliance.reviewReports`, `compliance.manageRemovalRequests` into `public.permission` and attach them to default roles per the matrix in [contracts/compliance.proto.md](contracts/compliance.proto.md)
- [ ] T006 Run `cd backend && ./scripts/migrate.sh` against a local Citus instance and confirm every table distributes without a Citus constraint error
- [ ] T007 Write `backend/database/scripts/compliance.query.sql` with sqlc-annotated queries for reports, blocks, removal requests and deletion records; every query filters `organization_id` explicitly
- [ ] T008 Run sqlc generation and verify `backend/database/compliance.query.sql.go` and the new models compile

**Checkpoint**: Schema exists and generated Go types are available.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Contracts, cross-stack constants and the test scaffold. **No user story work may
begin until this phase completes.**

**⚠️ Principle VIII trap**: T012–T015 each synchronise one enumeration across four places.
Keep them atomic — one enumeration per task, all four representations in the same commit.

- [ ] T009 Create `backend/rpc/v1/compliance.proto` declaring `ComplianceService` with all 11 RPCs and `rpc.v1.access_control` annotations exactly as specified in [contracts/compliance.proto.md](contracts/compliance.proto.md); no request message carries `organization_id`
- [ ] T010 Add `DeleteMyAccount`, `GetAccountDeletionPreview`, `AcceptTerms`, `GetTermsStatus` to `backend/rpc/v1/iam.proto` per [contracts/iam-deletion.proto.md](contracts/iam-deletion.proto.md), and add `accepted_terms_version` as a required field on `Signup` and `AcceptInvitation`
- [ ] T011 Add the `SoleOwnerBlocksDeletion` structured detail to `backend/rpc/v1/iam_error_details.proto` carrying repeated `{organization_id, organization_name, member_count}` (Principle X)
- [ ] T012 [P] Synchronise the **report reason** enumeration across the SQL `CHECK` in `backend/database/scripts/schema.sql`, Go constants in `backend/internal/compliance/constants.go`, the proto enum in `backend/rpc/v1/compliance.proto`, and the TypeScript union in `frontend/packages/apis/src/compliance.ts`
- [ ] T013 [P] Synchronise the **report status/outcome** enumeration across the same four locations
- [ ] T014 [P] Synchronise the **removal-request status** enumeration across the same four locations
- [ ] T015 [P] Synchronise the **account-deletion state** enumeration across the same four locations
- [ ] T016 Create the `backend/internal/compliance` package skeleton: `logic.go` with the DBTX-taking interface, `connect_report.go`, `connect_block.go`, `connect_removal.go` transport shells, and registration in the server wiring (Principle III two-layer split)
- [ ] T017 Create `frontend/packages/apis/src/compliance.ts` following the existing wrapper pattern in `frontend/packages/apis/src/chat.ts`, and export it from `frontend/packages/apis/src/index.ts` (Principle VII)
- [ ] T018 [P] Write backend scenario stubs with `t.Skip("TODO")` and `// FR-XXX` comments in `backend/integration/iam_account_deletion_test.go`, `iam_removal_request_test.go`, `iam_terms_test.go`, `compliance_report_test.go`, `compliance_block_test.go`, transcribing [contracts/test-scenarios.md](contracts/test-scenarios.md) verbatim
- [ ] T019 [P] Write E2E scenario stubs with `test.skip` in `frontend/apps/web/e2e/account-deletion.spec.ts`, `legal-surface.spec.ts`, `compliance-report.spec.ts`, `compliance-block.spec.ts`, mirroring the backend scenario names
- [ ] T020 Run `go test ./integration/... -v` and confirm the stub output reads as a behaviour specification with every scenario skipped, not failing

**Checkpoint**: Contracts frozen, constants synchronised, behavioural contract executable as skips.

---

## Phase 3: User Story 1 — Account deletion (Priority: P1) 🎯 MVP

**Goal**: A self-registered person deletes their own account from inside the app; a provisioned
worker gets the removal-request path instead.

**Independent Test**: Create an account, use it, delete it from within the app, confirm the
credentials no longer authenticate and the personal profile is gone while the organization's
records survive de-identified.

### Backend

- [ ] T021 [US1] Implement `IsSoleOwnerOfPopulatedOrg` in `backend/internal/iam/logic_account_deletion.go`, returning the organization names and member counts that block deletion (FR-005)
- [ ] T022 [US1] Implement membership enumeration `SELECT organization_id FROM iam.identity WHERE id = $1` in `backend/database/scripts/iam.query.sql` and its logic wrapper, running on `AdminPool` with the cross-shard justification comment from research.md R5 (FR-007e)
- [ ] T023 [US1] Implement the anonymise step in `backend/internal/iam/logic_account_deletion.go`: strip `given_name`, `family_name`, `email`, `date_of_birth`, `phone_number`, `home_address`, `additional_info` from `organization.employee` and set `is_active = false` (FR-004, FR-006)
- [ ] T024 [US1] Implement the purge step: delete `iam.identity`, `iam.credential`, `iam.employee_role`, `iam.user_preference` per organization, and on the final organization delete `iam.user` so the existing cascades clear `sso_identity`, `password_credential`, `password_reset_token` and `session` (FR-004, FR-007e)
- [ ] T025 [US1] Implement the background worker driving `compliance.account_deletion` through `pending → anonymising → purging → done`, resumable from the last completed state, in `backend/internal/compliance/worker_deletion.go` (Principle XI, research.md R3)
- [ ] T026 [US1] Implement `DeleteMyAccount` in `backend/internal/iam/connect_account_deletion.go`: reject when `is_org_managed` is true (FR-007a), reject with the `SoleOwnerBlocksDeletion` detail when T021 blocks (FR-005), otherwise invalidate all sessions synchronously (FR-003) and enqueue the worker
- [ ] T027 [US1] Implement `GetAccountDeletionPreview` returning server-assembled erased and retained categories so mobile and web cannot describe different behaviour (FR-002)
- [ ] T028 [US1] Implement `GetAccountRemovalPath` in `backend/internal/compliance/connect_removal.go`, branching on `iam.user.is_org_managed` and returning the managing organization's name plus any outstanding request (FR-001a, FR-007b)
- [ ] T029 [US1] Implement `RequestAccountRemoval`, returning the existing outstanding request rather than erroring on a repeat, and notifying the organization's owners through `internal/notification` (FR-007c)
- [ ] T030 [US1] Implement `ListRemovalRequests` and `DecideRemovalRequest`; granting ends the membership and, when it was the last, enqueues the global purge; ordinary admin offboarding resolves any outstanding request as a side effect (FR-007d, FR-007e, edge case)

### Web

- [ ] T031 [P] [US1] Add the account-deletion section to `frontend/apps/web/src/app/workspace/settings/page.tsx`, showing the preview from T027 and requiring the confirmation phrase (FR-001, FR-002)
- [ ] T032 [P] [US1] Render the `SoleOwnerBlocksDeletion` detail as a list of blocking workspaces with transfer-or-close links, not a bare error string (FR-005)
- [ ] T033 [P] [US1] Add the removal-request queue for owners at `frontend/apps/web/src/app/workspace/settings/removal-requests/page.tsx`, web-only per Constitution XIII (FR-007d)

### Mobile

- [ ] T034 [US1] Add the deletion and removal-request entry point to `frontend/apps/mobile/src/app/(app)/(more)/settings.tsx`, branching on `GetAccountRemovalPath` so the right screen renders without client-side inference (FR-001, FR-007b)
- [ ] T035 [US1] Build the deletion confirmation screen at `frontend/apps/mobile/src/app/(app)/(more)/delete-account.tsx` with the confirmation phrase guard against an accidental irreversible tap (FR-002)
- [ ] T036 [US1] Build the removal-request screen showing the managing organization and any outstanding request (FR-007b, FR-007c)

### Tests

- [ ] T037 [US1] Replace the `t.Skip` stubs in `backend/integration/iam_account_deletion_test.go` with real implementations, including the resumable partial-failure scenario
- [ ] T038 [P] [US1] Replace the stubs in `backend/integration/iam_removal_request_test.go`
- [ ] T039 [P] [US1] Replace the `test.skip` stubs in `frontend/apps/web/e2e/account-deletion.spec.ts`
- [ ] T040 [P] [US1] Add Maestro flows `frontend/apps/mobile/.maestro/compliance/delete-account.yaml` and `removal-request.yaml`

**Checkpoint**: Deletion works end to end on both paths. Store blocker #1 cleared.

---

## Phase 4: User Story 2 — Legal surface (Priority: P1)

**Goal**: Privacy policy and terms are published, linked, and accepted at signup.

**Independent Test**: Load both pages in a browser while signed out, then attempt signup
without acknowledging and confirm refusal.

**Note**: Depends only on T010 from Phase 2, not on the compliance schema. Can run fully in
parallel with Phase 3.

- [ ] T041 [P] [US2] Create the public route `frontend/apps/web/src/app/privacy/page.tsx` with the privacy policy content, reachable without sign-in (FR-008)
- [ ] T042 [P] [US2] Create the public route `frontend/apps/web/src/app/terms/page.tsx`, whose text prohibits abusive and objectionable content, states the consequences of posting it, and publishes the monitored abuse contact address (FR-008, FR-009, FR-013)
- [ ] T043 [US2] Define the current terms version as a single constant shared by backend and clients, and implement `AcceptTerms` and `GetTermsStatus` in `backend/internal/iam/connect_terms.go`, rejecting a non-current version (FR-011)
- [ ] T044 [US2] Enforce `accepted_terms_version` on `Signup` and `AcceptInvitation` in `backend/internal/iam/`, rejecting requests without it — a breaking change shipped atomically per the project's no-backward-compatibility stance (FR-010)
- [ ] T045 [P] [US2] Add the acceptance checkbox and links to both documents to `frontend/apps/web/src/app/signup/components/SignupForm.tsx` (FR-010)
- [ ] T046 [P] [US2] Add the acceptance checkbox and links to `frontend/apps/mobile/src/app/(auth)/signup.tsx` (FR-010)
- [ ] T047 [US2] Gate first use on `GetTermsStatus` for admin-provisioned workers, who never saw a signup screen, in `frontend/apps/mobile/src/app/(onboarding)/` (FR-012)
- [ ] T048 [P] [US2] Add privacy, terms and abuse-contact links to `frontend/apps/mobile/src/app/(app)/(more)/settings.tsx`, opening them with `expo-web-browser` rather than duplicating the text natively (FR-013, research.md R10)
- [ ] T049 [P] [US2] Add the same three links to the web settings page (FR-013)
- [ ] T050 [P] [US2] Replace the stubs in `backend/integration/iam_terms_test.go`
- [ ] T051 [P] [US2] Replace the stubs in `frontend/apps/web/e2e/legal-surface.spec.ts`
- [ ] T052 [P] [US2] Add the Maestro flow `frontend/apps/mobile/.maestro/compliance/legal-links.yaml`

**Checkpoint**: A privacy policy URL exists to paste into both submission forms. Store blocker #2 cleared.

---

## Phase 5: User Story 3 — Reporting and blocking (Priority: P1)

**Goal**: People can report abusive content and block direct contact; owners review reports.

**Independent Test**: With two accounts in one workspace, report a message and block its author,
then confirm an owner sees the report and the blocked person can no longer DM or call.

### Reporting

- [ ] T053 [US3] Implement `ReportContent` in `backend/internal/compliance/connect_report.go`: the server resolves the reported author and takes the content snapshot by calling the owning domain's service, so a client cannot forge authorship (FR-014, FR-015, FR-016)
- [ ] T054 [US3] Implement snapshot resolution for all five target kinds — chat message, direct message, file, document comment, call record — through service calls, never cross-schema joins (FR-014, Principle IV)
- [ ] T055 [US3] Reject a duplicate outstanding report from the same reporter against the same target at the logic layer, with a message rather than a constraint violation (edge case)
- [ ] T056 [US3] Implement `ListReports` and `GetReport` with cursor pagination on `(organization_id, id DESC)` using a nullable UUID v7 cursor (FR-017, Principle IX)
- [ ] T057 [US3] Implement `ResolveReport`, requiring a non-empty outcome note and rejecting re-resolution of an already-resolved report (FR-017, FR-018)

### Blocking

- [ ] T058 [US3] Implement `BlockPerson`, `UnblockPerson` and `ListBlockedPeople` in `backend/internal/compliance/connect_block.go`; unblock is idempotent, and no RPC exists that reveals to a person who has blocked them (FR-019, FR-022, FR-024)
- [ ] T059 [US3] Add the block guard to `CreateOrGetDirectMessage` in `backend/internal/chat/` (FR-020)
- [ ] T060 [US3] Add the block guard to voice-call initiation in `backend/internal/voice/` (FR-020)
- [ ] T061 [US3] Confirm no notification is emitted anywhere on the block path, and that blocking writes only to `compliance.block` — never to channel membership (FR-022, FR-023)

### Web

- [ ] T062 [P] [US3] Add the report action to the message, file and document-comment menus in `frontend/apps/web/src/app/workspace/chat/` and the docs surface (FR-014)
- [ ] T063 [P] [US3] Build the report dialog requiring a reason and offering an optional note, with on-screen confirmation (FR-015)
- [ ] T064 [P] [US3] Build the owner report queue at `frontend/apps/web/src/app/workspace/settings/reports/page.tsx`, rendering the snapshot so it works after the original is deleted (FR-017, FR-018)
- [ ] T065 [P] [US3] Add block, unblock and the blocked-people list to the web member and settings surfaces (FR-019, FR-024)

### Mobile

- [ ] T066 [US3] Build the report sheet at `frontend/apps/mobile/src/components/compliance/ReportSheet.tsx`, reachable in three taps or fewer from seeing content (FR-014, FR-015, SC-003)
- [ ] T067 [US3] Wire the report action into the chat message long-press menu in `frontend/apps/mobile/src/components/chat/` (FR-014)
- [ ] T068 [US3] Build block and unblock confirmation at `frontend/apps/mobile/src/components/compliance/BlockConfirm.tsx`, reachable in three taps or fewer (FR-019, SC-004)
- [ ] T069 [US3] Add the blocked-people list to `frontend/apps/mobile/src/app/(app)/(more)/blocked.tsx` (FR-024)
- [ ] T070 [US3] Hide direct-conversation history and call records from a blocked person in the blocker's view, with a per-item reveal; leave shared channels untouched (FR-021, FR-021a)

### Tests

- [ ] T071 [US3] Replace the stubs in `backend/integration/compliance_report_test.go`, including the report-survives-deletion scenario
- [ ] T072 [P] [US3] Replace the stubs in `backend/integration/compliance_block_test.go`, including the assertion that no notification is emitted and that shared-channel messages stay visible
- [ ] T073 [P] [US3] Replace the stubs in `frontend/apps/web/e2e/compliance-report.spec.ts` and `compliance-block.spec.ts`
- [ ] T074 [P] [US3] Add Maestro flows `frontend/apps/mobile/.maestro/compliance/report-message.yaml` and `block-person.yaml`

**Checkpoint**: Guideline 1.2 and Play's UGC policy are satisfied. Store blocker #3 cleared.

---

## Phase 6: User Story 4 — Permission manifest (Priority: P2)

**Goal**: The app declares only what it uses and explains each prompt in plain language.

**Independent Test**: Prebuild, run the manifest check, install on a fresh Android 13+ device and
confirm push arrives after granting notification permission.

**Note**: Independent of Phases 1–5 entirely. **T077 fixes a live functional bug** — push
notifications are silently dropped on Android 13+ today — so consider pulling this phase forward
regardless of its P2 label.

- [ ] T075 [US4] Rewrite every permission string in `frontend/apps/mobile/app.json` to name the feature it enables in ordinary language: photos for attaching to chat and tasks, microphone for voice calls, camera, Face ID, and location as confirming presence at a job site rather than "ritual task verification" (FR-025)
- [ ] T076 [US4] Configure the `expo-location` plugin so no background-location key is generated, and confirm `NSLocationAlwaysUsageDescription` and `NSLocationAlwaysAndWhenInUseUsageDescription` are absent from the prebuilt `Info.plist` (FR-027)
- [ ] T077 [US4] Add `android.permission.POST_NOTIFICATIONS` to `frontend/apps/mobile/app.json` and request it at the first point notifications matter, handling refusal gracefully (FR-028)
- [ ] T078 [US4] Add `android.blockedPermissions` for `SYSTEM_ALERT_WINDOW`, `READ_EXTERNAL_STORAGE` and `WRITE_EXTERNAL_STORAGE`, which arrive transitively and are used by nothing (FR-026)
- [ ] T079 [US4] Remove `NSLocalNetworkUsageDescription` and `NSBonjourServices` from the production configuration — the string currently reads "local development server while debugging" (FR-029)
- [ ] T080 [US4] Add `ITSAppUsesNonExemptEncryption: false` to `ios.infoPlist` (research.md R11)
- [ ] T081 [US4] Write `frontend/apps/mobile/scripts/check-store-manifest.js` asserting every check listed in [contracts/test-scenarios.md](contracts/test-scenarios.md#build-time-check), and wire it into CI so a future dependency cannot silently reintroduce a permission (FR-026, FR-029)
- [ ] T082 [P] [US4] Write `docs/compliance/permission-justifications.md` with a pasteable justification per permission, and make T081 fail when the document and the manifest disagree (FR-030)
- [ ] T083 [US4] Build a release candidate on a physical Android 13+ device, grant notification permission and confirm a push actually arrives (SC-007)

**Checkpoint**: The manifest is honest and Android push works.

---

## Phase 7: User Story 5 — Reviewer access (Priority: P2)

**Goal**: A reviewer signs in unaided and reaches content that exercises reporting and blocking.

**Independent Test**: Hand the notes to someone unfamiliar with the product and time them to a
populated conversation.

**Note**: Depends on Phase 5 — the demo workspace must contain reportable content.

- [ ] T084 [US5] Add the `seed-demo-org` subcommand to `backend/cmd/tools.go`, idempotent on re-run, producing chat, tasks, calendar entries, documents and at least one reportable message (FR-031)
- [ ] T085 [US5] Ensure the seeded PIN worker gets a **permanent** PIN, not the ordinary temporary one that expires in three days and forces `pin_change_required` (FR-033, research.md R12)
- [ ] T086 [US5] Write `docs/compliance/reviewer-notes.md` covering every sign-in path, leading with the self-registered owner credential because it is the only one whose settings show the full deletion path, and stating why the PIN account's path differs (FR-032)
- [ ] T087 [US5] Add to the reviewer notes an explicit sentence that blocking is scoped to direct contact because this is a closed workplace tool — otherwise a reviewer testing a block inside a shared channel reads the visible messages as a missing feature (research.md R8)
- [ ] T088 [P] [US5] Add `backend/integration/demo_seed_test.go` asserting the seed is idempotent and the demo PIN does not expire
- [ ] T089 [US5] Dry-run the notes with someone who has not seen the product and confirm they reach a populated conversation in under five minutes (SC-008)

**Checkpoint**: A reviewer can actually use the app.

---

## Phase 8: User Story 6 — Store privacy disclosures (Priority: P3)

**Goal**: Both stores' data disclosures match what the app actually collects.

**Independent Test**: Compare each declared category against where it is actually collected and
confirm nothing is collected but undeclared.

**Note**: Depends on Phase 6 — the permission inventory is its input.

- [ ] T090 [US6] Write `docs/compliance/data-collection-inventory.md` listing every category of personal data collected, its purpose, whether it identifies a person, and any third party it reaches — including Firebase Cloud Messaging tokens, R2-stored files, location, and voice-call metadata (FR-034)
- [ ] T091 [US6] Reconcile the inventory against the published privacy policy from T041 and correct whichever is wrong (FR-035)
- [ ] T092 [US6] Complete the App Store Connect privacy questionnaire from the inventory (FR-035)
- [ ] T093 [US6] Complete the Play Console Data Safety form from the same inventory and confirm the two agree (FR-035)
- [ ] T094 [US6] Add the inventory-update obligation to the Definition of Done in `docs/compliance/data-collection-inventory.md`, so a future change that collects new data updates it in the same change set (FR-036)
- [ ] T095 [US6] Answer the age-rating questionnaires honestly about unmoderated person-to-person messaging on both stores

**Checkpoint**: Store listings are accurate and auditable.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [ ] T096 [P] Write `docs/domain/compliance-safety.md` as the living snapshot of reporting, blocking, deletion and removal requests, and add it to the index in `docs/domain/README.md` (Constitution XII)
- [ ] T097 [P] Update `docs/domain/auth-identity.md` with the two deletion paths, terms acceptance and the shared-UUID invariant from research.md R2
- [ ] T098 [P] Update `docs/domain/chat.md` with the block guard on `CreateOrGetDirectMessage` and `docs/domain/voice.md` with the guard on call initiation
- [ ] T099 [P] Update `backend/docs/SYSTEM-ARCHITECTURE.md` with the new `compliance` domain and the background deletion worker (Constitution XII)
- [ ] T100 Verify all four enumerations from T012–T015 are still synchronised across SQL, Go, proto and TypeScript after the full implementation (Principle VIII)
- [ ] T101 Run the complete backend suite `cd backend && go test ./integration/...` with zero failures — the whole suite, not only the new tests
- [ ] T102 Run the complete E2E suite `pnpm --filter web exec playwright test` with zero failures
- [ ] T103 Run the complete mobile suite `make test-mobile` with zero failures
- [ ] T104 Walk [quickstart.md](quickstart.md) end to end on a clean environment, including the manual deletion and blocking checks
- [ ] T105 Confirm no `t.Skip("TODO")` or `test.skip` from T018 and T019 remains anywhere in the feature's test files

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: no dependencies
- **Phase 2 (Foundational)**: needs Phase 1 — **blocks Phases 3 and 5**
- **Phase 3 (US1 deletion)**: needs Phase 2
- **Phase 4 (US2 legal)**: needs only T010 — runs in parallel with Phase 3
- **Phase 5 (US3 report/block)**: needs Phase 2
- **Phase 6 (US4 permissions)**: **no dependencies at all** — can start immediately
- **Phase 7 (US5 reviewer access)**: needs Phase 5 for reportable content
- **Phase 8 (US6 disclosures)**: needs Phase 6 for the permission inventory
- **Phase 9 (Polish)**: needs every shipped story

### Story Independence

US1, US2, US3 and US4 are genuinely independent and can be staffed in parallel once Phase 2 is
done (US4 needs nothing at all). US5 and US6 are the only true dependents.

### Parallel Opportunities

- T012–T015 (the four enumerations) are separate files per enumeration
- T018 and T019 (backend and E2E stubs) are separate suites
- Phase 3's web tasks T031–T033 are separate pages
- Phase 4 is almost entirely `[P]` — the legal surface barely touches the backend
- Phase 9's documentation tasks T096–T099 are separate files

## Parallel Example: after Phase 2

```bash
# Four developers, four independent tracks:
Developer A: Phase 3 (US1 account deletion)      — the largest slice
Developer B: Phase 4 (US2 legal surface)         — smallest, unblocks submission
Developer C: Phase 5 (US3 reporting + blocking)  — the Guideline 1.2 substance
Developer D: Phase 6 (US4 permission manifest)   — no dependencies, fixes a live bug
```

## Implementation Strategy

### Fastest path to a submittable build

All three P1 stories are hard blockers — none can be dropped. But they are not equally
expensive, and one P2 story is a live bug:

1. **Phase 6 first** despite its P2 label. It has no dependencies, it is the smallest phase, and
   T077 fixes push notifications being silently dropped on every Android 13+ device today. That
   is a defect users are hitting now, independent of any store.
2. **Phase 4 next.** Two static pages plus a checkbox produces the privacy policy URL that App
   Store Connect will not let you submit without.
3. **Phases 1–2, then 3 and 5 in parallel.** Deletion and reporting/blocking are the real work.
4. **Phase 7**, once there is content worth reviewing.
5. **Phase 8**, once the permission inventory is settled.
6. **Phase 9**, then submit.

### Incremental delivery

Every phase is shippable on its own. Phases 4 and 6 are worth deploying the moment they are
done rather than held for the epic — neither breaks anything and both improve the current build.

## Notes

- `[P]` means different files with no incomplete dependencies
- Constitution Principle II: stubs before implementation, entire suites green before done
- Constitution Principle VIII: T012–T015 and T100 exist because four-way constant drift is the
  most likely silent failure in this change set
- Constitution Principle XIII: report review and removal decisions are web-only; reporting,
  blocking, deletion and removal requests are personal actions and ship on mobile too
- The mandatory `speckit.docs.snapshot` hook runs after implementation and will expect T096–T098

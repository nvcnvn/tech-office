# Domain Snapshots

**Status date: 2026-09-02** · Branch at capture: `038-chat-task-quick-action`

These documents describe **what the system does today**, domain by domain, derived by
reading the code, the proto contracts and `backend/database/scripts/schema.sql` — not by
replaying the feature specs. Read one of these instead of walking `specs/001` → `specs/035`.

## Why this exists

`specs/NNN-*` are *incremental change proposals*, written before implementation. Two
problems follow from that:

1. **They are cumulative, not current.** Understanding "how do rituals work" from specs
   alone means reading 022, 023, 028, 029 and 034 and mentally applying each diff.
2. **Some are stale.** Work landed outside the Spec Kit workflow, and some specs describe
   a design that was later replaced (024 is titled "passkey" but shipped as PIN).

The rule going forward: **specs remain the record of intent; these documents are the
record of behaviour.** Where they disagree, the code wins and the drift is recorded here.

## Index

| Document | Covers | Backing code |
|---|---|---|
| [platform.md](platform.md) | Architecture tiers, multi-tenancy, Connect-RPC, permission enforcement, background jobs, config, testing | `backend/cmd`, `backend/internal/interceptor`, `backend/database` |
| [auth-identity.md](auth-identity.md) | Sign-up, sign-in, SSO, PIN accounts, sessions, invitations, roles & permissions | `internal/iam`, `rpc/v1/iam.proto` |
| [organization-people.md](organization-people.md) | Organizations, employees, employee import, departments, org chart | `internal/organization`, `internal/department` |
| [chat.md](chat.md) | Channels, messages, threads, reactions, typing, sidebar config, chat file uploads | `internal/chat`, `rpc/v1/chat.proto` |
| [voice.md](voice.md) | Voice calls, voice messages, recordings, transcripts, LiveKit integration | `internal/voice` |
| [notifications-presence.md](notifications-presence.md) | Notification hub, subscriptions, SSE, push, rescue push, presence ping-pong | `internal/notification` |
| [rituals-tasks.md](rituals-tasks.md) | Projects, tasks, workflow rules, ritual definitions, evidence, the global generation sweep | `internal/collaboration` |
| [docs-knowledge.md](docs-knowledge.md) | Documents, versions, comments, embeds, collaborative editing | `internal/docs` |
| [files.md](files.md) | Upload flow, quota, virus scan & validation, access rules, PDF conversion, content index | `internal/files` |
| [calendar.md](calendar.md) | Events, recurrence, attendees, resources, booking links, delegation, check-in | `internal/calendar` |
| [workspace-navigation.md](workspace-navigation.md) | Federated search, canonical resource links, context rail, theme preferences, feature tour, web & mobile shells | `internal/linking`, `internal/preference`, `internal/tour`, `frontend/apps/*` |
| [compliance-safety.md](compliance-safety.md) | Content reporting, blocking, account deletion, removal requests, terms acceptance, store manifest | `internal/compliance`, `rpc/v1/compliance.proto` |

## Related documents

`backend/docs/` holds the engineering-internal architecture references that Constitution
principle XII mandates. They are narrower and deeper than these snapshots and remain
authoritative for their subjects:

- `backend/docs/SYSTEM-ARCHITECTURE.md` — tier model, dependency graphs, FK reference map
- `backend/docs/NOTIFICATION-SYSTEM-ARCHITECTURE.md` — subscription resolution, delivery pipeline
- `backend/docs/NOTIFICATION-RESCUE-PUSH-DESIGN.md`, `NOTIFICATION-RULES.md`, `FCM-SETUP.md`
- `backend/docs/VOICE-COMMUNICATION-ARCHITECTURE.md`
- `backend/docs/PRODUCTION-RUNTIME-SERVICES.md`, `PRODUCTION-DAY1-CHECKLIST.md`

## Drift register

Inconsistencies found while writing these snapshots and not yet fixed. Each is described in
full in its domain document; this is the roll-up. Rows are deleted when the underlying
problem is fixed, not annotated — the register is a list of open problems, not a changelog.

| # | Severity | Where | Summary |
|---|---|---|---|
| D5 | Spec stale | [workspace-navigation.md](workspace-navigation.md#known-drift) | Spec 011 describes a global search *system*. What exists is client-side fan-out (`packages/apis/src/search.ts`) over four RPCs — employees, departments, channels, messages. Server-side `SearchDocuments`, `SearchFiles`, `SearchEvents` and task search exist but are not wired into it. |
| D16 | Contract | [organization-people.md](organization-people.md#workspace-address) | The workspace-address derivation and format rules exist twice: `internal/organization/subdomain.go` and `packages/apis/src/organization.ts`. The client copy is needed to show a derived address without a round trip, but nothing enforces that the two stay in step — `internal/organization/subdomain_test.go` is the reference table, and the TypeScript copy is verified only by having been checked against it once, by hand. |
| D17 | Contract | [auth-identity.md](auth-identity.md#3-pin-org-managed-worker-accounts) | `LoginWithPINRequest.login_identifier` now accepts an email as well as a login identifier. The field name was deliberately not changed, so the proto name understates what it takes. Clients label it "your ID or work email". |
| D18 | Contract | [workspace-navigation.md](workspace-navigation.md#known-drift) | iOS 18's automatic-strong-password cover view sits over the mobile signup password field and is outside the app's accessibility tree, so Maestro cannot drive it and `onboarding/owner-signup.yaml` cannot pass. `textContentType="password"`, explicit `autoComplete` and `passwordRules` do not suppress it; only a full AutoFill opt-out does, at the cost of password-manager fill on the owner's PIN-recovery credential. US2/US3 have backend scenario coverage but no passing blackbox flow, so Constitution XIII's per-story Maestro requirement is unmet for them. |
| D21 | Contract | [notifications-presence.md](notifications-presence.md#call-wakes), [voice.md](voice.md#native-call-presentation) | Spec 037's `contracts/call-wake-payloads.md` specifies a flat top-level call wake payload. The shipped payload uses the client module's `incomingCall` envelope instead, because `expo-callkit-telecom` parses the push and reports the call to the OS before JavaScript runs — and only recognises that shape. Field meanings are unchanged; nesting differs, and our fields ride in the module's `metadata` pass-through. Recorded in full under "Deviations recorded during implementation" in `specs/037-native-call-wakeup/plan.md`. |
| D22 | Behaviour | [voice.md](voice.md#known-drift) | A direct call to a callee with no push token and no live connection is refused with `VOICE_CALLEE_UNREACHABLE` **before the call session is created**, so no call record and no missed-call system message is written — the callee never learns anyone tried. This satisfies FR-006/SC-006 (an immediate verdict instead of a 45-second ring) but silently drops the missed-call trail that an offline callee used to get. Whether an unreachable callee should still see a missed call is an open product decision, not an oversight. |
| D23 | Deferred | [voice.md](voice.md#known-drift) | Spec 037's FR-021 (system recent-calls surface) is not implemented. Jetpack Telecom's unified call history and `isLogExcluded` require Android 16.1 (SDK 36.1), far above the epic's API 26 floor. FR-021 is a MAY; revisit when the 16.1 install base justifies it. |
| D24 | Environment | [voice.md](voice.md#known-drift) | `PUBLIC_LIVEKIT_URL` in a developer's local `backend/.env` pins a LAN IP, and the file is gitignored, so it silently goes stale whenever the machine changes network. Clients then receive join credentials aimed at an unreachable host and the call connects with no audio — the same symptom as an audio-session bug, with a completely different cause. `TestVoiceLiveKitConnectivity` is the test that catches it; treat its failure as a config problem before suspecting code. |
| D27 | Contract | [notifications-presence.md](notifications-presence.md#known-drift) | Mobile subscribes to and branches on SSE event types the backend never emits (`chat_message`, `chat_reaction`). Every real event arrives as `notification` and the reaction branch has a `notificationType` fallback, so nothing breaks, but the vocabulary reads as though a second event family exists. |
| D28 | Contract | [notifications-presence.md](notifications-presence.md#known-drift), [calendar.md](calendar.md#known-drift) | `notification.personal_preference.muted_domains` omits `calendar` from its CHECK, although `calendar` is a valid `source_domain` publishing six notification types. Calendar notifications cannot be domain-muted. |
| D30 | Behaviour | [workspace-navigation.md](workspace-navigation.md#known-drift) | Mobile does not participate in the theme system. `PreferenceService` stores `theme_mode` and `theme-tokens` exports a `darkPalette`, but every mobile screen imports `lightPalette` by name and mobile never reads or writes the preference. Its Dark Mode switch wrote a local MMKV key and called `Appearance.setColorScheme`, darkening only the native controls on a light UI; it has been removed and the scheme pinned to light. Closing this means threading a palette through the mobile screens first, then reading `GetUserPreference` — not restoring the toggle. |
| D33 | Contract | [rituals-tasks.md](rituals-tasks.md#the-channels-remembered-destination) | `ChannelDestinationUnsetReason.PROJECT_DELETED` is implemented but unreachable. `GetChannelTaskDestination` returns it when a destination row outlives its project, but `channel_task_destination`'s project foreign key is `ON DELETE CASCADE` — as `specs/038-chat-task-quick-action/data-model.md` specifies — so a deleted project takes the row with it and the channel reads `NEVER_SET` instead. The product exposes no project deletion at all (archiving is the supported operation), so the value is dead today. The approved scenario list asks for `PROJECT_DELETED`; the test asserts what actually happens and says why. |
| D34 | Contract | [workspace-navigation.md](workspace-navigation.md#mobile-application) | `frontend/apps/mobile` does not typecheck. Three errors predate feature 038 and none are in its files: an optimistic message builds `updatedAt.seconds` as a `number` where the generated proto wants `bigint`; the chat index subscribes to a `"tabPress"` navigation event React Navigation's core event map does not declare; and `chat-message-body.tsx` passes `durationMs` and `waveformPeaks` to `VoiceMessagePlayer`, whose props are only `fileId` and `maxWidth`, so the voice-message duration and waveform are silently dropped. Nothing runs `tsc` on mobile in CI, which is why they persist. |
| D37 | Environment | [workspace-navigation.md](workspace-navigation.md#mobile-application) | Maestro cannot drive a physical iPhone here, so the mobile flows are verified on a real Android device and an iOS *simulator*. Maestro 2.3.0's `test` does not enumerate connected iPhones at all; 2.8.0 and 2.10.0 do, but fail to build their XCUITest driver — the `MaestroDriverLib` sources they extract are missing, so `xcodebuild` stops on absent input files, with or without `-allowProvisioningUpdates`. Detection also needs the CoreDevice tunnel warm (`xcrun devicectl device info details --device <udid>` immediately beforehand), which is a second, separate obstacle. Until an upstream release fixes the driver bundle, iOS-only regressions that a simulator cannot show — anything touching real signing, push, or hardware — go unseen by the blackbox suite. |
| D36 | Contract | [platform.md](platform.md#testing) | `make test-frontend-one F=<spec>` cannot run. `pnpm --filter web exec` already runs inside `apps/web`, so `--config=apps/web/e2e/playwright.config.ts` resolves to `apps/web/apps/web/e2e/...` and Playwright exits with "does not exist". The working invocation is `npx playwright test --config=e2e/playwright.config.ts <spec>` from `apps/web`. `make test-frontend`, which passes no config, is unaffected. |
| D38 | Contract | [workspace-navigation.md](workspace-navigation.md#feature-tour) | The administrator tour's `project` and `ritual` stops are web-only, which `specs/039-feature-tour/contracts/tour-content.md` originally reserved for the `people` stop alone. The mobile app can list projects and rituals but creates neither — no `createProject` or `createRitualDefinition` call exists anywhere in `apps/mobile` — so an actionable "Create a project" there would open a list it cannot add to, which is the empty-screen failure the spec's edge cases forbid. The contract was updated to match before the code was. Clearing the flag is one field per stop once those create screens exist. |
| D39 | Contract | [workspace-navigation.md](workspace-navigation.md#feature-tour) | FR-013a describes the tour's ritual stop falling back to project creation "when the workspace has no project yet", but organization registration seeds a default project (`internal/organization/logic.go`), so a freshly registered workspace always has one. The fallback is still reachable — default-project creation is allowed to fail without failing registration, and a workspace can archive its last project — and both branches are covered in `apps/web/e2e/feature-tour.spec.ts`, but the ordinary new-workspace path takes the non-fallback branch, not the one the requirement is written around. |
| D40 | Environment | [workspace-navigation.md](workspace-navigation.md#feature-tour) | The fixture credentials in `frontend/apps/mobile/.maestro/.env` are rejected by the local backend with `invalid email or password`, and the unmodified `auth/signin.yaml` bootstrap fails on them identically, so every Maestro flow in the repository is unrunnable as configured. The feature-tour flows were verified against a throwaway organisation created through the API instead, which is not a repeatable arrangement. Restoring the fixture account — an owner or operator for `owner-tour.yaml`, an account without `iam.inviteUser` for `worker-tour.yaml` — is what makes the standing suite runnable again. |
| D41 | Environment | [platform.md](platform.md#testing) | Four web E2E specs fail against a local backend independently of any feature work, so `make test-frontend` is not green on a clean tree: `context-rail.spec.ts:155` (the rail's live global blocks on the calendar route), `legal-surface.spec.ts:59` (the signup submit button is not disabled before the terms box is ticked), `user-guide-screenshots.spec.ts:626` (sign-in screens, fails in 0 ms — a setup dependency, not the assertion), and `voice-communication.spec.ts:157` (the decline is not reflected in the caller's timeline). Verified by reverting `frontend/apps/web` entirely and re-running the four: all four still fail. A fifth, `ritual-ux-redesign.spec.ts:375`, fails only under full-suite load and passes in isolation. |
| D29 | Behaviour | [rituals-tasks.md](rituals-tasks.md#known-drift) | Nothing sweeps a ritual instance into `overdue` or `missed`. `overdue` is derived only when an evidence write triggers `reconcileRitualTaskState`; an instance whose deadline passes with no evidence activity stays in `todo` and nobody is notified. Making these real states needs a reconciliation sweep of its own and the notification types put back in the Go list and the DB CHECK together. |

### Fixed on 2026-08-30

D1 (`upload_context` CHECK), D2 (Go notification-type list vs DB CHECK, now guarded by
`TestNotificationTypeCheckMatchesGoConstants`), D3 (dead ritual notification code and its
CHECK values), D4 (`expo-local-authentication` and its permissions), D6 (Zitadel residue:
`LoginForm.tsx`, `organization.project_id` / `app_id`), D7 (phantom notification types in
the mobile route resolver), D9 (calendar reminder priority and body), D10
(`document_type` filtering in the docs list), D11 (employee UUIDs rendered where a name
belongs), D12 (IP-literal hostnames and the `OrgSelector` mount effect), D13 (one password
rule at 8 characters, and the signup submit button's dead first click), D14 (`CreateProject`
returning a stale `member_count`), D15 (the auto-approve label), D19 (`AcceptInvitation`
and second-organization membership), D20 (`TestPresencePingPong` racing the rescue worker),
D25 (no in-app mute), D26 (decline indistinguishable from cancel). D8 was already resolved
when the register was written: `schema.sql` is generated from the migrations by
`backend/scripts/regen-schema.sh` and can no longer disagree with them.

### Fixed on 2026-09-02

D31 and D32, the two deferred halves of feature 038. The message→task chip
(`ListTasksBySourceMessages`), the task origin block (`GetTaskOrigin`) and the channel's
remembered destination (`GetChannelTaskDestination`, `SetChannelTaskDestination`) all have
logic-layer implementations, Connect handlers and callers on both clients now.

## Keeping these current

The trigger is behaviour change, not spec authorship. Update the relevant domain document
in the same change set that alters an RPC surface, a database constraint, a background job
cadence, or a cross-domain call — the same Definition of Done that Constitution principle
XII applies to `backend/docs/`. When you fix an entry in the drift register, delete the
row rather than annotating it.

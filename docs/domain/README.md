# Domain Snapshots

**Status date: 2026-08-27** · Branch at capture: `036-store-compliance-sweep`

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
| [workspace-navigation.md](workspace-navigation.md) | Federated search, canonical resource links, context rail, theme preferences, web & mobile shells | `internal/linking`, `internal/preference`, `frontend/apps/*` |
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

Inconsistencies found while writing these snapshots. Each is described in full in its
domain document; this is the roll-up. None of them are fixed by these documents — they are
recorded so the next person does not rediscover them.

| # | Severity | Where | Summary |
|---|---|---|---|
| D1 | **Bug** | [files.md](files.md#known-drift), [voice.md](voice.md#known-drift) | `files.file_metadata.upload_context` still has the original `CHECK (… IN ('chat','avatar','docs','project'))`, but Go writes `"voice_transcript"` (voice transcripts) and accepts `"calendar"` as valid. Voice transcript persistence fails on the constraint. |
| D2 | **Bug** | [notifications-presence.md](notifications-presence.md#known-drift) | `IsValidNotificationType`/`AllNotificationTypes` in `internal/notification/constants.go` omit all seven ritual/evidence types that the DB CHECK allows and that `internal/collaboration` actually publishes. The `notification_v2_contract_test` asserts alignment against the truncated Go list, so it passes while the mismatch stands. |
| D3 | Dead code | [rituals-tasks.md](rituals-tasks.md#known-drift) | `notifyRitualInstanceOverdue` and `notifyRitualInstanceAssigned` have no callers; `ritual_instance_missed` is never published. Nothing sweeps rituals into an overdue state — overdue is only derived when an evidence write triggers state reconciliation. |
| D4 | Spec stale | [auth-identity.md](auth-identity.md#known-drift) | Spec 024 is titled "passkey-based login". No WebAuthn/passkey code exists anywhere. What shipped is a 6-digit PIN with escalating lockout; `iam.credential.credential_type` reserves `'biometric'` but nothing writes it. The unreferenced mobile `useBiometrics` hook was deleted in 035; its `expo-local-authentication` dependency is still declared in `apps/mobile/package.json` and now imported by nothing — removing it forces a native rebuild, so it was left for a change already doing one. |
| D5 | Spec stale | [workspace-navigation.md](workspace-navigation.md#known-drift) | Spec 011 describes a global search *system*. What exists is client-side fan-out (`packages/apis/src/search.ts`) over four RPCs — employees, departments, channels, messages. Server-side `SearchDocuments`, `SearchFiles`, `SearchEvents` and task search exist but are not wired into it. |
| D6 | Spec stale | [auth-identity.md](auth-identity.md#known-drift) | Spec 002 is written against Zitadel, removed by 018. Residue: a stale doc comment in `apps/web/src/app/signin/components/LoginForm.tsx` and generated artifacts under `packages/apis/dst/`. `public.organization.project_id` / `app_id` are still `NOT NULL` columns marked "deprecated". |
| D7 | Contract | [notifications-presence.md](notifications-presence.md#known-drift) | The mobile route resolver (`apps/mobile/src/lib/linking.ts`) branches on `thread_reply`, `message_reply`, `mention_reply`, `thread_mention` — none of which the backend can emit. |
| D8 | ~~Schema drift~~ Resolved | [platform.md](platform.md#known-drift) | `database/scripts/schema.sql` is now **generated** from `database/migrations/` by `backend/scripts/regen-schema.sh`, so it can no longer disagree with them. Previously it was hand-written and led the migrations, which is why `20260403000001_add_missing_collab_ritual_calendar_permissions.up.sql` exists. Author schema changes as a migration and regenerate; never edit schema.sql. |
| D9 | **Bug** | [calendar.md](calendar.md#known-drift) | Calendar event reminders publish with `Priority: 2, // high`. Priority 2 means "deliver when online only", so the reminder is suppressed for exactly the absent user it is meant to reach. The reminder body also carries no event title. |
| D10 | **Bug** | [docs-knowledge.md](docs-knowledge.md#known-drift) | `ListRootDocuments` / `ListChildDocuments` never filter on `document_type`, so every task's `task_description` document appears in `/workspace/docs` titled `Task: <task title>`. The snapshot previously claimed they were filtered out. |
| D11 | **Bug** | — | Ritual surfaces render raw employee UUIDs where a name belongs: the *Employee Compliance* table on the project Health tab, and the *Default Assignees* chip in the ritual definition editor. Both have the employee ID and neither resolves it to a person. |
| D13 | Contract | — | The web signup form requires a **16**-character password (`packages/validations/src/password.ts`) while the backend accepts **8** (`iam.MinPasswordLength`), and the mobile owner signup added in 035 states and enforces **8**. The same product now asks for two different password lengths depending on the device. The stricter client rule is undocumented and is the first thing a new owner hits. `auth-identity.md` states the backend's 8–72 range, which is correct for the API and misleading for the UI. Separately, the form's `mode: 'onBlur'` means **Create Organization** stays disabled until the last field blurs, so a user who types the final field and clicks straight away must click twice. The terms checkbox added in 036 hit the same trap and now calls `trigger('acceptedTerms')` on change; the text fields still do not, so the underlying issue is narrowed rather than fixed. |
| D21 | Contract | [notifications-presence.md](notifications-presence.md#call-wakes), [voice.md](voice.md#native-call-presentation) | Spec 037's `contracts/call-wake-payloads.md` specifies a flat top-level call wake payload. The shipped payload uses the client module's `incomingCall` envelope instead, because `expo-callkit-telecom` parses the push and reports the call to the OS before JavaScript runs — and only recognises that shape. Field meanings are unchanged; nesting differs, and our fields ride in the module's `metadata` pass-through. Recorded in full under "Deviations recorded during implementation" in `specs/037-native-call-wakeup/plan.md`. |
| D24 | Environment | — | `PUBLIC_LIVEKIT_URL` in a developer's local `backend/.env` pins a LAN IP, and the file is gitignored, so it silently goes stale whenever the machine changes network. Clients then receive join credentials aimed at an unreachable host and the call connects with no audio — the same symptom as an audio-session bug, with a completely different cause. `TestVoiceLiveKitConnectivity` is the test that catches it; treat its failure as a config problem before suspecting code. |
| D22 | Behaviour | [voice.md](voice.md#callee-availability-busy-and-unreachable) | A direct call to a callee with no push token and no live connection is refused with `VOICE_CALLEE_UNREACHABLE` **before the call session is created**, so no call record and no missed-call system message is written — the callee never learns anyone tried. This satisfies FR-006/SC-006 (an immediate verdict instead of a 45-second ring) but silently drops the missed-call trail that an offline callee used to get. Whether an unreachable callee should still see a missed call is an open product decision, not an oversight. |
| D23 | Deferred | [voice.md](voice.md#native-call-presentation) | Spec 037's FR-021 (system recent-calls surface) is not implemented. Jetpack Telecom's unified call history and `isLogExcluded` require Android 16.1 (SDK 36.1), far above the epic's API 26 floor. FR-021 is a MAY; revisit when the 16.1 install base justifies it. || D15 | Cosmetic | — | The evidence-requirement editor shows the auto-approve switch for `photo` **and** `gps_checkin` (`AUTO_APPROVABLE_TYPES`), but labels it "Auto-approve via GPS check-in" in both cases. On a photo requirement the label describes a rule that does not apply to it. |
| D14 | Cosmetic | — | `CreateProject` adds the creator as project owner and the DB `member_count` is 1, but the project card rendered straight after creation shows `0 members` (and `0 tasks` on projects that do have ritual instances). The list renders a count that is stale at render time. |
| D16 | Contract | [organization-people.md](organization-people.md#workspace-address) | The workspace-address derivation and format rules exist twice: `internal/organization/subdomain.go` and `packages/apis/src/organization.ts`. The client copy is needed to show a derived address without a round trip, but nothing enforces that the two stay in step — `internal/organization/subdomain_test.go` is the reference table, and the TypeScript copy is verified only by having been checked against it once, by hand. |
| D17 | Contract | [auth-identity.md](auth-identity.md#3-pin-org-managed-worker-accounts) | `LoginWithPINRequest.login_identifier` now accepts an email as well as a login identifier. The field name was deliberately not changed, so the proto name understates what it takes. Clients label it "your ID or work email". |
| D18 | Contract | [workspace-navigation.md](workspace-navigation.md#known-drift) | iOS 18's automatic-strong-password cover view sits over the mobile signup password field and is outside the app's accessibility tree, so Maestro cannot drive it and `onboarding/owner-signup.yaml` cannot pass. `textContentType="password"`, explicit `autoComplete` and `passwordRules` do not suppress it; only a full AutoFill opt-out does, at the cost of password-manager fill on the owner's PIN-recovery credential. US2/US3 have backend scenario coverage but no passing blackbox flow, so Constitution XIII's per-story Maestro requirement is unmet for them. |
| D19 | **Bug** | [organization-people.md](organization-people.md#employees) | `AcceptInvitation` does not create an `organization.employee` row for a user who already exists, so the invite→accept flow cannot produce a **second** organization membership: assigning the role fails on `fk_employee_role_employee`. Multi-organization membership therefore only arises from paths that build the rows directly. Found while writing `iam_account_deletion_test.go`, whose two-workspace scenario arranges the membership with direct inserts and says so in a comment. |
| D20 | **Bug** | [notifications-presence.md](notifications-presence.md#rescue-push-why-push-is-delayed-not-immediate) | `TestPresencePingPong` fails on a clean tree: a notification for a recipient with only an unresponsive connection, and one with no connection at all, both stay `queued` instead of routing to push fallback — "an unreachable recipient must not wait out the rescue window". Confirmed against `main` by stashing, so it predates 036 and is not caused by it. |
| D12 | Dev-only | — | `extractSubdomain` (`apps/web/src/app/config/auth.ts`) splits the hostname on `.` and returns the first part when there are more than two, so a `127.0.0.1` dev server resolves the tenant as `127`; hostname resolution also wins over `?org=`. Compounding it, `OrgSelector`'s mount effect depends on a `validateSubdomain` callback that is recreated every render, so it re-runs and overwrites whatever the user typed. On a dev host reached by IP the field cannot be corrected by hand — use `localhost` and `?org=<subdomain>`. |

## Keeping these current

The trigger is behaviour change, not spec authorship. Update the relevant domain document
in the same change set that alters an RPC surface, a database constraint, a background job
cadence, or a cross-domain call — the same Definition of Done that Constitution principle
XII applies to `backend/docs/`. When you fix an entry in the drift register, delete the
row rather than annotating it.

# Domain Snapshots

**Status date: 2026-08-22** · Branch at capture: `034-global-ritual-scheduler`

These documents describe **what the system does today**, domain by domain, derived by
reading the code, the proto contracts and `backend/database/scripts/schema.sql` — not by
replaying the feature specs. Read one of these instead of walking `specs/001` → `specs/034`.

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
| D4 | Spec stale | [auth-identity.md](auth-identity.md#known-drift) | Spec 024 is titled "passkey-based login". No WebAuthn/passkey code exists anywhere. What shipped is a 6-digit PIN with escalating lockout; `iam.credential.credential_type` reserves `'biometric'` but nothing writes it, and the mobile `useBiometrics` hook is unreferenced. |
| D5 | Spec stale | [workspace-navigation.md](workspace-navigation.md#known-drift) | Spec 011 describes a global search *system*. What exists is client-side fan-out (`packages/apis/src/search.ts`) over four RPCs — employees, departments, channels, messages. Server-side `SearchDocuments`, `SearchFiles`, `SearchEvents` and task search exist but are not wired into it. |
| D6 | Spec stale | [auth-identity.md](auth-identity.md#known-drift) | Spec 002 is written against Zitadel, removed by 018. Residue: a stale doc comment in `apps/web/src/app/signin/components/LoginForm.tsx` and generated artifacts under `packages/apis/dst/`. `public.organization.project_id` / `app_id` are still `NOT NULL` columns marked "deprecated". |
| D7 | Contract | [notifications-presence.md](notifications-presence.md#known-drift) | The mobile route resolver (`apps/mobile/src/lib/linking.ts`) branches on `thread_reply`, `message_reply`, `mention_reply`, `thread_mention` — none of which the backend can emit. |
| D8 | Schema drift | [platform.md](platform.md#known-drift) | `database/scripts/schema.sql` is the canonical top-to-bottom schema, but permissions were added to it before they existed in migrations; `20260403000001_add_missing_collab_ritual_calendar_permissions.up.sql` exists solely to reconcile that. Treat schema.sql as *intended* state and migrations as *deployed* state, and diff them when in doubt. |
| D9 | **Bug** | [calendar.md](calendar.md#known-drift) | Calendar event reminders publish with `Priority: 2, // high`. Priority 2 means "deliver when online only", so the reminder is suppressed for exactly the absent user it is meant to reach. The reminder body also carries no event title. |
| D10 | **Bug** | [docs-knowledge.md](docs-knowledge.md#known-drift) | `ListRootDocuments` / `ListChildDocuments` never filter on `document_type`, so every task's `task_description` document appears in `/workspace/docs` titled `Task: <task title>`. The snapshot previously claimed they were filtered out. |
| D11 | **Bug** | — | Ritual surfaces render raw employee UUIDs where a name belongs: the *Employee Compliance* table on the project Health tab, and the *Default Assignees* chip in the ritual definition editor. Both have the employee ID and neither resolves it to a person. |
| D13 | Contract | — | The web signup form requires a **16**-character password (`packages/validations/src/password.ts`) while the backend accepts **8** (`iam.MinPasswordLength`). The stricter client rule is undocumented and is the first thing a new owner hits. `auth-identity.md` states the backend's 8–72 range, which is correct for the API and misleading for the UI. Separately, the form's `mode: 'onBlur'` means **Create Organization** stays disabled until the last field blurs, so a user who types the final field and clicks straight away must click twice. |
| D15 | Cosmetic | — | The evidence-requirement editor shows the auto-approve switch for `photo` **and** `gps_checkin` (`AUTO_APPROVABLE_TYPES`), but labels it "Auto-approve via GPS check-in" in both cases. On a photo requirement the label describes a rule that does not apply to it. |
| D14 | Cosmetic | — | `CreateProject` adds the creator as project owner and the DB `member_count` is 1, but the project card rendered straight after creation shows `0 members` (and `0 tasks` on projects that do have ritual instances). The list renders a count that is stale at render time. |
| D12 | Dev-only | — | `extractSubdomain` (`apps/web/src/app/config/auth.ts`) splits the hostname on `.` and returns the first part when there are more than two, so a `127.0.0.1` dev server resolves the tenant as `127`; hostname resolution also wins over `?org=`. Compounding it, `OrgSelector`'s mount effect depends on a `validateSubdomain` callback that is recreated every render, so it re-runs and overwrites whatever the user typed. On a dev host reached by IP the field cannot be corrected by hand — use `localhost` and `?org=<subdomain>`. |

## Keeping these current

The trigger is behaviour change, not spec authorship. Update the relevant domain document
in the same change set that alters an RPC surface, a database constraint, a background job
cadence, or a cross-domain call — the same Definition of Done that Constitution principle
XII applies to `backend/docs/`. When you fix an entry in the drift register, delete the
row rather than annotating it.

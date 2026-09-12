# Phase 0 Research: Prune Reserved-But-Unused Values

**Feature**: 062-prune-reserved-values | **Date**: 2026-09-12

Every claim below was measured against the tree at `4820537`, not taken from the spec.
Where a measurement disagreed with an existing document, the code won and the document is
listed for correction.

## 1. Where each removed value actually lives

### 1.1 Channel kinds — `crm_deal_notes`, `support_ticket`

**Decision**: Remove from all four layers; delete proto enum values 4 and 5 outright.

**Rationale**: The value is declared in exactly four places, which is what Constitution
VIII's coordination process expects, and nothing between them creates a channel of either
kind — `internal/chat` has no call site that passes these constants, only mapping switches
that translate a value the database can never hold.

| Layer | Location | What changes |
|---|---|---|
| Database | `chat.channel` CHECK `valid_channel_type` | array drops 2 of 5 values |
| Database comment | `COMMENT ON COLUMN chat.channel.channel_type` | value list corrected |
| Go constant | `backend/internal/chat/constants.go` | 2 consts + 2 `IsValidChannelType` cases |
| Go mapping | `backend/internal/chat/logic.go` ~501, ~518, ~4125 | 3 switch arms |
| Go mapping | `backend/internal/chat/connect.go` ~1005, ~1155 | 2 switch arms |
| Proto | `backend/rpc/v1/chat.proto:284-285` | `CHANNEL_TYPE_CRM_DEAL_NOTES = 4`, `CHANNEL_TYPE_SUPPORT_TICKET = 5` |
| TypeScript | `frontend/packages/apis/src/chat.ts:75-76, 860-863` | union members + `convertChannelType` arms |
| Comment | `frontend/packages/apis/src/types/search.ts:56` | stale value list in a comment |

**Alternatives considered**: Marking the proto tags `reserved 4, 5;`. Rejected — see the
plan's resolved-unknowns section. There is no pinned consumer that could reuse the tag
against an old reader.

### 1.2 File-attachment contexts — `crm_deal`, `support_ticket`

**Decision**: Remove from all four layers. Leave `upload_context` alone.

**Rationale**: `files.file_access_rule.context_type` is a distinct set from
`ValidUploadContexts()` in the same `constants.go`. The upload set is
`chat | avatar | docs | project | calendar`; the access-rule set is
`chat_channel | project | department_docs | calendar_event | support_ticket | crm_deal`.
The spec scopes only the second, and its reasoning holds: `calendar`'s unreachability in
the upload set has a different cause (the calendar area references files uploaded through
other contexts) and removing it is a behaviour question about calendar, not a prune.

| Layer | Location |
|---|---|
| Database | `files.file_access_rule` CHECK `file_access_rule_context_type_check` + column comment |
| Go constant | `backend/internal/files/constants.go:63-64` |
| Go mapping | `backend/internal/files/service.go` ~1421, ~1440 |
| Proto | `backend/rpc/v1/files.proto:196-197` — `FILE_CONTEXT_TYPE_SUPPORT_TICKET = 5`, `FILE_CONTEXT_TYPE_CRM_DEAL = 6` |

**Finding worth recording**: the schema comment on `files.file_access_rule.context_type`
calls it "Upload context type", which is wrong — it is the access-rule context, a
different set from the one `IsValidUploadContext` guards. The comment is rewritten as part
of this change because it is inside the blast radius and because leaving it would preserve
precisely the "check whether this value is live" tax the feature removes.

### 1.3 Sign-in credential kind — `biometric`

**Decision**: Remove; `iam.credential.credential_type` becomes single-valued (`pin`).

**Rationale**: `CredentialTypeBiometric` in `backend/internal/iam/constants.go:68` has no
reader — no issuance path, no verification path, no proto field. Spec 024 was titled
"passkey" and shipped as PIN authentication; the biometric constant is the residue of the
abandoned half.

**A single-valued CHECK is still worth keeping.** `credential_type = 'pin'` constrains the
column to the one thing that exists, and `idx_credential_identity_type_active` is a unique
index over `(organization_id, identity_id, credential_type)` that gives "one active
credential per identity" its meaning. Dropping the column would be a larger change than the
spec asks for and would rewrite that index. [ASSUMPTION: the column and its CHECK stay,
narrowed to one value; FR-003 asks that the permitted kinds be limited to those the product
issues, which a one-value CHECK satisfies exactly.]

| Layer | Location |
|---|---|
| Database | `iam.credential` CHECK `credential_credential_type_check` → `= 'pin'` |
| Database comment | table comment and `credential_hash` column comment both say "biometric" |
| Go constant | `backend/internal/iam/constants.go:68` |

### 1.4 Notification source domains — `crm`, `hr`, `support`, `finance`

**Decision**: Remove four of nine, leaving `chat`, `projects`, `docs`, `system`,
`calendar`. This is the set the spec calls "notification categories".

**Rationale**: `allSourceDomains` in `backend/internal/notification/constants.go:296-307`
is the single Go list, and the file's own comment already names the four locations that
must agree. Grepping every publisher call site shows `SourceDomainChat`,
`SourceDomainProjects`, `SourceDomainDocs`, `SourceDomainSystem` and `SourceDomainCalendar`
in use, and the other four nowhere but in the list itself.

| Layer | Location |
|---|---|
| Database | `notification.notification` CHECK `notification_source_domain_valid` (9 → 5) |
| Database | `notification.personal_preference` CHECK `muted_domains_valid` (9 → 5) |
| Database comments | both column comments say "nine values" / list all nine |
| Go | `constants.go` — 4 `SourceDomain*` consts and 4 `allSourceDomains` entries |
| Proto comment | `backend/rpc/v1/notification.proto:250` lists the domains in a trailing comment |
| TypeScript | `frontend/packages/apis/src/notification.ts:93-101` union, `:115-125` `SOURCE_DOMAINS` |
| Mobile UI | `frontend/apps/mobile/src/app/(app)/(more)/settings.tsx:62-65` — `MUTE_ROWS` |

**The mobile list is compile-checked.** `MUTE_ROWS` is declared
`Record<SourceDomain, { label; icon }>`, so narrowing `SourceDomain` in `packages/apis`
makes the four surplus keys a type error. `pnpm run typecheck:mobile` is the repository's
one CI-enforced gate, so this is caught before merge rather than by looking at the screen.

**There is no web mute UI.** `SOURCE_DOMAINS` has exactly two consumers: its own
definition file and the mobile settings screen. US1's "on mobile and on web" is therefore
satisfied on mobile only, because the web client does not render a mute list at all.
[ASSUMPTION: no web mute screen is built here. Building one is a feature, not a prune, and
FR-011 forbids changing live behaviour beyond the removals. US1's acceptance is evaluated
against the surfaces that exist.]

**Existing alignment test to preserve**: `backend/integration/notification_personal_preference_test.go:185`
— "every source domain the system publishes from can be muted" — iterates
`notification.AllSourceDomains()` and asserts each can be written to `muted_domains`. It
needs no edit; it must simply stay green over five values instead of nine. That is FR-013.

### 1.5 Empty Postgres schemas

**Decision**: Drop thirteen. `assets`, `communication`, `crm`, `finance`, `hiring`,
`integrations`, `inventory`, `learning`, `payroll`, `procurement`, `retention`, `support`,
`timekeeping`.

**Rationale and measurement**: `backend/database/scripts/schema.sql` declares 24 schemas.
Counting every `CREATE TABLE|VIEW|MATERIALIZED VIEW|TYPE|SEQUENCE|FUNCTION <schema>.`
occurrence gives:

| Schema | Objects | | Schema | Objects |
|---|---:|---|---|---:|
| `assets` | **0** | | `timekeeping` | **0** |
| `communication` | **0** | | `calendar` | 12 |
| `crm` | **0** | | `chat` | 6 |
| `finance` | **0** | | `collaboration` | 18 |
| `hiring` | **0** | | `compliance` | **4** |
| `integrations` | **0** | | `docs` | 8 |
| `inventory` | **0** | | `files` | 6 |
| `learning` | **0** | | `flows` | 6 |
| `payroll` | **0** | | `iam` | 14 |
| `procurement` | **0** | | `notification` | 14 |
| `retention` | **0** | | `organization` | 3 |
| `support` | **0** | | `voice` | 5 |

24 − 13 = **11**, which is exactly SC-004's target.

**Drift found — `compliance` is not empty.** `docs/domain/platform.md:387` lists
`compliance` among "schemas reserved but unused so far". It holds 4 objects. The spec
anticipated this; the document is corrected here.

**Method**: `DROP SCHEMA <name> RESTRICT` for each. RESTRICT is the emptiness proof — if
anything at all lives in the schema, the statement errors and the transaction rolls back.
This is strictly better than a separate audit query, because the check and the action
cannot drift apart.

**Alternative considered**: `DROP SCHEMA ... CASCADE`. Rejected outright — it would
silently destroy data if a measurement here were wrong, which is the one failure mode this
change must not have.

### 1.6 Web navigation entries — CRM, Finance, HR

**Decision**: Delete the three `enabled: false` entries from the nav array in
`frontend/apps/web/src/app/workspace/layout.tsx:156-178`.

**Rationale**: They carry `⌘9`, `⌘-` and `⌘=`. The surviving eight carry `⌘1`–`⌘8`
contiguously, so deletion leaves the advertised sequence dense with no dead keys, which is
SC-003. No renumbering is needed.

**The `enabled` field itself is kept** — see the plan's design decision 5. Every surviving
entry sets it `true`, so it is now a constant, but it shares a rendering path with the
`permission` gate that `organization` and `reviews` use, and collapsing that is a refactor
of live navigation, not a prune.

**Mobile has no equivalent.** Mobile navigation is Expo Router tabs over real routes; there
are no disabled placeholder tabs, so US2 is a web-only change.

### 1.7 Legacy route normalisation

**Decision**: Delete `normalizeLegacyRoute` entirely, together with the `LegacyNormalized`
field on `NormalizeResult`, its JSON-serialised twin in `types.go`, its assignment in
`service.go`, and the optional `legacyNormalized` field on the frontend link type.

**Rationale**: `backend/internal/linking/normalize.go:45-49` tries the canonical
`/o/{tenant}/r/{type}/{id}` grammar first and falls through to a second grammar accepting
`/workspace/projects/*/tasks/*`, `/workspace/tasks/*`, `/chat/*`, `/docs/*`, `/calendar/*`
with the tenant taken from the hostname's first label. Nothing in the product emits those
shapes — `internal/linking/generator.go` produces canonical links only — so the second
grammar is reachable only by a link someone typed or pasted from before the canonical form
existed. `docs/domain/workspace-navigation.md:804` already flags it as an open question
citing this project's no-backward-compatibility stance.

| Layer | Location | What changes |
|---|---|---|
| Go | `backend/internal/linking/normalize.go:9-14` | `LegacyNormalized` field off `NormalizeResult` |
| Go | `backend/internal/linking/normalize.go:45-49` | fallthrough deleted; unmatched path errors directly |
| Go | `backend/internal/linking/normalize.go:52-106` | whole `normalizeLegacyRoute` function deleted (~55 lines) |
| Go | `backend/internal/linking/types.go:134` | `LegacyNormalized bool \`json:"legacyNormalized,omitempty"\`` |
| Go | `backend/internal/linking/service.go:161` | assignment deleted |
| TypeScript | `frontend/packages/links/src/index.ts:42` | `legacyNormalized?: boolean` |
| Test | `backend/integration/canonical_links_test.go:251` | "when a legacy product link is normalized" |

**Error contract is unchanged.** The existing failure message is
`unsupported canonical or legacy path`; it becomes `unsupported canonical path`. Callers
match on the error, not the string, and the RPC-level unresolvable-link response a client
sees is identical. This satisfies FR-006's "same clear outcome as any other unusable link"
without touching Constitution X's error-detail contract.

**Test disposition**: the legacy subtest asserted that a legacy shape resolves. Per FR-012,
a check that outlives its subject is a false gate, so it is deleted. It is replaced — not
adapted — by an assertion in the same file that a legacy-shaped URL is now rejected, which
is a genuine behavioural requirement (FR-006 / US4 acceptance scenario 2) rather than a
tautology about an absent code path.

## 2. Verification approach

**Decision**: Reuse the three existing suites; add one new assertion and one new test.

**Rationale**: FR-012 requires no reduction in coverage of surviving behaviour, and
Constitution II requires scenario-first coverage for each user story. Mapping:

| Story | Covered by | New or existing |
|---|---|---|
| US1 notification categories | `notification_personal_preference_test.go` alignment scenario (FR-013) | existing, must stay green over 5 |
| US2 navigation | a web E2E assertion that every rendered nav entry is enabled and reachable | new, small |
| US3 no inert values | the cross-layer alignment tests plus a new "no schema is empty" assertion | one new assertion |
| US4 shared links | `canonical_links_test.go` — canonical resolution kept, legacy rejection asserted | one subtest swapped |

**The "no empty schema" assertion** queries `information_schema` for schemas with zero
tables, excluding Postgres's own (`pg_*`, `information_schema`, `public`). This is the
standing guard that makes SC-004 durable rather than a one-time count — without it, the
next empty schema someone adds is invisible. It belongs beside the other platform-level
invariants in `backend/integration`.

**Alternatives considered**: a lint rule or a script under `scripts/`. Rejected — the
repository's existing alignment invariants are integration tests, and the owner's standing
preference is to enforce a property with the cheapest mechanism already in the project
rather than adopting new infrastructure for it.

## 3. Documentation to correct

FR-014 and Constitution XII require these in the same change set, with removed values
deleted rather than annotated:

| Document | What it says now | Action |
|---|---|---|
| `docs/domain/chat.md:23-24` | channel-type table rows for `crm_deal_notes`, `support_ticket` marked "reserved" | delete the rows |
| `docs/domain/chat.md:319` | open-question bullet: "reserved in the CHECK constraint … nothing creates them" | delete — the question is answered |
| `docs/domain/platform.md:387` | fourteen "reserved but unused" schemas including `compliance` | delete the paragraph; `compliance` is not unused |
| `docs/domain/workspace-navigation.md:52` | "`LegacyNormalized` flags this" | delete the clause |
| `docs/domain/workspace-navigation.md:804` | "Legacy route normalisation is open-ended" open question | delete — answered |
| `docs/domain/files.md` | file-context set | narrow to 4 values |
| `docs/domain/auth-identity.md` | credential kinds | narrow to `pin` |
| `docs/domain/notifications-presence.md` | nine source domains, mute list | narrow to 5 |
| `docs/domain/workspace-navigation.md` | nav entries incl. disabled three | narrow to 8 |

**Three open questions closed** (SC-007): `chat.md:319` (reserved channel types),
`platform.md:387` (reserved schemas), `workspace-navigation.md:804` (legacy route
normalisation).

**Drift register**: no row in `docs/domain/README.md` covers these; they are prose open
questions inside the domain files, not registered drift. No register row is added or
removed. [ASSUMPTION: the register is for inconsistencies between layers, and these were
consistent — merely inert — so they were never registered. Nothing to delete there.]

**Out of scope, per spec**: `specs/NNN-*` historical change proposals are not rewritten,
and aspirational mentions of these modules in design notes are left alone.

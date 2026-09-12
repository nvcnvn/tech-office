# Research: Compliance prose and age-rating answers

**Feature**: 054 | **Date**: 2026-09-12 | **Input**: [spec.md](spec.md)

Everything below was read out of the repository at HEAD (`087b0f2`) rather than recalled.
Findings are numbered `R-n` and referenced from [plan.md](plan.md), [data-model.md](data-model.md)
and the contracts.

---

## R-1: What the app actually declares

**Decision**: the declared set is exactly five user-facing permissions, and the gate
already owns the list.

`frontend/apps/mobile/scripts/check-store-manifest.js` holds them as two constants:

```js
ALLOWED_IOS_KEYS = { NSMicrophoneUsageDescription, NSCameraUsageDescription,
                     NSPhotoLibraryUsageDescription, NSLocationWhenInUseUsageDescription }
ALLOWED_ANDROID_PERMISSIONS = { RECORD_AUDIO, ACCESS_COARSE_LOCATION,
                                ACCESS_FINE_LOCATION, POST_NOTIFICATIONS }
```

Collapsed to what a reviewer would call them: **microphone, camera, photos, location,
notifications** — the exact five SC-002 requires the reviewer notes to name. There is no
biometric key and no biometric Android permission; both `USE_BIOMETRIC` and
`USE_FINGERPRINT` are in `BLOCKED_ANDROID_PERMISSIONS`, and `NSFaceIDUsageDescription` is
in `FORBIDDEN_IOS_KEYS` with `expo-secure-store`'s `faceIDPermission` pinned to `false`.

**Rationale for reusing these constants rather than restating them**: a second list of
"what the app declares" would need to be kept in step with the first, which is the failure
mode this feature is correcting one layer up. The new prose rule derives its notion of
"declared" from `ALLOWED_IOS_KEYS ∪ ALLOWED_ANDROID_PERMISSIONS`.

**Alternatives considered**: reading `app.json` directly in the prose rule — rejected,
because the script already parses it and the allow-lists are the *asserted* truth, not the
observed one; a prose rule keyed on the observed manifest would go quiet the moment
somebody added a permission without a justification.

---

## R-2: The spec's second premise, verified

**Decision**: `docs/compliance/permission-justifications.md` needs no removal. FR-003 is a
verification task, not an edit.

Read at HEAD, the document contains no `### NSFaceIDUsageDescription` justification
section. Its only biometric mentions are two recorded absences:

- *Permissions deliberately blocked* table, row `android.permission.USE_BIOMETRIC,
  android.permission.USE_FINGERPRINT` — "There is no biometric sign-in anywhere in the
  app. […] Both arrive transitively and are stripped at manifest-merge time."
- *Keys deliberately absent* table, row `NSFaceIDUsageDescription` — "There is no biometric
  sign-in anywhere in the app. […] `expo-secure-store` is configured with
  `faceIDPermission: false` so the key is deleted on every regeneration."

Feature 053 (commit `764e18e`) made that change. The spec's first assumption already
recorded this; this is the confirming read.

**Rationale for keeping the entries**: they state the truth rather than promising a
feature, and they are what tells the next engineer the absence is a decision. Deleting
them re-opens the question 053 closed. They are also the reason the new gate rule needs an
exemption mechanism at all (FR-017).

---

## R-3: Where the two live claims are

**Decision**: two edits, both narrow.

1. `docs/compliance/reviewer-notes.md`, `### Permissions`: "The app asks for microphone
   (voice calls and voice messages), camera and photos (…), **Face ID (optional faster
   sign-in)**, location (…) and notifications." The clause is removed, not reworded
   (FR-001). The paragraph's closing sentence "There is no background location." is an
   absence statement and is dealt with under R-5.
2. `docs/compliance/data-collection-inventory.md`, `### Not collected`: "Health, fitness,
   or biometric identifiers. **Face ID and fingerprint sign-in are performed by the
   operating system; the app receives only success or failure and never the biometric
   itself.**" The second sentence describes the data flow of a feature that was never
   built. It is replaced by a statement that the app performs no biometric authentication
   (FR-002).

**Alternatives considered**: rewording the reviewer-notes clause to "Face ID is not used"
— rejected by FR-001, and rightly: the permissions paragraph is a list of what the app
*asks for*, and an entry saying "not this one" in a list of five is noise in text a
reviewer skims. The absence belongs in a section about absences (R-5).

---

## R-4: What the app does with a coordinate — and a drift finding

**Decision**: the honest answer to FR-011 is "a task-evidence coordinate is stored and is
visible only to people who can review that submission; a calendar check-in captures a
coordinate and throws it away." The second half is a **drift finding**, recorded and not
fixed here.

Evidence:

- `collaboration.evidence_submission` (`backend/database/scripts/schema.sql:873-875`) has
  `gps_latitude numeric(10,7)`, `gps_longitude`, `gps_accuracy_meters`. They are populated
  for `gps_checkin` evidence and for `photo` evidence, and are returned to clients as
  `rpcv1.GpsCoordinates` from both `evidence_logic.go:525` and
  `evidence_review_queue_logic.go:230`.
- Who can see it: `ApproveEvidence` / `RejectEvidence` / `ListEvidenceReviewQueue` require
  the `collab.reviewEvidence` permission **and** non-`viewer` membership of the
  submission's project (`CheckProjectAccess`). An org-wide permission holder who is not a
  member of the project is refused. So the audience is "the people who review that task's
  evidence in that project", not the workspace.
- `calendar.check_in` (`schema.sql:332-342`) has **no** coordinate columns — only
  `checked_in_at`, `is_late`, `evidence_file_ids`.
- `frontend/apps/mobile/src/app/(app)/(calendar)/[eventId].tsx:69-75` requests foreground
  location permission and calls `getCurrentPositionAsync`, then **discards the result** and
  calls `checkInToEvent(eventId)` with no coordinate. Its own comment says "used for
  client-side context; server validates geofence", but nothing client-side consumes it and
  no geofence is evaluated on this path.

**Consequences**, all inside this feature's scope:

- The age-rating location answer says the coordinate is not shared with other users in any
  feed, map or presence surface; the only audience is an evidence reviewer, and only for a
  submission they already have access to.
- `data-collection-inventory.md`'s Location row currently reads "Where it is collected:
  Calendar check-in, ritual task evidence". Only the second is true of *collection*.
  The spec's out-of-scope list admits "correcting anything the location question proves
  wrong", so the row is corrected.
- The app asking for a permission whose reading it discards is exactly the shape of problem
  feature 053 existed to remove, one layer down. Per the spec's assumption that nothing the
  app does changes, it is **recorded in the drift register in `docs/domain/README.md`** and
  left for its own change. It does not make the reviewer notes wrong — the app genuinely
  asks for location, and genuinely uses it for task evidence.

**Alternatives considered**: deleting the discarded `getCurrentPositionAsync` call here,
since the diff is three lines. Rejected — it changes a permission prompt's timing on the
calendar path (today the prompt appears at check-in; removing the call moves the first
prompt to the first task-evidence submission), which is a user-visible behaviour change
smuggled into a documentation feature.

---

## R-5: How the gate distinguishes a false promise from a recorded absence

**Decision**: one exemption mechanism — a **recorded-absence section**, declared by
document and heading inside the gate script. A capability term outside such a section, whose
backing declaration is not in the allow-lists, fails the build.

The alternative considered first and rejected was **negation detection**: allow any line
whose sentence contains "no", "not", "never", "absent". Every recorded-absence line at HEAD
happens to be negated, so it would work today. It was rejected because it is a
natural-language heuristic pretending to be a build rule — the spec's own assumption warns
against "anything cleverer [being] a natural-language problem dressed as a build step" — and
because it fails open in the dangerous direction: "Face ID sign-in requires no additional
setup" passes a negation check while being exactly the false promise this guards against.

The section mechanism has one cost: the reviewer notes' sentence "There is no background
location." sits in the middle of the permissions paragraph, with no section to live in.
Rather than special-case it, the paragraph is split: `### Permissions` keeps the five it
asks for, and a new `### Not requested` section states what it does not ask for. This is
a small gain for the reviewer independent of the gate — it preempts "why does an app with
a sign-in screen not offer Face ID?" — and it gives every compliance document the same
shape: live claims in prose, absences in a declared section.

**Sections declared** (see [contracts/prose-gate.md](contracts/prose-gate.md) for the exact
grammar):

| Document | Section heading |
|---|---|
| `permission-justifications.md` | `Permissions deliberately blocked`, `Keys deliberately absent` |
| `data-collection-inventory.md` | `Not collected` |
| `reviewer-notes.md` | `Not requested` |
| `age-rating-answers.md` | `Capabilities the app does not have` |

---

## R-6: The capability vocabulary

**Decision**: a fixed, short list of terms, each mapped to the declaration that would make
it a true claim. Deliberately narrow.

| Term (case-insensitive substring) | Backing declaration |
|---|---|
| `face id` | `NSFaceIDUsageDescription` |
| `touch id` | `NSFaceIDUsageDescription` |
| `biometric` | `android.permission.USE_BIOMETRIC` |
| `fingerprint` | `android.permission.USE_FINGERPRINT` |
| `background location` | `NSLocationAlwaysUsageDescription` |
| `always-on location` | `NSLocationAlwaysAndWhenInUseUsageDescription` |
| `bluetooth` | `android.permission.BLUETOOTH_CONNECT` |
| `healthkit` | `NSHealthShareUsageDescription` |
| `speech recognition` | `NSSpeechRecognitionUsageDescription` |
| `motion and fitness` | `NSMotionUsageDescription` |
| `nfc` | `NFCReaderUsageDescription` |
| `contact list` / `address book` | `NSContactsUsageDescription` |

**Rationale**: these are the capabilities whose *name alone* reads as a promise to a
reviewer. The list is scanned as plain substrings, which is why the entries are compound
where the bare word would be ambiguous — "location", "camera", "photos", "microphone" and
"notifications" are excluded because they are declared and would pass trivially, and
"calendar" and "contacts" are excluded because they are this product's own feature words
("calendar events", "contact info") and would fire constantly. `contact list` and
`address book` cover the actual capability without colliding with those.

**Note on `bluetooth`**: `android.permission.BLUETOOTH` and `BLUETOOTH_CONNECT` are in
`ANDROID_PERMISSIONS_IGNORED` (auto-added by the build, no user prompt), not in
`ALLOWED_ANDROID_PERMISSIONS`. "Declared" for the prose rule means the allow-lists only, so
a document claiming a Bluetooth feature fails — correctly, since the app has none.

**Alternatives considered**: deriving the vocabulary from `FORBIDDEN_IOS_KEYS` and
`BLOCKED_ANDROID_PERMISSIONS` automatically. Rejected: those are manifest identifiers
(`NSFaceIDUsageDescription`), and prose says "Face ID". The mapping from the words a
reviewer reads to the keys a manifest declares is the content of the rule, and it has to
be written down.

---

## R-7: What the age-rating questionnaires ask

**Decision**: the document is organised by capability question, per store, and the exact
question wording is transcribed from the live consoles during implementation.

The spec's final assumption already fixes this: the questionnaires changed in September
2026 and will change again, so reproducing their wording from memory into a plan would bake
in a stale transcription. What is fixed here is the **answer set** — the facts each answer
must be built from, all verified in the repository:

| Question area | Answer | Evidence in the repository |
|---|---|---|
| Feed of user-posted content | **Yes** | `chat.channel` with `channel_type = 'chat'`; the demo workspace's "Site updates" channel (`backend/cmd/seed_demo.go:257`). No public or cross-workspace channel type exists. |
| Person-to-person messaging | **Yes**, colleagues in one workspace | `CreateOrGetDirectMessage`, `channel_type = 'direct_message'` (`docs/domain/chat.md`) |
| Person-to-person calling | **Yes**, same scope | voice call initiation in a direct conversation (`docs/domain/voice.md`, `docs/domain/compliance-safety.md`) |
| Discovery of / contact with strangers | **No** | every table carries `organization_id` and every query pins it (constitution I, enforced by `make lint-tenancy`); there is no RPC that reaches an identity in another organization |
| Public profiles | **No** | employee cards are readable only inside the workspace (`docs/domain/organization-people.md`) |
| Follower / friend relationships | **No** | no such table or RPC exists; the only person-to-person relation rows are `compliance.block` and channel membership |
| Joining a workspace | invitation or administrator only | `AcceptInvitation`, admin member management (`docs/domain/organization-people.md`, `auth-identity.md`) |
| Pre-publication moderation | **No** | messages are written straight to `chat.message`; no review state exists on the write path |
| After-the-fact safeguards | reporting, owner-side queue with snapshot, blocking, terms, abuse address | `compliance.content_report` with its snapshot; `ListReports`/`ResolveReport` behind `compliance.reviewReports` (web-only); `compliance.block` at two chokepoints; `iam.CurrentTermsVersion`; `ABUSE_CONTACT_EMAIL = 'abuse@transformar.work'` (`frontend/packages/apis/src/legal.ts:28`) |
| Location shared with other users | **No** shared surface; evidence reviewers only | R-4 |
| Unrestricted web access | **No in-app browser**, with a stated qualifier | the only `expo-web-browser` calls open the app's own `/privacy` and `/terms` (`src/app/(app)/(more)/settings.tsx:381,388`) and the More screen's own links. A link a colleague posts in chat, or submits as task evidence, is handed to the **system browser** via `Linking.openURL` (`src/components/chat/chat-message-body.tsx:144`, `src/app/(app)/(tasks)/[projectId]/task/[taskId].tsx:866`) — it leaves the app rather than rendering inside it. The answer must say both halves: no embedded browser, and yes, colleagues can post links that open elsewhere. |
| In-app purchases, gambling, ads | **No** | no payment, advertising or analytics SDK is a dependency (`data-collection-inventory.md`, "used for tracking = No" for every row) |

[ASSUMPTION: the resulting rating is written into the document as the store's computed
outcome at the moment the form is filled in, and until the first submission the document
carries the expected outcome with its reasoning and an explicit "provisional — not yet
confirmed against the live form" marker beside it, dated. FR-012 requires the produced
rating to be recorded, and the questionnaire that produces it lives outside this
repository, so the only honest way to satisfy FR-012 before submission is to state the
expectation, mark it unconfirmed, and let FR-014's date stamp make its staleness visible.
An unmoderated user-communication app with no other mature content is expected to land in
the teen band on both stores — Apple's mid-band rather than 4+ or 9+, and IARC's Teen
rather than Everyone — driven entirely by the unmoderated-communication answers, with no
content-based contribution. The alternative, leaving the field blank until someone submits,
would let the document ship without the one number a submitter most needs to sanity-check
their own form against.]

---

## R-8: Where the gate runs today

**Decision**: no wiring change. The rule goes into the script that is already a
prerequisite of the mobile test target.

`Makefile:289` — `test-mobile: check-store-manifest check-backend check-maestro check-maestro-env`,
and `Makefile:283-285` runs `node frontend/apps/mobile/scripts/check-store-manifest.js`.
Section 3 of that script already opens `docs/compliance/permission-justifications.md` and
asserts it mentions every allowed permission. The new rule is section 4 and opens the
sibling documents in the same directory.

This is what makes FR-019 and SC-009 nearly free: the gate is already the first thing
`make test-mobile` runs, and it already fails the build rather than warning.

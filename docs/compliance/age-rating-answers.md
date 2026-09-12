# Age rating answers

The single source both stores' age-rating questionnaires are filled in from: the App
Store Connect age rating questionnaire and the Play Console IARC questionnaire. Every
answer below carries the evidence behind it, so the same answer is given at the next
submission and by the next person.

This is not the privacy disclosure. That lives in
[data-collection-inventory.md](data-collection-inventory.md), which is a different form
with a different audience.

**Last checked against the live forms: 2026-05-31.**

> ⚠️ **The question wording below is transcribed from the most recent form revision
> known when this document was written, not read off the live console.** The stores
> revised these questionnaires in September 2026. Before the next submission, open both
> consoles, reconcile the question text against what is actually on screen, add a row for
> anything new, and move the date above to that day. The **answers** are verified against
> this repository and do not depend on the wording; only the question text and the
> grouping do.

## Definition of Done — standing obligation

**A change that adds, removes, or reshapes a communication or content-sharing
capability updates this file in the same change set.** That includes a new channel
type, a new way for one person to reach another, a new surface that shows one person's
content to another, a change to what is shared about someone's location, and a change
to moderation or to any of the safeguards below. This is part of the Definition of
Done, not a follow-up task, because an age rating that no longer matches the app is a
misrepresentation that is already live in both stores.

When this file changes, re-check:

1. The App Store Connect age rating questionnaire.
2. The Play Console IARC questionnaire.
3. [reviewer-notes.md](reviewer-notes.md), if the change is something a reviewer
   would need to be told how to find.

Both questionnaires live outside this repository, which is why re-answering them is a
manual step in the submission runbook rather than something CI can assert.

---

## The workspace boundary

**Read this before any answer below.** Several answers are an honest `Yes` — there is a
feed, there is messaging, there is calling, and none of it is moderated before it is
visible. What those answers do *not* mean is that a stranger can reach anybody, because
a TechOffice workspace is closed at every layer:

- **Membership is created, never joined.** A person becomes a member of a workspace in
  exactly two ways: they accept an invitation sent to their email address
  (`IAMService.AcceptInvitation`, `backend/internal/iam/connect_auth.go:725`), or an
  administrator creates their account for them in admin member management. There is no
  sign-up-and-search flow, no public workspace directory, no join code, and no request
  to join.
- **No surface reaches outside the workspace.** Every tenant table carries an
  `organization_id` and every query pins it (Constitution principle I). That rule is
  machine-checked: `make lint-tenancy` fails the build on a tenant query without an
  organization predicate. There is no RPC anywhere in the product that returns an
  identity, a message, a file or a presence state belonging to another organization.
- **The people list is the staff list.** The only set of people any screen can show is
  the employees of the workspace the signed-in person belongs to
  (`docs/domain/organization-people.md`).

So every `Yes` below should be read as "yes, between colleagues who already work
together at one business". A TechOffice workspace is a workplace tool, and the
population a person can reach through it is the population their employer put there.

## Safeguards

Content is not reviewed before it is visible (see the moderation rows below). These are
the five after-the-fact safeguards that accompany it:

1. **In-app reporting, from the content's own menu.** Long-press a message on mobile, or
   open the ⋮ menu on web, and choose **Report**. Reaches `compliance.content_report`.
   Requires the `compliance.reportContent` permission, held by Owner, Operator and
   Employee — that is, everybody.
2. **An owner-side report queue that outlives deletion.** Each report stores **a snapshot
   of the content as it stood at report time**, and the server — not the client —
   resolves the author and the snapshot by calling the owning domain. An author who
   deletes the reported message does not erase the evidence. `ListReports` and
   `ResolveReport` require the `compliance.reviewReports` permission (Owner, Operator)
   and are a **web-only** surface: report review is an administrative action, and this
   product deliberately keeps administrative surfaces off mobile.
3. **Blocking, scoped to direct contact.** A block refuses direct conversations
   (`CreateOrGetDirectMessage`) and voice call initiation in a direct conversation,
   symmetrically, so comparing outcomes cannot reveal who blocked whom. It deliberately
   does **not** hide the blocked person's messages in a shared work channel, and the app
   says so on the confirmation screen before you block. The reason is stated here because
   a reviewer comparing this to a consumer app will otherwise read it as a gap: in a
   business where the messages are about where to be and what to do, letting somebody
   silently conceal work instructions addressed to them is a safety problem of its own.
   The blocked person is never notified, and no screen or RPC anywhere answers "who has
   blocked me".
4. **Published terms prohibiting objectionable content, accepted per account.** No
   account can exist without a recorded acceptance: both
   `RegisterOrganizationWithAdminPassword` and `AcceptInvitation` reject a missing or
   stale `accepted_terms_version`, and `GetTermsStatus`/`AcceptTerms` gate first use for
   admin-provisioned workers who never saw a signup screen. The version is defined once
   in `iam.CurrentTermsVersion` and mirrored by `TERMS_VERSION` in
   `frontend/packages/apis/src/legal.ts`.
5. **A monitored abuse address.** `ABUSE_CONTACT_EMAIL` in
   `frontend/packages/apis/src/legal.ts`. In-app reporting is the primary route because it
   reaches the workspace's own owners, who can act immediately; this address covers what
   in-app reporting cannot — somebody locked out, somebody outside the workspace, or a
   complaint about the workspace's own owners.

---

## App Store Connect

### App capabilities

| Question | Answer | Evidence | Qualifier |
|---|---|---|---|
| Does your app allow users to create, upload, or share user-generated content? | **Yes** | `chat.channel` with `channel_type = 'chat'`; messages, files, voice messages, documents, task comments and evidence submissions are all written by people in the workspace. Reproduce: sign in to the demo workspace and post in **Site updates** (seeded by `backend/cmd/seed_demo.go`) | Only to colleagues in the same workspace. No content is public and none crosses a workspace boundary |
| Does your app include a feed or stream of user-generated content? | **Yes** | A workspace chat channel is a chronological feed of colleague-posted messages. The demo workspace's **Site updates** channel is one | It is a workplace channel, not a public or algorithmic feed. `channel_type` admits only `chat`, `direct_message`, `project_ticket_thread`, `crm_deal_notes` and `support_ticket` (`backend/database/scripts/schema.sql:532`) — there is no public or cross-workspace type |
| Does your app allow users to communicate with each other? (messaging) | **Yes** | `ChatService.CreateOrGetDirectMessage` (`backend/internal/chat/connect.go:1186`), `channel_type = 'direct_message'`; see `docs/domain/chat.md` | Between colleagues in one workspace only |
| Does your app allow users to communicate with each other by voice or video? | **Yes** | Voice call initiation in a direct conversation; `docs/domain/voice.md` | Same scope. Call audio is carried by LiveKit; recording happens only when somebody in the call turns it on |
| Can users discover or search for other users they do not already know? | **No** | The only people any screen lists are the employees of the signed-in person's own workspace (`docs/domain/organization-people.md`). No RPC returns an identity outside the caller's `organization_id`, a rule `make lint-tenancy` enforces at build time | A person can find a colleague. That is the staff list of the business they work for |
| Can users contact people outside their own workspace? | **No** | Every tenant table carries `organization_id` and every query pins it (Constitution I, enforced by `make lint-tenancy`). There is no cross-organization messaging, calling, or lookup path | — |
| Does your app include public user profiles? | **No** | Employee cards are readable only inside the workspace (`docs/domain/organization-people.md`). Nothing about a person is reachable without being signed in as a member of their workspace | — |
| Does your app support follower, friend, or connection relationships between users? | **No** | No such table or RPC exists. The only person-to-person relation rows in the product are `compliance.block` and channel membership. Verify: `grep -niE 'CREATE TABLE.*(follow\|friend)' backend/database/scripts/schema.sql` returns nothing | Who can reach whom is decided by the employer, not by users connecting to each other |
| Is user-generated content reviewed or moderated before it becomes visible to other users? | **No** | Messages are written straight to `chat.message`; there is no review state anywhere on the write path | Safeguards are after the fact and are listed in **Safeguards** above: reporting, the owner-side queue with its snapshot, blocking, terms, and the abuse address |
| Can users share their location with other users? | **No** | See the location row below | — |
| Does your app share the user's location with other users? | **No shared surface.** A coordinate reaches only the people who review that one task submission | A coordinate is stored on `collaboration.evidence_submission` (`gps_latitude`, `gps_longitude`, `gps_accuracy_meters`, `backend/database/scripts/schema.sql:873`) when someone submits `gps_checkin` or photo evidence for a task that requires proof of presence. It is returned only through the evidence review path, which requires the `collab.reviewEvidence` permission **and** non-`viewer` membership of that submission's project (`CheckProjectAccess`, `backend/internal/collaboration/evidence_logic.go:297`). An org-wide permission holder who is not a member of the project is refused | There is no feed, no map, no presence surface and no profile field anywhere that shows one person's location to another. Calendar check-in stores no coordinate at all — `calendar.check_in` has no coordinate columns (`backend/database/scripts/schema.sql:332`) |
| Does your app provide unrestricted access to the web? | **No** | There is no embedded browser that renders third-party content. The only `expo-web-browser` calls open the app's own published `/privacy` and `/terms` pages (`frontend/apps/mobile/src/app/(app)/(more)/settings.tsx:381,388`) | A link a colleague posts in chat, or submits as task evidence, is handed to the **system browser** via `Linking.openURL` (`frontend/apps/mobile/src/components/chat/chat-message-body.tsx:144`; `frontend/apps/mobile/src/app/(app)/(tasks)/[projectId]/task/[taskId].tsx:866`). It leaves the app rather than rendering inside it, so the device's own parental controls and content restrictions apply |
| Does your app contain in-app purchases? | **No** | No payment or commerce SDK is a dependency, and no schema models a price, a product or a transaction. `data-collection-inventory.md` records Financial info as **none** | Billing for the product itself is arranged outside the app |
| Does your app display advertisements? | **No** | No advertising SDK is a dependency. Every row of the collection table in `data-collection-inventory.md` is **used for tracking = No**, and no category is collected for advertising or marketing | — |
| Does your app contain gambling or simulated gambling? | **No** | No such feature exists anywhere in the product | — |
| Does your app contain contests or sweepstakes? | **No** | No such feature exists anywhere in the product | — |
| Violence — cartoon or fantasy / realistic / prolonged graphic or sadistic | **None** | The app ships no content of its own. The only content in it is what colleagues write about their work | Colleague-posted content is unmoderated; that is answered in the moderation row above rather than by inflating a content-frequency answer |
| Sexual content or nudity | **None** | As above | As above |
| Profanity or crude humour | **None** | As above | As above |
| Alcohol, tobacco, or drug use or references | **None** | As above | As above |
| Horror or fear themes | **None** | As above | As above |
| Mature or suggestive themes | **None** | As above | As above |
| Medical or treatment-focused content | **No** | The app carries no medical, health, or treatment content and no health data. `data-collection-inventory.md` lists health and fitness data under **Not collected** | — |
| Does your app include in-app controls to restrict access to age-inappropriate content? | **No** | There are none, because there is no content channel to restrict: a person sees their own employer's workspace and nothing else | The app is a workplace tool for adults in employment. It is not directed at children, and the Kids Category does not apply |

### Resulting rating

**Expected: 13+.** `provisional — not yet confirmed against the live form` (as of
2026-09-12).

The rating is driven entirely by the capability answers, not by content: **user-generated
content**, **person-to-person messaging and calling**, and **no pre-publication
moderation**. Every content-frequency answer is `None`, there is no unrestricted web
access, no in-app purchases, no advertising and no gambling, so nothing else contributes.

The one answer that could move it is the moderation row. It stays `No`, because it is
true — see the fourth assumption in `specs/054-compliance-prose-age-rating/spec.md`: the
rating is recorded as the outcome of answering honestly, never worked backwards from a
target.

Record the number the console actually produces here after the first submission, and
delete the provisional marker.

---

## Play Console (IARC)

The IARC questionnaire produces a rating per territory (ESRB, PEGI, USK, ClassInd,
GRAC, IARC generic) from one set of answers. Its content section and its
**interactive elements** section are scored differently: content answers set the band,
interactive elements are disclosed as descriptors alongside it.

### Content

| Question | Answer | Evidence | Qualifier |
|---|---|---|---|
| Does the app contain violence? | **No** | The app ships no content of its own; the only content in it is what colleagues write about their work | Colleague-posted content is unmoderated. That is disclosed under interactive elements below, which is where IARC asks for it |
| Does the app contain sexual content or nudity? | **No** | As above | — |
| Does the app contain profanity or crude humour? | **No** | As above | — |
| Does the app reference or depict controlled substances (alcohol, tobacco, drugs)? | **No** | As above | — |
| Does the app contain gambling or simulated gambling? | **No** | No such feature exists anywhere in the product | — |
| Does the app contain content that may frighten young children? | **No** | As above | — |
| Is the app's content intended for children? | **No** | A workplace tool for people in employment. It is not in the Designed for Families programme, and its target age group is adults | — |

### Interactive elements

| Question | Answer | Evidence | Qualifier |
|---|---|---|---|
| Does the app allow users to interact or exchange content with other users? (Users Interact) | **Yes** | Chat channels, direct messages, voice calls, shared files, documents, task comments and evidence submissions — see `docs/domain/chat.md` and `docs/domain/voice.md`. Reproduce: post in **Site updates** in the demo workspace | Only between colleagues in the same workspace. A person cannot reach an identity in another organization through any surface (Constitution I, enforced by `make lint-tenancy`) |
| Is user-generated content moderated before it is shown to other users? | **No** | Messages are written straight to `chat.message`; no review state exists on the write path | After-the-fact safeguards are listed in **Safeguards** above. `compliance.content_report` stores a snapshot of the reported content, so a report survives the author deleting its subject |
| Can users communicate by voice or video with other users? | **Yes** | Voice call initiation in a direct conversation; `docs/domain/voice.md` | Same workspace-only scope |
| Can users discover, search for, or be contacted by users they do not know? | **No** | Membership arises only from `IAMService.AcceptInvitation` (`backend/internal/iam/connect_auth.go:725`) or from an administrator creating the account. There is no public directory, join code, or join request | — |
| Does the app share the user's current physical location with other users? (Shares Location) | **No** | A task-evidence coordinate on `collaboration.evidence_submission` (`backend/database/scripts/schema.sql:873`) is visible only to reviewers of that one submission, who must hold `collab.reviewEvidence` **and** be a non-`viewer` member of that project (`backend/internal/collaboration/evidence_logic.go:297`). There is no feed, map, or presence surface that shows a person's location to another person. `calendar.check_in` stores no coordinate at all (`backend/database/scripts/schema.sql:332`) | This is a record attached to a piece of submitted work, reviewed by the person who has to approve that work — not a location shared with other users. If the form treats any user-visible coordinate as sharing, answer **Yes** and give this qualifier verbatim; the underlying facts are what matter and they are stated here either way |
| Does the app allow users to purchase digital goods? (Digital Purchases) | **No** | No payment or commerce SDK is a dependency; no schema models a price, product or transaction | — |
| Does the app display advertisements? | **No** | No advertising SDK is a dependency; every row of `data-collection-inventory.md` is **used for tracking = No** | — |
| Does the app contain an unrestricted web browser? | **No** | No embedded browser renders third-party content. The only `expo-web-browser` calls open the app's own `/privacy` and `/terms` (`frontend/apps/mobile/src/app/(app)/(more)/settings.tsx:381,388`) | Links posted by colleagues are handed to the **system browser** through `Linking.openURL` (`frontend/apps/mobile/src/components/chat/chat-message-body.tsx:144`), so they leave the app and the device's own restrictions apply |
| Does the app collect or share personal information? | **Yes** | The full inventory, with purposes and third parties, is in [data-collection-inventory.md](data-collection-inventory.md) | Collected for app functionality only; **used for tracking = No** for every category |

### Resulting rating

**Expected: the Teen band** — ESRB Teen, PEGI 12, USK 12 and their territory
equivalents — with the **Users Interact** and **Shares Info** interactive-element
descriptors attached. `provisional — not yet confirmed against the live form` (as of
2026-09-12).

Every content answer is `No`, so nothing in the content section raises the band. The
expectation above comes entirely from the unmoderated-communication answers.

**Read the number the form actually returns rather than assuming this one.** IARC has
historically attached `Users Interact` as a descriptor without moving the content band,
which would return the lowest band (ESRB Everyone, PEGI 3) with that descriptor instead.
Which of the two happens is decided by the live questionnaire, not by this document —
which is exactly why this section is marked provisional. Record the returned rating here
after the first submission and delete the marker.

---

## Capabilities the app does not have

Named here, once, so no answer above has to deny them in running prose:

- **Biometric sign-in.** There is no Face ID or fingerprint sign-in anywhere in the app,
  on any screen, and no biometric authentication library is a dependency. Signing in is
  email and password, or workspace address with login ID and PIN. The iOS key and both
  Android permissions are recorded as deliberately absent in
  [permission-justifications.md](permission-justifications.md).
- **Background location.** The app calls only `requestForegroundPermissionsAsync` and
  declares no "always" location key. It reads a coordinate only while it is open and only
  at the moment somebody checks in or submits evidence for a task that requires proof of
  presence. There is no geofencing and no significant-change monitoring.
- **An embedded web browser.** Nothing in the app renders third-party web content.
  Colleague-posted links are handed to the system browser, which is why the unrestricted
  web access answer is `No` on both forms.

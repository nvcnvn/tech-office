# Data collection inventory

The single source both stores' privacy disclosures are filled in from: the App
Store Connect privacy questionnaire and the Play Console Data safety form. It also
has to agree with the published privacy policy at `/privacy`
(`frontend/apps/web/src/app/privacy/page.tsx`) — if they disagree, one of them is
wrong, and this document is the one that gets checked against the code.

## Definition of Done — standing obligation

**A change that collects a new category of personal data, sends an existing
category to a new third party, or stops collecting something, updates this file in
the same change set.** So does a change to the published privacy policy. This is
part of the Definition of Done, not a follow-up task, because the cost of finding
out later is a store rejection or an inaccurate disclosure that is already public.

When this file changes, re-check:

1. `/privacy` — the published policy must describe the same collection.
2. The App Store Connect privacy questionnaire.
3. The Play Console Data safety form.

The two store forms live outside this repository, which is why they are a manual
step in the submission runbook rather than something CI can assert.

---

## Collected data

"Linked to you" means the data is associated with an identity. "Used for tracking"
is **No** for every row: TechOffice does not track people across apps or websites
owned by other companies, and contains no advertising or analytics SDK that does.

| Category | Specific data | Purpose | Linked to the person | Where it is collected | Third parties it reaches |
|---|---|---|---|---|---|
| Contact info | Name, email address | Account creation, sign-in, showing colleagues who you are | Yes | Signup, invitation acceptance, profile | Amazon SES (invitation and password-reset email only) |
| Contact info | Phone number, home address | Employer's personnel record, entered by an administrator | Yes | Admin member management | None |
| Sensitive info | Date of birth | Employer's personnel record, entered by an administrator | Yes | Admin member management | None |
| Credentials | Password hash, PIN hash, linked Google/Apple identity | Authentication | Yes | Signup, PIN setup, SSO linking | Google, Apple (only if the person chooses SSO) |
| User content | Messages, including direct messages | The work itself | Yes | Chat | None |
| User content | Photos, files and other uploads | Attachments to messages, tasks and job records | Yes | Chat, files, tasks | Cloudflare R2 (storage) |
| User content | Voice messages | Recorded audio sent in chat | Yes | Chat | Cloudflare R2 (storage) |
| User content | Documents and comments | Written procedures and discussion | Yes | Docs | None |
| User content | Tasks, task comments, evidence submissions | Tracking recurring and one-off work | Yes | Tasks and rituals | Cloudflare R2 (evidence photos) |
| User content | Calendar events, attendance, check-ins | Scheduling and confirming attendance | Yes | Calendar | None |
| User content | Content reports, including a snapshot of the reported content | Reviewing abuse reports; kept so a report outlives deletion of its subject | Yes | Reporting | None |
| Identifiers | User ID, employee ID, organization ID | Identifying the person and their workspace | Yes | Throughout | None |
| Identifiers | Push notification token, device identifier | Delivering notifications to the right device | Yes | Push registration | Firebase Cloud Messaging (Android), Apple Push Notification service (iOS) |
| Location | Coarse and precise location, captured once at check-in or on completing a task that requires proof of presence | Confirming presence at a job site | Yes | Calendar check-in, ritual task evidence | None |
| Usage data | Presence status, last-seen time, sign-in times | Showing colleagues who is available; letting a person review their own sessions | Yes | Presence, sessions | None |
| Diagnostics | IP address, user agent recorded against a session | Letting a person recognise and end a session; abuse investigation | Yes | Sign-in | None |
| Audio data | Voice call audio while a call is in progress; recording and transcript only when someone in the call turns recording on | Placing calls; keeping a record the workspace asked for | Yes | Voice calls | LiveKit (call media), Cloudflare R2 (recordings) |

### Not collected

Stated explicitly because both forms ask, and "not collected" is an answer that has
to be true rather than merely unstated:

- Payment or financial information.
- Health, fitness, or biometric identifiers. Face ID and fingerprint sign-in are
  performed by the operating system; the app receives only success or failure and
  never the biometric itself.
- Browsing history, search history outside the app, or advertising identifiers.
- Contacts, calendars, or photos beyond the individual items a person chooses to
  attach.
- Background location. The app calls only `requestForegroundPermissionsAsync` and
  declares no background-location key; see
  [permission-justifications.md](permission-justifications.md).

---

## Retention

| Category | How long |
|---|---|
| Workspace content (messages, files, documents, tasks, calendar) | For as long as the workspace exists. It is the business's own record of its work, and it survives an individual's deletion in de-identified form |
| Account and identity data | Until the account is deleted, at which point it is destroyed |
| Sessions | Until they expire or the person ends them; destroyed immediately on account deletion |
| Content reports, including the snapshot | Kept after resolution, so a pattern of behaviour stays visible. A report deliberately outlives deletion of its subject |
| Push tokens | Until the device unregisters or the account is deleted |
| Account deletion records | Kept as the audit trail of the erase itself |

## Deletion

A self-registered person deletes their account from inside the app; an
admin-provisioned worker sends an in-app removal request to the workspace's owners.
What is erased and what is retained is set out in `/privacy` and assembled
server-side so both clients state the same thing. See
`docs/domain/compliance-safety.md` for the mechanism.

---

## Store form answers

### App Store Connect privacy questionnaire

Answer **Yes** to collection for: Contact Info (name, email, phone, physical
address), Sensitive Info (date of birth), User Content (photos or videos, audio
data, customer support, other user content), Identifiers (user ID, device ID),
Usage Data (product interaction), Diagnostics (other diagnostic data), Location
(coarse and precise).

For every one of them: **linked to the user = Yes**, **used for tracking = No**,
and purpose = **App Functionality** only. No category is collected for advertising,
analytics, product personalisation, or developer's advertising or marketing.

### Play Console Data safety form

Declare collection (not sharing, except where a third party is named in the table
above) for: Personal info (name, email address, user IDs, address, phone number,
other info), Financial info — **none**, Location (approximate and precise),
Messages (other in-app messages), Photos and videos, Audio files (voice or sound
recordings), Files and docs, Calendar, App activity (other actions), App info and
performance — **none**, Device or other IDs.

Declare that data is **encrypted in transit**, and that users **can request that
data be deleted** — with the in-app path described in
[reviewer-notes.md](reviewer-notes.md), not a web form.

### Age rating

Both stores' questionnaires must be answered honestly about **unmoderated
person-to-person messaging**: the app allows people in the same workspace to
message and call each other without pre-publication moderation. Answer **Yes** to
the user-generated content and person-to-person communication questions, and
describe the safeguards: in-app reporting to the workspace's owners, blocking of
direct contact, published terms prohibiting objectionable content, and a monitored
abuse contact address.

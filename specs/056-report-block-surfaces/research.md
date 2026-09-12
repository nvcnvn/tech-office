# Phase 0 Research: Report and Block Wherever User Content Appears

**Feature**: 056-report-block-surfaces | **Date**: 2026-09-12

Every question below was answered by reading the code at HEAD, not by replaying specs.
The spec's central claim — "this is a client-side gap only" — was the first thing
checked, and it holds, with one correction and one wrapper defect recorded below.

---

## R-1: Does the backend already accept all five target kinds, unchanged?

**Decision**: Yes. No backend, proto, schema or permission change is required.
FR-022 and the spec's closing assumption are confirmed.

**Evidence**:

- `backend/internal/compliance/resolvers.go` registers one resolver per kind, and
  `backend/cmd/server.go:614` wires all four getters:
  `complianceLogic.RegisterResolvers(chatLogic, fileLogic, docsLogic, voiceLogic)`.
- `fileResolver` reads `files.GetFileMetadata` and returns
  `AuthorEmployeeID = result.File.UploadedBy` with a snapshot naming the filename,
  MIME type, size and upload context.
- `documentCommentResolver` reads `docs.GetCommentAuthorAndText` and returns the
  comment author and its text as the snapshot.
- `compliance.reportContent` and `compliance.blockPerson` are granted to Owner,
  Operator **and** Employee: the employee grant in
  `backend/database/migrations/20260310120000_init.up.sql` is an `id NOT IN (...)`
  exclusion list that names neither.

**Alternatives considered**: none — this was a verification, not a choice. Had it
failed, the spec said to surface it before writing code.

---

## R-2: How does a thread screen know whether its parent conversation is direct?

**Decision**: Read it from `getMessageById(threadRootId).channel.channelType`, and
**fix the `getMessageById` wrapper to map the proto enum to the `ChannelType` string
union** the way every other channel-returning wrapper in `apis` already does.

**Rationale**: the thread screen already fetches the parent message through
`getMessageById` twice (`thread/[messageId].tsx:526` and `:570`) and already keeps
`parentMessageData.channel.id`. The channel type it needs for FR-002 is in the same
response — `GetMessageByIdResponse.channel` is a full `Channel` message carrying
`channel_type`. Nothing new needs fetching.

The defect: `getMessageById` in `frontend/packages/apis/src/chat.ts:711` is a bare
pass-through — `chatClient.getMessageById({messageId}) as GetMessageByIdResponse` —
so its `channel.channelType` is a raw proto enum **number**. Every other channel
path in that file maps through `convertChannelType()` (e.g. `:1007`, `:1320`), which
is why the channel screen can write `channelData?.channel?.channelType ===
"direct_message"` and the thread screen cannot. Comparing the raw enum in a screen is
exactly what Constitution Principle VIII forbids ("no screen ever compares a raw enum
number"), so the fix belongs in the wrapper, which is also Principle VII.

Both existing callers (`frontend/apps/web/src/app/workspace/chat/page.tsx:99` and the
two thread-screen queries) read only `channel.id` and `message.*`, so returning a
mapped shape breaks nothing observable. It is a breaking change to the wrapper's
return type, shipped atomically across the repo — which is how this project handles
breaking changes.

**Alternatives considered**:

- *Compare the enum number in the thread screen* — smallest possible diff, and a
  direct Principle VIII violation that would have to be undone later. Rejected.
- *Call `getChannel(parentChannelId)` for the mapped type* — a third network round
  trip per thread open to fetch a field already in hand. Rejected.

---

## R-3: Should the thread action sheet share a component with the channel one?

**Decision**: No. Duplicate the two action **rows** in `ThreadMessageActionSheet`,
with the copy and `testID`s copied verbatim from the channel sheet, and share the
two things that actually matter: `ReportSheet` and `BlockConfirm`.

**Rationale**: FR-018 and SC-003 constrain the number of report *forms* and block
*confirmations*, not the number of places a row is drawn. The forms are already
standalone components in `frontend/apps/mobile/src/components/compliance/`, and
mounting them is a four-line change per screen.

Extracting the rows would not be cheap: each screen defines its own
`actionSheetRow` / `actionSheetIconWrap` / `actionSheetRowBody` styles through its
own `makeStyles`, so a shared row component means moving styles out of a 2,500-line
screen file that is not otherwise being touched. The two sheets also legitimately
differ — the channel sheet has "Open thread" and "Create task", the thread sheet has
"Move to channel" — so they are not converging on one component anyway.

**Alternatives considered**: a shared `<MessageSafetyActions>` in
`components/compliance/`. Rejected as a larger diff into an unrelated file for a
drift risk that a matching `testID` pair and one E2E assertion already cover.

---

## R-4: Does the channel screen's block rule actually match the spec's edge case?

**Decision**: No — and the thread must not copy the mismatch. `canBlockAuthor` gets a
`messageKind !== "system"` clause, applied on **both** screens in this change set.

**Rationale**: the spec's edge case says a system message ("somebody joined", "a call
ended") is offered a report control and no block control, "because there is no person
behind it". The channel screen at `[channelId].tsx:2319` decides with
`!!selectedMessage?.authorEmployeeId && selectedMessage.authorEmployeeId !==
auth.employeeId`, which assumes system rows have no author.

They do. `backend/internal/chat/logic.go:3494` inserts system messages with
`author_employee_id = actorID` — the person whose action produced the row, not a
speaker. So today, long-pressing "X created task ABC-12" in a channel offers "Block
this person" for X. That is a real, pre-existing defect one screen over from the one
being changed, and FR-003's "a message with no human author" is what it was meant to
express. Fixing it only in the thread would leave the sibling caller broken and make
the two screens disagree, which FR-003's "mirrors the channel screen exactly" is
specifically trying to prevent.

Note the channel screen already uses exactly this predicate for a neighbouring
control: `canCreateTask={selectedMessage?.messageKind !== "system"}` (`:2338`).

**Alternatives considered**: leaving the channel screen alone and filing a follow-up.
Rejected — it is a one-clause change in a line this feature is reading anyway, and
shipping a thread that deliberately behaves differently from the screen it is meant
to mirror is worse than the fix.

---

## R-5: How does a profile know whether it is showing Block or Unblock?

**Decision**: `useQuery({ queryKey: ["compliance", "blocked-people"], queryFn:
listBlockedPeople })` — the **same query key** the channel screen already uses — and
render no contact control at all until that query has resolved.

**Rationale**: `ListBlockedPeople` is the only call in the product that answers "is
this person blocked", by design (`docs/domain/compliance-safety.md`: "There is no RPC
that answers 'who has blocked me'... The absence is the requirement"). Reusing the
existing query key means the cache is shared with the channel screen and with
`(more)/blocked.tsx`, one invalidation after `BlockConfirm.onDone` updates every
mounted screen, and FR-008 ("show the resulting state without navigating away") falls
out of React Query rather than needing local state.

Withholding the control until `isSuccess` is the spec's own edge case — a control
that renders "Block" and then flips to "Unblock" a beat later is worse than one that
arrives a beat late. The list is small (one row per block) and `staleTime: 60_000`
matches the channel screen.

**Alternatives considered**:

- *A new `IsBlocked(employeeId)` RPC* — a backend change FR-022 forbids, to replace a
  call that already returns the answer.
- *Add an `isBlocked` field to the directory entry* — same objection, plus it would
  put one person's private block list into a shared directory response.

---

## R-6: What shape should the file report control take on mobile?

**Decision**: a secondary `Report` button next to the existing `Download` button, in
the `fileActions` row on the list card and the `actions` row on the detail screen.
One `ReportSheet` per screen, driven by a `reportFileId` state.

**Rationale**: neither mobile file surface has an actions menu today — the list card
ends in a `<Button label="Download">` plus a hint line, and the detail card is the
same shape. "Offers Report alongside Download" (AS-1, AS-2) is satisfied literally
and in one tap rather than two, and it reuses the `Button` primitive already imported
on both screens. Adding an overflow menu to get a menu item would be building a
container in order to put one thing in it.

`subjectLabel="this file"` satisfies FR-015's "describe its subject as a file" — the
prop exists on `ReportSheet` for precisely this and is documented as such in its
signature.

**Alternatives considered**: a long-press action sheet mirroring chat. Rejected —
files have no long-press affordance anywhere in the app, so it would be undiscoverable
on the one surface this feature exists to make discoverable.

---

## R-7: Which web files surface gets the control, and who can reach it?

**Decision**: the Management tab's per-row Actions cell in
`frontend/apps/web/src/app/workspace/files/components/ManagementTab.tsx`, as a flag
`IconButton` beside the existing delete `IconButton`.

**Rationale**: that table is the only place on web that lists files with a per-file
Actions column; the Overview tab shows quota and storage statistics. `ListFiles`
requires `files.list`, which the Employee role template holds (it is not in the
exclusion list), so the surface is reachable by every role the report permission is
granted to. No permission change, consistent with FR-022.

**Alternatives considered**: the chat `FileAttachment` component, so a file could be
reported where it was posted. It is a defensible second surface and is **not** in
scope — FR-014 asks for the files page, and the message carrying the attachment is
already reportable.

---

## R-8: How does each client identify the signed-in person, for own-content rules?

**Decision**: mobile uses `useAuth().employeeId`; web uses
`useAuth().user.membershipId`.

**Rationale**: the mobile channel screen already compares
`selectedMessage.authorEmployeeId !== auth.employeeId` (`:2321`). On web,
`UserProfile.membershipId` is `OrganizationMembership.id`, which the proto documents
as "Membership ID (UUID) — derived from employee ID" (`backend/rpc/v1/iam.proto:812`)
and which `AuthProvider` already passes to `getEmployeePermissions(membershipId)` as
an employee id. `Comment.authorEmployeeId` exists on the API type
(`frontend/packages/apis/src/docs.ts:96`), so FR-016's own-comment rule is decidable
client-side with no extra call.

**Alternatives considered**: comparing `authorName` to the display name. Rejected —
two colleagues can share a display name.

---

## R-9: Do the failure paths in FR-019 need any new code?

**Decision**: No. Both forms already do it.

**Rationale**: `ReportSheet.submit` catches, sets `error` to `err.message`, and
leaves the sheet open with the reason list still on screen; `ReportContentDialog` does
the same into an `<Alert>`; `BlockConfirm` renders its error and re-enables the
button. The server-side messages they surface are already written for a person to
read: `ErrTargetNotFound` = "the reported item could not be found",
`ErrReportAlreadyFiled` = "you have already reported this item; it is waiting for
review" (`backend/internal/compliance/errors.go`). US3 AS-5 (report a file somebody
just deleted) is therefore already-correct behaviour that this feature needs to
**test**, not build.

---

## R-10: What is not covered by tests today?

**Decision**: add backend integration scenarios for the `file` and
`document_comment` target kinds; add E2E scenarios for the web comment and web file
controls; add Maestro flows for the thread report and the profile block. Do **not**
add backend scenarios for blocking.

**Rationale**: `backend/integration/compliance_report_test.go` exercises
`chat_message` and `direct_message` only — the two kinds that were reachable. The file
and comment resolvers have never been executed by a test, and this feature is what
makes them reachable, so they are exactly the user-observable behaviour Principle II
requires a scenario for.

Blocking is the opposite case: `compliance_block_test.go` already covers recording,
silence ("the blocked person is not notified"), symmetry, idempotence and the
unblock path. US2 adds no server behaviour — a block from a profile is byte-identical
to a block from a message — so a new backend scenario would assert the same RPC twice.
That exclusion is recorded in the plan's Constitution Check.

**Alternatives considered**: a Maestro flow that blocks from the profile *and*
verifies the refusal. Rejected for the reason the existing `block-person.yaml` records
in its own header: arranging a second account's content in a shared simulator is not
deterministic. The flow asserts the control flips to Unblock; the refusal is asserted
in Go.

---

## R-11: Does anything outside the code need to change?

**Decision**: yes — `docs/compliance/reviewer-notes.md` and
`docs/domain/compliance-safety.md`.

**Rationale**: SC-004 is worded as "a store reviewer following the **published review
notes** can file a report from every content surface the notes name". Today those
notes name exactly one report surface (a channel message) and one block surface (a
message menu). Leaving them unchanged would leave SC-004 trivially true and
practically false. Principle XII makes the domain snapshot update mandatory in the
same change set, and `compliance-safety.md` currently describes reporting and blocking
without saying where the controls are — the gap this feature closes.

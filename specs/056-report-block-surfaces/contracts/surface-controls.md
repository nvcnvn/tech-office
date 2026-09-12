# Contract: Safety controls, per surface

**Feature**: 056-report-block-surfaces

This is the interface this feature exposes. It is a UI contract, not an RPC contract —
no RPC, proto, permission or schema changes (see [../data-model.md](../data-model.md)).
Every row below is a control a person can see and press, its stable test identifier,
and what it sends.

Rows marked **exists** are unchanged and listed so the table is the complete picture
SC-001 is measured against.

## Report controls

| # | Surface | File | Control | Test id | `targetKind` | `subjectLabel` | Shown when |
|---|---|---|---|---|---|---|---|
| 1 | Channel message (mobile) | `app/(app)/(chat)/[channelId].tsx` | action-sheet row | `message-action-report` | `direct_message` if the channel is direct, else `chat_message` | `this message` | always — **exists** |
| 2 | Chat message (web) | `workspace/chat/components/MessageItem.tsx` | ⋮ menu item | `message-menu-report` | as above | `this message` | always — **exists** |
| 3 | Thread reply (mobile) | `app/(app)/(chat)/thread/[messageId].tsx` | action-sheet row | `message-action-report` | `direct_message` if the thread's **parent conversation** is direct, else `chat_message` | `this message` | always, including system rows |
| 4 | Thread parent card (mobile) | same file | same sheet | `message-action-report` | as row 3 | `this message` | always |
| 5 | File list row (mobile) | `app/(app)/(more)/files/index.tsx` | button beside Download | `file-report-<fileId>` | `file` | `this file` | always |
| 6 | File detail (mobile) | `app/(app)/(more)/files/[fileId].tsx` | button beside Download | `file-detail-report` | `file` | `this file` | always, including while the safety check is pending |
| 7 | Files table row (web) | `workspace/files/components/ManagementTab.tsx` | flag icon button in Actions | `file-report-btn-<fileId>` | `file` | `this file` | always |
| 8 | Document comment (web) | `workspace/docs/components/CommentsPanel.tsx` | flag icon button in the comment's actions | `comment-report-<commentId>` | `document_comment` | `this comment` | `comment.authorEmployeeId !== user.membershipId` |

Rows 3–8 are new. Rows 3 and 4 share one sheet instance; only one message is selected
at a time.

**Reachability (FR-004, SC-001)** — every row is at most three presses from seeing the
content: mobile messages are long-press → Report → reason; every other row is
Report → reason (two).

## Block controls

| # | Surface | File | Control | Test id | Shown when |
|---|---|---|---|---|---|
| 9 | Channel message (mobile) | `app/(app)/(chat)/[channelId].tsx` | action-sheet row | `message-action-block` | `messageKind !== 'system' && authorEmployeeId && authorEmployeeId !== self` — **exists, predicate corrected** (research R-4) |
| 10 | Thread message (mobile) | `app/(app)/(chat)/thread/[messageId].tsx` | action-sheet row | `message-action-block` | identical predicate to row 9 |
| 11 | Person profile (mobile) | `app/(app)/(more)/people/[employeeId].tsx` | button under the header | `person-block-button` | block list resolved **and** `!entry.isSelf` **and** not already blocked |
| 12 | Person profile (mobile) | same file | button under the header | `person-unblock-button` | block list resolved **and** `!entry.isSelf` **and** already blocked |

Rows 11 and 12 are mutually exclusive and neither renders while
`listBlockedPeople` is unresolved. On the signed-in person's own entry neither
renders, and the existing "Open your profile" button is unaffected.

**Web block**: still none. Recorded as a remaining gap by the spec and by the drift
register; not added here.

## Shared forms (FR-018, SC-003)

Exactly one of each per client, all pre-existing, all reused as-is:

| Client | Report form | Block confirmation |
|---|---|---|
| mobile | `components/compliance/report-sheet.tsx` → `ReportSheet` | `components/compliance/block-confirm.tsx` → `BlockConfirm` |
| web | `workspace/components/ReportContentDialog.tsx` | *(none — web cannot block)* |

No new report form, block confirmation or reason-label list may be introduced. The
reason labels stay in `REPORT_REASON_LABELS` in `apis`, which both forms read.

## Copy

The two new mobile action rows repeat the channel sheet's wording **verbatim**, so a
person who learned the gesture in a channel meets the same words in a thread:

| Row | Title | Body |
|---|---|---|
| Report | `Report this message` | `Tell the people who run this workspace that something here is wrong.` |
| Block | `Block this person` | `Stop them starting a direct conversation or calling you. They are not told.` |

`BlockConfirm` supplies the scope statement FR-009 requires (direct conversations and
calls stop; shared channels are unaffected) and is not re-worded.

## Failure behaviour (FR-019)

Unchanged, and asserted rather than built:

| Refusal | Server reason | What the person sees |
|---|---|---|
| already reported | `COMPLIANCE_REPORT_ALREADY_FILED` | "you have already reported this item; it is waiting for review", in the open sheet, content still on screen |
| content gone | `COMPLIANCE_REPORT_TARGET_NOT_FOUND` | "the reported item could not be found", same placement |
| network failure | — | the form's own fallback text; the form stays open and retryable |

No control may close on failure, and no control may report success it did not receive
(SC-006).

## What the client never sends (FR-020)

`ReportContent` carries `targetKind`, `targetId`, `reason` and an optional `note`.
The reported author and the content snapshot are resolved server-side by
`internal/compliance/resolvers.go`. No control added here may send either.

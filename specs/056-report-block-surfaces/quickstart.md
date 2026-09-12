# Quickstart: validating report and block on every surface

**Branch**: `056-report-block-surfaces` | **Spec**: [spec.md](spec.md)

Proves the one thing this feature claims: from every screen that shows something
another person made, a person can say it is wrong — and from a colleague's profile, a
person can stop contact. The control map is in
[contracts/surface-controls.md](contracts/surface-controls.md); the scenarios are in
[contracts/test-scenarios.md](contracts/test-scenarios.md).

## Prerequisites

```bash
make dev-up          # Postgres, Redis, MinIO
make migrate         # forward-only migrations (no new migration in this feature)
make dev-backend     # the API the clients talk to
```

For the manual walkthroughs you need a demo workspace with two people and some
content:

```bash
cd backend && go run ./cmd seed-demo-org --subdomain demo
```

---

## 1. The automated suites, in full

Constitution Principle II: the whole of each suite, not only the new tests.

```bash
make test-backend                       # go test ./integration/...
make test-frontend                      # Playwright, every spec
make test-mobile                        # every Maestro flow, plus the store-manifest gate
```

**Expected**: zero failures in all three, and no `t.Skip("TODO")` or `test.skip`
remaining for this feature.

To iterate on just the new work while building:

```bash
make test-backend-one T=TestContentReporting
make test-frontend-one F=compliance-report.spec.ts
make test-mobile-one F=compliance/report-thread-message
make test-mobile-one F=compliance/block-from-profile
make test-mobile-one F=compliance/report-file
```

---

## 2. Walk the mobile surfaces by hand

Sign in to the demo workspace on a phone or simulator, **and repeat the whole of this
section on Android as well as iOS** — the two new file controls sit in a row beside an
existing button, which is exactly where a narrow Android layout breaks first.

**2a. Report a thread reply (US1)**
Open a channel → long-press a message → *Reply in thread* → post a reply from another
account, or open a thread that already has one → long-press the reply.
**Expected**: *Report this message* and *Block this person* appear, worded exactly as
in the channel timeline. Tap Report, tap a reason. Confirmation, no further step —
three presses total.

**2b. The thread's parent message**
Long-press the message card at the top of the thread.
**Expected**: the same two actions.

**2c. Your own reply**
Long-press a reply you wrote.
**Expected**: Report is offered, *Block this person* is **not**.

**2d. A system row inside a thread** (a "created task" or call announcement)
**Expected**: Report is offered, Block is not. Then check the same on the channel
timeline — this is the predicate corrected on both screens (research R-4), so a system
row in a **channel** must no longer offer Block either.

**2e. A thread in a direct conversation**
Report a reply inside a thread whose parent conversation is a DM, then look at the
owner's queue (§3).
**Expected**: the report's target kind is **direct message**, not channel message.

**2f. Block from a profile (US2)**
*More → People →* a colleague.
**Expected**: a **Block** button. Tap it; the confirmation states that direct
conversations and calls stop and shared channels are unaffected. Confirm.
**Expected**: the button becomes **Unblock** without leaving the screen. Open the same
colleague's profile again — still Unblock. Open your own entry in People —
**neither** button, and *Open your profile* unchanged.
Then unblock, so the demo workspace is left as you found it.

**2g. Report a file (US3)**
*More → Files* → **Report** on a row.
**Expected**: the sheet reads "Report **this file**", not "this message". Then open a
file's detail screen and report from there too.

---

## 3. Confirm the reports landed, as a reviewer would

Sign in on web as the owner and open **Settings → Reported content**.

**Expected**: every report filed in §2 is listed, each with a snapshot — the message
text for a message, a line naming the filename, type and size for a file, the comment
text for a comment — and each attributed to the person who made the content, not to
the reporter.

Cross-check the target kinds directly:

```bash
psql "$DATABASE_URL" -c "
SELECT target_kind, count(*)
FROM compliance.content_report r
JOIN public.organization o ON o.id = r.organization_id
WHERE o.subdomain = 'demo'
GROUP BY 1 ORDER BY 1;"
```

**Expected**: rows for `chat_message`, `direct_message`, `file` and
`document_comment`. `call_record` stays absent — deliberately out of scope.

---

## 4. Walk the web surfaces, and the reviewer notes

**4a. A document comment (US4)**
Open a document with comments written by somebody else.
**Expected**: a report control on their comment; the dialog reads "Report **this
comment**". Your own comment offers no report control.

**4b. The files page (US3)**
*Files → Management*.
**Expected**: a report control on each row; the dialog reads "Report **this file**".

**4c. The reviewer notes (SC-004)**
Read `docs/compliance/reviewer-notes.md` end to end as if you had never seen the app,
and do exactly what it says.
**Expected**: every report surface it names can actually be reported from, in one
session, without leaving the app. The notes must name the thread, the file and the
comment, and must say that blocking is reachable from a person's profile. Anything the
notes claim that you cannot do is a failure of this step, not a documentation nit.

---

## 5. Count the forms (FR-018, SC-003)

```bash
grep -rl "REPORT_REASON_LABELS" frontend/apps/mobile/src frontend/apps/web/src
```

**Expected**: exactly two files — `components/compliance/report-sheet.tsx` and
`workspace/components/ReportContentDialog.tsx`. One report form per client.

```bash
grep -rl "blockPerson\|unblockPerson" frontend/apps/mobile/src frontend/apps/web/src
```

**Expected**: exactly two files — `components/compliance/block-confirm.tsx` on mobile
(every mobile screen goes through `BlockConfirm`) and
`workspace/settings/blocked/page.tsx` on web, which unblocks only. No new caller, and
still no way to *create* a block on web — the gap the spec flags and the drift register
records.

---

## 6. Confirm nothing moved on the server (FR-022)

```bash
git diff --stat main -- backend/ | tail -5
```

**Expected**: `backend/integration/compliance_report_test.go` and nothing else. No
migration, no `.proto`, no `schema.sql`, no permission seed. If anything else appears
in that list, the spec's closing assumption has been broken and it needs surfacing
before the change lands.

---

## 7. The silence still holds (FR-010, SC-005)

Already automated — `backend/integration/compliance_block_test.go`,
`"the blocked person is not notified"` — and worth confirming by hand once after §2f:
sign in as the person you blocked.

**Expected**: no notification, no change in their conversation list, no change in
shared channels, and nowhere in the app that says anything happened.

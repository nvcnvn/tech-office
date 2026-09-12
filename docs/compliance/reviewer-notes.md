# Reviewer notes

Paste this into **App Store Connect → App Review Information → Notes**, and into
**Play Console → Testing instructions**. Update the credentials if
`seed-demo-org` is re-run with different flags.

Regenerate the workspace with:

```bash
cd backend && go run ./cmd seed-demo-org --subdomain demo
```

The command is idempotent — run it again before a resubmission and it refreshes
the same workspace rather than creating a second one.

---

## Sign-in credentials

TechOffice has two kinds of account, and they behave differently on purpose. Three
credentials are listed below. Please use the **first** one to review the app. The
**second** is a spare, provided so you can delete an account end to end without
losing access to the workspace. The **third** exists so you can see the other
account-ending path.

### 1. Self-registered owner (use this one)

| | |
|---|---|
| Workspace address | `demo` |
| Email | `owner@demo.demo.invalid` |
| Password | `ReviewDemo1!` |

Sign in with **email and password**.

This is the primary credential because it is a self-registered account, and only a
self-registered account's settings screen shows the **full account-deletion path**.
Use it for everything except the deletion itself.

If you are checking for in-app account deletion, **please use credential 2 below**,
not this one. Deleting credential 1 is accepted too — the workspace survives either
deletion — but it is the account the rest of these notes are written around, and
you would lose the sign-in they assume you still have.

### 2. Spare owner — delete this one

| | |
|---|---|
| Workspace address | `demo` |
| Email | `spare@demo.demo.invalid` |
| Password | `ReviewDemo1!` |

Sign in with **email and password**.

This is a second self-registered owner, provided for one purpose: so you can
perform an account deletion and see it through. Deleting it leaves the workspace
and credential 1 fully usable — the conversation, the work and the schedule are all
still there afterwards, and you can carry on reviewing signed in as credential 1.

> More → Settings → Account → **Delete my account**

on mobile, or

> Settings → **Delete my account**

on the web. The confirmation screen lists exactly what is erased and what is kept,
and asks you to type a phrase before it will proceed. It is irreversible.

### 3. Admin-provisioned worker (the second path)

| | |
|---|---|
| Workspace address | `demo` |
| Login ID | `demo-worker` |
| PIN | `473829` |

Sign in with **workspace address, login ID and PIN**.

This account was created by an employer for a worker, rather than by the worker
themselves. That is why its account-ending screen reads **Remove my account**
rather than Delete: the account and the work in it are the employing business's
record, so the worker sends an in-app removal request that reaches the
workspace's owners, who act on it. The request, the notification to the owners,
and the decision all happen inside the app — there is no step that sends the
person to a website or an email address.

Its PIN is **permanent**. Ordinary worker PINs expire after three days and force a
change at first sign-in; this one is set to never expire so the account still works
whenever review reaches it.

---

## What to look for

### Reporting objectionable content

Anything one person can make, another person can report, and every one of the
surfaces below is reachable in the demo workspace in a single session.

The demo conversation ends with a deliberately rude message so you have something
plausible to start with.

Open **Site updates**, long-press (mobile) or hover and open the ⋮ menu (web) on
the last message — *"Whoever loaded the van yesterday clearly can't count.
Useless."* — and choose **Report**. Pick a reason. You will see a confirmation.
On mobile that is three presses from seeing the message; on web it is two from
opening the menu.

The same control is on every other place user-made content appears:

| What you are reporting | Where | How to get there |
|---|---|---|
| A message in a channel or direct conversation | mobile, web | long-press the message (mobile) or the ⋮ menu (web) → **Report this message** |
| A reply inside a thread, or the message the thread hangs off | mobile | long-press the message → **Report this message** — the same words, one screen deeper |
| An uploaded file | mobile | **More → Files** → **Report** on the row, or open the file and use **Report** beside Download |
| An uploaded file | web | **Files → Management** → the flag button in the row's Actions column |
| A comment on a document | web | open the document → the comments panel → the flag button on somebody else's comment |

The form names what you are reporting — "Report this message", "Report this file",
"Report this comment" — so it is always clear which thing the report is about. You
are not offered a control to report your own document comment, and reporting the
same item twice is refused in the form with an explanation rather than silently
accepted.

Signed in as the owner, every report is then visible at
**Settings → Reported content**, with a copy of the content as it stood when it was
reported — the message text, the comment text, or a line naming the file, its type
and its size — and an action to record an outcome. Each report is attributed to the
person who made the content, not to the person who reported it; the app resolves
that on the server so a report cannot be pinned on the wrong person. The snapshot
means a report stays reviewable even if the author deletes the original — you can
verify that by deleting the message and reloading the queue.

Report review is a web-only screen. It is an administrative action, and this
product deliberately keeps administrative surfaces off mobile.

### Blocking

Blocking is reachable two ways on mobile, and you do not need to find a message
first:

- From a colleague's profile: **More → People →** the person → **Block**. After you
  confirm, the same button reads **Unblock** without leaving the screen.
- From a message menu: long-press a message somebody else wrote → **Block this
  person**.

A system line — "so-and-so created a task", "a call ended" — offers **Report** but
no **Block**, because there is no person speaking behind it.

The blocked person is not notified, and there is no screen or API anywhere in the
product that tells somebody who has blocked them.

**Please read this before testing a block:** blocking in TechOffice stops **direct**
contact — direct conversations and calls — and deliberately does **not** hide the
blocked person's messages in a shared work channel.

That is not a missing feature. TechOffice is a closed workplace tool where everyone
in a workspace already works together. Hiding a colleague's messages in a shared
channel would let somebody silently conceal work instructions addressed to them,
which is a safety problem of its own in a business where the messages are about
where to be and what to do. So the scope is direct contact, and the app says so on
the confirmation screen before you block.

To see the block working, block another demo account and then try to start a
direct conversation with them: it is refused. Their earlier direct messages are
hidden from your view, with a per-message reveal. Their messages in **Site updates**
stay visible.

Blocked people are listed, and can be unblocked, at **Settings → Blocked people**
on mobile, and at **Settings → Blocked people** on the web. Creating a block is a
mobile action today; the web client can review and undo blocks but not start one.

### Account deletion

**Use credential 2, `spare@demo.demo.invalid`.** It is there to be deleted, and one
deletion is all you need — there is no second account to try afterwards, and
credential 1 is deliberately not the one to use for this.

In summary: a self-registered person deletes their own account from inside the app
with no email, no web form and no support ticket. An admin-provisioned worker
(credential 3) sends an in-app removal request to the people who created their
account. Both paths are reachable in the app; neither sends the person elsewhere to
finish.

### Permissions

The app asks for microphone (voice calls and voice messages), camera and photos
(attaching photos to messages, tasks and job records), location (confirming
presence at a job site, foreground only) and notifications. Every one of them is
optional: refusing any single permission leaves the rest of the app working.

### Not requested

Two things you might expect an app like this to ask for, listed so their absence
reads as a decision rather than an oversight:

- **Background location.** The app reads a coordinate only while it is open, and
  only at the moment someone checks in or completes a task that needs proof of
  presence. It declares no "always" location key, runs no geofencing, and does no
  significant-change monitoring.
- **Face ID or fingerprint sign-in.** There is no biometric sign-in anywhere in
  the app, and no biometric authentication library is a dependency. Signing in is
  email and password, or workspace address with login ID and PIN. No screen
  offers a biometric option, so please do not look for one.

---

## Contact

If anything here does not work as described, or you need a fresh credential, please
reply in Resolution Center rather than rejecting on access — the workspace can be
reseeded in under a minute.

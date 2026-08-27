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

TechOffice has two kinds of account, and they behave differently on purpose. Please
use the **first** one to review the app; the second exists so you can see the other
path.

### 1. Self-registered owner (use this one)

| | |
|---|---|
| Workspace address | `demo` |
| Email | `owner@demo.demo.invalid` |
| Password | `ReviewDemo1!` |

Sign in with **email and password**.

This is the primary credential because it is the only kind of account whose
settings screen shows the **full account-deletion path**. If you are checking for
in-app account deletion, this is the account to use:

> More → Settings → Account → **Delete my account**

on mobile, or

> Settings → **Delete my account**

on the web. The confirmation screen lists exactly what is erased and what is kept,
and asks you to type a phrase before it will proceed. It is irreversible — please
use the second credential below if you want to keep this workspace usable.

### 2. Admin-provisioned worker (the second path)

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

The demo conversation ends with a deliberately rude message so you have something
plausible to report.

Open **Site updates**, long-press (mobile) or hover and open the ⋮ menu (web) on
the last message — *"Whoever loaded the van yesterday clearly can't count.
Useless."* — and choose **Report**. Pick a reason. You will see a confirmation.

Signed in as the owner, the report is then visible at
**Settings → Reported content**, with a copy of the message as it stood when it was
reported, and an action to record an outcome. The snapshot means a report stays
reviewable even if the author deletes the original — you can verify that by
deleting the message and reloading the queue.

Report review is a web-only screen. It is an administrative action, and this
product deliberately keeps administrative surfaces off mobile.

### Blocking

From a message menu, choose **Block this person**. The blocked person is not
notified, and there is no screen or API anywhere in the product that tells somebody
who has blocked them.

**Please read this before testing a block:** blocking in TechOffice stops **direct**
contact — direct conversations and calls — and deliberately does **not** hide the
blocked person's messages in a shared work channel.

That is not a missing feature. TechOffice is a closed workplace tool where everyone
in a workspace already works together. Hiding a colleague's messages in a shared
channel would let somebody silently conceal work instructions addressed to them,
which is a safety problem of its own in a business where the messages are about
where to be and what to do. So the scope is direct contact, and the app says so on
the confirmation screen before you block.

To see the block working, block the other demo account and then try to start a
direct conversation with them: it is refused. Their earlier direct messages are
hidden from your view, with a per-message reveal. Their messages in **Site updates**
stay visible.

Blocked people are listed, and can be unblocked, at **Settings → Blocked people**.

### Account deletion

Covered above. In summary: a self-registered person deletes their own account from
inside the app with no email, no web form and no support ticket. An
admin-provisioned worker sends an in-app removal request to the people who created
their account. Both paths are reachable in the app; neither sends the person
elsewhere to finish.

### Permissions

The app asks for microphone (voice calls and voice messages), camera and photos
(attaching photos to messages, tasks and job records), Face ID (optional faster
sign-in), location (confirming presence at a job site, foreground only) and
notifications. Every one of them is optional: refusing any single permission leaves
the rest of the app working. There is no background location.

---

## Contact

If anything here does not work as described, or you need a fresh credential, please
reply in Resolution Center rather than rejecting on access — the workspace can be
reseeded in under a minute.

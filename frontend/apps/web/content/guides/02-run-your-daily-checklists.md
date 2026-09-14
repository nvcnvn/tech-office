# Run your daily checklists

**Who this is for:** everyone — owners set the checklists up, managers review them, staff
complete them.
**The problem it solves:** you know the opening checks happened because someone says they
did. A clipboard tells you a box was ticked, not that the fridge was actually at 3°C, and
it tells you a week later when the milk has already been thrown out.

In TechOffice a recurring checklist is called a **ritual**. You define it once. TechOffice
creates a fresh run of it every day (or week, or month) for whoever is on shift, collects
the proof, and routes it to a manager to approve.

---

## The shape of it

```
You define it once          TechOffice creates each run       The person on shift
"Riverside opening      →   "Riverside opening checklist  →   submits proof for each
 checklist", daily,          — 2026-08-22", assigned to        requirement
 3 things to prove           Leo
                                                                      ↓
                              The manager approves or asks for a redo ←
```

The definition is a template. Each day's run is a real piece of work with a real assignee,
a deadline, and its own comment thread. Changing the template never rewrites yesterday's
proof.

## 1. Define the checklist

> **Before you start:** this only works in a project whose collaboration mode is **Mixed**
> or **Ritual**. A Standard project has no Rituals tab and no Today, Review or Health tabs,
> and the mode is fixed when the project is created — so if yours is Standard, make a new
> project set to Mixed. See
> [Set up your workspace, step 6](01-set-up-your-workspace.md#6-make-one-project).

Open your project, then **Settings → Rituals → new ritual**. Bright Bean's opening
checklist looks like this:

![The ritual definition editor showing name, instructions, daily recurrence, a six-hour completion window and the evidence requirements](images/admin-ritual-definition.png)

Four things to get right:

**Name it after the job, not the form.** "Riverside opening checklist", not "Form 3a".

**Write real instructions.** Whatever you type in the description is shown to the worker on
every single run. This is the place for *"Run before the doors open. Grinder calibrated,
pastry case stocked, fridge temperature inside range."* — not a policy document.

**Set the completion window honestly.** Bright Bean set six hours: an opening checklist
finished at 3pm is not an opening checklist. The window is how long after the scheduled
time the run stays completable, and it is what makes "late" mean something.

**Set the timezone.** Rituals fire on local time. If you have stores in two timezones, this
is the field that matters.

### Assigning the work

You can assign a ritual three ways:

- **To named people.** Simple, right for a single store: the opening checklist is Leo's.
- **To a department, with a rotation.** TechOffice picks the assignee when each run is
  created, either **round-robin** through the department or by giving it to whoever has
  been assigned **least**. Right when you have a rota and no fixed owner.
- **To a department, following the shift.** TechOffice gives the run to whoever has a shift
  on the calendar covering that date. This is the one to use when the closing count must
  land on whoever is actually in — round-robin will happily give it to someone who is off.

The first two put a name on the run the moment it is created. On-shift is different, and
deliberately so: runs are created up to 30 days ahead while rotas are usually published a
week or two ahead, so the run waits and says *waiting for the rota* until a shift covering
that date is published. It then binds to that person, and rebinds if the rota changes. It
never falls back to round-robin — falling back is exactly the problem it exists to remove.
If the date arrives with nobody rostered, the run stays unassigned and the project's owners
are told.

On-shift assignment depends on shift events actually being published for that department.
See [Run the schedule](04-run-the-schedule.md).

## 2. Decide what counts as proof

Each thing you want proven is an **evidence requirement**. Bright Bean's opening checklist
has three:

| Requirement | Accepted submission type |
|---|---|
| Fridge temperature reading | Written note — the number on the display |
| Pastry case photo | Photo — the filled case, taken from the customer side |
| Espresso shot dialled in | Written note — dose, yield and shot time |

Each requirement takes **one** kind of proof — the **Accepted submission type** is a single
choice, not a list. Your options are photo, written note, voice memo, file, PDF, link, or a
**GPS check-in**. GPS is how you prove someone was physically at the site, which matters for
cleaners, drivers and multi-site inspections.

If you want both a photo *and* a written reading, make them two requirements. That is
usually better anyway: two lines on the checklist, two things that can be individually
approved or sent back.

Then choose how it gets approved:

- **Manual** — a manager looks at it and approves or rejects. This is the default, and the
  only option for written notes, voice memos, files, PDFs and links.
- **Auto-approve** — offered only for **photo** and **GPS check-in** requirements, as a
  toggle labelled *Auto-approve via GPS check-in*. Turned on for a GPS requirement, a
  check-in inside the radius you set around the site approves itself, with no one in the
  loop. Selecting the GPS type turns it on for you.

Mark a requirement **required** if the run is not done without it. Optional requirements
are fine for "add a photo if anything looks wrong".

Be ruthless here. Three requirements that get done properly beat eleven that get rushed.

## 3. What the person on shift sees

Leo signs in on his phone at 6:30, taps into the project, and lands on **Today**.

![Today's work for Leo, showing one overdue standard task and three ritual runs due today](images/employee-my-work.png)

Planned work and routine operations are separated on purpose. Leo does not have to work out
which of eleven list items is the thing that must happen before the doors open.

He opens today's run:

![A ritual run showing the instructions and the proof checklist with one item approved and one waiting for review](images/employee-ritual-instance.png)

Everything he needs is on this one screen: the standing instructions, what still needs
proof, what he already submitted, and what a reviewer said about it. He submits the fridge
reading as a note, takes the pastry case photo with his phone camera, and moves on.

**Rejected proof comes back with a reason**, and the button changes to *Resubmit Proof* — so
"do it again" is never a message someone has to chase in a group chat.

## 4. Reviewing without opening everything

Mai, the Riverside manager, does not want to open eleven runs to find the one that needs
her. She opens **Reviews** in the top bar — one queue across every project she reviews for,
with a count on the tab. The project's own **Review** tab is the same queue narrowed to that
project. On her phone it is a card at the top of **My Work**, with the photo at full device
width and approve and reject as the only buttons, so a decision never needs a second screen.

If you cannot review proof anywhere, the Reviews tab is not there at all — it is not a
disabled button.

![The review queue listing one ritual run with pending proof](images/manager-review-backlog.png)

The queue lists only runs with proof waiting on a decision, and says which requirement is
waiting. Opening a row takes her straight to that proof.

![A ritual run open for review: the fridge reading approved, the pastry case photo still missing, the espresso note waiting on a decision](images/manager-review-evidence.png)

She can approve or reject inline, with a note. The submitted content is right there — she
reads *"3°C on the display at 06:40. Door seal checked, no ice build-up."* and approves it
without leaving the page.

Rejecting requires a comment, and that comment is what the worker sees. *"Add more detail
about the safety check"* is useful. *"Rejected"* is not.

## 5. Reading the record later

The **Health** tab on the project gives you the compliance picture over a date range: how
many runs were on time, which checklists slip, which people need a conversation. You can
export it as a CSV for a landlord, an insurer, or an environmental health visit.

This is the part that is impossible with a clipboard: every submission carries both the
time the device recorded and the time the server received it, so clock-fiddling is visible,
and photos and GPS points are attached to the run they belong to.

---

## Practical advice

**Start with one checklist.** Get the opening checklist working for two weeks before you
add closing, deep clean and stock count. A checklist nobody completes is worse than no
checklist, because it teaches your team that the system is optional.

**Do not make the manager the assignee.** If your store manager is the one submitting the
proof and the one approving it, you have built a clipboard with extra steps. The value is
in the handoff.

**Changing the schedule is safe.** If you move a daily ritual to weekdays only, TechOffice
shows you exactly what will happen to the runs already scheduled: untouched future runs are
removed, and any run someone has already worked on is kept as a standalone task. Nobody's
work is deleted.

**Skipping is allowed, and recorded.** If the store was closed for maintenance, skip the run
and give a reason. The reason stays on the record. That is much better than a gap you
cannot explain six months later.

## Lateness is told to you, not just shown

A run whose deadline passes with nothing submitted becomes **overdue** on its own, within
about five minutes, and the person it is on — plus its reviewer and approver — are notified.
One completion window later it becomes **missed**, which is final.

Two deliberate choices worth knowing:

- **Owners are not alerted when a run goes overdue.** Escalating every late checklist to the
  owner is how an alert becomes noise, and noise is how the alert gets muted. Owners *are*
  told when a run is **missed** and nobody was holding it.
- **A run nobody was assigned produces no overdue alert** — there is nobody to tell — but its
  missed transition still reaches the project's owners, so an unassigned checklist cannot
  fail silently.

Deploying this for the first time does not alert everyone about last month: a deadline more
than seven days old changes state without notifying anybody.

## Next

[Keep work in one conversation](03-keep-work-in-one-conversation.md) — where the discussion
about all of this lives.

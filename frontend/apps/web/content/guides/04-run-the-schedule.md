# Run the schedule

**Who this is for:** owners and managers publishing the rota; everyone else checking it.
**The problem it solves:** the rota is a photo of a whiteboard, the delivery slot is in
someone's inbox, and the one meeting room gets double-booked twice a month.

---

## One calendar, several kinds of thing on it

![The calendar month view showing shifts, a delivery, a managers' sync and a company event, with the day's detail in the side panel](images/employee-calendar.png)

TechOffice calendars hold more than meetings. When you create an event you pick its type,
and the type changes how it behaves:

| Type | Use it for |
|---|---|
| **Shift** | Who is working, when, where. Can require a check-in. |
| **Meeting** | The managers' weekly sync |
| **Deadline** | The coffee delivery window, a supplier cut-off |
| **Company event** | The summer menu tasting |
| **Out of office** | Holiday, sick leave |
| **Training**, **Maintenance window**, **Reminder** | Exactly what they say |

Everything is stored in UTC and shown in the viewer's local time, so a two-timezone business
does not have to do mental arithmetic.

### The side panel is the useful part

The panel on the right shows the selected day, and — importantly — **pending invites you can
answer without leaving the view**. Leo can accept his opening shift with one tap while
looking at the rest of his week.

### Tasks and checklists appear here too

The **Tasks**, **Rituals** and **Doc Deadlines** toggles above the grid overlay work onto
the calendar. A task due Thursday and a Thursday shift are on the same grid. That is the
whole point: your team should not have to check three surfaces to know what Thursday looks
like.

## Publishing a rota

Create one shift event per person per shift, set the required attendee, and the location.
That is it — the shift shows up in their calendar and in their side panel as an invite.

For shifts that repeat, set a recurrence and let it run. When you need to change one week
only, TechOffice asks whether you mean **this occurrence**, **this and following**, or **the
whole series** — and records which you chose, with who changed it and when. "Who moved my
Tuesday" has an answer.

**The rota can drive your checklists.** A ritual assigned to a department "on shift" reads
these events: whoever is rostered that day gets the run, and it rebinds if you change the
rota. Two details matter when you publish:

- An **overnight** shift (22:00 Friday → 06:00 Saturday) covers both days.
- The **organiser is not counted as working the shift.** Whoever publishes the rota is
  written onto every event they create, so counting that row would roster them onto every
  shift in the store. The consequence is a real limit: a manager who genuinely works a shift
  they published themselves will not be picked for its checklist. The workaround today is to
  have somebody else create that one event, or to assign that ritual to named people instead.

Someone who has **declined** the shift does not count as covering it; pending, tentative and
accepted all do. See [Run your daily checklists](02-run-your-daily-checklists.md).

Cancelling never deletes. A cancelled event stays visible as cancelled, so nobody turns up
to a shift that was quietly removed.

### Requiring a check-in

Turn on **requires check-in** for a shift and the person has to check in when they arrive.
The check-in records the time and whether it was late, and can carry evidence files. Use it
for lone workers, cleaners and anyone working off-site.

This is separate from ritual evidence — check-in proves *attendance*, ritual evidence proves
*the work*. Most businesses want one or the other, not both on the same shift.

## Rooms, vans and equipment

Bright Bean created two **resources**: the *Roastery Room* and the *Delivery Van*.

A resource is anything there is only one of. Book it to an event and it cannot be
double-booked. You control who is allowed to book each one — per person or per department —
so the van is not reserved for a coffee tasting.

Managing resources needs a permission (`calendar.manageResources`), which by default your
owner and operator roles hold and ordinary staff do not.

## Finding a time that works

Two tools save the back-and-forth:

- **Free/busy** shows availability across several people at once.
- **Suggest slots** proposes times that fit everyone's working hours and existing bookings.

Set your **working hours** in the calendar first, or these are guessing. For a shift-based
business, set them per person to the hours that person is actually contactable.

## Booking links, for people outside your business

A **booking link** is a shareable URL that lets someone outside TechOffice claim a slot —
the same idea as Calendly, without another subscription.

You set the duration, the windows you are willing to be booked in, and how long the link
stays valid. Send it to a supplier rep, an equipment engineer, or a candidate. When they
claim a slot it becomes a real event on your calendar and the link is marked as claimed.

Small businesses get the most out of this for: interview slots, service visits, and
supplier tastings.

## Letting someone manage your calendar

**Delegation** lets you grant another person the right to create, modify or cancel events on
your calendar, with an optional expiry. This is an assistant managing an owner's diary, or a
deputy covering two weeks of leave — not a permanent role.

Grant it, and revoke it when the cover ends.

## Reminders

Every attendee gets a reminder before an event — fifteen minutes by default.

The reminder **names the event** — *"Riverside opening shift starts in 15 minutes"* — because
on a lock screen the text is all you see, and tapping it takes you to the event. It is
delivered whether or not you have the app open, and it is deliberately one of the few things
that is not suppressed by muting the calendar area: a reminder you asked for is not noise.

For that to reach a sleeping phone, push has to be configured for your deployment. If your
staff get reminders only while the app is open, that is the thing to check.

## Next

[Write down how you do things](05-write-down-how-you-do-things.md) — the procedures behind
the schedule and the checklists.

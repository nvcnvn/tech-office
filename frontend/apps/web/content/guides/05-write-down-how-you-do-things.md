# Write down how you do things

**Who this is for:** owners and managers writing it down; everyone else reading it.
**The problem it solves:** the way your business does things lives in one person's head. When
they are on holiday, the answer is a phone call. When they leave, the answer is gone.

---

## Documents are the "why"; checklists are the "what"

Keep these separate and both stay useful:

- A **checklist** (ritual) says *do this, prove it*. Short, actionable, on shift.
- A **document** says *this is how we do it and why*. Read once, referred to when something
  is unusual.

Bright Bean's opening checklist has an item "Fridge temperature reading". The document
*Opening and closing procedure* is where it says that dairy above 4°C for more than two
hours gets thrown out — which is why the reading is taken at all.

Do not put the explanation in the checklist. Nobody reads three paragraphs at 06:30.

## Writing one

Open **Docs → +**.

![The Espresso bar standards document open, with the document tree in the sidebar](images/employee-docs.png)

Documents nest into a tree, so you can group them: *Bar standards*, *Opening and closing*,
*New barista first week*.

The three documents Bright Bean started with are a good template for any small business:

1. **The standard** — the numbers and rules that do not change. Dose, yield, shot time,
   milk temperature.
2. **The procedure** — how a recurring job is done, and why each step exists.
3. **The onboarding path** — what a new person does on day one, day two, day five.

That is enough to train someone without you standing next to them.

### Write for the person doing the job

Short lines. Concrete numbers. No policy voice. Compare:

> Milk: steamed to 60–65°C. Never re-steam milk that has already been heated.

against "Team members should ensure appropriate milk handling procedures are observed". The
first one is usable at the bar.

## What documents give you that a shared drive does not

**Full version history.** Every save is a complete snapshot with an author and an optional
summary — a commit message for your procedures. You can compare any two versions, and see
line-by-line who wrote what. When someone asks "when did we change the shot time", there is
an answer.

**Nothing is pruned.** Old versions are kept indefinitely.

**Comments and replies on the document itself.** A barista can ask a question against the
line they did not understand, and it is resolvable — so answered questions stop cluttering
the page.

**Links that survive a rename.** Rename a document and old links still work. The link you
pasted into the store channel six months ago does not break.

**Quoting between documents.** One document can quote a line range from another, and the
quote is a **snapshot** — it shows the target as it was when you quoted it, so editing the
source never silently rewrites the document that cited it. You can also see which documents
cite the one you are reading.

**Per-document access.** A new document is **private** by default — you can read it, and
nobody else can until you say so. Switch it to public to let the whole workspace read it, or
grant read-and-comment or write access to specific people or a whole department. You can
also explicitly **deny** a person, and that deny wins over everything else, including a
public document. Use it for anything with pay, discipline or supplier pricing in it.

One thing to know: the **titles** in the Docs sidebar are not access-scoped yet. Someone
without access sees that a document called *Supplier pricing 2026* exists; they cannot open
it, search it, comment on it or see a word of its content. If a title itself is sensitive,
name the document something duller.

### Editing together

Several people can have a document open at once and you will see who is in it and where
their cursor is. Up to ten people at once.

TechOffice does **not** merge simultaneous edits character-by-character, and it does not
quietly let the last save win either — the second save is **refused**. Whoever saves second
sees a message naming who saved before them and when, and their unsaved text stays on the
screen with two buttons: copy my changes, or load the current version. Nothing is lost and
nothing is silently overwritten.

In practice: still say so in the channel before two people rewrite the same section. The
refusal is a safety net, not a workflow.

## Files

**Files** is the workspace's storage view: everything attached anywhere — chat messages,
tasks, checklist proof, calendar events, documents.

You do not usually go here to attach something. You attach files where the work is: in the
channel, on the task, as proof on a checklist. Files just gives you the view across all of
it, plus deletion and storage usage.

What happens to a file you upload:

- It is **scanned for viruses**, every time, without exception. If the scan cannot complete,
  the file is treated as failed rather than waved through.
- Its **real type is checked against what it claims to be**, so a `.jpg` that is actually
  something else is flagged.
- **Who can open it is decided by where you attached it**, on the server. A file in a private
  channel is not readable by someone outside it, and there is no setting for anyone to get
  wrong.
- Office documents are **converted to PDF** for preview.
- Deleting is soft and logged, so an accidental delete is recoverable and a deliberate one is
  auditable.

Your workspace has a storage quota and a maximum file size (100 MB by default). Only the
owner can change them.

### A practical note on photos

Checklist photo evidence adds up faster than anything else in a small business — a daily
pastry case photo across two stores is 700+ photos a year. Check **Files** occasionally and
clear out what you no longer need. Photos attached to proof that has already been approved
and reported on are usually safe to remove after your record-keeping period.

## Finding a document again

The main workspace search box covers documents — by title and by content, across languages —
alongside everything else, so you do not have to be in Docs to find one. It only ever
returns documents you are allowed to open. The search inside Docs is still there when you
already know you are looking for a document.

## Attaching a procedure to a checklist

This is the connection that makes writing things down worth the effort: a ritual definition
can point at one document as its **written procedure**. The worker doing the checklist gets
a link to it on every run — on the phone it opens as a sheet over what they were doing, so a
half-typed note or an attached photo is not lost — and the reviewer sees the same link in
the review queue.

Two things make it work the way you want:

- **They read it without being granted it.** Anyone who can see the checklist can read that
  one document, even with no access to it otherwise. They do not get it in their Docs tree,
  their search, its comments or its history, and they cannot edit it. The moment you detach
  it, that ends.
- **You can only attach a document you can already open yourself.** Attaching hands sight of
  it to everyone who can see the ritual, so the check is against *your* access.

Nothing is snapshotted: correcting the document corrects every open run at once, so there is
never an old copy of a procedure in circulation.

Attaching, replacing and removing is done on the web, in the ritual definition editor.

## Next

[Reference](06-reference.md) — where everything lives, and what the limits are.

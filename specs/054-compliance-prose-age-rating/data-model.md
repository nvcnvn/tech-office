# Data model: Compliance prose and age-rating answers

**Feature**: 054 | **Date**: 2026-09-12

No database entity changes. No migration, no `schema.sql` regeneration, no proto message.
The entities below are **document structures** — the shapes the compliance documents and
the gate rule are built from. They are modelled here because the spec names them as key
entities and because the gate's correctness depends on one of them (Recorded absence)
being recognisable mechanically.

---

## 1. Age-rating answer

One question on one store's questionnaire. The repeating unit of
`docs/compliance/age-rating-answers.md`. Rendered as a markdown table row.

| Field | Required | Rules |
|---|---|---|
| `question` | yes | The question as the live console words it, transcribed at implementation time (research R-7). Not paraphrased — a submitter has to match it against the form by eye. |
| `store` | yes | `App Store Connect` or `Play Console` (IARC). Implied by the section the row sits in (FR-013), not repeated per row. |
| `answer` | yes | The literal value the form accepts: `Yes` / `No`, or the named option where the form offers a list. Never a sentence in this field. |
| `evidence` | yes | Where the answer can be verified: a screen path a reviewer can walk, a behaviour they can reproduce, or a named file/symbol in the code (FR-008). One of the three, not a restatement of the answer. SC-004 counts uncited answers and requires zero. |
| `qualifier` | no | Free text the form allows alongside the answer, or empty. This is where "yes, but only between colleagues in one workspace" goes — the scoping that FR-009 requires and that the bare `Yes` cannot carry. |

**Validation rules**

- Every question in the store's mandatory social-media capability group has exactly one
  row (FR-007). Missing rows are the failure SC-003 measures.
- `answer` is never softened to reach a target rating (FR-012, and the spec's fourth
  assumption). A `Yes` that raises the rating stays `Yes`.
- `evidence` never points at another row of this table. It points out of the document.

**Relationships**: many Age-rating answers → one *store section*. Two store sections, each
complete in itself, because the two consoles ask different questions and FR-013 forbids
merging them.

---

## 2. Recorded absence

A capability the app deliberately does not implement or request, together with the reason.
The only sanctioned way for compliance prose to name an unimplemented capability, and the
one entity with a machine-readable contract — the gate must recognise it to satisfy FR-017.

| Field | Required | Rules |
|---|---|---|
| `capability` | yes | The manifest key or permission identifier (`NSFaceIDUsageDescription`, `android.permission.USE_BIOMETRIC`), or the reviewer-facing name (`Face ID`). |
| `reason` | yes | Why the app does not have it. States a fact about the app, never a description of how the capability would behave if it existed (FR-004). |
| `section` | yes | The declared recorded-absence section it lives in. See below. |

**Declared recorded-absence sections** — the gate's exemption list, and the whole of it:

| Document | Heading (exact text, any level) |
|---|---|
| `docs/compliance/permission-justifications.md` | `Permissions deliberately blocked` |
| `docs/compliance/permission-justifications.md` | `Keys deliberately absent` |
| `docs/compliance/data-collection-inventory.md` | `Not collected` |
| `docs/compliance/reviewer-notes.md` | `Not requested` |
| `docs/compliance/age-rating-answers.md` | `Capabilities the app does not have` |

A section runs from its heading line to the next heading of the same or shallower level, or
end of file. The grammar is specified in [contracts/prose-gate.md](contracts/prose-gate.md).

**State transitions**: a capability moves between three states, and each move is one change
set (the spec's out-of-scope note on adding biometrics says the same thing from the other
direction).

```
      undocumented ──(053-style cleanup)──> recorded absence
                                                   │
                                     (feature adds the capability)
                                                   ▼
                                            live declaration
                                     — manifest key or permission,
                                       justification entry, allow-list
                                       entry, reviewer-notes sentence
                                                   │
                                     (feature removes the capability)
                                                   ▼
                                            recorded absence
```

The gate makes the *undocumented → live declaration* edge impossible to reach from prose
alone: naming a capability with no backing declaration and no recorded-absence section is a
build failure.

---

## 3. Review materials

The set of texts pasted into a store console at submission. Not a new artifact — the
naming of an existing set, whose defining property is that a reviewer reads them as claims
about the app.

| Document | Pasted into | Changed by this feature |
|---|---|---|
| `reviewer-notes.md` | App Store Connect → App Review Information → Notes; Play Console → Testing instructions | Yes — FR-001, plus the new `Not requested` section (research R-5) |
| `permission-justifications.md` | App Review notes; Play Console Data safety and sensitive-permission declarations | No — verified only (FR-003) |
| `data-collection-inventory.md` | App Store Connect privacy questionnaire; Play Console Data safety form | Yes — FR-002, FR-015, and the Location row correction (research R-4) |
| `age-rating-answers.md` | Both stores' age-rating questionnaires | New (FR-006) |

**Invariant across the set (FR-004, SC-001)**: every capability named in any of them is
either implemented, or sits in a declared recorded-absence section. The gate enforces the
capability-vocabulary subset of this invariant; the rest is held by the same review
discipline as before, which is why the vocabulary is the part chosen to be mechanical.

---

## 4. Capability term (gate-internal)

The gate's unit of scanning. Not user-visible; listed because it is the rule's only new
data.

| Field | Rules |
|---|---|
| `term` | Lower-case substring matched against a lower-cased line. Compound where the bare word would be ambiguous (research R-6). |
| `declaration` | The manifest key or Android permission that would make a mention of `term` a true claim. |

A term is **satisfied** when its `declaration` is in `ALLOWED_IOS_KEYS ∪
ALLOWED_ANDROID_PERMISSIONS` — the constants the same script already uses to decide what
the app may declare (research R-1). There is no second list.

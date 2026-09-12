# Contract: Migration Plan

**Feature**: 062-prune-reserved-values
**File**: `backend/database/migrations/20260912000003_prune_reserved_values.up.sql`

One forward-only migration, following the repository's convention — `.up.sql` only, no
down file, timestamp-ordered after `20260912000002_drop_image_ocr_extraction_method.up.sql`.

## Ordering and why it is this order

PostgreSQL runs DDL transactionally, so the whole file is one atomic unit: any failure
leaves the database exactly as it was.

1. **Audit.** For each value being disallowed, a `DO $$ … RAISE EXCEPTION` block that
   counts rows holding it and aborts with a message naming the table, the value and the
   count. This is FR-009 stated as executable code — a constraint is never tightened
   against an unverified table.
2. **Repair `muted_domains`.** The one place where real data legitimately holds a removed
   value, because it is a *preference* rather than a record of something the system
   produced. Array subtraction, preserving surviving entries and their order. Must run
   before step 3, or the new CHECK would reject rows the migration is about to fix.
3. **Tighten CHECK constraints.** Drop-and-add for each of the five. `ADD CONSTRAINT`
   re-validates against existing rows, which is a second, independent proof that steps 1
   and 2 did their job.
4. **Correct column and table comments.** Six of them; see
   [database-constraints.md](database-constraints.md).
5. **Drop the thirteen empty schemas**, each `RESTRICT`. Last, because it is the one step
   that cannot be re-derived from the others, and because `RESTRICT` failing here should
   not leave earlier steps ambiguous about whether they ran.

## Audit dispositions

| Table / column | Expected count | If non-zero |
|---|---:|---|
| `chat.channel.channel_type` | 0 | abort — nothing creates these kinds, so a row means the premise is wrong |
| `files.file_access_rule.context_type` | 0 | abort |
| `iam.credential.credential_type = 'biometric'` | 0 | abort |
| `notification.notification.source_domain` | 0 | abort |
| `notification.personal_preference.muted_domains` | any | **repair, do not abort** — real preferences set by real people |

The spec's assumption says the disposition for a stray record is deletion, because these
are records of a feature that was never built. The migration nonetheless **aborts rather
than deleting**, on the reasoning that a row whose existence contradicts the entire premise
of the change deserves a human's attention before it is destroyed, and re-running the
migration after a deliberate cleanup costs one command. [ASSUMPTION: abort-then-delete-by-
hand is chosen over silent deletion; the spec permits deletion but does not require it to be
automatic, and an irreversible delete inside a migration that was written on the assumption
the table is empty is a poor trade.]

## Post-migration regeneration (part of the same change set)

```
backend/scripts/regen-schema.sh    # regenerates backend/database/scripts/schema.sql
sqlc generate                      # regenerates backend/database/models.go and *.query.sql.go
```

`models.go` carries the column comments as Go doc comments in three places
(lines ~736, ~3060, ~3748, ~3754), so it changes purely as a consequence of step 4. Neither
generated file is hand-edited.

## Deployment

Single coordinated release: backend image, web build and mobile build ship together. The
migration runs before the new backend serves traffic, as every migration in this repository
does. There is no window in which an old client talks to a new backend, which is what makes
the proto break safe here.

## Rollback

There is no down migration, matching the repository's forward-only convention. Reverting
would mean a new forward migration re-adding the values and re-creating the schemas —
mechanical, and it would restore no data, because there was none. The realistic rollback is
redeploying the previous images, which works against the migrated database for everything
except the five narrowed CHECKs; those would reject values the old code still believes in,
and the old code never produces them. [ASSUMPTION: that residual risk is accepted. The
alternative — keeping the old values valid in the database while the new code rejects them
— is the compatibility layer this feature exists to remove.]

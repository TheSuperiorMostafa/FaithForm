# Prompt 6 — Legacy attendance migration and reconciliation

**No backfill has been performed on real data**, and nothing has been deployed.

One thing *has* changed since this document's first revision: `0055` and `0056`
now **execute** against a disposable Postgres 17 in `pnpm test:concurrency`, and
the attendance functions have been exercised under two real connections. That is
not a migration rehearsal — the fixture creates only the objects these two
migrations reference, not the real 58-migration chain — but the DDL is no longer
unexecuted. See `P6_VERIFICATION_MATRIX.md`, Layer C.

## The existing model

`attendance_records` (one header per church per date) plus `attendance_entries`
(one row per member, `present` or `absent`). Real, authoritative history that
must survive.

Its known weaknesses, all of which the backfill has to face:

| Weakness | Consequence |
|---|---|
| No unique constraint on `(church_id, service_date)` | Two headers can exist for one date |
| Application-side check-then-insert | That race is reachable |
| `member_id` is `ON DELETE SET NULL` | A present entry can name nobody |
| One batch per **date**, not per service | A church with two Sunday services cannot say which one someone attended |
| Sunday-only submission | Midweek services were never recordable |

## The new model

`service_occurrences` + `attendance_facts`, with the identity and uniqueness
described in `P6_ATTENDANCE_ARCHITECTURE.md`.

**AD-004 offered three options.** Option 3 (adopt the unused aggregate
`attendance` table) was rejected outright, as the decision record required.
Between 1 and 2, this implements **option 2** — new occurrence and counted-fact
tables — for a reason the source made concrete: the legacy header has no service
identity, so adding occurrence columns to it (option 1) would have forced a
fabricated answer into the existing rows. Option 2 lets an ambiguity be
*recorded as ambiguous* instead.

## Migration order

```
0050 security baseline
0053 visitor identity + campuses          ← service_occurrences references campuses
0054 publication and push
0055 attendance authority                 ← this migration
0056 transactional bulk attendance        ← and this one
```

Both are **purely additive**. Neither alters, drops, or writes
`attendance_records`, `attendance_entries`, the aggregate `attendance` table, or
`members` — asserted by test.

`0056` adds exactly one function, `record_attendance_batch`, and no table. It is
a wrapper around `record_attendance`: it writes no attendance row itself, so it
introduces no second insert path to reconcile against.

## Preflight

```bash
FAITHFUL_MIGRATION_DATABASE_URL=... \
FAITHFUL_MIGRATION_CONFIRM=i-understand-this-is-not-production \
pnpm db:attendance
```

Applies the migration in a transaction, then runs a **read-only** report.
`lib/attendance/v2/legacy.ts#preflight` finds six categories:

| Finding | Meaning | Blocks backfill? |
|---|---|---|
| `duplicate_church_date` | Two legacy headers share a date | **Yes** |
| `ambiguous_service` | The church runs >1 service that weekday | **Yes** |
| `null_member` | Present entry with no member | No — mapped `orphaned` |
| `no_schedule` | No matching service time | No — needs a manual occurrence |
| `invalid_date` | Unparseable service date | No — reported |
| `orphaned_entry` | Entry with no resolvable record | No — reported |

## Ambiguity is reported, never guessed

The rule the whole module is built around: **when the legacy data cannot prove
something, report it.**

A church that ran 9am and 11am services recorded one batch. Nothing in that row
says which service a person attended. Assigning them to the 9am would put a
fabrication in the permanent record, so `backfill` refuses unless the caller
passes `acknowledgeAmbiguity` — and even then, those rows are mapped with
`resolution = 'ambiguous'` rather than assigned to a guessed service.

## Backfill

`lib/attendance/v2/legacy.ts#backfill`, `dryRun: true` by default.

- One legacy header becomes **one occurrence**, `generation_source =
  'legacy_backfill'`, labelled "Recorded service" so nobody mistakes it for a
  generated one.
- Each `present` entry with a member becomes **one counted fact**,
  `source = 'legacy'`.
- `absent` entries are skipped — the old model stored both; only presence is
  attendance.
- Every entry gets an `attendance_legacy_map` row, so the backfill is
  auditable, **re-runnable**, and reversible.
- Nothing in the legacy tables is modified or deleted.

Idempotent: a second run finds existing mappings and skips them. A conflict on
the unique counted-fact index is the invariant working, not a failure.

## Reconciliation

`reconcile()` proves four things:

| Check | How |
|---|---|
| Totals match | legacy present-with-member count == active `source = 'legacy'` facts |
| No duplicate counted facts | structurally impossible — the unique index |
| No orphaned mappings | count of `resolution = 'orphaned'` |
| Aggregate table not adopted | no Prompt 6 path reads or writes it — asserted by test |

Ambiguous mappings are **reported, not hidden**: a non-zero count is a decision
the church still owes, not a migration failure.

### Still to verify against real data

- People history matches per person, not only in aggregate.
- Existing reports produce the same numbers before and after.
- Follow-up queues are unchanged.

These need a representative database. Until then they are **pending**.

## Cutover

Staged, and deliberately not a dual-write.

1. **Apply `0055`, then `0056`.** Nothing changes for anyone — every source
   except manual is off by default, and no occurrence exists yet. `0056` adds
   only a function.
2. **Generate occurrences.** `pnpm db:attendance` then the generate cron, or the
   dashboard's "Refresh from schedule".
3. **Preflight.** Resolve every blocking finding with the church.
4. **Backfill dry-run.** Compare the projected counts to the legacy totals.
5. **Backfill for real**, then `reconcile()`.
6. **Switch reads.** The dashboard's Services page uses the new authority; the
   legacy `(record)` route stays available for history.
7. **Freeze legacy writes** only once step 6 is verified.

**No permanent dual-write and no two counted ledgers.** During the window
between 5 and 7 the legacy tables remain readable, but new attendance goes to
one place.

## Rollback and forward fix

Before any real attendance exists in the new model, rollback is clean:

```sql
drop function if exists public.attendance_report(uuid, timestamptz, timestamptz, uuid, text);
drop function if exists public.create_manual_occurrence(uuid, uuid, text, date, time, integer, text, integer, integer, uuid);
drop function if exists public.generate_service_occurrences(uuid, date, date, timestamptz);
drop function if exists public.correct_attendance(uuid, uuid, text, uuid, text, timestamptz);
drop function if exists public.record_attendance(uuid, uuid, text, text, text, uuid, uuid, timestamptz, text, text, integer, jsonb, timestamptz);

drop table if exists public.attendance_kiosk_credentials;
drop table if exists public.attendance_qr_redemptions;
drop table if exists public.attendance_legacy_map;
drop table if exists public.attendance_corrections;
drop table if exists public.attendance_facts;
drop table if exists public.attendance_attempts;
drop table if exists public.service_occurrences;

drop trigger if exists attendance_policies_bump_version on public.attendance_policies;
drop function if exists public.bump_attendance_policy_version();
drop table if exists public.attendance_policies;
```

**The legacy tables are untouched by all of this**, so a rollback returns the
church to exactly the attendance system it had.

**Prefer forward-fix once real attendance exists.** After a backfill and any
new check-ins, dropping `attendance_facts` destroys history that only exists
there. At that point the correct response to a defect is a further additive
migration — `0056` is already taken by the batch wrapper, so `0057` onward.

A faster mitigation for a *behaviour* problem: set the offending source to
`false` in `attendance_policies`. Future occurrences stop accepting it without
touching schema or history.

## Production gate

**External and not performed.** Before any production cutover:

1. Rehearse `0055` and `0056` **from the real baseline** and from a restored
   representative copy. The concurrency harness is not a substitute: it applies
   a minimal bootstrap fixture, not the migration history.
2. Run the preflight and resolve every blocking finding **with the church**.
3. Dry-run the backfill; compare totals.
4. Backfill and `reconcile()`; totals must match exactly.
5. Verify per-person history, reports, and follow-up queues by hand.
6. `EXPLAIN (ANALYZE, BUFFERS)` the eight indexed queries at realistic
   cardinality — **none has been measured**.
7. Exercise the RLS matrix across all ten principals.
8. Only then freeze legacy writes.

Never load production congregation data into a rehearsal database.

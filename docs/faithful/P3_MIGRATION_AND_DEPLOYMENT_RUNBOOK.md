# Prompt 3 — Migration and deployment runbook

For `supabase/migrations/0053_visitor_identity.sql`.

**This migration has never been executed.** Everything below is the procedure to
follow when an authorized environment is available, not a record of work done.

No secret values or production personal data appear in this document, and none
may be added to it.

## 0. Dependency

`0050_security_baseline.sql` **must** already be applied. `0053` assumes the
baseline's grants and policies are in force and does not re-establish them.

Confirm before starting:

```bash
pnpm test:migrations
```

This asserts `0053` sorts after `0050`, introduces no duplicate prefix, and
secures only objects it creates.

## 1. Inspect deployed state before writing anything

Against the target database, read-only:

```bash
pnpm security:drift
```

Then confirm by inspection, in a read-only session:

- Which of `0043`–`0052` are actually present. The repository has known
  duplicate legacy prefixes (`0003`, `0010`, `0011`, `0019`) and a documented
  history of partially-applied migrations, so **filename order is not proof of
  deployed state**.
- That `churches.slug` exists and is unique — `0053` reuses it as the public
  handle and does not create it.
- That `church_service_times` exists — `0053` adds a nullable column to it.
- That none of the nine new table names already exist.

If `churches.slug` is missing or non-unique, **stop**. Reconcile `0013` first.

## 2. Rehearse on a disposable database

```bash
pnpm db:rehearse
```

Rehearse twice, and treat both as required:

1. **From baseline** — an empty database, every migration in order.
2. **From a representative upgraded state** — a restored copy of a
   non-production database that reflects real drift.

Never rehearse against production, and never load production congregation or
donor data into a rehearsal database.

Then run the database security suite:

```bash
pnpm test:database-security
```

## 3. Verify RLS live

Source tests assert the policies exist; only a database proves they behave.
For **each** of the nine new tables, exercise all six principals:

| Principal | Expected |
| --- | --- |
| Account owner | Reads own rows only |
| Staff of the same church | Reads that church's relationships, claims, links, campuses; **never** `visitor_accounts` |
| Staff of another church | Reads nothing |
| Unauthenticated | Reads nothing; discovery functions still work for listed churches |
| Blocked visitor | Cannot follow, join, or redeem any invitation |
| Service role | Full access |

Specifically confirm:

- `visitor_invitations` is unreadable by `anon` and `authenticated`.
- `current_visitor_account_id()` and `is_church_staff()` are **not** executable
  by `anon` or `authenticated`.
- `consume_visitor_invitation()` is executable **only** by `service_role`.
- `discover_churches`, `public_church_profile`, and `public_church_campuses` are
  executable by `anon`, and return nothing for a church with
  `is_discoverable = false`.

Race the invitation consumer from two connections against a single-use token and
confirm exactly one succeeds.

## 4. Legacy data reconciliation

`0053` is additive and backfills nothing. After applying it:

- **Every existing church is unlisted.** `is_discoverable` defaults to `false`.
  This is deliberate. Do not bulk-enable it; each church opts in through
  Settings → Visitor app.
- **Every existing church has `join_policy = 'approval_required'`.** Confirm this
  matches each church's intent before they enable discovery.
- **No campuses exist.** Existing `churches.address` and all existing
  `church_service_times` rows are untouched and keep working. Creating a campus
  is optional; attaching a service time to one is a separate, deliberate action.
- **No `members` row is modified.** Verify a sample of `attendance_entries` still
  resolves to the same `members.id` after the migration.

## 5. Campus and service-time rollout

Per church, and only with that church's agreement:

1. Create the primary campus with the church's real address and timezone.
2. Verify the coordinate pair (or leave both null).
3. Set the geofence radius. It is stored only — Prompt 6 will use it.
4. Attach existing service times to the campus one at a time.
5. Confirm the public projection shows what the church expects, and that the
   radius is **absent** from it.

## 6. Admin UI smoke tests

In a deployed non-production environment:

- Settings → **Visitor app**: the discovery toggle is off; enabling it without a
  slug is refused with a clear message; join policy saves and re-reads.
- Campus create, edit, retire; invalid timezone rejected; half a coordinate pair
  rejected; a second primary campus demotes the first.
- People → pending claims: a claim appears, candidates show their match reason,
  approval requires an explicit selection, an already-linked candidate is
  disabled, and rejection and dispute both work.
- Confirm with two churches that neither sees the other's claims, relationships,
  campuses, or invitations.
- Confirm a visitor account, after every relationship state, still cannot reach
  `/dashboard`.

## 7. Rollback and forward-fix

`0053` is additive and unreferenced by any pre-existing code path, so rollback is
clean if performed before any visitor data is created.

**Rollback**, in reverse dependency order:

```sql
drop table if exists public.visitor_account_requests;
drop table if exists public.visitor_people_link_events;
drop table if exists public.visitor_people_links;
drop table if exists public.visitor_people_claims;
drop table if exists public.visitor_relationship_events;
drop table if exists public.visitor_church_relationships;
drop table if exists public.visitor_invitations;

alter table public.church_service_times drop column if exists campus_id;
drop trigger if exists church_campuses_validate_timezone on public.church_campuses;
drop table if exists public.church_campuses;
drop function if exists public.validate_campus_timezone();
drop table if exists public.visitor_accounts;

drop function if exists public.consume_visitor_invitation(text, uuid, text, timestamptz);
drop function if exists public.visitor_claim_status(text);
drop function if exists public.public_church_campuses(text);
drop function if exists public.public_church_profile(text);
drop function if exists public.discover_churches(text, text, text, text, uuid, integer);
drop function if exists public.is_church_staff(uuid);
drop function if exists public.current_visitor_account_id();

alter table public.churches
  drop constraint if exists churches_join_policy_check,
  drop column if exists public_profile_version,
  drop column if exists discovery_updated_at,
  drop column if exists join_policy,
  drop column if exists public_summary,
  drop column if exists is_discoverable;
```

**Prefer forward-fix once visitors exist.** After any real account, relationship,
or link has been created, dropping these tables destroys visitor-owned data and
the claim audit trail. At that point the correct response to a defect is an
additive `0054`, not a rollback.

**Never** roll back by dropping or altering `members`, `attendance_records`,
`attendance_entries`, `church_users`, or anything `0050` secured.

## 8. Production gates

All must hold before promotion:

1. A hosted CI pass of `pnpm ci:verify` and `pnpm audit:prod`.
2. Both rehearsals (§2) completed.
3. The full RLS matrix (§3) exercised, including the two-connection invitation race.
4. `EXPLAIN (ANALYZE, BUFFERS)` captured at realistic cardinality for the
   discovery keyset query and the staff claim and relationship listings. The
   indexes in `0053` were chosen against exact filters and orderings but **no
   plan has been measured**.
5. Admin smoke tests (§6) passed with two churches.
6. Product sign-off that every church starts unlisted with
   `approval_required`.
7. **Legal sign-off on retention.** Deletion behaviour is implemented and tested,
   but retention periods are not decided. Do not represent this as compliance
   with any specific regime.
8. A named owner for the first dispute between two accounts claiming the same
   People record.

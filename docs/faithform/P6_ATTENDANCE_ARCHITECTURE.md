# Prompt 6 — Attendance architecture

Migrations `0055_attendance_authority.sql` and `0056_attendance_batch.sql`.

## The invariant

```
at most one counted attendance fact per (service_occurrence_id, member_id)
```

Enforced by a **unique index**, not by application code:

```sql
create unique index attendance_facts_unique_idx
  on public.attendance_facts (service_occurrence_id, member_id);
```

**The index is deliberately not partial.** A `where status = 'active'` would let
a reversed row be re-inserted alongside itself, and a later restore would then
double-count. A reversed fact keeps its slot; restoring flips the status on the
same row.

## Source of truth

| Concept | Owner |
|---|---|
| People identity | `members.id` — unchanged, never duplicated |
| Which gathering | `service_occurrences` |
| Who attended | `attendance_facts` — **the counted fact** |
| What was submitted | `attendance_attempts` — append-only |
| What changed and why | `attendance_corrections` — append-only |
| Old history | `attendance_records` / `attendance_entries`, untouched and mapped |

The unused aggregate `public.attendance` table is **not adopted**. No Prompt 6
path reads or writes it — asserted by test.

## Service occurrences

An occurrence is the thing attendance attaches to, and it **snapshots history**
so later edits cannot rewrite it:

- campus, schedule, label, local date
- IANA timezone and the **resolved UTC start and end**
- check-in open and close instants
- `policy_version` + `policy_snapshot`
- campus coordinates and radius as they were

### Identity is the schedule plus the resolved start

```sql
unique (service_time_id, starts_at_utc) where service_time_id is not null
```

Not church-and-date. That is what makes **two services on one Sunday two rows**,
and what makes a fall-back DST day with two 01:30 locals resolve to two
different instants rather than colliding.

Manual and special occurrences have their own identity —
`(church, campus, starts_at_utc, label)` — because no schedule produced them.

### DST is Postgres's problem, not ours

```sql
resolved_start := local_start at time zone zone;
```

`AT TIME ZONE` knows about transitions. A 10:00 service is **15:00Z in winter
(EST, UTC−5) and 14:00Z in summer (EDT, UTC−4)**, and both are recorded as they
actually were.

An earlier revision of this document had those two figures the wrong way round.
They are now taken from a test that **executes** the generator across the 2026
US spring-forward against a real Postgres and reads the resolved instants back —
which is how the error was caught. A second test asserts the generator contains
**no hard-coded interval offset**.

### Generation

Deterministic, idempotent, bounded to a 400-day horizon. `on conflict do
nothing` means a re-run or two concurrent generators create nothing twice — so
the job needs no lock, and overlapping invocations are merely wasteful rather
than wrong.

Cancelling refuses new attendance and **leaves counted facts alone**. People who
were counted attended; the service being cancelled later does not un-attend
them.

## Attempts versus counted facts

An **attempt** is what a source submitted. Every submission lands here whatever
the verdict, because "why was I not counted" is a question the church has to be
able to answer.

A **counted fact** is the one authoritative statement that this person attended.

Deliberately absent from an attempt: a latitude or longitude column. It stores
`distance_band` (`inside`/`near`/`far`) and `accuracy_band`
(`high`/`medium`/`low`/`unusable`). `precise_evidence` exists for the short
window a support question might need it, carries an expiry, and is emptied by
the purge job — **the attempt row survives; only the payload goes.**

A counted fact carries **no location at all** — asserted by test.

## The one command

Every source ends at `record_attendance`. It is a single PL/pgSQL function
rather than a sequence of application calls because the attempt and the fact
must commit or roll back together.

The order matters:

1. **Resolve the occurrence** — the church comes from here. There is no
   `p_church_id` parameter at all.
2. **Idempotency, before validation.** A retried submission returns what it
   returned the first time rather than being re-judged against a window that may
   since have closed.
3. **Validate** — cancelled, source-enabled (against the *snapshot*), window,
   People link, member-belongs-to-church, then source-specific rules.
4. **Append the attempt**, whatever the verdict.
5. **Insert the fact** with `on conflict do nothing`.

### Concurrency

```sql
insert into attendance_facts (...) values (...)
on conflict (service_occurrence_id, member_id) do nothing
returning id into new_fact_id;
```

Simultaneous attempts — from any mix of manual, geofence, QR and kiosk — race
into that statement. The index admits exactly one. Whoever loses reads the
winner's row and reports `already_counted`, which is a **success**, not an error.

A previously reversed fact is **not silently revived** by a new attempt;
restoring is an authorized, audited correction.

## Source convergence

| Source | Who resolves the member | Extra validation |
|---|---|---|
| manual | staff selection, same church | — |
| admin | staff selection | admin role |
| geofence | **verified People link only** | consent, distance band, accuracy band, dwell |
| qr | verified People link | signature, expiry, church, occurrence, replay |
| kiosk | approved restricted flow | revocable machine credential |

### Bulk marking — `record_attendance_batch` (migration `0056`)

**Bulk marking runs through the same command, one person at a time — inside one
transaction.** `record_attendance_batch` is a *wrapper*, not a second insert
path: it loops over `record_attendance` in PL/pgSQL and writes no attendance row
of its own, asserted by test.

The earlier version issued one HTTP request per person from the browser. That
was wrong in three ways, and all three are now fixed:

| Problem | Fix |
|---|---|
| A closed tab mid-run left half a roster marked | one transaction — an unexpected failure rolls back every person |
| A 400-person roster was 400 round trips | one call |
| Batch semantics lived in the client, unenforceable | enforced in SQL |

**The distinction that matters:** an *expected* per-person outcome is not a
failure. `already_counted`, `too_late` and `member_not_in_church` are **answers**
— returned for that person while the rest of the batch still commits. Only an
unexpected system failure rolls anything back. That is precisely what the old
header/entry model could not express.

- **Bounded** to 1000 members, checked in TypeScript *and* in SQL. The
  TypeScript check gives a usable message; the SQL check is the one that cannot
  be bypassed. Oversized batches raise before any person is touched.
- **Idempotent per person**: the key is `batch_key || ':' || member_id`, so
  re-running a batch finds each person's own earlier attempt. The dashboard
  holds one key per submission *intent*, not per click, so a retry after a
  timeout is recognised rather than counted twice.
- **Duplicates collapse**: the same person twice in one array is processed once
  and yields one result row.
- An unknown occurrence fails the whole call rather than producing a thousand
  identical rejections.
- Service-role only, `search_path` pinned. No caller may name a church — it
  comes from the occurrence, exactly as in a single check-in.

Two concurrent batches, and a batch racing single check-ins from other sources,
are **executed against real Postgres** in
`tests/database/attendance-concurrency.test.ts`.

### Geofence — backend only

Prompt 6 implements no native detection. What exists is the server half:

- The account must resolve to an **active verified `visitor_people_links` row**.
  Email, phone, device id, visitor relationship and coordinates establish
  nothing.
- `auto_attendance_consent` must be `granted`. `unset` is not consent.
- `detected` → `confirm` is a two-phase sequence. A single region callback with
  insufficient dwell returns `pending_confirmation`, **not** attendance — one
  raw callback is not unquestionable presence.
- Attempts expire when the window closes.

#### The boundary is published, not hidden — a correction

An earlier version of this document claimed the client never learns the campus
coordinates or radius, and that telling it where the boundary is "makes 'am I
inside' solvable". **That was wrong, and it is worth being precise about why.**

It conflated two different things:

| | |
|---|---|
| **Configuration secrecy** | Not a security control here. A church's address is on its own website, on a map, and in the public discovery projection *this codebase already serves*. It was never secret. |
| **Server-side validation** | The actual control. The server re-derives the verdict from its own campus row and the occurrence's policy snapshot, and never trusts what the client asserts. |

Withholding the geometry bought nothing against an attacker — anyone who wanted
the coordinates could read them off the church's own website — while breaking
the feature outright for everyone else. Core Location's `CLCircularRegion` and
Android's `GeofencingClient` both **require a centre and a radius** to register
an OS region. Without them there is no geofence to implement.

So `GET /api/mobile/v1/attendance/{slug}/geofence-config` returns the boundary,
deliberately, behind five gates re-derived on **every** request:

1. authenticated visitor account, `status = 'active'`
2. an active, non-blocked relationship with that church
3. a **verified `visitor_people_links` row** — the same resolver a live
   check-in uses, so a configuration can never outlive the permission
4. `auto_attendance_consent = 'granted'` — `unset` is not consent
5. the church's policy has `geofence_enabled`, and the campus is active,
   public, and positioned

Bounded to **20 regions** (both platforms cap registered regions) and 50
windows over a 7-day horizon.

`configVersion = policy_version * 1000 + account.authorizationVersion`, so a
revoked link, a withdrawn consent, a block, or a policy edit all move the
version and invalidate what a client holds.

#### Expiration and cache validation — a correction

The first version of this endpoint got this wrong in a way worth writing down,
because the two halves failed *together*.

`expiresAt` was `now + 30 minutes`, so it changed on every request. That left
only two options, and both were broken:

| | |
|---|---|
| Put `expiresAt` in the ETag | It changes every request, so no revalidation ever succeeds and the ETag is decorative |
| Leave it out | A client revalidating an **expired** configuration gets `304 Not Modified`, no body, and therefore no new expiry — and stays stuck there permanently |

The original shipped the second. That is a real defect: an expired
configuration could never be renewed by revalidation.

**The fix is quantization, and it removes the choice.** `expiresAt` is now
deterministic **within an epoch-aligned time bucket and the relevant
attendance-window state**. It still depends on `now` — `now` chooses the bucket
— but it changes only at predictable boundaries rather than on every request:

```
expiresAt = min(
  (floor(now / 15min) + 1) * 15min,          -- next revalidation boundary, epoch-aligned
  earliest checkinOpensAt / checkinClosesAt strictly after now
)
```

- **Epoch-aligned buckets**, so every client rolls over on the same schedule and
  two requests in the same bucket with the same windows yield the same
  `expiresAt`. It is a 15-minute quantization of `now`, not an escape from it.
- **Clamped to the next check-in boundary**, because that is the instant the
  `windows` array itself changes — the configuration genuinely stops being
  accurate then.
- **Always strictly in the future**, including for a request landing exactly on
  a boundary.

**The ETag is computed over the entire response body**, `expiresAt` included,
plus the church slug. Not over a hand-picked subset: a subset has to be
maintained in step with the payload, and this bug is precisely what happens
when it drifts. A test flips each semantic field in turn and requires the ETag
to change.

Together these give the property a client depends on:

> **A 304 is only ever served while the client's cached `expiresAt` is still in
> the future.** A client revalidating an expired configuration always receives
> either a fresh 200 or an explicit refusal — never a stale 304.

*Proof.* A client holding expiry `X` revalidates at `t ≥ X`. Every candidate in
the `min` above is either the end of a bucket containing `t` (hence `> t ≥ X`)
or a boundary strictly after `t`. So the new minimum is `> X`, the body differs,
the ETag differs, and the client gets a 200. The stale 304 is unreachable, not
merely unlikely. The test suite exercises this over 480 issue/revalidate pairs
rather than trusting the argument.

The response is `private, must-revalidate` with a **strong** ETag. A shared
cache must never serve one account's configuration to another. The church slug
is in the validator because a refusal body is otherwise identical across
churches.

#### There is no integrity field — it was removed

An earlier version returned an HMAC `integrity` value, described as letting a
client detect a tampered cached configuration. **It did nothing of the kind,
and it has been removed from the contract rather than renamed.**

- The client has **no key**, so it could not verify the value.
- The server **never accepted it back**, so it authorized nothing.
- **TLS already authenticates the transport**, which is the threat it appeared
  to address.

It was a security-shaped field with no security in it — worse than no field,
because a reader could reasonably assume something was being checked. Two
values do the real work and neither is presented as proof of anything:

| Value | Job |
|---|---|
| `configVersion` | *Which* configuration this is. Folds in the account's authorization version, so a revocation changes it. |
| **ETag** | Cache validation, computed over the whole body. |

Attendance evidence is validated server-side on submission, which is where it
always was. `ATTENDANCE_CONFIG_SECRET` is no longer read by anything.

**Where the anti-spoofing actually lives.** On submission, server-side:
`record_attendance` bands the distance against the occurrence's own snapshotted
campus coordinates, checks accuracy, dwell and confirmation against
`policy_snapshot`, and returns `outside_region` or `insufficient_accuracy` on
its own authority. A client that lies about where it is gets a verdict computed
from the server's numbers, not its own. That was always the real control;
publishing the boundary does not weaken it, because it was never the thing
doing the work.

The privacy rule is unchanged: **no continuous trails, and no permanent
coordinates in a counted fact.** Serving a static campus centre — which the
church publishes anyway — is not the same as retaining where a person has been.

**Ordinary coordinates do not prove physical presence**, and nothing here
pretends otherwise. Anti-spoof extension points exist (dwell, confirmation,
accuracy bands, policy version); a determined spoof is not defeated by them.

### QR

Signed, not stored: the code carries its occurrence, purpose and expiry. Stored
instead is the set of **redeemed nonces**, because a signature cannot stop a
replay. The unique index on `(occurrence, nonce)` is the replay guard.

Rotation is just minting another. A redeemed nonce stays redeemed and a counted
fact is independent of the code that produced it, so **rotating never
invalidates someone already counted.**

The capability contains no secret and no People data — asserted by test.

### Kiosk

A restricted machine identity bound to one church and optionally one campus. It
may submit an attempt for a person the *server* resolved, and nothing else — no
staff role, no service-role authority, no People read. Only the hash is stored.

## Corrections

Append-only. Reverse and restore both write `previous_status`, `new_status`,
actor and reason. Nothing is updated or deleted to "fix" attendance.

Re-applying the same correction is a no-op rather than a second audit row.
The church predicate is applied at both layers, so a fact id from another tenant
resolves to nothing.

## RLS

| Table | Staff | Linked account | Anyone else |
|---|---|---|---|
| `attendance_policies` | read | — | — |
| `service_occurrences` | read | — | — |
| `attendance_facts` | read | **own only** | — |
| `attendance_corrections` | read | — | — |
| `attendance_attempts` | server only | — | — |
| `attendance_legacy_map` | server only | — | — |
| `attendance_qr_redemptions` | server only | — | — |
| `attendance_kiosk_credentials` | **server only** | — | — |

A person's attendance is visible to them via their active People link and to
staff of that church. **Not to other visitors of the same church.**

All writes go through the transactional command, so no table has a client write
policy.

## Contracts

`/api/mobile/v1/attendance/*` — occurrence, capability, attempt, status,
history. Thin over the authoritative services.

What a client **may not** send: a member id, a church id, a distance, a counted
result, or a correction actor. It names an occurrence and reports an
observation; the server decides what that means. Asserted by test against both
the routes and the request schema.

Attempts require an `Idempotency-Key`.

**The `attendance` capability is not enabled** in `ENABLED_CAPABILITIES` —
Prompts 7–8 own the clients, and offering a destination neither app implements
would be a lie to the route registry.

## Reporting

`attendance_report` aggregates in SQL: `count(*) filter (...)` plus
`jsonb_object_agg` by source, bounded by a date range. Nothing loads members and
facts into application memory to count them.

Reports count **active facts only**.

## Indexes

Each corresponds to an exact query:

| Index | Serves |
|---|---|
| `attendance_facts_unique_idx` | the invariant |
| `attendance_facts_occurrence_active_idx` | roster and counts |
| `attendance_facts_member_history_idx` | one person's history |
| `attendance_facts_church_reporting_idx` | date-range reporting |
| `service_occurrences_open_window_idx` | "which occurrence is open now" |
| `service_occurrences_church_start_idx` | the dashboard list |
| `attendance_attempts_idempotency_idx` | the retry lookup |
| `attendance_attempts_evidence_purge_idx` | the purge job |

**None has been measured.** They were chosen against exact filters and
orderings; no `EXPLAIN` has run. See `P6_VERIFICATION_MATRIX.md`.

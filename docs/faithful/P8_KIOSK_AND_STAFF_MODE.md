# Prompt 8 — Staff Kiosk Mode and the Manual Fallback

*What a welcome-desk tablet can do, what it emphatically cannot, and why the
manual path needed nothing new.*

---

## 1. The trade this replaces

A welcome desk needs a tablet that can check people in. The obvious way to build
that is to sign a staff member into the dashboard on the tablet and leave it
there — and that is **an administrator session on an unattended device in a
public room**. Whoever picks it up can export People, read giving, change
settings, and see every other service.

A kiosk session is the opposite trade. It can do exactly two things:

1. search this church's People by name, with a bounded result set;
2. check one of them into **one named occurrence**.

That is the whole list. It cannot administer the church, export People, change
or reverse attendance, read integrations, see giving, or touch any other
occurrence — not because those buttons are hidden, but because the credential
resolves to an occurrence and a church and carries **no user, no role, and no
session**.

```
resolve_attendance_kiosk_session(credential_hash) returns
  ok, reason, kiosk_session_id, service_occurrence_id, church_id,
  campus_id, idle_lock_seconds
```

No `user_id`. No `role`. No token that reaches anything else. A database test
asserts those columns are absent rather than merely unused.

---

## 2. Pairing

The credential is 32 random bytes. Nobody types that into a tablet.

```
Administrator (dashboard)              Tablet
─────────────────────────              ──────
Set up a check-in station ──────────▶  (nothing yet)
     │
  reads "FQW-3KLB" aloud  ──────────▶  opens /checkin/kiosk
                                       types FQW-3KLB
                                            │
                                       POST /api/checkin/kiosk/pair
                                            │
                                       ◀──── Set-Cookie: ff_checkin_kiosk
                                             HttpOnly, SameSite=Strict,
                                             Secure, Path=/api/checkin
```

- The pairing code is **single-use**, lives five minutes, and is stored only as a
  keyed hash. Reading it over a shoulder afterwards pairs nothing.
- The tablet generates nothing and the server stores no plaintext: the server
  mints the credential, keeps only its hash, and returns the value once.
- `pair_attendance_kiosk` is a conditional `UPDATE ... RETURNING` on
  `status = 'pending'`, so two tablets typing the same code at the same moment
  produce exactly one credential. Observed under two connections.
- On success the pairing hash is set to `null`, so it cannot be presented again
  even by the winner.

**Starting a kiosk is admin-only** (`requireCorrectionRights`). A standing
credential on a device in a public room is a higher bar than marking one person
present — the same bar as a correction.

---

## 3. Auto-lock

A kiosk that stays authorised forever is a kiosk that is still authorised on
Monday.

```sql
update public.attendance_kiosk_sessions as k
   set last_used_at = p_now
 where k.credential_hash = p_credential_hash
   and k.status = 'active'
   and k.expires_at > p_now
   and (k.last_used_at is null
        or k.last_used_at + make_interval(secs => k.idle_lock_seconds) > p_now)
returning k.* into touched;
```

**The idle check and the `last_used_at` touch are one statement.** If they were
two, a kiosk polling every second would refresh the clock on its way to failing,
and the next call would succeed — a lock that never trips. A database test drives
exactly that sequence and requires the second call to fail too.

Default 300 seconds, bounded 30–1800. A lock is **not** a revocation: touching
the screen and searching again brings it back, which is what makes the timeout
usable rather than a trip to the dashboard.

`idle_locked` is reported distinctly from `unknown` and `ended`, because "ask a
volunteer to unlock it" is actionable and tells nobody anything they did not
already hold. A locked kiosk's response carries **no occurrence and no church**.

### Revocation

`endKioskSession` sets `credential_hash = null`. The credential stops resolving on
the tablet's very next call — immediate, and not a flag the resolver has to
remember to check. A test asserts a revoked credential reads as `unknown`.

The session also carries a hard `expires_at`, one hour past the occurrence's
check-in close. A check-in station for a service that finished has no reason to
keep resolving.

---

## 4. The bounded People search

> Do not allow an unattended visitor to browse the church directory.

Four properties make this a check-in aid rather than a directory:

| Control | Value | Why |
| --- | --- | --- |
| Minimum query length | **3** characters | Below it, nothing is returned. There is no "show me everyone" query. |
| Match style | **Prefix**, not substring | `%son%` would surface every Johnson, Wilson and Jackson from three characters. `son%` surfaces people whose name actually starts that way. |
| Result cap | **8**, with no pagination | Paging is browsing. A wider match says "narrow it down". |
| Columns | **`id, first_name, last_name`** | Nothing else is selected, so nothing else can leak through a serialisation mistake. |

No email. No phone. No address, notes, household, birthday, or giving. The church
comes from the kiosk session, never from the request.

LIKE metacharacters are escaped before the query is built — without that, a query
of `%` matches everyone, which is precisely the browse this exists to prevent.

The response also carries `alreadyCounted`, read from `attendance_facts`, so a
volunteer does not tap the same name twice. That is a **read**; the authority
sweep distinguishes reads from writes explicitly, because an earlier version
forbade the table name outright and made this legitimate query a violation.

`POST`, not `GET`: a congregation member's name does not belong in a browser
history, a proxy log, or a referrer header.

Rate limited at 120 searches and 240 check-ins per minute per kiosk session. A
welcome desk does not search hundreds of times a minute.

The screen clears the search after a successful check-in. Leaving a person's name
on an unattended screen is the same exposure the search rules exist to prevent.

---

## 5. Offline behaviour

> Offline kiosk check-ins must not be claimed as counted. Prefer fail-closed.

**There is no local queue.** If the request does not reach the server, the screen
says the desk is offline and states that nothing was recorded. It does not show a
tick and hope.

Telling someone they were counted before anything decided that they were is worse
than telling them to try again, because only one of those two is recoverable: the
person walks away believing they are on the roll, and finds out weeks later when
the church's report disagrees.

The lock button is the local half of revocation — a volunteer packing up, or
anyone standing at a tablet that is about to walk away, can make it useless
immediately without a staff login, a dashboard, or a network round trip
succeeding. Ending the session from the dashboard is the stronger control and is
what actually revokes the credential server-side.

---

## 6. Every check-in goes through the one command

```ts
export async function kioskCheckIn(input): Promise<AttendanceResult> {
  return recordAttendance({
    occurrenceId: input.session.occurrenceId,   // from the session, never the request
    memberId: input.memberId,
    source: "kiosk",
    actorType: "kiosk",
    idempotencyKey: input.idempotencyKey,
  });
}
```

**There is no kiosk insert path.** `record_attendance` validates the window, the
tenancy and the policy exactly as it does for a phone or the dashboard, and
produces the same audited attempt and the same unique counted fact.

`actorType` is `kiosk` rather than `staff`: the report should say "the welcome
desk counted this" without implying a named staff member stood over it, and the
kiosk holds no user id to name.

The occurrence comes from the session. A request naming an occurrence would be a
request to check into a different service, so no request may name one.

Two database tests hold the line:

- a kiosk check-in produces exactly one fact, and a retry with the same key finds
  it (returning `already_counted`, which is what `record_attendance` replays);
- **a QR check-in and a kiosk check-in for the same person are one fact.**
  Someone scans the projector and a volunteer also taps their name at the desk:
  two sources, two audited attempts, one counted person. This is the rule that
  makes multi-use codes safe.

---

## 7. The manual admin fallback

> Reuse `record_attendance_batch`.

**It was already built, and Prompt 8 added nothing to it.** Prompt 6 shipped:

- `record_attendance_batch` (migration 0056) — loops over `record_attendance`
  **inside the database**, so one transaction, one round trip, no partial
  application, and no second insert path;
- `markPresentBulk` / `markPresent` in `lib/attendance/v2/roster.ts`, capped at
  `MAX_BULK_MEMBERS = 1000` in TypeScript and again in SQL;
- `correctAttendance`, which reverses and restores through `correct_attendance` —
  appending to the correction audit, never deleting.

The occurrence board's roster, "Mark everyone present", and the per-person
Present / Remove / Restore controls all terminate there. Corrections remain
audited and non-destructive, and there are no direct fact inserts from any UI
action — asserted for every check-in file by `checkin-authority.test.ts`.

So the manual fallback for Prompt 8 is: **when a code will not work, mark them on
the roster**, which the pastor already has open on the same screen as the display
controls.

---

## 8. What a stolen device gets

| Device | What the thief holds | What they can do |
| --- | --- | --- |
| Projector | A display capability for one occurrence | Watch a code they could already see on the wall |
| Tablet | A kiosk credential for one occurrence | Search names by prefix, 8 at a time; check people into that one service — until the idle lock trips or an admin revokes it |
| Neither | — | Nothing that touches another service, another church, People export, giving, integrations, or the dashboard |

Both are revoked from the dashboard in one click, and both stop working on the
device's very next request.

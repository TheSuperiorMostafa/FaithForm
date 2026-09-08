# Prompt 6 — FaithForm attendance administration

## What changed, and what did not

The Sunday-only picker is no longer the authoritative workflow. A service is
whatever the church actually scheduled — any day, any campus, several on one
day — and attendance attaches to that occurrence.

**Legacy history stays reachable.** The existing `(record)/[date]` route is
untouched, so a church can still open a Sunday it recorded under the old model.
The new Services page is the authority for anything new.

## Configuration

`attendance_policies`, layered church → campus → service. The most specific row
wins, so a church can set a default and then say "except Wednesday evening".

| Setting | Default | Bound |
|---|---|---|
| Manual | **on** | it is what the dashboard already does |
| Geofence / QR / Kiosk | **off** | explicit opt-in only |
| Check-in opens before | 30 min | 0–240 |
| Check-in closes after end | 30 min | 0–240 |
| Max location accuracy | 100 m | 10–500 |
| Minimum dwell | 120 s | 0–3600 |
| Requires confirmation | on | — |
| Correction role | admin | admin \| staff |
| Evidence retention | 14 days | 1–90 |

The closing offset is measured from the service **end**, so a long service does
not close its own window halfway through.

Three contradictions are refused by the database rather than by a form: a window
that closes before it opens, confirmation required with zero dwell, and a policy
targeting more than one scope at once.

`policy_version` increments on every change, and an occurrence snapshots it — so
a policy edited after a service **cannot retroactively change how that service's
attempts were judged.**

## Occurrence dashboard

`/dashboard/attendance/services`

- Upcoming, active, completed and cancelled, newest first.
- Local time in the **service's own timezone** — a staff member abroad still
  sees the time the congregation will arrive.
- Campus name where set; "Open now" and "Cancelled" badges.
- Roster with search, live present count.
- Source badges: Marked, Automatic, Scanned, Kiosk, Corrected, Recorded.
- "Refresh from schedule" materializes the horizon on demand, for a church that
  just added a service time.

### Marking

- **One person** — a button per row, through the same command a geofence attempt
  uses.
- **Everyone** — one call, one transaction, still one person at a time through
  that command. `record_attendance_batch` loops over `record_attendance` in the
  database and writes nothing itself; a bulk insert would be a second attendance
  authority.

Both report honestly. "42 marked, 3 already counted" is what comes back, because
`already_counted` is a **success** — someone may have checked themselves in a
moment ago.

**A half-marked roster is no longer possible.** The batch is one transaction, so
closing the tab or losing the connection mid-run rolls back every person rather
than leaving the list in a state nobody chose. Expected per-person outcomes —
already counted, too late, not in this church — still commit alongside everyone
else; only an unexpected system failure rolls back.

Re-running a batch is idempotent: each person's key is
`${batchKey}:${memberId}`, so a retry finds their own earlier attempt. The board
holds one batch key per *submission*, not per click — pressing "Mark everyone"
again after a timeout is the same batch, not a second one.

Bounded to **1000 people per batch**. Beyond that the request is refused with a
plain message before anything is written.

### Corrections

**Admin only**, and enforced server-side by `requireCorrectionRights`.

- Remove → `reversed`. The row stays; reports stop counting it.
- Restore → `active`, on the same row.
- Cancel service → refuses new attendance, **leaves counted facts alone**.
  People who were counted attended.

Every one appends to `attendance_corrections` with both states, the actor, and a
reason. Nothing is deleted to tidy a number.

## People integration

`getPersonAttendance(memberId)` returns occurrence, campus, source, status and
correction history, bounded and ordered by the index that serves it.

Existing notes and follow-up behaviour are untouched. **No visitor account data
is exposed** beyond whether an approved People link exists.

## Reporting

`attendance_report` aggregates in SQL — `count(*) filter (...)` plus
`jsonb_object_agg` by source, bounded by a date range. Filters: date range,
campus, source, and active-versus-reversed.

Reports count **active facts only**. Nothing loads members and attendance rows
into application memory to produce a number.

## Permissions

| Action | Requires |
|---|---|
| View services and roster | church staff + `attendance` feature |
| Mark present, bulk mark | church staff + `attendance` feature |
| Reverse, restore, cancel | **church admin** |
| Configure policy | church admin |
| Issue/revoke kiosk credential | church admin |

Every action resolves the church from the caller's own session. **No admin
action accepts a `churchId` argument** — asserted by test.

## Accessibility

- Roster rows are one element each, with the person's name and their state read
  together rather than as separate fragments.
- The search field carries an explicit label.
- Status is carried by **text as well as colour** — "Removed", "Open now",
  "Cancelled" — so a cancelled service is not distinguished by hue alone.
- Every control meets the touch minimum inherited from the Prompt 4 tokens.
- Empty, loading, permission and error states are distinct: "no services yet"
  points at Settings, and a roster that is still loading says so rather than
  rendering as empty.

## Privacy, as the church sees it

The dashboard **never requests or collects visitor location**. What staff see
about an automatic check-in is that it happened and which source produced it —
not where the person was.

Attempts carry coarse bands and a verdict; a counted fact carries no location at
all.

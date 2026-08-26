# Prompt 8 — Operations Runbook

*Deploying check-in, rotating the signing key, running a service, and testing on
real devices.*

---

## 1. Before anything else: the signing key

Check-in does not work without it, and the dashboard says so rather than failing
at the church.

```bash
openssl rand -base64 48
```

```
ATTENDANCE_QR_SECRET=<the value>
```

Requirements, enforced in code:

- at least 32 characters;
- not starting with `replace-me`;
- **distinct from every other secret** — `lib/env/production.ts` asserts all
  registered secrets are unique values.

It signs four things through separate derived sub-keys: the rotating QR, the
projector's display capability, the pairing codes, and the kiosk credentials. One
variable covers all four without any of them being interchangeable.

### It is now a required production variable

`ATTENDANCE_QR_SECRET` was added to the production environment audit in this
prompt. Before that, the only non-test reference in the entire repository was the
one line that read it — so a production deployment passed its own environment
check with QR check-in **entirely unconfigured**, and every attempt to start a
display failed silently at the church rather than loudly at deploy time.

`pnpm audit:prod` will now fail until it is set. That is the intended change.

---

## 2. Applying migration 0059

Additive: five new tables, eight new functions, nothing altered and nothing
dropped. **Migrations 0055–0058 are not touched.**

```bash
# Rehearse on a disposable database first.
createdb faithful_rehearsal
psql faithful_rehearsal -f tests/database/fixtures/bootstrap.sql
for n in 0055 0056 0057 0058 0059; do
  psql faithful_rehearsal -f supabase/migrations/${n}_*.sql
done

# Then the executable gate, which applies all five and races them.
FAITHFUL_TEST_DATABASE_URL=postgres://…/faithful_rehearsal pnpm test:concurrency
```

Expect `ℹ pass 72`.

**Use a fresh database each run.** Migration 0055 uses `create policy`, which
Postgres has no `if not exists` form for, so a second application against the
same database fails with `policy … already exists`. That is a property of the
runner, not of the migrations — CI stands up a throwaway Postgres per job.

**Do not apply to production from a test harness.** The rehearsal database must
not be production, and the runner refuses a URL containing `prod`.

### The behaviour change 0059 records

`attendance_qr_redemptions` (0055) had a unique index on
`(service_occurrence_id, nonce)` — a **global** consumption, so the second person
to scan the projector was refused. It is left exactly as written and is superseded
from this point; nothing reads or writes it any more.

Redemption moved to `attendance_qr_scan_redemptions`, unique per **account**. If
you are auditing an upgrade: the old table stops growing at the deploy, and the
new one starts. Neither has ever been the duplicate-count defence — the unique
counted fact is.

---

## 3. Scheduling the purge

`purge_attendance_checkin_artifacts(now, scan_retention_days)` deletes expired
codes and pairings, ends sessions past their bound, and drops scan redemptions
older than the retention window (default 90 days).

Run it hourly. It is `service_role` only and returns counts:

```sql
select * from public.purge_attendance_checkin_artifacts();
-- codes_removed | pairings_removed | sessions_ended | scans_removed
```

Nothing here is destructive to attendance: sessions are *ended*, not deleted, so
the history of which displays ran survives while their capabilities do not.

---

## 4. Running a service

### The pastor

1. **Dashboard → Attendance → Services**, select the service.
2. **Start check-in display.** A seven-character pairing code appears **once**.
3. Read it to whoever is at the projector. Do not leave it on screen — press
   **Done** when it has been typed.
4. If the projector reboots or the browser is closed: **Show another code**. Do
   *not* stop and restart the display — restarting rotates the code out from
   under a room mid-scan, while re-pairing does not.
5. **Stop display** when the service ends. Nobody already counted is affected.

### The projector

**Use a machine that is not signed in to FaithForm.** This is the operational
half of the rule that no administrator session belongs on a public screen. The
pairing flow exists precisely so the display machine never needs an account —
but nothing in the code can stop someone signing in on it first.

1. Open `https://<your-domain>/checkin/display`.
2. Type the pairing code. Full screen, and leave it.
3. The code changes every 30 seconds. The short code beside it changes with it.

If the display goes back to the pairing screen mid-service, the session was
stopped or expired. Start it again from the dashboard.

### The welcome desk

1. **Dashboard → Attendance → Services → Set up a check-in station.** Admin only.
2. Open `https://<your-domain>/checkin/kiosk` on the tablet and type the code.
3. Volunteers search by name — at least three letters — and tap to check someone
   in.
4. The station locks itself after five idle minutes. Searching again unlocks it.
5. **Revoke** from the dashboard when the service ends, or press **Lock** on the
   tablet.

If the desk says it is offline, **nothing was recorded.** Try again, or mark
people on the roster from the dashboard.

---

## 5. Rotating the signing key

Nothing is invalidated mid-service if this order is followed.

```bash
# 1. Move the outgoing value into the grace slot and install a new one.
ATTENDANCE_QR_SECRET_PREVIOUS=<the current value>
ATTENDANCE_QR_SECRET=$(openssl rand -base64 48)

# 2. Deploy. From this moment:
#      · new codes and credentials are signed with the new key
#      · everything signed with the old key still verifies
```

**Then wait out the longest-lived capability before removing the grace slot.**
That is a kiosk session, which never outlives its service's check-in close by more
than an hour. Waiting until the next day is comfortably safe.

```bash
# 3. Remove the line and deploy again. The grace ends here: codes signed with
#    the old key now report an unknown key id and are refused.
# ATTENDANCE_QR_SECRET_PREVIOUS=
```

Confirm the rotation took effect without recovering any key:

```ts
import { checkinSigningStatus } from "@/lib/attendance/v2/signing";
checkinSigningStatus();
// { configured: true, activeKeyId: "…", acceptedKeyIds: ["…","…"], inRotation: true }
```

The key ids are fingerprints derived *from* the keys and disclose nothing about
them.

**Rotating without the grace slot** invalidates every live code, every paired
projector and every kiosk credential instantly. That is sometimes what you want —
it is the response to a suspected key compromise — but it means every display and
every tablet must be paired again.

---

## 6. Device testing

**Nothing below has been executed.** The scanner's decisions, the QR decode, the
frame translation and every permission state are covered by automated tests; the
camera hardware path is not, and cannot be on a CI runner. These steps exist to
be run by a person with a device.

### iOS

| # | Step | Expect |
| --- | --- | --- |
| 1 | Fresh install. Open the app, browse discovery and a church feed. | **No camera prompt at any point.** |
| 2 | Enable automatic attendance. | Location prompts only. Still no camera prompt. |
| 3 | Open check-in. | Idle screen, typed field present, no prompt. |
| 4 | Type a live short code. | Counted. **Still no camera prompt.** |
| 5 | Tap **Scan the code**. | Camera prompt appears — the first one. |
| 6 | Allow. Point at a projector from the back of a room. | Decodes; screen shows the server's message. |
| 7 | Scan the same code repeatedly for 30 s. | One request, not dozens. |
| 8 | Wait for a rotation, scan the new code. | Acted on immediately. |
| 9 | Leave the screen mid-scan. | Camera indicator goes out. |
| 10 | Turn on airplane mode, scan. | "Faithful could not check you in… nothing was recorded." **No tick.** |
| 11 | Deny the camera, reopen check-in, tap Scan. | Settings offered; no second prompt. |
| 12 | Scan a stale code (screenshot from a minute ago). | Refused as expired. |

### Android

Same 12, plus:

| # | Step | Expect |
| --- | --- | --- |
| 13 | Deny once (not "don't ask again"), tap Scan again. | Dialog appears again — **Try again**, not Settings. |
| 14 | Deny with "don't ask again". | **Open Settings** offered instead. |
| 15 | A device with no rear camera. | Installs; check-in offers the typed code only. |

### The projector and the desk

| # | Step | Expect |
| --- | --- | --- |
| 16 | Pair a projector, then reload the page. | Same code still showing; no re-pair. |
| 17 | Open the display in two tabs. | Both show the same code and rotate together. |
| 18 | Type a used pairing code on a second machine. | Refused, indistinguishably from a wrong one. |
| 19 | Stop the display from the dashboard. | Projector goes dark within one rotation. |
| 20 | Scan a code captured just before stopping. | Refused. |
| 21 | Leave the kiosk untouched for six minutes. | Locked; searching unlocks it. |
| 22 | Revoke the kiosk from the dashboard. | Next tap on the tablet asks for a new code. |
| 23 | Two people scan the same displayed code. | **Both counted.** |
| 24 | One person scans and is also marked at the desk. | One person on the report, two attempts in the audit. |

### Distance and legibility

| # | Step | Expect |
| --- | --- | --- |
| 25 | Scan from the back row of the room the church actually uses. | Decodes within a couple of seconds. |
| 26 | Read the short code aloud from the same distance. | No character is misread. Note any that are — the alphabet is a decision that can be revisited. |
| 27 | Scan at an angle, and with a hand partly across the projector. | Medium error correction should still resolve it. |

---

## 7. What to check if something is wrong

| Symptom | Likely cause |
| --- | --- |
| **Start check-in display** is missing, replaced by a message | `ATTENDANCE_QR_SECRET` is unset, too short, or still `replace-me` |
| Display shows a QR but no short code | Every derived code collided with a live one — extremely rare, and deliberate: showing it anyway would check people into another church's service |
| Everyone is refused with "check the screen and try again" | The display was stopped, or the session passed its hard bound |
| One person is refused, everyone else is fine | No verified People link for that church. Link them on the People page |
| Codes stop verifying right after a deploy | The key rotated without a grace slot |
| The kiosk keeps locking | `idle_lock_seconds` is at its floor, or the tablet is going to sleep between taps |
| The desk says it is offline | It is. **Nothing was recorded** — mark people on the roster instead |

---

## 8. What this deployment still needs from a human

Listed as pending, with the reason, rather than implied to be done:

| Item | Why it is not in this repository |
| --- | --- |
| An Xcode app target, `NSLocationWhenInUseUsageDescription`, `NSLocationAlwaysAndWhenInUseUsageDescription`, `UIBackgroundModes` | The SwiftPM package has no app target — see `P4_EXTERNAL_SETUP_RUNBOOK.md` and `P7_PERMISSION_PRIVACY_AND_STORE_COMPLIANCE.md` |
| A production Android application id and signing key | Deliberately not invented — see `P4_EXTERNAL_SETUP_RUNBOOK.md` |
| App Store / Play privacy answers covering the camera | The camera is used for QR scanning only, is never linked to identity, and no frame is stored. That is what the forms should say |
| Running the 27 device steps above | Needs a phone, a projector and a room |
| Applying 0059 to production | Deliberately not done from here |

**No claim is made that the camera, a QR code on a real projector, a kiosk on a
real tablet, or any deployment has been exercised.** They have not.

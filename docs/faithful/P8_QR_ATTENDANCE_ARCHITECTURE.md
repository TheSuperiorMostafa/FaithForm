# Prompt 8 — Rotating QR Check-in

*How a pastor starts a check-in display, what a visitor scans, what the typed
code is, and why none of it is proof that anyone was in the room.*

---

## 1. What is actually being claimed

Rotating QR check-in **raises the cost of sharing a screenshot**. A code on a
projector changes every thirty seconds, so an image sent to someone at home is
stale before they open it, and sharing usefully means relaying a fresh code every
half-minute, live.

That is a real deterrent against casual sharing. It is **not**:

- proof of physical presence;
- resistant to a relay — a video call pointed at the screen, or a person texting
  the code every rotation, defeats it completely;
- screenshot-proof, in the sense of a screenshot being useless. A screenshot is
  useful for as long as the code in it is live.

No screen in Faithful and no line in these documents claims otherwise. Where a
church wants presence *evidence*, that comes from the geofence path built in
Prompts 6 and 7 — and even that is evidence, not proof.

**No permanent printed code exists, and none may be added.** A static code is
remote attendance with extra steps: print it once and anyone who photographs it
can check in from anywhere, forever. Every code in this design has a bounded
lifetime measured in seconds, tied to a session someone can stop.

---

## 2. The signing authority

`lib/attendance/v2/signing.ts`.

### Domain separation

No capability is signed with the master key. Every type derives its own sub-key:

```
subKey(type) = HMAC-SHA256(master, "faithform.faithful.attendance.v1|" + type)
```

Six types exist: `checkin.qr`, `checkin.display`, `checkin.pairing`,
`kiosk.pairing`, `kiosk.credential`, `shortcode`.

A token minted as a display capability therefore **cannot** verify as a check-in
token, even if an attacker rewrote its body, because the two were signed under
computationally unrelated keys. The issuer and audience are bound the same way —
they are inside the derivation string — so a token from another deployment or
another product never verifies here.

That is stronger than carrying `iss` and `aud` as claims and remembering to check
them, and it costs no bytes on a code someone has to scan from the back of a
room. The type is *also* in the body and checked explicitly, so a token stays
self-describing to anyone debugging one.

### Key versions and the rotation grace

| Variable | Mints | Verifies |
| --- | --- | --- |
| `ATTENDANCE_QR_SECRET` | yes | yes |
| `ATTENDANCE_QR_SECRET_PREVIOUS` | **never** | yes |

A token names its key by a fingerprint derived *from* the key:

```
kid = HMAC(master, DOMAIN + "|key-id")  →  first 10 base64url characters
```

which reveals nothing about the key itself. Rotation is therefore: move the
outgoing value into the previous slot, install a new one, and remove the previous
slot once the longest-lived capability has expired. Nothing is invalidated
mid-service. Removing the previous slot is what *ends* the grace — an unknown
fingerprint verifies against nothing.

Stored hashes get the same grace by a different route: `keyedHashCandidates`
returns the hash under every key in the ring, current first, and a lookup tries
them in order. One index probe in the ordinary case, two while a rotation is in
flight.

### Fail closed

A missing, short, or `replace-me` key does not fall back to a default, a
constant, or an unsigned mode. `mintCapability` returns `null`, `keyedHash`
returns `null`, and `verifyCapability` refuses. A deployment with no key
configured has no QR check-in — visibly, via `checkinSigningStatus()`, which the
dashboard reads to explain itself rather than failing at the church.

### The token on the wire

```
FF1.<kid>.<payload-b64url>.<signature-b64url>
```

The payload is compact JSON with short keys and UUIDs packed to 22 base64url
characters instead of 36:

```json
{"v":2,"t":"checkin.qr","s":"<22>","o":"<22>","w":60000000,"n":"<16>","e":1800000060}
```

Roughly 185 characters, which is a comfortably scannable symbol at a distance.
Fourteen characters saved twice over is the difference between a code the third
row can scan and one people have to walk up to: payload size drives module count,
and module count drives the distance at which a phone camera resolves it.

**What is not in it:** no People data, no email, phone or name, no location, no
admin token, no integration secret, no stream key, and no signing material. The
church id is not there either — it comes from the session row, which is what lets
a stopped display take effect immediately.

---

## 3. The session

`supabase/migrations/0059_attendance_checkin_sessions.sql`,
`lib/attendance/v2/checkin-session.ts`.

Prompt 6 minted a fifteen-minute QR on demand: tied to nothing, stoppable by
nothing. A screenshot taken at 10:05 still worked at 10:19, and a church that
realised a code had leaked could do nothing short of rotating a global signing
key and breaking every other church at the same time.

A session fixes both halves:

- the **signature** proves the server minted the token;
- the **session** proves the display is still running, and *that* half can be
  revoked in one statement by the person standing at the front.

`attendance_checkin_sessions` holds one active row per occurrence, enforced by a
**partial unique index** rather than a check-then-insert:

```sql
create unique index attendance_checkin_sessions_active_idx
  on public.attendance_checkin_sessions (service_occurrence_id)
  where status = 'active';
```

Two pastors pressing the button at the same moment both reach the insert, one
wins, and the loser reads the winner's row. Both see the same session, the same
rotation period, and therefore the same code — observed by
`tests/database/checkin-sessions.test.ts`.

Rotation is bounded at 15–120 seconds and clamped rather than trusted. A session
carries a hard `expires_at` derived from the occurrence's own
`checkin_closes_at_utc` plus a grace, so a display nobody remembers to stop still
stops.

---

## 4. Why the code is derived, not drawn

Two browser tabs, a projector that reloads, and a poll that arrives a second late
must all show the same code — otherwise a room sees one code while a phone is
told a different one is current.

So the code for a rotation window is a **pure function** of the signing key, the
session, and the window index:

```
windowIndex = floor(epochSeconds / rotationSeconds)
nonce       = HMAC(subKey("checkin.qr"), sessionId | windowIndex)[0..12]
shortCode   = base23(HMAC(subKey("shortcode"), sessionId | windowIndex | attempt))
```

Everyone computes it; nobody negotiates it. The window index is epoch-aligned, so
agreement needs no coordination at all.

The database row exists for exactly one reason: an HMAC cannot be inverted, so a
**typed** code needs a reverse lookup. `attendance_checkin_codes` is that lookup,
keyed on a unique `code_hash`, with a unique `(session_id, window_index)` that
makes concurrent pollers converge on one row.

`claim_attendance_checkin_code` takes an **array** of candidate hashes because
two live sessions can, very rarely, derive the same code — and the unique index
refuses that, correctly, since a typed code must resolve to exactly one session.
The caller offers four derivations and the function takes the first that lands.
If every one collides it returns `ok = false`, and **the display shows the QR
with no short code** rather than characters belonging to another church.

### Expiry and the grace window

```
windowEnd   = (windowIndex + 1) * rotationSeconds
acceptUntil = windowEnd + rotationSeconds        // one grace window
```

Without the grace, someone who raised their phone one second before the rotation
would be refused for a reason they could not have anticipated. One extra window
covers a scan already in progress and keeps a relayed code stale within a minute.

The expiry is **inside the signed body**, so a holder cannot extend it.

---

## 5. The short code

`lib/attendance/v2/short-code.ts`.

It exists because a camera is not universally available: a cracked lens, a denied
permission, a phone too old, a person who cannot hold a device steady, or someone
who would simply rather type. None of them should be told to find a staff member.

It is the **same capability** as the QR beside it — same session, same window,
same nonce, same expiry. Not a weaker fallback with a longer life, because a
longer-lived code is exactly the remote-attendance hole rotation exists to close.

### The alphabet

```
BCDFGHJKLMNPQRTVWXY3479      23 characters, 4.52 bits each
```

Every classic confusion pair is broken by **removing one side**, rather than
hoping a font distinguishes them on a projector at distance:

| Pair | Resolution |
| --- | --- |
| `0` / `O` | both removed |
| `1` / `I` | both removed — `L` survives alone |
| `2` / `Z` | both removed |
| `5` / `S` | both removed |
| `6` / `G` | `6` removed |
| `8` / `B` | `8` removed |
| `U` / `V` | `U` removed |

Vowels are gone as a consequence, with a second benefit: without `A`, `E`, `I`,
`O` or `U` the generator cannot accidentally produce a word a church would have
to explain on a screen at the front of a sanctuary.

**Seven characters — about 31.6 bits, roughly 3.4 billion codes.** Six would have
been 27 bits: enough against a rate-limited attacker guessing *one* church's
current code, but not comfortable against the other question — with many churches
displaying at once, what is the chance a blind guess lands on somebody's live
code? Seven puts that back where it belongs even at scale. Eight was rejected as
harder to read from the back of a room than the security gain justified.

Character selection uses **rejection sampling**, not modulo: 256 is not a multiple
of 23, so `byte % 23` would make the first three characters slightly more likely.
A small bias, but a free one to avoid.

### Nothing is substituted on input

Case is folded and separators are dropped. There is no `O` → `0` table and there
deliberately never will be: every character such a table would map is already
absent from the alphabet, so a substitution could only turn one person's typo into
a **different valid code** — quietly checking them into the wrong service instead
of telling them to look again.

### Storage

Only a **keyed** hash reaches the database:

```
code_hash = HMAC(subKey("shortcode"), code)
```

A 31-bit code under a plain SHA-256 is exhaustible on a laptop in seconds, so a
database copy would yield every live code. An HMAC under a key that is not in the
database does not. That is the entire reason for the distinction.

### Uniform failure

`redeem_attendance_short_code` returns an internal `reason` for the audit —
`unknown`, `window_closed`, `session_ended`, `malformed` — and the caller
collapses **every one of them** into a single `short_code_invalid`, whose message
is `"That code didn't work — check the screen and try again."`

Telling someone whether their guess was "expired" or "unknown" tells them whether
they hit a real code, which is the only feedback that makes searching a 31-bit
space worth attempting. `code_throttled` is deliberately distinct — it is the one
refusal where the person needs to know that waiting helps, and it reveals nothing
about any code.

Timing is **not** claimed to be constant. The lookup is a single unique-index
probe, so a hit and a miss differ by roughly one heap fetch. The defence against
guessing is the rate limit and the code space, not an unmeasurable timing
property.

---

## 6. The pastor's display

### Starting it

`app/dashboard/attendance/services/actions.ts` →
`components/attendance/checkin-display-panel.tsx`.

A staff member selects a service on the occurrence board and presses **Start
check-in display**. The action:

1. resolves the church from their own session (`getChurchAuth`);
2. calls `start_attendance_checkin_session`, which reads the church from the
   *occurrence* and compares it — a caller naming another tenant's occurrence
   gets `occurrence_not_found`, the same answer a non-existent one gets;
3. issues a one-time pairing code and shows it once.

### The projector problem

> Do not put an administrator session, service-role credential, or unrestricted
> dashboard cookie onto a public projector.

A dashboard session in a public room is an administrator account in a public
room. So the display machine **never signs in**.

```
Pastor's laptop                     Projector
──────────────                      ─────────
Start display  ──────────────────▶  (nothing yet)
     │
  reads "BCD-4G7J" aloud  ────────▶ opens /checkin/display
                                    types BCD-4G7J
                                         │
                                    POST /api/checkin/display/pair
                                         │
                                    ◀──── Set-Cookie: ff_checkin_display
                                          HttpOnly, SameSite=Strict,
                                          Secure, Path=/api/checkin
                                         │
                                    GET /api/checkin/display/frame
                                    every rotation
```

What ends up on the projector is a capability that can do exactly one thing: read
one occurrence's current code. It carries no user, no role, no church-wide
authority, and no ability to write anything. If the machine is stolen, the thief
has the ability to watch a code they could already see on the wall.

The pairing code is single-use, lives five minutes, and is stored only as a keyed
hash — so reading it over a shoulder afterwards pairs nothing. Two machines
typing it at the same moment race into one conditional `UPDATE ... RETURNING`, and
exactly one gets a capability.

**The cookie path is the blast radius.** `Path=/api/checkin` means the display's
capability is never sent to `/dashboard`, and `SameSite=Strict` means another
site cannot cause the browser to spend one.

What this does *not* solve, stated plainly: it cannot stop a dashboard session
existing in the same browser. Supabase's auth cookies are set at `/` and go
wherever the browser goes. What the pairing flow provides is the ability to run a
display on a machine that was **never signed in** — an operational instruction in
the runbook, not something this code can enforce.

### Recovering from a refresh

Three separate things had to be true, and all three are:

1. the capability is in a cookie, so a reload keeps it;
2. the code is derived from the rotation window rather than drawn when asked, so a
   reload lands on the code already on the wall instead of rotating it early and
   stranding everyone mid-scan;
3. the frame carries `rotatesAt`, so a machine that slept knows the code it holds
   is stale and fetches immediately rather than on a timer.

The QR image is embedded as a data URI rather than served from a second URL. A
code in a URL is a code in a browser history, a proxy log, and a referrer header —
and this one would be a live capability.

**Stopping the display is immediate.** The projector's next poll resolves the
session, finds it ended, and goes dark. Nothing already counted changes: a counted
fact is independent of the code that produced it, so stopping a display is not a
correction and does not touch attendance.

### Re-pairing without restarting

`refreshDisplayPairing` issues another pairing code for a session that is already
running. Needed more often than it sounds — the projector rebooted, the browser
was closed, someone opened the page on the wrong machine — and restarting the
session instead would rotate the code out from under a room mid-scan.

---

## 7. Submission and idempotency

`lib/mobile/v1/attendance-service.ts`.

```
POST /api/mobile/v1/attendance/attempt
Idempotency-Key: qr-scan-<32 hex>

{ "source": "qr", "qrToken": "FF1…" | "shortCode": "BCD4G7J",
  "scanAttemptId": "scan-<32 hex>" }
```

**The occurrence is not in the request.** A scanner does not know which service it
is pointed at — that is what the code is for — so the occurrence is read out of
the signed token or the short code's own row. A client that could name it could
scan the 9 a.m. code and have it counted against the 11 a.m. service.

Order of operations:

1. **Throttle** — before any lookup. 10 typed attempts per five minutes per
   account; 40 scans, because a camera catching a stale frame during a rotation
   legitimately retries. Atomic in SQL via `consume_api_rate_limit`, and it
   **fails closed**.
2. **Resolve the code** — signature, then expiry, then the session. Both halves
   must hold.
3. **Resolve the occurrence** from the code.
4. **Resolve the person** from their authenticated account and their active
   `visitor_people_links` row for that church. Never from the code, never from an
   email, a phone, a name, or a device.
5. **Record the scan** — audit only, gated on nothing.
6. **`record_attendance`** — the one command, same as manual, admin, geofence and
   kiosk.

### The token is not an identity

> Never derive authorization from the QR token alone. The token identifies an
> eligible check-in session; the authenticated visitor and People link identify
> the person.

Someone holding a perfectly valid code with no verified People link is refused
with `no_people_link`. The code says *which service*; the session says *who*.

### A displayed token is multi-use

Prompt 6 called `consumeQrNonce` and refused a second redemption. The first
person to scan the projector took the code, and the second person looking at the
same screen was told it had already been used. **A code on a screen is meant to
be used by the room.**

What stops one person being counted twice is the unique counted fact inside
`record_attendance` — one member, one occurrence — and it is unaffected by how
many codes that person scans. Redemption therefore moved to
`attendance_qr_scan_redemptions`, unique on
`(service_occurrence_id, account_id, nonce)`.

What that row buys, honestly: an audit trail of which rotating code a person
presented, and a cheap signal for one account working through many codes. It is
explicitly **not** the duplicate-count defence.

`attendance_qr_redemptions` and its global index are left exactly as 0055 wrote
them — additive migrations only — and are documented there as superseded.
`qr_replayed` stays in the vocabulary so existing attempt rows remain readable,
and `tests/security/checkin-authority.test.ts` asserts nothing produces it any
more.

### A fresh identity per scan

`scanAttemptId` is 16 random bytes, and the idempotency key is derived from it.
**Never from the token, the occurrence, or the account.**

Prompt 7 learned this the expensive way on the geofence path: a key derived from
stable inputs made a single early refusal permanent for the rest of the service,
because every subsequent attempt replayed the refusal instead of being judged. A
person who scans, is refused, fixes the problem and scans again must get a *new*
verdict — so a new tap is a new identity, and a retry of the same tap is not.

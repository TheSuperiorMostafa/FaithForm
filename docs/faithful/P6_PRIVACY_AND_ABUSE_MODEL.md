# Prompt 6 — Privacy and abuse model

## The principle

**Store attendance, not movement.**

A church needs to know who came on Sunday. It does not need a record of where
anyone was, and building one as a side effect of check-in would be a far larger
thing than the feature asks for.

## Consent

Automatic attendance requires `auto_attendance_consent = 'granted'` on the
visitor account (Prompt 3). Three properties matter:

- **`unset` is not consent.** Never having been asked is not agreement.
- **Revoking blocks new attempts immediately** — checked before the command is
  reached — and bumps `authorization_version`, so a cached client decision goes
  stale.
- **Revoking does not rewrite history.** Attendance counted while consent was
  active stays counted. It happened; withdrawing consent is not a claim that it
  did not.

Consent is separate from the visitor relationship and from the People link. All
three must hold for an automatic check-in, and each is checked independently.

## Location minimization

| Layer | What it holds |
|---|---|
| Counted fact | **no location at all** |
| Attempt | `distance_band`, `accuracy_band`, `dwell_seconds` |
| `precise_evidence` | short-lived, expiring, purged |
| Dashboard | never requests or collects visitor location |

`attendance_attempts` has **no latitude or longitude column** — asserted by
test. What it stores is a band: "inside", "high accuracy". That answers "why was
I not counted" without accumulating a record of how each phone sees the sky.

`precise_evidence` exists for the narrow case where a support question needs
more. It carries `evidence_expires_at`, defaults to 14 days (1–90 configurable),
and the daily purge job **empties the payload while keeping the attempt row** —
the verdict is the auditable part, the coordinates are not.

### The campus boundary is public — a correction

An earlier version of this section said the client is never told the campus
coordinates or radius, because telling it "turns 'am I inside' into a solvable
puzzle". **That was a mistake**, and it mixed up two unrelated things:

- **Configuration secrecy.** Not a control. A church's address is on its own
  website and in the public discovery projection this codebase already serves.
  Hiding the geometry protected nothing and made the feature unimplementable —
  an OS geofence cannot be registered without a centre and a radius.
- **Server-side validation.** The actual control, and it is untouched by
  publishing the boundary.

`/attendance/{slug}/geofence-config` now returns the geometry behind five gates
(active account, active relationship, verified People link, granted consent,
enabled policy with a public positioned campus), versioned against the account's
authorization version, bounded to 20 regions, and expiring on a deterministic
boundary — the next 15-minute revalidation bucket or the next check-in window
edge, whichever comes first.

**No integrity signature is returned, and that is deliberate.** An earlier
version emitted an HMAC `integrity` field described as detecting a tampered
cache. The client had no key to verify it with, the server never accepted it
back, and TLS already authenticates the transport — it implied a check that did
not exist. It was removed rather than renamed. `configVersion` identifies the
configuration; the ETag validates the cache; submitted evidence is validated
server-side. None of the three is offered as proof of presence.

**What is still private is the person, not the place.** The configuration
carries no member id, no account id, no contact detail, no role, and no
credential — asserted by test. A campus centre is a fact about a building. A
location trail is a fact about a person, and this system stores none.

The privacy rule below is unchanged and unweakened: **no continuous trails, no
permanent coordinates in a counted fact.**

## What a client may not assert

A client sends an *observation*. It cannot send:

- a member id — resolved from the verified People link
- a church id — resolved from the occurrence
- a distance — banded server-side
- a counted result — decided by the command
- a correction actor

Asserted against both the routes and the request schema.

## Spoofing — the honest limitation

**Ordinary GPS coordinates do not prove physical presence.** A determined person
can report whatever their device is willing to report. Nothing in this design
changes that, and it would be dishonest to imply otherwise.

Every control below is **server-side**. None of them depended on the client not
knowing where the boundary was, which is why publishing the configuration costs
nothing here:

| Control | What it costs an attacker | Where it runs |
|---|---|---|
| Distance banded against the *snapshotted* campus | a claimed position is judged against the server's coordinates, not the client's | `record_attendance` |
| Dwell + confirmation | a single spoofed callback is not enough | `record_attendance` |
| Accuracy band | an implausibly perfect fix is refused | `record_attendance` |
| Policy snapshot | a policy loosened later does not retroactively admit an old attempt | `record_attendance` |
| Window | attendance outside the service is refused | `record_attendance` |
| People link | an account must already be verified as a person | resolver, re-checked per request |
| Consent | and must have agreed | resolver, re-checked per request |
| Idempotency + unique fact | repetition gains nothing | unique index |
| Attempt audit | a pattern is visible after the fact | `attendance_attempts` |

An attacker who reads the configuration learns the church's address. They still
cannot send a member id, a church id, a distance, or a verdict — the server
computes all four. The configuration tells a client *what to watch*; it never
tells the server what to conclude.

`requiresConfirmation` and `minDwellSeconds` exist precisely so **one region
callback is never treated as unquestionable attendance**.

Extension points for stronger evidence — attestation, motion corroboration,
network signals — fit where `precise_evidence` and the band classifier sit,
without changing the counted fact. None is implemented, and none is claimed.

## QR security

- Signed, not stored: occurrence, church, purpose, nonce, expiry.
- Contains **no secret and no People data** — asserted by test.
- Church-bound: a code minted elsewhere is refused even though the signature is
  ours.
- Replay-proof by a unique index on `(occurrence, nonce)`, not by hoping.
- A weak or placeholder signing secret **refuses to sign at all** rather than
  producing a guessable code.
- Rotation never invalidates a counted fact — a redeemed nonce stays redeemed,
  and the fact is independent of the code.

Possessing a code lets you *attempt* attendance for one occurrence. It still
requires an authenticated account with a verified People link.

## Kiosk security

A restricted machine identity bound to one church and optionally one campus.
Deliberately weak: it may submit an attempt for a person the **server**
resolved, and nothing else.

- No staff role, no service-role authority, no People read.
- Only the hash is stored; a leaked backup yields nothing usable.
- Revocable, expirable, and swept by a cleanup job that **clears the hash** —
  a disabled row with a live credential is one bug away from being used.
- Email possession alone never identifies a person.

## Logging

No attendance module contains a single `console.*` call — asserted by test
across all eight.

Never logged: precise coordinates, People details, QR capabilities, kiosk
credentials, tokens, consent evidence. Job responses are **counts and a
duration**; a test asserts they contain no member, church, or location field.

## Visibility

A counted fact is visible to:

- **church staff** of that church, and
- **the account holding an active People link** to that member.

Nobody else — including other visitors of the same church. Enforced in RLS, not
only in a query.

## Deletion and export

Follows Prompt 3's ownership boundary: an account owns its *relationship*, not
the church's record of a person.

- Account deletion revokes the People link with an audit row.
- **Attendance history is not deleted.** It is church-owned operational history;
  erasing it would remove the church's record of who was at its services.
- Export shows the account's own attendance where a link is active.

## Provisional — not decided here

These are product and legal decisions, and this document records them as open
rather than inventing an answer:

1. **How long attendance history is kept.** Currently indefinite.
2. **Whether a person may ask for their attendance to be removed**, and whether
   the church may refuse.
3. **Minors and automatic attendance** — out of scope in Prompt 3, and unchanged
   here.
4. **Whether a reversed fact should ever be purged**, or remain permanently
   auditable.
5. **What a church may see about a rejected attempt** — currently the verdict
   and the bands.
6. **Jurisdictional treatment of location-derived attendance**, which differs by
   region and needs review before any real geofence deployment.

No compliance claim is made for any regime.

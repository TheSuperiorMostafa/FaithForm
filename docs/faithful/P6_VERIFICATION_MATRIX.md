# Prompt 6 — Verification matrix

**Six layers, kept separate and not conflated.**

| Layer | Status |
| --- | --- |
| **A — Source completion** | ✅ Complete |
| **B — Local build and test** | ✅ Web, iOS, Android all built and tested here |
| **C — Database execution** | ✅ **Partial — migrations executed and concurrency observed under two real connections.** Full Supabase rehearsal and the RLS matrix remain pending |
| **D — Non-production / legacy reconciliation** | ⛔ Pending — no real legacy data inspected |
| **E — Production cutover** | ⛔ Pending — nothing deployed |
| **F — Native client / real location** | ⛔ Pending — **Prompts 7–8 own the clients; no geofence has ever fired** |

A ✅ means a test ran and passed **on this machine**. Layer C's ✅ is now backed
by a database that actually executed the DDL and ran the functions; it is still
not a Supabase rehearsal, and no phone has ever detected a region.

## Gate results

| Gate | Result |
|---|---|
| `pnpm ci:verify` | ✅ exit 0 |
| ├ lint | ✅ 0 errors (47 warnings, all pre-existing) |
| ├ typecheck | ✅ |
| ├ contract freshness | ✅ 3 artifacts current |
| ├ design tokens | ✅ 22 contrast pairs pass WCAG |
| ├ localization parity | ✅ 86 shared keys, 3 documented Android-only |
| ├ tests | ✅ **437/437** |
| ├ migration baseline | ✅ 59 legacy migrations verified |
| ├ secret scan | ✅ 1034 files |
| └ production build | ✅ |
| `pnpm test:concurrency` | ✅ **11/11 against real Postgres 17** |
| `pnpm ios:test` | ✅ **103/103**, 12 suites |
| `pnpm android:test` | ✅ **53/53**, 0 failures (requires JDK 17 — see below) |
| `pnpm android:build` | ✅ debug APK |
| `pnpm audit:prod` | ✅ 0 unresolved high/critical |
| `pnpm contract:check` | ✅ 3 artifacts current |
| `git diff --check` | ✅ clean |

The Android gates need **JDK 17**. This machine's default JVM is Java 8, and the
Android Gradle Plugin refuses to configure under it — `JAVA_HOME` must point at
a 17+ runtime (`/opt/homebrew/opt/openjdk@17` here). CI pins `temurin` 17
explicitly, so this is a local-environment note rather than a build defect.

`pnpm typecheck` additionally required `@types/pg`, added as a dev dependency
when the database suite landed. The failure was real and the fix was the types,
not a loosened `tsconfig`.

**Total: 604 automated tests** (437 web + 11 database + 103 Swift + 53 Kotlin).
No Prompt 2–5 test was weakened or removed; the web suite grew 365 → 437.

## The geofence contract, after the correction pass

### Expiration algorithm

```
expiresAt = min(
  (floor(now / 15min) + 1) * 15min,   -- next epoch-aligned revalidation boundary
  earliest checkinOpensAt or checkinClosesAt strictly after now
)
```

Deterministic **within an epoch-aligned time bucket and the relevant
attendance-window state**. `now` selects the bucket, so the value is not
independent of `now`; what it does not do is move on every request. It changes
only at predictable boundaries — a 15-minute bucket edge or a check-in window
edge — and is always strictly in the future, including for a request landing
exactly on one.

### Exact ETag input

```
computeEtag({ church: <path slug>, data: <the entire response body> })
```

The **whole body**, not a hand-picked subset — `configuration` (with
`expiresAt`) or `{configuration: null, refusalReason, message}`. A subset has to
be maintained in step with the payload, and the original bug is exactly what
happens when it drifts. Strong validator; `private, must-revalidate`.

### The property this buys

> A 304 is only ever served while the client's cached `expiresAt` is still in
> the future.

Previously false: `expiresAt` was `now + 30 min` and excluded from the
validator, so a client revalidating an **expired** configuration received a 304,
no body, and therefore no new expiry — permanently stuck. Now executed over 480
issue/revalidate pairs.

### `integrity`: removed, not renamed

The client held no key to verify it, the server never accepted it back, and TLS
already authenticates the transport. It implied a check that did not exist.
`configVersion` identifies the configuration, the ETag validates the cache, and
submitted evidence is validated server-side. `ATTENDANCE_CONFIG_SECRET` is no
longer read by anything.

Removed from: the service, the route, the Zod contract, `schema.json`,
`Contract.swift`, `Contract.kt`, and all three fixtures — each asserted.

### Stale artifacts fail CI — proven, not assumed

Injecting an `integrity` field into `contracts/faithful/v1/schema.json` and,
separately, into `Contract.swift` each made `pnpm contract:check` exit 1. Both
were restored byte-identical.

## Layer C — database execution ✅ partial

### What actually ran

`pnpm test:concurrency` stands up a disposable Postgres 17, applies
`tests/database/fixtures/bootstrap.sql`, then **migrations `0055` and `0056`**,
then races two real connections against them.

```
applied tests/database/fixtures/bootstrap.sql
applied supabase/migrations/0055_attendance_authority.sql
applied supabase/migrations/0056_attendance_batch.sql
✔ two connections marking the same person produce exactly one fact
✔ mixed sources racing the same person still produce one fact
✔ a repeated idempotency key returns the first result, not a second fact
✔ two connections running the same batch produce one fact per person
✔ a duplicate person in one batch yields one result row and one fact
✔ a batch mixing new and already-counted people commits both
✔ a member from another church is rejected without affecting the rest
✔ an oversized batch rolls back entirely
✔ an unknown occurrence rolls the whole batch back
✔ concurrent generators create no duplicate occurrences
✔ DST is resolved from the zone, not a fixed offset
ℹ tests 11 · pass 11 · fail 0
```

Registered as a CI job (`attendance-concurrency`) against a `postgres:17`
service container, so it runs on every push rather than only when someone
remembers.

### This is why executing beats inspecting

**Running it found a real TOCTOU race that source inspection had missed.**

Two connections submitting the same idempotency key — which is exactly what two
concurrent batches do — both passed the idempotency check in step 2, then
collided on `attendance_attempts_idempotency_idx`, aborting the whole
transaction. The fix is `on conflict do nothing` plus a re-read of the winner's
row.

The suite is **verified to catch it**: reverting that one line and re-running
against a fresh database fails exactly `two connections running the same batch
produce one fact per person`, and passes again when restored. The claim below is
therefore observed, not inferred.

### What the ✅ does *not* cover

`bootstrap.sql` creates only the objects `0055`/`0056` reference. It is
**not a migration rehearsal**:

| Still unverified | Why |
|---|---|
| The full 58-migration chain applies in order | bootstrap is a minimal surface, not the real history |
| RLS matrix — 10 principals × 8 tables | needs real Supabase roles and JWT claims |
| PostgREST exposure of the new functions | needs a Supabase project |
| Evidence purge over aged rows | needs data with real timestamps |
| Query plans | no `EXPLAIN` has run |

## Completion gates

| # | Gate | Evidence | Result |
|---:|---|---|---|
| 1 | Occurrences snapshot campus, schedule, timezone, windows, policy | migration test — 8 columns asserted | ✅ |
| 2 | Multiple same-day services work | identity is `(service_time_id, starts_at_utc)` | ✅ |
| 3 | Every source converges through one command | only one caller of `record_attendance` | ✅ |
| 4 | **DB enforces one counted fact per occurrence/member** | `attendance_facts_unique_idx` | ✅ |
| 5 | The index is not partial | asserted — a partial one would double-count on restore | ✅ |
| 6 | **Concurrent mixed-source attempts cannot double-count** | **executed — two connections, four sources** | ✅ |
| 7 | Idempotent retries | **executed** | ✅ |
| 8 | Attempt and fact commit together | one PL/pgSQL function | ✅ |
| 9 | A rejected attempt is still recorded | asserted by index position | ✅ |
| 10 | `members.id` remains the People identity | no second identity created | ✅ |
| 11 | Self check-in requires a verified People link | `visitor_people_links` + `is_active` only | ✅ |
| 12 | Email/phone/device/coords establish nothing | asserted — resolver consults none of them | ✅ |
| 13 | Blocked or departed relationship refused | asserted | ✅ |
| 14 | Automatic attendance requires granted consent | `unset` is not consent | ✅ |
| 15 | Revoked consent blocks new attempts, keeps history | checked before the command | ✅ |
| 16 | Corrections audited and non-destructive | append-only; no delete anywhere | ✅ |
| 17 | Reversal is a state, restore flips the same row | asserted | ✅ |
| 18 | Re-applying a correction is a no-op | asserted | ✅ |
| 19 | Cancelled occurrence refuses new attendance | asserted | ✅ |
| 20 | Cancelling leaves counted facts alone | no fact write in the cancel path | ✅ |
| 21 | Legacy tables never altered or written | asserted across migration and all modules | ✅ |
| 22 | Aggregate `attendance` table not adopted | asserted twice | ✅ |
| 23 | Legacy ambiguity reported, not guessed | `resolution = 'ambiguous'` | ✅ |
| 24 | Backfill idempotent and reversible | mapping table; dry-run default | ✅ |
| 25 | Sunday-only removed from the new workflow | occurrence board, any day | ✅ |
| 26 | Legacy history still reachable | `(record)/[date]` untouched | ✅ |
| 27 | **Bulk marking uses the same command** | `record_attendance_batch` delegates; writes no row itself | ✅ |
| 28 | **Bulk is per-person idempotent** | `batch_key || ':' || member_id` — **executed** | ✅ |
| 29 | **Bulk leaves no partial state** | one transaction — **rollback executed** | ✅ |
| 30 | **Bulk is bounded** | 1000, in TypeScript *and* SQL — **executed** | ✅ |
| 31 | **A duplicate person in one batch counts once** | **executed** | ✅ |
| 32 | **Mixed already-counted/new commits both** | **executed** | ✅ |
| 33 | **A wrong-tenant member is rejected without rolling back the rest** | **executed** | ✅ |
| 34 | **Two concurrent batches produce one fact per person** | **executed** | ✅ |
| 35 | Corrections require admin | `requireCorrectionRights` | ✅ |
| 36 | No admin action accepts a `churchId` | asserted | ✅ |
| 37 | Staff writes carry exact church predicates | asserted | ✅ |
| 38 | **DST resolved by Postgres, not offsets** | **executed** — 10:00 EST = 15:00Z, EDT = 14:00Z | ✅ |
| 39 | Generation idempotent and bounded | `do nothing` + 400-day cap | ✅ |
| 40 | **Concurrent generators safe** | **executed** | ✅ |
| 41 | Policy defaults are safe | geofence/QR/kiosk **off** | ✅ |
| 42 | Contradictory policies refused by the DB | 3 check constraints | ✅ |
| 43 | Policy snapshot beats live policy | attempts judged against the snapshot | ✅ |
| 44 | Attempts store bands, not coordinates | no lat/long column — asserted | ✅ |
| 45 | Counted fact carries no location | asserted | ✅ |
| 46 | Evidence expires and is purged | purge empties payload, keeps row | ✅ |
| 47 | QR signed, church-bound, replay-proof | unique `(occurrence, nonce)` | ✅ |
| 48 | QR carries no secret or People data | asserted | ✅ |
| 49 | QR rotation never invalidates a counted fact | nonce independence | ✅ |
| 50 | Weak QR secret refuses to sign | asserted | ✅ |
| 51 | Kiosk credential hashed, revocable, bounded | asserted | ✅ |
| 52 | Kiosk grants no staff/service-role authority | no such path exists | ✅ |
| 53 | Mobile client cannot send member/church/result | asserted on routes **and** schema | ✅ |
| 54 | **Geofence configuration is authorized behind five gates** | asserted — account, relationship, People link, consent, policy | ✅ |
| 55 | **Configuration refuses a hidden, inactive or unpositioned campus** | asserted | ✅ |
| 56 | **Configuration is bounded** | 20 regions, 50 windows, 7-day horizon | ✅ |
| 57 | **The ETag covers every semantic field, including `expiresAt`** | executed — each field flipped in turn must change the tag | ✅ |
| 58 | **`expiresAt` is deterministic, not `now + TTL`** | executed — two arrivals in one bucket agree | ✅ |
| 59 | **`expiresAt` is always strictly in the future** | executed, including exactly on a bucket edge | ✅ |
| 60 | **`expiresAt` clamps to the next check-in boundary** | executed | ✅ |
| 61 | **Revalidating before expiry yields 304** | executed | ✅ |
| 62 | **Revalidating after expiry NEVER yields 304** | executed over 480 issue/revalidate pairs | ✅ |
| 63 | **Configuration unchanged but expiry changed is a 200** | executed | ✅ |
| 64 | **A changed `configVersion` changes the validator** | executed | ✅ |
| 65 | **Revocation reaches the client — granted → refusal is a 200** | executed | ✅ |
| 66 | **Access returning is a 200, so the client re-registers** | executed | ✅ |
| 67 | **Two churches refusing alike do not share a validator** | executed | ✅ |
| 68 | **Switching churches re-derives every gate** | asserted — relationship, link and consent all resolved from the path slug | ✅ |
| 69 | **A 304 carries the validator and no body** | executed | ✅ |
| 70 | **The ETag is strong, and the response is `private, must-revalidate`** | executed | ✅ |
| 71 | **The `integrity` field is REMOVED from the contract** | executed across service, route, schema, Swift, Kotlin and fixtures | ✅ |
| 72 | **No configuration signing secret is read any more** | `ATTENDANCE_CONFIG_SECRET` unreferenced | ✅ |
| 73 | **Configuration carries no People, staff or credential data** | asserted against the comment-stripped schema | ✅ |
| 74 | **Submitted coordinates are validated server-side against the snapshot** | asserted | ✅ |
| 75 | **Stale generated artifacts fail CI** | **proven** — a field injected into `schema.json` and into `Contract.swift` each exited 1 | ✅ |
| 76 | **All three languages decode the same geofence fixtures** | executed — TypeScript, Swift and Kotlin | ✅ |
| 77 | Attempts require an idempotency key | asserted | ✅ |
| 78 | A person's attendance visible to them + staff only | RLS policy asserted (**not executed**) | ⚠️ |
| 79 | Every SECURITY DEFINER pins `search_path` | asserted, and both migrations executed | ✅ |
| 80 | Command, batch and corrections are service-role only | asserted | ✅ |
| 81 | Jobs are protected, bounded, overlap-safe | `CRON_SECRET`, idempotent generation | ✅ |
| 82 | Job responses leak nothing | asserted on comment-stripped source | ✅ |
| 83 | No attendance module logs anything | asserted across all 9 | ✅ |
| 84 | Reporting aggregates in SQL | `count(*) filter` + `jsonb_object_agg` | ✅ |
| 85 | Lists bounded with stable cursors | `listOccurrences`, limit ≤50 | ✅ |
| 86 | Indexes match exact filters and orders | 8 asserted | ✅ |
| 87 | **No native geofence/background location** | forbidden-symbol sweep over the walked native tree, **proven to bite** | ✅ |
| 88 | Native attendance capability not enabled | asserted — not in `ENABLED_CAPABILITIES` | ✅ |
| 89 | No livestream/sermon/giving touched | forbidden-symbol sweep | ✅ |
| 90 | Prompt 2–5 gates green | 365 → 437, none removed | ✅ |
| 91 | **Full migration chain rehearsal** | — | ⛔ |
| 92 | **RLS matrix executed against real roles** | — | ⛔ |
| 93 | **Query plans measured** | — | ⛔ |
| 94 | **Legacy reconciliation on real data** | — | ⛔ |

⚠️ Gate 78 is written and asserted in source, but RLS cannot be *exercised*
without real Supabase roles and JWT claims. It is not counted as observed.

## Test inventory

| Suite | Count |
|---|---:|
| Web | **437** |
| ├ `attendance-authority-migration` | 36 |
| ├ `attendance-sources` (QR, kiosk, results) | 16 |
| ├ `attendance-authorization` | 26 |
| ├ `attendance-geofence-config` | 42 |
| ├ `attendance-bulk` | 23 |
| ├ `mobile-contract` (incl. 6 geofence fixture tests) | 34 |
| ├ Prompt 2–5 suites | 260 |
| Database (real Postgres) | **11** |
| iOS (`swift test`) | 103 |
| Android (`gradlew test`) | 53 |
| **Total** | **604** |

## A correction carried into this matrix

An earlier revision of these documents claimed that withholding the campus
coordinates and radius from the client was an anti-spoofing control. **It was
not**, and the claim has been removed from `P6_ATTENDANCE_ARCHITECTURE.md` and
`P6_PRIVACY_AND_ABUSE_MODEL.md`.

A church's location is public — it is on the church's own website and in the
public discovery projection this codebase already serves. Hiding it protected
nothing and made an OS geofence impossible to register. The boundary is now
served deliberately by `/attendance/{slug}/geofence-config`, behind
authorization, and **the anti-spoofing control is and always was server-side
validation of submitted evidence against the occurrence's own snapshot.**

Gate 49 in the previous revision read "Capability withholds coordinates and
radius". That gate has been replaced by gates 54–63, which describe the
authorization around a configuration that is deliberately served.

## Layer D — legacy reconciliation ⛔

No real legacy data has been inspected. `preflight`, `backfill` (dry-run by
default) and `reconcile` are implemented and unit-tested against source, but:

- No duplicate church/date has been found or resolved with a church.
- No ambiguity has been adjudicated.
- No totals have been compared.
- Per-person history, report parity and follow-up queue parity are **unverified**.

## Layer E — production ⛔

Nothing deployed. Two cron entries (`attendance/generate`, `attendance/cleanup`)
are registered in `vercel.json` and have **never run on a schedule**.
`ATTENDANCE_QR_SECRET` is unset, so QR minting currently refuses rather than
degrading to a weak secret. `ATTENDANCE_CONFIG_SECRET` no longer exists — the
configuration signature it fed was removed from the contract.

## Layer F — native client and real location ⛔

**Prompts 7 and 8 own the clients.** This prompt implements no region
monitoring, no `GeofencingClient`, no background execution, no permission
screens, and no QR scanning — asserted by a forbidden-symbol sweep over a walked
native source tree.

That sweep previously scoped itself with `git ls-files apps/`, which returned
**zero files** because `apps/` is not committed — it passed by checking nothing.
It now walks the directory, excludes build output, and is verified to fail on an
injected `ACCESS_BACKGROUND_LOCATION`.

**No geofence has ever fired.** The dwell, accuracy and confirmation logic has
never seen a real device, a real building, or a real GPS fix.

## Explicitly not claimed

- **No geofence readiness.** The backend is implemented and the configuration
  endpoint is authorized; no location has been observed, and ordinary
  coordinates do not prove presence.
- **No migration readiness.** `0055` and `0056` executed against a *minimal
  bootstrap*, not against the real 58-migration chain or a Supabase project.
- **No RLS verification.** The policies are written and asserted in source; no
  role has been impersonated.
- **No legacy reconciliation.** No real history has been backfilled or compared.
- **No performance claim.** Zero query plans measured.
- **No production or non-production readiness.**
- **No compliance claim** for attendance or location data in any jurisdiction.

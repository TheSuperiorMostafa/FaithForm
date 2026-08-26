# Prompt 9 — Privacy, Security and the Abuse Model

*What each actor can reach, what is stored, what is logged, and where the honest
limits are.*

---

## 1. What each holder can do

| Holder | Reaches | Lifetime | Revoked by |
| --- | --- | --- | --- |
| A signed-out visitor | `public`-visibility published items, list and detail only | — | making them non-public |
| A signed-in visitor | items targeted at their relationship, plus playback | — | unpublish, revoke, block, or leaving |
| A playback capability | one account, one church, one item, one kind | **5 minutes** | revocation, unpublish, or an authorization-version bump |
| A staff member | publishing for their own church | their session | removing their admin role |
| The relay credential | the relay's HLS origin | — | rotating `STREAM_RELAY_PLAYBACK_SECRET` |

Nothing here is permanent, nothing is a login, and no capability carries a role.

---

## 2. Visibility, exhaustively

Every projection applies the same five filters **structurally, in SQL**, so a
caller cannot forget one:

```sql
and r.status = 'ready'                   -- a processing file is unplayable
and r.mobile_visibility <> 'none'        -- nobody published it
and r.mobile_published_at is not null    -- belt to the same braces
and r.mobile_unpublished_at is null      -- someone took it down
and ( … relationship targeting … )       -- published to a narrower audience
```

| Caller | Sees |
| --- | --- |
| `blocked` | **nothing at all** — not even public items |
| no relationship / `left` | `public` only |
| `pending` | `public` only |
| `following` | `public` + `followers` |
| `joined` | `public` + `followers` + `members` |

A block is *felt*, not merely limiting — the same rule Prompt 5 chose for the
announcement feed, and for the same reason.

### Hidden, unknown and blocked are one answer

A hidden church, an unknown slug and a blocked visitor all produce
`church_not_found`. Distinguishing them would turn the API into a
church-existence oracle. A database test asserts the row counts are equal.

### The detail route re-checks everything

A device holding a list cached from before an unpublish must not be able to open
the detail page by id. `mobile_media_detail` applies every filter the list did,
rather than assuming the id was legitimate because a list once contained it.

---

## 3. What the projections never return

| Never returned | Where it lives instead |
| --- | --- |
| `storage_path` | only `mobile_media_playback_grant`, to a service-role caller |
| A signed storage URL | created for 60 s inside the delivery route, used, discarded |
| The relay stream path | `getStreamRelaySettings`, server-side only |
| The relay credential | assembled in `relay-upstream.ts`, attached outbound, never returned |
| Internal recording status, trim values | not selected by any projection |
| View counts, viewer keys | not in the media contract at all |
| Provider identifiers | none exist in the contract |
| Container, video codec, audio codec | `stream_recordings.mobile_rendition_*`, read by the dashboard and by support |
| H.264 profile/level, AAC profile, sample rate, channels | the same columns. RFC 6381 codec strings, for support |
| The object's ETag, version id and window hash | the same columns, and the grant row — never a visitor DTO |
| Why a recording is ineligible | the same columns. A visitor sees absence, never a reason |
| The object's size | recorded for support; not projected |

Asserted three ways: a sweep over the projection source, a sweep over the SQL
function bodies, and a JSON-Schema sweep over the four media definitions.

The last three rows are the eligibility gate (`P9_MEDIA_ELIGIBILITY.md`). An ineligible recording is not
labelled to a visitor, it is **absent** — from the list, from search, from
detail, and from the playback grant. Even the staff-facing copy names no codec,
brand, bucket or path; a fourcc tells a pastor nothing they can act on. The
machine-readable reason stays on the row, where support can read it.

---

## 4. Capability replay

| Attack | Refused by |
| --- | --- |
| Another account's capability | `a` claim, checked against the presenting account |
| Another church's capability | `c` claim, checked against the path |
| Another item's capability | `m` claim, checked against the path |
| A live capability for a recording | `k` claim |
| A website `?cap=` replayed at a Faithful route | a different derived sub-key — it does not verify |
| A Faithful capability replayed at the website route | the same, in reverse |
| An expired capability | `e`, checked before any content is read |
| A capability held across a revocation | `authorizeDelivery` re-checks on **every** request |
| A capability held across a sign-out or a block | `av`, the authorization version at issuance |
| A forged or tampered capability | constant-time HMAC over the whole signed prefix |

---

## 5. What is never logged

> No provider URL, signing key, raw path, playback capability, or internal ID in
> client-visible logs or errors.

1. **`lib/media/v1/playback-capability.ts` writes to the console at all** —
   asserted. It is the one file that handles every key.
2. **Every `console.*` call across the thirteen server media files** is parsed,
   and its arguments must not mention a capability, a token, a signed URL, a
   storage path, a URL, or a secret.
3. **No native media file uses a logging call** — `print`, `NSLog`, `Log.d/i/e/w`,
   `println`. The frame and segment paths in particular are silent.
4. **No client-visible error body** contains `supabase`, `http`, `bucket`,
   `relay`, `mediamtx`, `upstream`, or `://`. An upstream error body is never
   forwarded: only the class of failure crosses back.

---

## 6. What is stored, and for how long

| | Where | Retention |
| --- | --- | --- |
| Publication state | `stream_events` / `stream_recordings` columns | with the row |
| Publication audit | `stream_media_publication_audit` | indefinite, append-only |
| View counts | `media_views` (existing, 0047) | as before |
| Resume positions | **the device only** | 20 entries, 30 days, purged on sign-out |
| Playback capability | nowhere | 5 minutes, in memory |

### Resume positions are device-local by design

A server-held position would be a per-person, per-recording, cross-device record
of what someone watched and how far they got — person-level viewing analytics
under another name, which this prompt forbids adding.

The requirement is "resume on the same device". **There is no server endpoint for
resume, and none should be added.** Positions are bounded, partitioned by
`environment | account | church | authorizationVersion`, purged on sign-out and
unreachable after any authorization change.

A live edge is never stored: `ResumePolicy.shouldStore` returns false for `live`
before it checks anything else.

### View counting reuses what exists

`media_views` (migration 0047) already stores `kind`, `source` — with `app`
already permitted — and an opaque `viewer_key` whose column comment says it is
"never an IP address and never joinable back to a person". Writes go through the
service role so a visitor cannot inflate a count.

Faithful reuses it unchanged. No new table, no per-person watch history, and no
identifier derived from an account.

---

## 7. Rate limits

| Path | Budget |
| --- | --- |
| Playback grant / refresh | 60 per 5 minutes, per account |

The design rate is one refresh per minute per item, so this is an order of
magnitude above legitimate use and far below anything that would let one account
farm capabilities for an item it is about to lose access to.

`checkRateLimit` settles the count inside one SQL statement and **fails closed**.

List and detail routes are not separately limited; they are revalidated with
ETags and are cheap, and the existing per-route protections apply.

---

## 8. Cache and ETag correctness

- **Semantic ETags** over the response's own fields — never a timestamp, so two
  servers with clock skew agree and an unchanged payload keeps its tag across a
  deploy.
- **Relationship scope** is folded in, because the same church at the same
  version shows different things to a follower and to a stranger.
- **`Vary: Authorization, Accept-Encoding`** on every response.
- **`private, no-cache, must-revalidate`** on lists and details;
  **`no-store`** on the capability route, which carries no ETag at all — a
  credential must never be revalidated out of a cache.
- **Cursors carry a kind** (`media-archive`), so a feed cursor cannot page the
  archive and vice versa.
- **Selective invalidation**: the version triggers bump only on fields a device
  renders. A syndication retry, an encoder handshake, a trim value or a website
  `visibility` change moves nothing — proven by a database test that changes five
  such columns and asserts the version is unmoved.

---

## 9. Abuse cases considered

| Case | Outcome |
| --- | --- |
| Enumerating recording ids | every refusal is `not_found`; nothing distinguishes a real id from a fabricated one |
| Enumerating churches | hidden, unknown and blocked are one answer |
| Harvesting private titles through search | search runs after the publication filter, in SQL; a database test searches the exact private title and gets nothing |
| Sharing a delivery URL | it carries no credential and is useless without a header |
| Sharing a capability | 5 minutes, one account, one item — and the delivery route re-checks the account's authorization on every request |
| Keeping a copy after an unpublish | the archive is proxied, never redirected; no signed provider URL ever reaches a device |
| Downloading for offline use | no download API exists in either app; swept and proven to bite |
| Inflating view counts | writes go through the service role and are idempotent per viewer key |
| A church publishing another church's recording | exact tenant predicate on every write; a database test tries it |
| A revoked visitor continuing to watch | next range request is refused; next refresh is refused |

---

## 10. What is **not** claimed

**Signed playback is not DRM.** It decides who may fetch bytes. It does not
prevent screen recording, does not prevent a camera pointed at a screen, and does
not prevent someone re-encoding what they legitimately received. Nothing in the
product or these documents says otherwise.

**Revocation is bounded, not instantaneous.** A range request in flight
completes. A refresh happens within about a minute. Segments already buffered
play out. The honest figure is "about a minute", and that is what the dashboard
tells a pastor.

**The parser treats every recording as attacker-controlled**, because it is: the
relay uploads whatever is on its disk, and a compromised relay box or a mis-aimed
`upload-recording.sh` can put an arbitrary file at a storage path. Every walk is
bounded in depth (8), in box count (4 096) and in bytes (1 MiB head, 4 MiB tail,
8 MiB per container box); the walk is iterative rather than recursive, because a
stack is not a bound anyone chose; every declared length is range-checked before
it is used; a 64-bit box size is refused rather than truncated to its low word;
and an MPEG-4 expandable length is capped at four bytes rather than followed.
Every storage request carries an abort timeout. A structure that violates any of
this produces a refusal — never an exception, a hang, or an allocation.

**Playability is proved from the object, not promised for a device.** The gate
reads the container and the sample-entry fourccs and refuses anything it cannot
prove both platforms decode. It does **not** parse H.264 profile and level, so a
technically-conformant 4K Main 5.2 file passes the gate and may still stutter on
an old phone. It has **never been run against a real recording from a real
service**: every test drives byte structures built in the tests, and the identity
comparison has never seen a real provider's ETag. That is a device-runbook step —
26i and 26j–26o — not something this work observed.

**A verdict is bound to an object, and the binding has limits.** The hash covers
the inspected window rather than the whole file, so a change confined to the
middle of a recording is caught by content length rather than by the hash.
`If-Match` is sent on every delivery request but a provider is not obliged to
honour it, which is why the response is checked as well. A provider that
advertises no validator at all is refused rather than trusted.

**The relay webhook has no replay protection.** `recording-complete` verifies a
shared secret and proves the file exists, but carries no timestamp or nonce.
Prompt 9 does not modify it, so this is recorded as pre-existing rather than
fixed. A replayed call re-creates a row for a file that does exist, in the
correct church — an idempotency gap, not an authorization one — and the
duplicated row is invisible to visitors until a human publishes it.

---

## 11. Scope exclusions, honoured

Not implemented, and asserted absent where a symbol can express it:

| Excluded | How |
| --- | --- |
| Offline downloads | `AVAssetDownloadTask`, `AVAssetDownloadURLSession`, `DownloadManager`, `DownloadService` swept; no `media3` download artifact |
| Casting | `GCKCastContext`, `MediaRouter`, `RemotePlaybackClient` swept; no `media3-cast` |
| WebView player | `WKWebView`, `SFSafariViewController` swept |
| Chat, comments, user-generated content | no surface added; `CommentComposer` swept |
| Donations, payments | `StoreKit`, `SKPayment`, `BillingClient`, `PaymentSheet` swept |
| Ads, analytics tracking | no dependency added; `AD_ID` swept |
| Sermon Builder archive | untouched — Prompt 10 |
| Person-level viewing analytics | no resume sync, no watch history, no new table |
| New permissions | none added; the manifest and Info.plist are unchanged by Prompt 9 |
| A transcoder | `ffmpeg`, `fluent-ffmpeg`, `MediaConvert`, `Transcoder`, `transcode` swept over the media path **and** `package.json`. The gate reports; it never re-encodes |

Prompt 7's scope guard listed `AVPlayer` and `ExoPlayer` as out of scope because
playback was Prompt 9's work. That boundary moved and the list moved with it —
**replaced by something stricter**: playback is reachable from exactly one
adapter per platform, no capture, download, cast or WebView surface exists, and
no capability ever enters a URL.

# Prompt 9 — Secure Playback

*How a phone gets permission to watch something, how the bytes reach it, why
the capability never appears in a URL — and the one narrower token that must.*

---

## 1. The two capabilities, and why there are two

| | Website (`lib/stream/playback.ts`) | FaithForm (`lib/media/v1/playback-capability.ts`) |
| --- | --- | --- |
| Bound to | church, event, audience | **account**, church, kind, media item, authorization version |
| Lifetime | 10–15 min, quantized to a 5-min bucket | 5 min, exact |
| Travels in | `?cap=` query string | `Authorization: Bearer` header |
| Signed with | `STREAM_PLAYBACK_SECRET`, raw | the same secret, through a **derived sub-key** |
| Serves | live only | live **and** recordings |

Prompt 2's capability is not account-scoped because the website's player is not
signed in — a visitor watching a livestream on a church's site has no account.
That is correct there and it stays.

FaithForm's visitors *are* signed in, their access depends on a relationship a
church can revoke, and what they may watch depends on a publication decision a
pastor makes. None of that is expressible in a capability that names only a
church and an audience.

### Domain separation

```
subKey = HMAC-SHA256(STREAM_PLAYBACK_SECRET, "faithform.faithform.media.v1|playback")
```

Both capabilities are signed with the same secret, and **neither can verify as
the other**, because the derivation makes the two keys computationally
unrelated. Sharing the secret is deliberate: it introduces no new deployment
variable, and the separation comes from the derivation rather than from where
the bytes are stored. A test asserts the cross-check in both directions.

### The token

```
FFM1.<payload-b64url>.<signature-b64url>

{"v":1,"t":"playback","a":"<account>","c":"<slug>","k":"recording",
 "m":"<media>","av":3,"e":1800000300}
```

`av` is the account's authorization version at issuance. Any event that bumps it
— a revoked relationship, a sign-out, a block — makes **every capability already
in flight** stop verifying, without needing to find and revoke each one.

Verification order is shape, then signature, then contents. Nothing inside the
payload is read until the signature over it has been proven.

### The delivery token (live only)

```
FFD1.<payload-b64url>.<signature-b64url>

{"v":1,"t":"delivery","a":"<account>","c":"<slug>","k":"live",
 "m":"<event>","av":3,"e":1800021600}
```

A live grant carries this beside the capability, and the live delivery URL
carries it **in its path** (§2 says why). It is signed under its own sub-key
(`…|delivery`) and prefix, so a delivery token never verifies as a capability
and a capability never opens a delivery path — tests assert both directions.
It lives six hours rather than five minutes, because every playlist and segment
URL the player derives inherits it and HLS forbids those from changing mid-stream
(RFC 8216 §6.2.2). What stops it outliving permission is not its expiry: the
delivery route keeps re-authorizing while the stream plays (see below), bound to
the authorization version, so a sign-out refuses the next segment and a
revocation or an ended service stops it within seconds.

---

## 2. Why the capability is never in a URL — and what live does instead

> No capability is stored in logs, crash reports, URL history, ordinary cache,
> screenshots, or analytics.

A credential in a query string is a credential in a browser history, a proxy
log, a referrer header, and any screenshot of a share sheet. The website accepts
that trade because an `hls.js` player in a browser cannot attach a header to the
segment requests it issues on its own.

**A native player can**, and that is the whole reason both platforms are wired
the way they are.

### iOS, recordings: a resource loader

For progressive media, `AVAssetResourceLoaderDelegate` puts a header on every
byte-range request:

1. the asset is created with a **custom scheme** (`faithform-media://…`), which
   `AVPlayer` cannot resolve itself;
2. every byte-range request therefore arrives at the loader;
3. the loader rewrites the scheme back to `https`, attaches
   `Authorization: Bearer <capability>`, and issues it with `URLSession`.

`AVURLAssetHTTPHeaderFieldsKey` would have been one line. It is undocumented
private API and using it risks a review rejection, so it is not used — and a
sweep asserts it appears nowhere.

The session is `URLSessionConfiguration.ephemeral` with `urlCache = nil` and
`httpCookieStorage = nil`: nothing about a capability or a segment reaches disk.

### iOS, live: a delivery path

The loader cannot serve live. AVFoundation refuses HLS **media segments**
answered by a resource loader — the only response it accepts for one is a
redirect to a plain HTTP URL, which carries no header — and fails the item with
`CoreMediaErrorDomain -12881` ("custom url not redirect"). Every live service
routed through the loader was a black frame; the app-hosted proof test
(`AppTests/LivePlaybackProofTests.swift`) reproduces that error against a real
stream.

So a live grant's delivery URL carries the delivery token in its path, and
`AVPlayer` fetches the playlist and every segment itself — which is also what
lets the system buffer, recover from stalls, and AirPlay. The account capability
still never enters a URL; the token that does is scoped to one account, one
church and one event, cannot be exchanged for anything, and is never read from a
query string.

### Android: default request properties

`DefaultHttpDataSource.Factory.setDefaultRequestProperties(map)` attaches headers
to every request Media3 makes. Android plays the same delivery URL as iOS and
sends the header as well; the live route accepts either. The map is a **live view** owned by
`CapabilityHeaders` in `:core:media`, so a refresh replaces the header for
requests not yet issued without rebuilding the player or reloading the item.

A test asserts the view is live rather than a copy — a copy would mean a refresh
updated something the player never reads, and playback would die at the old
capability's expiry.

---

## 3. Delivery

```
                       POST /api/mobile/v1/media/playback     (authenticated, no-store)
  FaithForm  ───────────────────────────────────────────────▶  grant or 404
     │                                                             │
     │  { capability, deliveryUrl, expiresAt, refreshAfterSeconds,  │
     │    renditionKind }                                           │
     ▼
  GET  <deliveryUrl>          (recordings: Authorization: Bearer <capability>)
     │
     ├─ live       /api/media/v1/live/<slug>/<eventId>/<deliveryToken>/index.m3u8
     │                → verify delivery token (or a bearer capability, for a
     │                  build that sends one) → re-check grant and
     │                  authorization version → fetchFromRelay
     │                → rewrite playlist under the same path, **no query suffix**
     │
     └─ recording  /api/media/v1/recording/<slug>/<id>
                      → verify capability → re-check grant
                      → 60-second signed URL, used here, never returned
                      → byte-range proxy
```

### The grant refuses an unplayable recording, twice

Before the capability is minted, `mobile_media_playback_grant` requires the
recording to be proved playable, and `grantPlayback` then confirms the object in
storage is still the object that was verified. Both are independent of the
dashboard and of the publish path: a recording that stopped being playable after
it was published cannot be handed a new capability, whatever any cached list
says. See `P9_MEDIA_ELIGIBILITY.md`.

### And delivery serves an object, not a path

A storage path is mutable — `infra/stream-relay/upload-recording.sh` uploads with
`x-upsert: true` — so resolving a path and streaming whatever is at it would
serve a file nobody verified, to a capability minted for a file that no longer
exists.

So the grant carries the verified object's identity, and the delivery route does
two things with it on **every range request**:

```
GET <signed storage url>          If-Match: "<verified etag>"     ← pinned
   │
   ├─ 412  → refused. The object changed and the provider said so.
   │
   └─ 206  → compare the response's own ETag / version / length   ← checked
                against the grant's. A mismatch cancels the body
                and refuses, before a byte reaches the phone.
```

Both, not either. Pinning alone trusts the provider to honour `If-Match`;
checking alone transfers the wrong bytes first. Neither is a claim that the
provider *does* honour it — that is runbook step 26k, and it has not been
observed.

An identity field only one side knows is skipped rather than treated as a
mismatch, so a provider that stops returning ETags does not invalidate a
congregation's archive. But a response advertising **nothing** comparable is
refused: nothing to compare is not evidence.

`renditionKind` is `hls` or `progressive`, and it exists because Media3 infers
its extractor from the URI path — and a recording delivery URL ends in an id
with no extension. The Android adapter declares the MIME type from this field
rather than letting Media3 guess. Both platforms fall back to `progressive` on
an unrecognised value, so a released app does not break if the server learns a
new rendition form. Today every recording is `progressive`: nothing in this
repository packages VOD HLS.

### Authorization is re-checked while playing

The signature proves the server minted the capability. It cannot prove the
church has not unpublished the item in the last thirty seconds, because a
signature cannot be revoked.

So both delivery routes call `authorizeDelivery`, which re-runs
`mobile_media_playback_grant` — publication, unpublish, revocation, relationship,
account status — while the item plays. That is what makes an unpublish stop a
stream that is already playing, rather than at the end of the sermon.

For **recordings** it runs on every range request. For **live** a positive
answer is reused for fifteen seconds per server instance
(`lib/media/v1/delivery-cache.ts`), keyed by account, church, event and the
token's authorization version, so a sign-out still takes effect at once and a
revocation within fifteen seconds. Live cannot afford the round trip per
request: players fetch segments one after another, the relay deletes a segment
as soon as it leaves a 24-second window, and at 0.6–1.7s per check every segment
had been deleted by the time it was asked for — the apps loaded the playlist and
sat on one frozen frame. The relay's own per-request auth callback is cached for
the same reason (`infra/stream-relay/auth-proxy.py`), and so is the church's
relay path.

### The relay credential

`lib/stream/relay-upstream.ts` is now the single place the relay's Basic
credential is assembled, and both the website route and FaithForm's route reach
the relay through it. Prompt 2's protection is unchanged: the credential is built
server-side, attached to an outbound request, and appears in no response. A test
asserts neither route builds one of its own.

### Recordings are proxied, not redirected

The dashboard reads recordings with `createSignedUrl(path, 4 hours)`. That is
fine behind a staff session on a laptop and exactly wrong for a phone: a
four-hour provider URL is a four-hour bearer token for a video file, it survives
a screenshot and a share sheet, and **no unpublish can take it back**.

So the signed URL is created with a sixty-second life, used immediately by the
server, and never sent anywhere. `Range` is forwarded and
`Content-Range`/`Accept-Ranges` are passed back, because without them neither
player can scrub.

The archive is progressive MP4 rather than HLS because that is what the relay
writes; packaging per-recording HLS would be a second recording authority. Both
`AVPlayer` and `Media3` play progressive MP4 with seeking.

---

## 4. Refresh

A capability lasts five minutes and the client refreshes at **sixty seconds
before expiry**, on a schedule rather than on failure. Refreshing on failure
would mean a visible stall every five minutes; refreshing early means there is a
whole minute for the request to complete, retry once, and still land.

### Single-flight

Two things can notice at once — the scheduled refresh, and a 401 from a segment.
Both will ask. The in-flight flag is claimed **before any suspension point** (an
actor flag on iOS, a mutex on Android), so they produce one request and share
its answer.

This is the same TOCTOU that produced eight concurrent geofence submissions in
Prompt 7 and two simultaneous scans in Prompt 8. On Android it is proven by
removing the mutex and watching the test fail.

### A refused refresh is terminal

Not retried. The old capability is not reused. Playback stops and the person is
told the item is no longer available. A church that revoked something meant it,
and the segments already buffered are not a licence.

The one exception is a *first* `unavailable` failure, which triggers exactly one
forced refresh — an expired capability and a revoked one are indistinguishable
from the transport's point of view, and only the server can tell them apart.

---

## 5. What a refusal says

Every way a grant can fail returns **one** answer: `not_found`.

Never published, unpublished, revoked, blocked visitor, hidden church, unknown
slug, wrong church, ended service, encoder gone — all identical. A caller probing
ids learns nothing about which of them exist.

Player failures collapse to four cases with no payload:

| | Meaning |
| --- | --- |
| `network` | the connection went away; recoverable by itself |
| `unavailable` | 401/403/404/410 — the church took it down, revoked it, or the relationship changed. For **live**, 404/410 are `network` instead: the relay has no playlist *yet* — the encoder is connecting or reconnecting — and the player waits it out while the church still lists the service as live |
| `unsupported` | this device cannot decode it |
| `unknown` | anything else |

`PlayerFailure` is an enum with no associated values, so there is nothing for a
URI, a status code or a Media3 cause chain to travel in. A test asserts no
message contains `http`, `://`, a status, or a framework name.

---

## 6. What this does not claim

**This is not DRM.** A signed capability decides *who may fetch bytes*. It does
nothing about what happens to those bytes afterwards: it does not prevent screen
recording, does not prevent a camera pointed at a screen, and does not prevent
someone re-encoding what they legitimately received.

What it does provide is revocation with a bounded window — roughly one segment
for delivery, roughly one minute for a refresh — and an audit of who was granted
what. That is a genuinely useful property and it is the only one claimed.

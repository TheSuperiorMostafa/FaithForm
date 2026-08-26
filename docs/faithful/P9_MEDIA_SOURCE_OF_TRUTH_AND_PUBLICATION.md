# Prompt 9 — Media Source of Truth and Publication

*What the streaming system actually is today, traced from the code, and the
publication model Prompt 9 adds on top of it without creating a second
authority.*

Every claim below cites a file. Where an earlier note disagrees with the source,
the source wins and the disagreement is recorded.

---

## Part I — The inspection

### 1. Baseline before any change

| Gate | Result |
| --- | --- |
| `pnpm test` | 546 passed, 0 failed, 0 skipped |
| `pnpm ios:test` | 263 tests, 25 suites |
| `gradlew test` | BUILD SUCCESSFUL |
| `pnpm verify:generated` | contract, design tokens and localization all current |
| `pnpm test:migrations` | verified after 62 legacy migrations |
| `git diff --check` | clean |

### 2. The three tables that already exist

```
stream_events        0033, + public_access in 0050
stream_sessions      0030/0032
stream_recordings    0034, + series/tags/visibility in 0047
media_series         0047
media_views          0047
```

**`stream_events`** — a scheduled or running broadcast.
`status ∈ {scheduled, live, ended, cancelled}`, plus `starts_at`,
`recurrence_rule`, `artwork_url`, `chat_enabled`, `countdown_enabled`,
`public_access`, `simulated`, and the two syndication flags.

**`stream_sessions`** — one actual broadcast run.
`status ∈ {preparing, waiting_for_encoder, live, ended, …}`, carrying
`ingest_started_at` and `stream_event_id`.

**`stream_recordings`** — a file that landed in storage.
`status ∈ {processing, ready, published}`, `storage_path`, `duration_sec`,
`trim_start_sec`/`trim_end_sec`, `published_at`, and from 0047
`visibility ∈ {public, unlisted}`, `series_id`, `speaker_tags`,
`chapter_tags`, `topic_tags`.

### 3. The lifecycle, end to end

| Stage | Where | What happens |
| --- | --- | --- |
| Create / schedule | `app/dashboard/live-streaming/actions.ts`, `lib/stream/events.ts` | A `stream_events` row, admin-only |
| Start | `lib/stream/go-live.ts:startLiveBroadcast` | Creates a session, queues an encoder command, sets relay destinations, opens YouTube/Facebook broadcasts |
| Ingest detected | `lib/stream/go-live.ts:onIngestStarted` → `markStreamIngestStarted` | Stamps `ingest_started_at`; this is what makes the public status say `live` |
| Stop | `endLiveBroadcast` | Stops the encoder, clears relay destinations, closes each platform independently, ends the session and the event |
| Cancel | event `status = 'cancelled'` | Never becomes live |
| Recording lands | `app/api/stream/recording-complete/route.ts` | Relay webhook → `createStreamRecording` |

**Two findings worth stating plainly.**

`endLiveBroadcast` carries a comment about a real defect it fixed: an unordered
`select … where status = 'live' limit 1` closed an arbitrary event, so services
ended each other. It now ends the session's own event. That history is why
Prompt 9 must not add another "find the live event" query with its own ordering.

`createStreamRecording` writes `status: 'ready'`, with a comment saying churches
"no longer trim or publish, so a recording is watchable the moment it lands."

### 4. **`published` is a dead status**

```bash
grep -rn "getPublishedRecordingForChurch|listStreamRecordings|updateStreamRecording" .
# → no callers outside lib/stream/recordings.ts
```

Three exported functions have **zero call sites**, and nothing anywhere sets a
recording's status to `'published'`. The check constraint allows the value; the
application never produces it. `getPublishedRecordingForChurch` — which filters
on exactly that status — is therefore a gate that no recording can currently
pass.

So there is **no recording publication mechanism today**. Prompt 9 builds it.

`visibility ∈ {public, unlisted}` is a *website listing* concept from 0047, not a
Faithful one. `unlisted` means "reachable by link but not shown on the church's
site". Treating it as a mobile publication signal would publish every recording
a church ever made to every visitor's phone, which is precisely what
"a recording must not appear merely because it exists" forbids.

### 5. Ingest and relay

`lib/stream/relay.ts` derives `buildStreamPath(churchId)` from the church id
rather than trusting the relay, so a leaked relay secret cannot write over
another church's path. `getStreamRelaySettings(churchId, {includeSecret})` gates
the secret behind an explicit flag.

`infra/stream-relay/mediamtx.yml` geometry — **1 s segments, 8 per playlist** — is
referenced by name in `lib/stream/hls-player.ts`, which tunes live latency
against it.

### 6. Provider webhooks

| Webhook | Verification | Replay protection |
| --- | --- | --- |
| `stream/recording-complete` | `compareSecret` against `STREAM_RELAY_WEBHOOK_SECRET`; storage path must start `relay/<churchId>/`; **the file must already exist in the bucket** (a 60 s signed URL is created purely to prove it) | **None** — no timestamp, no nonce |
| `stream/syndication/report` | shared secret | — |
| Stripe (`0050`) | signature | `claim_stripe_webhook_event` |

The recording webhook's file-existence check is a genuinely good control: it
exists because a recording announced without its upload left the library stuck
on "processing" with nothing to play.

**Prompt 9 does not modify this webhook**, so its lack of replay protection is
recorded here as pre-existing rather than fixed. A replayed call re-creates a
row for a file that does exist, in the correct church — an idempotency gap, not
an authorization one. Prompt 9's publication step is separate and explicit, so a
duplicated row is invisible to visitors until a human publishes it.

### 7. Storage and retention

Recordings live in the **private** `stream-recordings` bucket under
`relay/<churchId>/<filename>`, with `sanitizeRecordingFilename` allowing only
`[A-Za-z0-9._-]{1,120}` ending `.mp4`, `.mov` or `.mkv`.

The dashboard's media detail page reads them with
`createSignedUrl(path, 60 * 60 * 4)` — **a four-hour provider URL**. That is
acceptable for a staff page behind a dashboard session. It is exactly what
Prompt 9 must not hand to a phone.

No retention job deletes recordings. That is unchanged.

### 8. Playback capability as it stands

`lib/stream/playback.ts`:

```ts
type PlaybackCapability = {
  version: 1; churchId: string; eventId: string;
  audience: "public" | "staff"; exp: number;
}
```

- HMAC-SHA256 over the base64url body with `STREAM_PLAYBACK_SECRET`.
- `exp` is **quantized** to a 5-minute bucket plus a 10-minute grace, so the
  public-status poll does not replace the player URL every five seconds. Real
  lifetime is therefore 10–15 minutes.
- Constant-time comparison, length-guarded, 2 KB cap.
- **Not bound to an account.** Church, event and audience only.
- `getHlsPlaybackUrl` puts the capability **in a query string**, and
  `rewriteM3u8Playlist` copies it onto every segment URL.

### 9. The protected-HLS mechanism

`app/api/stream/hls/[...path]/route.ts` is the Prompt 2 protection, and it holds:

- the relay's Basic credential is built **server-side** in
  `playbackAuthorization()` and never leaves the process;
- path segments are validated against `.`, `..`, `\` and `:`;
- the upstream path is derived from `getStreamRelaySettings(...).streamPath`,
  not from the request;
- `capabilityIsCurrentlyAuthorized` re-checks the database on **every** request,
  requiring `stream_events.status = 'live'` and a session in
  `preparing|waiting_for_encoder|live`;
- everything is `no-store`.

**It only ever serves live streams.** There is no recording path through it.

### 10. Existing visitor-visible projection

`app/api/stream/public-status/route.ts` — anonymous, `no-store`, keyed by slug.
It returns a `countdown | offline | live | ended` status and, when live, a
playback URL with the capability inline. Its visibility rule is
`stream_events.public_access = true` and nothing else: **no relationship, no
follower targeting, no Faithful account.**

### 11. Mobile conventions Prompt 9 must match

- `lib/mobile/v1/envelope.ts` — one success and one failure shape, a meta block,
  `Vary: Authorization, Accept-Encoding`, and three cache policies.
- `lib/mobile/v1/protocol.ts` — `computeEtag` is a SHA-256 over the semantic
  payload (never a timestamp), `encodeCursor`/`decodeCursor` carry a **kind** so
  a cursor minted for one list is refused by another, and `etagMatches` compares
  constant-time.
- `lib/mobile/v1/handler.ts` — `publicRoute` / `optionalAuthRoute` /
  `authenticatedRoute` own correlation, version gating, bearer verification
  against the *publishable* key, and error redaction.
- Cache partition on both platforms is
  `environment | accountId | churchSlug | authorizationVersion`.

### 12. The canonical projection pattern

Migration `0054` is the pattern to copy, and the prompt's instruction not to
duplicate rows into a separate media authority is satisfied by following it
exactly:

```sql
alter table public.announcements
  add column if not exists mobile_visibility text not null default 'none',
  add column if not exists publication_version integer not null default 1,
  add column if not exists mobile_published_at timestamptz,
  add column if not exists mobile_unpublished_at timestamptz;
```

plus `bump_announcement_publication_version()`, a trigger that bumps the version
**only** when a field a device actually renders changes — its own comment says
"bumping on every column would invalidate feeds for provider bookkeeping nobody
can see" — plus `mobile_announcement_feed(...)`, a `security definer stable` SQL
function that filters draft, unpublished, scheduled-but-not-live, expired and
mis-targeted rows *structurally*.

Relationship targeting: `blocked` sees **nothing at all**, not even public items;
a caller with no row is treated as `left`, which sees exactly what an anonymous
visitor sees.

### 13. View counting already exists, and is already privacy-safe

`media_views` (0047) stores `kind ∈ {live, replay}`, `source ∈ {website, app,
embed}` — **`app` is already a permitted source** — and an opaque `viewer_key`
whose column comment says it is "never an IP address and never joinable back to
a person". Writes go through the service role so a visitor cannot inflate a
count, and `recordMediaView` re-validates the recording's church and visibility
before inserting.

Prompt 9 therefore reuses this and adds **no** person-level viewing analytics.

### 14. What does **not** exist

- No media surface in `lib/mobile/v1/contract.ts` — `grep` finds only a comment
  warning that stream credentials must never appear in it.
- `ENABLED_CAPABILITIES` is `["account", "discovery", "announcements"]`.
  `"watch"` is not among them, although `Destination.watch(churchSlug:)` already
  exists in both navigation modules with `requiredCapability = "watch"`.
- No recording publication, no mobile playback capability, no native player, no
  resume position, and no media cache.

---

## Part II — What Prompt 9 adds

### 15. The publication model

Additive columns on the two existing tables. **No new media authority.**

```sql
alter table public.stream_events      add column mobile_visibility …
alter table public.stream_recordings  add column mobile_visibility …
```

| Column | Both tables |
| --- | --- |
| `mobile_visibility` | `none` (default) / `public` / `followers` / `members` |
| `mobile_published_at` | when a human published it |
| `mobile_unpublished_at` | set on unpublish; a non-null value hides it |
| `mobile_publication_version` | bumped only by visitor-visible fields |
| `mobile_poster_url` | chosen from the church's own existing assets |
| `mobile_revoked_at` | a stronger unpublish: also blocks capability issuance |

Defaulting `mobile_visibility` to `'none'` is the important half: **applying the
migration publishes nothing.** Every existing event and every existing recording
stays invisible until a human acts.

### 16. The state machine a visitor can observe

```
                 mobile_visibility = 'none'  ─────────────▶  invisible
                            │  publish
                            ▼
  stream_events   scheduled ──▶ live ──▶ ended        stream_recordings
      │               │          │         │              processing
      │               │          │         │                  │ file lands
   cancelled      "upcoming"  "LIVE NOW"  gone from live         ▼
      │                                    projection        ready ──publish──▶ published
      ▼                                                        │                   │
   invisible                                            never visible        visible in archive
                                                                                   │ unpublish
                                                                                   ▼
                                                                              invisible again
```

Rules, each enforced structurally in SQL rather than by a caller remembering:

| Rule | How |
| --- | --- |
| A draft never appears | `mobile_visibility <> 'none'` |
| A failed or cancelled stream never appears | `status <> 'cancelled'` and the live projection requires a live session |
| A processing recording never appears | `status = 'ready'` **and** published |
| Publishing a live item publishes no future recording | they are separate rows with separate columns; nothing copies one to the other |
| A stream ending does not imply a recording is ready | the recording row does not exist until the relay webhook lands, and is `ready`, not published |
| Unpublish removes it from list *and* detail | `mobile_unpublished_at is null` in both projections |
| Revoke additionally blocks capability issuance | `mobile_revoked_at is null` checked at issuance |
| Blocked / hidden / unknown are indistinguishable | all return `church_not_found` |
| Never infer publication from a URL, filename or webhook | the webhook sets `ready`; only a staff action sets `mobile_published_at` |

### 17. Why the archive is progressive, not HLS

Recordings are MP4/MOV files in a private bucket. There is no per-recording HLS
packaging in this repository and inventing one would be a second recording
authority.

So the archive is served as a **byte-range proxy over the existing storage
object**, and both `AVPlayer` and `Media3` play progressive MP4 natively with
seeking. Live remains HLS through the existing proxy.

`sanitizeRecordingFilename` also permits `.mkv`, which `AVPlayer` cannot play.
That mismatch between the upload filter and iOS's codec support **is now
closed** — not by narrowing the filename filter, which proves nothing about the
bytes, but by proving playability from the object itself before a recording can
be published. An MKV recording no longer reaches a phone, because it can no
longer be published. See `P9_MEDIA_ELIGIBILITY.md`.

The `renditionKind` on a playback grant is `progressive` for every recording
today, and `hls` exists because a future VOD packaging step would inherit
segment-level revocation. Nothing in this repository packages one; that is
stated rather than implied.

### 18. Poster selection

"From authorized existing assets" means exactly four sources, validated
server-side against the church's own rows:

1. the linked `stream_events.artwork_url`;
2. the church's `cover_image_url`;
3. the church's `logo_url`;
4. none — the card falls back to a typographic treatment.

No uploader is added, no external URL is accepted, and a value that does not
match one of the church's own assets is rejected rather than stored.

### 19. Speaker and series

`stream_recordings.speaker_tags` and `series_id` already exist and are already
edited on the dashboard's media detail page. Prompt 9 projects them and adds
**no new speaker field**.

`stream_events` has no speaker column, so a live card shows no speaker. That is
the honest consequence of not inventing canonical data.

### 20. Resume position is device-local, deliberately

The requirement is "resume a recent position **on the same device**". A
server-synced position would be a per-person, per-recording, cross-device record
of what someone watched and how far they got — which is person-level viewing
analytics, and §5 forbids adding it.

So resume lives in each platform's secure store, partitioned by
`environment | account | church | authorizationVersion`, bounded to a small
number of entries with an age limit, purged on sign-out and on any authorization
change. **No server endpoint exists for it**, and none should.

A live edge is never a resume point: only `kind = recording` positions are ever
written.

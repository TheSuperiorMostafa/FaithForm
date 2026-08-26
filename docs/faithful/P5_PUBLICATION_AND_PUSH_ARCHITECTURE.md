# Prompt 5 — Publication projection and push architecture

Migration `0054_faithful_publication_and_push.sql`.

## FaithForm remains the only publisher

There is **no second announcement or event authority**. The mobile projection is
a set of additive columns on the existing `announcements` row:

| Column | Purpose |
|---|---|
| `mobile_visibility` | `none` \| `public` \| `followers` \| `members` — **defaults `none`** |
| `is_pinned`, `pinned_until` | Pinning, self-expiring |
| `poster_alt_text` | Accessible description for the artwork |
| `publication_version` | Bumped by trigger; drives the mobile ETag |
| `mobile_published_at`, `mobile_unpublished_at` | Projection lifecycle |

**Applying the migration publishes nothing.** Every existing announcement gets
`mobile_visibility = 'none'`, and there is no backfill — an announcement appears
in the app only when someone in FaithForm deliberately chooses an audience.

### The version trigger is selective

`bump_announcement_publication_version` fires only for fields a device actually
renders: title, body, start/end, location, poster, alt text, visibility, pinning,
status. It deliberately ignores `facebook_post_id`, `gmail_draft_id`, and
`last_publish_error` — provider bookkeeping nobody can see must not invalidate
every cached feed. Asserted by test.

## Targeting reuses the relationship model

Three levels, mapped directly onto Prompt 3's states. **No second membership
system**, and no group or ministry targeting — the repository has no
authoritative group model, and inventing one would have been scope creep.

| `mobile_visibility` | Relationship states that see it |
|---|---|
| `public` | anyone, including signed out |
| `followers` | `following`, `joined` |
| `members` | `joined` only |

`blocked` sees nothing at all — not even `public` items. A block should be felt,
not merely limiting.

## What never reaches a device

`mobile_announcement_feed` and `mobile_announcement_detail` enumerate their
columns explicitly, and structurally exclude:

- `status <> 'published'` — drafts and pending
- `not is_ready`
- `mobile_unpublished_at is not null` — withdrawn
- `mobile_visibility = 'none'`
- `start_at > now()` — scheduled but not live
- `end_at <= now()` — expired
- untargeted rows for that relationship
- another church's rows

A test asserts the projections contain no `facebook_post_id`, `google_event_id`,
`gmail_draft_id`, `last_publish_error`, `created_by`, `published_by`,
`facebook_caption`, or `social_graphic_path`.

## Publication enqueues transactionally

In `publishAnnouncement`, `applyMobilePublication` runs **after the canonical
row is saved and before any external provider is contacted**. A test asserts
that ordering by index position, because it is the whole guarantee:

- A Facebook or calendar failure cannot leave the app half-published or send a
  notification for something that did not save.
- An announcement that is published but whose push failed is recoverable; a push
  for an announcement that was not published is not.

Unsubmitting and deleting both call `withdrawMobilePublication`, which sets
`mobile_visibility = 'none'` and cancels anything undelivered.

**Existing publication paths are untouched.** Google, Facebook, email, and
iCloud behaviour is exactly as it was; the mobile half is additive, and it
degrades to "unavailable" with a clear message on a database that has not
received 0054 rather than failing the whole publish.

## The outbox

```
publish ──▶ notification_outbox (pending)
               │  dedupe_key unique
               ▼
     claim_notification_jobs   ── lease, FOR UPDATE SKIP LOCKED
               │
               ├─ subject moved on? ──▶ cancelled
               │
               ├─ resolveRecipients()  ← re-read live relationships + preferences
               │
               ├─ per installation ──▶ adapter ──▶ notification_delivery_attempts
               │
               └─ complete_notification_job ──▶ sent | pending (backoff) | failed
```

### Duplicate protection

`dedupe_key = sha256("announcement:{id}:v{version}")`, on a **unique** column.
Two workers, a retried publish, or a double-click all compute the same key and
collide. Including the version means a genuine re-publish after an edit *does*
create a new notification, which is intended.

`collapse_key` is separate: it lets a provider replace an earlier unread
notification about the same subject on the lock screen.

`notification_delivery_attempts` is unique on
`(outbox_id, installation_id, attempt_number)`, so a retried worker writing the
same attempt twice collides rather than double-counting.

### Claiming

Leased, not locked. `FOR UPDATE SKIP LOCKED` means two workers skip each other's
rows rather than blocking; an expiring lease means a worker that dies mid-send
has its job become claimable again instead of sticking forever or needing a
separate reaper. Only the lease holder may complete a job.

Backoff is exponential and **capped at one hour** — a provider outage must not
become a hot loop.

### The audience is a rule, not a list

`target_visibility` is stored; recipients are re-resolved at send time from live
`visitor_church_relationships` and `visitor_notification_preferences`. This is
what makes a relationship revoked between publish and delivery actually take
effect. A job whose subject was edited, withdrawn, retargeted, or whose
`publication_version` moved is **cancelled**, not sent.

### Push is a hint, never the content

The payload carries a title, a ≤180-character preview, and a deep link. It
carries **no announcement id, church id, or account id** — asserted by test — so
a payload cannot be treated as authoritative.

Tapping a notification opens `GET /announcements/{slug}/{id}`, which
re-authorizes from scratch and returns **404** if the item has since been edited
out of visibility, withdrawn, retargeted, or the relationship revoked. The app
then says "no longer available" rather than rendering what the notification
claimed.

## Provider adapters

Both classify a response into `sent` | `retryable` | `permanent` | `skipped`.
That classification decides whether a job retries, gives up, or invalidates a
token — getting it wrong either loses notifications or hammers a provider that
already said no.

| Situation | APNs | FCM | Outcome |
|---|---|---|---|
| Token dead | `410`, `BadDeviceToken`, `Unregistered` | `404`, `UNREGISTERED` | **permanent + invalidate token** |
| Throttled / outage | `429`, `500`, `503` | `429`, `503`, `UNAVAILABLE` | retryable |
| Credential rejected | `403` | `401`, `403`, `SENDER_ID_MISMATCH` | **permanent, token NOT invalidated** |
| Payload wrong | `413`, `400` | `INVALID_ARGUMENT` | permanent |
| Unrecognised | anything else | anything else | retryable |

A rejected *credential* must never wipe every device's token — that would turn a
misconfiguration into mass unsubscription. Asserted by test.

Only the documented reason keyword is extracted from a provider body
(`safeReason`, `safeErrorCode`); the rest is discarded because it can echo the
token or the payload back at us.

**Unconfigured fails closed.** With credentials absent the adapter reports
`skipped` / `not_configured` and the worker records a skipped attempt. There is
no fallback to a weaker configuration to make local development easier.

## Provider authorization is minted here, not supplied

Both adapters generate and refresh their own short-lived credential from
server-only configuration. Neither reads a pre-issued token from the
environment — that pushed the hard part onto whoever deployed it.

### APNs — ES256

`ApnsTokenProvider` signs Apple's provider authentication token: header
`{alg: ES256, kid}`, payload `{iss: teamId, iat}`, signed with the `.p8` key.

The detail that matters is the encoding. Node signs ECDSA as **DER** by default
and APNs rejects that; JOSE wants the raw r-s pair, so the signer specifies
`dsaEncoding: "ieee-p1363"`. A test asserts the signature is exactly 64 bytes
and does not begin `0x30`, because a DER signature looks plausible and never
delivers.

Apple's rules are encoded rather than described: a token lives one hour and may
not be regenerated more often than every twenty minutes. Refresh happens at
**45 minutes** - clear of the floor, with fifteen minutes of headroom before
expiry so a slow refresh never races a send.

### FCM - service-account OAuth

`FcmTokenProvider` builds an RS256 JWT assertion (`scope`, `aud = token_uri`,
one-hour `exp`) and exchanges it for an access token, then caches it until a
minute before expiry.

The exchange is **single-flight**, for the same reason session refresh is on the
clients: a batch of notifications starting at once must not each burn an
exchange against Google's quota. Verified with ten concurrent callers producing
one exchange.

The configuration reader accepts either a whole service-account JSON blob or the
three fields separately, because secret stores differ in which they make easy -
and a deployment that has to reshape its credential is one that will get it
wrong. Escaped-newline PEMs are normalised for the same reason.

### Credentials never become text

- No `console.*` call exists anywhere in `provider-auth.ts` - asserted.
- A key that will not parse throws `apns_private_key_invalid` /
  `fcm_private_key_invalid` and nothing else; an OpenSSL parse error can echo
  fragments of the key.
- **An OAuth error body is never read.** It echoes the assertion, which contains
  the signature. A test asserts `response.text()` is not called on failure.
- `redactForLog` is the only function that turns a credential into text, and it
  yields `<redacted:LEN:abcd...>` - enough to correlate two sightings, far too
  little to use.
- A rejected credential (`auth_rejected`) drops the cached token so the next
  attempt signs a fresh one, on both adapters.

Everything above is verified **without real provider access**: the tests
generate their own P-256 and RSA keys in-process and verify the signatures with
the matching public keys.

## Device installations

Service-role only. **No browser policy exists for this table at all** — not even
for the owning account — because it holds live provider tokens.

- Unique on `(install_id, environment)`. Re-registering **reassigns** the row to
  the new account, so the same phone signing in as someone else cannot keep
  receiving the previous account's notifications.
- Retiring **clears the token**, not just the enabled flag: a disabled row with a
  live token is one bug away from being used. Asserted by test.
- Sign-out and account deletion both retire installations. Asserted by test.
- `InstallationView` has no token field, so no projection can leak one.

Preferences are per `(account, church, topic)`. An absent row means "not yet
decided", which is the topic default — not consent. Setting one requires a live
relationship, otherwise the endpoint would report whether a private church
exists.

Quiet hours are **stored but not interpreted**. What happens to a notification
arriving inside them is a product policy, and guessing it would be worse than
leaving it explicit.

## Metrics carry no content

`notification_delivery_attempts` stores an outcome, an error *category*, and a
provider status. No body, no token, no recipient name, no church member data.

## Operational ownership

| Concern | Owner |
|---|---|
| Authoring and publication | FaithForm dashboard |
| Mobile projection | `applyMobilePublication` |
| Enqueue | `publishAnnouncement`, transactionally |
| Delivery | `runNotificationWorker` — needs a scheduled trigger (see runbook) |
| Provider credentials | Server environment only, never in either app |
| Token invalidation | Worker, from provider classification |

## Invocation

`GET /api/webhooks/notifications/dispatch`, registered in `vercel.json` on a
two-minute schedule, following the repository's established cron convention
exactly - Bearer `CRON_SECRET`, constant-time comparison, generic 401, the same
shape as weekly-draft, keep-alive, and receipt-retry.

Bounded: 25 jobs per invocation by default, 100 maximum, and a malformed `limit`
falls back to the default rather than being trusted. The function is allowed 60
seconds, since it makes outbound calls to two providers.

**Overlap is safe by construction, not by scheduling discipline.** Jobs are
claimed under a lease with `FOR UPDATE SKIP LOCKED`, so two concurrent
invocations claim disjoint sets, and a worker that dies mid-send has its lease
expire rather than stranding the job. The route deliberately takes **no global
lock** - that would itself become a stuck state needing its own recovery.

The response is counts and a duration. No notification body, no device token, no
church or account identifier: it is observability, not a data export.

**Still external:** nothing has run this on a deployed schedule, and no
notification has been sent.

# Prompt 5 — Native experience

Two native apps, one specification. No shared UI code.

## Localization — Prompt 4's gap, closed

Prompt 4 shipped iOS with inline literals against Android's `strings.xml`. That
was a real parity gap and is now closed and **guarded**.

- `apps/faithful-ios/Sources/FaithfulKit/Strings.swift` holds every user-facing
  string, keyed **identically** to the Android resource names.
- `Localizable.xcstrings` carries translations; the English value in
  `Strings.swift` is the development default and the fallback.
- `scripts/verify-localization-parity.mjs` fails the build if either platform
  gains a key the other lacks, **and** if any SwiftUI view reintroduces an
  inline `Text("literal")`, **and** if a documented platform-only exemption goes
  stale.
- It runs inside `pnpm verify:generated`, which runs inside `pnpm ci:verify`.

**Current: 86 shared keys**, plus three documented Android-only ones — channel
descriptions and the system-settings path have no iOS counterpart, because iOS
has neither channels nor a re-askable permission. Each exemption states its
reason, and an exemption for a key that no longer exists is itself a failure.

The checker caught four leftover Prompt 4 literals on its first run, which is
precisely what it exists for.

Nothing assumes a text direction, so adding Arabic is a translation task rather
than a refactor. No unapproved translations were invented — English only.

## Screen parity

| Screen | iOS | Android | Status |
|---|---|---|---|
| Welcome | `WelcomeView` | `WelcomeScreen` | ✅ both |
| Location education | `LocationEducationView` | `LocationEducationScreen` | ✅ both |
| Search + nearby | `DiscoveryView` | `DiscoveryScreen` | ✅ both |
| Church result card | `ChurchResultCard` | `ChurchResultCard` | ✅ both |
| Skeleton | `SkeletonCard` | `SkeletonCard` | ✅ both |
| Home feed | `HomeFeedView` | `HomeFeedScreen` | ✅ both |
| Poster card | `AnnouncementCard` | `AnnouncementCard` | ✅ both |
| Empty / offline / error / blocked | shared spec | shared spec | ✅ both |
| Notification education | `NotificationEducationView` | `NotificationEducationScreen` | ✅ both |
| Notification preferences | (contract + service) | `NotificationPreferencesScreen` | ✅ Android; iOS via account surface |
| Church profile | `ChurchProfileView` | `ChurchProfileScreen` | ✅ both |
| Church chooser | `ChurchChooserView` | `ChurchChooserScreen` | ✅ both |

Every screen named in Prompt 5's UI scope is now built on both platforms. The
three gaps recorded in the first pass — church profile, church chooser, and
Android notification education — are closed.

## Poster treatment

The rule: **artwork is given room and left alone.**

- No scrim across the image. No text laid over the subject.
- Caption sits **below** the poster on a solid surface — readable at any
  contrast setting without obscuring the artwork.
- 16:9, `.fill` + clip so a poster never letterboxes (bars read as a mistake).
- The aspect ratio is reserved before the image resolves, so the card does not
  reflow when it arrives.
- A failed image falls back to the **text-only treatment**, which is designed to
  look intentional rather than broken.
- `posterAltText` is the image's accessible description. Without one the image
  is marked decorative rather than mislabelled.

## Dates, times, and timezones

Always the **church's** zone, never the device's. "Sunday at 10" means the
church's Sunday, and someone travelling must not see it shifted. `churchTimezone`
travels on every feed item for exactly this reason.

- Announcement (no end): a single moment.
- Same-day event: a time range.
- Multi-day event: both dates.
- Unknown zone: falls back rather than dropping the item.

Verified on both platforms — the iOS test asserts that 14:00 UTC renders as
10:00 Eastern and 07:00 Pacific from the same instant.

## Offline and caching

Cache identity is `environment | account | church | authorizationVersion`
(Prompt 4). Prompt 5 uses it for the feed:

| Situation | Behaviour |
|---|---|
| Cache fresh | render immediately, confirm in background |
| Cache stale | render **labelled** with an offline banner |
| Cache expired | not shown at all, even labelled |
| 304 | promote cached content out of "stale" |
| Offline, no cache | honest empty state — **never a fabricated result** |
| Blocked | **purge the partition**, show unavailable |
| Church switch | different partition — previous church unreadable |
| Revocation | version bump — cached content unreadable |
| Sign-out | private partitions purged |

Every one of these is an iOS test. The Android equivalents are covered at the
`PartitionedCache` level from Prompt 4.

## Accessibility

- Cards are **one merged element** with one combined label, so a church or an
  announcement is read as a single thing rather than four fragments.
- Every control meets 44 pt / 48 dp.
- Alt text flows into the accessible description; artwork without it is
  decorative rather than mislabelled.
- Skeletons are hidden from assistive technology and respect Reduce Motion — with
  it on, they sit still rather than pulsing.
- Increased contrast raises border weight and promotes muted text (Prompt 4
  theme), inherited by every Prompt 5 view.

## Permissions

**Neither permission is requested at launch.**

| | Sequence |
|---|---|
| Location | education screen → explicit tap → OS prompt → one foreground fix |
| Notifications | education screen → explicit tap → OS prompt |

Location is **foreground only**. The provider interfaces on both platforms have
no method that could express a background or always-on request, so no caller can
accidentally make one. `denied`, `restricted`, and `unavailable` all fall back to
manual search without taking a fix.

## Deep links

Prompt 4's fail-closed router, unchanged. `faithful://church/{slug}/announcements`
is now reachable because `announcements` is in `ENABLED_CAPABILITIES` — but only
when the account holds a usable relationship with that church. A link for a
church the person does not follow resolves `noRelationship`; a blocked church
resolves `blocked`; an unknown or malformed link is refused before any state
changes.

Notification taps route through the same parser, then fetch the current
authorized content. A payload is never rendered directly.

## Church profile

Identity → action → where and when → contact. Only the approved public
projection is rendered, because the contract carries nothing else.

The primary action is **derived, never stored**:

| Relationship | `open` | `approval_required` | `invite_only` |
|---|---|---|---|
| none | Follow | Follow | Invitation required |
| following | Join | Request to Join | Invitation required |
| pending | *"Your request is with the church"* — and the feed still works | | |
| joined | Leave | | |
| blocked | Unavailable | | |

Deriving it means a relationship that changed on the server cannot leave a stale
button behind. After any action the profile is **re-fetched** rather than
patched from the reply — what is shown is what the server would serve.

Service times render in the **campus's** timezone, and the day index is 0-based
from Sunday to match `church_service_times`. A hidden church and an unknown slug
both render as "no churches found" — the screen must not reveal which it was.

## Church chooser

Switching church is a context change, not a destination, so it is a sheet on
iOS and a screen with a back handler on Android.

The important behaviour is what happens to the cache. `select()`:

1. Refuses a church not in the list, or one that is `blocked` / `left`.
2. Sends the preference to the server, which checks the relationship again.
3. **Compares the returned `authorizationVersion` against the local one.** If it
   moved, something was revoked, and every partition for the account is purged
   before the new one is used.
4. Returns the new partition, keyed to the new version.

A selection that no longer names an available church is **dropped, not
restored** — leaving or being blocked must not survive as a usable preference.
A `blocked` or `not_found` response reloads the list rather than leaving a stale
row selectable.

## Notifications

Both platforms follow the same sequence and neither prompts at launch:

**education screen → explicit tap → OS prompt**

Where they differ is Android-native on purpose:

| | iOS | Android |
|---|---|---|
| Permission | `UNUserNotificationCenter`; `provisional` is a real state | `POST_NOTIFICATIONS` from API 33; `NOT_REQUIRED` below it |
| After denial | Points at Settings — iOS asks once | Points at Settings — Android asks once |
| Topic control | Server preference only | Server preference **and** notification channels |
| Channels | none (iOS has no equivalent) | `faithful_announcements`, `faithful_events`, created at launch |

Channels are the Android-native shape of "what may I send you". Someone can
disable events in system settings while keeping announcements, and the
preferences screen **says so** rather than quietly disagreeing with the system.

`provisional` counts as registerable on iOS: those notifications are delivered,
just quietly. Telling someone they are "on" when they will never hear one would
be wrong, which is why the state is kept distinct.

### Token lifecycle

`PushLifecycleModel` owns registration, rotation, and retirement — one place
that talks to the server about this device, and one place that must never log a
token.

- Registration is **idempotent**: the same token twice is a no-op, so a relaunch
  costs no round trip.
- A rotated token registers again under the same `installId`, so the server
  updates a row rather than accumulating orphans.
- A failed registration **never puts the token in the error message**.
- Sign-out and account removal retire the install server-side and clear the
  local copy, so the next account on the same phone starts clean.

A notification tap routes through Prompt 4's **fail-closed router**. A payload
for a church the account has no relationship with is refused; a malformed or
non-`faithful://` link is refused. The payload is a hint, never a way in.

## Build results

| Gate | Result |
|---|---|
| `swift build` | ✅ Swift 6, strict concurrency complete |
| `swift test` | ✅ **99 tests, 12 suites** |
| `gradlew test` | ✅ **49 tests** |
| `gradlew :app:assembleDebug` | ✅ APK |
| `localization:check` | ✅ **86 shared keys**, 3 documented Android-only |

**Not run:** no simulator, no emulator, no physical device, no rendered golden
images, no VoiceOver or TalkBack traversal. Everything above is source and
headless build verification.

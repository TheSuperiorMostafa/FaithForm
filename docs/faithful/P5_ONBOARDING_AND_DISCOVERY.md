# Prompt 5 — Onboarding and church discovery

Implemented over Prompt 3's relationship services and Prompt 4's mobile
contract. Nothing here re-implements a lifecycle that already existed.

## The flow

```
authenticate
   │
   ├─ GET /api/mobile/v1/onboarding
   │     needsOnboarding? ──▶ Welcome
   │     requiresChurchChooser? ──▶ Church chooser
   │     else ──▶ Home (selected church restored)
   │
Welcome ──┬─ Find a Church ──▶ Search  ──┐
          └─ I Have an Invitation ───────┼──▶ Church profile
                                          │
                            Nearby (opt-in) ┘
                                          │
                    Follow / Request to Join / Accept invitation
                                          │
                            selected church set ──▶ Home
                                          │
                            Notification education ──▶ OS prompt
```

`needsOnboarding` is computed **server-side**
(`lib/mobile/v1/discovery-service.ts`), not inferred by the client from an empty
list, so both platforms agree on the rule. `left` and `blocked` do not count as
active: someone who left every church is onboarding again, which is the honest
reading.

## Join policies

All three run through Prompt 3's `decideTransition`. Prompt 5 renders outcomes;
it does not decide them.

| Policy | `POST /churches/{slug}/join` | What the app shows |
|---|---|---|
| `open` | resolves to `joined` | Home |
| `approval_required` | `pending` | "Request pending", plus the feed for followers |
| `invite_only` | refused (`forbidden`) | "This church joins by invitation" |

**A pending request does not block following.** The feed query treats
`following` and `joined` as satisfying `followers` visibility, so someone
waiting on approval still sees what the church publishes publicly and to
followers — just not `members`-only content.

**Blocked fails closed at three independent layers**: the state machine refuses
every transition, `mobile_announcement_feed` returns nothing, and the feed model
purges the local cache on a `blocked` response rather than leaving it readable
offline.

## Invitations

The token is held across authentication and posted afterwards — the app never
mutates a relationship before knowing who is holding the link.

`POST /api/mobile/v1/invitations/accept` requires an `Idempotency-Key`, because
a single-use token must not be burned by a retry that never saw its response.
Every check — purpose, church, expiry, revocation, single use, blocked status —
happens inside Prompt 3's atomic `consume_visitor_invitation`. This route
carries the token there and reports what came back.

**A visitor invitation cannot produce staff access.** It is structurally
incapable of writing `church_users`, and an automated test asserts that no
Faithful module touches that table.

## Nearby search — the privacy shape

The rule: **a coordinate is used for one query and discarded.**

- **POST, not GET.** Coordinates in a query string end up in access logs, proxy
  logs, and `Referer` headers. In a body they do not.
- **`no-store`.** A location-derived result never enters any cache.
- **Never persisted.** `lib/faithful/nearby.ts` performs no insert, update, or
  upsert — asserted by test.
- **Never logged.** No `console.*` call exists in any Prompt 5 module —
  asserted by test.
- **Rounded to 100 m** before it reaches the client: precise enough to sort,
  too coarse to re-identify.
- **Foreground only.** `LocationProviding` (iOS) and `LocationProvider`
  (Android) have no method that could express a background or always-on
  request, so no caller can accidentally make one.

**Permission is never requested at launch, or on opening discovery.** The
sequence is: education screen → explicit tap → OS prompt. Tests assert the
request count is zero after a manual search and after the education screen is
merely shown.

Declining is a first-class outcome: `denied`, `restricted`, and `unavailable`
all fall back to manual search rather than a dead end, and none of them takes a
fix. `unavailable` is kept distinct from `denied` because a device with location
services off system-wide was never asked, and telling someone they declined
would be wrong.

### The query

`discover_churches_nearby` is a **bounded index scan**, not a full-table
distance calculation:

1. A latitude/longitude bounding box, served by
   `church_campuses_geo_idx (latitude, longitude) where is_active and is_public`.
2. Haversine evaluated **only** on the rows that box admitted.
3. Radius clamped to 1–200 km and limit to 1–50, server-side.

`cos(radians(latitude))` is floored at `0.01` so a near-polar query cannot
divide by ~zero and produce an unbounded box.

No PostGIS dependency is introduced — adding an extension is a database-owner
decision this migration does not make on someone's behalf.

## API surface

| Route | Auth | Cache | Notes |
|---|---|---|---|
| `GET /onboarding` | required | `no-store` | Decides the first screen |
| `GET /churches/search` | anonymous | `public, max-age=60` | Keyset cursor, ETag |
| `POST /churches/nearby` | anonymous | `no-store` | Coordinates in body |
| `GET /churches/{slug}/profile` | optional | `private, no-cache` | ETag; varies by relationship |
| `POST /churches/{slug}/follow` | required | `no-store` | Prompt 3 state machine |
| `DELETE /churches/{slug}/follow` | required | `no-store` | |
| `POST /churches/{slug}/join` | required | `no-store` | Policy decided server-side |
| `POST /invitations/accept` | required | `no-store` | **Idempotency-Key required** |
| `GET /churches/chooser` | required | `no-store` | Excludes left and blocked |

Search is shared-cacheable because the result is identical for everyone and only
discoverable churches are ever returned. The profile is **not**, because a
signed-in caller also sees their own relationship state.

**A hidden church and an unknown slug both return 404** — the profile endpoint
must not become an oracle for whether a private church exists.

## Multi-church

One relationship row per `(account, church)`, from Prompt 3. Switching church
changes the cache partition
(`environment | account | church | authorizationVersion`), so the previous
church's content becomes unreadable rather than merely hidden — asserted on both
platforms.

`selectedChurchSlug` is dropped if it no longer names an active relationship, so
leaving or being blocked cannot survive as a usable preference.

## Native parity

Both platforms implement the same states from the same specification, with
native navigation and native permission surfaces. Differences that are
intentional: iOS uses a `NavigationStack` with swipe-back and the iOS location
alert; Android uses the system back handler and the Android runtime permission
dialog.

| Screen | iOS | Android |
|---|---|---|
| Welcome | `WelcomeView` | `WelcomeScreen` |
| Location education | `LocationEducationView` | `LocationEducationScreen` |
| Search + nearby | `DiscoveryView` | `DiscoveryScreen` |
| Result card | `ChurchResultCard` | `ChurchResultCard` |
| Skeleton / empty / offline / error | shared spec | shared spec |
| Notification education | `NotificationEducationView` | `NotificationEducationScreen` |
| Church profile | `ChurchProfileView` | `ChurchProfileScreen` |
| Church chooser | `ChurchChooserView` | `ChurchChooserScreen` |

## Church switching

`select()` on the chooser does four things in order, and the third is the one
that matters:

1. Refuses a church not in the list, or one that is `blocked` / `left`.
2. Sends the preference; the server re-checks the relationship.
3. **Compares the returned `authorizationVersion`.** If it moved, something was
   revoked, and every cached partition for the account is purged before the new
   one is used.
4. Returns the new partition, keyed to the new version.

A `blocked` or `not_found` reply reloads the list rather than leaving a stale row
selectable. A selection that no longer names an available church is dropped, not
restored.

## Not implemented here

No attendance, no geofence registration, no background location, no QR or
kiosk, no livestream, no sermon archive, no payments, and no native People-claim
resolution. `ENABLED_CAPABILITIES` is `["account", "discovery", "announcements"]`
— the route registry refuses everything else.

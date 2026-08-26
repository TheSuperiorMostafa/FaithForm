# Prompt 12 — Integrated App Architecture

*What existed, what was missing, and how one visitor journey is assembled from
nine prompts' worth of parts.*

---

## 1. What the trace found

Read before anything was changed.

### The parts that already existed

| Concern | Where | State |
| --- | --- | --- |
| Typed API client, envelope, error codes | `FaithfulKit/Networking`, `:core:network` | complete |
| Cache partition `environment · account · church · authorizationVersion` | `CachePartition.swift`, `:core:storage` | complete |
| Destination enum, deep-link parser, `RouteRegistry` | `FaithfulKit/Navigation`, `:core:navigation` | complete, and already gated on four independent conditions |
| Design tokens, generated on both platforms | `Generated/DesignTokens.*` | complete |
| Localization, parity-checked | `Strings.swift`, `strings.xml` | 233 keys |
| Account, discovery, announcements, attendance, check-in, media, giving | Prompts 3–9, 11 | complete |
| Android app host | `:app` — `MainActivity`, `FaithfulApplication`, manifest, receivers | **real**, and reaching only the account shell |
| **iOS app host** | — | **did not exist** |

### The three defects the trace turned up

**1. Three finished features were never switched on.**
`ENABLED_CAPABILITIES` in `lib/mobile/v1/account-service.ts` listed
`account`, `discovery`, `announcements`, `watch`. It did not list `attendance`
or `giving`, both of which were built, tested and shipped in the source. The
route registries on both platforms gate on that list, so a finished feature was
correctly invisible — the gate working, on the wrong input.

**2. `apps/faithful-ios` was a library, not an app.**
No `@main`, no `Info.plist`, no Xcode project, no signing identity. Every
SwiftUI view compiled and none of them could be presented to anyone. This is what
Prompt 12 mainly exists to fix.

**3. Sermon presentation (Prompt 10) does not exist.**
`Destination.sermonArchive` has been in the enum since Prompt 4 with the
capability key `sermons`. There is no server route, no service, no screen, and no
prompt-10 document. The registry resolves it to `.notImplemented` and no
navigation offers it.

That third one is not fixed here, and inventing it would be worse than saying so.
**Faithful ships with sermons absent**, the destination stays unregistered, and
the capability stays off.

---

## 2. What a feature has to clear to be reachable

Four independent gates, all of which already existed and none of which was
loosened:

```
   Destination
       │
       ├─ 1. registered?      RouteRegistry.implemented
       │      a screen exists on this platform
       │
       ├─ 2. enabled?         bootstrap.enabledCapabilities
       │      the *server* says this capability is on
       │
       ├─ 3. permitted?       session: authenticated / account active
       │
       └─ 4. related?         this church's relationship allows reading,
              and is not blocked
                  │
                  ▼
             RouteResolution.allowed
```

A destination that fails any of them is not offered, not linkable, and not
openable. The four rejections are distinct — `notImplemented`,
`capabilityUnavailable`, `requiresSignIn`, `noRelationship`, `blocked` — because
an unfinished feature and a refused one deserve different answers.

**The registry is the only thing that decides.** Nothing renders a tab from a
hardcoded list.

---

## 3. The visitor journey

Identical information architecture on both platforms; native controls differ.

```
 Home ─── selected church
   │      live now / latest announcement
   │      authorized entry points only
   │
   ├── Church        switch, discover, join
   ├── Check in      QR scan · short code · automatic attendance status
   ├── Watch         live + recording archive
   ├── Give          published funds → amount → Stripe sheet → receipt → history
   └── Account       profile, permissions, privacy, data export, sign out
```

`Sermons` is absent from that list because it does not exist.

Every route re-derives authorization on entry, from the bootstrap the app
already holds plus the church relationship — so a relationship revoked while the
app is open closes the route on the next navigation rather than at the next cold
start.

---

## 4. Composition

Neither platform uses a dependency-injection framework. Both build one object
graph at launch, from the environment, and hand it down.

| | iOS | Android |
| --- | --- | --- |
| Entry | `@main struct FaithfulApp` | `FaithfulApplication` + `MainActivity` |
| Graph | `AppDependencies` | `AppContainer` |
| Environment | `AppEnvironment`, from `Info.plist` keys set by an `.xcconfig` | `BuildConfig`, from a build type |
| Root | `RootView` | `FaithfulApp` composable |
| Registry | built from bootstrap capabilities ∩ implemented screens | the same |

The graph is assembled once, at the top, and never reached for globally. That is
what makes the environment a build-time fact rather than something a screen can
change.

---

## 5. Environment model

Three, on both platforms, and **no production default**.

| | iOS configuration | Android build type | Origin |
| --- | --- | --- | --- |
| Development | `Debug` | `debug` | localhost / `10.0.2.2` |
| Staging | `Staging` | `staging` | set per build, no default |
| Production | `Release` | `release` | set per build, no default |

A build whose origin is missing or malformed **fails closed**: the app shows a
"not configured" state rather than falling back to production. That is a
deliberate inversion of the usual default — a staging build that silently talked
to production would be worse than one that refused to start.

The environment key is part of the cache partition, so a build that changes
environment cannot read the previous one's cache.

### What may be in an app

Only public values: an API origin, an environment key, a client build number,
and the Stripe **publishable** key — which the server sends per request, not the
app. Nothing else.

**Never**: a Stripe secret key, a webhook secret, a relay credential, a service
role key, a signing key, or any provider credential. A scan asserts it.

---

## 6. Diagnostics

Structured, correlated, and free of people.

* Every API response carries a `requestId`, already generated server-side by the
  mobile handler, and it is what a support conversation quotes.
* Both platforms redact before logging: giving redacts client secrets, intents,
  accounts and customers; attendance redacts coordinates, regions and tokens.
* **No analytics SDK, no crash reporter, no session replay, no ad SDK, no
  advertising identifier.** None was approved, so none was added, and the scope
  sweeps assert their absence.

---

## 7. What Prompt 12 deliberately did not do

* No new visitor capability. Everything reachable was already built.
* No dashboard business rule changed.
* No sermon feature invented.
* No store submission, no deployment, no migration applied anywhere hosted, no
  Stripe call, no provider state changed.
* No Apple Pay entitlement, no associated-domains entitlement: neither
  implemented feature can use them yet, and adding a capability that cannot work
  is how a signing failure becomes a mystery.

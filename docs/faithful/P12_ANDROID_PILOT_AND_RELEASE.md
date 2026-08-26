# Prompt 12 — Android: Pilot and Release

*What the app target already was, what changed, and how to build a pilot APK.*

---

## 1. What it already was

`:app` was a real product host from Prompt 4 onward — a manifest with justified
permissions, three receivers with correct export flags, an `Application` that
builds the object graph once, and a single `MainActivity` with `singleTask` deep
linking. None of that needed replacing.

What it did **not** do was reach the finished features: `MainActivity` built a
`RouteRegistry()` with the default `setOf("home", "account")`, so a
`RouteRegistry` designed to gate four ways was gating on a two-element set.

---

## 2. What changed

### The registry now names what Android implements

```kotlin
RouteRegistry(implemented = setOf(
  "home", "account", "accountPrivacy", "discover", "church",
  "announcements", "watch", "give", "checkIn",
))
```

Mirrors `AppDependencies.implementedDestinations` on iOS, entry for entry.
`sermons` is absent from both: Prompt 10 was never built, and registering it
would produce a tab that opens a blank page.

### A staging build type

Parallel to the iOS `Staging` configuration:

| | `debug` | `staging` | `release` |
| --- | --- | --- | --- |
| Application id | `…faithful.dev.debug` | `…faithful.dev.staging` | `…faithful.dev` |
| Origin | `http://10.0.2.2:3000` | **empty** | **empty** |
| Minify / shrink | no | no | yes |
| Debug controls | on | off | off |

Distinct application ids mean one phone can hold a staging build and a release
build at once, without either overwriting the other's data — which is what a
pilot needs.

### The release origin stopped being a default

`release` used to carry `buildConfigField("String", "API_ORIGIN",
"\"https://faithform.io\"")`. It no longer does. Both staging and release read
their origin from a Gradle property and are **empty** without one:

```bash
./gradlew :app:assembleStaging -Pfaithful.stagingOrigin=https://staging.example.test
./gradlew :app:assembleRelease  -Pfaithful.releaseOrigin=https://faithform.io
```

A release build that points somewhere by default is a release build nobody has to
think about pointing, and the one time that matters is the time it is wrong.

### Fail-closed configuration

`AppEnvironmentLoader` mirrors iOS decision for decision, and a Kotlin test drives
the same five inputs the Swift test does:

* empty origin → unconfigured, naming `API_ORIGIN`
* cleartext outside `development` → unconfigured
* cleartext in `development` → configured (an emulator reaching a laptop)
* a non-positive version code → unconfigured
* https in production → configured

An unconfigured build **builds no object graph at all**. `FaithfulApplication`
leaves `container` null, `MainActivity` shows `UnconfiguredScreen`, and a geofence
transition arriving in such a build is dropped rather than handed a graph pointed
at a default.

---

## 3. Permissions, verified against behaviour

A test reads the manifest — **with comments stripped**, because it documents at
length which permissions are deliberately absent, and a sweep that read those
explanations as declarations would fail on prose written to reassure a reader.

Declared: `INTERNET`, `ACCESS_NETWORK_STATE`, `POST_NOTIFICATIONS`, `CAMERA`,
`ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`, `ACCESS_BACKGROUND_LOCATION`,
`RECEIVE_BOOT_COMPLETED`.

Asserted absent: `READ_MEDIA_IMAGES`, `READ_EXTERNAL_STORAGE`,
`WRITE_EXTERNAL_STORAGE`, `RECORD_AUDIO`, `READ_CONTACTS`, `FOREGROUND_SERVICE`,
`ACTIVITY_RECOGNITION`, `AD_ID`, `QUERY_ALL_PACKAGES`.

Also asserted: the geofence receiver is `exported="false"` — the security
boundary that stops another app forging a transition — and cleartext traffic is
off with a network security config.

---

## 4. Deep links fail closed

Custom scheme only:

```xml
<data android:scheme="faithful" />
```

**No https App Link, and no `autoVerify`** — asserted by a test. An App Link needs
a verified Digital Asset Links file on a domain this repository does not
establish. Declaring one would claim a domain the app cannot prove it owns, and
Android would hand it links it could not verify.

Every link is parsed by `DeepLinkParser`, then resolved through the same
`RouteRegistry` the tabs use. An unknown link, a link to an unimplemented
feature, and a link to a church this account has no relationship with all do
**nothing at all** — no error screen, no partial navigation, no prompt.

---

## 5. Building

```bash
pnpm android:build                                  # debug APK
cd apps/faithful-android
./gradlew :app:assembleStaging -Pfaithful.stagingOrigin=https://…   # pilot APK
./gradlew :app:assembleRelease -Pfaithful.releaseOrigin=https://…   # unsigned
```

**A release build is unsigned here** and that is deliberate: no keystore,
password or key alias is in this repository, and `release` declares no
`signingConfig`. An unsigned release APK cannot be installed — which is the
correct output for a machine with no signing key.

Staging is not minified, so a pilot crash report is readable without a mapping
file. Release is, and the mapping file must be kept: see
`P12_STORE_AND_PROVIDER_SETUP.md`.

---

## 6. What has not been done

* **No APK has been installed on any device.**
* No keystore was created, and no signing key exists in or near this repository.
* No Play Console listing, no internal testing track, no Data Safety form.
* No release build has been produced with a real origin — every local build used
  the empty default, which is what the fail-closed tests exercise.
* Google Pay is unconfigured, so the giving sheet shows cards only.

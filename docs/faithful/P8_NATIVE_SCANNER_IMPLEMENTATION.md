# Prompt 8 — The Native Scanner

*What the camera does on each platform, what it deliberately cannot do, and what
was actually exercised versus what was not.*

---

## 1. The shape, on both platforms

```
        ┌──────────────────────────────────────────────┐
        │  CheckInScanCoordinator      (pure, tested)   │
        │  · when to ask for the camera                 │
        │  · what a decoded string means                │
        │  · debounce, single-flight, outcome mapping   │
        └───────────────┬──────────────────────────────┘
                        │  QrScanningFacade
        ┌───────────────┴──────────────────────────────┐
        │  AVFoundationScanner  │  CameraXScanner      │
        │  (translation only, no decisions)            │
        └──────────────────────────────────────────────┘
```

Everything that could be *wrong* is above the seam, in plain Swift and plain
Kotlin, and runs on an ordinary test runner. The adapters translate.

This is the pattern Prompt 7 established for Core Location, applied to the
camera for the same reason: the code most likely to be subtly wrong is the code
only reachable on a device.

---

## 2. The permission rule

> Never request camera permission at launch, onboarding, discovery, feed
> browsing, or automatic-attendance setup.

**Enforced structurally, not by convention.**

- `CheckInScanCoordinator.beginScanning()` is the only caller of
  `requestAccess` / `requestPermission`.
- The coordinator is the only thing holding a `QrScanningFacade`.
- `CheckInScannerModel` starts at `.idle`, and `onAppear` does not change it.
- The deep-link destination `checkIn(churchSlug:)` opens that same idle screen —
  arriving by link starts nothing, because a link that could raise a camera
  prompt would be a permission request triggered by whoever sent it.

Three tests hold the line:

| Assertion | Where |
| --- | --- |
| Constructing the coordinator prompts for nothing | iOS + Android unit |
| The typed fallback never touches the camera | iOS + Android unit |
| Only two files in either app can reach a camera permission | `checkin-privacy.test.ts` |
| No launch/onboarding/discovery/feed/geofence file holds a scanner | `checkin-privacy.test.ts` |

The last two are file-list sweeps with minimum-count assertions and an injected
violation that must make them fail.

### The order inside `beginScanning`

1. **Availability.** Telling someone to grant access on a device with no camera
   is a dead end.
2. **Current authorization.** A denied camera produces no prompt on iOS, so the
   person needs Settings rather than a button that appears to do nothing.
3. **Then, and only then, request.**

### Android's third state

Android has a state iOS does not: *denied, but asking again would still show a
dialog*. Collapsing it into "denied" is how apps end up telling someone to open
Settings when one more tap would have worked.

| State | What the screen offers |
| --- | --- |
| `DENIED_CAN_ASK_AGAIN` | **Try again** — which really does raise the dialog |
| `DENIED_PERMANENTLY` | **Open Settings** |
| `CAMERA_UNAVAILABLE` | Neither — the typed code, which is already on screen |

iOS has only the second and third. This is the one place the two platforms
deliberately differ, and `CheckInScannerUiState` encodes it so the difference is
tested rather than buried in a layout file.

---

## 3. What happens to a frame

**Nothing.**

`QrScanningFacade` hands back decoded **strings**. It has no member that returns
an image, writes a file, or touches a photo library — so there is no buffer in
scope to persist, and no media permission to ask for. That is a stronger
guarantee than a rule saying not to save one.

Forbidden across both production trees, swept and proven to bite:

```
iOS      AVCapturePhotoOutput, AVCaptureMovieFileOutput, AVCaptureVideoDataOutput,
         PHPhotoLibrary, UIImagePickerController, PHPickerViewController,
         UIImageWriteToSavedPhotosAlbum, NSPhotoLibraryUsageDescription,
         NSPhotoLibraryAddUsageDescription, NSMicrophoneUsageDescription

Android  ImageCapture, VideoCapture, MediaStore, READ_MEDIA_IMAGES,
         READ_EXTERNAL_STORAGE, WRITE_EXTERNAL_STORAGE, RECORD_AUDIO,
         createBitmap, compressToJpeg
```

The camera is released **before** the request is sent, not after. A scan that
takes four seconds on a bad connection should not hold the camera open for four
seconds with the indicator lit and nothing scanning.

---

## 4. iOS

`AVFoundationScanner`, behind `#if canImport(AVFoundation)` with the session code
under `#if os(iOS)`.

`AVCaptureMetadataOutput` is the entire capture surface: **the OS decodes**, and
what reaches the process is a string. `metadataObjectTypes = [.qr]` — every other
symbology is off, so a barcode on a hymn book or a loyalty card never arrives.

The delegate reads `stringValue` and nothing else. `AVMetadataMachineReadableCodeObject`
also carries corner coordinates and bounds; neither is read, and neither leaves
the loop.

`AVAuthorizationStatus` is mapped by **semantic case**, never by raw value — the
correction Prompt 7 applied to Core Location after an earlier version switched on
numbers so macOS tests could construct a status. The seam moves, not the
production semantics.

`CheckInCameraPreview` is a `UIViewRepresentable` that displays a session someone
else started and owns nothing. It cannot start the camera, cannot stop it, and
has no access to frames — so a preview left on screen by a layout mistake cannot
leave a camera running.

**`Config/Faithful.Info.plist`:** `NSCameraUsageDescription` only.

```
Faithful uses your camera to read the check-in code your church shows on
screen. It never saves a photo.
```

The purpose string names the benefit to the person, not the company — Apple
rejects the latter, and it is also simply the right thing to say. No
photo-library key and no microphone key, because the capture interface cannot
reach either.

The *location* keys and `UIBackgroundModes` remain absent for the reason Prompt 7
recorded: they belong to an app target this SwiftPM package does not contain, and
they are specified in `P7_PERMISSION_PRIVACY_AND_STORE_COMPLIANCE.md`. The camera
key is here because its wording is a design decision rather than a deployment
detail, and because the scanner cannot function without it.

---

## 5. Android

`CameraXScanner` in `:app`, decoding in `:core:attendance`.

### Why the decoder is in a pure-JVM module

This is the decision that made the Android side genuinely testable.

ML Kit or the Play-services code scanner would have been the obvious choice, and
both would have been **a binary nothing in CI could exercise** — the honest
write-up would have had to say the decode was untested, exactly as Prompt 7 had
to say about `addGeofences` before it was fixed.

`com.google.zxing:core` is pure JVM. So the decode lives in `:core:attendance`,
and `gradlew :core:attendance:test` encodes a real token into a real QR symbol,
renders it into the same luminance plane a camera produces, and decodes it. No
emulator, no camera, no device.

What is left in `:app` is CameraX handing over a byte array — a thin seam, and
the only part the device runbook has to cover.

### `ImageAnalysis`, and only `ImageAnalysis`

- `STRATEGY_KEEP_ONLY_LATEST` — drop, never queue. A backlog would decode frames
  from seconds ago and hold buffers meanwhile; the current frame is the only one
  worth anything.
- The Y plane of `YUV_420_888` *is* the greyscale bitmap a QR decoder wants, so
  no colour conversion and no `Bitmap` allocation — which also means no image
  object is ever created that could be written anywhere.
- **`rowStride` is read, never assumed.** CameraX pads rows; treating stride as
  width reads each row shifted further right than the last and silently never
  finds a code, with no error to explain it. Tested explicitly at stride 320 for
  a 300-pixel image.
- `image.close()` on **every** path, including the one where the downstream
  callback throws. An unclosed proxy stalls the analyser after a couple of frames,
  and the stall looks exactly like a camera that stopped working.

### Manifest

```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-feature android:name="android.hardware.camera" android:required="false" />
<uses-feature android:name="android.hardware.camera.autofocus" android:required="false" />
```

`required="false"` matters: `true` would remove Faithful from the Play listing for
every device without a rear camera — people who would have used the typed code
perfectly well.

The Robolectric manifest test asserts the **exact** permission list, so anything a
library merges in has to be argued for rather than appearing quietly. It caught
the `CAMERA` addition on the first run, which is what it is for.

---

## 6. The typed code on the client

Both platforms mirror the server's alphabet and length:

```
BCDFGHJKLMNPQRTVWXY3479      7 characters
```

Duplicated rather than fetched: it shapes the keyboard and stops a hopeless
request before it is sent, and a client that had to ask the server what a code
looks like could do neither offline. The server normalises and validates again —
this is convenience, never authority. `checkin-authority.test.ts` asserts all
three definitions are identical, so drift becomes a build failure rather than a
person being told their perfectly good code is wrong.

The field is **on the first screen**, not behind a failure. Someone whose camera
is broken, whose hands shake, or who would rather not grant camera access should
not have to be refused once before being shown the way that works for them.

Every keyboard convenience is off — no autocapitalisation to fight, no
autocorrect, no smart quotes — because the alphabet has no lowercase, no vowels
and no punctuation.

---

## 7. Never count locally

> Never count locally. Show success only for server `counted` or
> `already_counted`.

```swift
case .counted:          .counted        // success
case .alreadyCounted:   .alreadyCounted // success
case .rejected, .reversed, .pendingConfirmation: .refused
case .unknown:          .refused        // ← and this one
```

The `unknown` case matters. A client that treats an outcome it does not
understand as a check-in will one day show a tick for an outcome the server
invented to mean the opposite.

A transport failure is `.blocked(.offline)`, **not** a refusal and emphatically
not a success. A phone that read a perfectly valid code and lost the network has
checked nobody in, and a tick would be a lie the person only discovers when the
church's report disagrees with them.

There is no local queue for scans. Unlike a geofence attempt — which is triggered
by the OS while nobody is looking and therefore has to survive a dead zone — a
scan happens with a person watching. Telling them to try again is honest and
immediate; queueing would mean telling them they were counted before anything had
decided that they were.

---

## 8. Debounce and single-flight

A metadata output fires continuously — the same code arrives dozens of times a
second while it is in frame, and a rotating display puts a **new** code up every
thirty seconds. Without a guard, one glance at a projector would spend a person's
whole attempt budget in under a second.

- **Debounce:** the same string is ignored for 10 seconds after being acted on. A
  *different* string is acted on immediately, because a rotation is genuinely new
  information and making someone wait it out would be a bug.
- **Single-flight:** the in-flight flag is claimed **before any suspension
  point** — an actor flag on iOS, a mutex on Android. A check that ran after an
  `await` would let every callback in the frame interval through, which is the
  exact TOCTOU that produced eight concurrent geofence submissions in Prompt 7.

Unrecognised strings are ignored **silently**. A scanner that complained about
every poster in frame would be unusable, and each complaint would cost a
rate-limit token.

---

## 9. What was exercised, and what was not

This is the section that matters most, and it is deliberately blunt.

### Exercised, automatically, in CI

| Behaviour | Platform | Where |
| --- | --- | --- |
| QR decode from a real generated symbol | Android | `LuminanceQrDecoderTest` |
| Padded row stride (320 for a 300px image) | Android | `LuminanceQrDecoderTest` |
| A 1024-character token at the contract's limit | Android | `LuminanceQrDecoderTest` |
| Blank frames, noise, malformed geometry | Android | `LuminanceQrDecoderTest` |
| `ImageProxy` → luminance plane translation | Android | `CameraXScannerTest` (Robolectric) |
| Every frame closed, including on a throwing callback | Android | `CameraXScannerTest` |
| Permission sequence, all states | both | `CameraPermissionTest` |
| Payload filter, debounce, single-flight | both | scanner tests |
| Every outcome mapping, including `unknown` | both | scanner tests |
| Typed-code normalisation and refusal | both | scanner tests |
| Deep link is inert | both | routing tests |

### **Not** exercised

| Path | Why | How it is verified instead |
| --- | --- | --- |
| `AVCaptureSession` start/stop and frame delivery | `swift test` runs on macOS; there is no iOS camera and no simulator vends real frames | Device runbook, §`P8_DEVICE_TEST_RUNBOOK` |
| `ProcessCameraProvider.bindToLifecycle` | Needs a real camera and a real `LifecycleOwner` | Device runbook |
| Physically scanning a projector at distance | Needs a projector and a phone | Device runbook |
| A real church service | — | Not attempted, not claimed |

**No claim is made that the camera works.** The seam is tested; the hardware path
is not, and it is listed as pending with the exact reason.

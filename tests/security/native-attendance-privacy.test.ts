import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import test from "node:test";

/**
 * Forbidden-symbol and privacy sweeps over the native trees.
 *
 * **Non-vacuous by construction.** Three rules, each of which a previous
 * revision of this repository broke at least once:
 *
 *  1. The file list is walked from disk, never from `git ls-files` — `apps/` is
 *     not committed, so a tracked-file listing returns nothing and the sweep
 *     passes by inspecting zero files.
 *  2. Every sweep asserts a **minimum file count** before asserting anything
 *     about content, so an empty or mis-scoped walk fails loudly.
 *  3. The last test in this file **injects a real violation**, re-runs the
 *     sweep, and requires it to fail — then restores the file byte-for-byte.
 *     A green sweep that cannot fail is not evidence.
 */

const NATIVE_EXTENSIONS = new Set([
  ".swift", ".kt", ".kts", ".xml", ".gradle", ".plist", ".pbxproj",
]);

const SKIP_DIRECTORIES = new Set([
  "build", ".build", ".gradle", "DerivedData", ".idea", "Pods", "node_modules",
]);

function nativeFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRECTORIES.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      found.push(...nativeFiles(path));
    } else if (NATIVE_EXTENSIONS.has(extname(entry))) {
      found.push(path);
    }
  }
  return found;
}

/** Comments removed, so a sweep matches code rather than an explanation of it. */
function stripComments(text: string, path: string): string {
  if (path.endsWith(".xml") || path.endsWith(".plist")) {
    return text.replace(/<!--[\s\S]*?-->/g, "");
  }
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/\/.*$/gm, "")
    .replace(/\/\/.*$/gm, "");
}

type Offender = { file: string; symbol: string };

function sweep(symbols: string[], files = PRODUCTION_NATIVE): Offender[] {
  const offenders: Offender[] = [];
  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const code = stripComments(text, file);
    for (const symbol of symbols) {
      if (code.includes(symbol)) offenders.push({ file, symbol });
    }
  }
  return offenders;
}

const ALL_NATIVE = nativeFiles("apps");

/**
 * Production sources only.
 *
 * The forbidden-symbol rule is "the shipped app must not use these". A test
 * that asserts `startUpdatingLocation` is absent necessarily *contains* the
 * string, and so does a Robolectric test that checks no foreground service is
 * declared. Sweeping those would be a permanent false positive — the kind that
 * eventually gets the whole sweep deleted rather than fixed.
 *
 * Scoping to production is narrower *and* truer. The count assertion below
 * makes sure the exclusion has not quietly emptied the set.
 */
const TEST_PATH = /\/(test|Tests|AppTests|androidTest|src\/test)\//;
const PRODUCTION_NATIVE = ALL_NATIVE.filter((file) => !TEST_PATH.test(file));

test("the sweep actually inspects a real native tree", () => {
  // The guard against every vacuous-green failure mode: if this number
  // collapses, every assertion below becomes meaningless and this fails first.
  assert.ok(
    ALL_NATIVE.length > 60,
    `expected a real native tree, walked ${ALL_NATIVE.length} files`,
  );
  assert.ok(ALL_NATIVE.some((f) => f.endsWith(".swift")), "no Swift files walked");
  assert.ok(ALL_NATIVE.some((f) => f.endsWith(".kt")), "no Kotlin files walked");
  assert.ok(
    ALL_NATIVE.some((f) => f.endsWith("AndroidManifest.xml")),
    "the manifest was not walked",
  );

  // The production subset must still be substantial — an over-broad test
  // exclusion would empty it and make every sweep vacuous.
  assert.ok(
    PRODUCTION_NATIVE.length > 40,
    `only ${PRODUCTION_NATIVE.length} production files after excluding tests`,
  );
  assert.ok(
    PRODUCTION_NATIVE.length < ALL_NATIVE.length,
    "the test exclusion matched nothing",
  );
  assert.ok(
    PRODUCTION_NATIVE.some((f) => f.endsWith("PlayServicesGeofencing.kt")),
    "the Play services adapter is outside the swept set",
  );
  assert.ok(
    PRODUCTION_NATIVE.some((f) => f.endsWith("CoreLocationAdapter.swift")),
    "the Core Location adapter is outside the swept set",
  );
});

// ---------------------------------------------------------------------------
// No continuous location, anywhere
// ---------------------------------------------------------------------------

test("no continuous or background location API is used", () => {
  // The whole design rests on this: the OS does the monitoring and wakes the
  // app for one boundary and one fix. Any of these would be a materially larger
  // privacy claim for no additional capability.
  const offenders = sweep([
    // iOS
    "startUpdatingLocation",
    "allowsBackgroundLocationUpdates",
    "startMonitoringSignificantLocationChanges",
    "startMonitoringVisits",
    "pausesLocationUpdatesAutomatically",
    "startUpdatingHeading",
    // Android
    "requestLocationUpdates",
    "LocationListener",
    "setInterval(",
    "PRIORITY_HIGH_ACCURACY_INTERVAL",
  ]);

  assert.deepEqual(
    offenders,
    [],
    `continuous location: ${offenders.map((o) => `${o.file}: ${o.symbol}`).join(", ")}`,
  );
});

test("no permanent foreground service exists", () => {
  const offenders = sweep([
    "FOREGROUND_SERVICE_LOCATION",
    "startForegroundService",
    "startForeground(",
    "Service()",
    "android:foregroundServiceType",
  ]);
  assert.deepEqual(offenders, [], `foreground service: ${JSON.stringify(offenders)}`);
});

test("no attestation, integrity, or tracking identifier was introduced", () => {
  // None of these is authorized by the architecture, and each would be a new
  // relationship with a platform vendor rather than a code change.
  const offenders = sweep([
    "DeviceCheck",
    "DCDevice",
    "AppAttest",
    "DCAppAttestService",
    "PlayIntegrity",
    "IntegrityManager",
    "AdvertisingIdClient",
    "getAdvertisingIdInfo",
    "AD_ID",
    "identifierForVendor",
    "ASIdentifierManager",
    "FirebaseAnalytics",
    "logEvent(",
  ]);
  assert.deepEqual(offenders, [], `unauthorized capability: ${JSON.stringify(offenders)}`);
});

test("no out-of-scope feature leaked in", () => {
  // **The QR entries are gone from this list on purpose.** Prompt 7 forbade
  // `AVCaptureSession` and CameraX because scanning was Prompt 8's work, not
  // because a camera is dangerous. Prompt 8 built it, so the boundary moved
  // and this list moved with it. What replaced the guard is stricter, not
  // weaker: `tests/security/checkin-privacy.test.ts` asserts that the camera
  // can be reached from exactly two adapters, that no capture-to-disk or
  // photo-library API exists anywhere, and that no early surface holds a
  // scanner.
  //
  // Everything below is still out of scope and stays here.
  const offenders = sweep([
    // Barcode formats Faithful does not read. QR is the only symbology, so a
    // library that decoded a driving licence or a loyalty card would be new
    // capability nobody asked for.
    "VNDetectBarcodes",
    "PDF417",
    "AAMVA",
    // Face and biometric identification of attendees — explicitly forbidden.
    "VNDetectFaceRectangles",
    "FaceDetector",
    "LAContext",
    "BiometricPrompt",
    // NFC attendance.
    "NFCNDEFReaderSession",
    "NfcAdapter",
    // **`AVPlayer` and `ExoPlayer` are gone from this list on purpose.**
    // Prompt 7 forbade them because livestreams were Prompt 9's work, not
    // because playback is dangerous. Prompt 9 built it, so the boundary moved
    // and the list moved with it. What replaced the guard is stricter, not
    // weaker — `tests/security/media-privacy.test.ts` asserts that playback is
    // reachable from exactly one adapter per platform, that no WebView player
    // exists, that no download or cast API exists, and that no capability ever
    // enters a URL.
    //
    // Everything below is still out of scope and stays here.
    //
    // No WebView player. A media surface inside a web view is a place where a
    // credential ends up in a URL, a cookie jar, and a page's own history.
    "WKWebView",
    "SFSafariViewController",
    // No offline downloads. Prompt 9 excludes them, and a downloaded service is
    // a copy of a church's recording living outside any unpublish.
    "AVAssetDownloadTask",
    "AVAssetDownloadURLSession",
    "DownloadManager",
    "DownloadRequest",
    // No casting.
    "GCKCastContext",
    "MediaRouter",
    "RemotePlaybackClient",
    // No chat, comments, or user-generated content in the visitor apps.
    "CommentComposer",
    // No in-app purchase. A gift to a church is not a digital good, and
    // routing one through a store's billing would take a cut of it.
    "StoreKit",
    "SKPayment",
    "BillingClient",
    "BillingFlowParams",
    // `PaymentSheet` used to be here, because giving was out of scope until
    // Prompt 11 built it. The boundary moved and the list moved with it — and
    // what replaced it is **stricter**, not weaker: Stripe's own sheet is the
    // one payment surface, and everything below is still absent.
    //
    // No card field of our own. Card details are entered inside Stripe's UI, in
    // Stripe's process, and never touch this app.
    "STPPaymentCardTextField",
    "STPCardParams",
    "STPPaymentMethodCardParams",
    "CardInputWidget",
    "CardMultilineWidget",
    "CardFormView",
    "CardNumberEditText",
    // No instrument management, and no bank rails. Faithful gives once; it does
    // not store a card, link an account, or move money by ACH.
    "CustomerSheet",
    "FinancialConnections",
    "USBankAccount",
    "STPBankAccount",
    // No crypto giving.
    "Coinbase",
    "WalletConnect",
    // No social giving: no sharing a gift, no leaderboard, no donor wall.
    "ShareDonation",
    "GivingLeaderboard",
    "DonorWall",
  ]);
  assert.deepEqual(offenders, [], `out-of-scope feature: ${JSON.stringify(offenders)}`);
});

// ---------------------------------------------------------------------------
// Coordinates never reach a log, a preference, or a crash breadcrumb
// ---------------------------------------------------------------------------

test("no attendance file logs a coordinate, a region, or a token", () => {
  const attendanceFiles = PRODUCTION_NATIVE.filter(
    (f) => f.includes("ttendance") || f.includes("Geofence") || f.includes("geofence"),
  );
  assert.ok(
    attendanceFiles.length >= 6,
    `expected the attendance sources, found ${attendanceFiles.length}`,
  );

  const offenders: Offender[] = [];
  for (const file of attendanceFiles) {
    const code = stripComments(readFileSync(file, "utf8"), file);

    // Any logging call at all in these files is suspect: the surrounding
    // values are positions, region ids and account identifiers.
    for (const symbol of [
      "print(", "NSLog", "debugPrint",
      "Log.d(", "Log.i(", "Log.w(", "Log.e(", "Log.v(", "println(",
    ]) {
      if (code.includes(symbol)) offenders.push({ file, symbol });
    }
  }

  assert.deepEqual(offenders, [], `logging in an attendance file: ${JSON.stringify(offenders)}`);
});

test("coordinates are never written to an ordinary preference or cache", () => {
  const attendanceFiles = PRODUCTION_NATIVE.filter(
    (f) => f.includes("ttendance") || f.includes("Geofence") || f.includes("geofence"),
  );

  const offenders: Offender[] = [];
  for (const file of attendanceFiles) {
    const code = stripComments(readFileSync(file, "utf8"), file);
    // `UserDefaults` and a plain `getSharedPreferences` are readable by anything
    // with filesystem access on a compromised device. The pending queue is in
    // the Keychain / EncryptedSharedPreferences instead.
    for (const symbol of ["UserDefaults", "getSharedPreferences(", "PreferenceManager"]) {
      if (code.includes(symbol)) offenders.push({ file, symbol });
    }
  }
  assert.deepEqual(offenders, [], `insecure storage: ${JSON.stringify(offenders)}`);
});

test("the pending queue is encrypted on both platforms", () => {
  const kotlin = readFileSync(
    "apps/faithful-android/app/src/main/kotlin/io/faithform/faithful/attendance/EncryptedPendingAttemptStore.kt",
    "utf8",
  );
  // Given an EncryptedSharedPreferences instance by the container, and the
  // mirror builds its own with a Keystore-backed master key.
  const receivers = readFileSync(
    "apps/faithful-android/app/src/main/kotlin/io/faithform/faithful/attendance/GeofenceReceivers.kt",
    "utf8",
  );
  assert.match(kotlin, /SharedPreferences/);
  assert.match(receivers, /EncryptedSharedPreferences/);
  assert.match(receivers, /MasterKey/);

  // iOS declares the store as Keychain-backed in the protocol contract.
  const swift = readFileSync(
    "apps/faithful-ios/Sources/FaithfulKit/Attendance/AutomaticAttendance.swift",
    "utf8",
  );
  assert.match(swift, /Keychain/);
});

// ---------------------------------------------------------------------------
// The Android manifest declares exactly what the feature needs
// ---------------------------------------------------------------------------

test("the manifest declares the permissions this app needs and no more", () => {
  const manifest = readFileSync(
    "apps/faithful-android/app/src/main/AndroidManifest.xml",
    "utf8",
  );
  const code = stripComments(manifest, "AndroidManifest.xml");

  const declared = [...code.matchAll(/android:name="android\.permission\.([A-Z_]+)"/g)]
    .map((m) => m[1])
    .sort();

  // An exact list, so a permission added by anyone — including a library's
  // merged manifest — has to be argued for here rather than appearing quietly.
  assert.deepEqual(declared, [
    "ACCESS_BACKGROUND_LOCATION",
    "ACCESS_COARSE_LOCATION",
    "ACCESS_FINE_LOCATION",
    "ACCESS_NETWORK_STATE",
    // Prompt 8. Requested only after an explicit tap on "Scan the code";
    // `tests/security/checkin-privacy.test.ts` proves only the two camera
    // adapters can reach a permission request at all.
    "CAMERA",
    "INTERNET",
    "POST_NOTIFICATIONS",
    "RECEIVE_BOOT_COMPLETED",
  ]);
});

test("the camera is optional hardware, so a device without one can still install", () => {
  const manifest = readFileSync(
    "apps/faithful-android/app/src/main/AndroidManifest.xml",
    "utf8",
  );
  const code = stripComments(manifest, "AndroidManifest.xml");

  // `required="true"` would remove Faithful from the Play listing for every
  // device without a rear camera — people who would have used the typed code
  // perfectly well.
  assert.match(
    code,
    /<uses-feature android:name="android\.hardware\.camera" android:required="false" \/>/,
  );
  assert.ok(!/android:name="android\.hardware\.camera"[^>]*android:required="true"/.test(code));
});

test("the geofence receiver is not exported", () => {
  const manifest = readFileSync(
    "apps/faithful-android/app/src/main/AndroidManifest.xml",
    "utf8",
  );
  const receiver = manifest.slice(
    manifest.indexOf("GeofenceBroadcastReceiver"),
    manifest.indexOf("BootAndUpdateReceiver"),
  );
  // Only the system and Play services may deliver a transition. An exported
  // receiver would let any app on the device forge one.
  assert.match(receiver, /android:exported="false"/);

  // The boot receiver must be exported to hear BOOT_COMPLETED, but is guarded
  // by the permission only the system holds.
  const boot = manifest.slice(manifest.indexOf("BootAndUpdateReceiver"));
  assert.match(boot, /android:permission="android\.permission\.RECEIVE_BOOT_COMPLETED"/);
});

test("the PendingIntent is mutable-with-an-explicit-component, as the API requires", () => {
  const source = readFileSync(
    "apps/faithful-android/app/src/main/kotlin/io/faithform/faithful/attendance/PlayServicesGeofencing.kt",
    "utf8",
  );
  const code = stripComments(source, "PlayServicesGeofencing.kt");

  // FLAG_MUTABLE is required from API 31 and by the geofencing API, which fills
  // in the transition extras; an immutable intent silently delivers nothing.
  assert.match(code, /FLAG_MUTABLE/);
  assert.match(code, /FLAG_UPDATE_CURRENT/);
  // Safe because the component is explicit: Play services may add extras but
  // cannot change where it goes.
  assert.match(code, /Intent\(context, GeofenceBroadcastReceiver::class\.java\)/);
  // Never FLAG_IMMUTABLE here, and never an implicit intent.
  assert.ok(!code.includes("FLAG_IMMUTABLE"));
});

// ---------------------------------------------------------------------------
// Parity between the platforms
// ---------------------------------------------------------------------------

test("both platforms derive the idempotency key identically", () => {
  const swift = readFileSync(
    "apps/faithful-ios/Sources/FaithfulKit/Attendance/EvidenceMachine.swift",
    "utf8",
  );
  const kotlin = readFileSync(
    "apps/faithful-android/core/attendance/src/main/kotlin/io/faithform/faithful/attendance/EvidenceMachine.kt",
    "utf8",
  );

  // The same material string, the same digest, the same prefix and length.
  // Divergence here would mean the same person on two devices produced two
  // keys for one intent.
  for (const source of [swift, kotlin]) {
    assert.ok(source.includes('"faithful.geofence.v2"'));
    assert.ok(source.includes('"gf-"'));
    assert.ok(/40/.test(source));
    // v1 derived the key from the occurrence alone, so an early refusal was
    // replayed for the rest of the service. Its return would be the regression.
    assert.ok(!source.includes("faithful.geofence.v1"), "the v1 key scheme returned");
  }
});

test("the key is derived from a logical attempt on both platforms", () => {
  const swift = readFileSync(
    "apps/faithful-ios/Sources/FaithfulKit/Attendance/EvidenceMachine.swift",
    "utf8",
  );
  const kotlin = readFileSync(
    "apps/faithful-android/core/attendance/src/main/kotlin/io/faithform/faithful/attendance/EvidenceMachine.kt",
    "utf8",
  );

  for (const source of [swift, kotlin]) {
    assert.ok(source.includes("attemptId"), "the attempt id is missing from the key");
    // Random, not derived — a deterministic id would reintroduce the bug.
    assert.ok(/SecureRandom|UInt8\.random/.test(source));
  }
});

test("the attempt is opened before anything is submitted", () => {
  // Persisting the identity first is what makes a duplicate callback join the
  // attempt in progress instead of starting a second one with another key.
  const swift = readFileSync(
    "apps/faithful-ios/Sources/FaithfulKit/Attendance/AutomaticAttendance.swift",
    "utf8",
  );
  const kotlin = readFileSync(
    "apps/faithful-android/core/attendance/src/main/kotlin/io/faithform/faithful/attendance/AutomaticAttendance.kt",
    "utf8",
  );

  for (const source of [swift, kotlin]) {
    const code = stripComments(source, "x.swift");
    const openIndex = code.indexOf("openIfAbsent");
    const runIndex = code.indexOf("runFlow(");
    assert.ok(openIndex > 0, "no attempt is opened");
    assert.ok(openIndex < runIndex, "the attempt is opened after the flow starts");
  }
});

test("a terminal refusal closes the attempt on both platforms", () => {
  // Closing is the whole correction: the next entry opens a new attempt with a
  // new id and is validated fresh, instead of replaying the refusal.
  for (const path of [
    "apps/faithful-ios/Sources/FaithfulKit/Attendance/AutomaticAttendance.swift",
    "apps/faithful-android/core/attendance/src/main/kotlin/io/faithform/faithful/attendance/AutomaticAttendance.kt",
  ]) {
    const source = readFileSync(path, "utf8");
    const fail = source.slice(source.indexOf("fun fail(") >= 0
      ? source.indexOf("fun fail(")
      : source.indexOf("func fail("));
    assert.ok(/store\.close\(/.test(fail.slice(0, 900)), `${path} does not close on refusal`);
  }
});

test("neither platform sleeps through a dwell", () => {
  // A timer spanning a dwell would not survive suspension on iOS or a killed
  // process on Android, and would produce a feature that appeared to work only
  // in the foreground.
  const swift = stripComments(
    readFileSync("apps/faithful-ios/Sources/FaithfulKit/Attendance/AutomaticAttendance.swift", "utf8"),
    "x.swift",
  );
  const kotlin = stripComments(
    readFileSync(
      "apps/faithful-android/core/attendance/src/main/kotlin/io/faithform/faithful/attendance/AutomaticAttendance.kt",
      "utf8",
    ),
    "x.kt",
  );

  assert.ok(!swift.includes("Task.sleep"), "iOS sleeps through a dwell");
  assert.ok(!swift.includes("beginBackgroundTask"), "iOS requests a background assertion");
  assert.ok(!kotlin.includes("delay("), "Android delays through a dwell");

  // Android's `setLoiteringDelay` *is* used — deliberately, and only in the
  // adapter, driven by authoritative configuration. What must not exist is a
  // timer in the coordinator, which is what this asserts.
  assert.ok(
    !kotlin.includes("setLoiteringDelay"),
    "the dwell delay belongs in the adapter, not the coordinator",
  );
});

test("the OS dwell transition is used on Android and driven by configuration", () => {
  const adapter = stripComments(
    readFileSync(
      "apps/faithful-android/app/src/main/kotlin/io/faithform/faithful/attendance/PlayServicesGeofencing.kt",
      "utf8",
    ),
    "x.kt",
  );

  // Play services has a real dwell transition and iOS has none. Using it where
  // it exists is the right call — the confirmation then arrives on a system
  // callback instead of waiting for some other wake to happen along.
  assert.match(adapter, /GEOFENCE_TRANSITION_DWELL/);
  assert.match(adapter, /setLoiteringDelay/);

  // And the delay is never a literal: it comes from the region, which comes
  // from the server's configuration, so a policy edit reaches the device.
  assert.match(adapter, /region\.loiteringDelayMillis/);
  assert.ok(
    !/setLoiteringDelay\(\s*\d/.test(adapter),
    "the loitering delay must not be hard-coded",
  );
});

test("both platforms bound retries without ever locking an occurrence out", () => {
  const swift = readFileSync(
    "apps/faithful-ios/Sources/FaithfulKit/Attendance/AttemptPolicy.swift",
    "utf8",
  );
  const kotlin = readFileSync(
    "apps/faithful-android/core/attendance/src/main/kotlin/io/faithform/faithful/attendance/AttemptPolicy.kt",
    "utf8",
  );

  for (const source of [swift, kotlin]) {
    const code = stripComments(source, "x.swift");
    // A cooldown and a refilling bucket, not a cap and not a window.
    assert.ok(/cooldown/i.test(code));
    assert.ok(/token/i.test(code), "no token bucket");
    assert.ok(/bucket/i.test(code));
    // The hold names when it lifts.
    assert.ok(/waitUntil|WaitUntil/.test(code));
    // Only a count settles.
    assert.ok(/settl/i.test(code));
  }

  // The constants match, so an iPhone and a Pixel back off identically.
  assert.match(swift, /bucketCapacity = 12\.0/);
  assert.match(kotlin, /BUCKET_CAPACITY = 12\.0/);
  assert.match(swift, /maxCooldown: TimeInterval = 10 \* 60/);
  assert.match(kotlin, /MAX_COOLDOWN_MILLIS = 10L \* 60 \* 1000/);

  // A continuously refilling bucket, not a window. A 12-per-rolling-hour
  // budget could hold a device for nearly an hour — longer than the service.
  assert.match(swift, /tokenRefillInterval: TimeInterval = 60/);
  assert.match(kotlin, /TOKEN_REFILL_INTERVAL_MILLIS = 60L \* 1000/);
  assert.ok(
    !/budgetWindow|BUDGET_WINDOW_MILLIS/.test(swift + kotlin),
    "the windowed budget returned",
  );

  // And the bound is stated, not implied.
  assert.match(swift, /maxLocalHold/);
  assert.match(kotlin, /MAX_LOCAL_HOLD_MILLIS/);

  // And the old hard cap is gone from both.
  assert.ok(
    !/maxRefusedAttemptsPerOccurrence|MAX_REFUSED_ATTEMPTS_PER_OCCURRENCE/.test(
      swift + kotlin,
    ),
    "the permanent refusal cap returned",
  );
});

test("neither platform lets a client-supplied value decide dwell", () => {
  // Dwell was never enforced: `p_dwell_seconds` came from the client and was
  // compared against the policy, so `dwellSeconds: 9999` counted immediately.
  // It is now measured between two server timestamps.
  const service = readFileSync("lib/mobile/v1/attendance-service.ts", "utf8");
  const code = service.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  // The command receives the *server's* number.
  assert.match(code, /dwellSeconds: input\.source === "qr" \? null : \(serverDwellSeconds \?\? 0\)/);
  // And never the client's.
  assert.ok(
    !/dwellSeconds:\s*input\.dwellSeconds/.test(code),
    "the client's dwell figure reaches the command",
  );

  // The confirmation deadline comes from the detection record, not from the
  // client's `observedAt` — which backdating used to move into the past.
  assert.match(code, /open_attendance_detection/);
  assert.match(code, /redeem_attendance_detection/);
  // `[\s\S]` rather than the `s` flag: the repo's tsconfig target predates it.
  assert.ok(
    !/observedAt[\s\S]*\+[\s\S]*minDwell/.test(code),
    "the deadline is derived from a client timestamp",
  );

  // `observedAt` survives only as bounded diagnostics.
  assert.match(code, /plausibleObservedAt/);
});

test("the detection record is stamped by the database, not by the application", () => {
  const migration = readFileSync(
    "supabase/migrations/0058_attendance_detections.sql",
    "utf8",
  ).replace(/--.*$/gm, "");

  // `now()` inside the function: neither the client nor the Node process
  // supplies the instant that starts the clock.
  assert.match(migration, /now_server timestamptz := now\(\)/);
  assert.match(migration, /confirmation_not_before/);
  assert.match(migration, /now_server \+ make_interval\(secs => dwell_seconds\)/);

  // The elapsed dwell is the difference between two server timestamps.
  assert.match(migration, /extract\(epoch from \(now_server - d\.detected_at_server\)\)/);

  // Every binding is re-checked at redemption.
  for (const binding of [
    "detection_wrong_account",
    "detection_wrong_member",
    "detection_wrong_occurrence",
    "detection_wrong_region",
    "detection_stale_configuration",
    "detection_already_used",
    "detection_expired",
    "dwell_not_elapsed",
  ]) {
    assert.ok(migration.includes(binding), `redemption does not check ${binding}`);
  }

  // Server-role only. A detection is a capability.
  assert.match(migration, /revoke all on public\.attendance_detections from public, anon, authenticated/);
});

test("both platforms treat the confirmation deadline as scheduling, not authority", () => {
  for (const path of [
    "apps/faithful-ios/Sources/FaithfulKit/Attendance/EvidenceMachine.swift",
    "apps/faithful-android/core/attendance/src/main/kotlin/io/faithform/faithful/attendance/EvidenceMachine.kt",
  ]) {
    const source = readFileSync(path, "utf8");
    // A confirmation needs the server-issued detection, not just a deadline.
    assert.match(source, /detectionId/);
    const code = stripComments(source, "x.swift");
    assert.ok(
      /detectionId (!= nil|== null|\?)/.test(code) || /detectionId == null/.test(code),
      `${path} does not require a detection to confirm`,
    );
  }
});

test("neither platform gates confirmation on in-memory state", () => {
  // After a process restart the phase is idle — the ordinary case for a
  // background wake, not an edge one. Guarding on it made a persisted attempt
  // unconfirmable forever, so the stored attempt is the authority.
  for (const path of [
    "apps/faithful-ios/Sources/FaithfulKit/Attendance/AutomaticAttendance.swift",
    "apps/faithful-android/core/attendance/src/main/kotlin/io/faithform/faithful/attendance/AutomaticAttendance.kt",
  ]) {
    const source = readFileSync(path, "utf8");
    // Anchored on the *declaration*, not the first mention — `confirmIfDue`
    // calls it, and a window from the call site lands in a doc comment.
    const marker = Math.max(
      source.indexOf("func confirmDwell"),
      source.indexOf("fun confirmDwell"),
    );
    assert.ok(marker > 0, `${path} has no confirmation path`);

    const body = stripComments(source.slice(marker, marker + 2000), "x.swift");

    // The *guard* forms specifically — an assignment to `phase` is fine and
    // expected; a precondition on it is what makes a restart unconfirmable.
    assert.ok(
      !/guard case \.awaitingDwell = phase/.test(body),
      `${path} gates confirmation on in-memory phase`,
    );
    assert.ok(
      !/if \(phase !is EvidencePhase\.AwaitingDwell\)/.test(body),
      `${path} gates confirmation on in-memory phase`,
    );
    // It reads the persisted attempt instead.
    assert.ok(/store\.current\(/.test(body), `${path} does not read the stored attempt`);
  }
});

test("both platforms cap monitored regions at the same number", () => {
  const swift = readFileSync(
    "apps/faithful-ios/Sources/FaithfulKit/Attendance/GeofenceReconciler.swift",
    "utf8",
  );
  const kotlin = readFileSync(
    "apps/faithful-android/core/attendance/src/main/kotlin/io/faithform/faithful/attendance/GeofenceReconciler.kt",
    "utf8",
  );
  assert.match(swift, /appleMonitoredRegionLimit = 20/);
  assert.match(kotlin, /MONITORED_REGION_LIMIT = 20/);
  // Android's own ceiling is 100; the shared cap is deliberately the lower one
  // so both platforms monitor the same set for the same church.
  assert.match(kotlin, /ANDROID_GEOFENCE_LIMIT = 100/);
});

test("both platforms bound the pending queue to the same lifetime", () => {
  const swift = readFileSync(
    "apps/faithful-ios/Sources/FaithfulKit/Attendance/EvidenceMachine.swift",
    "utf8",
  );
  const kotlin = readFileSync(
    "apps/faithful-android/core/attendance/src/main/kotlin/io/faithform/faithful/attendance/EvidenceMachine.kt",
    "utf8",
  );
  assert.match(swift, /pendingAttemptLifetime: TimeInterval = 2 \* 60 \* 60/);
  assert.match(kotlin, /PENDING_ATTEMPT_LIFETIME_MILLIS = 2L \* 60 \* 60 \* 1000/);
});

// ---------------------------------------------------------------------------
// Proof the sweep bites
// ---------------------------------------------------------------------------

/**
 * Runs `body` against a copy of a real source file with a violation injected
 * into it, and hands back the copy's path.
 *
 * These proofs used to write the violation into the working tree and restore it
 * in a `finally`. That is a race: `node --test` runs test *files* in parallel
 * processes, and several of them sweep the same native tree, so a sweep in one
 * file could read another file's injection mid-flight. It did — once in eight
 * runs under load, `AVAssetDownloadTask` in `AVPlayerAdapter.swift`. It also
 * meant an interrupted run could leave an injected violation in a tracked file.
 *
 * A copy proves exactly the same thing — the sweep reads real source text and
 * catches the symbol — without touching anything anyone else can see.
 */
function withInjectedCopy<T>(
  sourcePath: string,
  mutate: (original: string) => string,
  body: (injectedPath: string) => T,
): T {
  const original = readFileSync(sourcePath, "utf8");
  const injected = mutate(original);
  assert.notEqual(injected, original, `the injection did not change ${sourcePath}`);

  const directory = mkdtempSync(join(tmpdir(), "faithform-sweep-"));
  const injectedPath = join(directory, basename(sourcePath));
  try {
    writeFileSync(injectedPath, injected);
    return body(injectedPath);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("the sweep fails on an injected violation", () => {
  // A green sweep that cannot fail is not evidence. This injects a real
  // continuous-location call into a real source file, re-runs the real sweep,
  // requires it to catch it, and restores the file byte-for-byte.
  const target =
    "apps/faithful-android/app/src/main/kotlin/io/faithform/faithful/attendance/PlayServicesGeofencing.kt";

  assert.ok(PRODUCTION_NATIVE.includes(target), `the walk never reached ${target}`);
  assert.deepEqual(sweep(["requestLocationUpdates"]), [], "already failing before injection");

  withInjectedCopy(
    target,
    (original) =>
      original.replace(
        "class PlayServicesLocationSampling(",
        "private fun leak() { client.requestLocationUpdates() }\n\nclass PlayServicesLocationSampling(",
      ),
    (injectedPath) => {
      const caught = sweep(["requestLocationUpdates"], [...PRODUCTION_NATIVE, injectedPath]);
      assert.equal(caught.length, 1, "the sweep did not catch an injected violation");
      assert.equal(caught[0].symbol, "requestLocationUpdates");
      assert.ok(caught[0].file.endsWith("PlayServicesGeofencing.kt"));
    },
  );
  assert.deepEqual(sweep(["requestLocationUpdates"]), []);
});

test("a comment mentioning a forbidden symbol is not a violation", () => {
  // The counterpart risk: these files explain at length *why* the continuous
  // APIs are absent, and a sweep that matched prose would be a permanent false
  // positive that eventually gets deleted rather than fixed.
  const withComment = stripComments(
    `// startUpdatingLocation is deliberately absent.\n/** requestLocationUpdates too. */\nval x = 1`,
    "Example.kt",
  );
  assert.ok(!withComment.includes("startUpdatingLocation"));
  assert.ok(!withComment.includes("requestLocationUpdates"));

  // And real code still matches.
  assert.ok(stripComments("manager.startUpdatingLocation()", "x.swift").includes("startUpdatingLocation"));
});

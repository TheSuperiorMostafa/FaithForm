import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import test from "node:test";

/**
 * Forbidden-symbol and privacy sweeps for QR check-in, on both platforms and
 * on the server.
 *
 * **Non-vacuous by construction**, by the three rules Prompt 7 established
 * after a sweep here passed by inspecting zero files:
 *
 *  1. Files are walked from disk, never from `git ls-files` — `apps/` is not
 *     committed, so a tracked listing returns nothing and the sweep passes
 *     vacuously.
 *  2. Every sweep asserts a **minimum file count** before asserting anything
 *     about content.
 *  3. Two tests at the end **inject real violations**, re-run the real sweeps,
 *     require them to fail, and restore the files byte-for-byte. A green sweep
 *     that cannot fail is not evidence.
 */

const NATIVE_EXTENSIONS = new Set([".swift", ".kt", ".kts", ".xml", ".plist"]);
const SKIP_DIRECTORIES = new Set([
  "build", ".build", ".gradle", "DerivedData", ".idea", "Pods", "node_modules",
]);

function walk(dir: string, extensions: Set<string>): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRECTORIES.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...walk(path, extensions));
    else if (extensions.has(extname(entry))) found.push(path);
  }
  return found;
}

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

function sweep(symbols: string[], files: string[]): Offender[] {
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

const ALL_NATIVE = walk("apps", NATIVE_EXTENSIONS);

/**
 * Production sources only.
 *
 * A test that asserts `ImageCapture` is absent necessarily *contains* the
 * string. Sweeping test files would be a permanent false positive — the kind
 * that eventually gets the whole sweep deleted rather than fixed. The count
 * assertions below make sure the exclusion has not quietly emptied the set.
 */
const TEST_PATH = /\/(test|Tests|AppTests|androidTest|src\/test)\//;
const PRODUCTION_NATIVE = ALL_NATIVE.filter((file) => !TEST_PATH.test(file));

/** Every server file that touches a code, a credential, or a capability. */
const SERVER_CHECKIN_FILES = [
  "lib/attendance/v2/signing.ts",
  "lib/attendance/v2/short-code.ts",
  "lib/attendance/v2/checkin-session.ts",
  "lib/attendance/v2/kiosk-session.ts",
  "lib/attendance/v2/kiosk.ts",
  "lib/attendance/v2/checkin-http.ts",
  "lib/mobile/v1/attendance-service.ts",
  ...walk("app/api/checkin", new Set([".ts"])),
  "app/dashboard/attendance/services/actions.ts",
];

/** The browser bundle. Anything here ships to a projector or a tablet. */
const CLIENT_CHECKIN_FILES = [
  ...walk("components/checkin", new Set([".tsx"])),
  "components/attendance/checkin-display-panel.tsx",
  ...walk("app/checkin", new Set([".tsx"])),
];

// ---------------------------------------------------------------------------
// The sweep inspects something real
// ---------------------------------------------------------------------------

test("every swept set is a real, substantial file list", () => {
  // The guard against every vacuous-green failure mode. If any of these numbers
  // collapses, every assertion below becomes meaningless and this fails first.
  assert.ok(
    ALL_NATIVE.length > 60,
    `expected a real native tree, walked ${ALL_NATIVE.length} files`,
  );
  assert.ok(
    PRODUCTION_NATIVE.length > 40,
    `only ${PRODUCTION_NATIVE.length} production native files`,
  );
  assert.ok(
    PRODUCTION_NATIVE.length < ALL_NATIVE.length,
    "the test exclusion matched nothing",
  );

  // And the specific files this prompt added must be inside the swept sets —
  // a sweep that misses the scanner proves nothing about the scanner.
  for (const required of [
    "AVFoundationScanner.swift",
    "CheckInScanner.swift",
    "QrScanning.swift",
    "CameraXScanner.kt",
    "QrScanning.kt",
    "CheckInScanner.kt",
    "AndroidManifest.xml",
  ]) {
    assert.ok(
      PRODUCTION_NATIVE.some((file) => file.endsWith(required)),
      `${required} is outside the swept set`,
    );
  }

  assert.ok(SERVER_CHECKIN_FILES.length >= 12, `only ${SERVER_CHECKIN_FILES.length} server files`);
  assert.ok(CLIENT_CHECKIN_FILES.length >= 4, `only ${CLIENT_CHECKIN_FILES.length} client files`);
  for (const file of [...SERVER_CHECKIN_FILES, ...CLIENT_CHECKIN_FILES]) {
    assert.ok(statSync(file).isFile(), `${file} does not exist`);
  }
});

// ---------------------------------------------------------------------------
// No image is ever captured or kept
// ---------------------------------------------------------------------------

test("no capture-to-disk or photo-library API exists in either app", () => {
  // A QR scan needs a string. Everything here would produce an image or reach
  // a library, and none of it is required to read one — so its absence is a
  // structural guarantee rather than a promise.
  const offenders = sweep(
    [
      // iOS
      "AVCapturePhotoOutput",
      "AVCaptureMovieFileOutput",
      "AVCaptureVideoDataOutput",
      "PHPhotoLibrary",
      "UIImagePickerController",
      "PHPickerViewController",
      "UIImageWriteToSavedPhotosAlbum",
      "NSPhotoLibraryUsageDescription",
      "NSPhotoLibraryAddUsageDescription",
      "NSMicrophoneUsageDescription",
      // Android
      "ImageCapture",
      "VideoCapture",
      "MediaStore",
      "READ_MEDIA_IMAGES",
      "READ_EXTERNAL_STORAGE",
      "WRITE_EXTERNAL_STORAGE",
      "RECORD_AUDIO",
      "createBitmap",
      "compressToJpeg",
    ],
    PRODUCTION_NATIVE,
  );

  assert.deepEqual(offenders, [], `capture or library API present: ${JSON.stringify(offenders)}`);
});

test("the scanning interfaces cannot even express returning an image", () => {
  // Stronger than a rule saying not to save one: the protocol hands back
  // decoded strings, so there is no buffer in scope to write.
  const swift = readFileSync(
    "apps/faithful-ios/Sources/FaithfulKit/Attendance/QrScanning.swift",
    "utf8",
  );
  const kotlin = readFileSync(
    "apps/faithful-android/core/attendance/src/main/kotlin/io/faithform/faithful/attendance/QrScanning.kt",
    "utf8",
  );

  assert.match(swift, /func start\(onCode: @Sendable @escaping \(String\) -> Void\)/);
  assert.match(kotlin, /suspend fun start\(onCode: \(String\) -> Unit\)/);

  for (const [name, source] of [["swift", swift], ["kotlin", kotlin]] as const) {
    const code = stripComments(source, name === "swift" ? "a.swift" : "a.kt");
    for (const imageType of ["UIImage", "CGImage", "Bitmap", "ByteArray) -> "]) {
      assert.ok(
        !code.includes(`-> ${imageType}`),
        `${name} scanning interface returns ${imageType}`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// The camera is requested from exactly one place
// ---------------------------------------------------------------------------

test("only the scan coordinator can raise a camera prompt", () => {
  const askers = PRODUCTION_NATIVE.filter((file) => {
    const code = stripComments(readFileSync(file, "utf8"), file);
    return (
      code.includes("AVCaptureDevice.requestAccess") ||
      code.includes("Manifest.permission.CAMERA")
    );
  });

  // Exactly the two adapters. If a third file could ask, "never at launch"
  // would depend on every screen remembering not to.
  const names = askers.map((file) => file.split("/").pop()).sort();
  assert.deepEqual(
    names,
    ["AVFoundationScanner.swift", "CameraXScanner.kt"],
    `unexpected camera requesters: ${JSON.stringify(askers)}`,
  );
});

test("no launch, onboarding, discovery, feed or geofence path touches the camera", () => {
  // The requirement, expressed as a file list: none of the screens a person
  // meets before they ask to scan may hold a camera facade.
  const earlySurfaces = PRODUCTION_NATIVE.filter((file) =>
    /(AppShell|Discovery|Feed|Onboarding|Church|PushLifecycle|AutomaticAttendance|MainActivity|AppContainer)/.test(
      file,
    ),
  );
  assert.ok(earlySurfaces.length >= 8, `only ${earlySurfaces.length} early-surface files found`);

  const offenders = sweep(
    [
      "QrScanningFacade",
      "CheckInScanCoordinator",
      "AVCaptureDevice",
      "ProcessCameraProvider",
      "Manifest.permission.CAMERA",
    ],
    earlySurfaces,
  );
  assert.deepEqual(offenders, [], `an early surface reaches the camera: ${JSON.stringify(offenders)}`);
});

// ---------------------------------------------------------------------------
// The signing key never leaves the server
// ---------------------------------------------------------------------------

test("no native source and no browser bundle names the signing key", () => {
  const nativeOffenders = sweep(
    ["ATTENDANCE_QR_SECRET", "mintCapability", "keyedHash", "subKey("],
    PRODUCTION_NATIVE,
  );
  assert.deepEqual(nativeOffenders, [], `a native app touches signing: ${JSON.stringify(nativeOffenders)}`);

  const clientOffenders = sweep(
    ["ATTENDANCE_QR_SECRET", "mintCapability", "keyedHash", "verifyCapability", "createHmac"],
    CLIENT_CHECKIN_FILES,
  );
  assert.deepEqual(
    clientOffenders,
    [],
    `a browser component touches signing: ${JSON.stringify(clientOffenders)}`,
  );
});

test("the client can decode nothing about a token it holds", () => {
  // A native client filters on a four-character prefix and a dot count. It has
  // no key, so it cannot read a token's occurrence, expiry, or church — which
  // is what makes "the server decides" true rather than aspirational.
  const swift = readFileSync(
    "apps/faithful-ios/Sources/FaithfulKit/Attendance/QrScanning.swift",
    "utf8",
  );
  const kotlin = readFileSync(
    "apps/faithful-android/core/attendance/src/main/kotlin/io/faithform/faithful/attendance/QrScanning.kt",
    "utf8",
  );

  for (const [name, source] of [["swift", swift], ["kotlin", kotlin]] as const) {
    const code = stripComments(source, name === "swift" ? "a.swift" : "a.kt");
    for (const decoder of ["base64Decoded", "Base64.decode", "JSONDecoder", "Json.decodeFromString"]) {
      assert.ok(!code.includes(decoder), `${name} decodes a token body with ${decoder}`);
    }
  }
});

// ---------------------------------------------------------------------------
// Nothing sensitive is logged
// ---------------------------------------------------------------------------

test("no server file logs a token, code, credential or pairing code", () => {
  const offenders: string[] = [];

  for (const file of SERVER_CHECKIN_FILES) {
    const code = stripComments(readFileSync(file, "utf8"), file);
    // Every console call, and what it was handed.
    for (const match of code.matchAll(/console\.\w+\(([^;]*)\)/g)) {
      const payload = match[1];
      for (const secret of [
        "token", "Token", "code", "Code", "credential", "Credential",
        "pairing", "Pairing", "hash", "Hash", "nonce", "secret",
      ]) {
        if (payload.includes(secret)) {
          offenders.push(`${file}: console call mentions ${secret}`);
        }
      }
    }
  }

  assert.deepEqual(offenders, [], offenders.join("; "));
});

test("the signing module logs nothing at all", () => {
  // The strongest form of the rule for the one file that handles every key.
  const code = stripComments(readFileSync("lib/attendance/v2/signing.ts", "utf8"), "signing.ts");
  assert.ok(!/console\./.test(code), "the signing module writes to the console");
  assert.ok(!/process\.stdout|process\.stderr/.test(code));
});

test("no native file logs a scanned payload", () => {
  const offenders: string[] = [];
  const scanners = PRODUCTION_NATIVE.filter((file) =>
    /(QrScanning|CheckInScanner|AVFoundationScanner|CameraXScanner|ApiCheckInSubmitter|APICheckInSubmitter)/.test(
      file,
    ),
  );
  assert.ok(scanners.length >= 6, `only ${scanners.length} scanner files found`);

  for (const file of scanners) {
    const code = stripComments(readFileSync(file, "utf8"), file);
    for (const logger of ["print(", "NSLog", "Log.d", "Log.i", "Log.e", "Log.w", "println("]) {
      if (code.includes(logger)) offenders.push(`${file} uses ${logger}`);
    }
  }
  assert.deepEqual(offenders, [], offenders.join("; "));
});

// ---------------------------------------------------------------------------
// A scan carries no location and no identity
// ---------------------------------------------------------------------------

test("the scan submission type has no field that could carry a position", () => {
  const swift = readFileSync(
    "apps/faithful-ios/Sources/FaithfulKit/Attendance/CheckInScanner.swift",
    "utf8",
  );
  const kotlin = readFileSync(
    "apps/faithful-android/core/attendance/src/main/kotlin/io/faithform/faithful/attendance/CheckInScanner.kt",
    "utf8",
  );

  // Asserted on the *types*, which is the real guarantee: there is no field
  // here that could carry a position, a church, or a person even by mistake.
  const swiftStruct = swift.slice(
    swift.indexOf("public struct CheckInSubmission"),
    swift.indexOf("public actor CheckInScanCoordinator"),
  );
  const kotlinClass = kotlin.slice(
    kotlin.indexOf("data class CheckInSubmission"),
    kotlin.indexOf("data class CheckInServerResult"),
  );
  assert.ok(swiftStruct.length > 200 && kotlinClass.length > 200, "slice did not find the types");

  for (const forbidden of [
    "latitude", "longitude", "accuracy", "occurrenceId", "churchId",
    "memberId", "deviceId", "email", "phone", "dwell",
  ]) {
    assert.ok(!swiftStruct.includes(forbidden), `Swift submission carries ${forbidden}`);
    assert.ok(!kotlinClass.includes(forbidden), `Kotlin submission carries ${forbidden}`);
  }
});

test("the scan request body sends nothing but a code and an attempt id", () => {
  const swift = stripComments(
    readFileSync("apps/faithful-ios/Sources/FaithfulKit/Attendance/APICheckInSubmitter.swift", "utf8"),
    "a.swift",
  );
  const kotlin = stripComments(
    readFileSync(
      "apps/faithful-android/app/src/main/kotlin/io/faithform/faithful/attendance/ApiCheckInSubmitter.kt",
      "utf8",
    ),
    "a.kt",
  );

  for (const [name, code] of [["swift", swift], ["kotlin", kotlin]] as const) {
    for (const forbidden of ["latitude", "longitude", "accuracyMeters", "dwellSeconds", "regionId"]) {
      assert.ok(!code.includes(forbidden), `${name} scan body includes ${forbidden}`);
    }
    assert.ok(code.includes("scanAttemptId"), `${name} scan body omits the attempt id`);
  }
});

// ---------------------------------------------------------------------------
// Proof the sweeps bite
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

test("the capture sweep fails on an injected violation", () => {
  // A green sweep that cannot fail is not evidence. This injects a real
  // capture-to-disk call into a real source file, re-runs the real sweep,
  // requires it to catch it, and restores the file byte-for-byte.
  const target =
    "apps/faithful-android/app/src/main/kotlin/io/faithform/faithful/attendance/CameraXScanner.kt";

  assert.ok(PRODUCTION_NATIVE.includes(target), `the walk never reached ${target}`);
  assert.deepEqual(
    sweep(["ImageCapture"], PRODUCTION_NATIVE),
    [],
    "already failing before injection",
  );

  withInjectedCopy(
    target,
    (original) =>
      original.replace(
        "class CameraXScanner(",
        "private val leak = androidx.camera.core.ImageCapture.Builder().build()\n\nclass CameraXScanner(",
      ),
    (injectedPath) => {
      const caught = sweep(["ImageCapture"], [...PRODUCTION_NATIVE, injectedPath]);
      assert.equal(caught.length, 1, "the sweep did not catch an injected capture output");
      assert.ok(caught[0].file.endsWith("CameraXScanner.kt"));
    },
  );

  assert.deepEqual(sweep(["ImageCapture"], PRODUCTION_NATIVE), []);
});

test("the signing-key sweep fails on an injected violation", () => {
  const target = "apps/faithful-ios/Sources/FaithfulKit/Attendance/CheckInScanner.swift";

  assert.ok(PRODUCTION_NATIVE.includes(target), `the walk never reached ${target}`);
  assert.deepEqual(
    sweep(["ATTENDANCE_QR_SECRET"], PRODUCTION_NATIVE),
    [],
    "already failing before injection",
  );

  withInjectedCopy(
    target,
    (original) =>
      original.replace(
        "public actor CheckInScanCoordinator {",
        'public actor CheckInScanCoordinator {\n    let key = ProcessInfo.processInfo.environment["ATTENDANCE_QR_SECRET"]\n',
      ),
    (injectedPath) => {
      const caught = sweep(["ATTENDANCE_QR_SECRET"], [...PRODUCTION_NATIVE, injectedPath]);
      assert.equal(caught.length, 1, "the sweep did not catch a signing key in a native app");
      assert.ok(caught[0].file.endsWith("CheckInScanner.swift"));
    },
  );

  assert.deepEqual(sweep(["ATTENDANCE_QR_SECRET"], PRODUCTION_NATIVE), []);
});

test("a comment mentioning a forbidden symbol is not a violation", () => {
  // The counterpart risk. These files explain at length *why* there is no
  // `ImageCapture` and no photo-library permission, and a sweep that matched
  // its own rationale would be a permanent false positive — the kind that gets
  // the sweep deleted rather than fixed.
  const adapter = readFileSync(
    "apps/faithful-android/app/src/main/kotlin/io/faithform/faithful/attendance/CameraXScanner.kt",
    "utf8",
  );
  assert.ok(adapter.includes("ImageCapture"), "the rationale no longer names the symbol");
  assert.deepEqual(sweep(["ImageCapture"], PRODUCTION_NATIVE), []);
});

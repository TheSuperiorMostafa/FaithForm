import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import test from "node:test";

/**
 * Forbidden-symbol and privacy sweeps for published media and secure playback.
 *
 * **Non-vacuous by construction**, by the three rules Prompt 7 established after
 * a sweep here passed by inspecting zero files:
 *
 *  1. Files are walked from disk, never from `git ls-files` — `apps/` is not
 *     committed, so a tracked listing returns nothing and the sweep passes
 *     vacuously.
 *  2. Every sweep asserts a **minimum file count** before asserting anything
 *     about content.
 *  3. Two tests at the end **inject real violations**, re-run the real sweeps,
 *     require them to fail, and restore the files byte-for-byte.
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

const read = (path: string) => readFileSync(path, "utf8");

const ALL_NATIVE = walk("apps", NATIVE_EXTENSIONS);
const TEST_PATH = /\/(test|Tests|AppTests|androidTest|src\/test)\//;
const PRODUCTION_NATIVE = ALL_NATIVE.filter((file) => !TEST_PATH.test(file));

const NATIVE_MEDIA = PRODUCTION_NATIVE.filter((file) =>
  /(Media|Player|media)/.test(file),
);

const SERVER_MEDIA_FILES = [
  "lib/media/v1/playback-capability.ts",
  "lib/media/v1/media-service.ts",
  "lib/media/v1/publication.ts",
  "lib/media/v1/rendition.ts",
  "lib/media/v1/rendition-check.ts",
  "lib/stream/relay-upstream.ts",
  ...walk("app/api/media", new Set([".ts"])),
  ...walk("app/api/mobile/v1/media", new Set([".ts"])),
  "app/dashboard/live-streaming/faithful-actions.ts",
];

const CLIENT_MEDIA_FILES = ["components/live-streaming/faithful-publishing-panel.tsx"];

// ---------------------------------------------------------------------------
// Non-vacuity
// ---------------------------------------------------------------------------

test("every swept set is a real, substantial file list", () => {
  assert.ok(ALL_NATIVE.length > 60, `walked only ${ALL_NATIVE.length} native files`);
  assert.ok(PRODUCTION_NATIVE.length > 40, `only ${PRODUCTION_NATIVE.length} production files`);
  assert.ok(PRODUCTION_NATIVE.length < ALL_NATIVE.length, "the test exclusion matched nothing");
  assert.ok(NATIVE_MEDIA.length >= 6, `only ${NATIVE_MEDIA.length} native media files`);
  assert.ok(SERVER_MEDIA_FILES.length >= 10, `only ${SERVER_MEDIA_FILES.length} server files`);

  // The specific files this prompt added must be inside the swept sets — a
  // sweep that misses the player proves nothing about the player.
  for (const required of [
    "AVPlayerAdapter.swift",
    "MediaPlayback.swift",
    "MediaPlaybackCoordinator.swift",
    "Media3PlayerAdapter.kt",
    "MediaPlayback.kt",
  ]) {
    assert.ok(
      PRODUCTION_NATIVE.some((file) => file.endsWith(required)),
      `${required} is outside the swept set`,
    );
  }
  for (const file of [...SERVER_MEDIA_FILES, ...CLIENT_MEDIA_FILES]) {
    assert.ok(statSync(file).isFile(), `${file} does not exist`);
  }
});

// ---------------------------------------------------------------------------
// A capability never enters a URL
// ---------------------------------------------------------------------------

test("the delivery URL carries no credential, and there is no query fallback", () => {
  const capability = stripComments(read("lib/media/v1/playback-capability.ts"), "a.ts");
  const service = stripComments(read("lib/media/v1/media-service.ts"), "a.ts");

  // The reader accepts a bearer header and nothing else.
  assert.match(capability, /export function capabilityFromRequest/);
  assert.match(capability, /scheme\?\.toLowerCase\(\) !== "bearer"/);
  assert.ok(
    !/searchParams\.get\(\s*["']cap/.test(capability),
    "the media capability has a query-string fallback",
  );

  // And nothing appends one to a delivery URL.
  const grant = service.slice(service.indexOf("deliveryUrl:"), service.indexOf("kind: input.kind"));
  assert.ok(grant.length > 40);
  for (const forbidden of ["capability", "issued.token", "?cap", "token="]) {
    assert.ok(!grant.includes(forbidden), `the delivery URL carries ${forbidden}`);
  }
});

test("the native live route never rewrites a capability into segment URLs", () => {
  const route = stripComments(read("app/api/media/v1/live/[...path]/route.ts"), "a.ts");

  // The website's route passes `cap=…` to the rewriter so a browser player can
  // fetch segments. Passing anything here would put Faithful's capability into
  // every segment URL, which is what the header strategy exists to avoid.
  assert.match(route, /rewriteM3u8Playlist\(playlist, request\.nextUrl\.pathname\)/);
  assert.ok(!/rewriteM3u8Playlist\([^)]*cap/.test(route));
});

test("neither native player puts a capability in a URL", () => {
  const swift = stripComments(
    read("apps/faithful-ios/Sources/FaithfulKit/Media/AVPlayerAdapter.swift"),
    "a.swift",
  );
  const kotlin = stripComments(
    read("apps/faithful-android/app/src/main/kotlin/io/faithform/faithful/media/Media3PlayerAdapter.kt"),
    "a.kt",
  );

  // iOS: a resource loader that sets the header on each request it issues.
  assert.match(swift, /forHTTPHeaderField: "Authorization"/);
  assert.match(swift, /AVAssetResourceLoaderDelegate/);
  // Android: default request properties, which Media3 applies to every
  // request. The header itself is built by `CapabilityHeaders` in
  // `:core:media`, so the adapter hands over a live view rather than composing
  // a header of its own.
  assert.match(kotlin, /setDefaultRequestProperties\(headers\.mutableView\(\)\)/);
  const headers = stripComments(
    read("apps/faithful-android/core/media/src/main/kotlin/io/faithform/faithful/media/MediaPlayback.kt"),
    "a.kt",
  );
  assert.match(headers, /headers\["Authorization"\] = "Bearer \$capability"/);

  for (const [name, code] of [["swift", swift], ["kotlin", kotlin]] as const) {
    for (const forbidden of ["?cap=", "&cap=", "queryItems", "appendingQuery"]) {
      assert.ok(!code.includes(forbidden), `${name} player builds a URL with ${forbidden}`);
    }
  }
});

test("no native source uses the undocumented header key", () => {
  // `AVURLAssetHTTPHeaderFieldsKey` would attach a header without a resource
  // loader, and is private API — a review rejection waiting to happen.
  assert.deepEqual(
    sweep(["AVURLAssetHTTPHeaderFieldsKey", "AVURLAssetHTTPCookiesKey"], PRODUCTION_NATIVE),
    [],
  );
});

// ---------------------------------------------------------------------------
// No provider detail reaches a client
// ---------------------------------------------------------------------------

test("no projection returns a storage path, a signed URL, or a relay identifier", () => {
  const service = stripComments(read("lib/media/v1/media-service.ts"), "a.ts");

  // The one place a storage path is read is `authorizeDelivery`, which is
  // called by the delivery route and returns to the server, not to a client.
  const projections = service.slice(0, service.indexOf("export async function grantPlayback"));
  for (const forbidden of ["storage_path", "storagePath", "signedUrl", "streamPath", "createSignedUrl"]) {
    assert.ok(!projections.includes(forbidden), `a projection returns ${forbidden}`);
  }

  // And the SQL agrees: the list and detail functions do not select it.
  const migration = read("supabase/migrations/0060_faithful_media_publication.sql");
  const archive = migration.slice(
    migration.indexOf("function public.mobile_media_archive"),
    migration.indexOf("function public.mobile_media_detail"),
  );
  assert.ok(archive.length > 500);
  assert.ok(!archive.includes("r.storage_path"), "the archive projection returns a storage path");
});

test("the recording route derives its path from the database, never the request", () => {
  const route = stripComments(
    read("app/api/media/v1/recording/[slug]/[id]/route.ts"),
    "a.ts",
  );

  assert.match(route, /authorized\.storagePath/);
  assert.match(route, /createSignedUrl\(authorized\.storagePath, 60\)/);
  // A path taken from the request would be a traversal into another church's
  // recordings; the route's only input is a recording id.
  assert.ok(!/params.*storagePath|searchParams.*path/.test(route));
  // And the signed URL is used here and never returned.
  assert.ok(!/return.*signed\.signedUrl/.test(route));
  assert.ok(!/redirect\(/.test(route), "the route redirects to a provider URL");
});

test("no client-visible error names a provider, a host, or a status", () => {
  for (const file of [
    "app/api/media/v1/recording/[slug]/[id]/route.ts",
    "app/api/media/v1/live/[...path]/route.ts",
  ]) {
    const code = stripComments(read(file), "a.ts");
    const messages = [...code.matchAll(/error:\s*"([^"]+)"/g)].map((m) => m[1]);
    assert.ok(messages.length >= 2, `${file} returns no error bodies at all`);

    for (const message of messages) {
      for (const leak of ["supabase", "http", "bucket", "relay", "mediamtx", "upstream", "://"]) {
        assert.ok(
          !message.toLowerCase().includes(leak),
          `${file} error "${message}" leaks ${leak}`,
        );
      }
    }
    // The upstream body is never forwarded.
    assert.ok(!/upstream\.text\(\).*return|body: upstream/.test(code));
  }
});

// ---------------------------------------------------------------------------
// Nothing sensitive is logged
// ---------------------------------------------------------------------------

test("no server media file logs a capability, a path, or a signed URL", () => {
  const offenders: string[] = [];
  for (const file of SERVER_MEDIA_FILES) {
    const code = stripComments(read(file), file);
    for (const match of code.matchAll(/console\.\w+\(([^;]*)\)/g)) {
      const payload = match[1];
      for (const secret of [
        "capability", "token", "signed", "storage", "path", "url", "Url", "URL", "secret",
      ]) {
        if (payload.includes(secret)) offenders.push(`${file}: console call mentions ${secret}`);
      }
    }
  }
  assert.deepEqual(offenders, [], offenders.join("; "));
});

test("the capability module logs nothing at all", () => {
  const code = stripComments(read("lib/media/v1/playback-capability.ts"), "a.ts");
  assert.ok(!/console\./.test(code), "the capability module writes to the console");
  assert.ok(!/process\.stdout|process\.stderr/.test(code));
});

test("no native media file logs anything", () => {
  const offenders: string[] = [];
  for (const file of NATIVE_MEDIA) {
    const code = stripComments(read(file), file);
    for (const logger of ["print(", "NSLog", "debugPrint", "Log.d(", "Log.i(", "Log.e(", "Log.w(", "println("]) {
      if (code.includes(logger)) offenders.push(`${file} uses ${logger}`);
    }
  }
  assert.deepEqual(offenders, [], offenders.join("; "));
});

test("no native media file persists a capability", () => {
  // The one thing that must never reach disk. `URLSessionConfiguration.ephemeral`
  // and the absence of a cache data source are what make that structural.
  const swift = stripComments(
    read("apps/faithful-ios/Sources/FaithfulKit/Media/AVPlayerAdapter.swift"),
    "a.swift",
  );
  assert.match(swift, /URLSessionConfiguration\.ephemeral/);
  assert.match(swift, /configuration\.urlCache = nil/);
  assert.match(swift, /httpCookieStorage = nil/);

  assert.deepEqual(
    sweep(
      ["UserDefaults", "CacheDataSource", "SimpleCache", "DownloadManager", "DownloadService"],
      NATIVE_MEDIA,
    ),
    [],
  );
});

// ---------------------------------------------------------------------------
// Cache, ETag and cursor discipline
// ---------------------------------------------------------------------------

test("the capability route is no-store and carries no validator", () => {
  const route = stripComments(read("app/api/mobile/v1/media/playback/route.ts"), "a.ts");
  assert.match(route, /cache: "private-no-store"/);
  // A credential must never be revalidated out of a cache.
  assert.ok(!route.includes("computeEtag"));
  assert.ok(!route.includes("etagMatches"));
});

test("every list and detail route computes a semantic ETag over its own fields", () => {
  for (const file of [
    "app/api/mobile/v1/media/[slug]/live/route.ts",
    "app/api/mobile/v1/media/[slug]/archive/route.ts",
    "app/api/mobile/v1/media/[slug]/item/[id]/route.ts",
  ]) {
    const code = stripComments(read(file), file);
    assert.match(code, /computeEtag\(\{/, file);
    assert.match(code, /etagMatches\(request\.headers\.get\("if-none-match"\), etag\)/, file);
    // The relationship scope is folded in: the same church at the same version
    // shows different things to a follower and to a stranger.
    assert.match(code, /scope: userId \? "member" : "anonymous"/, file);
    // Never a timestamp. Two servers with clock skew must agree.
    assert.ok(!/Date\.now\(\)|new Date\(\)/.test(code), `${file} folds server time into its ETag`);
  }
});

test("the archive cursor has its own kind", () => {
  const code = read("app/api/mobile/v1/media/[slug]/archive/route.ts");
  assert.match(code, /const CURSOR_KIND = "media-archive"/);
  assert.match(code, /decodeCursor\(url\.searchParams\.get\("cursor"\), CURSOR_KIND\)/);
  // `decodeCursor` refuses a mismatched kind, so a feed cursor cannot page the
  // archive and an archive cursor cannot page the feed.
  const protocol = read("lib/mobile/v1/protocol.ts");
  assert.match(protocol, /parsed\.k !== expectedKind/);
});

test("the client caches projections but never a capability", () => {
  const client = stripComments(
    read("apps/faithful-ios/Sources/FaithfulKit/Media/MediaClient.swift"),
    "a.swift",
  );
  const grant = client.slice(client.indexOf("public func grant("));
  assert.ok(grant.length > 200);
  assert.ok(!grant.includes("cache.store"), "the grant is cached");
  assert.ok(!grant.includes("ifNoneMatch"), "the grant is revalidated");
});

// ---------------------------------------------------------------------------
// Publication is never inferred
// ---------------------------------------------------------------------------

test("only a staff action sets a publication timestamp", () => {
  // Not a webhook, not a filename, not a provider URL.
  const webhook = stripComments(read("app/api/stream/recording-complete/route.ts"), "a.ts");
  for (const forbidden of ["mobile_visibility", "mobile_published_at", "publishToFaithful"]) {
    assert.ok(!webhook.includes(forbidden), `the relay webhook sets ${forbidden}`);
  }

  const publication = stripComments(read("lib/media/v1/publication.ts"), "a.ts");
  assert.match(publication, /actorUserId: string/);
  assert.match(publication, /writeAudit\(/);
});

test("publishing requires an admin and an exact tenant predicate", () => {
  const actions = stripComments(read("app/dashboard/live-streaming/faithful-actions.ts"), "a.ts");
  assert.match(actions, /if \(!auth\.isAdmin\)/);
  assert.match(actions, /const auth = await requireAdmin\(\)/);

  const publication = stripComments(read("lib/media/v1/publication.ts"), "a.ts");
  // An id from another church matches nothing rather than being published by a
  // guess.
  const publish = publication.slice(publication.indexOf("export async function publishToFaithful"));
  assert.match(publish, /\.eq\("church_id", input\.churchId\)/);
});

test("a poster is validated against the church's own assets", () => {
  const publication = stripComments(read("lib/media/v1/publication.ts"), "a.ts");
  assert.match(publication, /export async function resolvePoster/);
  assert.match(publication, /allowed\.some\(\(choice\) => choice\.url === requested\)/);
  // A poster field that takes any URL is an open redirect and a hotlink vector
  // on every visitor's phone.
  assert.ok(!/z\.string\(\)\.url\(\)/.test(publication));
});

// ---------------------------------------------------------------------------
// Prompt 2 is not weakened
// ---------------------------------------------------------------------------

test("the relay credential is assembled server-side and never returned", () => {
  const upstream = stripComments(read("lib/stream/relay-upstream.ts"), "a.ts");
  assert.match(upstream, /STREAM_RELAY_PLAYBACK_SECRET/);
  assert.match(upstream, /Authorization: authorization/);
  // Nothing hands it back.
  assert.ok(!/return[^;]*authorization[^;]*;/.test(upstream.replace(/const authorization[^;]*;/g, "")));

  const routes = [
    "app/api/stream/hls/[...path]/route.ts",
    "app/api/media/v1/live/[...path]/route.ts",
  ];
  for (const route of routes) {
    const code = stripComments(read(route), route);
    assert.match(code, /fetchFromRelay\(\{/, `${route} does not use the shared relay module`);
    assert.ok(
      !code.includes("faithform-playback:"),
      `${route} builds its own relay credential`,
    );
  }
});

test("both live routes validate path segments before forwarding", () => {
  const upstream = read("lib/stream/relay-upstream.ts");
  assert.match(upstream, /segment === "\.\."/);
  assert.match(upstream, /segment\.includes\("\\\\"\)/);
  assert.match(upstream, /segment\.includes\(":"\)/);

  for (const route of [
    "app/api/stream/hls/[...path]/route.ts",
    "app/api/media/v1/live/[...path]/route.ts",
  ]) {
    assert.match(read(route), /segmentsAreSafe\(segments\)/, route);
  }
});

// ---------------------------------------------------------------------------
// Out of scope
// ---------------------------------------------------------------------------

test("no download, cast, chat or donation surface exists in the media path", () => {
  assert.deepEqual(
    sweep(
      [
        "AVAssetDownloadTask", "AVAssetDownloadURLSession", "DownloadManager",
        "DownloadService", "GCKCastContext", "MediaRouter", "RemotePlaybackClient",
        "WKWebView", "StoreKit", "BillingClient",
      ],
      PRODUCTION_NATIVE,
    ),
    [],
  );
});

test("the media contract exposes no view-tracking identity", () => {
  const schema = JSON.parse(read("contracts/faithful/v1/schema.json"));
  const media = JSON.stringify([
    schema.$defs.ArchiveItem,
    schema.$defs.MediaDetail,
    schema.$defs.LiveMedia,
    schema.$defs.PlaybackGrant,
  ]);
  for (const forbidden of ["viewerKey", "viewCount", "watchedBy", "accountId", "deviceId"]) {
    assert.ok(!media.includes(forbidden), `the media contract exposes ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// The mobile-playability gate
// ---------------------------------------------------------------------------

test("eligibility is enforced in four independent places", () => {
  // The dashboard is not allowed to be the only thing between an unplayable
  // file and a congregation. Each of these refuses on its own.
  const migration = read("supabase/migrations/0061_faithful_media_eligibility.sql");
  const sql = migration.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

  // 1 + 2. The list and detail projections.
  for (const fn of ["mobile_media_archive", "mobile_media_detail"]) {
    const body = sql.slice(sql.indexOf(`function public.${fn}`));
    assert.match(
      body.slice(0, body.indexOf("$$;")),
      /and r\.mobile_playable/,
      `${fn} does not filter on playability`,
    );
  }

  // 3. The playback grant, which a stale cached list arrives at.
  const grant = sql.slice(sql.indexOf("function public.mobile_media_playback_grant"));
  assert.match(grant.slice(0, grant.indexOf("$$;")), /and r\.mobile_playable/);

  // 4. The publish itself, in the write rather than before it.
  const publish = sql.slice(sql.indexOf("function public.publish_recording_to_faithful"));
  const publishBody = publish.slice(0, publish.indexOf("$$;"));
  assert.match(publishBody, /update public\.stream_recordings[\s\S]{0,600}and r\.mobile_playable/);

  // And the dashboard, which is the fifth and least trusted.
  const publication = stripComments(read("lib/media/v1/publication.ts"), "a.ts");
  assert.match(publication, /canPublish: row\.status === "ready" && Boolean\(row\.mobile_playable\)/);
});

test("only the verdict function may set playability, and only with evidence", () => {
  const migration = read("supabase/migrations/0061_faithful_media_eligibility.sql");

  // A direct `set mobile_playable = true` cannot satisfy the constraint on its
  // own, so a migration, a console or a mistaken script cannot publish an
  // unverified file.
  assert.match(migration, /stream_recordings_mobile_playable_verified_check/);
  assert.match(
    migration,
    /not mobile_playable[\s\S]{0,200}mobile_rendition_verified_at is not null/,
  );

  // Nothing in the application writes the column directly.
  for (const file of SERVER_MEDIA_FILES) {
    const code = stripComments(read(file), file);
    assert.ok(
      !/mobile_playable\s*[:=]\s*(true|false)/.test(code),
      `${file} sets mobile_playable directly`,
    );
  }
});

test("a playable verdict cannot exist without an object identity", () => {
  const migration = read("supabase/migrations/0062_faithful_media_object_identity.sql");

  // The structural floor. A storage path is mutable — the relay uploads with
  // `x-upsert: true` — so a verdict that names no object is a verdict about
  // nothing, and the constraint refuses to store one.
  assert.match(migration, /stream_recordings_mobile_playable_identity_check/);
  assert.match(
    migration,
    /not mobile_playable[\s\S]{0,400}mobile_rendition_object_hash is not null/,
  );

  // And the two halves are both required: the hash for publication, and a
  // live-comparable discriminator for issuance and delivery.
  assert.match(
    migration,
    /mobile_rendition_object_etag is not null[\s\S]{0,200}mobile_rendition_object_size is not null/,
  );
});

test("the object identity is re-checked in every place that serves bytes", () => {
  // Four places, none of which trusts the path it was handed.
  const publication = stripComments(read("lib/media/v1/publication.ts"), "a.ts");
  assert.match(publication, /renditionIdentityUnchanged\(/, "publish does not re-check");
  assert.match(publication, /invalidate_recording_rendition/, "publish does not withdraw");
  assert.match(publication, /p_expected_object_hash/, "the publish write is not bound to bytes");

  const service = stripComments(read("lib/media/v1/media-service.ts"), "a.ts");
  assert.match(service, /renditionIdentityUnchanged\(/, "the grant does not re-check");
  assert.match(service, /invalidate_recording_rendition/, "the grant does not withdraw");

  const route = stripComments(
    read("app/api/media/v1/recording/[slug]/[id]/route.ts"),
    "a.ts",
  );
  // Pinned *and* checked. Pinning alone trusts a provider to honour `If-Match`;
  // checking alone transfers the wrong bytes first.
  assert.match(route, /If-Match/, "delivery does not pin the request to the object");
  assert.match(route, /identityMatches\(/, "delivery does not check what came back");
  assert.match(route, /412/, "delivery does not handle a refused precondition");
  assert.match(route, /body\?\.cancel\(\)/, "delivery streams a mismatched body anyway");
});

test("a weak validator is never treated as an identity", () => {
  const check = stripComments(read("lib/media/v1/rendition-check.ts"), "a.ts");
  // `W/"..."` promises semantic equivalence, not byte equality. Accepting one
  // would mean accepting exactly the substitution this mechanism detects.
  assert.match(check, /startsWith\("W\/"\)/);
});

test("the codec configuration is read, not the fourcc alone", () => {
  const rendition = stripComments(read("lib/media/v1/rendition.ts"), "a.ts");

  // `avc1` is the same four bytes at Baseline 3.0 and at High 4:4:4 10-bit.
  // `mp4a` is the same four bytes for AAC-LC and for MP3-in-MP4.
  assert.match(rendition, /readAvcConfig/);
  assert.match(rendition, /readAudioConfig/);
  assert.match(rendition, /"avcC"/);
  assert.match(rendition, /"esds"/);

  // And the policy is a separate, readable file rather than constants buried in
  // a box walker.
  const policy = read("lib/media/v1/portable-profile.ts");
  assert.match(policy, /PORTABLE_H264_PROFILES/);
  assert.match(policy, /MAX_H264_LEVEL/);
  assert.match(policy, /PORTABLE_AAC_OBJECT_TYPES/);
  // The bounds are cited against the platform targets the projects declare.
  assert.match(policy, /iOS 17/);
  assert.match(policy, /API 26/);
});

test("the parser is bounded in depth, in boxes and in bytes", () => {
  const rendition = stripComments(read("lib/media/v1/rendition.ts"), "a.ts");
  for (const bound of ["MAX_BOX_DEPTH", "MAX_BOX_COUNT", "MAX_CONTAINER_BOX_BYTES"]) {
    assert.ok(rendition.includes(bound), `the parser has no ${bound}`);
  }
  // **No recursion**: a walk that calls itself is a walk a file's own nesting can
  // drive, and a stack is not a bound anyone chose. Sliced to the function's own
  // body rather than matched across a window, which would flag the *callers*.
  const start = rendition.indexOf("function walkBoxes(");
  assert.ok(start > 0, "walkBoxes was renamed and this sweep went stale");
  const declaration = rendition.slice(start, rendition.indexOf("\nfunction ", start + 1));
  const body = declaration.slice(declaration.indexOf("{"));
  assert.ok(!body.includes("walkBoxes("), "the box walker recurses");

  // The counterpart check: the slice really did land on the function, so a
  // rename cannot turn this into a vacuous pass.
  assert.ok(body.includes("budget.spendBox()"), "the sweep sliced the wrong function");

  const check = stripComments(read("lib/media/v1/rendition-check.ts"), "a.ts");
  // Every storage request is bounded in time as well as in bytes.
  assert.match(check, /AbortController/);
  assert.match(check, /PROBE_TIMEOUT_MS/);
  assert.match(check, /IDENTITY_TIMEOUT_MS/);
  // A timeout is not a verdict.
  assert.match(check, /probe_timeout/);
});

test("eligibility is decided from bytes, not from a name or a claim", () => {
  const check = stripComments(read("lib/media/v1/rendition-check.ts"), "a.ts");

  // Range reads of the object this server holds.
  assert.match(check, /Range: range/);
  assert.match(check, /assessRendition\(/);

  // Never from any of the three claims.
  for (const claim of ["contentType", "content-type", "mimetype", "endsWith(\".mp4\")", "extname"]) {
    assert.ok(!check.includes(claim), `eligibility consults ${claim}`);
  }
  const rendition = stripComments(read("lib/media/v1/rendition.ts"), "a.ts");
  assert.ok(!rendition.includes("filename"), "the parser consults a filename");
});

test("no visitor-facing type carries a codec, a container, or a refusal reason", () => {
  const schema = JSON.parse(read("contracts/faithful/v1/schema.json"));
  const visitorFacing = JSON.stringify([
    schema.$defs.ArchiveItem,
    schema.$defs.MediaDetail,
    schema.$defs.LiveMedia,
    schema.$defs.PlaybackGrant,
    schema.$defs.MediaPage,
  ]);

  // The eligibility *reasons* are staff-facing. A visitor is told the delivery
  // form and nothing else — an ineligible recording is simply absent.
  for (const forbidden of [
    "container", "videoCodec", "audioCodec", "renditionReason", "mobilePlayable",
    "avc1", "mp4a", "isom", "matroska", "verifiedAt", "objectSize",
  ]) {
    assert.ok(!visitorFacing.includes(forbidden), `a visitor DTO exposes ${forbidden}`);
  }

  // The one part that is shared, and is not sensitive.
  assert.match(JSON.stringify(schema.$defs.PlaybackGrant), /renditionKind/);
  assert.deepEqual(schema.$defs.PlaybackGrant.properties.renditionKind.enum, [
    "hls",
    "progressive",
  ]);
});

test("a staff explanation names no codec, brand, bucket or path", () => {
  const rendition = read("lib/media/v1/rendition.ts");
  const explain = rendition.slice(rendition.indexOf("export function staffExplanation"));
  const sentences = [...explain.matchAll(/return "([^"]+)"/g)].map((match) => match[1]);
  assert.ok(sentences.length >= 6, `only ${sentences.length} staff sentences found`);

  for (const sentence of sentences) {
    for (const leak of ["avc1", "hvc1", "mp4a", "isom", "mkv", "matroska", "codec", "bucket", "relay/"]) {
      assert.ok(
        !sentence.toLowerCase().includes(leak.toLowerCase()),
        `"${sentence}" leaks ${leak}`,
      );
    }
  }
});

test("no transcoder was added", () => {
  // The gate reports what is there. Producing a supported rendition is the
  // relay pipeline's job, and inventing one here would be a second recording
  // authority wearing a helpful face.
  assert.deepEqual(
    sweep(
      ["ffmpeg", "fluent-ffmpeg", "transcode", "Transcoder", "MediaConvert", "mediaconvert"],
      SERVER_MEDIA_FILES,
    ),
    [],
  );
  const dependencies = JSON.parse(read("package.json"));
  const declared = Object.keys({
    ...dependencies.dependencies,
    ...dependencies.devDependencies,
  });
  for (const forbidden of ["ffmpeg", "fluent-ffmpeg", "ffmpeg-static", "@ffmpeg/ffmpeg"]) {
    assert.ok(!declared.includes(forbidden), `a transcoder dependency was added: ${forbidden}`);
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

test("the capability-in-URL sweep fails on an injected violation", () => {
  const target = "apps/faithful-android/app/src/main/kotlin/io/faithform/faithful/media/Media3PlayerAdapter.kt";

  const hasQueryCapability = (path: string) =>
    stripComments(readFileSync(path, "utf8"), path).includes("?cap=");

  assert.ok(PRODUCTION_NATIVE.includes(target), `the walk never reached ${target}`);
  assert.equal(hasQueryCapability(target), false, "already failing before injection");

  withInjectedCopy(
    target,
    (original) =>
      original.replace(
        "class Media3PlayerAdapter(",
        'private fun leak(url: String, cap: String) = "$url?cap=$cap"\n\nclass Media3PlayerAdapter(',
      ),
    (injectedPath) => {
      assert.equal(
        hasQueryCapability(injectedPath),
        true,
        "the sweep did not catch a capability in a URL",
      );
    },
  );

  assert.equal(hasQueryCapability(target), false);
});

test("the download sweep fails on an injected violation", () => {
  const target = "apps/faithful-ios/Sources/FaithfulKit/Media/AVPlayerAdapter.swift";

  // The walk finds the real file — asserted directly rather than inferred from
  // whether an injection was caught.
  assert.ok(PRODUCTION_NATIVE.includes(target), `the walk never reached ${target}`);
  assert.deepEqual(
    sweep(["AVAssetDownloadTask"], PRODUCTION_NATIVE),
    [],
    "already failing before injection",
  );

  withInjectedCopy(
    target,
    (original) =>
      original.replace(
        "public actor AVPlayerAdapter",
        "let leak: AVAssetDownloadTask? = nil\n\npublic actor AVPlayerAdapter",
      ),
    (injectedPath) => {
      const caught = sweep(["AVAssetDownloadTask"], [...PRODUCTION_NATIVE, injectedPath]);
      assert.equal(caught.length, 1, "the sweep did not catch an offline download API");
      assert.ok(caught[0].file.endsWith("AVPlayerAdapter.swift"));
    },
  );

  assert.deepEqual(sweep(["AVAssetDownloadTask"], PRODUCTION_NATIVE), []);
});

test("a comment naming a forbidden symbol is not a violation", () => {
  // The counterpart risk. These files explain at length *why* there is no
  // download manager and no cast provider, and a sweep that matched its own
  // rationale would be a permanent false positive.
  const adapter = read("apps/faithful-android/app/src/main/kotlin/io/faithform/faithful/media/Media3PlayerAdapter.kt");
  assert.ok(adapter.includes("DownloadManager"), "the rationale no longer names the symbol");
  assert.deepEqual(sweep(["DownloadManager"], PRODUCTION_NATIVE), []);
});

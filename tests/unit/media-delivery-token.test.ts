import assert from "node:assert/strict";
import test from "node:test";

process.env.STREAM_PLAYBACK_SECRET =
  "stream-playback-secret-that-is-at-least-32-bytes";

import {
  MEDIA_DELIVERY_TTL_SECONDS,
  isMediaDeliveryToken,
  issueMediaCapability,
  issueMediaDeliveryToken,
  verifyMediaCapability,
  verifyMediaDeliveryToken,
} from "@/lib/media/v1/playback-capability";
import { signPlaybackToken } from "@/lib/stream/playback";
import { rewriteM3u8Playlist } from "@/lib/stream/hls-player";
import { segmentsAreSafe } from "@/lib/stream/relay-upstream";

const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const OTHER_ACCOUNT = "22222222-2222-4222-8222-222222222222";
const EVENT = "33333333-3333-4333-8333-333333333333";
const OTHER_EVENT = "44444444-4444-4444-8444-444444444444";
const NOW = 1_800_000_000;

function deliver(overrides: Partial<Parameters<typeof issueMediaDeliveryToken>[0]> = {}) {
  return issueMediaDeliveryToken({
    accountId: ACCOUNT,
    churchSlug: "grace",
    kind: "live",
    mediaId: EVENT,
    authorizationVersion: 3,
    nowSeconds: NOW,
    ...overrides,
  })!;
}

test("a delivery token round-trips, bound to account, church, kind, item and version", () => {
  const { token, expiresAt } = deliver();
  const verified = verifyMediaDeliveryToken(token, { nowSeconds: NOW + 1 });

  assert.ok(verified.ok);
  assert.equal(verified.ok && verified.capability.t, "delivery");
  assert.equal(verified.ok && verified.capability.a, ACCOUNT);
  assert.equal(verified.ok && verified.capability.c, "grace");
  assert.equal(verified.ok && verified.capability.k, "live");
  assert.equal(verified.ok && verified.capability.m, EVENT);
  assert.equal(verified.ok && verified.capability.av, 3);
  assert.equal(expiresAt, new Date((NOW + MEDIA_DELIVERY_TTL_SECONDS) * 1000).toISOString());
});

test("a delivery token outlasts a service but not a day", () => {
  // Every segment URL inherits it and HLS forbids those from changing, so it
  // must cover a whole service. What stops it outliving permission is the
  // per-request authorization, not this number — but it is still bounded.
  assert.ok(MEDIA_DELIVERY_TTL_SECONDS >= 3 * 60 * 60);
  assert.ok(MEDIA_DELIVERY_TTL_SECONDS <= 12 * 60 * 60);

  const { token } = deliver();
  const late = verifyMediaDeliveryToken(token, { nowSeconds: NOW + MEDIA_DELIVERY_TTL_SECONDS });
  assert.equal(late.ok === false && late.reason, "expired");
});

test("a delivery token and a capability can never stand in for each other", () => {
  const { token: delivery } = deliver();
  const { token: capability } = issueMediaCapability({
    accountId: ACCOUNT,
    churchSlug: "grace",
    kind: "live",
    mediaId: EVENT,
    authorizationVersion: 3,
  })!;

  // A delivery token lives in URLs for hours; a capability is a five-minute
  // bearer credential. Neither verifies as the other, so a URL someone copies
  // can never be replayed as a header, and a header never opens a path.
  assert.equal(verifyMediaCapability(delivery).ok, false);
  assert.equal(verifyMediaDeliveryToken(capability).ok, false);

  // Even with the prefix swapped, the signature is under a different sub-key.
  const relabelled = `FFD1.${capability.split(".").slice(1).join(".")}`;
  const forged = verifyMediaDeliveryToken(relabelled);
  assert.equal(forged.ok === false && forged.reason, "bad_signature");
});

test("a website playback token is not a delivery token", () => {
  const website = signPlaybackToken(
    { churchId: "church-id", eventId: EVENT, audience: "public" },
    { secret: process.env.STREAM_PLAYBACK_SECRET },
  );
  assert.equal(verifyMediaDeliveryToken(website).ok, false);
});

test("a delivery token for one account, church or event opens no other", () => {
  const { token } = deliver();
  for (const expected of [
    { accountId: OTHER_ACCOUNT },
    { churchSlug: "other-church" },
    { mediaId: OTHER_EVENT },
    { kind: "recording" as const },
    { authorizationVersion: 4 },
  ]) {
    const result = verifyMediaDeliveryToken(token, { ...expected, nowSeconds: NOW });
    assert.equal(result.ok === false && result.reason, "mismatch", JSON.stringify(expected));
  }
});

test("a tampered delivery token fails before its contents are trusted", () => {
  const { token } = deliver();
  const [format, body, signature] = token.split(".");
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  const extended = Buffer.from(JSON.stringify({ ...payload, e: payload.e + 86_400 })).toString(
    "base64url",
  );

  const result = verifyMediaDeliveryToken(`${format}.${extended}.${signature}`);
  assert.equal(result.ok === false && result.reason, "bad_signature");
});

test("only the delivery prefix is read as a delivery token", () => {
  assert.equal(isMediaDeliveryToken(deliver().token), true);
  for (const segment of ["index.m3u8", "FFM1.a.b", "ffd1.a.b", "FFD1", "", null, undefined]) {
    assert.equal(isMediaDeliveryToken(segment), false, String(segment));
  }
});

test("a delivery token is a safe path segment and carries no provider detail", () => {
  const { token } = deliver();
  assert.match(token, /^[A-Za-z0-9._-]+$/);
  assert.ok(segmentsAreSafe(["grace", EVENT, token, "index.m3u8"]));

  const body = Buffer.from(token.split(".")[1], "base64url").toString("utf8");
  assert.ok(!body.includes(process.env.STREAM_PLAYBACK_SECRET!));
  for (const forbidden of ["relay/", "storage", "http", "email", "phone", "bucket"]) {
    assert.ok(!body.toLowerCase().includes(forbidden), `leaks ${forbidden}`);
  }
});

test("a playlist under a delivery path hands the token to every URI, unchanged across reloads", () => {
  const { token } = deliver();
  const base = `/api/media/v1/live/grace/${EVENT}/${token}`;

  const multivariant = rewriteM3u8Playlist(
    "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1200000\nstream.m3u8\n",
    `${base}/index.m3u8`,
  );
  assert.ok(multivariant.includes(`${base}/stream.m3u8`));

  const first = rewriteM3u8Playlist(
    [
      "#EXTM3U",
      "#EXT-X-TARGETDURATION:1",
      "#EXT-X-MEDIA-SEQUENCE:40",
      "#EXTINF:1.0,",
      "seg40.ts",
      "#EXTINF:1.0,",
      "seg41.ts",
      "#EXT-X-ENDLIST",
    ].join("\n"),
    `${base}/stream.m3u8`,
  );
  const second = rewriteM3u8Playlist(
    ["#EXTM3U", "#EXT-X-TARGETDURATION:1", "#EXT-X-MEDIA-SEQUENCE:41", "#EXTINF:1.0,", "seg41.ts"].join(
      "\n",
    ),
    `${base}/stream.m3u8`,
  );

  // Root-relative, so they resolve against whichever origin served the playlist.
  assert.ok(first.includes(`${base}/seg40.ts`));
  // RFC 8216 §6.2.2: a segment keeps its URI for as long as it is listed.
  const seg41 = `${base}/seg41.ts`;
  assert.ok(first.includes(seg41) && second.includes(seg41));
  // A brief ingest drop must not end playback for everyone.
  assert.ok(!first.includes("#EXT-X-ENDLIST"));
  // And nothing is appended as a query string.
  assert.ok(!first.includes("?") && !multivariant.includes("?"));
});

test("an absent or placeholder secret mints no delivery token", () => {
  const original = process.env.STREAM_PLAYBACK_SECRET;
  process.env.STREAM_PLAYBACK_SECRET = "replace-me-with-a-real-secret-value-here";
  assert.equal(deliver(), null);
  assert.equal(verifyMediaDeliveryToken("FFD1.a.b").ok, false);
  process.env.STREAM_PLAYBACK_SECRET = original;
});

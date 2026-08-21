import assert from "node:assert/strict";
import test from "node:test";
import {
  getHlsPlaybackUrl,
  signPlaybackToken,
  verifyPlaybackToken,
} from "@/lib/stream/playback";
import {
  buildCapabilityStreamName,
  signIngestToken,
  verifyIngestToken,
} from "@/lib/stream/ingest-token";
import { rewriteM3u8Playlist } from "@/lib/stream/hls-player";
import { buildStreamPath, parseStreamPath } from "@/lib/stream/relay";

const PLAYBACK_SECRET = "playback-secret-that-is-at-least-32-bytes-long";
const INGEST_SECRET = "ingest-secret-that-is-separate-and-32-bytes-long";
const CHURCH = "11111111-1111-4111-8111-111111111111";
const OTHER_CHURCH = "22222222-2222-4222-8222-222222222222";
const EVENT = "33333333-3333-4333-8333-333333333333";
const OTHER_EVENT = "44444444-4444-4444-8444-444444444444";

test("viewer capabilities are scoped and reject alteration or expiry", () => {
  const token = signPlaybackToken(
    { churchId: CHURCH, eventId: EVENT, audience: "public" },
    { nowSec: 1_000, secret: PLAYBACK_SECRET },
  );
  assert.ok(
    verifyPlaybackToken(token, {
      churchId: CHURCH,
      eventId: EVENT,
      audience: "public",
      nowSec: 1_001,
      secret: PLAYBACK_SECRET,
    }),
  );
  assert.equal(
    verifyPlaybackToken(token, {
      churchId: OTHER_CHURCH,
      nowSec: 1_001,
      secret: PLAYBACK_SECRET,
    }),
    null,
  );
  assert.equal(
    verifyPlaybackToken(token, {
      eventId: OTHER_EVENT,
      nowSec: 1_001,
      secret: PLAYBACK_SECRET,
    }),
    null,
  );
  assert.equal(
    verifyPlaybackToken(token, {
      audience: "staff",
      nowSec: 1_001,
      secret: PLAYBACK_SECRET,
    }),
    null,
  );
  assert.equal(
    verifyPlaybackToken(token, { nowSec: 2_000, secret: PLAYBACK_SECRET }),
    null,
  );
  assert.equal(
    verifyPlaybackToken(
      `${token.slice(0, token.lastIndexOf(".") + 1)}${token[token.lastIndexOf(".") + 1] === "A" ? "B" : "A"}${token.slice(token.lastIndexOf(".") + 2)}`,
      {
      nowSec: 1_001,
      secret: PLAYBACK_SECRET,
      },
    ),
    null,
  );
});

test("viewer and ingest authorities cannot authenticate each other", () => {
  const viewer = signPlaybackToken(
    { churchId: CHURCH, eventId: EVENT, audience: "public" },
    { nowSec: 1_000, secret: PLAYBACK_SECRET },
  );
  const ingest = signIngestToken(CHURCH, {
    nowSec: 1_000,
    secret: INGEST_SECRET,
    nonce: "fixed-test-nonce",
  });
  assert.equal(
    verifyIngestToken(viewer, { nowSec: 1_001, secret: INGEST_SECRET }),
    null,
  );
  assert.equal(
    verifyPlaybackToken(ingest, { nowSec: 1_001, secret: PLAYBACK_SECRET }),
    null,
  );
  assert.equal(
    verifyIngestToken(ingest, { nowSec: 2_000, secret: INGEST_SECRET }),
    null,
  );
});

test("ingest capabilities replace persistent keys on a stable relay path", () => {
  const token = signIngestToken(CHURCH, {
    nowSec: 1_000,
    ttlSec: 240,
    secret: INGEST_SECRET,
    nonce: "encoder-test-nonce",
  });
  const streamName = buildCapabilityStreamName(CHURCH, token);

  assert.equal(buildStreamPath(CHURCH), `live/${CHURCH}`);
  assert.match(streamName, new RegExp(`^${CHURCH}\\?token=`));
  assert.ok(verifyIngestToken(token, { nowSec: 1_239, secret: INGEST_SECRET }));
  assert.equal(
    verifyIngestToken(token, { nowSec: 1_240, secret: INGEST_SECRET }),
    null,
  );
  assert.deepEqual(parseStreamPath(`live/${CHURCH}`), {
    churchId: CHURCH,
    legacyCredentialInPath: false,
  });
  assert.deepEqual(
    parseStreamPath(`live/${CHURCH}/persistent_key_must_not_authorize`),
    { churchId: CHURCH, legacyCredentialInPath: true },
  );
});

test("playback URLs and playlists do not contain a publish key", () => {
  const priorSite = process.env.NEXT_PUBLIC_SITE_URL;
  const priorSecret = process.env.STREAM_PLAYBACK_SECRET;
  process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
  process.env.STREAM_PLAYBACK_SECRET = PLAYBACK_SECRET;
  const publishKey = "persistent_publish_key_must_never_escape";
  const url = getHlsPlaybackUrl({
    churchId: CHURCH,
    eventId: EVENT,
    audience: "public",
  });
  assert.equal(url.includes(publishKey), false);
  assert.match(url, new RegExp(`/api/stream/hls/${CHURCH}/index\\.m3u8\\?cap=`));

  const playlist = rewriteM3u8Playlist(
    `#EXTM3U\nhttps://relay.invalid/live/${CHURCH}/${publishKey}/seg.ts`,
    `/api/stream/hls/${CHURCH}/index.m3u8`,
    "cap=opaque",
  );
  assert.equal(playlist.includes(publishKey), false);
  assert.match(playlist, /seg\.ts\?cap=opaque/);
  if (priorSite === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = priorSite;
  if (priorSecret === undefined) delete process.env.STREAM_PLAYBACK_SECRET;
  else process.env.STREAM_PLAYBACK_SECRET = priorSecret;
});

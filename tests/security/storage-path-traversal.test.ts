import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isStorageKeyWithin, storageKeySegment } from "@/lib/security/storage-path";
import {
  buildRecordingStoragePath,
  isRecordingStoragePathForChurch,
  sanitizeRecordingFilename,
} from "@/lib/stream/recording-storage";

/**
 * storage-js puts the object key into the request URL unencoded, and URL
 * parsing resolves `..` before the request leaves. So the social-preview route,
 * which built `<church>/announcement-<id from the browser>.png` and upserted it
 * with the service role, could be sent
 * `x/../../../member-files/<other church>/file#` and overwrite another church's
 * private document. The announcement actions "checked" a browser-supplied path
 * with `startsWith("<church>/")`, which `<church>/../<other>/x.png` passes, and
 * then downloaded it with the service role.
 */

const CHURCH = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

test("URL parsing really does resolve `..` out of a storage key", () => {
  const url = new URL(
    `https://p.supabase.co/storage/v1/object/social-graphics/${CHURCH}/announcement-x/../../../member-files/${OTHER}/doc.pdf#.png`,
  );
  assert.equal(url.pathname, `/storage/v1/object/member-files/${OTHER}/doc.pdf`);
});

test("a key that climbs, truncates or smuggles is refused", () => {
  const prefix = `${CHURCH}/`;
  for (const path of [
    `${CHURCH}/../${OTHER}/x.png`,
    `${CHURCH}/a/../../${OTHER}/x.png`,
    `${CHURCH}/./x.png`,
    `${CHURCH}//x.png`,
    `${CHURCH}/x.png#`,
    `${CHURCH}/x.png?download`,
    `${CHURCH}/%2e%2e/${OTHER}/x.png`,
    `${CHURCH}/..\\${OTHER}\\x.png`,
    `${CHURCH}/x\u0000.png`,
    `${CHURCH}/`,
    `${OTHER}/x.png`,
    `${CHURCH}x.png`,
    "",
    null,
    42,
  ]) {
    assert.equal(isStorageKeyWithin(path, prefix), false, `accepted ${String(path)}`);
  }
});

test("ordinary keys the app writes are still accepted", () => {
  for (const path of [
    `${CHURCH}/announcement-33333333-3333-4333-8333-333333333333.png`,
    `${CHURCH}/draft-abc_123.png`,
    `${CHURCH}/upload-9f3c.png`,
    `${CHURCH}/media/square/logo.v2.jpg`,
  ]) {
    assert.equal(isStorageKeyWithin(path, `${CHURCH}/`), true, path);
  }
});

test("a browser-supplied id becomes one inert key segment", () => {
  assert.match(storageKeySegment("x/../../../member-files/abc/doc.pdf#"), /^[A-Za-z0-9_-]+$/);
  assert.equal(
    storageKeySegment("33333333-3333-4333-8333-333333333333"),
    "33333333-3333-4333-8333-333333333333",
    "a real announcement id keeps the key it always had",
  );
});

test("the relay's recording path check cannot be walked out of", () => {
  assert.equal(isRecordingStoragePathForChurch(`relay/${CHURCH}/../${OTHER}/a.mp4`, CHURCH), false);
  assert.equal(isRecordingStoragePathForChurch(`relay/${CHURCH}/stream_ab-1700000000.mp4`, CHURCH), true);
  assert.equal(sanitizeRecordingFilename("../../x.mp4"), "x.mp4");
  assert.equal(
    isRecordingStoragePathForChurch(buildRecordingStoragePath(CHURCH, "stream_ab-1700000000.mp4"), CHURCH),
    true,
  );
});

test("every service-role path from the browser goes through the guard", () => {
  const preview = readFileSync("lib/social/generate-preview.ts", "utf8");
  assert.match(preview, /announcement-\$\{storageKeySegment\(input\.announcementId\)\}/);

  const graphic = readFileSync("lib/social/generate-graphic.ts", "utf8");
  assert.match(graphic, /downloadSocialGraphic\(\s*churchId: string,\s*graphicPath: string/);
  assert.equal((graphic.match(/isStorageKeyWithin\(graphicPath/g) ?? []).length, 2);

  const actions = readFileSync("app/dashboard/announcements/actions.ts", "utf8");
  assert.doesNotMatch(actions, /[sS]ocialGraphicPath\.startsWith\(/);
  assert.equal((actions.match(/isStorageKeyWithin\(/g) ?? []).length, 3);
});

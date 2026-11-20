import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { FEATURES, featureDefaultEnabled, featureKeyForPath, getFeature } from "@/lib/features/catalog";

const read = (path: string) => readFileSync(path, "utf8");

test("Transcripts & Clips is a church feature that ships off; every other feature still ships on", () => {
  const feature = getFeature("sermon_media");
  assert.equal(feature.label, "Transcripts & Clips");
  assert.equal(featureDefaultEnabled("sermon_media"), false);
  for (const other of FEATURES.filter(f => f.key !== "sermon_media")) {
    assert.equal(featureDefaultEnabled(other.key), true, other.key);
  }
  // Recording pages stay under Live Stream; only the Clips view under Recordings is its own.
  assert.equal(featureKeyForPath("/dashboard/live-streaming/recordings/abc/clips/def"), "live_stream");
  assert.equal(featureKeyForPath("/dashboard/live-streaming/recordings/abc"), "live_stream");
  assert.equal(featureKeyForPath("/dashboard/live-streaming/recordings/clips"), "sermon_media");
  assert.equal(featureKeyForPath("/dashboard/live-streaming/recordings/clips/abc"), "sermon_media");
  assert.equal(feature.href, "/dashboard/live-streaming/recordings/clips");
});

test("missing or unreadable switches fall back to the catalog default, not to on", () => {
  const access = read("lib/features/access.ts");
  assert.match(access, /FEATURE_KEYS\.map\(\(key\) => \[key, featureDefaultEnabled\(key\)\]\)/);
  assert.match(access, /return data \? Boolean\(data\.enabled\) : featureDefaultEnabled\(key\);/);
  assert.doesNotMatch(access, /No row means never changed, which means the catalog default: on/);
});

test("sermon media requires the church switch, the staff grant, and the server kill switch", () => {
  const access = read("lib/sermon-media/access.ts");
  assert.match(access, /isChurchFeatureEnabled\(churchId, "sermon_media"\)/);
  assert.match(access, /featureAccessDenied\("sermon_media"\)/);
  assert.match(access, /process\.env\.SERMON_MEDIA_ENABLED === "1"/);
  assert.match(read("app/dashboard/live-streaming/recordings/[id]/page.tsx"), /access\?\.allowed\.includes\("sermon_media"\)/);
  for (const page of [
    "app/dashboard/live-streaming/recordings/clips/page.tsx",
    "app/dashboard/live-streaming/recordings/clips/[clipId]/page.tsx",
    "app/dashboard/live-streaming/recordings/[id]/transcript/page.tsx",
  ]) {
    assert.match(read(page), /pageFeatureBlocked\("sermon_media"\)/, page);
  }
  for (const layout of [
    "app/dashboard/live-streaming/recordings/clips/layout.tsx",
    "app/dashboard/live-streaming/recordings/[id]/transcript/layout.tsx",
  ]) {
    assert.match(read(layout), /<FeatureGate feature="sermon_media">/, layout);
  }
  const auto = read("lib/sermon-media/auto.ts");
  assert.equal((auto.match(/isChurchFeatureEnabled\((churchId|recording\.churchId), "sermon_media"\)/g) ?? []).length, 2);
});

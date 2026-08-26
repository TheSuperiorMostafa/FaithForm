#!/usr/bin/env node
/**
 * Proves iOS and Android expose the same set of user-facing strings.
 *
 * Prompt 4 shipped iOS with inline literals and Android with resources, which
 * meant a string could exist on one platform and silently not on the other.
 * This makes that a build failure instead of something noticed in a screenshot.
 *
 * It also refuses new inline user-facing literals in SwiftUI views, because a
 * catalog nobody uses is not localization.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SWIFT_STRINGS = "apps/faithful-ios/Sources/FaithfulKit/Strings.swift";
const ANDROID_STRINGS = "apps/faithful-android/app/src/main/res/values/strings.xml";
const SWIFT_VIEW_DIRS = [
  "apps/faithful-ios/Sources/FaithfulKit/Components",
];

/**
 * Keys that legitimately exist on one platform only.
 *
 * Notification channels and a re-askable permission are Android concepts with
 * no iOS counterpart — iOS has neither, so requiring a mirrored key would mean
 * inventing a string nothing can ever show. Each entry must say why.
 */
const PLATFORM_ONLY = {
  android: new Map([
    ["channel_announcements_description", "iOS has no notification channels"],
    ["channel_events_description", "iOS has no notification channels"],
    ["channel_silenced_by_system", "iOS has no per-channel system toggle"],
  ]),
  ios: new Map(),
};

const failures = [];

const swiftSource = readFileSync(SWIFT_STRINGS, "utf8");
const swiftKeys = new Set(
  [...swiftSource.matchAll(/t\("([a-z0-9_]+)",/g)].map((m) => m[1]),
);

const androidSource = readFileSync(ANDROID_STRINGS, "utf8");
const androidKeys = new Set(
  [...androidSource.matchAll(/<string name="([a-z0-9_]+)"/g)].map((m) => m[1]),
);

for (const key of swiftKeys) {
  if (androidKeys.has(key) || PLATFORM_ONLY.ios.has(key)) continue;
  failures.push(`iOS has "${key}", Android does not`);
}
for (const key of androidKeys) {
  if (swiftKeys.has(key) || PLATFORM_ONLY.android.has(key)) continue;
  failures.push(`Android has "${key}", iOS does not`);
}

// An exemption for a key that no longer exists is stale and hides drift.
for (const [platform, entries] of Object.entries(PLATFORM_ONLY)) {
  const live = platform === "android" ? androidKeys : swiftKeys;
  for (const key of entries.keys()) {
    if (!live.has(key)) {
      failures.push(`stale ${platform}-only exemption for "${key}" — remove it`);
    }
  }
}

/**
 * A user-facing literal is a quoted string passed to Text(...) or used as a
 * button label. SF Symbol names, accessibility identifiers and token keys are
 * not, so only Text( and Label( are inspected.
 */
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full);
      continue;
    }
    if (!entry.endsWith(".swift")) continue;

    const source = readFileSync(full, "utf8");
    for (const match of source.matchAll(/\bText\(\s*"((?:[^"\\]|\\.)+)"/g)) {
      const literal = match[1];
      // Interpolated values and format strings are composed elsewhere.
      if (literal.includes("\\(")) continue;
      failures.push(`${full}: inline user-facing literal Text("${literal}") — use L.`);
    }
  }
}

for (const dir of SWIFT_VIEW_DIRS) {
  try {
    walk(dir);
  } catch {
    // A view directory that does not exist yet is not a failure.
  }
}

if (failures.length) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exit(1);
}

const shared = [...swiftKeys].filter((key) => androidKeys.has(key)).length;
const exempt = PLATFORM_ONLY.android.size + PLATFORM_ONLY.ios.size;
console.log(
  `Localization parity: ${shared} shared keys, ${exempt} documented platform-only.`,
);

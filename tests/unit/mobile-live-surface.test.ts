import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("Go Live publishes the event to the FaithForm apps", () => {
  const source = read("lib/stream/go-live.ts");
  const start = source.slice(
    source.indexOf("export async function startLiveBroadcast("),
    source.indexOf("export async function endLiveBroadcast("),
  );

  assert.match(start, /publishToFaithForm\(/);
  assert.match(start, /kind:\s*"live"/);
  assert.match(start, /visibility:\s*"public"/);
  assert.match(start, /actorUserId:\s*userId/);
});

test("iPhone Home renders live media and routes its action to Services", () => {
  const home = read("apps/faithform-ios/App/HomeTab.swift");

  assert.match(home, /features\.media\.phase\.live/);
  assert.match(home, /LiveNowHero\(live:\s*live\)/);
  assert.match(home, /root\.watchSection\s*=\s*\.media/);
  assert.match(home, /root\.selectedTab\s*=\s*\.watch/);
  assert.match(home, /features\.media\.refresh\(\)/);
});

test("Android Home renders live media and routes its action to Services", () => {
  const home = read(
    "apps/faithform-android/app/src/main/kotlin/io/faithform/app/ui/host/HomeAndChurchTabs.kt",
  );
  const schedule = read(
    "apps/faithform-android/app/src/main/kotlin/io/faithform/app/ui/schedule/ScheduleScreen.kt",
  );

  assert.match(home, /MediaListModel\(/);
  assert.match(home, /mediaState\.liveCard/);
  assert.match(home, /selectTab\(HostTab\.WATCH\)/);
  assert.match(schedule, /LiveNowHero\(/);
});
